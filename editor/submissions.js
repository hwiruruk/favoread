/* 📮 제보 반영 — 구글 폼 제보 시트(영문·해외) 두 개를 읽어 책을 반영하고, 시트에 처리 상태를 적는다.
 *
 *  읽기  : 공개 시트의 CSV 내보내기 (로그인 불필요)
 *  쓰기  : 시트에 붙인 Apps Script 웹앱 (tools/submissions/Code.gs) — '반영' 체크 + 행 전체 색
 *          파랑 = 반영, 노랑 = 보류, 빨강 = 미반영
 *  판정  : 제보의 셀럽에게 같은 책이 있고, 제보에 적힌 주소가 그 책의 출처와 같으면 '반영'
 *          (제보에 주소가 없으면 책만 맞으면 '반영')
 *  기록  : 셀럽 매칭·AI 정리 결과·책별 결정(제외/이대로 OK)은 data/submissions.json 에 커밋
 *
 * app.js 의 State·Gh·Yes24·toast 등을 쓰므로 app.js 뒤에, 순수 로직(submissions_core.js) 뒤에 불러온다.
 * 사용법은 editor/README.md '제보 반영' 절. */
(function () {
  'use strict';
  const C = window.SubsCore;

  const SHEETS = [
    // gid = 폼 응답 탭. 탭을 더 만들어도 이 탭을 읽고, 카드의 '시트에서 보기'도 이 탭의 그 줄로 간다
    { id: 'en', label: '영문 제보', sheetId: '1J4B0pa2Hv3l4nNfzMwghqWHdXT7cUbFZE3gPY1gCzvk', gid: '1827106597' },
    { id: 'intl', label: '해외 제보', sheetId: '186gKVna6LANvKkdvqJF7V3MTSZdDgI3xksmOgY4WtGM', gid: '1023767186' },
  ];
  const STORE_PATH = 'data/submissions.json';
  const PAGE = 20;
  const ST = { done: '반영', hold: '보류', todo: '미반영' };
  const ST_CLASS = { '반영': 'done', '보류': 'hold', '미반영': 'todo', '': 'new' };
  const SubCfg = {
    get script() { return LS.get('subsScript'); },
    get key() { return LS.get('subsKey'); },
  };

  const dlg = $('#subsDialog');
  const S = {
    rows: [],                 // [{ key, sheet, row, ts, name, text, source, sheetStatus, sheetNote }]
    loadedAt: null,
    store: null,              // { aliases, rows: { key: { celeb, ai, dec: { i: 'skip'|'ok' } } } }
    storeSha: null,
    storeTimer: null,
    storeQueue: Promise.resolve(),
    realNames: {},
    shown: PAGE,
    timer: null,
    search: new Map(),        // 예스24 검색 결과 캐시 (query → items)
    memo: new Map(),          // 화면에서 고친 메모 (행키#책번호 → 글)
    searching: new Set(),
    writing: false,
    pubCelebs: null, pubFor: null,
  };

  const setStatus = (m) => { $('#subsStatus').textContent = m || ''; };

  /* ---------------- 시트 읽기 ---------------- */
  // '2026. 4. 8 오후 2:46:30' → 시각 (정렬용)
  function parseTs(ts) {
    const m = /(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.?\s*(오전|오후|AM|PM)?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?/i.exec(ts || '');
    if (!m) return Date.parse(ts) || 0;
    let h = Number(m[5]);
    if (/오후|PM/i.test(m[4] || '') && h < 12) h += 12;
    if (/오전|AM/i.test(m[4] || '') && h === 12) h = 0;
    return new Date(+m[1], m[2] - 1, +m[3], h, +m[6], +(m[7] || 0)).getTime();
  }

  async function fetchSheet(sh) {
    const u = `https://docs.google.com/spreadsheets/d/${sh.sheetId}/export?format=csv&gid=${sh.gid}&_=${Date.now()}`;
    const r = await fetch(u, { cache: 'no-store' });
    if (!r.ok) throw new Error(`${sh.label} 시트를 못 읽었어요 (HTTP ${r.status}) — 링크 공유가 '링크가 있는 모든 사용자'인지 확인하세요`);
    const text = await r.text();
    const rows = Papa.parse(text, { skipEmptyLines: false }).data;
    const head = (rows[0] || []).map(h => String(h || '').trim());
    const ci = (name) => head.findIndex(h => h === name);
    const cCheck = ci('반영'), cState = ci('상태'), cNote = ci('편집기 메모');
    const out = [];
    for (let i = 1; i < rows.length; i++) {
      const r0 = rows[i];
      if (!r0 || !r0.slice(0, 4).some(x => String(x || '').trim())) continue;
      const ts = String(r0[0] || '').trim();
      let st = cState >= 0 ? String(r0[cState] || '').trim() : '';
      if (!st && cCheck >= 0 && /^true$/i.test(String(r0[cCheck] || '').trim())) st = ST.done;
      if (!(st in ST_CLASS)) st = '';
      out.push({
        key: `${sh.id}|${ts}|${C.norm(r0[1]).slice(0, 20)}`,
        sheet: sh.id, sheetLabel: sh.label, row: i + 1, ts,
        name: String(r0[1] || '').trim(), text: String(r0[2] || ''), source: String(r0[3] || ''),
        sheetStatus: st, sheetNote: cNote >= 0 ? String(r0[cNote] || '') : '',
        time: parseTs(ts),
      });
    }
    return out;
  }

  async function loadSheets({ quiet = false } = {}) {
    if (!quiet) setStatus('시트 불러오는 중…');
    try {
      const all = await Promise.all(SHEETS.map(fetchSheet));
      S.rows = all.flat();
      S.loadedAt = new Date();
      evaluateAll();
      render();
      setStatus(`시트 ${S.rows.length}건 · ${S.loadedAt.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })} 갱신`);
      if ($('#subsAutoWrite').checked && SubCfg.script) await writePending({ quiet: true });
    } catch (err) {
      setStatus('');
      toast(err.message, 'err');
    }
  }

  /* ---------------- 기록 파일 (data/submissions.json) ---------------- */
  async function loadStore() {
    if (S.store) return;
    S.store = { aliases: {}, rows: {} };
    try {
      // 기록은 사이트(main)가 아니라 notes/editor 브랜치에 둔다 (예전에 main 에 저장한 게 있으면 그걸로 시작)
      const { content, sha } = await EditorNotes.get(STORE_PATH, { fallbackMain: true });
      S.storeSha = sha;
      if (content) {
        const j = JSON.parse(content);
        S.store.aliases = j.aliases || {};
        S.store.rows = j.rows || {};
      }
    } catch (err) {
      toast('제보 기록(data/submissions.json) 불러오기 실패: ' + err.message, 'err');
    }
    // 저장 못 하고 닫았던 변경 되살리기 (이 브라우저 보관분)
    const bk = readBackup();
    if (bk) {
      mergeStore(S.store, bk);
      S.storeDirty = true;
      showStoreState();
      toast('저장 안 된 제보 기록·메모를 되살렸어요', 'ok');
    }
    try {
      const r = await fetch('../data/real_names.json', { cache: 'no-cache' });
      if (r.ok) { const j = await r.json(); delete j._comment; S.realNames = j; }
    } catch (e) { /* 본명 없이도 동작 */ }
  }
  function rowStore(key, create = false) {
    let v = S.store.rows[key];
    if (!v && create) v = S.store.rows[key] = {};
    return v || {};
  }
  /* 저장은 손을 놓았을 때 한 번에 — 키보드·마우스 입력이 5분 동안 없으면 저장한다 (notepad.js 의 EditorIdle).
   * 그 전까지 바뀐 기록은 이 브라우저에 보관해 두고, 창을 닫거나 💾 를 누르면 바로 저장한다. */
  const BK = 'favoread.subsStoreBackup';
  function readBackup() { try { return JSON.parse(localStorage.getItem(BK) || 'null'); } catch (e) { return null; } }
  function writeBackup() {
    try {
      if (S.storeDirty) localStorage.setItem(BK, JSON.stringify({ aliases: S.store.aliases, rows: S.store.rows, at: Date.now() }));
      else localStorage.removeItem(BK);
    } catch (e) { /* 꽉 참 등 */ }
  }
  // 다른 곳 기록에 내 기록을 얹는다 — 같은 행은 내 값이 이긴다
  function mergeStore(base, mine) {
    Object.assign(base.aliases, mine.aliases || {});
    for (const [k, v] of Object.entries(mine.rows || {})) base.rows[k] = Object.assign({}, base.rows[k] || {}, v);
    return base;
  }
  function showStoreState() {
    const el = $('#subsStoreState');
    if (!el || !S.storeDirty) return;
    el.textContent = `기록 저장 안 됨 · 손 놓고 ${Math.ceil(EditorIdle.left() / 60000)}분 뒤 자동 저장`;
    el.classList.add('unsaved');
  }
  setInterval(showStoreState, 15000);
  function saveStoreSoon() {
    S.storeDirty = true;
    writeBackup();
    showStoreState();
  }
  EditorIdle.register('submissions', { isDirty: () => !!S.store && S.storeDirty, save: () => flushStore() });
  // 기다리지 않고 바로 저장 (💾 버튼, 창 닫을 때)
  function flushStore() {
    if (!S.storeDirty) return S.storeQueue;
    S.storeDirty = false;
    S.storeQueue = S.storeQueue.then(saveStore).then(() => { if (!S.storeDirty) writeBackup(); }).catch(err => {
      S.storeDirty = true;
      showStoreState();
      toast('제보 기록 저장 실패 — 이 브라우저에는 보관돼 있어요: ' + err.message, 'err');
    });
    return S.storeQueue;
  }
  async function saveStore() {
    if (!Config.token) { $('#subsStoreState').textContent = 'GitHub Token이 없어 기록을 저장하지 못했어요'; return; }
    // 빈 항목은 지운다
    for (const [k, v] of Object.entries(S.store.rows)) {
      if (v.dec && !Object.keys(v.dec).length) delete v.dec;
      if (v.src && !Object.keys(v.src).length) delete v.src;
      if (!v.wip) delete v.wip;
      if (!v.memo) { delete v.memo; if (!v.wip) delete v.memoAt; }
      if (!Object.keys(v).length) delete S.store.rows[k];
    }
    const doc = {
      _comment: '편집기 📮 제보 반영 창의 기록. 시트 행(키: 시트|타임스탬프|이름)마다 고른 셀럽(celeb), AI 정리 결과(ai), 책별 결정(dec: 제외 skip / 이대로 OK ok), 책별로 고른 출처 링크(src), 내 조사 메모(memo, memoAt)와 조사 중 표시(wip). aliases 는 제보에 적힌 이름 → data.csv 셀럽 이름. notes/editor 브랜치에만 저장돼 사이트에는 안 나간다.',
      _updated: new Date().toISOString().slice(0, 10),
      aliases: S.store.aliases,
      rows: S.store.rows,
    };
    const stateEl = $('#subsStoreState');
    stateEl.textContent = '기록 저장 중…';
    const done = () => {
      stateEl.textContent = `기록 저장됨 · ${new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}`;
      stateEl.classList.remove('unsaved');
      $$('.sub-memo-state.unsaved', dlg).forEach(el => { el.classList.remove('unsaved'); el.textContent = '저장됨'; });
    };
    try {
      const { sha } = await EditorNotes.put(STORE_PATH, JSON.stringify(doc, null, 1) + '\n', S.storeSha, '제보 반영 기록 갱신');
      S.storeSha = sha;
      done();
    } catch (err) {
      if (!err.conflict && !/변경|conflict|409/i.test(err.message)) { stateEl.textContent = ''; throw err; }
      // 다른 컴퓨터에서 먼저 저장했다 — 그쪽 기록에 내 기록을 얹어서 다시 저장
      const remote = await EditorNotes.get(STORE_PATH);
      const base = remote.content ? JSON.parse(remote.content) : {};
      const merged = mergeStore({ aliases: base.aliases || {}, rows: base.rows || {} }, S.store);
      S.store.aliases = merged.aliases; S.store.rows = merged.rows;
      doc.aliases = merged.aliases; doc.rows = merged.rows;
      const r = await EditorNotes.put(STORE_PATH, JSON.stringify(doc, null, 1) + '\n', remote.sha, '제보 반영 기록 갱신 (다른 곳 기록과 합침)');
      S.storeSha = r.sha;
      done();
      evaluateAll(); scheduleRender();
    }
  }

  /* ---------------- 판정 ---------------- */
  function publishedCelebs() {
    if (!State.published) return State.celebs;
    if (S.pubFor !== State.published) { S.pubFor = State.published; S.pubCelebs = State.published.celebs; }
    return S.pubCelebs;
  }

  function evaluate(r) {
    const st = rowStore(r.key);
    const parsed = C.parseSubmission(r.text, r.source);
    const p = st.ai && st.ai.kind !== 'fix' && st.ai.kind !== 'other' && (st.ai.books || []).length ? C.fromAi(st.ai, parsed) : parsed;
    r.parsed = p;
    r.kind = st.ai ? st.ai.kind : (p.books.length ? 'books' : 'other');
    r.aiNote = st.ai ? st.ai.note || '' : '';
    r.memo = st.memo || '';
    r.wip = !!st.wip;
    r.cands = C.matchCeleb(r.name, State.celebs, { aliases: S.store.aliases, realNames: S.realNames });
    r.celeb = st.celeb && State.celebs.has(st.celeb) ? st.celeb : C.autoCeleb(r.cands);
    r.celebPicked = !!st.celeb;
    const c = State.celebs.get(r.celeb);
    const pc = publishedCelebs().get(r.celeb);
    const dec = st.dec || {};
    const pick = st.src || {};
    r.allUrls = p.allUrls || [];
    r.books = p.books.map((b0, i) => {
      // 'as:제목' — 이 후보를 그 제목의 책으로 추가했다 (AI 정리 제목과 예스24 제목이 다를 때)
      const d = dec[i] || '';
      let b = d.startsWith('as:') ? Object.assign({}, b0, { segs: [...(b0.segs || []), d.slice(3)] }) : b0;
      // 이 책의 출처 링크를 직접 골랐으면 그것 ('' = 링크 없음)
      const picked = Object.prototype.hasOwnProperty.call(pick, i);
      if (picked) b = Object.assign({}, b, { urls: pick[i] ? [pick[i]] : [] });
      const check = (cel) => {
        const x = C.checkBook(cel, b);
        // 형식이 자유로워 자동으로 붙인 링크가 틀릴 수 있다 — 제보 칸의 다른 링크와 맞으면 반영으로 본다
        if (x.state === 'src' && !picked && r.allUrls.length) {
          const y = C.checkBook(cel, Object.assign({}, b, { urls: r.allUrls }));
          if (y.state === 'ok') return Object.assign(y, { viaOther: true });
        }
        return x;
      };
      const now = check(c);
      const pub = check(pc);
      let state = now.state;
      if (d === 'skip') state = 'skip';
      else if (d === 'ok' && state !== 'miss') state = 'ok';
      const live = d === 'skip' || (state === 'ok' && (pub.state === 'ok' || (d === 'ok' && pub.state !== 'miss')));
      return Object.assign({}, b, { i, state, idx: now.idx, cur: now.book, live, dec: d, picked, viaOther: !!now.viaOther });
    });
    if (!r.books.length) r.calc = '?';
    else if (r.books.every(b => b.state === 'ok' || b.state === 'skip')) r.calc = r.books.every(b => b.live) ? 'live' : 'edit';
    else r.calc = 'todo';
    r.okCount = r.books.filter(b => b.state === 'ok').length;
    // 시트에 적을 상태 — 발행본에 들어간 것만 '반영'
    r.want = r.calc === 'live' ? ST.done : ST.todo;
    r.mismatch = r.sheetStatus === ST.done && r.calc === 'todo' && r.books.length > 0;
  }
  function evaluateAll() {
    if (!S.store) return;
    S.rows.forEach(evaluate);
  }

  /* ---------------- 시트 쓰기 (Apps Script) ---------------- */
  async function postScript(body) {
    const url = SubCfg.script;
    if (!url) throw new Error('시트 연결(Apps Script URL)이 설정되지 않았어요');
    const payload = JSON.stringify(Object.assign({ key: SubCfg.key }, body));
    try {
      const r = await fetch(url, { method: 'POST', body: payload, redirect: 'follow' });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || '시트 기록 실패');
      return j;
    } catch (err) {
      if (err instanceof TypeError) {
        // CORS 로 응답을 못 읽는 환경 — 보내기만 하고, 다시 읽어서 확인한다
        await fetch(url, { method: 'POST', body: payload, mode: 'no-cors' });
        return { ok: true, blind: true };
      }
      throw err;
    }
  }

  // updates: [{ row: r, status, note? }]
  async function writeRows(updates, { quiet = false } = {}) {
    if (!updates.length) return 0;
    if (!SubCfg.script) { toast('시트에 적으려면 먼저 ⚙️ 시트 연결을 설정하세요', 'err'); $('#subsCfg').open = true; return 0; }
    S.writing = true;
    let done = 0, blind = false;
    try {
      for (const sh of SHEETS) {
        const list = updates.filter(u => u.row.sheet === sh.id);
        for (let i = 0; i < list.length; i += 40) {
          const part = list.slice(i, i + 40);
          if (!quiet) setStatus(`시트에 적는 중… ${done}/${updates.length}`);
          const res = await postScript({
            sheet: sh.id,
            updates: part.map(u => ({ row: u.row.row, ts: u.row.ts, status: u.status, note: u.note })),
          });
          if (res.blind) blind = true;
          const okRows = new Set((res.results || []).filter(x => x.ok).map(x => x.req));
          part.forEach((u, j) => {
            if (res.blind || okRows.has(j)) { u.row.sheetStatus = u.status; if (u.note != null) u.row.sheetNote = u.note; done++; }
          });
        }
      }
    } catch (err) {
      toast('시트 기록 실패: ' + err.message, 'err');
    } finally {
      S.writing = false;
    }
    evaluateAll();
    render();
    setStatus(`시트 ${S.rows.length}건 · ${done}건 기록함`);
    if (blind) setTimeout(() => loadSheets({ quiet: true }), 4000);
    if (!quiet || done) toast(`시트에 ${done}건 기록했어요`, done ? 'ok' : 'err');
    return done;
  }

  // 판정과 시트 상태가 다른 줄 — 보류는 건드리지 않고, '반영'을 자동으로 미반영으로 내리지도 않는다
  function pendingWrites() {
    return S.rows.filter(r => {
      if (r.sheetStatus === ST.hold) return false;
      if (r.want === ST.done) return r.sheetStatus !== ST.done;
      return r.sheetStatus === '';
    }).map(r => ({ row: r, status: r.want }));
  }
  async function writePending({ quiet = false } = {}) {
    if (S.writing) return;
    const ups = pendingWrites();
    if (!ups.length) { if (!quiet) toast('시트에 새로 적을 것이 없어요', 'ok'); return; }
    await writeRows(ups, { quiet });
  }

  /* ---------------- 화면 ---------------- */
  const SHEET_BADGE = { '반영': '반영', '보류': '보류', '미반영': '미반영', '': '새 제보' };
  const BOOK_LABEL = { ok: '✅ 등록됨', src: '⚠️ 책은 있음 · 출처 다름', miss: '✖ 아직 등록 안 됨', skip: '— 제외' };

  function counts() {
    const n = { all: S.rows.length, '반영': 0, '보류': 0, '미반영': 0, '': 0, mismatch: 0, edit: 0, pending: 0, wip: 0 };
    for (const r of S.rows) {
      n[r.sheetStatus]++;
      if (r.wip) n.wip++;
      if (r.mismatch) n.mismatch++;
      if (r.calc === 'edit') n.edit++;
    }
    n.pending = pendingWrites().length;
    return n;
  }

  function visibleRows() {
    const f = $('#subsFilter').value;
    const sh = $('#subsSheet').value;
    const q = $('#subsSearch').value.trim().toLowerCase();
    const pend = new Set(f === 'pending' ? pendingWrites().map(u => u.row) : []);
    return S.rows.filter(r => {
      if (sh !== 'all' && r.sheet !== sh) return false;
      if (q && !`${r.name} ${r.celeb} ${r.text} ${r.source} ${r.memo}`.toLowerCase().includes(q)) return false;
      switch (f) {
        case 'todo': return r.sheetStatus !== ST.done && r.sheetStatus !== ST.hold && r.calc !== 'live';
        case 'new': return r.sheetStatus === '';
        case 'hold': return r.sheetStatus === ST.hold;
        case 'done': return r.sheetStatus === ST.done;
        case 'edit': return r.calc === 'edit';
        case 'mismatch': return r.mismatch;
        case 'nobook': return r.calc === '?';
        case 'wip': return r.wip;
        case 'memo': return !!r.memo;
        case 'pending': return pend.has(r);
        default: return true;
      }
    }).sort((a, b) => b.time - a.time || b.row - a.row);
  }

  function render() {
    if (!dlg.open || !S.store) return;
    const n = counts();
    $('#subsCounts').innerHTML = [
      `전체 ${n.all}`, `<span class="sub-dot done"></span>반영 ${n['반영']}`, `<span class="sub-dot hold"></span>보류 ${n['보류']}`,
      `<span class="sub-dot todo"></span>미반영 ${n['미반영']}`, `<span class="sub-dot new"></span>새 제보 ${n['']}`,
      n.edit ? `발행 대기 ${n.edit}` : '', n.wip ? `🔍 조사 중 ${n.wip}` : '', n.mismatch ? `⚠ 시트엔 반영인데 데이터에 없음 ${n.mismatch}` : '',
    ].filter(Boolean).join(' · ');
    $('#subsWriteBtn').textContent = `시트에 판정 기록 (${n.pending}건)`;
    $('#subsWriteBtn').disabled = !n.pending;
    const rows = visibleRows();
    const slice = rows.slice(0, S.shown);
    $('#subsList').innerHTML = slice.map(renderRow).join('') ||
      '<li class="muted small">조건에 맞는 제보가 없어요.</li>';
    $('#subsMore').classList.toggle('hidden', rows.length <= slice.length);
    $('#subsMore').textContent = `더 보기 (${rows.length - slice.length}건 남음)`;
    rebuildCelebList();
    slice.forEach(r => r.books.forEach(b => { if (b.state === 'miss' && r.celeb) autoSearch(b); }));
  }

  // 링크 고르기 칸에 쓰는 짧은 이름 — 서로 구별되는 부분(계정·글 번호 끝)을 남긴다
  function chipLabel(u) {
    let x;
    try { x = new URL(u); } catch (e) { return u.slice(0, 30); }
    const host = x.hostname.replace(/^(www|m|mobile)\./, '');
    const p = x.pathname;
    let m;
    if (/^(x|twitter)\.com$/.test(host) && (m = /^\/([^/]+)\/status\/(\d+)/.exec(p))) return `X @${m[1]} …${m[2].slice(-6)}`;
    if (host === 'youtu.be') return `YouTube ${p.slice(1, 12)}`;
    if (/youtube\.com$/.test(host)) {
      const v = x.searchParams.get('v') || (/\/(?:shorts|live)\/([^/?]+)/.exec(p) || [])[1];
      if (v) return `YouTube ${/shorts/.test(p) ? '쇼츠 ' : ''}${v}`;
    }
    if (/instagram\.com$/.test(host) && (m = /\/(?:p|reel)\/([^/]+)/.exec(p))) return `인스타 ${m[1]}`;
    if (/weverse\.io$/.test(host)) return `위버스 ${p.split('/').filter(Boolean).slice(-1)[0] || ''}`;
    const tail = p.replace(/\/+$/, '');
    return host + (tail.length > 22 ? '/…' + tail.slice(-18) : tail);
  }

  // 원문 그대로 보여 주되 링크는 누를 수 있게
  function linkify(text) {
    const t = String(text || '');
    let out = '', at = 0;
    for (const u of C.extractUrls(t)) {
      const i = t.indexOf(u.raw, at);
      if (i < 0) continue;
      out += esc(t.slice(at, i)) + `<a href="${esc(u.url)}" target="_blank" rel="noopener noreferrer">${esc(u.raw)}</a>`;
      at = i + u.raw.length;
    }
    return out + esc(t.slice(at));
  }

  function urlLinks(urls) {
    return urls.map(u => `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer" title="${esc(u)}">${esc(shortUrl(u))}</a>`).join(' ');
  }
  function shortUrl(u) {
    try { const x = new URL(u); return (x.hostname.replace(/^www\./, '') + x.pathname).slice(0, 38) + (u.length > 50 ? '…' : ''); }
    catch (e) { return u.slice(0, 40); }
  }

  // 시트에서 그 줄(행 전체)을 선택한 채로 연다
  function sheetRowUrl(r) {
    const sh = SHEETS.find(x => x.id === r.sheet);
    return `https://docs.google.com/spreadsheets/d/${sh.sheetId}/edit#gid=${sh.gid}&range=${r.row}:${r.row}`;
  }

  function renderRow(r) {
    const sc = ST_CLASS[r.sheetStatus];
    const calcBadge = r.calc === 'live' ? '<span class="sub-tag done">데이터에 반영됨</span>'
      : r.calc === 'edit' ? '<span class="sub-tag edit">편집본에 반영 · 발행 대기</span>'
      : r.calc === '?' ? '<span class="sub-tag">책 정보 없음 · 직접 확인</span>'
      : `<span class="sub-tag todo">책 ${r.okCount}/${r.books.filter(b => b.state !== 'skip').length} 반영</span>`;
    const candOpts = r.cands.filter(c => c.name !== r.celeb).slice(0, 4)
      .map(c => `<button type="button" class="btn small sub-pick" data-celeb="${esc(c.name)}">${esc(c.name)}</button>`).join('');
    const books = r.books.map(b => renderBook(r, b)).join('');
    return `<li class="sub-item st-${sc}${r.mismatch ? ' mismatch' : ''}" data-key="${esc(r.key)}">
      <div class="sub-head">
        <span class="sub-tag st-${sc}">${SHEET_BADGE[r.sheetStatus]}</span>
        <a class="small sub-sheetlink" href="${esc(sheetRowUrl(r))}" target="_blank" rel="noopener" title="구글 시트에서 이 제보 줄을 선택한 채로 열기">📄 ${esc(r.sheetLabel)} ${r.row}행 ↗</a>
        <span class="muted small">${esc(r.ts)}</span>
        ${calcBadge}
        ${r.kind === 'fix' ? '<span class="sub-tag hold">수정 요청</span>' : ''}
        ${r.wip ? '<span class="sub-tag wip">🔍 조사 중</span>' : ''}
        ${r.mismatch ? '<span class="sub-tag todo">⚠ 시트엔 반영인데 데이터에 없음</span>' : ''}
      </div>
      <div class="sub-who">
        <b>${esc(r.name)}</b> →
        <input class="sub-celeb" list="subsCelebList" value="${esc(r.celeb)}" placeholder="셀럽 이름 고르기" title="제보 이름에 맞는 셀럽 — 고르면 같은 이름의 다른 제보에도 씀">
        ${r.celeb ? `<button type="button" class="btn small sub-open">셀럽 열기</button>` : `<button type="button" class="btn small sub-newceleb">＋ 새 셀럽</button>`}
        ${candOpts ? `<span class="muted small">후보</span> ${candOpts}` : ''}
      </div>
      <details class="sub-raw"><summary class="small muted">제보 원문</summary>
        <div class="sub-raw-grid"><div><div class="muted small">내용</div><pre>${linkify(r.text)}</pre></div>
        <div><div class="muted small">출처</div><pre>${linkify(r.source)}</pre></div></div>
      </details>
      <div class="sub-mymemo${r.wip ? ' wip' : ''}">
        <div class="sub-mymemo-head">
          <label class="small sub-opt" title="아직 덜 조사한 제보 — '🔍 조사 중' 보기에 모임"><input type="checkbox" class="sub-wip" ${r.wip ? 'checked' : ''}> 🔍 조사 중</label>
          <span class="muted small">📝 내 메모 — 조사한 내용·할 일 (사이트엔 안 나가요)</span>
          <span class="sub-memo-state muted small">${r.memo && rowStore(r.key).memoAt ? '저장됨 · ' + esc(rowStore(r.key).memoAt) : ''}</span>
          <button type="button" class="btn small sub-mysave" title="지금 바로 저장 (손 놓고 5분 지나면 자동으로도 저장돼요)">💾 저장</button>
          <button type="button" class="btn small ghost sub-mysheet" title="이 메모를 시트의 '편집기 메모' 칸에도 적음 (상태·색은 그대로)">↗ 시트 메모 칸에도</button>
        </div>
        <textarea class="sub-mynote" rows="${r.memo ? Math.min(6, r.memo.split('\n').length + 1) : 1}" placeholder="예: 영상 23분쯤 확인 필요 / 한국어판 제목 못 찾음 / 팬 번역 원문 확인 중">${esc(r.memo)}</textarea>
      </div>
      ${r.aiNote ? `<p class="small sub-ainote">✨ ${esc(r.aiNote)}</p>` : ''}
      ${r.parsed.memo && r.books.length !== 1 ? `<p class="small muted">💬 공통 메모: ${esc(r.parsed.memo)}</p>` : ''}
      ${books ? `<ol class="sub-books">${books}</ol>` : ''}
      <div class="sub-actions">
        <button type="button" class="btn small sub-set" data-st="반영" title="시트에 체크하고 파란색으로">🟦 반영 완료</button>
        <button type="button" class="btn small sub-set" data-st="보류" title="시트를 노란색으로">🟨 보류</button>
        <button type="button" class="btn small sub-set" data-st="미반영" title="시트를 빨간색으로">🟥 미반영</button>
        <button type="button" class="btn small sub-addmanual" ${r.celeb ? '' : 'disabled'}>＋ 책 직접 추가</button>
        ${rowStore(r.key).ai ? '<button type="button" class="btn small ghost sub-aiclear" title="AI 정리를 버리고 자동 분석으로 되돌림">AI 정리 지우기</button>' : ''}
        ${r.sheetNote ? `<span class="muted small">시트 메모: ${esc(r.sheetNote)}</span>` : ''}
      </div>
    </li>`;
  }

  /* 이 제보 칸(내용·출처)에 있는 링크 전부 — 눌러서 이 책의 출처로 고른다.
   * 자동으로 붙인 링크는 파랗게, 고르면 그 링크로 반영 여부를 다시 본다. */
  function linkPicker(r, b) {
    if (!r.allUrls.length) return '<div class="sub-links muted small">이 제보에는 링크가 없어요 — 출처 없이 판정 (편집 창에서 직접 넣을 수 있어요)</div>';
    const cur = b.urls[0] || '';
    const chips = r.allUrls.map(u => `<span class="sub-link${u === cur ? ' on' : ''}">
        <button type="button" class="sub-pickurl" data-u="${esc(u)}" title="이 링크를 이 책의 출처로 — ${esc(u)}">${esc(chipLabel(u))}</button><a href="${esc(u)}" target="_blank" rel="noopener noreferrer" title="${esc(u)} 열기">↗</a></span>`).join('');
    return `<div class="sub-links"><span class="muted small">출처 링크${b.picked ? ' (직접 고름)' : r.allUrls.length > 1 ? ' (자동 — 맞는 걸 누르세요)' : ''}</span>
      ${chips}
      <button type="button" class="sub-pickurl sub-nolink${!cur ? ' on' : ''}" data-u="" title="이 책은 링크 없음">링크 없음</button>
      ${r.books.length > 1 && cur ? '<button type="button" class="btn small ghost sub-urlall" title="이 링크를 이 제보의 모든 책 출처로">이 링크를 모든 책에</button>' : ''}
      ${b.picked ? '<button type="button" class="btn small ghost sub-urlreset" title="자동으로 붙인 링크로 되돌리기">자동으로</button>' : ''}
    </div>`;
  }

  function renderBook(r, b) {
    const memo = [b.memo, r.parsed.memo].filter(Boolean).join(' / ');
    let body = '';
    if (b.state === 'ok') {
      body = `<span class="small muted">${b.live ? '사이트에 나가 있음' : '편집본에만 있음 — 발행하면 시트에 반영으로 적혀요'}${b.dec === 'ok' ? ' · 이대로 OK 처리' : ''}${b.viaOther ? ' · 출처가 제보의 다른 링크와 같음' : ''}</span>
        ${b.dec === 'ok' ? '<button type="button" class="btn small sub-undec">되돌리기</button>' : ''}`;
    } else if (b.state === 'src') {
      body = `<div class="small">지금 데이터의 출처: ${b.cur && b.cur.source ? urlLinks([b.cur.source]) : '<i>비어 있음</i>'}</div>
        ${linkPicker(r, b)}
        <div class="row" style="gap:6px;margin-top:4px">
          ${b.urls.length ? `<button type="button" class="btn small primary sub-src">출처를 고른 링크로 바꾸기</button>` : ''}
          <button type="button" class="btn small sub-ok">이대로 OK</button>
          <button type="button" class="btn small sub-skip">제외</button>
        </div>`;
    } else if (b.state === 'miss') {
      const res = S.search.get(b.query);
      const items = res ? res.slice(0, 3) : null;
      body = `${linkPicker(r, b)}<div class="row sub-qrow">
          <input class="sub-q" value="${esc(b.query)}" style="flex:1 1 auto;min-width:0" title="예스24 검색어">
          <button type="button" class="btn small sub-search">🔎 찾기</button>
          <button type="button" class="btn small sub-edit" ${r.celeb ? '' : 'disabled'} title="책 편집 창에서 직접 고르고 고쳐서 추가">편집 창에서</button>
          <button type="button" class="btn small sub-skip" title="책이 아니거나 넣지 않을 것 — 반영 판정에서 뺌">제외</button>
        </div>
        <div class="sub-results">${!r.celeb ? '<span class="muted small">먼저 셀럽을 고르세요</span>'
          : !Config.yes24Proxy ? '<span class="muted small">예스24 프록시가 설정돼 있지 않아요 — ⚙️ 설정, 또는 "편집 창에서"</span>'
          : items == null ? (S.searching.has(b.query) ? '<span class="muted small">찾는 중…</span>' : '')
          : !items.length ? '<span class="muted small">결과 없음 — 검색어를 고쳐 보세요</span>'
          : items.map((it, j) => `<div class="sub-hit">
              <img src="${esc(Yes24.cover(it))}" referrerpolicy="no-referrer" alt="">
              <div class="sub-hit-meta"><b>${esc(it.title)}</b><div class="muted small">${esc(cleanAuthorName(it.author) || it.author || '')} · ${esc(it.publisher || '')} · ${esc((it.publishDate || '').slice(0, 7))}</div></div>
              <button type="button" class="btn small primary sub-add" data-j="${j}">＋ 추가</button>
            </div>`).join('')}</div>`;
    } else if (b.state === 'skip') {
      body = '<button type="button" class="btn small sub-undec">되돌리기</button>';
    }
    return `<li class="sub-book bk-${b.state}" data-i="${b.i}">
      <div><span class="sub-bstate">${BOOK_LABEL[b.state]}</span>
        <b>${esc(b.state === 'ok' && b.cur ? b.cur.title : b.title)}</b>
        <span class="muted small">${esc([b.author, b.publisher].filter(Boolean).join(' · '))}</span>
        ${b.ai ? '<span class="sub-tag">AI 정리</span>' : ''}
        ${b.state === 'ok' && b.urls.length ? `<span class="small">· ${urlLinks(b.urls.slice(0, 2))}${b.urls.length > 2 ? ` 외 ${b.urls.length - 2}` : ''}</span>` : ''}
      </div>
      ${b.state === 'miss' ? `<textarea class="sub-memo" rows="${memo.length > 60 ? 2 : 1}" placeholder="💬 메모 (AI 코멘트 재료) — 주소 말고 제보에 적힌 설명">${esc(S.memo.get(r.key + '#' + b.i) ?? memo)}</textarea>` : ''}
      ${body}
    </li>`;
  }

  function rebuildCelebList() {
    const dl = $('#subsCelebList');
    if (dl._n === State.celebs.size) return;
    dl._n = State.celebs.size;
    dl.innerHTML = State.order.map(n => `<option value="${esc(n)}"></option>`).join('');
  }

  /* ---------------- 예스24 자동 검색 ---------------- */
  const searchQueue = [];
  let searchRunning = 0;
  function autoSearch(b) {
    if (!Config.yes24Proxy || !b.query || S.search.has(b.query) || S.searching.has(b.query)) return;
    S.searching.add(b.query);
    searchQueue.push(b.query);
    pumpSearch();
  }
  function pumpSearch() {
    while (searchRunning < 2 && searchQueue.length) {
      const q = searchQueue.shift();
      searchRunning++;
      Yes24.search(q, 1, 3).then(({ items }) => S.search.set(q, items || []))
        .catch(() => S.search.set(q, []))
        .finally(() => { searchRunning--; S.searching.delete(q); scheduleRender(); pumpSearch(); });
    }
  }
  let renderTimer = null;
  function scheduleRender() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(() => {
      // 입력 중인 칸이 있으면 다시 그리지 않는다
      const a = document.activeElement;
      if (a && dlg.contains(a) && a.matches('textarea, input:not([type=checkbox]):not(#subsSearch)')) { scheduleRender(); return; }
      const y = $('#subsBody').scrollTop;
      render();
      $('#subsBody').scrollTop = y;
    }, 300);
  }

  /* ---------------- 책 추가 ---------------- */
  async function addFromYes24(r, b, it, memo) {
    const name = r.celeb;
    const c = State.celebs.get(name);
    if (!c) { toast('편집기에 없는 셀럽이에요', 'err'); return; }
    const title = it.title;
    const gid = String(it.itemId || '') || yes24GoodsId(it.link);
    const dup = findDupTitle(name, title, null, gid);
    if (dup.same) {
      toast(`이미 등록된 책이에요: ${dup.same.title} — '이대로 OK'로 처리했어요`, 'ok');
      setDec(r, b.i, C.titleHit(dup.same, b) ? 'ok' : 'as:' + dup.same.title);
      return;
    }
    const book = {
      title, title_en: '',
      author: cleanAuthorName(it.author) || it.author || '', author_en: '',
      publisher: it.publisher || '', source: b.urls[0] || '',
      link: it.link || '', cover: Yes24.cover(it), comment: '',
    };
    c.books.push(book);
    sortBooks(c.books);
    setDirty(true);
    renderSidebar();
    if (State.selected === name) renderDetail();
    toast(`${name} · ${title} 추가됨${memo ? ' (메모 → 💬 코멘트)' : ''} — 드래프트 저장·발행하면 시트에 반영으로 적혀요`, 'ok');
    // AI 정리 결과의 제목이 예스24 제목과 다르면 다음 판정에서도 맞도록 결정을 남긴다
    if (!C.titleHit(book, b)) setDec(r, b.i, 'as:' + title); else { evaluate(r); scheduleRender(); }
    if (memo) await saveBookMemo(name, title, memo, book.source);
    fillEn(name, book);
  }

  async function fillEn(name, book) {
    const t = book.title, a = book.author;
    try {
      const Lt = learnedEn('title', t), La = a ? learnedEn('author', a) : null;
      if (Lt && !book.title_en) book.title_en = Lt.text;
      if (La && !book.author_en) book.author_en = La.text;
      const needT = !book.title_en, needA = !!a && !book.author_en;
      if (!needT && !needA) return;
      const [bk, person] = await Promise.all([
        EnEnrich.bookEn(t, a).catch(() => null),
        needA ? EnEnrich.celebEn(a).catch(() => null) : null,
      ]);
      if (needT && bk && bk.title_en && !book.title_en) book.title_en = bk.title_en;
      const ae = person && person.name_en ? person.name_en.replace(/\s*\([^)]*\)\s*$/, '').trim() : (bk && bk.author_en) || '';
      if (needA && ae && !book.author_en) book.author_en = fixKoreanNameOrder(a, ae);
      setDirty(true);
      if (State.selected === name) renderDetail();
    } catch (e) { console.warn('[subs fillEn]', e.message); }
  }

  function openEditFor(r, b, memo) {
    if (!r.celeb || !State.celebs.has(r.celeb)) { toast('먼저 셀럽을 고르세요', 'err'); return; }
    selectCeleb(r.celeb);
    const pre = b ? {
      title: b.ko || b.title, author: b.author, publisher: b.publisher, source: b.urls[0] || '',
    } : { source: r.parsed.urls[0] || '' };
    openBookDialog(pre, null);
    $('#bookDialogTitle').textContent = '책 추가 — 제보에서';
    $('#bookMemo').value = memo || '';
    if (b && Config.yes24Proxy) { $('#yes24Query').value = b.query; runYes24Search(b.query); }
  }

  // 책 i 의 출처 링크를 고른다 (undefined = 자동으로 되돌림, '' = 링크 없음)
  function setSrc(r, idxs, url) {
    const st = rowStore(r.key, true);
    st.src = st.src || {};
    for (const i of idxs) { if (url === undefined) delete st.src[i]; else st.src[i] = url; }
    if (!Object.keys(st.src).length) delete st.src;
    saveStoreSoon();
    evaluate(r);
    scheduleRender();
  }

  function setDec(r, i, v) {
    const st = rowStore(r.key, true);
    st.dec = st.dec || {};
    if (v) st.dec[i] = v; else delete st.dec[i];
    saveStoreSoon();
    evaluate(r);
    scheduleRender();
  }

  function setCeleb(r, name) {
    const st = rowStore(r.key, true);
    if (name) {
      st.celeb = name;
      S.store.aliases[C.norm(r.name)] = name;
    } else {
      delete st.celeb;
    }
    saveStoreSoon();
    // 같은 이름으로 들어온 다른 제보도 다시 판정
    S.rows.filter(x => C.norm(x.name) === C.norm(r.name)).forEach(evaluate);
    evaluate(r);
    scheduleRender();
  }

  /* ---------------- 이벤트 ---------------- */
  const rowOf = (el) => { const li = el.closest('.sub-item'); return li ? S.rows.find(x => x.key === li.dataset.key) : null; };
  const bookOf = (el, r) => { const li = el.closest('.sub-book'); return li && r ? r.books[Number(li.dataset.i)] : null; };

  $('#subsList').addEventListener('click', async (e) => {
    const t = e.target.closest('button'); if (!t) return;
    const r = rowOf(t); if (!r) return;
    const b = bookOf(t, r);
    const memoOf = () => { const el = t.closest('.sub-book')?.querySelector('.sub-memo'); return el ? el.value.trim() : ''; };
    if (t.classList.contains('sub-mysave')) { await flushStore(); toast('메모를 저장했어요', 'ok'); }
    else if (t.classList.contains('sub-mysheet')) {
      if (!r.memo.trim()) { toast('메모가 비어 있어요', 'err'); return; }
      await writeRows([{ row: r, status: r.sheetStatus || ST.todo, note: r.memo.trim() }]);
    }
    else if (t.classList.contains('sub-pick')) setCeleb(r, t.dataset.celeb);
    else if (t.classList.contains('sub-open')) { dlg.close(); selectCeleb(r.celeb); }
    else if (t.classList.contains('sub-newceleb')) {
      const name = prompt('새 셀럽 이름 (data.csv 연예인 칸 형식, 예: 홍길동(그룹))', C.splitName(r.name)[0].trim());
      if (!name) return;
      if (!State.celebs.has(name)) {
        State.celebs.set(name, { name, name_en: '', img: '', books: [] });
        State.order.push(name);
        setDirty(true); renderSidebar();
      }
      setCeleb(r, name);
    }
    else if (t.classList.contains('sub-set')) {
      const st = t.dataset.st;
      let note;
      if (st === ST.hold) { note = prompt('보류 이유 (시트의 "편집기 메모" 칸에 적혀요, 비워도 돼요)', r.sheetNote || r.memo.trim()); if (note === null) return; }
      if (st === ST.done && r.wip) { setMyMemo(r, { wip: false }); saveStoreSoon(); }
      await writeRows([{ row: r, status: st, note }]);
    }
    else if (t.classList.contains('sub-addmanual')) openEditFor(r, null, r.parsed.memo);
    else if (!b) return;
    else if (t.classList.contains('sub-pickurl')) setSrc(r, [b.i], t.dataset.u);
    else if (t.classList.contains('sub-urlall')) setSrc(r, r.books.map(x => x.i), b.urls[0] || '');
    else if (t.classList.contains('sub-urlreset')) setSrc(r, [b.i], undefined);
    else if (t.classList.contains('sub-skip')) setDec(r, b.i, 'skip');
    else if (t.classList.contains('sub-ok')) setDec(r, b.i, 'ok');
    else if (t.classList.contains('sub-undec')) setDec(r, b.i, '');
    else if (t.classList.contains('sub-edit')) openEditFor(r, b, memoOf());
    else if (t.classList.contains('sub-search')) {
      const q = t.closest('.sub-book').querySelector('.sub-q').value.trim();
      if (!q) return;
      b.query = q;
      const pb = r.parsed.books[b.i]; if (pb) pb.query = q;
      S.search.delete(q);
      autoSearch(b);
      scheduleRender();
    }
    else if (t.classList.contains('sub-add')) {
      const items = S.search.get(b.query) || [];
      const it = items[Number(t.dataset.j)];
      if (it) { t.disabled = true; await addFromYes24(r, b, it, memoOf()); }
    }
    else if (t.classList.contains('sub-src')) {
      const c = State.celebs.get(r.celeb);
      const cur = c && c.books[b.idx];
      if (!cur) return;
      if (!confirm(`'${cur.title}' 출처를 바꿀까요?\n\n지금: ${cur.source || '(비어 있음)'}\n제보: ${b.urls[0]}`)) return;
      cur.source = b.urls[0];
      setDirty(true);
      if (State.selected === r.celeb) renderDetail();
      evaluate(r); scheduleRender();
      toast('출처를 바꿨어요 — 드래프트 저장·발행하면 시트에 반영으로 적혀요', 'ok');
      // 제보 설명은 메모가 비어 있을 때만 넣는다 (사람이 쓴 메모를 덮지 않게)
      const memo = [b.memo, r.parsed.memo].filter(Boolean).join(' / ');
      if (memo && await loadCmtFile() && !(Cmt.get(r.celeb, cur.title)?.memo)) await saveBookMemo(r.celeb, cur.title, memo, cur.source);
    }
  });
  $('#subsList').addEventListener('change', (e) => {
    if (e.target.classList.contains('sub-wip')) {
      const r = rowOf(e.target); if (!r) return;
      setMyMemo(r, { wip: e.target.checked });
      saveStoreSoon();
      scheduleRender();
      return;
    }
    if (!e.target.classList.contains('sub-celeb')) return;
    const r = rowOf(e.target); if (!r) return;
    const v = e.target.value.trim();
    if (v && !State.celebs.has(v)) { toast(`'${v}' — 편집기에 없는 셀럽이에요. 목록에서 고르거나 ＋ 새 셀럽`, 'err'); return; }
    setCeleb(r, v);
  });
  function setMyMemo(r, patch) {
    const st = rowStore(r.key, true);
    Object.assign(st, patch);
    st.memoAt = new Date().toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    r.memo = st.memo || '';
    r.wip = !!st.wip;
  }
  $('#subsList').addEventListener('input', (e) => {
    if (e.target.classList.contains('sub-mynote')) {
      const r = rowOf(e.target); if (!r) return;
      setMyMemo(r, { memo: e.target.value.trim() ? e.target.value : '' });
      const stEl = e.target.closest('.sub-mymemo').querySelector('.sub-memo-state');
      stEl.classList.add('unsaved'); stEl.textContent = '저장 안 됨 · 손 놓고 5분 뒤 자동';
      saveStoreSoon();
      return;
    }
    if (!e.target.classList.contains('sub-memo')) return;
    const r = rowOf(e.target), b = bookOf(e.target, r);
    if (r && b) S.memo.set(r.key + '#' + b.i, e.target.value);
  });
  $('#subsList').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.classList.contains('sub-q')) {
      e.preventDefault();
      e.target.closest('.sub-book').querySelector('.sub-search').click();
    }
  });

  $('#subsFilter').addEventListener('change', () => { S.shown = PAGE; render(); });
  $('#subsSheet').addEventListener('change', () => { S.shown = PAGE; render(); });
  $('#subsSearch').addEventListener('input', () => { S.shown = PAGE; render(); });
  $('#subsMore').addEventListener('click', () => { S.shown += PAGE; render(); });
  $('#subsReloadBtn').addEventListener('click', () => loadSheets());
  $('#subsWriteBtn').addEventListener('click', () => {
    const ups = pendingWrites();
    const toDone = ups.filter(u => u.status === ST.done).length;
    if (!confirm(`시트에 판정을 적을까요?\n\n🟦 반영 ${toDone}건 (발행본에 책·출처가 들어간 제보)\n🟥 미반영 ${ups.length - toDone}건 (아직 상태가 없는 새 제보)\n\n보류(🟨)와 이미 적힌 상태는 건드리지 않아요.`)) return;
    writePending();
  });
  $('#subsAuto').addEventListener('change', setAutoTimer);
  $('#subsAutoWrite').addEventListener('change', () => { LS.set('subsAutoWrite', $('#subsAutoWrite').checked ? '1' : ''); });

  function setAutoTimer() {
    clearInterval(S.timer);
    LS.set('subsAuto', $('#subsAuto').checked ? '1' : '');
    if ($('#subsAuto').checked && dlg.open) S.timer = setInterval(() => { if (dlg.open && !S.writing) loadSheets({ quiet: true }); }, 60000);
  }

  // 책 편집 창에서 추가하고 닫으면 다시 판정
  bookDlg.addEventListener('close', () => { if (dlg.open) { evaluateAll(); scheduleRender(); } });
  dlg.addEventListener('close', () => { clearInterval(S.timer); flushStore(); });
  $('#subsStoreSaveBtn').addEventListener('click', async () => {
    if (!S.storeDirty) { toast('저장할 변경이 없어요', 'ok'); return; }
    await flushStore();
    if (!S.storeDirty) toast('제보 기록을 저장했어요', 'ok');
  });
  // 저장 전에 페이지를 닫으려 하면 붙잡는다
  window.addEventListener('beforeunload', (e) => { if (S.storeDirty) { flushStore(); e.preventDefault(); e.returnValue = ''; } });

  /* ---------------- 시트 연결 설정 ---------------- */
  $('#subsCfgSave').addEventListener('click', () => {
    LS.set('subsScript', $('#subsCfgScript').value.trim());
    LS.set('subsKey', $('#subsCfgKey').value.trim());
    toast('시트 연결 저장됨', 'ok');
    $('#subsCfgState').textContent = SubCfg.script ? '연결됨' : '미설정 (읽기만)';
  });
  $('#subsCfgTest').addEventListener('click', async () => {
    LS.set('subsScript', $('#subsCfgScript').value.trim());
    LS.set('subsKey', $('#subsCfgKey').value.trim());
    try {
      const j = await postScript({ action: 'ping' });
      toast(j.blind ? '보냈어요 (응답은 브라우저가 막아 확인 못 함) — 상태 버튼을 한 번 눌러 시트에 적히는지 보세요' : `연결 OK — ${(j.sheets || []).join(', ')}`, 'ok');
    } catch (err) { toast('연결 실패: ' + err.message, 'err'); }
  });

  /* ---------------- AI 정리 (복사 → Claude → 붙여넣기) ---------------- */
  const AI_GUIDE = `셀럽이 읽은 책을 모아 보여주는 사이트 favorbook.co.kr 에 들어온 구글 폼 제보를 정리해 주세요.
제보마다 name(제보에 적힌 셀럽 이름), text(책 내용), source(출처 칸)가 있습니다. 형식이 제각각이라 책을 하나씩 뽑아야 합니다.

지킬 것
- books: 제보에 나온 책마다 하나씩. 한 제보에 여러 권이면 모두.
  - title: 한국어판 제목. 국내 출간 제목을 확실히 알면 그것(예: "The Housekeeper and the Professor" → "박사가 사랑한 수식"), 모르면 제보에 적힌 그대로. 시리즈면 시리즈 이름.
  - title_orig: 제보에 영어·원어 제목이 따로 적혀 있으면 그대로, 없으면 "".
  - author: 지은이 한국어 표기 (역자·그림 제외). 모르면 "".
  - publisher: 제보에 적혀 있으면, 아니면 "".
  - source: 그 책의 출처 URL 하나. 제보에 있는 URL 중 그 책에 해당하는 것 (책마다 따로 적힌 URL이 있으면 그것, 아니면 공통 URL). 없으면 "".
  - memo: URL을 뺀 제보자의 설명 중 그 책에 해당하는 부분(어디서 언급했는지, 추천 이유, 영상 몇 분 등)을 그대로 옮기거나 짧게 요약. 제보에 없는 내용은 지어내지 말 것. 없으면 "".
- kind: 책 제보면 "books". 출처를 바꿔 달라는 요청도 해당 책과 새 출처 URL을 books 에 넣고 "books" (note 에 "출처 수정 요청"). 사진·이름·그룹 수정처럼 책 추가가 아니면 "fix", 알 수 없으면 "other" — 이때 books 는 [].
- note: 검수자가 알아야 할 점 한 줄 (예: "읽고 싶은 책이라고만 함 — 제외 권장", "사진 교체 요청"). 없으면 "".
- key 는 받은 그대로 둡니다.

답은 설명 없이 JSON 배열 하나만 코드 블록으로 주세요.
[{"key": "…", "kind": "books", "books": [{"title": "", "title_orig": "", "author": "", "publisher": "", "source": "", "memo": ""}], "note": ""}]

제보:
`;
  $('#subsAiCopyBtn').addEventListener('click', async () => {
    const rows = visibleRows().filter(r => !rowStore(r.key).ai && r.sheetStatus !== ST.done && r.calc !== 'live').slice(0, 30);
    if (!rows.length) { toast('AI에 넘길 제보가 없어요 (지금 목록에서 AI 정리 안 된 미반영 제보)', 'err'); return; }
    const items = rows.map(r => ({ key: r.key, name: r.name, text: r.text.trim(), source: r.source.trim() }));
    try { await copyToClipboard(AI_GUIDE + JSON.stringify(items, null, 1)); }
    catch (e) { toast('복사 실패: ' + e.message, 'err'); return; }
    $('#subsAiBox').open = true;
    $('#subsAiPaste').focus();
    toast(`제보 ${rows.length}건 요청 복사됨 — Claude 대화창에 붙여넣고, 받은 답을 아래 칸에 붙여넣으세요`, 'ok');
  });
  $('#subsAiApplyBtn').addEventListener('click', () => {
    const raw = $('#subsAiPaste').value;
    const m = /\[[\s\S]*\]/.exec(raw.replace(/```(?:json)?/g, ''));
    let arr;
    try { arr = JSON.parse(m ? m[0] : raw); } catch (e) { toast('JSON을 읽지 못했어요 — 답 전체를 그대로 붙여넣으세요', 'err'); return; }
    if (!Array.isArray(arr)) { toast('배열 형식이 아니에요', 'err'); return; }
    let n = 0, miss = 0;
    for (const x of arr) {
      const r = S.rows.find(y => y.key === x.key);
      if (!r) { miss++; continue; }
      const st = rowStore(r.key, true);
      st.ai = {
        kind: x.kind || 'books', note: x.note || '', at: new Date().toISOString().slice(0, 10),
        books: (x.books || []).map(b => ({
          title: String(b.title || '').trim(), title_orig: String(b.title_orig || '').trim(),
          author: String(b.author || '').trim(), publisher: String(b.publisher || '').trim(),
          source: String(b.source || '').trim(), memo: String(b.memo || '').trim(),
        })).filter(b => b.title),
      };
      delete st.dec;   // 책 목록이 바뀌었으니 예전 결정은 버린다
      evaluate(r);
      n++;
    }
    saveStoreSoon();
    $('#subsAiPaste').value = '';
    render();
    toast(`AI 정리 ${n}건 적용${miss ? ` · 못 찾은 키 ${miss}건` : ''}`, n ? 'ok' : 'err');
  });
  $('#subsList').addEventListener('click', (e) => {
    if (!e.target.classList.contains('sub-aiclear')) return;
    const r = rowOf(e.target); if (!r) return;
    const st = rowStore(r.key, true); delete st.ai; delete st.dec;
    saveStoreSoon(); evaluate(r); scheduleRender();
  });

  /* ---------------- 열기 ---------------- */
  async function openSubs() {
    if (!Config.token) { toast('GitHub Token을 먼저 설정하세요', 'err'); settingsDlg.showModal(); return; }
    if (!State.celebs.size) { toast('먼저 ↻ 불러오기로 CSV를 가져오세요', 'err'); return; }
    $('#subsCfgScript').value = SubCfg.script;
    $('#subsCfgKey').value = SubCfg.key;
    $('#subsCfgState').textContent = SubCfg.script ? '연결됨' : '미설정 (읽기만)';
    $('#subsAuto').checked = LS.get('subsAuto', '1') === '1';
    $('#subsAutoWrite').checked = LS.get('subsAutoWrite', '1') === '1';
    if (!SubCfg.script) $('#subsCfg').open = true;
    dlg.showModal();
    S.shown = PAGE;
    setStatus('기록 불러오는 중…');
    await loadStore();
    setAutoTimer();
    await loadSheets();
  }
  $('#subsBtn').addEventListener('click', openSubs);
})();
