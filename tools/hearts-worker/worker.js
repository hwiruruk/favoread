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
 *   ADMIN_KEY        운영자 통계용 비밀번호. 없으면 /admin/*, /top 이 꺼진다.
 *
 * 엔드포인트
 *   POST /counts  {"keys":["c:이름","b:책 제목",...]}  → {"counts":{"c:이름":3,...}}
 *   POST /heart   {"key":"c:이름","voter":"<브라우저 id>","on":true}
 *                 → {"key":"c:이름","n":4,"on":true}
 *   GET  /celebs  → {"counts":{"c:이름":3,...}}  하트가 1개 이상인 모든 셀럽 (1분 캐시)
 *   GET  /top?type=c|b&limit=20  → {"items":[{"key":"c:이름","n":12},...]}   (운영자 전용)
 *   GET  /admin/stats            → 합계·일별·순위·최근 기록                  (운영자 전용)
 *   POST /view    {"path":"/share/이름.html"}  → 204   페이지 조회수 한 번 (assets/views.js가 보낸다)
 *   GET  /admin/views?days=30    → 일별 합계·페이지 순위                       (운영자 전용)
 *   POST /search  {"kind":"s","q":"카리나","hits":3}  → 204  사이트 검색창 검색어 (assets/v2/search.js가 보낸다)
 *                 kind "s"=검색(hits는 추천 결과 수), "c"=추천 결과를 누름
 *   GET  /admin/searches?days=30 → 인기 검색어·결과 없는 검색어                (운영자 전용)
 *        운영자 전용은 Authorization: Bearer <ADMIN_KEY> 헤더가 있어야 한다.
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
const IP_DAILY_PER_ITEM = 10; // IP 하나가 같은 셀럽·책에 하루 넣을 수 있는 하트 수
const CELEBS_TTL = 60;        // /celebs 캐시 초

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('Origin') || '';
    const allowed = allowedOrigin(origin, env);
    const cors = corsHeaders(allowed ? origin : '');

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    const url = new URL(request.url);
    try {
      if (url.pathname === '/celebs' && request.method === 'GET') {
        return await celebs(request, env, cors, ctx);
      }
      if (url.pathname === '/counts' && request.method === 'POST') {
        return json(await counts(request, env), cors);
      }
      if (url.pathname === '/heart' && request.method === 'POST') {
        if (!allowed) throw new HttpError(403, 'origin not allowed');
        return json(await heart(request, env), cors);
      }
      if (url.pathname === '/view' && request.method === 'POST') {
        return await view(request, env, cors, allowed);
      }
      if (url.pathname === '/search' && request.method === 'POST') {
        return await searchLog(request, env, cors, allowed);
      }
      if (url.pathname === '/admin/searches' && request.method === 'GET') {
        await requireAdmin(request, env);
        return json(await adminSearches(url, env), cors);
      }
      if (url.pathname === '/admin/views' && request.method === 'GET') {
        await requireAdmin(request, env);
        return json(await adminViews(url, env), cors);
      }
      if (url.pathname === '/top' && request.method === 'GET') {
        await requireAdmin(request, env);
        return json(await top(url, env), cors);
      }
      if (url.pathname === '/admin/stats' && request.method === 'GET') {
        await requireAdmin(request, env);
        return json(await adminStats(env), cors);
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

// 메인 카드처럼 셀럽 수백 명의 숫자를 한꺼번에 보여 줄 때 쓴다.
// 결과를 데이터센터 캐시에 1분 넣어 두어, 방문자가 많아도 D1은 1분에 한 번만 읽는다.
async function celebs(request, env, cors, ctx) {
  const cache = caches.default;
  const cacheKey = new Request(new URL('/celebs', request.url).toString(), { method: 'GET' });
  let res = await cache.match(cacheKey);
  if (!res) {
    const { results } = await env.DB
      .prepare("SELECT item, n FROM counts WHERE item >= 'c:' AND item < 'c;' AND n > 0")
      .all();
    const out = {};
    for (const r of results) out[r.item] = r.n;
    res = new Response(JSON.stringify({ counts: out }), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'public, max-age=' + CELEBS_TTL,
      },
    });
    ctx.waitUntil(cache.put(cacheKey, res.clone()));
  }
  const h = new Headers(res.headers);
  for (const [k, v] of Object.entries(cors)) h.set(k, v);
  h.set('Cache-Control', 'public, max-age=30');
  return new Response(res.body, { status: 200, headers: h });
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
    const now = Date.now();
    const ipHash = await sha256('ip|' + ip + '|' + (env.SALT || ''));
    const r = await insertHeart(env, key, voter, ipHash, now);
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

const DAY = 86400 * 1000;
const KST = 9 * 3600 * 1000;

// 운영자 통계. 하트를 뺀 기록은 hearts에서 지워지므로 일별 수는
// "그날 눌러서 지금까지 남아 있는 하트"다. 누른 사람 id는 돌려주지 않는다.
async function adminStats(env) {
  const now = Date.now();
  const todayStart = Math.floor((now + KST) / DAY) * DAY - KST;
  const since30 = todayStart - 29 * DAY;

  const [sum, items, today, week, daily, topC, topB, recent] = await env.DB.batch([
    env.DB.prepare('SELECT COUNT(*) AS n, COUNT(DISTINCT voter) AS v FROM hearts'),
    env.DB.prepare('SELECT COUNT(*) AS n FROM counts WHERE n > 0'),
    env.DB.prepare('SELECT COUNT(*) AS n FROM hearts WHERE created >= ?1').bind(todayStart),
    env.DB.prepare('SELECT COUNT(*) AS n FROM hearts WHERE created >= ?1').bind(todayStart - 6 * DAY),
    env.DB.prepare('SELECT CAST((created + ?1) / ?2 AS INTEGER) AS d, COUNT(*) AS n FROM hearts '
                 + 'WHERE created >= ?3 GROUP BY d ORDER BY d').bind(KST, DAY, since30),
    env.DB.prepare("SELECT item, n FROM counts WHERE item LIKE 'c:%' AND n > 0 ORDER BY n DESC LIMIT 100"),
    env.DB.prepare("SELECT item, n FROM counts WHERE item LIKE 'b:%' AND n > 0 ORDER BY n DESC LIMIT 100"),
    env.DB.prepare('SELECT item, created FROM hearts ORDER BY created DESC LIMIT 100'),
  ]);

  const byDay = new Map(daily.results.map(r => [Number(r.d), r.n]));
  const days = [];
  for (let t = since30; t <= todayStart; t += DAY) {
    const d = Math.floor((t + KST) / DAY);
    days.push({ date: new Date(d * DAY).toISOString().slice(0, 10), n: byDay.get(d) || 0 });
  }
  const pair = r => ({ key: r.item, n: r.n });

  return {
    generated: now,
    total: sum.results[0].n,
    voters: sum.results[0].v,
    items: items.results[0].n,
    today: today.results[0].n,
    week: week.results[0].n,
    days,
    topCelebs: topC.results.map(pair),
    topBooks: topB.results.map(pair),
    recent: recent.results.map(r => ({ key: r.item, t: r.created })),
  };
}

// ── 조회수 ─────────────────────────────────────────────────────────
// 광고 차단기에 가려지는 GA와 달리 우리 서버에 직접 쌓는다. 페이지 주소·날짜별로
// 횟수만 세고 방문자 id·IP는 저장하지 않는다. 같은 탭에서 같은 페이지를 새로고침해도
// 한 번만 세는 일은 assets/views.js가 하고, 서버는 봇과 남의 사이트에서 온 요청만 거른다.

const BOT_RE = /bot|crawl|spider|slurp|headless|lighthouse|preview|monitor|curl|wget|python|node-fetch|axios|go-http|java\/|httpclient|facebookexternalhit|embedly|yeti|kakaotalk-scrap|yandex|baidu|ahrefs|semrush|mj12|bytespider|perplexity/i;
// 네이버·카카오톡·구글 앱의 인앱 브라우저는 실제 방문자이므로 일부러 막지 않는다.

async function view(request, env, cors, allowed) {
  // 브라우저가 보내는 Origin이 허용 목록에 있어야 센다 (남의 사이트·스크립트 요청 제외)
  const ua = request.headers.get('User-Agent') || '';
  const ip = request.headers.get('CF-Connecting-IP') || '';
  if (!allowed || !ua || BOT_RE.test(ua) || !rateOk('view|' + ip)) {
    return new Response(null, { status: 204, headers: cors });
  }
  const body = await readJson(request);
  const path = normalizePath(body.path);
  if (path) {
    const day = Math.floor((Date.now() + KST) / DAY);
    await env.DB
      .prepare('INSERT INTO views (path, day, n) VALUES (?1, ?2, 1) '
             + 'ON CONFLICT(path, day) DO UPDATE SET n = n + 1')
      .bind(path, day)
      .run();
  }
  return new Response(null, { status: 204, headers: cors });
}

// /index.html 과 / 를 같은 주소로 합치고, 검색어·해시는 버린다. 이상한 문자열은 거른다.
function normalizePath(p) {
  if (typeof p !== 'string' || p.length > 300) return '';
  let path = p.split('#')[0].split('?')[0];
  if (path[0] !== '/') return '';
  try { path = decodeURIComponent(path); } catch { return ''; }
  path = path.replace(/\/index\.html$/, '/');
  if (!/^\/[^\s<>"'\\]*$/.test(path)) return '';
  return path;
}

// ── 사이트 검색어 ──────────────────────────────────────────────────
// 검색창에 입력을 멈춘 뒤의 검색어를 날짜별로 센다. 방문자 id·IP는 저장하지 않는다.
// zero는 추천 결과가 하나도 없었던 횟수 — 사람들이 찾는데 사이트에 없는 셀럽·책이다.

const MAX_Q = 40;

function normalizeQuery(q) {
  if (typeof q !== 'string') return '';
  const t = q.normalize('NFC').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  if (t.length < 2 || t.length > MAX_Q) return '';
  if (/https?:|www\.|@/.test(t)) return '';   // 주소·이메일처럼 보이는 입력은 저장하지 않는다
  return t;
}

async function searchLog(request, env, cors, allowed) {
  const ua = request.headers.get('User-Agent') || '';
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const done = () => new Response(null, { status: 204, headers: cors });
  if (!allowed || !ua || BOT_RE.test(ua) || !rateOk('search|' + ip)) return done();
  const body = await readJson(request);
  const q = normalizeQuery(body.q);
  if (!q) return done();
  const day = Math.floor((Date.now() + KST) / DAY);
  if (body.kind === 'c') {
    await env.DB
      .prepare('INSERT INTO searches (q, day, n, zero, clicks) VALUES (?1, ?2, 0, 0, 1) '
             + 'ON CONFLICT(q, day) DO UPDATE SET clicks = clicks + 1')
      .bind(q, day).run();
  } else {
    const zero = Number(body.hits) === 0 ? 1 : 0;
    await env.DB
      .prepare('INSERT INTO searches (q, day, n, zero, clicks) VALUES (?1, ?2, 1, ?3, 0) '
             + 'ON CONFLICT(q, day) DO UPDATE SET n = n + 1, zero = zero + ?3')
      .bind(q, day, zero).run();
  }
  return done();
}

async function adminSearches(url, env) {
  const days = Math.min(Math.max(parseInt(url.searchParams.get('days'), 10) || 30, 1), 90);
  const since = Math.floor((Date.now() + KST) / DAY) - days + 1;
  const [top, none, total] = await env.DB.batch([
    env.DB.prepare('SELECT q, SUM(n) AS n, SUM(zero) AS zero, SUM(clicks) AS clicks FROM searches '
                 + 'WHERE day >= ?1 GROUP BY q HAVING SUM(n) > 0 ORDER BY n DESC, q LIMIT 100').bind(since),
    env.DB.prepare('SELECT q, SUM(n) AS n, SUM(zero) AS zero, SUM(clicks) AS clicks FROM searches '
                 + 'WHERE day >= ?1 GROUP BY q HAVING SUM(zero) > 0 ORDER BY zero DESC, q LIMIT 100').bind(since),
    env.DB.prepare('SELECT SUM(n) AS n, SUM(zero) AS zero, SUM(clicks) AS clicks FROM searches WHERE day >= ?1').bind(since),
  ]);
  const row = r => ({ q: r.q, n: r.n, zero: r.zero, clicks: r.clicks });
  const t = total.results[0] || {};
  return {
    days,
    total: t.n || 0, zero: t.zero || 0, clicks: t.clicks || 0,
    top: top.results.map(row),
    none: none.results.map(row),
  };
}

async function adminViews(url, env) {
  const days = Math.min(Math.max(parseInt(url.searchParams.get('days'), 10) || 30, 1), 90);
  const today = Math.floor((Date.now() + KST) / DAY);
  const since = today - days + 1;
  const [daily, top, total] = await env.DB.batch([
    env.DB.prepare('SELECT day, SUM(n) AS n FROM views WHERE day >= ?1 GROUP BY day ORDER BY day').bind(since),
    env.DB.prepare('SELECT path, SUM(n) AS n FROM views WHERE day >= ?1 GROUP BY path ORDER BY n DESC LIMIT 100').bind(since),
    env.DB.prepare('SELECT SUM(n) AS n FROM views WHERE day >= ?1').bind(since),
  ]);
  const byDay = new Map(daily.results.map(r => [Number(r.day), r.n]));
  const out = [];
  for (let d = since; d <= today; d++) {
    out.push({ date: new Date(d * DAY).toISOString().slice(0, 10), n: byDay.get(d) || 0 });
  }
  return {
    days,
    total: total.results[0].n || 0,
    daily: out,
    pages: top.results.map(r => ({ path: r.path, n: r.n })),
  };
}

// hearts.ip 칸이 있으면 IP당 하루 제한을 걸고 IP 해시를 함께 적는다.
// 칸이 없는 예전 데이터베이스에서는 제한 없이 예전처럼 넣는다 (README의 ALTER TABLE 참고).
let hasIpCol = null;

async function insertHeart(env, key, voter, ipHash, now) {
  if (hasIpCol !== false) {
    try {
      const todayStart = Math.floor((now + KST) / DAY) * DAY - KST;
      const row = await env.DB
        .prepare('SELECT COUNT(*) AS c FROM hearts WHERE item = ?1 AND ip = ?2 AND created >= ?3')
        .bind(key, ipHash, todayStart)
        .first();
      hasIpCol = true;
      if (row && row.c >= IP_DAILY_PER_ITEM) {
        // 이미 이 브라우저가 누른 하트라면 제한과 상관없이 그대로 둔다
        const mine = await env.DB
          .prepare('SELECT 1 AS x FROM hearts WHERE item = ?1 AND voter = ?2')
          .bind(key, voter)
          .first();
        if (!mine) throw new HttpError(429, 'daily limit');
        return { meta: { changes: 0 } };
      }
      return await env.DB
        .prepare('INSERT OR IGNORE INTO hearts (item, voter, created, ip) VALUES (?1, ?2, ?3, ?4)')
        .bind(key, voter, now, ipHash)
        .run();
    } catch (e) {
      if (e instanceof HttpError) throw e;
      if (!/no such column/i.test(String(e && e.message))) throw e;
      hasIpCol = false;
    }
  }
  return env.DB
    .prepare('INSERT OR IGNORE INTO hearts (item, voter, created) VALUES (?1, ?2, ?3)')
    .bind(key, voter, now)
    .run();
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

async function requireAdmin(request, env) {
  if (!env.ADMIN_KEY) throw new HttpError(404, 'not found');
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const auth = request.headers.get('Authorization') || '';
  const given = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  // 비밀번호를 길이·내용과 상관없이 같은 시간에 비교하려고 해시끼리 맞춘다
  const [a, b] = await Promise.all([sha256(given), sha256(env.ADMIN_KEY)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  if (diff !== 0 || !given) {
    // 틀린 비밀번호를 연달아 넣어 보는 것을 늦춘다
    if (!rateOk('admin|' + ip)) throw new HttpError(429, 'too many requests');
    throw new HttpError(401, 'unauthorized');
  }
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
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
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
