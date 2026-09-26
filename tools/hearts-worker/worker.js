/**
 * favorbook 하트 — Cloudflare Worker + D1
 *
 * 셀럽과 책에 방문자가 하트를 누르고, 모두가 같은 하트 수를 봅니다.
 * 배포 방법은 같은 폴더의 README.md를 보세요.
 *
 * 필요한 바인딩
 *   DB    D1 데이터베이스 (schema.sql 로 테이블을 만든다)
 * 선택 변수
 *   SALT             투표자 id를 해시할 때 섞는 비밀 문자열
 *   ALLOWED_ORIGIN   하트를 누를 수 있는 출처, 콤마 구분
 *                    (기본: https://favorbook.co.kr,https://www.favorbook.co.kr)
 *
 * 엔드포인트
 *   POST /counts  {"keys":["c:이름","b:책 제목",...]}  → {"counts":{"c:이름":3,...}}
 *   POST /heart   {"key":"c:이름","voter":"<브라우저 id>","on":true}
 *                 → {"key":"c:이름","n":4,"on":true}
 *   GET  /top?type=c|b&limit=20  → {"items":[{"key":"c:이름","n":12},...]}
 *
 * 키는 셀럽이면 "c:" + 한국어 이름, 책이면 "b:" + 한국어 제목이다.
 * 한국어·영문 페이지가 같은 키를 쓰므로 하트 수가 합쳐진다.
 */

const SITE = 'https://favorbook.co.kr';
const DEFAULT_ORIGINS = 'https://favorbook.co.kr,https://www.favorbook.co.kr';

const MAX_KEYS = 300;        // /counts 한 번에 물을 수 있는 키 수
const MAX_KEY_LEN = 200;
const RATE_LIMIT = 40;       // IP 하나가 1분에 누를 수 있는 횟수
const KNOWN_TTL = 3600 * 1000;

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = allowedOrigin(origin, env);
    const cors = corsHeaders(allowed ? origin : '');

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    const url = new URL(request.url);
    try {
      if (url.pathname === '/counts' && request.method === 'POST') {
        return json(await counts(request, env), cors);
      }
      if (url.pathname === '/heart' && request.method === 'POST') {
        if (!allowed) throw new HttpError(403, 'origin not allowed');
        return json(await heart(request, env), cors);
      }
      if (url.pathname === '/top' && request.method === 'GET') {
        return json(await top(url, env), cors, 200, 'public, max-age=300');
      }
      if (url.pathname === '/') {
        return json({ ok: true, service: 'favorbook-hearts' }, cors);
      }
      throw new HttpError(404, 'not found');
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, cors, e.status);
      console.error(e);
      return json({ error: 'server error' }, cors, 500);
    }
  },
};

// ── 엔드포인트 ─────────────────────────────────────────────────────

async function counts(request, env) {
  const body = await readJson(request);
  const keys = Array.isArray(body.keys) ? body.keys : null;
  if (!keys) throw new HttpError(400, 'keys required');
  const clean = [...new Set(keys.filter(validKeyFormat))].slice(0, MAX_KEYS);
  const out = {};
  if (!clean.length) return { counts: out };

  const { results } = await env.DB
    .prepare('SELECT item, n FROM counts WHERE item IN (SELECT value FROM json_each(?1))')
    .bind(JSON.stringify(clean))
    .all();
  for (const r of results) out[r.item] = r.n;
  return { counts: out };
}

async function heart(request, env) {
  const ip = request.headers.get('CF-Connecting-IP') || '';
  if (!rateOk(ip)) throw new HttpError(429, 'too many requests');

  const body = await readJson(request);
  const key = typeof body.key === 'string' ? body.key.trim() : '';
  const voterRaw = typeof body.voter === 'string' ? body.voter : '';
  const on = body.on !== false;

  if (!validKeyFormat(key)) throw new HttpError(400, 'bad key');
  if (!/^[A-Za-z0-9-]{16,64}$/.test(voterRaw)) throw new HttpError(400, 'bad voter');
  if (!(await isKnown(key))) throw new HttpError(404, 'unknown item');

  const voter = await sha256(voterRaw + '|' + (env.SALT || ''));

  if (on) {
    const r = await env.DB
      .prepare('INSERT OR IGNORE INTO hearts (item, voter, created) VALUES (?1, ?2, ?3)')
      .bind(key, voter, Date.now())
      .run();
    if (r.meta.changes > 0) {
      await env.DB
        .prepare('INSERT INTO counts (item, n) VALUES (?1, 1) '
               + 'ON CONFLICT(item) DO UPDATE SET n = n + 1')
        .bind(key)
        .run();
    }
  } else {
    const r = await env.DB
      .prepare('DELETE FROM hearts WHERE item = ?1 AND voter = ?2')
      .bind(key, voter)
      .run();
    if (r.meta.changes > 0) {
      await env.DB
        .prepare('UPDATE counts SET n = MAX(n - 1, 0) WHERE item = ?1')
        .bind(key)
        .run();
    }
  }

  const row = await env.DB
    .prepare('SELECT n FROM counts WHERE item = ?1')
    .bind(key)
    .first();
  return { key, n: row ? row.n : 0, on };
}

async function top(url, env) {
  const type = url.searchParams.get('type') === 'b' ? 'b' : 'c';
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit'), 10) || 20, 1), 50);
  const { results } = await env.DB
    .prepare('SELECT item, n FROM counts WHERE item LIKE ?1 AND n > 0 ORDER BY n DESC LIMIT ?2')
    .bind(type + ':%', limit)
    .all();
  return { items: results.map(r => ({ key: r.item, n: r.n })) };
}

// ── 검증 ───────────────────────────────────────────────────────────

function validKeyFormat(k) {
  return typeof k === 'string' && /^[cb]:./.test(k) && k.length <= MAX_KEY_LEN;
}

// 사이트의 data.json에 있는 셀럽·책만 하트를 받는다. 아무 문자열이나
// 키로 쌓이는 것을 막기 위해서다. data.json을 못 읽으면 형식 검사만 한다.
let known = null;
let knownAt = 0;

async function isKnown(key) {
  if (!known || Date.now() - knownAt > KNOWN_TTL) {
    try {
      const res = await fetch(SITE + '/data.json', { cf: { cacheTtl: 600 } });
      if (!res.ok) throw new Error('data.json ' + res.status);
      const data = await res.json();
      const set = new Set();
      for (const [name, info] of Object.entries(data.celebs || {})) {
        set.add('c:' + name);
        for (const b of info.books || []) {
          if (b && b.title) set.add('b:' + String(b.title).trim());
        }
      }
      known = set;
      knownAt = Date.now();
    } catch (e) {
      console.error(e);
      if (!known) return true;
    }
  }
  return known.has(key);
}

// 워커 인스턴스마다 따로 세는 대략적인 제한이다. 연타·스크립트 남용을 늦추는 용도.
const hits = new Map();

function rateOk(ip) {
  const now = Date.now();
  const h = hits.get(ip);
  if (!h || now - h.t > 60000) {
    hits.set(ip, { t: now, c: 1 });
    if (hits.size > 5000) hits.clear();
    return true;
  }
  h.c += 1;
  return h.c <= RATE_LIMIT;
}

// ── 공통 ───────────────────────────────────────────────────────────

function allowedOrigin(origin, env) {
  if (!origin) return false;
  const list = (env.ALLOWED_ORIGIN || DEFAULT_ORIGINS).split(',').map(s => s.trim()).filter(Boolean);
  if (list.includes(origin)) return true;
  return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

function corsHeaders(origin) {
  const h = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
  h['Access-Control-Allow-Origin'] = origin || SITE;
  return h;
}

async function readJson(request) {
  const text = await request.text();
  if (text.length > 64 * 1024) throw new HttpError(413, 'body too large');
  try {
    return JSON.parse(text || '{}') || {};
  } catch {
    throw new HttpError(400, 'bad json');
  }
}

function json(obj, cors, status = 200, cache = 'no-store') {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': cache },
  });
}

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}
