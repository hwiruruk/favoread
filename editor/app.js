/* Favoread Editor — single-page editor for data.csv
 * Auth: GitHub PAT in localStorage, commits via Contents API.
 * Aladin: JSONP (Output=JS&Callback=...) — bypasses CORS.
 */

/* -------------------- Config (localStorage) -------------------- */
const LS = {
  get(k, def = '') { return localStorage.getItem('favoread.' + k) ?? def; },
  set(k, v) { localStorage.setItem('favoread.' + k, v); },
};
const Config = {
  get repo()      { return LS.get('repo', 'hwiruruk/favoread'); },
  get branch()    { return LS.get('branch', 'main'); },
  get path()      { return LS.get('path', 'data.csv'); },
  get token()     { return LS.get('token'); },
  get ttb()       { return LS.get('ttb'); },
  get committer() { return LS.get('committer'); },
  get corsProxy() { return LS.get('corsProxy'); }, // e.g. https://corsproxy.io/?url=
};

/* -------------------- State -------------------- */
const State = {
  headers: [],          // exact header strings from CSV
  col: {},              // canonical name -> index
  celebs: new Map(),    // name -> { name, name_en, img, books:[...] }
  order: [],            // celeb name order (preserves first-appearance ordering)
  originalSha: null,
  selected: null,       // currently selected celeb name
  dirty: false,         // any unsaved change
  bookEditing: null,    // { celebName, bookIndex|null }
};

/* -------------------- Helpers -------------------- */
const $ = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function toast(msg, kind='') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast ' + kind;
  t.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add('hidden'), 3500);
}
function setStatus(msg) { $('#statusMsg').textContent = msg || ''; }

/* 단어 첫 글자만 대문자, 나머지 소문자 ('Norwegian Wood Of Love'). */
function toTitleCase(s) {
  return String(s || '').replace(
    /(\b[\p{L}\p{N}])([\p{L}\p{N}']*)/gu,
    (_, a, b) => a.toUpperCase() + b.toLowerCase()
  );
}

/* 한국어 성씨 → 자주 쓰이는 로마자 표기.
 * 한국 이름의 영문 표기는 '성 이름' 순서(예: 한강 = Han Kang)가 표준이고
 * 본인이 외국 활동 시에도 이 순서를 유지하는 경우가 많다.
 * 자동 번역/위키 결과가 가끔 '이름 성'(Kang Han)이나 붙은 단어(Hangang)로
 * 나오는 걸 표준 순서로 교정. */
const KO_SURNAMES = {
  '김':['kim','gim'],'이':['lee','yi','rhee','ri','i'],'박':['park','pak','bak'],
  '최':['choi','choe'],'정':['jung','jeong','chung','jong'],'강':['kang','gang'],
  '조':['cho','jo'],'윤':['yoon','yun'],'장':['jang','chang'],'임':['lim','im','rim'],
  '한':['han'],'오':['oh','o'],'서':['seo','suh','sur'],'신':['shin','sin'],
  '권':['kwon','gwon'],'황':['hwang'],'안':['ahn','an'],'송':['song'],
  '류':['ryu','yu','rhyu'],'전':['jeon','jun','chun'],'홍':['hong'],
  '고':['ko','go','koh','goh'],'문':['moon','mun'],'양':['yang'],
  '손':['son'],'배':['bae','pae'],'백':['baek','paek','pek'],'허':['heo','huh'],
  '유':['yu','yoo'],'남':['nam'],'심':['sim','shim'],'노':['noh','no','roh'],
  '하':['ha'],'곽':['kwak','gwak'],'성':['sung','seong'],'차':['cha'],
  '주':['joo','ju','choo'],'우':['woo','u'],'구':['koo','gu','ku','goo'],
  '민':['min'],'나':['na','ra'],'도':['do'],'진':['jin','chin'],
  '천':['cheon','chun'],'마':['ma'],'표':['pyo'],'변':['byun','pyon','byeon'],
  '지':['ji','chi'],'엄':['eom','um'],'채':['chae'],'원':['won'],
  '추':['chu','choo'],'어':['eo'],'반':['ban','pan'],'방':['bang'],
  '석':['seok','suk'],'설':['seol','sul'],'염':['yeom','yum'],'옥':['ok','ock'],
  '연':['yeon','youn'],'예':['ye','yea'],'위':['wi'],'은':['eun'],
  '명':['myung','myeong'],'편':['pyeon'],'표':['pyo'],
  '봉':['bong'],'복':['bok'],'독':['dok'],'두':['doo','du'],
  '맹':['maeng'],'모':['mo'],'목':['mok'],'묵':['muk'],
  '여':['yeo','yo'],'옹':['ong'],'육':['yuk','yook'],'음':['eum','um'],
  '인':['in'],'경':['kyung','kyong'],'기':['ki','gi','khee'],
};

/* 한국 이름을 '성 이름' 순서로 교정.
 * 입력 ko가 2~4자 순수 한글 이름일 때만 작동. 그 외엔 en 그대로 반환. */
function fixKoreanNameOrder(ko, en) {
  if (!ko || !en) return en;
  ko = ko.trim();
  if (!/^[가-힣]{2,4}$/.test(ko)) return en;
  const expected = KO_SURNAMES[ko[0]];
  if (!expected) return en;
  const norm = en.trim().replace(/\s+/g, ' ');
  const words = norm.split(' ').filter(Boolean);
  if (words.length === 1) {
    // 'Hangang' 같은 붙은 단어 → 'Han Gang'으로 분리 시도
    const lower = words[0].toLowerCase();
    for (const s of expected) {
      if (lower.startsWith(s) && lower.length > s.length) {
        const rest = words[0].slice(s.length);
        return s[0].toUpperCase() + s.slice(1)
             + ' ' + rest[0].toUpperCase() + rest.slice(1).toLowerCase();
      }
    }
    return en;
  }
  if (words.length === 2) {
    const first = words[0].toLowerCase();
    const last = words[1].toLowerCase();
    if (expected.includes(first)) return en;          // 이미 성-이름 순
    if (expected.includes(last))  return words[1] + ' ' + words[0]; // Swap
  }
  if (words.length === 3) {
    // 'Park Ji Won' 또는 'Ji Won Park' 같은 3-token 경우
    const first = words[0].toLowerCase();
    const last  = words[2].toLowerCase();
    if (expected.includes(first)) return en;
    if (expected.includes(last))  return words[2] + ' ' + words[0] + ' ' + words[1];
  }
  return en;
}

function setDirty(v) {
  State.dirty = v;
  $('#saveBtn').disabled = !v;
  const badge = $('#dirtyBadge');
  badge.classList.toggle('hidden', !v);
  if (v) badge.textContent = '미저장 변경';
  window.onbeforeunload = v ? () => '저장되지 않은 변경이 있습니다.' : null;
}

/* Unicode-safe base64 (for GitHub Contents API) */
function b64encodeUtf8(str) {
  return btoa(unescape(encodeURIComponent(str)));
}
function b64decodeUtf8(b64) {
  return decodeURIComponent(escape(atob(b64.replace(/\s/g, ''))));
}

/* -------------------- CSV mapping -------------------- */
function buildColIdx(headers) {
  const find = (pred) => {
    for (let i = 0; i < headers.length; i++) if (pred(headers[i])) return i;
    return -1;
  };
  const has = (h, kw) => h.toLowerCase().includes(kw.toLowerCase());
  return {
    name:      find(h => has(h, '연예인') && !has(h, '_en') && !has(h, '이미지')),
    name_en:   headers.indexOf('연예인_en') >= 0 ? headers.indexOf('연예인_en') : find(h => has(h, '연예인') && has(h, '_en')),
    title:     find(h => has(h, '도서명') && !has(h, '_en')),
    title_en:  headers.indexOf('도서명_en') >= 0 ? headers.indexOf('도서명_en') : find(h => has(h, '도서명') && has(h, '_en')),
    author:    find(h => has(h, '저자') && !has(h, '_en')),
    author_en: headers.indexOf('저자_en') >= 0 ? headers.indexOf('저자_en') : find(h => has(h, '저자') && has(h, '_en')),
    pub:       find(h => has(h, '출판사')),
    source:    find(h => has(h, '출처')),
    link:      find(h => has(h, '도서 정보') || has(h, '도서정보')),
    cover:     find(h => has(h, '도서 이미지') || has(h, '도서이미지') || has(h, '표지')),
    img:       find(h => has(h, '연예인 이미지') || has(h, '연예인이미지')),
    comment:   find(h => has(h, '코멘트') || has(h, '한마디')),
  };
}

function loadCsv(text) {
  const result = Papa.parse(text, { skipEmptyLines: false });
  if (!result.data.length) throw new Error('CSV가 비어있습니다.');
  const rows = result.data;
  const headers = rows[0];
  const col = buildColIdx(headers);
  if (col.name < 0 || col.title < 0) throw new Error('필수 컬럼(연예인/도서명) 헤더를 찾지 못했습니다.');

  const celebs = new Map();
  const order = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.every(c => !c || !String(c).trim())) continue;
    const name = (row[col.name] || '').trim();
    const title = (row[col.title] || '').trim();
    if (!name) continue;
    const get = (k) => col[k] >= 0 && row[col[k]] != null ? String(row[col[k]]).trim() : '';
    if (!celebs.has(name)) {
      celebs.set(name, {
        name,
        name_en: get('name_en'),
        img: get('img'),
        books: [],
      });
      order.push(name);
    }
    const c = celebs.get(name);
    if (!c.name_en && get('name_en')) c.name_en = get('name_en');
    if (!c.img && get('img')) c.img = get('img');
    if (!title) continue;
    c.books.push({
      title,
      title_en: get('title_en'),
      author: get('author'),
      author_en: get('author_en'),
      publisher: get('pub'),
      source: get('source'),
      link: get('link'),
      cover: get('cover'),
      comment: get('comment'),
    });
  }

  // 도서를 도서명 → 저자 가나다순으로 정렬 (한국어 우선 로케일 비교)
  for (const c of celebs.values()) sortBooks(c.books);

  State.headers = headers;
  State.col = col;
  State.celebs = celebs;
  State.order = order;
}

/* 한국어 우선 가나다순 정렬: 도서명 1차, 저자 2차. */
function sortBooks(books) {
  const cmp = (x, y) => (x || '').localeCompare(y || '', 'ko-KR', {
    numeric: true, sensitivity: 'base',
  });
  books.sort((a, b) => {
    const t = cmp(a.title, b.title);
    return t !== 0 ? t : cmp(a.author, b.author);
  });
}

/* 모든 셀럽의 도서를 정렬. 순서가 바뀐 셀럽이 1명이라도 있으면 true 반환. */
function sortAllCelebs() {
  let changed = false;
  for (const c of State.celebs.values()) {
    const before = c.books.map(b => b.title + '|' + b.author).join('\n');
    sortBooks(c.books);
    const after = c.books.map(b => b.title + '|' + b.author).join('\n');
    if (before !== after) changed = true;
  }
  return changed;
}

function dumpCsv() {
  const { headers, col, celebs, order } = State;
  const out = [headers.slice()];
  const numCols = headers.length;
  const blank = () => Array(numCols).fill('');

  for (const name of order) {
    const c = celebs.get(name);
    if (!c) continue;
    if (!c.books.length) {
      // celeb with no books: emit one row with celeb fields only (so they survive saves)
      const row = blank();
      row[col.name] = c.name;
      if (col.name_en >= 0) row[col.name_en] = c.name_en || '';
      if (col.img    >= 0) row[col.img]    = c.img    || '';
      out.push(row);
      continue;
    }
    for (const b of c.books) {
      const row = blank();
      row[col.name] = c.name;
      if (col.name_en >= 0) row[col.name_en] = c.name_en || '';
      row[col.title] = b.title || '';
      if (col.title_en  >= 0) row[col.title_en]  = b.title_en  || '';
      row[col.author] = b.author || '';
      if (col.author_en >= 0) row[col.author_en] = b.author_en || '';
      if (col.pub     >= 0) row[col.pub]     = b.publisher || '';
      if (col.source  >= 0) row[col.source]  = b.source    || '';
      if (col.link    >= 0) row[col.link]    = b.link      || '';
      if (col.cover   >= 0) row[col.cover]   = b.cover     || '';
      if (col.img     >= 0) row[col.img]     = c.img       || '';
      if (col.comment >= 0) row[col.comment] = b.comment   || '';
      out.push(row);
    }
  }
  // PapaParse's unparse handles quoting consistently with Python csv module (quote-when-needed).
  return Papa.unparse(out, { newline: '\n' }) + '\n';
}

/* -------------------- GitHub API -------------------- */
const Gh = {
  api(path, init={}) {
    const headers = Object.assign({
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    }, init.headers || {});
    if (Config.token) headers['Authorization'] = 'Bearer ' + Config.token;
    return fetch('https://api.github.com' + path, { ...init, headers });
  },
  async getFile() {
    if (!Config.token) throw new Error('GitHub Token이 설정되지 않았습니다.');
    const url = `/repos/${Config.repo}/contents/${encodeURIComponent(Config.path)}?ref=${encodeURIComponent(Config.branch)}`;
    const r = await this.api(url);
    if (!r.ok) {
      const t = await r.text();
      if (r.status === 403) {
        throw new Error(
          'GitHub 로드 실패 (403): PAT의 Contents 읽기 권한이 없거나 저장소 접근이 빠졌습니다. ' +
          'Fine-grained PAT 재발급 시 이 저장소 + Contents: Read를 포함하세요.'
        );
      }
      if (r.status === 404) {
        throw new Error(`GitHub 로드 실패 (404): repo/branch/path 또는 PAT 저장소 권한 확인. (${Config.repo}@${Config.branch}:${Config.path})`);
      }
      throw new Error(`GitHub 로드 실패 (${r.status}): ${t}`);
    }
    const j = await r.json();
    return { content: b64decodeUtf8(j.content), sha: j.sha };
  },
  async putFile({ content, sha, message }) {
    const url = `/repos/${Config.repo}/contents/${encodeURIComponent(Config.path)}`;
    const body = {
      message,
      content: b64encodeUtf8(content),
      sha,
      branch: Config.branch,
    };
    if (Config.committer) {
      const m = Config.committer.match(/^(.+?)\s*<(.+)>$/);
      if (m) body.committer = body.author = { name: m[1].trim(), email: m[2].trim() };
    }
    const r = await this.api(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const t = await r.text();
      if (r.status === 409 || r.status === 422) {
        throw new Error('저장 실패: 원격 파일이 변경되었습니다. ↻ 불러오기로 동기화 후 다시 시도하세요.');
      }
      if (r.status === 403) {
        throw new Error(
          'GitHub 저장 실패 (403): PAT 권한이 부족합니다. ' +
          'Fine-grained PAT를 재발급하면서 ① 이 저장소 선택 ② Permissions → Contents: Read and write ' +
          '를 반드시 켜주세요. (브랜치 보호 규칙으로 main 직접 푸시가 막혀있을 수도 있음)'
        );
      }
      if (r.status === 404) {
        throw new Error(
          'GitHub 저장 실패 (404): 저장소/브랜치/경로 또는 PAT의 저장소 접근 권한을 확인하세요.'
        );
      }
      throw new Error(`GitHub 저장 실패 (${r.status}): ${t}`);
    }
    const j = await r.json();
    return { sha: j.content.sha };
  },
};

/* -------------------- Aladin API --------------------
 * 호출 순서:
 *  1) JSONP (<script> 태그) — 프록시·CORS·확장 차단 모두 우회. 가장 안정적.
 *     Aladin은 &Callback=xxx 붙이면 xxx({...}); 로 감싸서 응답.
 *  2) 공개 CORS 프록시 (allorigins 등) 순차 시도 — JSONP 실패 시 폴백.
 *
 * Aladin TTB OpenAPI는 등록된 URL과 Referer가 일치할 때만 응답하는데,
 * <script> 태그로 로드하면 브라우저가 favorbook.co.kr Referer를 보내주므로
 * TTBKey가 favorbook.co.kr로 등록돼 있으면 그대로 통과.
 */
const Aladin = {
  // Default proxies to try in order. Each item: [name, prefix, kind].
  // kind: 'wrap' (response is {contents:..., status:...}) or 'raw' (body is upstream body)
  // 공개 프록시는 자주 장애가 나므로 여러 후보 + 자체 Cloudflare Worker(설정 시) 우선.
  DEFAULT_PROXIES: [
    ['allorigins-get',   'https://api.allorigins.win/get?url=',        'wrap'],
    ['corsproxy.io',     'https://corsproxy.io/?url=',                  'raw' ],
    ['cors.lol',         'https://api.cors.lol/?url=',                  'raw' ],
    ['corsproxy.org',    'https://corsproxy.org/?',                     'raw' ],
    ['codetabs',         'https://api.codetabs.com/v1/proxy/?quest=',   'raw' ],
    ['allorigins-raw',   'https://api.allorigins.win/raw?url=',         'raw' ],
    ['thingproxy',       'https://thingproxy.freeboard.io/fetch/',      'raw' ],
  ],
  _baseParams(extra) {
    const p = new URLSearchParams(extra);
    p.set('ttbkey', Config.ttb);
    p.set('output', 'js');
    p.set('Version', '20131101');
    return p;
  },
  _parseAladinBody(text) {
    let s = String(text || '').trim();
    if (!s) throw new Error('빈 응답');
    if (s.endsWith(';')) s = s.slice(0, -1);
    const m = s.match(/^[^({]*\(([\s\S]*)\)\s*$/);
    if (m) s = m[1];
    return JSON.parse(s);
  },
  async _tryProxy(name, prefix, kind, fullUrl) {
    // thingproxy는 URL을 인코딩하지 않고 그대로 붙임 (예외 처리)
    const proxied = name === 'thingproxy'
      ? prefix + fullUrl
      : prefix + encodeURIComponent(fullUrl);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);
    let r;
    try {
      r = await fetch(proxied, { signal: ctrl.signal });
    } catch (e) {
      throw new Error(e.name === 'AbortError' ? 'timeout 12s' : e.message);
    } finally {
      clearTimeout(timer);
    }
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const text = await r.text();
    let body;
    if (kind === 'wrap') {
      let outer;
      try { outer = JSON.parse(text); }
      catch { throw new Error('proxy JSON 파싱 실패'); }
      if (typeof outer.contents !== 'string') throw new Error('contents 필드 없음');
      body = this._parseAladinBody(outer.contents);
    } else {
      body = this._parseAladinBody(text);
    }
    if (body && body.errorCode) throw new Error(`알라딘 ${body.errorCode}: ${body.errorMessage}`);
    return body;
  },
  async _call(fullUrl) {
    if (!Config.ttb) throw new Error('알라딘 TTBKey가 설정되지 않았습니다.');
    console.log('[Aladin] →', fullUrl);

    // 1) JSONP 우선 시도 — 프록시·CORS·브라우저 확장 우회
    // Aladin은 &Callback=xxx 파라미터를 붙이면 xxx({...}); 형태로 감싸서 응답.
    try {
      const body = await this._jsonpCall(fullUrl);
      if (body && body.errorCode) {
        throw new Error(`알라딘 ${body.errorCode}: ${body.errorMessage}`);
      }
      console.log('[Aladin] ✓ JSONP (프록시 없이 직접)');
      return body;
    } catch (e) {
      console.warn('[Aladin] ✗ JSONP:', e.message);
    }

    // 2) 폴백: 프록시 목록
    const list = [];
    if (Config.corsProxy) {
      list.push(['user(wrap)', Config.corsProxy, 'wrap']);
      list.push(['user(raw)',  Config.corsProxy, 'raw']);
    }
    list.push(...this.DEFAULT_PROXIES);

    const errors = [];
    for (const [name, prefix, kind] of list) {
      try {
        const r = await this._tryProxy(name, prefix, kind, fullUrl);
        console.log(`[Aladin] ✓ ${name}`);
        return r;
      } catch (e) {
        console.warn(`[Aladin] ✗ ${name}: ${e.message}`);
        errors.push(`${name}: ${e.message}`);
      }
    }
    throw new Error('모든 프록시 실패 — ' + errors.join(' / '));
  },

  /* JSONP: <script> 태그로 로드해서 콜백 함수로 데이터 수신.
   * 브라우저의 CORS·확장 프록시 차단·네트워크 프록시 모두 우회.
   * Aladin OpenAPI는 &Callback=<fn> 파라미터로 JSONP 지원. */
  _jsonpCall(fullUrl) {
    return new Promise((resolve, reject) => {
      const cbName = '_aladin_cb_' + Math.random().toString(36).slice(2, 10);
      const sep = fullUrl.includes('?') ? '&' : '?';
      // Callback 파라미터 붙이기 (중복 방지)
      const cleanUrl = fullUrl.replace(/&?Callback=[^&]*/gi, '');
      const src = cleanUrl + sep + 'Callback=' + cbName;
      const script = document.createElement('script');
      const cleanup = () => {
        clearTimeout(timer);
        try { delete window[cbName]; } catch { window[cbName] = undefined; }
        if (script.parentNode) script.parentNode.removeChild(script);
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('JSONP timeout 10s'));
      }, 10000);
      window[cbName] = (data) => {
        cleanup();
        resolve(data);
      };
      script.onerror = () => {
        cleanup();
        reject(new Error('script load failed (CSP/network/블록됨)'));
      };
      script.src = src;
      document.head.appendChild(script);
    });
  },
  async search(query, start = 1, maxResults = 5) {
    const p = this._baseParams({
      Query: query,
      QueryType: 'Keyword',
      MaxResults: String(maxResults),
      start: String(start),
      SearchTarget: 'Book',
      Cover: 'Big',
    });
    const r = await this._call('https://www.aladin.co.kr/ttb/api/ItemSearch.aspx?' + p);
    return {
      items: (r && r.item) || [],
      total: Number(r && r.totalResults) || 0,
    };
  },
  parseItemId(input) {
    const s = String(input || '').trim();
    const m = s.match(/ItemId=(\d+)/i);
    if (m) return m[1];
    if (/^\d+$/.test(s)) return s;
    return null;
  },
  async lookup(itemId) {
    const id = this.parseItemId(itemId) || itemId;
    const p = this._baseParams({
      itemIdType: 'ItemId',
      ItemId: id,
      Cover: 'Big',
    });
    const r = await this._call('https://www.aladin.co.kr/ttb/api/ItemLookUp.aspx?' + p);
    return (r && r.item && r.item[0]) || null;
  },
  bigCover(item) {
    const c = item && item.cover;
    if (!c) return '';
    return c
      .replace(/\/cover(?:150|200|s|sum)\//, '/cover500/')
      .replace('coversum', 'cover500');
  },
};

/* -------------------- 영문 자동채움 (Google Books / Wikipedia / Wikidata)
 * 모두 CORS 허용 API라 브라우저에서 직접 호출 가능.
 * enrich_en.py와 동일한 룰을 포팅. */
const EnEnrich = {
  async _json(url) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    try {
      const r = await fetch(url, { signal: ctrl.signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } finally { clearTimeout(t); }
  },

  async bookEn(title_ko, author_ko) {
    const q = ['intitle:' + title_ko];
    if (author_ko) q.push('inauthor:' + author_ko);
    const u1 = new URL('https://www.googleapis.com/books/v1/volumes');
    u1.searchParams.set('q', q.join(' '));
    u1.searchParams.set('langRestrict', 'en');
    u1.searchParams.set('maxResults', '5');
    try {
      const d = await this._json(u1);
      for (const it of (d.items || [])) {
        const info = it.volumeInfo || {};
        if (info.language !== 'en') continue;
        if (!info.title) continue;
        const t = info.subtitle ? `${info.title}: ${info.subtitle}` : info.title;
        const a = (info.authors || []).join(', ') || null;
        return { title_en: t, author_en: a, source: 'google_books' };
      }
    } catch (e) { console.warn('[EnEnrich] google_books fail:', e.message); }

    const u2 = new URL('https://openlibrary.org/search.json');
    u2.searchParams.set('title', title_ko);
    if (author_ko) u2.searchParams.set('author', author_ko);
    u2.searchParams.set('limit', '5');
    try {
      const d = await this._json(u2);
      for (const doc of (d.docs || [])) {
        const t = doc.title;
        if (!t) continue;
        let ascii = 0;
        for (const ch of t) if (ch.charCodeAt(0) < 128) ascii++;
        if (ascii / t.length > 0.85) {
          return { title_en: t, author_en: null, source: 'open_library' };
        }
      }
    } catch (e) { console.warn('[EnEnrich] open_library fail:', e.message); }

    return null;
  },

  /* 한→영 직역. Google Translate 비공식 GTX 엔드포인트 → MyMemory 폴백.
   * 둘 다 CORS 허용, 무인증, 짧은 문장은 거의 항상 응답. */
  async translateKoEn(text) {
    text = String(text || '').trim();
    if (!text) return null;
    // 1) Google Translate (gtx client)
    try {
      const u = new URL('https://translate.googleapis.com/translate_a/single');
      u.searchParams.set('client', 'gtx');
      u.searchParams.set('sl', 'ko');
      u.searchParams.set('tl', 'en');
      u.searchParams.set('dt', 't');
      u.searchParams.set('q', text);
      const d = await this._json(u);
      // 응답 형식: [[[ "translated", "original", null, null, 0 ], ...], ...]
      const parts = (d && d[0]) || [];
      const joined = parts.map(seg => (seg && seg[0]) || '').join('').trim();
      if (joined) return { text: joined, source: 'google_translate' };
    } catch (e) { console.warn('[EnEnrich] google_translate fail:', e.message); }

    // 2) MyMemory (무료, 일별 한도 있음)
    try {
      const u = new URL('https://api.mymemory.translated.net/get');
      u.searchParams.set('q', text);
      u.searchParams.set('langpair', 'ko|en');
      const d = await this._json(u);
      const t = d && d.responseData && d.responseData.translatedText;
      if (t) return { text: String(t).trim(), source: 'mymemory' };
    } catch (e) { console.warn('[EnEnrich] mymemory fail:', e.message); }

    return null;
  },

  async celebEn(name_ko) {
    let base = name_ko;
    let group = '';
    const m = name_ko.match(/^(.+?)\s*\(\s*(.+?)\s*\)\s*$/);
    if (m) { base = m[1].trim(); group = m[2].trim(); }

    const u1 = new URL('https://ko.wikipedia.org/w/api.php');
    u1.searchParams.set('action', 'query');
    u1.searchParams.set('format', 'json');
    u1.searchParams.set('origin', '*');
    u1.searchParams.set('titles', base);
    u1.searchParams.set('prop', 'pageprops');
    u1.searchParams.set('redirects', '1');
    let qid = null;
    try {
      const d = await this._json(u1);
      const pages = ((d.query || {}).pages) || {};
      for (const p of Object.values(pages)) {
        const pp = p.pageprops || {};
        if (pp.wikibase_item) { qid = pp.wikibase_item; break; }
      }
    } catch (e) { console.warn('[EnEnrich] ko.wiki fail:', e.message); }
    if (!qid) return null;

    const u2 = new URL('https://www.wikidata.org/w/api.php');
    u2.searchParams.set('action', 'wbgetentities');
    u2.searchParams.set('format', 'json');
    u2.searchParams.set('origin', '*');
    u2.searchParams.set('ids', qid);
    u2.searchParams.set('props', 'labels');
    u2.searchParams.set('languages', 'en');
    try {
      const d = await this._json(u2);
      const entity = (d.entities || {})[qid] || {};
      let label = ((entity.labels || {}).en || {}).value;
      if (!label) return null;
      if (group && !label.includes(group)) label = `${label} (${group})`;
      return { name_en: label, source: 'wikidata' };
    } catch (e) { console.warn('[EnEnrich] wikidata fail:', e.message); }
    return null;
  },
};

/* -------------------- Render: Sidebar -------------------- */
function applyFilter(name) {
  const c = State.celebs.get(name);
  if (!c) return false;
  const f = $('#filterSelect').value;
  if (f === 'missing-en')    return !c.name_en || c.books.some(b => !b.title_en || !b.author_en);
  if (f === 'missing-cover') return c.books.some(b => !b.cover);
  if (f === 'missing-img')   return !c.img;
  return true;
}
function renderSidebar() {
  const q = $('#searchInput').value.trim().toLowerCase();
  const ul = $('#celebList');
  const matches = (name) => {
    if (!q) return true;
    if (name.toLowerCase().includes(q)) return true;
    const c = State.celebs.get(name);
    if ((c.name_en || '').toLowerCase().includes(q)) return true;
    return c.books.some(b =>
      (b.title || '').toLowerCase().includes(q) ||
      (b.title_en || '').toLowerCase().includes(q) ||
      (b.author || '').toLowerCase().includes(q));
  };
  let html = '';
  let nCelebs = 0, nBooks = 0, nEn = 0, nEnTotal = 0;
  for (const name of State.order) {
    const c = State.celebs.get(name);
    nCelebs++;
    nBooks += c.books.length;
    for (const b of c.books) {
      nEnTotal += 2; // title_en + author_en
      if (b.title_en) nEn++;
      if (b.author_en) nEn++;
    }
    if (!matches(name) || !applyFilter(name)) continue;
    const warnEn = !c.name_en || c.books.some(b => !b.title_en || !b.author_en);
    const warnImg = !c.img;
    html += `<li data-name="${esc(name)}" class="${name === State.selected ? 'active' : ''}">
      <div class="ci-name">
        ${esc(name)}
        ${warnImg ? '<span class="ci-warn" title="이미지 누락">📷</span>' : ''}
        ${warnEn ? '<span class="ci-warn" title="영문명 누락">EN</span>' : ''}
        <div class="ci-en">${esc(c.name_en || '')}</div>
      </div>
      <span class="ci-count">${c.books.length}</span>
    </li>`;
  }
  ul.innerHTML = html || '<li class="muted" style="padding:14px;text-align:center;">검색 결과 없음</li>';

  $('#countCelebs').textContent = nCelebs;
  $('#countBooks').textContent = nBooks;
  $('#countEn').textContent = nEnTotal ? Math.round(nEn / nEnTotal * 100) + '%' : '-';
}

$('#celebList').addEventListener('click', (e) => {
  const li = e.target.closest('li[data-name]');
  if (!li) return;
  selectCeleb(li.dataset.name);
});

$('#searchInput').addEventListener('input', renderSidebar);
$('#filterSelect').addEventListener('change', renderSidebar);

/* -------------------- Render: Detail -------------------- */
function selectCeleb(name) {
  State.selected = name;
  renderSidebar();
  renderDetail();
}

function renderDetail() {
  const name = State.selected;
  if (!name || !State.celebs.has(name)) {
    $('#detailEmpty').classList.remove('hidden');
    $('#detailContent').classList.add('hidden');
    return;
  }
  $('#detailEmpty').classList.add('hidden');
  $('#detailContent').classList.remove('hidden');
  const c = State.celebs.get(name);
  $('#celebName').value = c.name;
  $('#celebNameEn').value = c.name_en || '';
  $('#celebImg').value = c.img || '';
  $('#celebImgPreview').src = c.img || '';
  $('#bookCount').textContent = `(${c.books.length}권)`;
  renderBooks();
}

function renderBooks() {
  const c = State.celebs.get(State.selected);
  const list = $('#booksList');
  if (!c || !c.books.length) {
    list.innerHTML = '<p class="muted">아직 추천 도서가 없습니다. 우측 상단 <b>+ 책 추가</b>로 등록하세요.</p>';
    return;
  }
  let html = '';
  c.books.forEach((b, i) => {
    const flagEn = (!b.title_en || !b.author_en) ? '<span class="flag warn">EN 누락</span>' : '';
    const flagCv = !b.cover ? '<span class="flag warn">표지 없음</span>' : '';
    const flagSrc = !b.source ? '<span class="flag warn">출처 없음</span>' : '';
    html += `<div class="book-card" data-idx="${i}">
      <div class="cv">${b.cover ? `<img src="${esc(b.cover)}" referrerpolicy="no-referrer" alt="">` : ''}</div>
      <div class="meta">
        <p class="b-title">${esc(b.title)}</p>
        <p class="b-author">${esc(b.author)} ${b.author_en ? `<span class="muted">/ ${esc(b.author_en)}</span>` : ''}</p>
        <p class="b-pub">${esc(b.publisher || '')}</p>
        <div class="b-flags">${flagEn}${flagCv}${flagSrc}</div>
        <div class="actions">
          <button class="btn small" data-act="edit">편집</button>
          ${b.link ? `<a class="btn small" href="${esc(b.link)}" target="_blank" rel="noopener">알라딘</a>` : ''}
          <button class="btn small danger" data-act="del">삭제</button>
        </div>
      </div>
    </div>`;
  });
  list.innerHTML = html;
}

$('#booksList').addEventListener('click', (e) => {
  const card = e.target.closest('.book-card'); if (!card) return;
  const idx = parseInt(card.dataset.idx, 10);
  const act = e.target.dataset.act;
  const c = State.celebs.get(State.selected);
  if (act === 'edit') openBookDialog(c.books[idx], idx);
  if (act === 'del') {
    if (!confirm(`"${c.books[idx].title}" 책을 삭제하시겠습니까?`)) return;
    c.books.splice(idx, 1);
    setDirty(true);
    renderDetail(); renderSidebar();
  }
});

/* Celeb-level field changes */
['celebName', 'celebNameEn', 'celebImg'].forEach(id => {
  $('#' + id).addEventListener('change', () => {
    const old = State.selected;
    const c = State.celebs.get(old);
    if (!c) return;
    const newName = $('#celebName').value.trim();
    const newEn = $('#celebNameEn').value.trim();
    const newImg = $('#celebImg').value.trim();
    if (!newName) { toast('연예인 이름은 비울 수 없습니다.', 'err'); $('#celebName').value = c.name; return; }
    if (newName !== old) {
      if (State.celebs.has(newName)) { toast('이미 존재하는 이름입니다.', 'err'); $('#celebName').value = c.name; return; }
      // rename: keep order position
      State.celebs.delete(old);
      c.name = newName;
      State.celebs.set(newName, c);
      const i = State.order.indexOf(old);
      if (i >= 0) State.order[i] = newName;
      State.selected = newName;
    }
    c.name_en = newEn;
    c.img = newImg;
    $('#celebImgPreview').src = newImg || '';
    setDirty(true);
    renderSidebar();
  });
});

$('#deleteCelebBtn').addEventListener('click', () => {
  const name = State.selected; if (!name) return;
  if (!confirm(`"${name}" 연예인과 모든 추천 도서를 삭제하시겠습니까?`)) return;
  State.celebs.delete(name);
  State.order = State.order.filter(n => n !== name);
  State.selected = null;
  setDirty(true);
  renderDetail(); renderSidebar();
});

$('#renameApplyBtn').addEventListener('click', () => {
  setDirty(true);
  toast('적용됨 (저장하면 모든 행에 반영됩니다)', 'ok');
});

$('#celebNameTranslateBtn').addEventListener('click', async (e) => {
  const name = $('#celebName').value.trim();
  if (!name) { toast('연예인 이름이 비어있음', 'err'); return; }
  e.target.disabled = true;
  const prev = e.target.textContent;
  e.target.textContent = '번역 중…';
  try {
    const r = await EnEnrich.translateKoEn(name);
    if (!r || !r.text) { toast('번역 결과를 얻지 못했습니다', 'err'); return; }
    const cased = toTitleCase(r.text);
    const marked = /\*\s*$/.test(cased) ? cased : (cased + ' *');
    $('#celebNameEn').value = marked;
    $('#celebNameEn').dispatchEvent(new Event('change'));
    toast(`직역 적용 (${r.source}): ${cased}`, 'ok');
  } catch (err) {
    toast('번역 실패: ' + err.message, 'err');
  } finally {
    e.target.disabled = false;
    e.target.textContent = prev;
  }
});

$('#celebNameEnAuto').addEventListener('click', async (e) => {
  const name = $('#celebName').value.trim();
  if (!name) { toast('연예인 이름이 비어있음', 'err'); return; }
  e.target.disabled = true;
  const prev = e.target.textContent;
  e.target.textContent = '조회 중…';
  try {
    const r = await EnEnrich.celebEn(name);
    if (!r || !r.name_en) {
      toast('영문명을 찾지 못했습니다 (Wikipedia에 페이지 없음)', 'err');
      return;
    }
    $('#celebNameEn').value = r.name_en;
    $('#celebNameEn').dispatchEvent(new Event('change'));
    toast(`적용됨 (${r.source}): ${r.name_en}`, 'ok');
  } catch (err) {
    toast('자동채움 실패: ' + err.message, 'err');
  } finally {
    e.target.disabled = false;
    e.target.textContent = prev;
  }
});

$('#addCelebBtn').addEventListener('click', () => {
  const name = prompt('새 연예인 이름 (한글)');
  if (!name) return;
  const t = name.trim();
  if (!t) return;
  if (State.celebs.has(t)) { toast('이미 존재합니다', 'err'); return; }
  State.celebs.set(t, { name: t, name_en: '', img: '', books: [] });
  State.order.push(t);
  setDirty(true);
  selectCeleb(t);
});

$('#addBookBtn').addEventListener('click', () => {
  if (!State.selected) return;
  openBookDialog(null, null);
});

/* -------------------- Book dialog -------------------- */
const bookDlg = $('#bookDialog');
function openBookDialog(book, index) {
  State.bookEditing = { celebName: State.selected, bookIndex: index };
  $('#bookDialogTitle').textContent = book ? '책 편집' : '책 추가';
  const fields = {
    bookTitle: book?.title, bookTitleEn: book?.title_en,
    bookAuthor: book?.author, bookAuthorEn: book?.author_en,
    bookPublisher: book?.publisher, bookSource: book?.source,
    bookLink: book?.link, bookCover: book?.cover,
    bookComment: book?.comment,
  };
  for (const [id, v] of Object.entries(fields)) $('#' + id).value = v || '';
  $('#bookCoverPreview').src = book?.cover || '';
  $('#aladinResults').innerHTML = '';
  $('#aladinQuery').value = book?.title || '';
  $('#aladinItemId').value = book?.link || '';
  bookDlg.showModal();
}

$$('[data-close]').forEach(b => b.addEventListener('click', (e) => {
  e.target.closest('dialog').close();
}));

$('#bookCover').addEventListener('input', () => {
  $('#bookCoverPreview').src = $('#bookCover').value || '';
});

$('#bookForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const title = $('#bookTitle').value.trim();
  const author = $('#bookAuthor').value.trim();
  if (!title || !author) { toast('도서명과 저자는 필수', 'err'); return; }
  const data = {
    title,
    title_en: $('#bookTitleEn').value.trim(),
    author,
    author_en: $('#bookAuthorEn').value.trim(),
    publisher: $('#bookPublisher').value.trim(),
    source: $('#bookSource').value.trim(),
    link: $('#bookLink').value.trim(),
    cover: $('#bookCover').value.trim(),
    comment: $('#bookComment').value.trim(),
  };
  const ed = State.bookEditing;
  const c = State.celebs.get(ed.celebName);
  if (ed.bookIndex == null) c.books.push(data);
  else c.books[ed.bookIndex] = data;
  sortBooks(c.books); // 추가/수정 후 자동 정렬
  setDirty(true);
  bookDlg.close();
  renderDetail(); renderSidebar();
});

/* Aladin search inside dialog — paginated 5 at a time */
const PAGE_SIZE = 5;
function renderAladinResults(box) {
  const items = box._items || [];
  const more = (box._total || 0) > items.length;
  let html = '';
  items.forEach((it, i) => {
    const cover = Aladin.bigCover(it);
    html += `<div class="ar-item" data-i="${i}">
      <div class="ar-cover">${cover ? `<img src="${esc(cover)}" referrerpolicy="no-referrer" alt="">` : ''}</div>
      <div class="ar-meta">
        <div class="ar-title">${esc(it.title)}</div>
        <div class="ar-sub">${esc(it.author || '')} · ${esc(it.publisher || '')}</div>
        <div class="ar-sub muted">${esc(it.pubDate || '')} · ItemId ${it.itemId}</div>
      </div>
    </div>`;
  });
  if (more) {
    const remaining = box._total - items.length;
    html += `<button type="button" id="aladinMoreBtn" class="btn small" style="display:block;width:100%;margin:6px 0;">+ 더 보기 (${remaining}건 남음)</button>`;
  }
  box.innerHTML = html;
}

async function runAladinSearch(query, append = false) {
  const box = $('#aladinResults');
  if (!append) {
    box.innerHTML = '<div class="empty">검색 중…</div>';
    box._query = query;
    box._start = 1;
    box._items = [];
    box._total = 0;
  } else {
    const old = box.querySelector('#aladinMoreBtn');
    if (old) { old.disabled = true; old.textContent = '불러오는 중…'; }
  }
  try {
    const { items, total } = await Aladin.search(box._query, box._start, PAGE_SIZE);
    box._items = (box._items || []).concat(items);
    box._start += items.length;
    box._total = total || box._items.length;
    if (!box._items.length) {
      box.innerHTML = '<div class="empty">결과 없음</div>';
      return;
    }
    renderAladinResults(box);
  } catch (err) {
    if (!append) box.innerHTML = `<div class="empty">${esc(err.message)}</div>`;
    else {
      const old = box.querySelector('#aladinMoreBtn');
      if (old) { old.disabled = false; old.textContent = '+ 더 보기 (재시도)'; }
      toast(err.message, 'err');
    }
  }
}
/* 알라딘 author 필드는 '무라카미 하루키 (지은이), 홍길동 (옮긴이)' 형태.
 * 역할 표기 삭제 + '옮긴이/편집자'는 제외해 저자만 남김. */
function cleanAladinAuthor(s) {
  if (!s) return '';
  const parts = String(s).split(/\s*,\s*/);
  const authors = parts
    .filter(p => !/\(옮긴이|편집|편저|엮은이|그림|사진|감수|번역\)/.test(p))
    .map(p => p.replace(/\s*\([^)]*\)\s*/g, '').trim())
    .filter(Boolean);
  return authors.length ? authors.join(', ') : String(s).replace(/\s*\([^)]*\)\s*/g, '').trim();
}

function applyAladinItem(it) {
  const cover = Aladin.bigCover(it);
  $('#bookTitle').value = it.title || $('#bookTitle').value;
  $('#bookAuthor').value = cleanAladinAuthor(it.author) || $('#bookAuthor').value;
  $('#bookPublisher').value = it.publisher || $('#bookPublisher').value;
  $('#bookLink').value = it.link || $('#bookLink').value;
  if (cover) $('#bookCover').value = cover;
  $('#bookCoverPreview').src = cover || '';
}

$('#aladinSearchBtn').addEventListener('click', () => {
  const q = $('#aladinQuery').value.trim();
  if (q) runAladinSearch(q);
});
$('#aladinQuery').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); $('#aladinSearchBtn').click(); }
});
$('#aladinResults').addEventListener('click', (e) => {
  if (e.target.id === 'aladinMoreBtn') {
    const box = $('#aladinResults');
    if (box._query) runAladinSearch(box._query, true);
    return;
  }
  const row = e.target.closest('.ar-item'); if (!row) return;
  const items = $('#aladinResults')._items || [];
  const it = items[+row.dataset.i];
  if (it) applyAladinItem(it);
});
$('#aladinLookupBtn').addEventListener('click', async () => {
  const id = Aladin.parseItemId($('#aladinItemId').value);
  if (!id) { toast('ItemId 또는 알라딘 URL을 입력하세요', 'err'); return; }
  try {
    const it = await Aladin.lookup(id);
    if (!it) { toast('해당 ItemId의 책을 찾지 못했습니다', 'err'); return; }
    applyAladinItem(it);
    toast('알라딘 정보 적용됨', 'ok');
  } catch (err) {
    toast(err.message, 'err');
  }
});

/* '🔎 알라딘' 버튼 — 현재 제목·저자로 알라딘 검색을 새 탭으로 오픈.
 * ItemId가 있는 알라딘 URL을 사용자가 복사해 옆 필드에 붙여넣는 방식.
 * 알라딘 API 호출 안 함 → 프록시 문제 무관. */
$('#openAladinBtn').addEventListener('click', () => {
  const t = $('#bookTitle').value.trim();
  const a = $('#bookAuthor').value.trim();
  if (!t) { toast('먼저 제목을 채우세요', 'err'); return; }
  const q = [t, a].filter(Boolean).join(' ');
  const u = new URL('https://www.aladin.co.kr/search/wsearchresult.aspx');
  u.searchParams.set('SearchTarget', 'Book');
  u.searchParams.set('SearchWord', q);
  window.open(u.toString(), '_blank', 'noopener');
});

/* -------------------- ⚡ 빠른 검색: Google Books + Open Library --------------------
 * 두 CORS 허용 API를 순차 호출. 프록시·JSONP 불필요.
 *  1) Google Books — 커버율 최고, 하지만 무키 하루 쿼터 낮음 (429 rate limit)
 *  2) Open Library — 폴백, CORS 허용, 쿼터 널널 */
const QuickBooks = {
  _cache: new Map(),  // query → items (같은 쿼리 반복 시 API 안 부름)

  /* Google Books thumbnail: zoom=1(작음) → zoom=0(큼) + HTTPS + edge=curl 제거 */
  _upgradeGBCover(url) {
    if (!url) return '';
    let u = url.replace(/^http:/, 'https:');
    u = u.replace(/&edge=curl/g, '').replace(/&zoom=\d+/g, '&zoom=0');
    if (!/[?&]zoom=/.test(u)) u += (u.includes('?') ? '&' : '?') + 'zoom=0';
    return u;
  },
  _isbn13(idents) {
    const list = idents || [];
    const t = list.find(x => x.type === 'ISBN_13') || list.find(x => x.type === 'ISBN_10');
    return t ? t.identifier.replace(/[^0-9Xx]/g, '') : '';
  },
  async _searchGBooks(query, maxResults) {
    const u = new URL('https://www.googleapis.com/books/v1/volumes');
    u.searchParams.set('q', query);
    u.searchParams.set('maxResults', String(maxResults));
    u.searchParams.set('printType', 'books');
    const r = await fetch(u.toString());
    if (!r.ok) throw new Error(`Google Books HTTP ${r.status}`);
    const d = await r.json();
    return (d.items || []).map(it => {
      const v = it.volumeInfo || {};
      const t = v.subtitle ? `${v.title}: ${v.subtitle}` : v.title;
      const img = (v.imageLinks || {});
      return {
        title: t || '',
        author: (v.authors || []).join(', '),
        lang: v.language || '',
        year: (v.publishedDate || '').slice(0, 4),
        cover: this._upgradeGBCover(img.thumbnail || img.smallThumbnail || ''),
        isbn: this._isbn13(v.industryIdentifiers),
        source: 'GB',
      };
    }).filter(x => x.title);
  },
  async _searchOpenLibrary(query, maxResults) {
    const u = new URL('https://openlibrary.org/search.json');
    u.searchParams.set('q', query);
    u.searchParams.set('limit', String(maxResults));
    u.searchParams.set('fields', 'title,author_name,first_publish_year,cover_i,language,isbn');
    const r = await fetch(u.toString());
    if (!r.ok) throw new Error(`Open Library HTTP ${r.status}`);
    const d = await r.json();
    return (d.docs || []).map(doc => ({
      title: doc.title || '',
      author: (doc.author_name || []).join(', '),
      lang: (doc.language || []).join(',').slice(0, 20),
      year: doc.first_publish_year ? String(doc.first_publish_year) : '',
      cover: doc.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg` : '',
      isbn: (doc.isbn && doc.isbn[0]) || '',
      source: 'OL',
    })).filter(x => x.title);
  },
  async search(query, maxResults = 8) {
    const key = query.trim().toLowerCase();
    if (this._cache.has(key)) return this._cache.get(key);

    let errs = [];
    try {
      const items = await this._searchGBooks(query, maxResults);
      if (items.length) { this._cache.set(key, items); return items; }
    } catch (e) {
      errs.push(`Google Books: ${e.message}`);
      console.warn('[QuickBooks] GB fail:', e.message);
    }

    try {
      const items = await this._searchOpenLibrary(query, maxResults);
      if (items.length) { this._cache.set(key, items); return items; }
    } catch (e) {
      errs.push(`Open Library: ${e.message}`);
      console.warn('[QuickBooks] OL fail:', e.message);
    }

    if (errs.length) throw new Error(errs.join(' / '));
    return [];
  },
};
// 하위 호환 (기존 참조 유지)
const GBooks = QuickBooks;

function renderGBooksResults(box, items) {
  if (!items.length) { box.innerHTML = '<div class="empty">결과 없음. 알라딘 검색이나 수동 입력을 이용하세요.</div>'; return; }
  box.innerHTML = items.map((it, i) => `
    <div class="ar-item" data-gi="${i}">
      <div class="ar-cover">${it.cover ? `<img src="${esc(it.cover)}" referrerpolicy="no-referrer" alt="">` : ''}</div>
      <div class="ar-meta">
        <div class="ar-title">${esc(it.title)} ${it.source ? `<span class="muted" style="font-size:10px;">[${esc(it.source)}]</span>` : ''}</div>
        <div class="ar-sub">${esc(it.author || '(저자 없음)')}${it.year ? ` · ${esc(it.year)}` : ''}${it.lang ? ` <span class="muted">[${esc(it.lang)}]</span>` : ''}</div>
        ${it.isbn ? `<div class="ar-sub muted">ISBN ${esc(it.isbn)}</div>` : ''}
      </div>
    </div>
  `).join('');
  box._items = items;
}

$('#gbSearchBtn').addEventListener('click', async () => {
  const q = $('#gbQuery').value.trim();
  if (!q) return;
  const box = $('#gbResults');
  box.innerHTML = '<div class="empty">검색 중…</div>';
  try {
    const items = await GBooks.search(q);
    renderGBooksResults(box, items);
  } catch (err) {
    box.innerHTML = `<div class="empty">${esc(err.message)}</div>`;
  }
});

$('#gbQuery').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); $('#gbSearchBtn').click(); }
});

$('#gbResults').addEventListener('click', (e) => {
  const row = e.target.closest('.ar-item');
  if (!row) return;
  const items = $('#gbResults')._items || [];
  const it = items[+row.dataset.gi];
  if (!it) return;
  // 제목·저자·표지만 채움 (알라딘 링크는 별도 워크플로우로 처리)
  $('#bookTitle').value = it.title;
  $('#bookAuthor').value = it.author;
  if (it.cover) {
    $('#bookCover').value = it.cover;
    $('#bookCoverPreview').src = it.cover;
  }
  // 알라딘 검색을 편하게 하도록 검색어 필드에 제목+저자 미리 넣어둠
  $('#aladinQuery').value = [it.title, it.author].filter(Boolean).join(' ');
  toast(`반영: ${it.title}${it.cover ? ' + 표지' : ''}`, 'ok');
});

$('#bookTranslateBtn').addEventListener('click', async (e) => {
  const t = $('#bookTitle').value.trim();
  if (!t) { toast('한글 도서명이 비어있음', 'err'); return; }
  e.target.disabled = true;
  const prev = e.target.textContent;
  e.target.textContent = '번역 중…';
  try {
    const r = await EnEnrich.translateKoEn(t);
    if (!r || !r.text) {
      toast('번역 결과를 얻지 못했습니다', 'err');
      return;
    }
    // 책 제목: 단어 첫 글자 대문자 + 직역 표시 *
    const cased = toTitleCase(r.text);
    const marked = /\*\s*$/.test(cased) ? cased : (cased + ' *');
    $('#bookTitleEn').value = marked;
    toast(`직역 적용 (${r.source}): ${cased}`, 'ok');
  } catch (err) {
    toast('번역 실패: ' + err.message, 'err');
  } finally {
    e.target.disabled = false;
    e.target.textContent = prev;
  }
});

$('#bookAuthorTranslateBtn').addEventListener('click', async (e) => {
  const a = $('#bookAuthor').value.trim();
  if (!a) { toast('한글 저자명이 비어있음', 'err'); return; }
  e.target.disabled = true;
  const prev = e.target.textContent;
  e.target.textContent = '번역 중…';
  try {
    const r = await EnEnrich.translateKoEn(a);
    if (!r || !r.text) { toast('번역 결과를 얻지 못했습니다', 'err'); return; }
    const cased = fixKoreanNameOrder(a, toTitleCase(r.text));
    const marked = /\*\s*$/.test(cased) ? cased : (cased + ' *');
    $('#bookAuthorEn').value = marked;
    toast(`직역 적용 (${r.source}): ${cased}`, 'ok');
  } catch (err) {
    toast('번역 실패: ' + err.message, 'err');
  } finally {
    e.target.disabled = false;
    e.target.textContent = prev;
  }
});

$('#bookAuthorEnAutoBtn').addEventListener('click', async (e) => {
  const a = $('#bookAuthor').value.trim();
  if (!a) { toast('한글 저자명이 비어있음', 'err'); return; }
  e.target.disabled = true;
  const prev = e.target.textContent;
  e.target.textContent = '조회 중…';
  try {
    // 저자도 인물이므로 celebEn (Wikipedia → Wikidata) 그대로 사용
    const r = await EnEnrich.celebEn(a);
    if (!r || !r.name_en) {
      toast('저자 영문명을 찾지 못했습니다 (Wikipedia에 페이지 없음)', 'err');
      return;
    }
    // 위 함수는 그룹 표기를 괄호로 붙이는데, 저자명엔 불필요 → 괄호 제거
    let cleaned = r.name_en.replace(/\s*\([^)]*\)\s*$/, '').trim();
    cleaned = fixKoreanNameOrder(a, cleaned);
    $('#bookAuthorEn').value = cleaned;
    toast(`적용됨 (${r.source}): ${cleaned}`, 'ok');
  } catch (err) {
    toast('자동채움 실패: ' + err.message, 'err');
  } finally {
    e.target.disabled = false;
    e.target.textContent = prev;
  }
});

$('#bookEnAutoBtn').addEventListener('click', async (e) => {
  const t = $('#bookTitle').value.trim();
  const a = $('#bookAuthor').value.trim();
  if (!t) { toast('한글 도서명이 비어있음', 'err'); return; }
  e.target.disabled = true;
  const prev = e.target.textContent;
  e.target.textContent = '조회 중…';
  try {
    const r = await EnEnrich.bookEn(t, a);
    if (!r) { toast('영문판 정보를 찾지 못했습니다', 'err'); return; }
    if (r.title_en) $('#bookTitleEn').value = r.title_en;
    if (r.author_en && !$('#bookAuthorEn').value.trim()) {
      $('#bookAuthorEn').value = fixKoreanNameOrder(a, r.author_en);
    }
    toast(`적용됨 (${r.source})`, 'ok');
  } catch (err) {
    toast('자동채움 실패: ' + err.message, 'err');
  } finally {
    e.target.disabled = false;
    e.target.textContent = prev;
  }
});

/* -------------------- Settings dialog -------------------- */
const settingsDlg = $('#settingsDialog');
function loadSettingsToForm() {
  $('#cfgRepo').value = Config.repo;
  $('#cfgBranch').value = Config.branch;
  $('#cfgPath').value = Config.path;
  $('#cfgToken').value = Config.token;
  $('#cfgTtb').value = Config.ttb;
  $('#cfgCorsProxy').value = Config.corsProxy;
  $('#cfgCommitter').value = Config.committer;
}
$('#settingsBtn').addEventListener('click', () => { loadSettingsToForm(); settingsDlg.showModal(); });
$('#saveSettingsBtn').addEventListener('click', () => {
  LS.set('repo', $('#cfgRepo').value.trim());
  LS.set('branch', $('#cfgBranch').value.trim());
  LS.set('path', $('#cfgPath').value.trim() || 'data.csv');
  LS.set('token', $('#cfgToken').value.trim());
  LS.set('ttb', $('#cfgTtb').value.trim());
  LS.set('corsProxy', $('#cfgCorsProxy').value.trim());
  LS.set('committer', $('#cfgCommitter').value.trim());
  $('#branchTag').textContent = `${Config.repo} @ ${Config.branch}`;
  toast('설정 저장됨', 'ok');
  settingsDlg.close();
});

/* -------------------- Load / Save -------------------- */
async function reloadFromGithub() {
  if (State.dirty && !confirm('미저장 변경이 있습니다. 그래도 다시 불러오시겠습니까?')) return;
  setStatus('GitHub에서 불러오는 중…');
  try {
    const { content, sha } = await Gh.getFile();
    loadCsv(content);
    State.originalSha = sha;
    State.selected = null;
    setDirty(false);
    setStatus(`로드 완료 · ${State.celebs.size}명, sha ${sha.slice(0,7)}`);
    renderSidebar(); renderDetail();
    toast('불러오기 완료', 'ok');
  } catch (err) {
    setStatus('');
    toast(err.message, 'err');
  }
}

async function saveToGithub() {
  if (!State.dirty) return;
  if (!Config.token) { toast('GitHub Token을 먼저 설정하세요', 'err'); settingsDlg.showModal(); return; }
  const content = dumpCsv();
  const message = prompt('커밋 메시지', `편집기에서 데이터 업데이트 (${new Date().toISOString().slice(0,16).replace('T',' ')})`);
  if (!message) return;
  setStatus('GitHub에 저장 중…');
  $('#saveBtn').disabled = true;
  try {
    const { sha } = await Gh.putFile({ content, sha: State.originalSha, message });
    State.originalSha = sha;
    setDirty(false);
    setStatus(`저장 완료 · sha ${sha.slice(0,7)}`);
    toast('저장됨 (커밋 + push 완료)', 'ok');
  } catch (err) {
    setStatus('');
    setDirty(true);
    toast(err.message, 'err');
  }
}

$('#reloadBtn').addEventListener('click', reloadFromGithub);
$('#saveBtn').addEventListener('click', saveToGithub);
$('#sortBtn').addEventListener('click', () => {
  const changed = sortAllCelebs();
  if (!changed) {
    toast('이미 모든 도서가 가나다순으로 정렬되어 있습니다', 'ok');
    return;
  }
  setDirty(true);
  renderDetail();
  toast('정렬 완료 — 저장하면 CSV에 반영됩니다', 'ok');
});

/* -------------------- Missing-EN modal -------------------- */
const missingDlg = $('#missingDialog');
let _missingState = { celebs: [], books: [] };

function collectMissing() {
  const celebs = [];
  const books  = [];
  for (const name of State.order) {
    const c = State.celebs.get(name);
    if (!c) continue;
    if (!c.name_en) celebs.push({ name });
    c.books.forEach((b, i) => {
      if (!b.title_en || !b.author_en) {
        books.push({
          celebName: name, bookIndex: i,
          title: b.title || '', author: b.author || '',
          existing_title_en: b.title_en || '',
          existing_author_en: b.author_en || '',
        });
      }
    });
  }
  return { celebs, books };
}

function renderMissingDialog() {
  _missingState = collectMissing();
  const { celebs, books } = _missingState;
  $('#missCelebsCount').textContent = `(${celebs.length}명)`;
  $('#missBooksCount').textContent  = `(${books.length}권)`;

  const cbody = $('#missCelebsTable tbody');
  cbody.innerHTML = celebs.length
    ? celebs.map((row, i) =>
        `<tr><td>${esc(row.name)}</td>` +
        `<td><input data-celeb-i="${i}" type="text" placeholder="영문명"></td></tr>`
      ).join('')
    : '<tr><td colspan="2" class="muted" style="text-align:center;padding:14px;">누락 없음</td></tr>';

  const bbody = $('#missBooksTable tbody');
  bbody.innerHTML = books.length
    ? books.map((row, i) =>
        `<tr>
          <td>${esc(row.celebName)}</td>
          <td>${esc(row.title)}</td>
          <td>${esc(row.author)}</td>
          <td><input data-book-i="${i}" data-field="title_en" value="${esc(row.existing_title_en)}" type="text" placeholder="${row.existing_title_en ? '' : '영문 제목'}"></td>
          <td><input data-book-i="${i}" data-field="author_en" value="${esc(row.existing_author_en)}" type="text" placeholder="${row.existing_author_en ? '' : '영문 저자'}"></td>
        </tr>`
      ).join('')
    : '<tr><td colspan="5" class="muted" style="text-align:center;padding:14px;">누락 없음</td></tr>';
  $('#missingStatus').textContent = '';
  $('#missCelebsPaste').value = '';
  $('#missBooksPaste').value = '';
}

$('#missingBtn').addEventListener('click', () => {
  renderMissingDialog();
  missingDlg.showModal();
});

function copyToClipboard(text) { return navigator.clipboard.writeText(text); }

$('#missCelebsCopyBtn').addEventListener('click', async () => {
  const tsv = _missingState.celebs.map(r => r.name).join('\n');
  try { await copyToClipboard(tsv); toast(`${_missingState.celebs.length}건 복사됨`, 'ok'); }
  catch (e) { toast('복사 실패: ' + e.message, 'err'); }
});

$('#missBooksCopyBtn').addEventListener('click', async () => {
  const header = '도서명\t저자';
  const lines = _missingState.books.map(r => `${r.title}\t${r.author}`);
  const tsv = [header, ...lines].join('\n');
  try { await copyToClipboard(tsv); toast(`${_missingState.books.length}건 복사됨`, 'ok'); }
  catch (e) { toast('복사 실패: ' + e.message, 'err'); }
});

function parseTsvLines(text) {
  return text.split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l.length > 0 && !/^[\-=|+\s]+$/.test(l))
    .map(l => l.replace(/^\|\s*|\s*\|$/g, ''))
    .map(l => l.split(/\t|\s*\|\s*/).map(c => c.trim()));
}

$('#missCelebsApplyPasteBtn').addEventListener('click', () => {
  const rows = parseTsvLines($('#missCelebsPaste').value);
  let applied = 0;
  const tbody = $('#missCelebsTable tbody');
  const byName = new Map(_missingState.celebs.map((r, i) => [r.name, i]));
  for (const cols of rows) {
    if (cols.length < 2) continue;
    const ko = cols[0];
    const en = cols[cols.length - 1];
    if (!ko || !en) continue;
    const idx = byName.get(ko);
    if (idx == null) continue;
    const inp = tbody.querySelector(`input[data-celeb-i="${idx}"]`);
    if (inp) { inp.value = en; applied++; }
  }
  toast(`${applied}건 적용 (셀럽)`, 'ok');
});

$('#missBooksApplyPasteBtn').addEventListener('click', () => {
  const rows = parseTsvLines($('#missBooksPaste').value);
  let applied = 0;
  const tbody = $('#missBooksTable tbody');
  const keyIdx = new Map(_missingState.books.map((r, i) => [r.title + '\t' + r.author, i]));
  let cursor = 0;
  for (const cols of rows) {
    if (cols.length < 2) continue;
    if (/^도서명$|^title$/i.test(cols[0])) continue;
    let i = null;
    if (cols.length >= 2) {
      const k = cols[0] + '\t' + cols[1];
      if (keyIdx.has(k)) i = keyIdx.get(k);
    }
    if (i == null) {
      if (cursor < _missingState.books.length) { i = cursor++; }
    }
    if (i == null || i >= _missingState.books.length) continue;
    let title_en, author_en;
    if (cols.length >= 4) { title_en = cols[2]; author_en = cols[3]; }
    else { title_en = cols[cols.length - 2]; author_en = cols[cols.length - 1]; }
    const inpT = tbody.querySelector(`input[data-book-i="${i}"][data-field="title_en"]`);
    const inpA = tbody.querySelector(`input[data-book-i="${i}"][data-field="author_en"]`);
    if (inpT && title_en) inpT.value = title_en;
    if (inpA && author_en) inpA.value = author_en;
    applied++;
  }
  toast(`${applied}건 적용 (책)`, 'ok');
});

$('#missingApplyBtn').addEventListener('click', () => {
  const tbodyC = $('#missCelebsTable tbody');
  const tbodyB = $('#missBooksTable tbody');
  let touched = 0;

  tbodyC.querySelectorAll('input[data-celeb-i]').forEach(inp => {
    const v = inp.value.trim();
    if (!v) return;
    const row = _missingState.celebs[parseInt(inp.dataset.celebI, 10)];
    if (!row) return;
    const c = State.celebs.get(row.name);
    if (c && c.name_en !== v) { c.name_en = v; touched++; }
  });
  tbodyB.querySelectorAll('input[data-book-i]').forEach(inp => {
    const v = inp.value.trim();
    if (!v) return;
    const row = _missingState.books[parseInt(inp.dataset.bookI, 10)];
    if (!row) return;
    const c = State.celebs.get(row.celebName);
    if (!c) return;
    const b = c.books[row.bookIndex];
    if (!b) return;
    const f = inp.dataset.field;
    if (b[f] !== v) { b[f] = v; touched++; }
  });

  if (!touched) { toast('변경 없음', 'ok'); return; }
  setDirty(true);
  renderDetail(); renderSidebar();
  toast(`${touched}건 적용됨 — 저장하면 CSV에 반영됩니다`, 'ok');
  missingDlg.close();
});

/* -------------------- Boot -------------------- */
(function init() {
  $('#branchTag').textContent = `${Config.repo} @ ${Config.branch}`;
  if (!Config.token || !Config.ttb) {
    loadSettingsToForm();
    settingsDlg.showModal();
    setStatus('설정을 입력한 뒤 ↻ 불러오기로 시작하세요.');
  } else {
    reloadFromGithub();
  }
})();
