/* Favorbook Editor — single-page editor for data.csv
 * Auth: GitHub PAT in localStorage, commits via Git Data API
 *       (blob → tree → commit → ref). Contents API는 1MB 한도가 있어 못 쓴다.
 */

/* -------------------- Config (localStorage) -------------------- */
const LS = {
  get(k, def = '') { return localStorage.getItem('favoread.' + k) ?? def; },
  set(k, v) { localStorage.setItem('favoread.' + k, v); },
};
const Config = {
  get repo()      { return LS.get('repo', 'hwiruruk/favoread'); },
  get branch()    { return LS.get('branch', 'main'); },
  // 드래프트 브랜치 — data.csv 편집을 사이트에 내보내기 전에 보관하는 곳.
  // 'draft/' 로 시작해야 사이트 재생성 워크플로가 돌지 않는다 (update-sitemap.yml).
  get draftBranch() { return LS.get('draftBranch', 'draft/editor'); },
  get path()      { return LS.get('path', 'data.csv'); },
  get token()     { return LS.get('token'); },
  get committer() { return LS.get('committer'); },
  // 예스24 프록시 Worker URL. API Key는 Worker의 환경변수(secret)에만 있고
  // 여기(브라우저)에는 절대 저장하지 않음 — tools/yes24-proxy/README.md 참고.
  get yes24Proxy() { return LS.get('yes24Proxy'); },
};

/* -------------------- State -------------------- */
const State = {
  headers: [],          // exact header strings from CSV
  col: {},              // canonical name -> index
  celebs: new Map(),    // name -> { name, name_en, img, books:[...] }
  order: [],            // celeb name order (preserves first-appearance ordering)
  baseSha: null,        // 발행 브랜치 data.csv의 blob sha — 지금 편집본이 이 위에서 출발했다
  baseCommit: null,     // 그때 발행 브랜치 끝 커밋 — 새 드래프트 브랜치를 여기서 딴다
  conflicts: [],        // 드래프트와 발행본이 같은 칸을 서로 다르게 고친 곳 (드래프트 값이 이김)
  draftSha: null,       // 드래프트 브랜치 data.csv의 blob sha (드래프트가 없으면 null)
  hasDraft: false,      // 발행 안 된 드래프트가 있음
  published: null,      // 발행본(사이트에 나간 data.csv)을 읽은 것 — 발행 전 바뀐 점 비교용
  selected: null,       // currently selected celeb name
  dirty: false,         // any unsaved change (드래프트에도 아직 안 들어감)
  bookEditing: null,    // { celebName, bookIndex|null }
};

/* 자동 생성 코멘트의 검수 상태 (data/comments.json).
 * 책 카드에서도 상태를 표시해야 해서 State 옆에 둔다 — 실제 UI는
 * 파일 아래쪽 "코멘트 검수" 절에 있다. */
const Cmt = {
  items: new Map(),     // "연예인|도서명" -> { ko, en, source, grade, evidence, note, status }
  sha: null,
  loaded: false,
  dirty: false,
  focus: null,          // 책 목록의 💬 메모로 연 항목 — 이것 하나만 보여준다
  key: (celeb, title) => `${celeb}|${title}`,
  get(celeb, title) { return this.loaded ? this.items.get(this.key(celeb, title)) : null; },
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
  const badge = $('#dirtyBadge');
  badge.classList.toggle('hidden', !v);
  if (v) badge.textContent = '미저장 변경';
  window.onbeforeunload = v ? () => '저장되지 않은 변경이 있습니다.' : null;
  updateDraftUi();
}

/* 드래프트 / 발행 상태를 상단 바에 표시한다.
 *  - 미저장 변경: 아직 어디에도 안 들어간 편집 (새로고침하면 사라짐)
 *  - 드래프트: GitHub 드래프트 브랜치에 보관됨, 사이트에는 아직 안 나감
 *  - 발행: 발행 브랜치(main)에 커밋 → 사이트 재생성 */
function updateDraftUi() {
  $('#saveBtn').disabled = !State.dirty;
  $('#publishBtn').disabled = !(State.dirty || State.hasDraft);
  $('#draftBadge').classList.toggle('hidden', !State.hasDraft);
  $('#branchTag').textContent = `${Config.repo} @ ${Config.branch}` +
    (State.hasDraft ? ` · 드래프트 ${Config.draftBranch}` : '');
}

/* Unicode-safe base64 — GitHub이 내려주는 파일 내용을 푸는 데 쓴다.
 * (올릴 때는 Blob API에 utf-8 문자열을 그대로 보내므로 인코딩이 필요 없다) */
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
  const { headers, col, celebs, order } = parseCsv(text);
  State.headers = headers;
  State.col = col;
  State.celebs = celebs;
  State.order = order;
}

function parseCsv(text) {
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
      // 예전에 저장된 값에도 '저 / 역자'가 남아 있을 수 있어 불러올 때 정리한다
      author: cleanAuthorName(get('author')) || get('author'),
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

  return { headers, col, celebs, order };
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
    // GitHub API의 GET 응답은 Cache-Control: max-age=60 이라, 기본값으로 부르면 브라우저가
    // 60초 전의 브랜치 끝·파일 sha를 돌려준다. 저장 직후 봇이 커밋을 연달아 올리는 이
    // 저장소에서는 그 낡은 값 때문에 '원격이 변경됨'이 거짓으로 뜨므로 캐시를 쓰지 않는다.
    return fetch('https://api.github.com' + path, { cache: 'no-store', ...init, headers });
  },
  async apiJson(path, init) {
    const r = await this.api(path, init);
    if (!r.ok) {
      const t = await r.text();
      const e = new Error(t);
      e.status = r.status;
      throw e;
    }
    return r.json();
  },

  async getFile(path = Config.path, { allowMissing = false, ref = Config.branch } = {}) {
    if (!Config.token) throw new Error('GitHub Token이 설정되지 않았습니다.');
    const url = `/repos/${Config.repo}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(ref)}`;
    const r = await this.api(url);
    if (!r.ok) {
      if (r.status === 404 && allowMissing) return { content: null, sha: null };
      const t = await r.text();
      if (r.status === 403) {
        throw new Error(
          'GitHub 로드 실패 (403): PAT의 Contents 읽기 권한이 없거나 저장소 접근이 빠졌습니다. ' +
          'Fine-grained PAT 재발급 시 이 저장소 + Contents: Read를 포함하세요.'
        );
      }
      if (r.status === 404) {
        throw new Error(`GitHub 로드 실패 (404): repo/branch/path 또는 PAT 저장소 권한 확인. (${Config.repo}@${ref}:${path})`);
      }
      throw new Error(`GitHub 로드 실패 (${r.status}): ${t}`);
    }
    const j = await r.json();
    // Contents API는 1MB를 넘는 파일의 내용을 비워서 준다. 그때는 Blob API로 받는다
    // (Blob API는 100MB까지 지원).
    if (j.encoding === 'base64' && j.content) {
      return { content: b64decodeUtf8(j.content), sha: j.sha };
    }
    const blob = await this.apiJson(`/repos/${Config.repo}/git/blobs/${j.sha}`);
    return { content: b64decodeUtf8(blob.content), sha: j.sha };
  },

  /* 저장은 Git Data API로 한다.
   * Contents API(PUT)는 본문을 base64로 싣는데 1MB 한도가 있어서, data.csv가
   * 그 선을 넘으면 GitHub이 503 "Could not create file"을 돌려준다(크기 얘기가
   * 아니라 헷갈리는 메시지). Blob → Tree → Commit → Ref 순서로 올리면
   * 100MB까지 가능하고, 커밋 하나로 떨어지는 결과는 똑같다. */
  async putFile({ content, sha, message, path = Config.path, branch = Config.branch }) {
    if (!Config.token) throw new Error('GitHub Token이 설정되지 않았습니다.');
    const repo = Config.repo;
    const json = (path, body, method = 'POST') => this.apiJson(path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    let who = null;
    if (Config.committer) {
      const m = Config.committer.match(/^(.+?)\s*<(.+)>$/);
      if (m) who = { name: m[1].trim(), email: m[2].trim() };
    }

    try {
      // 저장 도중 봇(사이트 재생성·영문 제목 후보)이 브랜치를 먼저 옮길 수 있다. 그건 파일
      // 충돌이 아니므로 최신 끝 커밋을 받아 처음부터 다시 만든다. 진짜 충돌(내가 불러온 뒤
      // 이 파일이 바뀜)은 아래 sha 비교에서 걸러지고 재시도하지 않는다.
      for (let attempt = 0; ; attempt++) {
        try {
          // 1. 브랜치 끝 커밋
          const ref = await this.apiJson(`/repos/${repo}/git/ref/heads/${refPath(branch)}`);
          const headSha = ref.object.sha;
          const headCommit = await this.apiJson(`/repos/${repo}/git/commits/${headSha}`);

          // 2. 내가 불러온 뒤로 남이 이 파일을 바꿨는지 확인
          if (sha) {
            const cur = await this.api(
              `/repos/${repo}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(headSha)}`
            );
            if (cur.ok) {
              const curJson = await cur.json();
              if (curJson.sha && curJson.sha !== sha) {
                const e = new Error('저장 실패: 원격 파일이 변경되었습니다. ↻ 불러오기로 동기화 후 다시 시도하세요.');
                e.conflict = true;
                throw e;
              }
            }
          }

          // 3. 내용을 blob으로 올리고 트리·커밋을 만든 뒤 브랜치를 옮긴다
          const blob = await json(`/repos/${repo}/git/blobs`, { content, encoding: 'utf-8' });
          const tree = await json(`/repos/${repo}/git/trees`, {
            base_tree: headCommit.tree.sha,
            tree: [{ path, mode: '100644', type: 'blob', sha: blob.sha }],
          });
          const commitBody = { message, tree: tree.sha, parents: [headSha] };
          if (who) { commitBody.author = who; commitBody.committer = who; }
          const commit = await json(`/repos/${repo}/git/commits`, commitBody);
          await json(`/repos/${repo}/git/refs/heads/${refPath(branch)}`,
            { sha: commit.sha, force: false }, 'PATCH');

          return { sha: blob.sha, commit: commit.sha };
        } catch (e) {
          const raced = e && !e.conflict && (e.status === 409 || e.status === 422);
          if (!raced || attempt >= 3) throw e;
          await new Promise(r => setTimeout(r, 600 * (attempt + 1)));
        }
      }
    } catch (err) {
      if (err && err.status === 403) {
        throw new Error(
          'GitHub 저장 실패 (403): PAT 권한이 부족합니다. ' +
          'Fine-grained PAT를 재발급하면서 ① 이 저장소 선택 ② Permissions → Contents: Read and write ' +
          '를 반드시 켜주세요. (브랜치 보호 규칙으로 main 직접 푸시가 막혀있을 수도 있음)'
        );
      }
      if (err && err.status === 404) {
        throw new Error(
          'GitHub 저장 실패 (404): 저장소/브랜치/경로 또는 PAT의 저장소 접근 권한을 확인하세요.'
        );
      }
      if (err && (err.status === 409 || err.status === 422)) {
        throw new Error('저장 실패: 원격 브랜치가 그새 움직였습니다. ↻ 불러오기로 동기화 후 다시 시도하세요.');
      }
      if (err && err.status) throw new Error(`GitHub 저장 실패 (${err.status}): ${err.message}`);
      throw err;
    }
  },

  /* ---- 드래프트 브랜치 다루기 ---- */

  // 브랜치 끝 커밋 sha. 브랜치가 없으면 null.
  async branchHead(branch) {
    const r = await this.api(`/repos/${Config.repo}/git/ref/heads/${refPath(branch)}`);
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`브랜치 조회 실패 (${r.status}): ${branch}`);
    return (await r.json()).object.sha;
  },
  async createBranch(branch, sha) {
    return this.apiJson(`/repos/${Config.repo}/git/refs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha }),
    });
  },
  async deleteBranch(branch) {
    const r = await this.api(`/repos/${Config.repo}/git/refs/heads/${refPath(branch)}`, { method: 'DELETE' });
    if (!r.ok && r.status !== 404 && r.status !== 422) throw new Error(`브랜치 삭제 실패 (${r.status}): ${branch}`);
  },
  // ref(브랜치·커밋) 시점의 파일 blob sha. 파일이 없으면 null. (내용은 안 푼다)
  async fileShaAt(ref, path = Config.path) {
    const r = await this.api(`/repos/${Config.repo}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(ref)}`);
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`파일 조회 실패 (${r.status}): ${path}@${ref}`);
    return (await r.json()).sha || null;
  },
  // base...head 비교 — ahead_by(드래프트에만 있는 커밋 수)와 갈라진 지점(merge_base_commit)
  async compare(base, head) {
    return this.apiJson(`/repos/${Config.repo}/compare/${refPath(base)}...${refPath(head)}?per_page=1`);
  },
};

// 브랜치 이름의 '/'는 경로 구분자로 남겨야 GitHub API가 알아듣는다 (draft/editor).
function refPath(branch) {
  return String(branch).split('/').map(encodeURIComponent).join('/');
}

/* -------------------- Yes24 API --------------------
 * 책 정보(제목·저자·출판사·표지·상품 링크)를 채우는 유일한 검색. 예스24 Open API는 X-Api-Key
 * 요청 헤더로 인증하는데, 이 방식은 <script> 태그(JSONP)로 못 부르고
 * (커스텀 헤더 불가) 공식 문서도 API Key를 클라이언트 코드에 넣지 말라고
 * 명시한다. 그래서 반드시 Cloudflare Worker(tools/yes24-proxy/)를 거쳐야
 * 하며, API Key는 그 Worker의 환경변수에만 있고 이 편집기·localStorage
 * 어디에도 저장되지 않는다.
 */
const Yes24 = {
  async _call(path, params) {
    if (!Config.yes24Proxy) throw new Error('예스24 프록시 Worker URL이 설정되지 않았습니다. ⚙️ 설정을 확인하세요.');
    const base = Config.yes24Proxy.replace(/\/+$/, '');
    const url = `${base}${path}?${params}`;
    let r;
    try {
      r = await fetch(url);
    } catch (e) {
      throw new Error(`예스24 프록시 호출 실패: ${e.message}`);
    }
    let body;
    try { body = await r.json(); }
    catch { throw new Error(`예스24 응답 파싱 실패 (HTTP ${r.status})`); }
    if (!body || body.success !== true) {
      throw new Error(`예스24 ${body?.errorCode || r.status}: ${body?.message || '알 수 없는 오류'}`);
    }
    return body.data;
  },
  async search(query, page = 1, pageSize = 5) {
    const p = new URLSearchParams({
      query, category: 'BOOK', page: String(page), pageSize: String(pageSize), detail: 'N',
    });
    const d = await this._call('/goods/itemList', p);
    return {
      items: (d && d.items) || [],
      total: Number(d && d.totalCount) || 0,
    };
  },
  /* 예스24 상품 URL(https://www.yes24.com/product/goods/12345678) 또는
   * 순수 숫자(ItemId), 13자리 ISBN을 모두 받아들인다. */
  parseItemId(input) {
    const s = String(input || '').trim();
    const m = s.match(/\/goods\/(\d+)/i);
    if (m) return m[1];
    if (/^\d+$/.test(s)) return s;
    return null;
  },
  async lookup(input) {
    const s = String(input || '').trim();
    const id = this.parseItemId(input) || s;
    const searchType = /^\d{13}$/.test(id) ? 'ISBN13' : 'ItemId';
    const p = new URLSearchParams({ searchType, query: id, detail: 'N' });
    const d = await this._call('/goods/itemDetail', p);
    return (d && d.items && d.items[0]) || null;
  },
  // 예스24 응답의 cover는 이미 큰 이미지(L) URL이라 별도 업그레이드 불필요.
  cover(item) { return (item && item.cover) || ''; },
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

/* -------------------- 중복 도서 --------------------
   책 제목만 본다. 띄어쓰기·문장부호·대소문자 차이는 같은 책으로 친다.
   ("우리는 언젠가 만난다" = "우리는언젠가 만난다") */
function normTitle(t) {
  return String(t || '').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
}
/* 같은 셀럽 안에서 제목이 겹치는 책의 인덱스 집합 */
function dupBookIdx(c) {
  const seen = new Map(), dup = new Set();
  c.books.forEach((b, i) => {
    const k = normTitle(b.title); if (!k) return;
    if (seen.has(k)) { dup.add(seen.get(k)); dup.add(i); } else seen.set(k, i);
  });
  return dup;
}
/* title과 같은 책: 이 셀럽 안(skipIdx 제외)의 책, 그리고 이 책을 가진 다른 셀럽 */
/* 예스24 상품 URL·표지 URL에서 상품 ID를 뽑는다 (없으면 '') */
function yes24GoodsId(url) {
  const m = /yes24\.com\/(?:product\/)?goods\/(?:detail\/)?(\d+)/i.exec(url || '');
  return m ? m[1] : '';
}
/* goodsId를 주면 제목이 달라도(부제·리커버 표기 등) 같은 예스24 상품이면 같은 책으로 본다 */
function findDupTitle(celebName, title, skipIdx, goodsId = '') {
  const k = normTitle(title);
  const out = { same: null, others: [] };
  if (!k && !goodsId) return out;
  for (const [name, c] of State.celebs) {
    c.books.forEach((b, i) => {
      const hit = (k && normTitle(b.title) === k) ||
        (goodsId && (yes24GoodsId(b.link) === goodsId || yes24GoodsId(b.cover) === goodsId));
      if (!hit) return;
      if (name === celebName) { if (i !== skipIdx && !out.same) out.same = b; }
      else if (!out.others.includes(name)) out.others.push(name);
    });
  }
  return out;
}

/* -------------------- Render: Sidebar -------------------- */
function applyFilter(name) {
  const c = State.celebs.get(name);
  if (!c) return false;
  const f = $('#filterSelect').value;
  if (f === 'missing-en')    return !c.name_en || c.books.some(b => !b.title_en || !b.author_en);
  if (f === 'missing-cover') return c.books.some(b => !b.cover);
  if (f === 'missing-img')   return !c.img;
  if (f === 'dup-book')      return dupBookIdx(c).size > 0;
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
  let nCelebs = 0, nBooks = 0, nEn = 0, nEnTotal = 0, nDup = 0;
  for (const name of State.order) {
    const c = State.celebs.get(name);
    nCelebs++;
    nBooks += c.books.length;
    for (const b of c.books) {
      nEnTotal += 2; // title_en + author_en
      if (b.title_en) nEn++;
      if (b.author_en) nEn++;
    }
    const hasDup = dupBookIdx(c).size > 0;
    if (hasDup) nDup++;
    if (!matches(name) || !applyFilter(name)) continue;
    const warnEn = !c.name_en || c.books.some(b => !b.title_en || !b.author_en);
    const warnImg = !c.img;
    html += `<li data-name="${esc(name)}" class="${name === State.selected ? 'active' : ''}">
      <div class="ci-name">
        ${esc(name)}
        ${hasDup ? '<span class="ci-warn dup" title="중복 도서 있음">중복</span>' : ''}
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
  const dupOpt = $('#filterSelect option[value="dup-book"]');
  if (dupOpt) dupOpt.textContent = `중복 도서 (${nDup}명)`;
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

// 출처 칸에는 URL 대신 글이 적힌 경우도 있어서, 링크로 열 수 있는 것만 버튼을 단다
function isHttp(u) { return /^https?:\/\//i.test(String(u || '').trim()); }

function renderBooks() {
  const c = State.celebs.get(State.selected);
  const list = $('#booksList');
  if (!c || !c.books.length) {
    list.innerHTML = '<p class="muted">아직 추천 도서가 없습니다. 우측 상단 <b>+ 책 추가</b>로 등록하세요.</p>';
    return;
  }
  let html = '';
  const dups = dupBookIdx(c);
  if (dups.size) {
    html += `<p class="dup-note">⚠️ 제목이 같은 책이 ${dups.size}권 있어요. 하나만 남기고 삭제하세요.</p>`;
  }
  c.books.forEach((b, i) => {
    const flagDup = dups.has(i) ? '<span class="flag dup">중복</span>' : '';
    const flagEn = (!b.title_en || !b.author_en) ? '<span class="flag warn">EN 누락</span>' : '';
    const flagCv = !b.cover ? '<span class="flag warn">표지 없음</span>' : '';
    const flagSrc = !b.source ? '<span class="flag warn">출처 없음</span>' : '';
    const cs = Cmt.get(State.selected, b.title);
    const flagCmt = !cs ? '' : (
      cs.status === 'approved' ? '<span class="flag ok">💬 코멘트 승인</span>'
      : cs.status === 'rejected' ? '<span class="flag off">💬 코멘트 반려</span>'
      : '<span class="flag warn">💬 코멘트 검수 대기</span>');
    html += `<div class="book-card" data-idx="${i}">
      <div class="cv">${b.cover ? `<img src="${esc(b.cover)}" referrerpolicy="no-referrer" alt="">` : ''}</div>
      <div class="meta">
        <p class="b-title">${esc(b.title)}</p>
        <p class="b-author">${esc(b.author)} ${b.author_en ? `<span class="muted">/ ${esc(b.author_en)}</span>` : ''}</p>
        <p class="b-pub">${esc(b.publisher || '')}</p>
        <div class="b-flags">${flagDup}${flagEn}${flagCv}${flagSrc}${flagCmt}</div>
        <div class="actions">
          <button class="btn small" data-act="edit">편집</button>
          ${isHttp(b.source) ? `<a class="btn small" href="${esc(b.source)}" target="_blank" rel="noopener" title="${esc(b.source)}">출처 열기 ↗</a>` : ''}
          ${b.link ? `<a class="btn small" href="${esc(b.link)}" target="_blank" rel="noopener">알라딘</a>` : ''}
          <button class="btn small" data-act="memo" title="추천 이유 메모를 쓰면 AI가 한 줄로 다듬어 코멘트 검수에 올립니다">💬 메모</button>
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
  if (act === 'memo') openCommentFor(c.name, c.books[idx]);
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
  $('#yes24Results').innerHTML = '';
  $('#yes24Query').value = book?.title || '';
  $('#yes24ItemId').value = book?.link || '';
  clearAutoFilled();
  $('#bookApplyNextBtn').classList.toggle('hidden', !!book);
  updateDupHint();
  bookDlg.showModal();
  if (!book) {
    // 새 책이면 바로 검색어를 칠 수 있게 예스24 검색칸에 커서를 둔다
    $('#yes24Query').focus();
  } else if (book.title && Config.yes24Proxy) {
    // 편집이면 제목으로 미리 검색해 둔다 — 표지·링크를 고칠 때 바로 고를 수 있게
    runYes24Search(book.title);
  }
}

/* 도서명을 입력하는 동안 중복 여부를 바로 알려 준다 */
function updateDupHint() {
  const box = $('#bookDupHint'); if (!box) return;
  const ed = State.bookEditing || {};
  const r = findDupTitle(ed.celebName, $('#bookTitle').value, ed.bookIndex, yes24GoodsId($('#bookLink').value));
  if (r.same) {
    box.className = 'dup-hint err';
    box.textContent = `⚠️ "${r.same.title}" — 이 셀럽에게 이미 등록된 책이에요.`;
  } else if (r.others.length) {
    const names = r.others.slice(0, 5).join(', ') + (r.others.length > 5 ? ` 외 ${r.others.length - 5}명` : '');
    box.className = 'dup-hint info';
    box.textContent = `ℹ️ 다른 셀럽도 등록한 책이에요: ${names}`;
  } else {
    box.className = 'dup-hint hidden';
    box.textContent = '';
  }
}
$('#bookTitle').addEventListener('input', updateDupHint);

$$('[data-close]').forEach(b => b.addEventListener('click', (e) => {
  e.target.closest('dialog').close();
}));

$('#bookCover').addEventListener('input', () => {
  $('#bookCoverPreview').src = $('#bookCover').value || '';
});

/* '적용 + 다음 책'은 type=button — submit으로 두면 입력칸에서 Enter를 칠 때
 * 기본 버튼이 돼 버린다. 눌렀을 때만 표시를 남기고 폼 제출을 대신 건다. */
let bookApplyNext = false;
$('#bookApplyNextBtn').addEventListener('click', () => {
  bookApplyNext = true;
  $('#bookForm').requestSubmit();
  bookApplyNext = false; // 필수 칸이 비어 제출이 막혔을 때도 남지 않게
});

$('#bookForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const applyNext = bookApplyNext;
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
  const dup = findDupTitle(ed.celebName, title, ed.bookIndex, yes24GoodsId(data.link));
  if (dup.same && !confirm(
    `"${dup.same.title}" 책은 ${ed.celebName}에게 이미 등록되어 있어요.\n` +
    `(저자: ${dup.same.author || '-'})\n\n그래도 중복으로 등록할까요?`)) {
    toast('중복 도서라 등록하지 않았어요', 'err');
    return;
  }
  const isNew = ed.bookIndex == null;
  if (isNew) c.books.push(data);
  else c.books[ed.bookIndex] = data;
  sortBooks(c.books); // 추가/수정 후 자동 정렬
  setDirty(true);
  bookDlg.close();
  renderDetail(); renderSidebar();
  // '적용 + 다음 책' — 같은 셀럽에 여러 권을 넣을 때 창을 다시 열 필요 없이 이어서 추가
  if (isNew && applyNext) {
    openBookDialog(null, null);
    toast(`추가됨: ${title} — 다음 책을 검색하세요`, 'ok');
  }
});

/* -------------------- 영문 자동채움 (예스24 결과 선택 직후) --------------------
 * 비어 있는 영문 제목·영문 저자만 백그라운드로 채운다. 이미 적힌 값이나
 * 조회 중에 사용자가 직접 친 값은 덮지 않는다. 채운 칸은 노란 테두리로
 * 표시해 확인을 유도하고, 사용자가 고치면 표시가 사라진다. */
let enAutoSeq = 0;
function markAutoFilled(id, value) {
  const el = $('#' + id);
  el.value = value;
  el.classList.add('auto-filled');
  el.title = '자동으로 채운 값이에요. 맞는지 확인해 주세요.';
}
function clearAutoFilled() {
  enAutoSeq++; // 진행 중인 조회 결과는 버린다
  for (const id of ['bookTitleEn', 'bookAuthorEn']) {
    const el = $('#' + id);
    el.classList.remove('auto-filled');
    el.title = '';
  }
}
for (const id of ['bookTitleEn', 'bookAuthorEn']) {
  $('#' + id).addEventListener('input', (e) => {
    e.target.classList.remove('auto-filled');
    e.target.title = '';
  });
}
async function autoFillEn(title, author) {
  const needTitle = !$('#bookTitleEn').value.trim();
  const needAuthor = !$('#bookAuthorEn').value.trim() && !!author;
  if (!title || (!needTitle && !needAuthor)) return;
  const seq = ++enAutoSeq;
  const stillEmpty = (id) => seq === enAutoSeq && bookDlg.open && !$('#' + id).value.trim();
  const done = [];
  try {
    const [book, person] = await Promise.all([
      EnEnrich.bookEn(title, author).catch(() => null),
      needAuthor ? EnEnrich.celebEn(author).catch(() => null) : null,
    ]);
    if (needTitle && book && book.title_en && stillEmpty('bookTitleEn')) {
      markAutoFilled('bookTitleEn', book.title_en);
      done.push('영문 제목');
    }
    // 저자: 위키(인물) 결과를 우선, 없으면 영문판 정보의 저자
    let authorEn = person && person.name_en
      ? person.name_en.replace(/\s*\([^)]*\)\s*$/, '').trim()
      : (book && book.author_en) || '';
    if (needAuthor && authorEn && stillEmpty('bookAuthorEn')) {
      markAutoFilled('bookAuthorEn', fixKoreanNameOrder(author, authorEn));
      done.push('영문 저자');
    }
  } catch (err) {
    console.warn('[autoFillEn]', err.message);
  }
  if (done.length && seq === enAutoSeq) toast(`${done.join('·')} 자동 채움 — 확인해 주세요`, 'ok');
}

/* -------------------- 저자명 정리 --------------------
 * 서점에서 가져온 저자 문자열에는 역할 표기가 붙어 온다.
 *   알라딘  "신영복 (지은이), 김세현 (그림)"
 *   예스24  "요아힘 마이어호프 저/박종대 역", "문순태,최일남,한승원,박완서 공저"
 * 이걸 지은이만 남기고 정리한다 — '저·지음' 같은 역할 꼬리표는 떼고,
 * 역자·편집자·그림 같은 다른 역할자는 아예 뺀다.
 */
// 이름만 남기고 뺄 역할
const AUTHOR_DROP_ROLES = new Set([
  '옮긴이', '옮김', '번역', '역', '역자', '공역', '편역',
  '엮은이', '엮음', '편집', '편저', '감수', '사진', '삽화', '해설', '그림',
]);
// 지은이 본인 — 꼬리표만 떼고 이름은 남긴다
const AUTHOR_KEEP_ROLES = new Set([
  '저', '저자', '지음', '지은이', '공저', '글', '글그림', '글·그림', '글/그림',
  '쓴이', '씀', '원작',
]);
// 항목 끝에 붙은 역할 꼬리표. 이름 뒤에 공백이나 여는 괄호가 있어야 인정한다
// ('이역' 같은 이름의 끝 글자를 역할로 잘못 읽지 않도록).
const AUTHOR_ROLE_RE = new RegExp(
  '(?:^|[\\s(])\\s*(글\\s*[·/]?\\s*그림|글그림|옮긴이|옮김|지은이|지음|저자|공저|편역|편저|편집|엮은이|엮음|번역|역자|공역|감수|삽화|해설|사진|원작|쓴이|그림|글|저|역|씀)\\s*\\)?\\s*$'
);

function cleanAuthorName(raw) {
  if (!raw) return '';
  const src = String(raw).replace(/\s+/g, ' ').trim();

  // 1) 항목마다 이름과 역할을 떼어 낸다
  const parts = [];
  for (const part of src.split(/\s*[\/,;]\s*/)) {
    let name = part.trim();
    if (!name) continue;
    let role = '';
    // "홍길동 (지은이)"처럼 꼬리표가 겹칠 수 있어 몇 번 벗겨 본다
    for (let i = 0; i < 3; i++) {
      const m = name.match(AUTHOR_ROLE_RE);
      if (!m) break;
      role = m[1].replace(/\s/g, '');
      name = name.slice(0, m.index).trim();
      if (AUTHOR_DROP_ROLES.has(role)) break;
    }
    // 역할 괄호는 위에서 이미 떼어냈다. 남은 괄호는 필명·본명 같은 정보이므로
    // 건드리지 않는다 ('설레다(최민정)' 를 '설레다' 로 줄이지 않기 위해).
    name = name.replace(/\s+/g, ' ').trim();
    if (name) parts.push({ name, role });
  }

  // 2) 역할이 안 적힌 이름은 뒤에 오는 역할을 따른다.
  //    "패트릭 브링리 (지은이), 김희정, 조현주 (옮긴이)" 에서 김희정도 옮긴이다
  //    — 서점들이 같은 역할의 사람을 쉼표로 묶고 마지막에만 역할을 적기 때문.
  let following = '';
  for (let i = parts.length - 1; i >= 0; i--) {
    if (parts[i].role) following = parts[i].role;
    else parts[i].role = following;
  }

  const out = [];
  for (const { name, role } of parts) {
    if (role && AUTHOR_DROP_ROLES.has(role)) continue;
    if (!out.includes(name)) out.push(name);
  }
  // 전부 걸러졌다면(예: 역자만 적힌 경우) 빈 값을 돌려준다.
  // 호출부가 `|| 기존값`으로 받으므로 역자가 저자 칸에 들어가는 일이 없다.
  return out.join(', ');
}

/* Yes24 search inside dialog — paginated 5 at a time */
function renderYes24Results(box) {
  const items = box._items || [];
  const more = (box._total || 0) > items.length;
  let html = '';
  const ed = State.bookEditing || {};
  items.forEach((it, i) => {
    const cover = Yes24.cover(it);
    const dup = findDupTitle(ed.celebName, it.title,
      ed.bookIndex, String(it.itemId || '') || yes24GoodsId(it.link));
    let badge = '';
    if (dup.same) badge = '<span class="ar-badge err">이미 등록</span>';
    else if (dup.others.length) {
      badge = `<span class="ar-badge info" title="${esc(dup.others.join(', '))}">다른 셀럽 ${dup.others.length}명</span>`;
    }
    html += `<div class="ar-item" data-i="${i}">
      <div class="ar-cover">${cover ? `<img src="${esc(cover)}" referrerpolicy="no-referrer" alt="">` : ''}</div>
      <div class="ar-meta">
        <div class="ar-title">${esc(it.title)} ${badge}</div>
        <div class="ar-sub">${esc(it.author || '')} · ${esc(it.publisher || '')}</div>
        <div class="ar-sub muted">${esc(it.publishDate || '')} · ItemId ${it.itemId}</div>
      </div>
    </div>`;
  });
  if (more) {
    const remaining = box._total - items.length;
    html += `<button type="button" id="yes24MoreBtn" class="btn small" style="display:block;width:100%;margin:6px 0;">+ 더 보기 (${remaining}건 남음)</button>`;
  }
  box.innerHTML = html;
}

/* 예스24 프록시가 없으면 오류 문구 대신 할 수 있는 일을 보여 준다:
 * 설정 열기, 또는 같은 검색어로 예스24를 새 탭에서 검색 (API 불필요) */
function renderYes24Setup(box, query) {
  box._query = query;
  box.innerHTML = `<div class="empty">
    예스24 검색을 쓰려면 ⚙️ 설정에 예스24 프록시 Worker URL을 넣어야 해요.
    <div class="row" style="justify-content:center;margin-top:8px;gap:6px;">
      <button type="button" class="btn small primary" data-y24="settings">⚙️ 설정 열기</button>
      <button type="button" class="btn small" data-y24="tab">🔎 예스24 새 탭에서 검색</button>
    </div>
    <div class="muted small" style="margin-top:6px;">새 탭에서 찾은 상품 주소를 아래 '도서 정보' 칸에 붙여넣으면 표지도 자동으로 채워져요.</div>
  </div>`;
}
function openYes24SearchTab(q) {
  const u = new URL('https://www.yes24.com/Product/Search');
  u.searchParams.set('domain', 'BOOK');
  u.searchParams.set('query', q);
  window.open(u.toString(), '_blank', 'noopener');
}

const YES24_PAGE_SIZE = 5;
async function runYes24Search(query, page = 1, append = false) {
  const box = $('#yes24Results');
  if (!Config.yes24Proxy) { renderYes24Setup(box, query); return; }
  if (!append) {
    box.innerHTML = '<div class="empty">검색 중…</div>';
    box._query = query;
    box._page = 1;
    box._items = [];
    box._total = 0;
  } else {
    const old = box.querySelector('#yes24MoreBtn');
    if (old) { old.disabled = true; old.textContent = '불러오는 중…'; }
  }
  try {
    const { items, total } = await Yes24.search(box._query, box._page, YES24_PAGE_SIZE);
    box._items = (box._items || []).concat(items);
    box._page += 1;
    box._total = total || box._items.length;
    if (!box._items.length) {
      box.innerHTML = '<div class="empty">결과 없음</div>';
      return;
    }
    renderYes24Results(box);
  } catch (err) {
    if (!append) box.innerHTML = `<div class="empty">${esc(err.message)}</div>`;
    else {
      const old = box.querySelector('#yes24MoreBtn');
      if (old) { old.disabled = false; old.textContent = '+ 더 보기 (재시도)'; }
      toast(err.message, 'err');
    }
  }
}

function applyYes24Item(it) {
  const cover = Yes24.cover(it);
  $('#bookTitle').value = it.title || $('#bookTitle').value;
  updateDupHint();
  $('#bookAuthor').value = cleanAuthorName(it.author) || $('#bookAuthor').value;
  $('#bookPublisher').value = it.publisher || $('#bookPublisher').value;
  $('#bookLink').value = it.link || $('#bookLink').value;
  if (cover) $('#bookCover').value = cover;
  $('#bookCoverPreview').src = cover || '';
  toast(`반영: ${it.title}${cover ? ' + 표지' : ''}`, 'ok');
  autoFillEn($('#bookTitle').value.trim(), $('#bookAuthor').value.trim());
}

$('#yes24SearchBtn').addEventListener('click', () => {
  const q = $('#yes24Query').value.trim();
  if (q) runYes24Search(q);
});
$('#yes24Query').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); $('#yes24SearchBtn').click(); }
});
$('#yes24Results').addEventListener('click', (e) => {
  const act = e.target.dataset && e.target.dataset.y24;
  if (act === 'settings') { loadSettingsToForm(); settingsDlg.showModal(); return; }
  if (act === 'tab') {
    const q = $('#yes24Results')._query || $('#yes24Query').value.trim() || $('#bookTitle').value.trim();
    if (q) openYes24SearchTab(q); else toast('검색어를 먼저 입력하세요', 'err');
    return;
  }
  if (e.target.id === 'yes24MoreBtn') {
    const box = $('#yes24Results');
    if (box._query) runYes24Search(box._query, box._page, true);
    return;
  }
  const row = e.target.closest('.ar-item'); if (!row) return;
  const items = $('#yes24Results')._items || [];
  const it = items[+row.dataset.i];
  if (it) applyYes24Item(it);
});
$('#yes24LookupBtn').addEventListener('click', async () => {
  const id = Yes24.parseItemId($('#yes24ItemId').value) || $('#yes24ItemId').value.trim();
  if (!id) { toast('ItemId, ISBN13 또는 예스24 URL을 입력하세요', 'err'); return; }
  if (!Config.yes24Proxy) {
    // 상품 URL이면 프록시 없이도 링크·표지는 채울 수 있다
    if (YES24_GOODS_RE.test($('#yes24ItemId').value)) {
      $('#bookLink').value = $('#yes24ItemId').value.trim();
      $('#bookLink').dispatchEvent(new Event('input'));
    }
    renderYes24Setup($('#yes24Results'), $('#yes24Query').value.trim() || $('#bookTitle').value.trim());
    return;
  }
  try {
    const it = await Yes24.lookup(id);
    if (!it) { toast('해당 상품을 찾지 못했습니다', 'err'); return; }
    applyYes24Item(it);
    toast('예스24 정보 적용됨', 'ok');
  } catch (err) {
    toast(err.message, 'err');
  }
});

/* '🔎 예스24' 버튼 — 현재 제목·저자로 예스24 검색을 새 탭으로 오픈.
 * 원하는 상품 URL을 사용자가 복사해 옆 필드에 붙여넣음.
 * 예스24 API 호출 안 함 → Worker 설정 여부와 무관하게 항상 사용 가능. */
$('#openYes24Btn').addEventListener('click', () => {
  const t = $('#bookTitle').value.trim();
  const a = $('#bookAuthor').value.trim();
  if (!t) { toast('먼저 제목을 채우세요', 'err'); return; }
  openYes24SearchTab([t, a].filter(Boolean).join(' '));
});

/* 도서 정보 칸에 예스24 상품 URL을 붙여넣으면
 *  - 추적 파라미터 등을 떼고 https://www.yes24.com/product/goods/<ID> 로 정리하고
 *  - 표지 칸이 비었거나 다른 예스24 표지면 https://image.yes24.com/goods/<ID>/L 로 채운다
 *    (data.csv의 표준 형식). 직접 넣은 다른 표지는 건드리지 않는다. API 호출 없음. */
const YES24_GOODS_RE = /yes24\.com\/product\/goods\/(\d+)/i;
$('#bookLink').addEventListener('input', () => {
  const el = $('#bookLink');
  const m = YES24_GOODS_RE.exec(el.value);
  if (!m) return;
  const link = 'https://www.yes24.com/product/goods/' + m[1];
  if (el.value !== link) el.value = link;
  updateDupHint();
  const cover = 'https://image.yes24.com/goods/' + m[1] + '/L';
  const cur = $('#bookCover').value.trim();
  if (cur === cover || (cur && !/image\.yes24\.com/i.test(cur))) return;
  $('#bookCover').value = cover;
  $('#bookCoverPreview').src = cover;
  toast('예스24 표지를 채웠어요', 'ok');
});

/* '↗ 열기' 버튼 — 출처 칸의 URL을 새 탭으로 열어 원문을 바로 확인한다 */
$('#openSourceBtn').addEventListener('click', () => {
  const u = $('#bookSource').value.trim();
  if (!isHttp(u)) { toast('출처 칸에 http로 시작하는 URL이 없어요', 'err'); return; }
  window.open(u, '_blank', 'noopener');
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

/* 저자 칸에 직접 붙여넣었을 때도 역할 표기를 정리한다.
 * 역할 꼬리표가 없는 평범한 이름은 건드리지 않는다. */
$('#bookAuthor').addEventListener('blur', () => {
  const el = $('#bookAuthor');
  const raw = el.value.trim();
  if (!raw) return;
  const cleaned = cleanAuthorName(raw);
  // 역자만 적혀 빈 값이 나오면 사용자가 직접 고치도록 원문을 남긴다
  if (cleaned && cleaned !== raw) el.value = cleaned;
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
  $('#cfgDraftBranch').value = Config.draftBranch;
  $('#cfgPath').value = Config.path;
  $('#cfgToken').value = Config.token;
  $('#cfgYes24Proxy').value = Config.yes24Proxy;
  $('#cfgCommitter').value = Config.committer;
}
$('#settingsBtn').addEventListener('click', () => { loadSettingsToForm(); settingsDlg.showModal(); });
$('#saveSettingsBtn').addEventListener('click', () => {
  // 드래프트 브랜치는 'draft/'로 시작해야 사이트 재생성 워크플로가 안 돈다
  let draft = $('#cfgDraftBranch').value.trim().replace(/^refs\/heads\//, '') || 'draft/editor';
  if (!draft.startsWith('draft/')) draft = 'draft/' + draft;
  const branch = $('#cfgBranch').value.trim() || 'main';
  if (draft === branch) { toast('드래프트 브랜치는 발행 브랜치와 달라야 합니다', 'err'); return; }
  LS.set('repo', $('#cfgRepo').value.trim());
  LS.set('branch', branch);
  LS.set('draftBranch', draft);
  LS.set('path', $('#cfgPath').value.trim() || 'data.csv');
  LS.set('token', $('#cfgToken').value.trim());
  LS.set('yes24Proxy', $('#cfgYes24Proxy').value.trim().replace(/\/+$/, ''));
  LS.set('committer', $('#cfgCommitter').value.trim());
  updateDraftUi();
  toast('설정 저장됨 — 브랜치를 바꿨다면 ↻ 불러오기를 눌러 주세요', 'ok');
  settingsDlg.close();
});

/* -------------------- Load / Draft / Publish --------------------
 * data.csv 편집은 두 단계로 나간다.
 *  1) 📝 드래프트 저장 — 드래프트 브랜치(기본 draft/editor)에 커밋. 사이트는 그대로다.
 *     다른 컴퓨터·브라우저에서 열어도 ↻ 불러오기 하면 드래프트가 이어서 열린다.
 *  2) 🚀 발행 — 발행본과 비교해 바뀐 점을 보여주고, 확인하면 발행 브랜치(main)에
 *     커밋 하나로 올린다. 그 커밋이 사이트 재생성 워크플로를 돌린다. 드래프트는 지운다.
 * 드래프트 브랜치는 'draft/'로 시작해서 update-sitemap.yml 이 돌지 않는다. */
const stamp = () => new Date().toISOString().slice(0, 16).replace('T', ' ');
// 책 한 권의 칸 (도서명은 짝짓는 열쇠라 뺌) — 발행 전 비교와 병합에 쓴다
const PUB_BOOK_FIELDS = [
  ['title_en', '영문 제목'], ['author', '저자'], ['author_en', '저자 영문'], ['publisher', '출판사'],
  ['source', '출처'], ['link', '도서 정보'], ['cover', '표지'], ['comment', '코멘트'],
];

/* 드래프트 브랜치가 있으면 그 data.csv를 연다. 없으면 null.
 * 드래프트에만 있는 커밋이 없거나 내용이 발행본과 같으면(이미 발행됨) 지운다.
 * 드래프트를 딴 뒤 발행본 data.csv가 바뀌었으면 그때의 발행본(base)도 같이 돌려준다 —
 * 불러오는 쪽이 셀럽·책 단위로 3-way 병합한다. */
async function openDraft(mainSha) {
  const draft = Config.draftBranch;
  if (!draft || draft === Config.branch) return null;
  if (!(await Gh.branchHead(draft))) return null;
  const cmp = await Gh.compare(Config.branch, draft);
  const draftSha = await Gh.fileShaAt(draft);
  if (!cmp.ahead_by || !draftSha || draftSha === mainSha) {
    await Gh.deleteBranch(draft).catch(err => console.warn('지난 드래프트 정리 실패', err));
    return null;
  }
  const { content, sha } = await Gh.getFile(Config.path, { ref: draft });
  const fork = cmp.merge_base_commit.sha;
  const base = (await Gh.fileShaAt(fork)) === mainSha ? null
    : (await Gh.getFile(Config.path, { ref: fork, allowMissing: true })).content;
  return { content, sha, base };
}

/* 셀럽·책·칸 단위 3-way 병합.
 * base = 드래프트를 시작할 때의 발행본, ours = 드래프트(지금 편집본), theirs = 지금 발행본.
 * 한쪽만 바꾼 칸은 그쪽 값을, 양쪽이 같은 칸을 다르게 바꿨으면 드래프트 값을 쓰고
 * conflicts 에 적는다. git merge 는 줄 단위라 붙어 있는 두 셀럽 줄을 각자 고쳐도
 * 충돌로 보는데, 이건 같은 책의 같은 칸일 때만 충돌이다. */
const MERGE_LABEL = { name_en: '영문명', img: '이미지', ...Object.fromEntries(PUB_BOOK_FIELDS) };
function mergeCsv(base, ours, theirs) {
  const conflicts = [];
  const same = (a, b) => (a ?? '') === (b ?? '');
  const bookKeys = PUB_BOOK_FIELDS.map(([k]) => k);
  // 같은 셀럽에 같은 제목이 두 번 있을 수 있어 '제목 + 몇 번째'로 짝짓는다
  const keyed = (books) => {
    const seen = {}, m = new Map();
    for (const b of books || []) m.set(b.title + '\u0000' + (seen[b.title] = (seen[b.title] || 0) + 1), b);
    return m;
  };
  const eqBook = (a, b) => same(a.title, b.title) && bookKeys.every(k => same(a[k], b[k]));
  const eqCeleb = (a, b) => {
    if (!same(a.name_en, b.name_en) || !same(a.img, b.img) || a.books.length !== b.books.length) return false;
    const kb = keyed(b.books);
    return [...keyed(a.books)].every(([k, x]) => kb.has(k) && eqBook(x, kb.get(k)));
  };
  const pick = (b, o, t, where) => {
    if (same(o, t) || same(t, b)) return o;
    if (same(o, b)) return t;
    conflicts.push({ ...where, ours: o ?? '', theirs: t ?? '' });
    return o;
  };
  // 한쪽에만 있거나 한쪽에서 지워진 것: 지운 쪽이 손대지 않은 걸 지웠으면 지운다
  const exist = (b, o, t, eq, where) => {
    if (o && t) return 'both';
    if (!o && !t) return null;
    const one = o || t;
    if (!b) return o ? 'ours' : 'theirs';        // 한쪽이 새로 넣음
    if (eq(b, one)) return null;                // 다른 쪽이 그대로 둔 걸 지움
    conflicts.push({ ...where, field: o ? 'deleted-theirs' : 'deleted-ours' });
    return o ? 'ours' : null;                   // 드래프트 쪽을 따른다
  };

  const celebs = new Map(), order = [];
  const names = new Set([...ours.order, ...theirs.order]);
  for (const name of names) {
    const b = base.celebs.get(name), o = ours.celebs.get(name), t = theirs.celebs.get(name);
    const how = exist(b, o, t, eqCeleb, { celeb: name });
    if (!how) continue;
    if (how !== 'both') { celebs.set(name, how === 'ours' ? o : t); order.push(name); continue; }
    const c = {
      name,
      name_en: pick(b?.name_en, o.name_en, t.name_en, { celeb: name, field: 'name_en' }),
      img: pick(b?.img, o.img, t.img, { celeb: name, field: 'img' }),
      books: [],
    };
    const bb = keyed(b?.books), ob = keyed(o.books), tb = keyed(t.books);
    for (const k of new Set([...ob.keys(), ...tb.keys()])) {
      const x = bb.get(k), y = ob.get(k), z = tb.get(k);
      const title = (y || z).title;
      const bh = exist(x, y, z, eqBook, { celeb: name, title });
      if (!bh) continue;
      if (bh !== 'both') { c.books.push(bh === 'ours' ? y : z); continue; }
      const book = { title };
      for (const f of bookKeys) book[f] = pick(x?.[f], y[f], z[f], { celeb: name, title, field: f });
      c.books.push(book);
    }
    sortBooks(c.books);
    celebs.set(name, c);
    order.push(name);
  }
  return { celebs, order, conflicts };
}

// 발행본이 그새 바뀌었으면 지금 편집본에 합친다. base = 편집본이 출발한 발행본(파싱한 것)
function mergeIntoState(base, theirs) {
  const r = mergeCsv(base, State, theirs);
  State.celebs = r.celebs;
  State.order = r.order;
  if (State.selected && !State.celebs.has(State.selected)) State.selected = null;
  State.conflicts = [...State.conflicts, ...r.conflicts];
  return r;
}

// 병합 뒤 사람이 그 칸을 발행본 값으로 고쳐 놨으면 더는 충돌이 아니다
function liveConflicts() {
  return State.conflicts.filter(c => {
    if (c.field.startsWith('deleted')) return true;
    const cel = State.celebs.get(c.celeb);
    if (!cel) return false;
    const now = c.title ? cel.books.find(b => b.title === c.title)?.[c.field] : cel[c.field];
    return (now ?? '') !== (c.theirs ?? '');
  });
}

function conflictText(c) {
  const where = esc(c.celeb) + (c.title ? ` · ${esc(c.title)}` : '');
  if (c.field === 'deleted-theirs') return `${where} — 발행본에서 지웠지만 드래프트에서 고쳐서 <b>남깁니다</b>`;
  if (c.field === 'deleted-ours') return `${where} — 드래프트에서 지웠지만 발행본에서 고쳐졌습니다. <b>지웁니다</b>`;
  return `${where} · ${esc(MERGE_LABEL[c.field] || c.field)}: 발행본 "${esc(c.theirs)}" 대신 드래프트 "${esc(c.ours)}"`;
}

async function reloadFromGithub({ ask = true } = {}) {
  if (ask && State.dirty && !confirm('미저장 변경이 있습니다. 그래도 다시 불러오시겠습니까?')) return;
  setStatus('GitHub에서 불러오는 중…');
  try {
    const head = await Gh.branchHead(Config.branch);
    if (!head) throw new Error(`발행 브랜치를 찾지 못했습니다: ${Config.repo}@${Config.branch}`);
    const main = await Gh.getFile(Config.path, { ref: head });
    const draft = await openDraft(main.sha);
    loadCsv(draft ? draft.content : main.content);
    State.published = parseCsv(main.content);
    State.baseSha = main.sha;
    State.baseCommit = head;
    State.draftSha = draft ? draft.sha : null;
    State.hasDraft = !!draft;
    State.conflicts = [];
    // 드래프트를 딴 뒤 발행본이 바뀌었으면 그 변경을 드래프트에 합쳐서 연다
    const merged = draft?.base != null ? mergeIntoState(parseCsv(draft.base), State.published) : null;
    State.selected = null;
    setDirty(false);
    const nPub = draft ? diffFromPublished().length : 0;
    setStatus(draft
      ? `드래프트 불러옴 · ${State.celebs.size}명 · 발행 안 된 셀럽 ${nPub}명`
      : `로드 완료 · ${State.celebs.size}명, sha ${main.sha.slice(0,7)}`);
    const nTtl = await syncTitlesToBooks();
    renderSidebar(); renderDetail();
    if (State.conflicts.length) {
      toast(`드래프트와 발행본이 같은 곳을 다르게 고친 데가 ${State.conflicts.length}건 있습니다 — 🚀 발행 창에서 확인하세요`, 'err');
    } else {
      toast((draft ? '발행 안 된 드래프트를 불러왔습니다' : '불러오기 완료') +
        (merged ? ' — 그새 발행된 변경도 합쳤습니다' : '') +
        (nTtl ? ` — 검수한 영문 제목·저자 ${nTtl}건을 도서명_en·저자_en에 반영했습니다 (드래프트 저장·발행하면 data.csv에도 반영)` : ''), 'ok');
    }
  } catch (err) {
    setStatus('');
    toast(err.message, 'err');
  }
}

/* 📝 드래프트 저장 — 사이트에는 안 나간다 */
async function saveDraft({ quiet = false } = {}) {
  if (!State.dirty) return true;
  if (!Config.token) { toast('GitHub Token을 먼저 설정하세요', 'err'); settingsDlg.showModal(); return false; }
  const draft = Config.draftBranch;
  if (!draft || draft === Config.branch) {
    toast('⚙️ 설정에서 드래프트 브랜치를 발행 브랜치와 다르게 정하세요', 'err');
    return false;
  }
  const content = dumpCsv();
  const message = `드래프트 저장 (${stamp()}) — ${summarizeDiff(diffFromPublished())}`;
  setStatus('드래프트 저장 중…');
  $('#saveBtn').disabled = true;
  let created = false;
  try {
    let sha = State.draftSha;
    if (!State.hasDraft) {
      if (await Gh.branchHead(draft)) {
        throw new Error('그새 다른 곳에서 드래프트가 저장됐습니다. ↻ 불러오기로 그 드래프트를 연 뒤 다시 고쳐 주세요.');
      }
      // 불러왔던 발행본 커밋에서 딴다 — 그새 발행본이 바뀌었어도 드래프트는 내가 본 것 위에
      // 쌓이고, 발행할 때 git merge로 합쳐진다
      await Gh.createBranch(draft, State.baseCommit);
      created = true;
      sha = State.baseSha;
    }
    const r = await Gh.putFile({ content, sha, message, branch: draft });
    State.draftSha = r.sha;
    State.hasDraft = true;
    setDirty(false);
    setStatus(`드래프트 저장됨 · ${stamp()} · 사이트에는 아직 안 나감`);
    if (!quiet) toast('드래프트에 저장됨 — 🚀 발행을 눌러야 사이트에 반영됩니다', 'ok');
    return true;
  } catch (err) {
    if (created) await Gh.deleteBranch(draft).catch(() => {});
    setStatus('');
    setDirty(true);
    toast(err.message, 'err');
    return false;
  }
}

/* 발행본 → 지금 편집본에서 바뀐 점. 발행 창에 보여주고 커밋 메시지에도 쓴다. */
function diffFromPublished() {
  const pub = State.published;
  if (!pub) return [];
  const byTitle = (books) => new Map((books || []).map(b => [b.title, b]));
  const names = new Set([...State.order.filter(n => State.celebs.has(n)), ...pub.order]);
  const out = [];
  for (const name of names) {
    const now = State.celebs.get(name), was = pub.celebs.get(name);
    const ent = { name, kind: !was ? 'add' : !now ? 'del' : 'mod', fields: [], books: [] };
    if (now && was) {
      if ((now.name_en || '') !== (was.name_en || '')) ent.fields.push(`영문명 ${was.name_en || '(빈칸)'} → ${now.name_en || '(빈칸)'}`);
      if ((now.img || '') !== (was.img || '')) ent.fields.push('이미지 변경');
    }
    const nb = byTitle(now?.books), wb = byTitle(was?.books);
    for (const [t, b] of nb) {
      const o = wb.get(t);
      if (!o) { ent.books.push({ kind: 'add', title: t, author: b.author }); continue; }
      const changed = PUB_BOOK_FIELDS.filter(([k]) => (b[k] || '') !== (o[k] || '')).map(([, l]) => l);
      if (changed.length) ent.books.push({ kind: 'mod', title: t, author: b.author, changed });
    }
    for (const [t, b] of wb) if (!nb.has(t)) ent.books.push({ kind: 'del', title: t, author: b.author });
    if (ent.kind !== 'mod' || ent.fields.length || ent.books.length) out.push(ent);
  }
  return out;
}

function diffCounts(d) {
  const n = { add: 0, del: 0, mod: 0 };
  for (const e of d) for (const b of e.books) n[b.kind]++;
  return n;
}

// "카리나(에스파) 외 2명 · 책 +3 −1 ✎2"
function summarizeDiff(d) {
  if (!d.length) return '내용 변경 없음';
  const n = diffCounts(d);
  const books = [n.add && `+${n.add}`, n.del && `−${n.del}`, n.mod && `✎${n.mod}`].filter(Boolean).join(' ');
  return d[0].name + (d.length > 1 ? ` 외 ${d.length - 1}명` : '') + (books ? ` · 책 ${books}` : '');
}

const publishDlg = $('#publishDialog');
function setPubStatus(msg) { $('#pubStatus').textContent = msg || ''; }

function renderPublishDialog() {
  const d = diffFromPublished();
  const n = diffCounts(d);
  const conflicts = liveConflicts();
  $('#pubConflict').classList.toggle('hidden', !conflicts.length);
  $('#pubConflictList').innerHTML = conflicts.map(c => `<li>${conflictText(c)}</li>`).join('');
  $('#pubState').textContent = State.dirty
    ? (State.hasDraft ? '드래프트 + 아직 드래프트에도 안 넣은 변경' : '아직 드래프트에도 안 넣은 변경')
    : '드래프트에 저장된 변경';
  $('#pubSummary').innerHTML = d.length
    ? `셀럽 <b>${d.length}</b>명 · 책 추가 <b>${n.add}</b> · 삭제 <b>${n.del}</b> · 수정 <b>${n.mod}</b>`
    : '발행본과 내용 차이가 없습니다 (정렬·형식만 다를 수 있어요)';
  const SHOW = 300;
  const tag = { add: '<span class="pub-tag add">새 셀럽</span>', del: '<span class="pub-tag del">셀럽 삭제</span>', mod: '' };
  const mark = { add: '＋', del: '－', mod: '✎' };
  $('#pubList').innerHTML = d.slice(0, SHOW).map(e => {
    const lines = e.kind === 'del'
      ? [`<li class="del">책 ${e.books.length}권 함께 빠짐</li>`]
      : [
          ...e.fields.map(f => `<li class="mod">✎ ${esc(f)}</li>`),
          ...e.books.map(b => `<li class="${b.kind}">${mark[b.kind]} ${esc(b.title)}` +
            (b.author ? ` <span class="muted">— ${esc(b.author)}</span>` : '') +
            (b.changed ? ` <span class="muted">(${esc(b.changed.join(', '))})</span>` : '') + '</li>'),
        ];
    const name = e.kind === 'del' ? `<b>${esc(e.name)}</b>`
      : `<a href="#" data-celeb="${esc(e.name)}"><b>${esc(e.name)}</b></a>`;
    return `<li>${name} ${tag[e.kind]}<ul>${lines.join('')}</ul></li>`;
  }).join('') + (d.length > SHOW ? `<li class="muted">… 외 ${d.length - SHOW}명</li>` : '');
  if (!$('#pubMessage').value) $('#pubMessage').value = `편집기에서 발행 (${stamp()}) — ${summarizeDiff(d)}`;
  $('#pubConfirmBtn').textContent = conflicts.length ? '⚠️ 확인했고 발행' : '🚀 발행';
  $('#pubConfirmBtn').disabled = !(State.dirty || State.hasDraft);
  $('#pubDraftBtn').classList.toggle('hidden', !State.dirty);
  $('#discardDraftBtn').classList.toggle('hidden', !(State.dirty || State.hasDraft));
}

function openPublishDialog() {
  if (!State.dirty && !State.hasDraft) { toast('발행할 변경이 없습니다', 'ok'); return; }
  $('#pubMessage').value = '';
  setPubStatus('');
  renderPublishDialog();
  publishDlg.showModal();
}

/* 🚀 발행 — 드래프트에 먼저 보관하고, 그새 발행본이 바뀌었으면 편집본에 합친 뒤,
 * 그 내용을 발행 브랜치에 커밋 하나로 올린다. */
async function publish() {
  if (!Config.token) { toast('GitHub Token을 먼저 설정하세요', 'err'); settingsDlg.showModal(); return; }
  const nConflict = liveConflicts().length;
  if (nConflict && !confirm(
    `발행본과 같은 곳을 다르게 고친 ${nConflict}건은 드래프트 값으로 발행됩니다. 계속할까요?`)) return;
  const btn = $('#pubConfirmBtn');
  btn.disabled = true;
  try {
    // 1. 드래프트에 보관 — 발행이 중간에 실패해도 편집한 게 남는다
    if (State.dirty) {
      setPubStatus('드래프트에 보관하는 중…');
      if (!(await saveDraft({ quiet: true }))) { setPubStatus(''); return; }
    }
    const message = $('#pubMessage').value.trim() || `편집기에서 발행 (${stamp()})`;

    // 2. 그새 발행본이 바뀌었으면(다른 사람 발행, 봇 PR 머지) 편집본에 합친다
    const head = await Gh.branchHead(Config.branch);
    const main = await Gh.getFile(Config.path, { ref: head });
    if (main.sha !== State.baseSha) {
      setPubStatus('그새 바뀐 발행본을 합치는 중…');
      const theirs = parseCsv(main.content);
      const r = mergeIntoState(State.published, theirs);
      State.published = theirs;
      State.baseSha = main.sha;
      State.baseCommit = head;
      renderSidebar(); renderDetail();
      if (r.conflicts.length) {
        // 새로 생긴 충돌은 사람이 보고 다시 누르게 한다
        setDirty(true);
        renderPublishDialog();
        setPubStatus('');
        toast(`그새 발행된 변경과 같은 곳을 다르게 고친 데가 ${r.conflicts.length}건 있습니다 — 확인 후 다시 누르세요`, 'err');
        return;
      }
    }

    // 3. 발행 브랜치에 커밋
    setPubStatus('발행하는 중…');
    const content = dumpCsv();
    const r = await Gh.putFile({ content, sha: main.sha, message, branch: Config.branch });
    await Gh.deleteBranch(Config.draftBranch).catch(err => console.warn('드래프트 브랜치 삭제 실패', err));
    State.published = parseCsv(content);
    State.baseSha = r.sha;
    State.baseCommit = r.commit;
    State.draftSha = null;
    State.hasDraft = false;
    State.conflicts = [];
    setDirty(false);
    setStatus(`발행 완료 · sha ${r.sha.slice(0,7)}`);
    publishDlg.close();
    toast('발행됨 — 사이트는 몇 분 뒤 다시 빌드됩니다', 'ok');
  } catch (err) {
    setPubStatus('');
    toast(err.message, 'err');
  } finally {
    btn.disabled = !(State.dirty || State.hasDraft);
  }
}

/* 드래프트 버리기 — 드래프트 브랜치를 지우고 발행본을 다시 연다 */
async function discardDraft() {
  if (!confirm('드래프트를 버리고 지금 사이트에 나간 발행본으로 되돌릴까요?\n' +
    '드래프트에 저장한 내용과 미저장 변경이 모두 사라집니다.')) return;
  try {
    if (State.hasDraft) await Gh.deleteBranch(Config.draftBranch);
    State.hasDraft = false;
    State.draftSha = null;
    State.conflicts = [];
    setDirty(false);
    publishDlg.close();
    await reloadFromGithub({ ask: false });
  } catch (err) {
    toast(err.message, 'err');
  }
}

$('#reloadBtn').addEventListener('click', () => reloadFromGithub());
$('#saveBtn').addEventListener('click', () => saveDraft());
$('#publishBtn').addEventListener('click', openPublishDialog);
$('#draftBadge').addEventListener('click', openPublishDialog);
$('#pubConfirmBtn').addEventListener('click', publish);
$('#pubDraftBtn').addEventListener('click', async () => {
  if (await saveDraft()) renderPublishDialog();
});
$('#discardDraftBtn').addEventListener('click', discardDraft);
$('#pubList').addEventListener('click', (e) => {
  const a = e.target.closest('a[data-celeb]');
  if (!a) return;
  e.preventDefault();
  publishDlg.close();
  selectCeleb(a.dataset.celeb);
});
// Ctrl+S (맥은 Cmd+S) — 드래프트 저장
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 's') {
    e.preventDefault();
    if (State.dirty) saveDraft();
  }
});
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
/* -------------------- Featured ("요즘 핫한 사람") --------------------
 * 메인 index.html 상단에 한 줄로 고정 노출할 인물 목록.
 * data.csv와 섞지 않고 data/featured.json 이라는 별도 파일로 관리한다 —
 * 큐레이션은 데이터가 아니라 편집자의 선택이고, 저장 주기도 다르기 때문.
 * 이 창의 저장 버튼은 data.csv와 무관하게 이 파일만 따로 커밋한다. */
const FEATURED_PATH = 'data/featured.json';
const FEATURED_MAX  = 12;

const featuredDlg = $('#featuredDialog');
let _featured = { title: '', subtitle: '', picks: [], sha: null, loaded: false };

function setFeaturedStatus(msg) { $('#featuredStatus').textContent = msg || ''; }

async function openFeaturedDialog() {
  if (!Config.token) { toast('GitHub Token을 먼저 설정하세요', 'err'); settingsDlg.showModal(); return; }
  if (!State.celebs.size) { toast('먼저 ↻ 불러오기로 CSV를 가져오세요', 'err'); return; }

  if (!_featured.loaded) {
    setFeaturedStatus('불러오는 중…');
    featuredDlg.showModal();
    try {
      const { content, sha } = await Gh.getFile(FEATURED_PATH, { allowMissing: true });
      if (content) {
        const j = JSON.parse(content);
        _featured.title    = j.title || '';
        _featured.subtitle = j.subtitle || '';
        _featured.picks    = (j.picks || []).map(x => (
          typeof x === 'string'
            ? { name: x, badge: '', note: '' }
            : { name: x.name || '', badge: x.badge || '', note: x.note || '' }
        )).filter(x => x.name);
      }
      _featured.sha = sha;
      _featured.loaded = true;
      setFeaturedStatus(sha ? `sha ${sha.slice(0, 7)}` : '새 파일로 생성됩니다');
    } catch (err) {
      setFeaturedStatus('');
      toast('고정 목록 불러오기 실패: ' + err.message, 'err');
      return;
    }
  } else {
    featuredDlg.showModal();
  }

  $('#featuredTitle').value    = _featured.title;
  $('#featuredSubtitle').value = _featured.subtitle;
  $('#featuredSearch').value   = '';
  renderFeaturedPicks();
  renderFeaturedResults('');
}

function renderFeaturedPicks() {
  const ul = $('#featuredPicks');
  $('#featuredCount').textContent =
    `${_featured.picks.length}명 / 최대 ${FEATURED_MAX}명 (데스크톱 한 줄 = 6명)`;

  if (!_featured.picks.length) {
    ul.innerHTML = '<li class="muted small">아직 고정한 사람이 없습니다. 아래에서 검색해 추가하세요. ' +
                   '비워두면 메인에서 섹션 전체가 숨겨집니다.</li>';
    return;
  }

  ul.innerHTML = _featured.picks.map((p, i) => {
    const c = State.celebs.get(p.name);
    const missing = c ? '' : ' <span class="badge">데이터에 없는 이름</span>';
    const books = c ? `${c.books.length}권` : '—';
    return `
      <li class="featured-pick" data-i="${i}">
        <span class="featured-pick-rank">${i + 1}</span>
        <img class="featured-pick-img" src="${esc(c?.img || '')}" alt="" referrerpolicy="no-referrer">
        <span class="featured-pick-name">${esc(p.name)}${missing}
          <span class="muted small">${books}</span>
        </span>
        <input class="featured-pick-badge" type="text" maxlength="8"
               placeholder="뱃지" value="${esc(p.badge)}" data-i="${i}">
        <button type="button" class="btn small" data-fup="${i}" ${i === 0 ? 'disabled' : ''}>↑</button>
        <button type="button" class="btn small" data-fdown="${i}" ${i === _featured.picks.length - 1 ? 'disabled' : ''}>↓</button>
        <button type="button" class="btn small danger" data-fdel="${i}">삭제</button>
      </li>`;
  }).join('');

  ul.querySelectorAll('[data-fup]').forEach(b => b.addEventListener('click', () => {
    const i = +b.dataset.fup;
    [_featured.picks[i - 1], _featured.picks[i]] = [_featured.picks[i], _featured.picks[i - 1]];
    renderFeaturedPicks();
  }));
  ul.querySelectorAll('[data-fdown]').forEach(b => b.addEventListener('click', () => {
    const i = +b.dataset.fdown;
    [_featured.picks[i + 1], _featured.picks[i]] = [_featured.picks[i], _featured.picks[i + 1]];
    renderFeaturedPicks();
  }));
  ul.querySelectorAll('[data-fdel]').forEach(b => b.addEventListener('click', () => {
    _featured.picks.splice(+b.dataset.fdel, 1);
    renderFeaturedPicks();
    renderFeaturedResults($('#featuredSearch').value);
  }));
  ul.querySelectorAll('.featured-pick-badge').forEach(inp => inp.addEventListener('input', () => {
    _featured.picks[+inp.dataset.i].badge = inp.value.trim();
  }));
}

function renderFeaturedResults(query) {
  const box = $('#featuredResults');
  const q = (query || '').trim().toLowerCase();
  const picked = new Set(_featured.picks.map(p => p.name));

  const hits = State.order
    .filter(n => !picked.has(n))
    .filter(n => !q || n.toLowerCase().includes(q)
              || (State.celebs.get(n)?.name_en || '').toLowerCase().includes(q))
    .slice(0, 40);

  if (!hits.length) {
    box.innerHTML = '<p class="muted small">검색 결과가 없습니다.</p>';
    return;
  }

  box.innerHTML = hits.map(n => {
    const c = State.celebs.get(n);
    return `<button type="button" class="featured-add" data-name="${esc(n)}">
      + ${esc(n)} <span class="muted small">${c.books.length}권</span>
    </button>`;
  }).join('');

  box.querySelectorAll('.featured-add').forEach(b => b.addEventListener('click', () => {
    if (_featured.picks.length >= FEATURED_MAX) {
      toast(`최대 ${FEATURED_MAX}명까지만 고정할 수 있습니다`, 'err');
      return;
    }
    _featured.picks.push({ name: b.dataset.name, badge: '', note: '' });
    renderFeaturedPicks();
    renderFeaturedResults($('#featuredSearch').value);
  }));
}

async function saveFeatured() {
  _featured.title    = $('#featuredTitle').value.trim();
  _featured.subtitle = $('#featuredSubtitle').value.trim();

  const unknown = _featured.picks.filter(p => !State.celebs.has(p.name)).map(p => p.name);
  if (unknown.length && !confirm(
    `다음 이름은 현재 데이터에 없어 메인에서 그냥 빠집니다:\n${unknown.join(', ')}\n\n그래도 저장할까요?`
  )) return;

  const payload = {
    title:    _featured.title,
    subtitle: _featured.subtitle,
    picks:    _featured.picks.map(p => ({ name: p.name, badge: p.badge || '', note: p.note || '' })),
  };
  const content = JSON.stringify(payload, null, 2) + '\n';
  const message = prompt('커밋 메시지',
    `메인 고정 인물 ${payload.picks.length}명 업데이트 (${new Date().toISOString().slice(0, 16).replace('T', ' ')})`);
  if (!message) return;

  const btn = $('#featuredSaveBtn');
  btn.disabled = true;
  setFeaturedStatus('저장 중…');
  try {
    const { sha } = await Gh.putFile({ content, sha: _featured.sha, message, path: FEATURED_PATH });
    _featured.sha = sha;
    setFeaturedStatus(sha ? `저장 완료 · sha ${sha.slice(0, 7)}` : '저장 완료');
    toast('고정 목록 저장됨 — 다음 빌드에서 메인에 반영됩니다', 'ok');
  } catch (err) {
    setFeaturedStatus('');
    toast(err.message, 'err');
  } finally {
    btn.disabled = false;
  }
}

$('#featuredBtn').addEventListener('click', openFeaturedDialog);
$('#featuredSaveBtn').addEventListener('click', saveFeatured);
$('#featuredSearch').addEventListener('input', (e) => renderFeaturedResults(e.target.value));

/* -------------------- 코멘트 검수 (data/comments.json) --------------------
 *
 * 출처를 읽고 자동으로 뽑아낸 "왜 이 책을 추천했는지" 초안을 한 건씩 넘겨보며
 * 승인하거나 반려하는 창. 승인한 것만 사이트에 나간다.
 *
 * data.csv에 섞지 않는 이유:
 *   - 코멘트 칸은 사람이 직접 쓰는 자리로 남겨 둔다 (사람이 쓴 값이 늘 우선)
 *   - 한/영 두 벌에 등급·근거·검수 상태까지 열로 붙이면 시트가 감당을 못 한다
 *   - featured.json처럼 파일 하나만 따로 커밋하면 CSV 충돌과 무관해진다
 */
const COMMENTS_PATH = 'data/comments.json';
const CMT_NOTE_DEFAULT =
  'Auto-drafted book comments awaiting human review. ' +
  'Key: "<연예인>|<도서명>" — both must match data.csv exactly. ' +
  'grade A = 출처 원문에 추천 이유가 있음, B = 관계만 확인되고 이유는 원문에 없음. ' +
  'status: pending | approved | rejected. 승인된 항목만 사이트에 노출한다. ' +
  "data.csv의 코멘트 칸에 사람이 쓴 값이 있으면 그쪽이 우선. " +
  "편집기의 '💬 코멘트 검수' 창에서 검수한다.";

const commentsDlg = $('#commentsDialog');
// 파일에는 수집기(tools/fetch_comments.py)가 쓰는 misses 같은 칸도 있다.
// 편집기가 모르는 칸이라도 그대로 돌려놔야 수집기가 같은 출처를 또 받아오지 않는다.
let _cmtDoc = {};

const CMT_LABEL = { pending: '미검수', approved: '승인', rejected: '반려' };

function setCmtStatus(msg) { $('#cmtStatus').textContent = msg || ''; }

function markCmtDirty() {
  Cmt.dirty = true;
  $('#cmtSaveBtn').disabled = false;
  setCmtStatus('미저장 변경 있음');
  window.onbeforeunload = () => '저장되지 않은 변경이 있습니다.';
}

// 도서명에 '|'가 들어갈 수 있으니 첫 구분자만 자른다 (연예인 이름에는 안 쓴다)
function splitCmtKey(k) {
  const i = k.indexOf('|');
  return i < 0 ? [k, ''] : [k.slice(0, i), k.slice(i + 1)];
}

/* AI 다듬기에 넘길 차례인 항목 (✨ AI 요청 복사에 담긴다).
 * 메모가 있고, ko 가 비었거나 지난번 AI 문장을 그대로 둔 채 메모만 바뀐 미검수 항목. */
function cmtNeedsPolish(v) {
  if ((v.status || 'pending') !== 'pending') return false;
  const memo = (v.memo || '').trim();
  if (!memo) return false;
  const ko = (v.ko || '').trim();
  if (!ko) return true;
  const ai = v.ai;
  return !!ai && ko === (ai.ko || '').trim() && memo !== (ai.memo || '').trim();
}

// AI가 다듬은 문장을 사람이 아직 손대지 않은 채 승인 대기 중인 것
function cmtIsAiDraft(v) {
  return (v.status || 'pending') === 'pending' && !!v.ai && !!(v.ko || '').trim()
    && (v.ko || '').trim() === (v.ai.ko || '').trim();
}

function cmtCounts() {
  let pending = 0, approved = 0, rejected = 0, total = 0;
  for (const v of Cmt.items.values()) {
    if (v._new && !(v.memo || '').trim()) continue;   // 💬 메모로 열기만 한 빈 항목
    total++;
    if (v.status === 'approved') approved++;
    else if (v.status === 'rejected') rejected++;
    else pending++;
  }
  return { pending, approved, rejected, total };
}

async function openCommentsDialog() {
  if (!Config.token) { toast('GitHub Token을 먼저 설정하세요', 'err'); settingsDlg.showModal(); return; }
  if (!State.celebs.size) { toast('먼저 ↻ 불러오기로 CSV를 가져오세요', 'err'); return; }

  if (!Cmt.loaded) {
    setCmtStatus('불러오는 중…');
    commentsDlg.showModal();
    try {
      const { content, sha } = await Gh.getFile(COMMENTS_PATH, { allowMissing: true });
      if (content) {
        const j = JSON.parse(content);
        _cmtDoc = j;
        for (const [k, v] of Object.entries(j.comments || {})) {
          // 수집기가 쓴 칸(context·score·outlet)까지 그대로 들고 있는다
          Cmt.items.set(k, Object.assign({}, v, {
            ko: v.ko || '', en: v.en || '', status: v.status || 'pending',
          }));
        }
      }
      Cmt.sha = sha;
      Cmt.loaded = true;
      setCmtStatus(sha ? `sha ${sha.slice(0, 7)}` : '아직 파일이 없습니다 (저장하면 새로 만듭니다)');
      renderDetail();   // 책 카드에 검수 뱃지를 붙인다
    } catch (err) {
      setCmtStatus('');
      toast('코멘트 불러오기 실패: ' + err.message, 'err');
      return;
    }
  } else {
    commentsDlg.showModal();
  }
  $('#cmtSaveBtn').disabled = !Cmt.dirty;
  renderCommentsList();
}

function cmtRows() {
  const f = $('#cmtFilter').value;
  const q = $('#cmtSearch').value.trim().toLowerCase();
  const rows = [];
  for (const [k, v] of Cmt.items) {
    const status = v.status || 'pending';
    if (Cmt.focus) {
      if (k === Cmt.focus) rows.push([k, v]);
      continue;
    }
    if (f === 'unwritten') {
      if (status !== 'pending' || (v.ko || '').trim()) continue;
    } else if (f === 'memo') {
      // 내가 메모는 해뒀고 아직 문장이 안 된 것 — Claude 에게 넘길 줄
      if (status !== 'pending' || (v.ko || '').trim() || !(v.memo || '').trim()) continue;
    } else if (f === 'tidy') {
      if (!cmtNeedsPolish(v)) continue;
    } else if (f === 'ai') {
      if (!cmtIsAiDraft(v)) continue;
    } else if (f !== 'all' && status !== f) continue;

    if (q && !k.toLowerCase().includes(q)) continue;
    rows.push([k, v]);
  }
  // 수집기가 매긴 점수가 높을수록 추천 이유가 담겼을 확률이 높다. 위에서부터 보면 된다.
  rows.sort((a, b) => (b[1].score || 0) - (a[1].score || 0));
  return rows;
}

function renderCommentsList() {
  const n = cmtCounts();
  let tidy = 0, ai = 0;
  for (const v of Cmt.items.values()) { if (cmtNeedsPolish(v)) tidy++; if (cmtIsAiDraft(v)) ai++; }
  $('#cmtCount').textContent =
    `미검수 ${n.pending} · 승인 ${n.approved} · 반려 ${n.rejected} · 전체 ${n.total}` +
    (ai ? ` · ✨ AI 초안 ${ai}` : '') + (tidy ? ` · 다듬을 메모 ${tidy}` : '');
  if (Cmt.focus) {
    $('#cmtCount').innerHTML += ' · <button type="button" class="btn small" id="cmtUnfocusBtn">전체 목록으로</button>';
  }

  const box = $('#cmtList');
  const rows = cmtRows();
  if (!rows.length) {
    box.innerHTML = '<p class="muted small" style="padding:18px 4px;">해당하는 항목이 없습니다.</p>';
    return;
  }

  box.innerHTML = rows.map(([k, v]) => {
    const [celeb, title] = splitCmtKey(k);
    const c = State.celebs.get(celeb);
    const known = !!(c && c.books.some(b => b.title === title));
    const status = v.status || 'pending';
    const gradeTip = v.grade === 'A' ? '출처 원문에 추천 이유가 적혀 있음'
                   : v.grade === 'B' ? '관계만 확인 · 원문에 이유는 없음' : '';
    return `<article class="cmt-card ${status}" data-key="${esc(k)}">
      <div class="cmt-head">
        ${v.grade ? `<span class="cmt-grade g-${esc(v.grade.toLowerCase())}" title="${esc(gradeTip)}">${esc(v.grade)}</span>` : ''}
        <b>${esc(celeb)}</b><span class="muted"> · </span>${esc(title)}
        <span class="cmt-state s-${status}">${CMT_LABEL[status]}</span>
        ${(v.ko || '').trim() ? '' : '<span class="cmt-state s-unwritten">문장 미작성</span>'}
        ${(v.memo || '').trim() && !(v.ko || '').trim() ? '<span class="cmt-state s-memo">메모 있음</span>' : ''}
        ${cmtIsAiDraft(v) ? `<span class="cmt-state s-ai" title="${esc(`${v.ai.at || ''} AI가 메모를 다듬은 문장 — 읽어보고 고치거나 승인하세요`)}">✨ AI 초안</span>` : ''}
        ${cmtNeedsPolish(v) && (v.ko || '').trim() ? '<span class="cmt-state s-memo" title="AI 문장을 만든 뒤 메모가 바뀌었습니다. 다음 다듬기 때 새로 씁니다">메모 바뀜</span>' : ''}
        ${v.score != null ? `<span class="muted small" title="추천 이유가 담겼을 법한 정도">점수 ${v.score}</span>` : ''}
        ${v.date ? `<span class="muted small" title="${esc(v.date_type || '게재일')}">${esc(v.date_type || '게재일')} ${esc(v.date)}</span>` : ''}
        ${known ? '' : '<span class="badge">데이터에 없는 항목</span>'}
        <span class="cmt-spacer"></span>
        ${v.source
          ? `<a class="btn small" href="${esc(v.source)}" target="_blank" rel="noopener">출처 열기 ↗</a>`
          : '<span class="flag warn">출처 없음</span>'}
      </div>
      ${v.note ? `<p class="cmt-note">⚠ ${esc(v.note)}</p>` : ''}
      ${cmtIsAiDraft(v) && v.ai.note ? `<p class="cmt-note">✨ AI 메모: ${esc(v.ai.note)}</p>` : ''}
      ${v.quote ? `<blockquote class="cmt-quote">${v.quote_type ? `<span class="muted small">원문 ${esc(v.quote_type)} · </span>` : ''}${esc(v.quote)}</blockquote>` : ''}
      ${v.context ? `<details class="cmt-ctx"><summary>앞뒤 문단</summary><p>${esc(v.context)}</p></details>` : ''}
      <label class="small cmt-memo">내 메모 — 출처를 보고 편한 말투로 적어두면 AI가 아래 문장으로 다듬습니다
        <textarea data-f="memo" rows="2" placeholder="예: 헌책방에서 우연히 샀는데 그때 찾던 주제라 방향을 잡아줬다고 함"></textarea>
      </label>
      <div class="cmt-body">
        <label class="small">한국어
          <textarea data-f="ko" rows="2" placeholder="비우면 승인할 수 없습니다">${esc(v.ko)}</textarea>
        </label>
        <label class="small">English
          <textarea data-f="en" rows="2"></textarea>
        </label>
      </div>
      <div class="cmt-actions">
        <button type="button" class="btn small ok" data-act="approved">승인</button>
        <button type="button" class="btn small" data-act="pending">보류</button>
        <button type="button" class="btn small danger" data-act="rejected">반려</button>
        <span class="muted small">Ctrl+Enter = 승인</span>
      </div>
    </article>`;
  }).join('');

  // 영문·메모는 value로 직접 넣는다 — 문장 안의 따옴표가 HTML을 깨지 않도록
  rows.forEach(([k, v], i) => {
    const el = box.children[i];
    if (!el) return;
    el.querySelector('textarea[data-f="en"]').value = v.en || '';
    el.querySelector('textarea[data-f="memo"]').value = v.memo || '';
  });
}

function setCmtState(key, status) {
  const it = Cmt.items.get(key);
  if (!it) return;
  if (status === 'approved' && !(it.ko || '').trim()) {
    toast('한국어 문장이 비어 있어 승인할 수 없습니다', 'err');
    return;
  }
  it.status = status;
  markCmtDirty();
  renderCommentsList();
  renderDetail();
}

$('#cmtList').addEventListener('input', (e) => {
  const f = e.target.dataset.f;
  const card = e.target.closest('.cmt-card');
  if (!f || !card) return;
  const it = Cmt.items.get(card.dataset.key);
  if (!it) return;
  it[f] = e.target.value;
  markCmtDirty();
});

$('#cmtList').addEventListener('click', (e) => {
  const act = e.target.dataset.act;
  const card = e.target.closest('.cmt-card');
  if (!act || !card) return;
  setCmtState(card.dataset.key, act);
});

$('#cmtList').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || !(e.ctrlKey || e.metaKey)) return;
  const card = e.target.closest('.cmt-card');
  if (!card) return;
  e.preventDefault();
  setCmtState(card.dataset.key, 'approved');
});

async function saveComments() {
  const comments = {};
  for (const [k, v] of Cmt.items) {
    // 💬 메모로 열기만 하고 아무것도 안 쓴 항목은 파일에 남기지 않는다
    if (v._new && !(v.memo || '').trim() && !(v.ko || '').trim() && !(v.en || '').trim()) continue;
    const { _new, ...rest } = v;
    comments[k] = Object.assign({}, rest, {
      ko: (v.ko || '').trim(),
      en: (v.en || '').trim(),
      status: v.status || 'pending',
    });
  }
  const payload = {
    ..._cmtDoc,                 // 편집기가 모르는 칸(misses 등)은 그대로 둔다
    _comment: _cmtDoc._comment || CMT_NOTE_DEFAULT,
    _updated: new Date().toISOString().slice(0, 10),
    comments,
  };
  const content = JSON.stringify(payload, null, 2) + '\n';

  const n = cmtCounts();
  const message = prompt('커밋 메시지',
    `코멘트 검수 — 승인 ${n.approved} / 반려 ${n.rejected} / 미검수 ${n.pending}`);
  if (!message) return;

  const btn = $('#cmtSaveBtn');
  btn.disabled = true;
  setCmtStatus('저장 중…');
  try {
    const { sha } = await Gh.putFile({ content, sha: Cmt.sha, message, path: COMMENTS_PATH });
    Cmt.sha = sha;
    Cmt.dirty = false;
    if (!State.dirty) window.onbeforeunload = null;
    setCmtStatus(sha ? `저장 완료 · sha ${sha.slice(0, 7)}` : '저장 완료');
    toast(`코멘트 저장됨 — 승인 ${n.approved}건`, 'ok');
  } catch (err) {
    setCmtStatus('');
    toast(err.message, 'err');
    btn.disabled = false;
  }
}

/* 문장 한꺼번에 채우기 — 누락 영문 창과 같은 방식.
 * 수집기는 인용까지만 모으고, 그걸 한국어·영어 한 줄로 옮기는 건 여기서 한다. */
$('#cmtCopyBtn').addEventListener('click', async () => {
  // 지금 목록에 보이는 것만 복사한다 — 필터를 '메모만 있음'에 두면 넘길 줄만 담긴다
  const rows = cmtRows().map(([k, v]) => {
    const [celeb, title] = splitCmtKey(k);
    return [k, celeb, title, v.outlet || '', v.source || '',
            v.memo || '', v.quote || '', v.context || '']
      .map(x => String(x).replace(/[\t\n]+/g, ' ')).join('\t');
  });
  if (!rows.length) { toast('목록이 비어 있습니다', 'err'); return; }
  const tsv = ['키\t연예인\t도서명\t매체\t출처\t내메모\t인용\t앞뒤문단', ...rows].join('\n');
  try { await copyToClipboard(tsv); toast(`${rows.length}건 복사됨`, 'ok'); }
  catch (e) { toast('복사 실패: ' + e.message, 'err'); }
});

/* Claude 가 준 JSON 배열(✨ AI 요청 복사의 답)이나 '키 ⇥ 한국어 ⇥ English' TSV를 받는다. */
function parseCmtPaste(text) {
  const a = text.indexOf('['), b = text.lastIndexOf(']');
  if (a >= 0 && b > a) {
    try {
      const arr = JSON.parse(text.slice(a, b + 1));
      if (Array.isArray(arr)) return arr.filter(x => x && x.key);
    } catch (e) { /* JSON이 아니면 TSV로 본다 */ }
  }
  // 키에 '|' 가 들어 있어서 parseTsvLines(파이프도 구분자로 봄)는 못 쓴다. 탭만 본다.
  return text.split(/\r?\n/)
    .map(l => l.trim()).filter(Boolean)
    .map(l => l.split('\t').map(c => c.trim()))
    .filter(c => c[0] && c[0] !== '키')
    .map(([key, ko, en, grade, note]) => ({ key, ko, en, grade, note }));
}

$('#cmtApplyPasteBtn').addEventListener('click', () => {
  const rows = parseCmtPaste($('#cmtPaste').value);
  const today = new Date().toISOString().slice(0, 10);
  let hit = 0, miss = 0;
  for (const r of rows) {
    const it = Cmt.items.get(String(r.key || '').trim());
    if (!it) { miss++; continue; }
    if (r.ko) it.ko = String(r.ko).trim();
    if (r.en) it.en = String(r.en).trim();
    if (r.grade === 'A' || r.grade === 'B') it.grade = r.grade;
    // 무엇을 보고 다듬었는지 남긴다 — 사람이 문장을 고쳤는지, 그 뒤 메모가 바뀌었는지 가리는 데 쓴다
    it.ai = { memo: (it.memo || '').trim(), ko: it.ko, en: it.en, note: String(r.note || '').trim(), at: today };
    hit++;
  }
  if (!hit) { toast('맞는 키가 없습니다 (key 가 "연예인|도서명" 이어야 합니다)', 'err'); return; }
  markCmtDirty();
  Cmt.focus = null;
  $('#cmtFilter').value = 'ai';
  renderCommentsList();
  renderDetail();
  $('#cmtPaste').value = '';
  toast(`✨ ${hit}건 채움 — 읽어보고 승인한 뒤 저장하세요` + (miss ? ` · ${miss}건은 키를 못 찾음` : ''), 'ok');
});

/* 책 목록의 💬 메모 — 그 책 항목 하나만 띄운다. 수집기가 아직 못 만든 책이면 새로 만든다.
 * 메모를 쓰고 ✨ AI 요청 복사로 Claude 에 넘기면 문장으로 다듬어 온다. */
async function openCommentFor(celeb, book) {
  await openCommentsDialog();
  if (!Cmt.loaded || !commentsDlg.open) return;
  const key = Cmt.key(celeb, book.title);
  if (!Cmt.items.has(key)) {
    Cmt.items.set(key, {
      ko: '', en: '', memo: '',
      source: isHttp(book.source) ? book.source : '',
      outlet: '', grade: '', evidence: 'manual', note: '',
      status: 'pending', _new: true,
    });
  }
  Cmt.focus = key;
  renderCommentsList();
  const ta = $('#cmtList textarea[data-f="memo"]');
  if (ta) ta.focus();
}

/* ✨ AI 요청 복사 — API 키 없이 Claude 대화창으로 다듬는다.
 * 다듬을 메모를 지침과 함께 요청문 하나로 복사 → Claude 대화창에 붙여넣기 →
 * 돌아온 답(JSON)을 아래 '붙여넣은 결과 적용' 칸에 넣으면 문장이 들어가고
 * ✨ AI 초안 표시가 붙는다. 읽어보고 승인하면 나간다. */
const CMT_POLISH_GUIDE = `한국 셀럽의 추천 도서를 모아 보여주는 사이트 favorbook.co.kr 의 코멘트를 다듬어 주세요.
책마다 "이 사람이 왜 이 책을 추천했는지"를 한 줄로 붙입니다.
아래 항목마다 편집자가 출처를 직접 읽고 남긴 메모(memo)가 있습니다. 이걸 사이트에 실을 한국어·영어 문장으로 옮겨 주세요.

지킬 것
- 근거는 memo 입니다. quote·context 는 고유명사나 사실을 확인하는 데만 쓰고, memo 에 없는 이유나 감상을 지어내지 마세요.
- ko: 1~2문장, 120자 안팎. 셀럽 이름으로 시작하지 말고 전해 듣는 말투로 끝냅니다("~했대요", "~했어요", "~래요"). 끝에 "(출처: 매체명)".
- en: ko 와 같은 내용을 자연스러운 영어 한 문장으로. 끝에 "(Source: 매체 영문명)" (씨네21 → Cine21, 보그 → Vogue Korea, 네이버 블로그 → Naver Blog). 매체를 모르면 source 주소로 판단합니다.
- memo 가 원문을 길게 붙여넣은 것이면 추천 이유가 담긴 핵심만 추리고, 따옴표 인용을 그대로 옮기지 말고 풀어 씁니다.
- grade: memo 에 추천 이유·감상이 있으면 "A", 읽었다·언급했다 같은 관계만 있으면 "B". B 면 관계만 담담히 적습니다.
- note: 검수자가 알아야 할 점(다른 책 얘기 같다, 매체를 알 수 없다 등)을 한 줄로. 없으면 "".

예시
memo: 교보에서 별생각 없이 골랐는데 모순보다 재밌었다고. 건선으로 잠 못 자던 새벽마다 친구가 돼준 책 / outlet: 보그
ko: 교보문고에서 별생각 없이 골랐는데 '모순'보다 훨씬 재미있게 읽었대요. 건선으로 잠 못 이루던 새벽마다 친구가 되어준 책이래요. (출처: 보그)
en: Picked on a whim at Kyobo, she enjoyed it even more than Contradiction; it kept her company through sleepless nights with psoriasis. (Source: Vogue Korea)

답은 설명 없이 JSON 배열 하나만 코드 블록으로 주세요. key 는 받은 그대로 둡니다.
[{"key": "연예인|도서명", "ko": "…", "en": "…", "grade": "A", "note": ""}]

항목:
`;

$('#cmtPolishBtn').addEventListener('click', async () => {
  if (!Cmt.loaded) return;
  // 지금 화면에서 쓴 메모 그대로 담는다 (저장 안 해도 된다)
  const items = [...Cmt.items].filter(([, v]) => cmtNeedsPolish(v)).map(([k, v]) => {
    const o = { key: k, outlet: v.outlet || '', source: v.source || '', memo: (v.memo || '').trim() };
    if (v.quote) o.quote = v.quote;
    if (v.context) o.context = v.context;
    return o;
  });
  if (!items.length) { toast('다듬을 메모가 없습니다 (메모를 쓰고 한국어 칸은 비워두세요)', 'err'); return; }
  const text = CMT_POLISH_GUIDE + JSON.stringify(items, null, 1);
  try { await copyToClipboard(text); }
  catch (e) { toast('복사 실패: ' + e.message, 'err'); return; }
  const box = $('.cmt-bulk');
  box.open = true;
  $('#cmtPaste').focus();
  box.scrollIntoView({ block: 'nearest' });
  toast(`메모 ${items.length}건 요청 복사됨 — Claude 대화창에 붙여넣고, 받은 답을 아래 칸에 붙여넣으세요`, 'ok');
});

$('#commentsBtn').addEventListener('click', openCommentsDialog);
$('#cmtSaveBtn').addEventListener('click', saveComments);
$('#cmtFilter').addEventListener('change', () => { Cmt.focus = null; renderCommentsList(); });
$('#cmtSearch').addEventListener('input', () => { Cmt.focus = null; renderCommentsList(); });
$('#cmtCount').addEventListener('click', (e) => {
  if (e.target.id !== 'cmtUnfocusBtn') return;
  Cmt.focus = null;
  renderCommentsList();
});
commentsDlg.addEventListener('close', () => {
  Cmt.focus = null;
  // 💬 메모로 열기만 하고 비워둔 항목은 치운다 (책 카드에 '검수 대기'가 잘못 뜨지 않게)
  for (const [k, v] of Cmt.items) {
    if (v._new && !(v.memo || '').trim() && !(v.ko || '').trim() && !(v.en || '').trim()) Cmt.items.delete(k);
  }
  renderDetail();
  if (Cmt.dirty) toast('검수 결과가 아직 저장되지 않았습니다', 'err');
});

/* -------------------- 영문 제목 검수 (data/titles_en.json) --------------------
 *
 * 책의 공식 영문판 제목을 한 권씩 확인하는 창. 후보는 번역한 값이 아니라
 * tools/fetch_titles_en.py 가 예스24 원서명·위키백과 영어 문서·알라딘 원제에서
 * 모아 둔 것이다. 사람은 후보를 누르고 승인만 하면 된다.
 *
 * data.csv 에 쓰지 않는 이유는 코멘트 검수와 같다. 파일 하나만 커밋하면
 * CSV 저장과 부딪히지 않고, 배치가 다시 돌아도 사람이 정한 값이 남는다.
 * generate.py 는 approved/none 이면 이 값을, pending 이면 data.csv 값을 쓴다.
 *
 * 같은 파일의 authors 는 저자 영문 이름이다 (키 = data.csv 의 저자 칸). 같은 저자도 행마다
 * Kim Youngha * / Kim Young-ha 처럼 갈려 있어서, 위키데이터·Open Library·예스24·위키백과에
 * 적힌 이름을 후보로 모아 두고 제목 카드 아래에서 함께 고른다. 승인하면 그 저자의 모든 행이
 * 같은 표기로 맞춰진다. Goodreads 는 자동 수집이 막혀 있어 확인용 검색 링크만 단다.
 */
const TITLES_PATH = 'data/titles_en.json';
const Ttl = {
  items: new Map(),     // "도서명|저자" -> entry
  touched: new Set(),   // 이번에 손댄 키 — 저장할 때 최신 파일 위에 이것만 덮는다
  authors: new Map(),   // 저자(한국어) -> entry
  touchedAuthors: new Set(),
  loaded: false,
  dirty: false,
  shown: 60,
};
const titlesDlg = $('#titlesDialog');
const TTL_LABEL = { pending: '미검수', approved: '승인', none: '공식판 없음' };
const TTL_FLAG = {
  csv_star: ['직역*', ''], csv_problem: ['문제 있는 값', 'bad'], csv_empty: ['빈 칸', ''],
  conflict: ['CSV와 다름', 'bad'], no_candidate: ['후보 없음', ''], unchecked: ['미조회', ''],
};
const TTL_SRC = { yes24: '예스24 원서명', aladin: '알라딘 원제', wikipedia: '위키백과', wikidata: '위키데이터', openlibrary: 'Open Library', ltikorea: '한국문학번역원(출간본)', ltikorea_title: '한국문학번역원 영문 제목' };
const stripStar = (v) => String(v || '').replace(/\s*\*\s*$/, '').trim();
const AUT_LABEL = { pending: '미검수', approved: '승인', none: '공식 표기 없음' };
const AUT_FLAG = {
  csv_star: ['로마자*', ''], csv_problem: ['문제 있는 값', 'bad'], csv_empty: ['빈 칸', ''],
  conflict: ['CSV와 다름', 'bad'], variants: ['행마다 표기 다름', 'bad'], multi: ['여러 명', ''],
  no_candidate: ['후보 없음', ''], unchecked: ['미조회', ''],
};
const AUT_SRC = { wikidata_book: '위키데이터(이 책의 저자)', openlibrary: 'Open Library 영어판', yes24: '예스24 원서 저자', wikidata: '위키데이터(인물)', wikipedia: '위키백과' };
// 비교용 — 대소문자·하이픈·띄어쓰기·악센트 차이는 같은 이름 (tools/fetch_titles_en.py 의 name_key)
const nameKey = (s) => String(s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^0-9a-z]+/g, '');
function autProblem(v) {
  if (/[가-힣ㄱ-ㅎㅏ-ㅣ]/.test(v)) return '한글';
  if (/\(\s*or\b|\bor similar\b|\bunofficial\b/i.test(v)) return 'AI 설명 문구';
  if (/^\?/.test(v)) return '? 표시';
  return null;
}

// generate.py 의 en_title_problem() 과 같은 규칙 — 여기서 막아야 승인해 놓고 사이트에서 빠지는 일이 없다
function ttlProblem(titleKo, v) {
  if (/\(\s*or\b/i.test(v)) return '"(or ...)" 같은 대안 문구';
  if (/\bor similar\b|\bno (?:widely )?confirmed\b|\bofficial english\b|\bunofficial\b|\bnot (?:officially )?translated\b/i.test(v)) return 'AI 설명 문구';
  if (/[가-힣ㄱ-ㅎㅏ-ㅣ]/.test(v)) return '한글';
  if (v.includes(' / ') && !String(titleKo).includes('/')) return '"A / B" 후보 나열';
  return null;
}

/* 영문 제목 표기 원칙: 단어 첫 글자만 대문자 (Title Case).
 * generate.py·tools/fetch_titles_en.py 의 en_title_case() 와 같은 규칙.
 * 전부 대문자(THE WHITE BOOK)는 풀어서 맞추고, iPhone·BTS·1Q84 는 그대로,
 * a·the·of 같은 짧은 말은 첫·끝 단어와 콜론 뒤가 아니면 소문자, 외국어 제목은 손대지 않는다. */
const TITLE_SMALL = new Set(['a','an','the','and','but','or','nor','for','so','yet','as','at','by','in','of','on','to','up','via','with','from','into','onto','over','per','than','vs']);
const ROMAN_RE = /^(?=[ivxlcdm]+$)m{0,3}(cm|cd|d?c{0,3})(xc|xl|l?x{0,3})(ix|iv|v?i{0,3})$/i;
const FOREIGN_RE = /[àâäçéèêëîïôöùûüÿñãõáíóúōūāēīåøæœß]|\b(?:le|la|les|des|du|l'|d'|et|der|das|und|ein|eine|um|uma|os|il|della|och|jag|het|een)\b/i;
function enTitleCase(value) {
  let v = String(value || '').trim();
  let star = '';
  const m = v.match(/\s*\*\s*$/);
  if (m) { star = ' *'; v = v.slice(0, m.index); }
  if (!v || FOREIGN_RE.test(v)) return v + star;
  const letters = [...v].filter(c => /\p{L}/u.test(c));
  const shouting = letters.length > 3 &&
    letters.filter(c => c === c.toUpperCase() && c !== c.toLowerCase()).length / letters.length > 0.8;
  const tokens = v.split(/(\s+)/);
  const words = tokens.map((t, i) => t.trim() ? i : -1).filter(i => i >= 0);
  words.forEach((i, n) => {
    const w = tokens[i];
    const core = w.replace(/^[^\p{L}\p{N}_]+|[^\p{L}\p{N}_]+$/gu, '');
    if (!core) return;
    const edge = n === 0 || n === words.length - 1 || /[:.?!—–]$/.test(tokens[words[n - 1]]);
    const low = core.toLowerCase();
    const isLower = core === low && core !== core.toUpperCase();
    let nw;
    if (ROMAN_RE.test(core) && (shouting || core === core.toUpperCase())) nw = core.toUpperCase();
    else if (shouting || isLower) {
      const base = shouting ? low : core;
      nw = (TITLE_SMALL.has(low) && !edge) ? base : base[0].toUpperCase() + base.slice(1);
    } else if (TITLE_SMALL.has(low) && !edge && core[0] === core[0].toUpperCase() && core.slice(1) === core.slice(1).toLowerCase()) nw = low;
    else nw = core;
    tokens[i] = w.replace(core, nw);
  });
  return tokens.join('') + star;
}

/* 검수 결과를 편집기의 도서명_en 칸에 옮긴다 — generate.py 의 resolve_title_en() 과 같은 규칙.
 * approved 면 그 값, none(직역) 이면 값 + ' *'. 미검수·'영문 숨김'(값 없음)은 CSV 값을 그대로 둔다. */
function ttlResolved(ent) {
  if (!ent) return null;
  const v = stripStar(ent.value);
  if (!v) return null;
  if (ent.status === 'approved') return enTitleCase(v);
  if (ent.status === 'none') return enTitleCase(v) + ' *';
  return null;
}

// 저자 검수 결과 → 저자_en. generate.py 의 resolve_author_en() 과 같은 규칙
function autResolved(ent) {
  if (!ent) return null;
  const v = stripStar(ent.value);
  if (!v) return null;
  if (ent.status === 'approved') return v;
  if (ent.status === 'none') return v + ' *';
  return null;
}

function applyAuthorsToBooks(names) {
  let n = 0;
  for (const c of State.celebs.values()) {
    for (const b of c.books) {
      if (names && !names.has(b.author || '')) continue;
      const v = autResolved(Ttl.authors.get(b.author || ''));
      if (v && v !== (b.author_en || '')) { b.author_en = v; n++; }
    }
  }
  if (n) setDirty(true);
  return n;
}

function loadTitlesDoc(doc) {
  for (const [k, v] of Object.entries(doc.titles || {})) Ttl.items.set(k, v);
  for (const [k, v] of Object.entries(doc.authors || {})) Ttl.authors.set(k, v);
  Ttl.loaded = true;
}

function applyTitlesToBooks(keys) {
  let n = 0;
  for (const c of State.celebs.values()) {
    for (const b of c.books) {
      const key = `${b.title}|${b.author || ''}`;
      if (keys && !keys.has(key)) continue;
      const v = ttlResolved(Ttl.items.get(key));
      if (v && v !== (b.title_en || '')) { b.title_en = v; n++; }
    }
  }
  if (n) setDirty(true);
  return n;
}

// 불러오기 때 한 번 — 검수 파일을 읽어(아직 안 읽었으면) 도서명_en 에 반영한다
async function syncTitlesToBooks() {
  if (!Config.token) return 0;
  if (!Ttl.loaded) {
    try {
      const doc = await fetchTitlesDoc();
      if (!doc) return 0;
      loadTitlesDoc(doc);
    } catch (err) {
      console.warn('영문 제목 검수 파일 읽기 실패', err);
      return 0;
    }
  }
  return applyTitlesToBooks() + applyAuthorsToBooks();
}

function setTtlStatus(msg) { $('#ttlStatus').textContent = msg || ''; }

function markTtlDirty(key, isAuthor) {
  (isAuthor ? Ttl.touchedAuthors : Ttl.touched).add(key);
  Ttl.dirty = true;
  $('#ttlSaveBtn').disabled = false;
  setTtlStatus(`미저장 변경 — 제목 ${Ttl.touched.size}건 · 저자 ${Ttl.touchedAuthors.size}명`);
  window.onbeforeunload = () => '저장되지 않은 변경이 있습니다.';
}

async function fetchTitlesDoc() {
  const { content } = await Gh.getFile(TITLES_PATH, { allowMissing: true });
  return content ? JSON.parse(content) : null;
}

async function openTitlesDialog() {
  if (!Config.token) { toast('GitHub Token을 먼저 설정하세요', 'err'); settingsDlg.showModal(); return; }
  titlesDlg.showModal();
  if (!Ttl.loaded) {
    setTtlStatus('불러오는 중…');
    try {
      const doc = await fetchTitlesDoc();
      if (!doc) {
        setTtlStatus('');
        $('#ttlList').innerHTML = '<p class="muted small" style="padding:18px 4px;">' +
          '아직 data/titles_en.json 이 없습니다. Actions → Fetch English Titles 를 먼저 돌려 주세요.</p>';
        return;
      }
      loadTitlesDoc(doc);
      setTtlStatus(doc._updated ? `후보 갱신 ${doc._updated}` : '');
    } catch (err) {
      setTtlStatus('');
      toast('영문 제목 불러오기 실패: ' + err.message, 'err');
      return;
    }
  }
  $('#ttlSaveBtn').disabled = !Ttl.dirty;
  Ttl.shown = 60;
  renderTitlesList();
}

function ttlCounts() {
  const n = { pending: 0, approved: 0, none: 0 };
  for (const v of Ttl.items.values()) n[v.status in n ? v.status : 'pending']++;
  return n;
}

// 편집기에 올라온 data.csv 의 저자별 저자_en 값(줄 수)과 책 — 검수 파일에 적힌 것보다 지금 상태가 정확하다
function autIndex() {
  const idx = new Map();
  for (const c of State.celebs.values()) {
    for (const b of c.books) {
      const name = b.author || '';
      if (!name) continue;
      if (!idx.has(name)) idx.set(name, { values: new Map(), titles: new Set() });
      const e = idx.get(name);
      const v = (b.author_en || '').trim();
      if (v) e.values.set(v, (e.values.get(v) || 0) + 1);
      e.titles.add(b.title);
    }
  }
  return idx;
}

// 저자 한 명의 검수 항목 + 지금 data.csv 값. 아직 조회 전인 저자도 직접 검수할 수 있게 빈 항목을 만든다
function autView(name, idx) {
  const ent = Ttl.authors.get(name) || { author: name, candidates: [], status: 'pending', value: '' };
  const live = idx.get(name);
  const values = live ? [...live.values].sort((a, b) => b[1] - a[1]) : Object.entries(ent.csv_values || {});
  const books = live ? live.titles.size : (ent.books || 0);
  // 하이픈·띄어쓰기만 달라도(Kim Youngha / Kim Young-ha) 사이트에는 다르게 나가니 갈린 것으로 본다
  const variants = new Set(values.map(([x]) => stripStar(x).replace(/\s+/g, ' ')).filter(Boolean)).size > 1;
  return { ent, values, books, variants };
}

function autCounts(idx) {
  const n = { pending: 0, approved: 0, none: 0 };
  for (const name of idx.keys()) {
    const st = Ttl.authors.get(name)?.status;
    n[st in n ? st : 'pending']++;
  }
  return n;
}

function ttlRows() {
  const f = $('#ttlFilter').value;
  const q = $('#ttlSearch').value.trim().toLowerCase();
  const rows = [];
  // '저자:' 필터는 저자 한 명에 카드 하나 (그 저자의 첫 책 카드)
  const byAuthor = f.startsWith('a_');
  const idx = autIndex();
  const seen = new Set();
  for (const [k, v] of Ttl.items) {
    if (byAuthor) {
      const name = v.author || '';
      if (!name || seen.has(name)) continue;
      const av = autView(name, idx);
      const a = av.ent;
      const ap = (a.status || 'pending') === 'pending';
      const afl = a.flags || [];
      const aok = {
        a_focus: ap && (a.candidates || []).length > 0,
        a_conflict: ap && afl.includes('conflict'),
        a_variants: ap && av.variants,
        a_star: ap && av.values.some(([x]) => /\*\s*$/.test(x)),
        a_nocand: ap && !(a.candidates || []).length,
        a_pending: ap, a_approved: !ap,
      }[f];
      if (!aok) continue;
      if (q) {
        const hay = [name, a.value, ...av.values.map(([x]) => x), ...(a.candidates || []).map(c => c.name)]
          .join(' ').toLowerCase();
        if (!hay.includes(q)) continue;
      }
      seen.add(name);
      rows.push([k, v, av]);
      continue;
    }
    const st = v.status || 'pending';
    const fl = v.flags || [];
    const cands = v.candidates || [];
    const pend = st === 'pending';
    const ok = {
      focus: pend && cands.length > 0,
      conflict: pend && fl.includes('conflict'),
      problem: pend && fl.includes('csv_problem'),
      star: pend && fl.includes('csv_star'),
      empty: pend && fl.includes('csv_empty'),
      nocand: pend && !cands.length,
      pending: pend, approved: st === 'approved', none: st === 'none', all: true,
    }[f];
    if (!ok) continue;
    if (q) {
      const a = Ttl.authors.get(v.author || '');
      const hay = [k, v.csv, v.value, ...cands.map(c => c.title), a?.value,
                   ...[...(idx.get(v.author || '')?.values.keys() || [])]].join(' ').toLowerCase();
      if (!hay.includes(q)) continue;
    }
    rows.push([k, v]);
  }
  if (byAuthor) {
    // 확실한 후보 → 표기가 갈린 것 → 책이 많은 저자 순 (한 번 승인으로 고쳐지는 줄이 많은 쪽부터)
    const rank = (av) => {
      const a = av.ent;
      const c = { high: 0, mid: 1 }[a.confidence] ?? 2;
      return c * 10 - (av.variants ? 3 : 0) - ((a.flags || []).includes('conflict') ? 2 : 0);
    };
    rows.sort((a, b) => rank(a[2]) - rank(b[2]) || b[2].books - a[2].books
      || (a[1].author || '').localeCompare(b[1].author || '', 'ko'));
    return rows;
  }
  // 확실한 것부터 — 눌러서 승인만 하면 되는 카드가 위로 온다
  const rank = (v) => {
    const c = { high: 0, mid: 1 }[v.confidence] ?? 2;
    const fl = v.flags || [];
    return c * 10 - (fl.includes('csv_problem') ? 3 : 0) - (fl.includes('conflict') ? 2 : 0)
      - (fl.includes('csv_star') ? 1 : 0);
  };
  rows.sort((a, b) => rank(a[1]) - rank(b[1]) || a[1].title.localeCompare(b[1].title, 'ko'));
  return rows;
}

function bookLinkFor(title) {
  for (const c of State.celebs.values()) {
    const b = c.books.find(x => x.title === title);
    if (b) return { link: b.link || '', author_en: stripStar(b.author_en) };
  }
  return { link: '', author_en: '' };
}

function renderTitlesList() {
  const n = ttlCounts();
  const rows = ttlRows();
  const idx = autIndex();
  const na = autCounts(idx);
  $('#ttlCount').textContent =
    `이 목록 ${rows.length} · 제목 미검수 ${n.pending} · 승인 ${n.approved} · 공식판 없음 ${n.none}` +
    ` · 저자 미검수 ${na.pending} · 승인 ${na.approved}`;

  const box = $('#ttlList');
  if (!rows.length) {
    const hint = ['focus', 'a_focus'].includes($('#ttlFilter').value)
      ? ' 후보가 아직 없다면 GitHub Actions → Fetch English Titles 를 돌려 주세요. ' +
        '그동안은 필터를 "문제 있는 값"이나 "직역* 인 것", "저자: 표기가 갈린 것"으로 바꿔 직접 고칠 수 있습니다.' : '';
    box.innerHTML = `<p class="muted small" style="padding:18px 4px;">해당하는 항목이 없습니다.${hint}</p>`;
    $('#ttlMoreBtn').classList.add('hidden');
    return;
  }
  const page = rows.slice(0, Ttl.shown);
  box.innerHTML = page.map(([k, v]) => {
    const st = v.status || 'pending';
    const cands = v.candidates || [];
    const { link, author_en } = bookLinkFor(v.title);
    const q = encodeURIComponent(`${author_en || v.author} "${v.title}" English translation`);
    const flags = st !== 'pending' ? '' : (v.flags || []).map(f => TTL_FLAG[f]
      ? `<span class="ttl-flag ${TTL_FLAG[f][1]}">${TTL_FLAG[f][0]}</span>` : '').join('');
    const conf = v.confidence && v.confidence !== 'none'
      ? `<span class="ttl-conf c-${esc(v.confidence)}" title="high = 영어판 확인 또는 두 곳 이상 일치">${v.confidence === 'high' ? '확실' : '후보'}</span>` : '';
    return `<article class="cmt-card ${st}" data-key="${esc(k)}" data-author="${esc(v.author || '')}">
      <div class="cmt-head">
        ${conf}
        <b>${esc(v.title)}</b><span class="muted"> · ${esc(v.author || '')}</span>
        <span class="cmt-state s-${st}">${TTL_LABEL[st] || st}${v.auto ? ' (자동)' : ''}</span>
        ${flags}
        <span class="cmt-spacer"></span>
      </div>
      <p class="ttl-csv">지금 data.csv: <b>${v.csv ? esc(v.csv) : '(비어 있음)'}</b>
        ${v.original && !cands.some(c => c.title === v.original) ? ` · 원제 <b>${esc(v.original)}</b>` : ''}</p>
      ${cands.length ? `<div class="ttl-cands">${cands.map((c, i) => `
        <button type="button" class="ttl-cand" data-pick="${i}">
          <span>${esc(c.title)}</span>
          <span class="src">${c.sources.map(s => TTL_SRC[s] || s).join(' + ')}</span>
          ${c.verified ? '<span class="ok" title="Open Library에 같은 제목·저자의 영어판이 있음">✓ 확인</span>' : ''}
          ${(c.urls || []).map(u => `<a href="${esc(u)}" target="_blank" rel="noopener">근거 ↗</a>`).join('')}
        </button>`).join('')}</div>` : ''}
      ${(v.notes || []).length ? `<p class="cmt-note">⚠ ${esc(v.notes.join(' · '))}</p>` : ''}
      <div class="ttl-value">
        <input type="text" data-f="value" placeholder="영문 제목 (공식판이 없으면 직역)">
      </div>
      <div class="ttl-links">
        ${link ? `<a href="${esc(link)}" target="_blank" rel="noopener">예스24 상품 ↗</a>` : ''}
        <a href="https://www.google.com/search?q=${q}" target="_blank" rel="noopener">Google 검색 ↗</a>
        <a href="https://www.goodreads.com/search?q=${encodeURIComponent(v.title + ' ' + (v.author || ''))}" target="_blank" rel="noopener" title="한국어판을 찾아 들어가면 '다른 판(Other editions)'에 영어판 제목이 있습니다">Goodreads (한국어판) ↗</a>
      </div>
      <div class="cmt-actions">
        <button type="button" class="btn small ok" data-act="approved" title="공식 영문판 제목으로 확정">승인</button>
        <button type="button" class="btn small ok" data-act="both" title="아래 저자 영문 이름까지 한 번에 승인">제목·저자 함께 승인</button>
        <button type="button" class="btn small" data-act="none" title="공식 영문판이 없음 — 입력한 직역에 * 을 붙여 노출">공식판 없음 (직역*)</button>
        <button type="button" class="btn small" data-act="hide" title="영문 페이지에서 이 책을 뺌">영문 숨김</button>
        <button type="button" class="btn small" data-act="pending">보류</button>
        <span class="muted small">Ctrl+Enter = 승인</span>
      </div>
      ${autBlock(v, idx)}
    </article>`;
  }).join('');

  // 입력칸은 value 로 넣는다 — 제목 속 따옴표가 HTML을 깨지 않도록
  page.forEach(([k, v], i) => {
    const card = box.children[i];
    const inp = card.querySelector('input[data-f="value"]');
    inp.value = v.value || (v.candidates?.[0]?.title) || stripStar(v.csv);
    markPicked(card, inp.value);
    const ainp = card.querySelector('input[data-f="author"]');
    if (ainp) {
      const { ent: a, values } = autView(v.author || '', idx);
      ainp.value = stripStar(a.value) || a.candidates?.[0]?.name || stripStar(values[0]?.[0]);
      markPickedAuthor(card, ainp.value);
    }
    updateGrLinks(card);
  });
  $('#ttlMoreBtn').classList.toggle('hidden', rows.length <= Ttl.shown);
  $('#ttlMoreBtn').textContent = `더 보기 (${rows.length - Ttl.shown}건 남음)`;
}

// 카드 아래쪽 저자 영문 이름 칸. 승인하면 이 저자의 모든 책(행)이 같은 표기가 된다
function autBlock(v, idx) {
  const name = v.author || '';
  if (!name) return '';
  const { ent: a, values, books, variants } = autView(name, idx);
  const st = a.status || 'pending';
  const cands = a.candidates || [];
  const fl = new Set(st === 'pending' ? (a.flags || []) : []);
  if (st === 'pending' && variants) fl.add('variants');
  const flags = [...fl].map(f => AUT_FLAG[f]
    ? `<span class="ttl-flag ${AUT_FLAG[f][1]}">${AUT_FLAG[f][0]}</span>` : '').join('');
  const conf = a.confidence && a.confidence !== 'none'
    ? `<span class="ttl-conf c-${esc(a.confidence)}" title="확실 = 이 책의 영어판·위키데이터 책 항목에 적힌 저자이거나 두 곳 이상 일치">${a.confidence === 'high' ? '확실' : '후보'}</span>` : '';
  return `<div class="ttl-author">
    <div class="cmt-head">
      ${conf}
      <b>저자 영문</b><span class="muted"> · ${esc(name)} · 책 ${books}권${books > 1 ? ' (승인하면 모두 이 표기로)' : ''}</span>
      <span class="cmt-state s-${st}">${AUT_LABEL[st] || st}${a.auto ? ' (자동)' : ''}</span>
      ${flags}
    </div>
    <p class="ttl-csv">지금 data.csv: ${values.length
      ? values.map(([x, n]) => `<b>${esc(x)}</b>${values.length > 1 ? ` <span class="muted">${n}줄</span>` : ''}`).join(' · ')
      : '<b>(비어 있음)</b>'}</p>
    ${cands.length ? `<div class="ttl-cands">${cands.map((c, i) => `
      <button type="button" class="ttl-cand" data-apick="${i}">
        <span>${esc(c.name)}</span>
        <span class="src">${(c.sources || []).map(x => AUT_SRC[x] || x).join(' + ')}</span>
        ${(c.urls || []).map(u => `<a href="${esc(u)}" target="_blank" rel="noopener">근거 ↗</a>`).join('')}
      </button>`).join('')}</div>` : ''}
    ${(a.notes || []).length ? `<p class="cmt-note">⚠ ${esc(a.notes.join(' · '))}</p>` : ''}
    <div class="ttl-value">
      <input type="text" data-f="author" placeholder="영문 저자 (영어판·인물 문서에 적힌 표기)">
    </div>
    <div class="ttl-links">
      <a data-gr="author" target="_blank" rel="noopener" title="저자 페이지에 적힌 이름 표기를 확인하세요">Goodreads 저자 ↗</a>
      <a data-gr="book" target="_blank" rel="noopener" title="입력한 영문 제목 + 영문 저자로 찾습니다. 영어판이 걸리면 제목과 저자가 둘 다 맞는 것">Goodreads 영어판 (제목+저자) ↗</a>
      <a data-gr="ol" target="_blank" rel="noopener">Open Library 저자 ↗</a>
      <a data-gr="wiki" target="_blank" rel="noopener">위키백과 인물 ↗</a>
    </div>
    <div class="cmt-actions">
      <button type="button" class="btn small ok" data-aact="approved" title="이 저자의 모든 행을 이 표기로 맞춤">저자 승인</button>
      <button type="button" class="btn small" data-aact="none" title="영어판·공식 표기가 없음 — 입력한 로마자 표기에 * 을 붙여 노출">공식 표기 없음 (로마자*)</button>
      <button type="button" class="btn small" data-aact="pending">보류</button>
    </div>
  </div>`;
}

// 검증 링크는 입력칸 값으로 만든다 — 후보를 고르거나 고쳐 치면 바로 그 표기로 찾아진다
function updateGrLinks(card) {
  const t = stripStar(card.querySelector('input[data-f="value"]')?.value);
  const a = stripStar(card.querySelector('input[data-f="author"]')?.value);
  const name = card.dataset.author || '';
  const set = (k, url) => { const el = card.querySelector(`a[data-gr="${k}"]`); if (el) el.href = url; };
  set('author', `https://www.goodreads.com/search?q=${encodeURIComponent(a || name)}&search_type=books&search%5Bfield%5D=author`);
  set('book', `https://www.goodreads.com/search?q=${encodeURIComponent([t, a].filter(Boolean).join(' '))}`);
  set('ol', `https://openlibrary.org/search/authors?q=${encodeURIComponent(a || name)}`);
  set('wiki', `https://ko.wikipedia.org/w/index.php?search=${encodeURIComponent(name)}`);
}

function markPickedAuthor(card, value) {
  const a = Ttl.authors.get(card.dataset.author || '');
  card.querySelectorAll('[data-apick]').forEach(btn => {
    const c = a?.candidates?.[+btn.dataset.apick];
    btn.classList.toggle('picked', !!c && nameKey(c.name) === nameKey(value));
  });
}

function setAutState(card, act, quiet) {
  const name = card.dataset.author || '';
  if (!name) return false;
  const val = stripStar(card.querySelector('input[data-f="author"]')?.value);
  if (act !== 'pending' && !val) { toast('영문 저자가 비어 있습니다', 'err'); return false; }
  const bad = act !== 'pending' && autProblem(val);
  if (bad) { toast(`저자 이름에 ${bad}이(가) 섞여 있습니다`, 'err'); return false; }
  const it = Ttl.authors.get(name) || { author: name, candidates: [] };
  it.status = act;
  it.value = val;
  delete it.auto;
  it.reviewed = new Date().toISOString().slice(0, 10);
  Ttl.authors.set(name, it);
  markTtlDirty(name, true);
  if (applyAuthorsToBooks(new Set([name]))) { renderSidebar(); renderDetail(); }
  if (!quiet) renderTitlesList();
  return true;
}

function markPicked(card, value) {
  const it = Ttl.items.get(card.dataset.key);
  card.querySelectorAll('.ttl-cand').forEach(btn => {
    const c = it?.candidates?.[+btn.dataset.pick];
    btn.classList.toggle('picked', !!c && c.title === value);
  });
}

function setTtlState(card, act, quiet) {
  const key = card.dataset.key;
  const it = Ttl.items.get(key);
  if (!it) return false;
  const val = stripStar(card.querySelector('input[data-f="value"]').value);
  if (act === 'approved' && !val) { toast('영문 제목이 비어 있어 승인할 수 없습니다', 'err'); return false; }
  if (act === 'none' && !val) { toast('직역을 적거나, 영문 페이지에서 빼려면 "영문 숨김"을 누르세요', 'err'); return false; }
  const bad = (act === 'approved' || act === 'none') && ttlProblem(it.title, val);
  if (bad) { toast(`제목에 ${bad}이(가) 섞여 있습니다. 하나로 고쳐 주세요`, 'err'); return false; }
  if (act === 'hide') { it.status = 'none'; it.value = ''; }
  else { it.status = act; it.value = enTitleCase(val); }
  delete it.auto;
  it.reviewed = new Date().toISOString().slice(0, 10);
  markTtlDirty(key);
  if (applyTitlesToBooks(new Set([key]))) { renderSidebar(); renderDetail(); }
  if (!quiet) renderTitlesList();
  return true;
}

$('#ttlList').addEventListener('click', (e) => {
  const card = e.target.closest('.cmt-card');
  if (!card || e.target.closest('a')) return;
  const pick = e.target.closest('[data-pick]');
  if (pick) {
    const it = Ttl.items.get(card.dataset.key);
    const c = it?.candidates?.[+pick.dataset.pick];
    if (c) {
      const inp = card.querySelector('input[data-f="value"]');
      inp.value = c.title;
      markPicked(card, c.title);
      updateGrLinks(card);
      inp.focus();
    }
    return;
  }
  const apick = e.target.closest('[data-apick]');
  if (apick) {
    const c = Ttl.authors.get(card.dataset.author || '')?.candidates?.[+apick.dataset.apick];
    if (c) {
      const inp = card.querySelector('input[data-f="author"]');
      inp.value = c.name;
      markPickedAuthor(card, c.name);
      updateGrLinks(card);
      inp.focus();
    }
    return;
  }
  const aact = e.target.dataset.aact;
  if (aact) { setAutState(card, aact); return; }
  const act = e.target.dataset.act;
  if (act === 'both') {
    // 제목이 막히면(문제 있는 값) 저자도 건드리지 않는다
    if (setTtlState(card, 'approved', true)) setAutState(card, 'approved', true);
    renderTitlesList();
  } else if (act) setTtlState(card, act);
});

$('#ttlList').addEventListener('input', (e) => {
  const card = e.target.closest('.cmt-card');
  if (!card) return;
  if (e.target.dataset.f === 'value') markPicked(card, e.target.value.trim());
  if (e.target.dataset.f === 'author') markPickedAuthor(card, e.target.value.trim());
  updateGrLinks(card);
});

$('#ttlList').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || !(e.ctrlKey || e.metaKey)) return;
  const card = e.target.closest('.cmt-card');
  if (!card) return;
  e.preventDefault();
  if (e.target.dataset.f === 'author') setAutState(card, 'approved');
  else setTtlState(card, 'approved');
});

async function saveTitles() {
  if (!Ttl.touched.size && !Ttl.touchedAuthors.size) return;
  const n = { approved: 0, none: 0, pending: 0 };
  for (const k of Ttl.touched) n[Ttl.items.get(k)?.status in n ? Ttl.items.get(k).status : 'pending']++;
  const na = { approved: 0, none: 0, pending: 0 };
  for (const k of Ttl.touchedAuthors) na[Ttl.authors.get(k)?.status in na ? Ttl.authors.get(k).status : 'pending']++;
  const parts = [];
  if (Ttl.touched.size) parts.push(`승인 ${n.approved} / 공식판 없음 ${n.none} / 보류 ${n.pending}`);
  if (Ttl.touchedAuthors.size) parts.push(`저자 승인 ${na.approved} / 공식 표기 없음 ${na.none} / 보류 ${na.pending}`);
  const message = prompt('커밋 메시지', `영문 제목 검수 — ${parts.join(' · ')}`);
  if (!message) return;

  const btn = $('#ttlSaveBtn');
  btn.disabled = true;
  setTtlStatus('저장 중…');
  try {
    // 워크플로가 그새 후보를 갱신했을 수 있다. 최신 파일을 받아 내가 정한 칸만 덮는다.
    const { content, sha } = await Gh.getFile(TITLES_PATH, { allowMissing: true });
    const doc = content ? JSON.parse(content) : { titles: {} };
    doc.titles = doc.titles || {};
    for (const k of Ttl.touched) {
      const mine = Ttl.items.get(k);
      const base = doc.titles[k] || mine;
      base.status = mine.status;
      base.value = mine.value;
      base.reviewed = mine.reviewed;
      delete base.auto;
      doc.titles[k] = base;
    }
    doc.authors = doc.authors || {};
    for (const k of Ttl.touchedAuthors) {
      const mine = Ttl.authors.get(k);
      const base = doc.authors[k] || { author: k, candidates: [] };
      base.status = mine.status;
      base.value = mine.value;
      base.reviewed = mine.reviewed;
      delete base.auto;
      doc.authors[k] = base;
    }
    doc._updated = new Date().toISOString().slice(0, 10);
    await Gh.putFile({ content: JSON.stringify(doc, null, 2) + '\n', sha, message, path: TITLES_PATH });
    loadTitlesDoc(doc);
    if (applyTitlesToBooks() + applyAuthorsToBooks()) { renderSidebar(); renderDetail(); }
    Ttl.touched.clear();
    Ttl.touchedAuthors.clear();
    Ttl.dirty = false;
    if (!State.dirty && !Cmt.dirty) window.onbeforeunload = null;
    setTtlStatus('저장 완료 — 사이트는 몇 분 뒤 다시 빌드됩니다');
    toast(`영문 제목 저장됨 — 제목 승인 ${n.approved}건 · 저자 승인 ${na.approved}명`, 'ok');
    renderTitlesList();
  } catch (err) {
    setTtlStatus('');
    toast(err.message, 'err');
    btn.disabled = false;
  }
}

/* 직역 한꺼번에 채우기 — 코멘트 검수의 '문장 한꺼번에 채우기'와 같은 방식.
 * 공식판이 없는 책은 사람이 직역을 적어야 하는데 한 권씩 치기엔 많다.
 * 지금 필터의 목록을 통째로 복사해 AI에 맡기고, '키 ⇥ 영문' 결과를 붙여넣는다. */
$('#ttlCopyBtn').addEventListener('click', async () => {
  const rows = ttlRows().map(([k, v]) => {
    const { author_en } = bookLinkFor(v.title);
    return [k, v.title, v.author || '', author_en || '', v.original || '', v.csv || '']
      .map(x => String(x).replace(/[\t\n]+/g, ' ')).join('\t');
  });
  if (!rows.length) { toast('목록이 비어 있습니다', 'err'); return; }
  const tsv = ['키\t도서명\t저자\t저자영문\t원제\t지금CSV', ...rows].join('\n');
  try { await copyToClipboard(tsv); toast(`${rows.length}건 복사됨`, 'ok'); }
  catch (e) { toast('복사 실패: ' + e.message, 'err'); }
});

$('#ttlApplyPasteBtn').addEventListener('click', () => {
  // 키에 '|' 가 들어 있어 탭만 구분자로 본다
  const lines = $('#ttlPaste').value.split(/\r?\n/)
    .map(l => l.trim()).filter(Boolean)
    .map(l => l.split('\t').map(c => c.trim()))
    .filter(c => c[0] && c[0] !== '키');
  const asNone = $('#ttlPasteAsNone').checked;
  const today = new Date().toISOString().slice(0, 10);
  const keys = new Set();
  let miss = 0, bad = 0;
  for (const cols of lines) {
    const it = Ttl.items.get(cols[0]);
    // 영문은 둘째 칸. AI가 칸을 더 붙여 오면 마지막 칸을 쓴다
    const en = stripStar(cols.length > 2 ? cols[cols.length - 1] : cols[1]);
    if (!it || !en) { miss++; continue; }
    if (ttlProblem(it.title, en)) { bad++; continue; }
    it.value = enTitleCase(en);
    if (asNone) { it.status = 'none'; it.reviewed = today; delete it.auto; }
    markTtlDirty(cols[0]);
    keys.add(cols[0]);
  }
  if (!keys.size) {
    toast('채운 게 없습니다 (첫 칸이 "도서명|저자" 키, 둘째 칸이 영문이어야 합니다)', 'err');
    return;
  }
  if (asNone && applyTitlesToBooks(keys)) { renderSidebar(); renderDetail(); }
  renderTitlesList();
  $('#ttlPaste').value = '';
  toast(`${keys.size}건 채움` + (asNone ? ' (공식판 없음 · 직역*)' : ' — 확인 후 버튼을 눌러 주세요')
        + (miss ? ` · ${miss}건은 키를 못 찾음` : '')
        + (bad ? ` · ${bad}건은 설명 문구·한글이 섞여 뺌` : ''), 'ok');
});

$('#titlesBtn').addEventListener('click', openTitlesDialog);
$('#ttlSaveBtn').addEventListener('click', saveTitles);
$('#ttlFilter').addEventListener('change', () => { Ttl.shown = 60; renderTitlesList(); });
$('#ttlSearch').addEventListener('input', () => { Ttl.shown = 60; renderTitlesList(); });
$('#ttlMoreBtn').addEventListener('click', () => { Ttl.shown += 60; renderTitlesList(); });
titlesDlg.addEventListener('close', () => {
  if (Ttl.dirty) toast('영문 제목 검수 결과가 아직 저장되지 않았습니다', 'err');
});

/* -------------------- 분야 검수 (data/genres.json) --------------------
 *
 * 셀럽 페이지 📊 독서 취향의 '주로 읽는 분야'는 tools/taste.py 가 예스24 카테고리로 정한다.
 * 카테고리는 Fetch Book Categories 워크플로가 data/categories.json 에 받아 둔다. 그런데
 * '소설/시/희곡'까지만 있고 아래 단계가 없거나 '고전문학'처럼 형식을 알 수 없는 책,
 * 예스24에 카테고리가 없는 책은 분야를 정할 수 없다. 그런 책을 모아 사람이 고르게 한다.
 *
 * 결과는 data/genres.json 에만 쓴다 — categories.json 은 워크플로 PR이 통째로 갈아 끼우므로
 * 거기 쓰면 다음 수집 때 날아간다. generate.py 는 여기 값을 자동 분류보다 먼저 쓴다.
 */
const GENRES_PATH = 'data/genres.json';
const CATS_PATH = 'data/categories.json';
const CATS_PR_BRANCH = 'chore/categories';   // 아직 머지 안 한 수집 PR 브랜치
// tools/taste.py 의 GENRE_EN 과 같은 목록·순서
const GENRES = ['소설', '시', '에세이', '기타 문학', '인문', '사회', '경제·경영', '자기계발',
  '과학', '실용·생활', '예술', '만화', '여행', '어린이책', '기타'];
const GENRE_EXCLUDE = '제외';
const Gnr = {
  cats: {}, misses: {}, from: '',
  decided: new Map(),   // 도서명 -> { genre, reviewed }
  touched: new Set(),
  loaded: false, dirty: false, shown: 60,
};
const genresDlg = $('#genresDialog');

/* tools/taste.py 의 _Y24_TOP · path_genre() · genre() 와 같은 규칙 (같이 고칠 것).
 * 국내도서 바로 아래 분류 이름(공백 뺀 것)으로 분야를 정하고, 문학·청소년은 아래 단계까지 본다. */
const Y24_TOP = [
  [/소설|시\/?희곡|문학/, 'lit'],
  [/에세이/, '에세이'],
  [/만화|라이트노벨/, '만화'],
  [/자기계발/, '자기계발'],
  [/경제|경영/, '경제·경영'],
  [/인문|역사|종교|인물|철학/, '인문'],
  [/사회|정치/, '사회'],
  [/과학|IT|모바일|컴퓨터/i, '과학'],
  [/가정|살림|건강|취미|요리|외국어|사전|레저|스포츠/, '실용·생활'],
  [/예술|대중문화/, '예술'],
  [/여행/, '여행'],
  [/어린이|유아/, '어린이책'],
  [/청소년/, 'teen'],
  [/잡지|수험|자격증|참고서|교재|전집|대학/, '기타'],
];
const Y24_MALLS = /^(국내도서|외국도서|ebook|중고)$/i;

function y24Lit(names) {
  for (const x of [...names].reverse()) {
    const n = x.replace(/ /g, '');
    if (/소설|노벨/.test(n)) return '소설';
    if (/에세이|수필/.test(n)) return '에세이';
    if (n.endsWith('희곡') && !n.slice(0, -2).includes('시')) return '기타 문학';
    if (n.endsWith('시') || n.startsWith('시/') || /시집|시조/.test(n)) return '시';
  }
  return null;
}
function y24Top(name) {
  const n = name.replace(/ /g, '');
  const hit = Y24_TOP.find(([re]) => re.test(n));
  return hit ? hit[1] : null;
}
function y24PathGenre(path) {
  let p = (path || []).map(x => String(x || '').trim()).filter(Boolean);
  if (p.length && Y24_MALLS.test(p[0].replace(/ /g, ''))) p = p.slice(1);
  if (!p.length) return null;
  const g = y24Top(p[0]);
  const rest = p.slice(1);
  if (g === 'lit') return y24Lit(rest);
  if (g === '만화' && rest.some(x => x.includes('노벨'))) return '소설';
  if (g === 'teen') {
    return y24Lit(rest) || [...rest].reverse().map(y24Top).find(x => x && x !== 'lit' && x !== 'teen') || null;
  }
  return g;
}
// 예스24가 먼저 적은 경로(대표 분류)부터 보고 분야를 정할 수 있는 첫 경로를 쓴다
function y24Genre(cats) {
  for (const c of cats || []) {
    const g = y24PathGenre(c.path || c);
    if (g) return g;
  }
  return null;
}

function setGnrStatus(msg) { $('#gnrStatus').textContent = msg || ''; }

async function loadGenresData() {
  // 카테고리: main 에 없으면(수집 PR을 아직 머지 안 했으면) PR 브랜치에서 읽는다
  let { content } = await Gh.getFile(CATS_PATH, { allowMissing: true });
  Gnr.from = Config.branch;
  if (!content) {
    ({ content } = await Gh.getFile(CATS_PATH, { allowMissing: true, ref: CATS_PR_BRANCH }));
    Gnr.from = CATS_PR_BRANCH;
  }
  if (!content) return false;
  const doc = JSON.parse(content);
  Gnr.cats = doc.books || {};
  Gnr.misses = doc.misses || {};
  const g = await Gh.getFile(GENRES_PATH, { allowMissing: true });
  Gnr.decided.clear();
  for (const [t, v] of Object.entries((g.content && JSON.parse(g.content).genres) || {})) {
    if (v && v.genre) Gnr.decided.set(t, v);
  }
  Gnr.loaded = true;
  return true;
}

async function openGenresDialog() {
  if (!Config.token) { toast('GitHub Token을 먼저 설정하세요', 'err'); settingsDlg.showModal(); return; }
  genresDlg.showModal();
  if (!Gnr.loaded) {
    setGnrStatus('불러오는 중…');
    try {
      if (!(await loadGenresData())) {
        setGnrStatus('');
        $('#gnrList').innerHTML = '<p class="muted small" style="padding:18px 4px;">' +
          '아직 data/categories.json 이 없습니다. Actions → Fetch Book Categories 를 먼저 돌려 주세요.</p>';
        return;
      }
    } catch (err) {
      setGnrStatus('');
      toast('분야 불러오기 실패: ' + err.message, 'err');
      return;
    }
    setGnrStatus(Gnr.from === CATS_PR_BRANCH
      ? `카테고리는 아직 머지 안 한 수집 PR(${CATS_PR_BRANCH})에서 읽었습니다` : '');
  }
  $('#gnrSaveBtn').disabled = !Gnr.dirty;
  Gnr.shown = 60;
  renderGenresList();
}

// 사이트에 나가는 책 → 저자·링크·추천한 셀럽
function siteBooks() {
  const m = new Map();
  for (const c of State.celebs.values()) {
    for (const b of c.books) {
      const t = (b.title || '').trim();
      if (!t) continue;
      if (!m.has(t)) m.set(t, { author: b.author || '', link: b.link || '', celebs: [] });
      if (!m.get(t).celebs.includes(c.name)) m.get(t).celebs.push(c.name);
    }
  }
  return m;
}

function gnrRows() {
  const f = $('#gnrFilter').value;
  const q = $('#gnrSearch').value.trim().toLowerCase();
  const rows = [];
  for (const [t, info] of siteBooks()) {
    const s = Gnr.cats[t];
    const miss = Gnr.misses[t];
    const decided = Gnr.decided.get(t);
    if (!s && !miss && !decided) continue;           // 아직 수집 전
    const auto = s ? y24Genre(s.cats) : null;
    // 대표 분류 말고 다른 카테고리가 다른 분야를 가리키면 '카테고리끼리 다름' (참고용 — 대표 분류를 쓴다)
    const conflict = !!s && new Set((s.cats || []).map(c => y24PathGenre(c.path)).filter(Boolean)).size >= 2;
    const unknown = !!s && !auto;
    const nodata = !s && !!miss;
    const ok = {
      focus: !decided && (unknown || nodata),
      unknown: !decided && unknown, conflict: !decided && conflict, nodata: !decided && nodata,
      done: !!decided, all: !!s || !!decided,
    }[f];
    if (!ok) continue;
    if (q) {
      const hay = [t, info.author, ...(s?.cats || []).map(c => (c.path || []).join(' > '))].join(' ').toLowerCase();
      if (!hay.includes(q)) continue;
    }
    rows.push({ t, info, s, miss, auto, conflict, unknown, nodata, decided });
  }
  // 여러 셀럽이 고른 책일수록 통계에 크게 걸리니 위로
  rows.sort((a, b) => b.info.celebs.length - a.info.celebs.length || a.t.localeCompare(b.t, 'ko'));
  return rows;
}

function renderGenresList() {
  const rows = gnrRows();
  $('#gnrCount').textContent = `이 목록 ${rows.length} · 검수함 ${Gnr.decided.size}`;
  const box = $('#gnrList');
  if (!rows.length) {
    box.innerHTML = '<p class="muted small" style="padding:18px 4px;">해당하는 책이 없습니다.</p>';
    $('#gnrMoreBtn').classList.add('hidden');
    return;
  }
  const page = rows.slice(0, Gnr.shown);
  box.innerHTML = page.map(r => {
    const { t, info, s, miss, auto, decided } = r;
    const who = info.celebs.slice(0, 3).join(', ') + (info.celebs.length > 3 ? ` 외 ${info.celebs.length - 3}명` : '');
    const flags = [r.unknown && '분야 모름', r.conflict && '카테고리끼리 다름', r.nodata && '카테고리 없음']
      .filter(Boolean).map(x => `<span class="ttl-flag">${x}</span>`).join('');
    // 예스24 카테고리 경로 — 첫 줄이 대표 분류
    const ev = s ? (s.cats || []).map((c, i) => {
      const g = y24PathGenre(c.path);
      return `${i ? '' : '<b>'}${esc((c.path || []).join(' > '))}${i ? '' : '</b>'}` +
        ` <span class="muted">→ ${esc(g || '모름')}</span>`;
    }).join('<br>') : `수집 실패: ${esc(miss)}`;
    const cur = decided?.genre || '';
    return `<article class="cmt-card ${cur ? 'approved' : ''}" data-title="${esc(t)}">
      <div class="cmt-head">
        <b>${esc(t)}</b><span class="muted"> · ${esc(info.author)}</span>
        <span class="cmt-state ${cur ? 's-approved' : ''}">${cur ? `검수: ${esc(cur === GENRE_EXCLUDE ? '통계에서 뺌' : cur)}`
          : `자동: ${esc(auto || '모름')}`}</span>
        ${flags}
        <span class="cmt-spacer"></span>
        <span class="muted small">${esc(who)}</span>
      </div>
      <p class="ttl-csv">${ev}</p>
      <div class="ttl-links">
        ${info.link ? `<a href="${esc(info.link)}" target="_blank" rel="noopener">예스24 상품 ↗</a>` : ''}
        <a href="https://www.google.com/search?q=${encodeURIComponent(t + ' ' + info.author + ' 장르')}" target="_blank" rel="noopener">Google 검색 ↗</a>
      </div>
      <div class="gnr-picks">
        ${GENRES.map(g => `<button type="button" class="gnr-pick ${cur === g ? 'picked' : ''} ${!cur && auto === g ? 'auto' : ''}" data-genre="${esc(g)}">${esc(g)}</button>`).join('')}
        <button type="button" class="gnr-pick ${cur === GENRE_EXCLUDE ? 'picked' : ''}" data-genre="${GENRE_EXCLUDE}" title="이 책을 분야 통계에 넣지 않음">통계에서 뺌</button>
        ${cur ? '<button type="button" class="btn small" data-undo="1" title="검수를 지우고 자동 분류로 되돌림">되돌리기</button>' : ''}
      </div>
    </article>`;
  }).join('');
  $('#gnrMoreBtn').classList.toggle('hidden', rows.length <= Gnr.shown);
  $('#gnrMoreBtn').textContent = `더 보기 (${rows.length - Gnr.shown}건 남음)`;
}

$('#gnrList').addEventListener('click', (e) => {
  const card = e.target.closest('.cmt-card');
  if (!card || e.target.closest('a')) return;
  const t = card.dataset.title;
  const pick = e.target.closest('[data-genre]');
  if (pick) Gnr.decided.set(t, { genre: pick.dataset.genre, reviewed: new Date().toISOString().slice(0, 10) });
  else if (e.target.closest('[data-undo]')) Gnr.decided.delete(t);
  else return;
  Gnr.touched.add(t);
  Gnr.dirty = true;
  $('#gnrSaveBtn').disabled = false;
  setGnrStatus(`미저장 변경 ${Gnr.touched.size}건`);
  window.onbeforeunload = () => '저장되지 않은 변경이 있습니다.';
  renderGenresList();
});

async function saveGenres() {
  if (!Gnr.touched.size) return;
  const message = prompt('커밋 메시지', `분야 검수 — ${Gnr.touched.size}권`);
  if (!message) return;
  const btn = $('#gnrSaveBtn');
  btn.disabled = true;
  setGnrStatus('저장 중…');
  try {
    // 최신 파일 위에 이번에 손댄 책만 덮는다
    const { content, sha } = await Gh.getFile(GENRES_PATH, { allowMissing: true });
    const doc = content ? JSON.parse(content) : {};
    doc._note = "편집기 '🏷️ 분야 검수'에서 정한 책 분야. tools/taste.py 가 자동 분류(예스24 카테고리)보다 먼저 쓴다. " +
      "'제외'는 분야 통계에서 뺀다.";
    doc.genres = doc.genres || {};
    for (const t of Gnr.touched) {
      if (Gnr.decided.has(t)) doc.genres[t] = Gnr.decided.get(t);
      else delete doc.genres[t];
    }
    doc.genres = Object.fromEntries(Object.entries(doc.genres).sort((a, b) => a[0].localeCompare(b[0], 'ko')));
    doc._updated = new Date().toISOString().slice(0, 10);
    await Gh.putFile({ content: JSON.stringify(doc, null, 1) + '\n', sha, message, path: GENRES_PATH });
    Gnr.decided.clear();
    for (const [t, v] of Object.entries(doc.genres)) Gnr.decided.set(t, v);
    const n = Gnr.touched.size;
    Gnr.touched.clear();
    Gnr.dirty = false;
    if (!State.dirty && !Cmt.dirty && !Ttl.dirty) window.onbeforeunload = null;
    setGnrStatus('저장 완료 — 사이트는 몇 분 뒤 다시 빌드됩니다');
    toast(`분야 저장됨 — ${n}권`, 'ok');
    renderGenresList();
  } catch (err) {
    setGnrStatus('');
    toast(err.message, 'err');
    btn.disabled = false;
  }
}

$('#genresBtn').addEventListener('click', openGenresDialog);
$('#gnrSaveBtn').addEventListener('click', saveGenres);
$('#gnrFilter').addEventListener('change', () => { Gnr.shown = 60; renderGenresList(); });
$('#gnrSearch').addEventListener('input', () => { Gnr.shown = 60; renderGenresList(); });
$('#gnrMoreBtn').addEventListener('click', () => { Gnr.shown += 60; renderGenresList(); });
genresDlg.addEventListener('close', () => {
  if (Gnr.dirty) toast('분야 검수 결과가 아직 저장되지 않았습니다', 'err');
});

/* -------------------- 책 이름 통일 --------------------
 *
 * 같은 책인데 줄마다 이름이 갈린 경우를 찾아 하나로 맞춘다.
 *  · 영문 제목이 갈린 책: 도서명(한국어)은 같은데 도서명_en이 줄마다 다르다.
 *    영문 셀럽 페이지는 줄마다 제 값을 쓰므로 같은 책이 사람마다 다른 이름으로 나간다.
 *    generate.py 는 검수 완료(🔤 영문 제목 검수)된 값을 CSV보다 먼저 쓰므로 그것도 함께 맞춘다.
 *  · 한국어 제목이 다른 같은 책: '어린왕자'/'어린 왕자'처럼 띄어쓰기·부호만 다르거나
 *    영문 제목이 같은 경우. 책 페이지가 둘로 쪼개지고 '여러 명이 읽은 책'에서 빠진다.
 * '다른 책임'으로 뺀 묶음은 이 브라우저에 기억한다.
 */
const uniDlg = $('#unifyDialog');
const Uni = {
  ignored: new Set(JSON.parse(LS.get('unifyIgnore', '[]') || '[]')),
  changed: 0,
};
const uniNormKo = (t) => String(t || '').replace(/\s*[\(\[][^)\]]*[\)\]]\s*$/, '')
  .replace(/[\s·.,:;!?'"“”‘’\-–—~…]/g, '').toLowerCase();
const uniNormEn = (t) => stripStar(t).toLowerCase().normalize('NFKD')
  .replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]/gu, '');

function uniRows() {
  const byTitle = new Map();   // 도서명 -> [{celeb, b}]
  for (const name of State.order) {
    const c = State.celebs.get(name);
    if (!c) continue;
    for (const b of c.books) {
      const t = (b.title || '').trim();
      if (!t) continue;
      if (!byTitle.has(t)) byTitle.set(t, []);
      byTitle.get(t).push({ celeb: name, b });
    }
  }
  return byTitle;
}

function uniEnGroups(byTitle) {
  const out = [];
  for (const [title, rows] of byTitle) {
    const v = new Map();
    for (const r of rows) {
      const en = (r.b.title_en || '').trim();
      if (!en) continue;
      if (!v.has(en)) v.set(en, []);
      v.get(en).push(r);
    }
    if (v.size < 2) continue;
    const info = uniTtlInfo(title);
    const score = (en) => {
      if ([...info.approved].some(x => uniSame(x, en))) return 0;          // 검수 승인
      const c = [...info.cands.values()].find(x => uniSame(x.title, en));
      if (c && c.verified) return 1;                                      // 영어판 확인된 후보
      if (c) return 2;                                                    // 후보
      return en.endsWith('*') ? 4 : 3;                                    // CSV에만 / 직역
    };
    const variants = [...v.entries()].map(([en, rs]) => ({ en, rows: rs, score: score(en) }))
      .sort((a, b) => a.score - b.score || b.rows.length - a.rows.length);
    // 지금 쓰인 값에는 없지만 근거가 있는 후보도 고를 수 있게 붙인다
    const extra = [...info.cands.values()].filter(c => !variants.some(x => uniSame(x.en, c.title)))
      .sort((a, b) => b.verified - a.verified);
    out.push({ kind: 'en', key: 'en|' + title, title, rows, variants, extra, info });
  }
  return out;
}

function uniKoGroups(byTitle) {
  // 띄어쓰기·부호만 다른 것, 영문 제목이 같은 것을 한 묶음으로 (union-find)
  const titles = [...byTitle.keys()];
  const parent = new Map(titles.map(t => [t, t]));
  const find = (t) => { while (parent.get(t) !== t) t = parent.get(t); return t; };
  const why = new Map();
  const join = (a, b, reason) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent.set(rb, ra);
    why.set(a, why.get(a) || reason); why.set(b, why.get(b) || reason);
  };
  const byKo = new Map(), byEn = new Map();
  for (const t of titles) {
    const k = uniNormKo(t);
    if (k) { if (byKo.has(k)) join(byKo.get(k), t, 'ko'); else byKo.set(k, t); }
    for (const r of byTitle.get(t)) {
      const e = uniNormEn(r.b.title_en);
      if (e.length < 4) continue;
      if (byEn.has(e) && byEn.get(e) !== t) join(byEn.get(e), t, 'en'); else byEn.set(e, t);
    }
  }
  const groups = new Map();
  for (const t of titles) {
    const r = find(t);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(t);
  }
  const out = [];
  for (const ts of groups.values()) {
    if (ts.length < 2) continue;
    ts.sort((a, b) => byTitle.get(b).length - byTitle.get(a).length || a.length - b.length);
    const key = 'ko|' + [...ts].sort().join('|');
    const sameKo = new Set(ts.map(uniNormKo)).size === 1;
    out.push({ kind: 'ko', key, titles: ts, byTitle, reason: sameKo ? 'ko' : 'en' });
  }
  return out;
}

function uniGroups() {
  const byTitle = uniRows();
  const f = $('#uniFilter').value;
  let gs = f === 'en' ? uniEnGroups(byTitle) : uniKoGroups(byTitle);
  gs = gs.filter(g => !Uni.ignored.has(g.key));
  const q = $('#uniSearch').value.trim().toLowerCase();
  if (q) {
    gs = gs.filter(g => {
      const rows = g.kind === 'en' ? g.rows : g.titles.flatMap(t => g.byTitle.get(t));
      const hay = rows.map(r => [r.celeb, r.b.title, r.b.title_en, r.b.author, r.b.author_en].join(' ')).join(' ');
      return hay.toLowerCase().includes(q);
    });
  }
  return gs;
}

// 영문 제목 검수 파일(titles_en.json)에서 이 도서명의 검수 상태·후보·메모를 모은다.
// 같은 도서명이 저자 표기만 달리 여러 칸일 수 있어 모두 합친다.
function uniTtlInfo(title) {
  const info = { approved: new Set(), none: new Set(), cands: new Map(), notes: [], original: '' };
  for (const [k, v] of Ttl.items) {
    if (k.slice(0, k.lastIndexOf('|')) !== title) continue;
    const val = stripStar(v.value);
    if (val && v.status === 'approved') info.approved.add(enTitleCase(val));
    if (val && v.status === 'none') info.none.add(enTitleCase(val) + ' *');
    for (const c of v.candidates || []) {
      const t = enTitleCase(c.title);
      const cur = info.cands.get(t) || { title: t, sources: new Set(), urls: new Set(), verified: false };
      (c.sources || []).forEach(x => cur.sources.add(x));
      (c.urls || []).forEach(x => cur.urls.add(x));
      cur.verified = cur.verified || !!c.verified;
      info.cands.set(t, cur);
    }
    (v.notes || []).forEach(n => { if (!info.notes.includes(n)) info.notes.push(n); });
    if (v.original && !info.original) info.original = v.original;
  }
  return info;
}

const uniSame = (a, b) => stripStar(a).toLowerCase() === stripStar(b).toLowerCase();

// 한 영문 제목 값에 붙일 근거 배지
function uniEnBadges(value, info) {
  const out = [];
  if ([...info.approved].some(v => uniSame(v, value)) && !/\*\s*$/.test(value))
    out.push('<span class="ttl-conf c-high" title="🔤 영문 제목 검수에서 승인한 값">검수 승인</span>');
  if ([...info.none].some(v => uniSame(v, value)))
    out.push('<span class="ttl-flag" title="공식 영문판이 없다고 검수한 직역">검수: 공식판 없음</span>');
  const c = [...info.cands.values()].find(x => uniSame(x.title, value));
  if (c) {
    out.push(`<span class="src">${[...c.sources].map(x => TTL_SRC[x] || x).join(' + ')}</span>`);
    if (c.verified) out.push('<span class="ok" title="Open Library에 같은 제목·저자의 영어판이 있음">✓ 확인</span>');
    [...c.urls].forEach(u => out.push(`<a href="${esc(u)}" target="_blank" rel="noopener">근거 ↗</a>`));
  } else if (/\*\s*$/.test(value)) {
    out.push('<span class="ttl-flag" title="끝의 *는 공식판이 없어 직역했다는 표시">직역*</span>');
  } else if (!out.length) {
    out.push('<span class="uni-why">근거 없음 (data.csv에만 있는 값)</span>');
  }
  return out.join(' ');
}

// 예스24 상품 번호 — 같은 번호면 같은 판, 다르면 다른 판(개정판·다른 출판사)일 수 있다
const uniGoodsId = (link) => (String(link || '').match(/goods\/(\d+)/) || [])[1] || '';

function uniBookLinks(title, b) {
  const q = encodeURIComponent(`${stripStar(b.author_en) || b.author || ''} "${title}" English translation`);
  return `<div class="ttl-links">
    ${b.link ? `<a href="${esc(b.link)}" target="_blank" rel="noopener">예스24 상품 ↗</a>` : ''}
    <a href="https://www.google.com/search?q=${q}" target="_blank" rel="noopener">Google 검색 ↗</a>
    <a href="https://www.goodreads.com/search?q=${encodeURIComponent(title + ' ' + (b.author || ''))}" target="_blank" rel="noopener">Goodreads ↗</a>
  </div>`;
}

const uniWho = (rows) => {
  const names = [...new Set(rows.map(r => r.celeb))];
  return esc(names.slice(0, 6).join(', ')) + (names.length > 6 ? ` 외 ${names.length - 6}명` : '');
};

function renderUnifyList() {
  const gs = uniGroups();
  const f = $('#uniFilter').value;
  $('#uniCount').textContent = `${gs.length}건`;
  if (!gs.length) {
    $('#uniList').innerHTML = '<p class="muted small" style="padding:18px 4px;">맞출 것이 없습니다 👍</p>';
    return;
  }
  $('#uniList').innerHTML = gs.map((g, gi) => {
    if (g.kind === 'en') {
      const b0 = g.rows[0].b;
      return `<div class="cmt-card" data-g="${gi}" data-key="${esc(g.key)}">
        <div><b>${esc(g.title)}</b> <span class="uni-why">· ${esc(b0.author || '')} · ${g.rows.length}줄</span></div>
        ${g.info.original ? `<p class="ttl-csv">원제 <b>${esc(g.info.original)}</b></p>` : ''}
        <div class="uni-opts">${g.variants.map((v, i) => `
          <label class="uni-opt"><input type="radio" name="uni${gi}" value="${esc(v.en)}" ${i === 0 ? 'checked' : ''}>
            <span><b>${esc(v.en)}</b> <span class="uni-why">지금 ${v.rows.length}줄</span>
            <span class="uni-ev">${uniEnBadges(v.en, g.info)}</span>
            <span class="who">${uniWho(v.rows)}</span></span></label>`).join('')}
          ${g.extra.map(c => `
          <label class="uni-opt cand"><input type="radio" name="uni${gi}" value="${esc(c.title)}">
            <span><b>${esc(c.title)}</b> <span class="uni-why">후보 (지금 쓰는 줄 없음)</span>
            <span class="uni-ev">${uniEnBadges(c.title, g.info)}</span></span></label>`).join('')}
          <input class="uni-custom" type="text" placeholder="직접 고쳐 쓰기 (비우면 위에서 고른 제목)" value="">
        </div>
        ${g.info.notes.length ? `<p class="cmt-note">⚠ ${esc(g.info.notes.join(' · '))}</p>` : ''}
        ${uniBookLinks(g.title, b0)}
        <div class="uni-actions">
          <button type="button" class="btn small" data-act="ignore">다른 책임</button>
          <button type="button" class="btn small primary" data-act="apply-en">이걸로 통일</button>
        </div></div>`;
    }
    const firsts = g.titles.map(t => g.byTitle.get(t)[0].b);
    const uniq = (f) => new Set(firsts.map(f).filter(Boolean)).size;
    const authors = uniq(b => (b.author || '').replace(/\s/g, ''));
    const pubs = uniq(b => (b.publisher || '').replace(/\s/g, ''));
    const goods = uniq(b => uniGoodsId(b.link));
    const allGoods = firsts.every(b => uniGoodsId(b.link));
    const ev = [
      authors <= 1 ? '<span class="ok">저자 같음</span>' : '<span class="ttl-flag bad">저자 다름</span>',
      pubs <= 1 ? '<span class="ok">출판사 같음</span>' : '<span class="ttl-flag">출판사 다름 (다른 판일 수 있음)</span>',
      allGoods ? (goods === 1 ? '<span class="ok">예스24 상품 번호 같음</span>'
                              : '<span class="ttl-flag">예스24 상품 번호 다름</span>') : '',
    ].filter(Boolean).join(' ');
    return `<div class="cmt-card" data-g="${gi}" data-key="${esc(g.key)}">
      <div class="uni-why">${g.reason === 'ko' ? '띄어쓰기·부호만 다름' : '영문 제목이 같음 — 다른 책일 수도 있으니 확인하세요'}</div>
      <div class="uni-ev" style="margin-top:4px">근거: ${ev}</div>
      <div class="uni-opts">${g.titles.map((t, i) => {
        const rows = g.byTitle.get(t), b = rows[0].b;
        return `<label class="uni-opt"><input type="radio" name="uni${gi}" value="${esc(t)}" ${i === 0 ? 'checked' : ''}>
          ${b.cover ? `<img src="${esc(b.cover)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}
          <span><b>${esc(t)}</b> <span class="uni-why">${esc(b.author || '')}${b.publisher ? ' · ' + esc(b.publisher) : ''} · ${rows.length}줄</span>
          <span class="who">${esc(b.title_en || '')}${b.title_en ? ' — ' : ''}${uniWho(rows)}</span>
          <span class="who">${b.link ? `<a href="${esc(b.link)}" target="_blank" rel="noopener">예스24 상품${uniGoodsId(b.link) ? ' #' + uniGoodsId(b.link) : ''} ↗</a>` : '상품 링크 없음'}</span></span></label>`;
      }).join('')}</div>
      <div class="uni-actions">
        <button type="button" class="btn small" data-act="ignore">다른 책임</button>
        <button type="button" class="btn small primary" data-act="apply-ko">고른 제목으로 합치기</button>
      </div></div>`;
  }).join('');
  uniDlg._groups = gs;
}

function uniMarkChanged(n, msg) {
  Uni.changed += n;
  setDirty(true);
  $('#uniSaveBtn').disabled = false;
  $('#uniStatus').textContent = `미저장 변경 ${Uni.changed}줄`;
  toast(msg, 'ok');
  renderSidebar(); renderDetail(); renderUnifyList();
}

function uniApplyEn(g, value) {
  const today = new Date().toISOString().slice(0, 10);
  let n = 0;
  for (const r of g.rows) {
    if ((r.b.title_en || '') !== value) { r.b.title_en = value; n++; }
    // 검수 완료된 값은 CSV보다 먼저 나가므로 그것도 맞춘다
    const k = `${r.b.title}|${r.b.author || ''}`;
    const ent = Ttl.items.get(k);
    if (ent && (ent.status === 'approved' || ent.status === 'none')) {
      const star = /\*\s*$/.test(value);
      const nv = stripStar(value);
      if (ent.value !== nv || ent.status !== (star ? 'none' : 'approved')) {
        ent.value = nv; ent.status = star ? 'none' : 'approved'; ent.reviewed = today;
        markTtlDirty(k);
      }
    }
  }
  uniMarkChanged(n, `영문 제목을 "${value}"(으)로 맞췄습니다 (${n}줄)`);
}

function uniApplyKo(g, keep) {
  let n = 0, dup = 0;
  for (const t of g.titles) {
    if (t === keep) continue;
    for (const r of g.byTitle.get(t)) {
      const c = State.celebs.get(r.celeb);
      if (c && c.books.some(x => x !== r.b && x.title === keep)) dup++;
      r.b.title = keep; n++;
    }
  }
  uniMarkChanged(n, `도서명을 "${keep}"(으)로 합쳤습니다 (${n}줄)` +
    (dup ? ` — ${dup}명은 같은 책이 두 번 들어가 있어요. '중복 도서' 필터로 확인하세요` : ''));
}

async function openUnifyDialog() {
  if (!State.celebs.size) { toast('먼저 ↻ 불러오기로 데이터를 가져오세요', 'err'); return; }
  uniDlg.showModal();
  // 검수 완료된 영문 제목도 함께 맞춰야 해서 검수 파일을 읽어 둔다
  if (!Ttl.loaded && Config.token) {
    try {
      const doc = await fetchTitlesDoc();
      if (doc) { for (const [k, v] of Object.entries(doc.titles || {})) Ttl.items.set(k, v); Ttl.loaded = true; }
    } catch (err) { console.warn('영문 제목 검수 파일 읽기 실패', err); }
  }
  $('#uniSaveBtn').disabled = !(State.dirty || Ttl.dirty);
  renderUnifyList();
}

$('#uniList').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const card = btn.closest('.cmt-card');
  const g = uniDlg._groups[+card.dataset.g];
  if (btn.dataset.act === 'ignore') {
    Uni.ignored.add(g.key);
    LS.set('unifyIgnore', JSON.stringify([...Uni.ignored]));
    renderUnifyList();
    return;
  }
  const picked = card.querySelector('input[type="radio"]:checked')?.value || '';
  if (btn.dataset.act === 'apply-en') {
    const custom = card.querySelector('.uni-custom').value.trim();
    const v = custom ? enTitleCase(custom) : picked;
    if (!v) return;
    uniApplyEn(g, v);
  } else {
    if (!picked) return;
    uniApplyKo(g, picked);
  }
});

// 저장: data.csv 는 드래프트에, (바뀐 게 있으면) 영문 제목 검수 파일은 바로 커밋한다
$('#uniSaveBtn').addEventListener('click', async () => {
  const csv = State.dirty;
  if (State.dirty) await saveDraft();
  if (Ttl.dirty) await saveTitles();
  if (!State.dirty && !Ttl.dirty) {
    Uni.changed = 0;
    $('#uniSaveBtn').disabled = true;
    $('#uniStatus').textContent = csv
      ? '저장 완료 — data.csv는 드래프트에 들어갔습니다. 🚀 발행해야 사이트에 반영됩니다'
      : '저장 완료 — 사이트는 몇 분 뒤 다시 빌드됩니다';
  }
});
$('#unifyBtn').addEventListener('click', openUnifyDialog);
$('#uniFilter').addEventListener('change', renderUnifyList);
$('#uniSearch').addEventListener('input', renderUnifyList);

(function init() {
  updateDraftUi();
  if (!Config.token) {
    loadSettingsToForm();
    settingsDlg.showModal();
    setStatus('설정을 입력한 뒤 ↻ 불러오기로 시작하세요.');
  } else {
    reloadFromGithub();
  }
})();
