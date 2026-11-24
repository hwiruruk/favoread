/* 제보 반영 — 순수 로직 (DOM 없음)
 * 구글 폼 제보 한 줄을 책 후보로 나누고, 셀럽·책이 data.csv 에 이미 들어갔는지 판단한다.
 * 브라우저에서는 window.SubsCore, node 에서는 require() 로 쓴다 (테스트용).
 * 화면은 submissions.js 에 있다. */
(function (root) {
  'use strict';

  const HANGUL = /[가-힣]/;
  const norm = (s) => String(s || '').normalize('NFC').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
  // 영문 직역 표시(*)와 끝의 '(시리즈)' 같은 군말은 비교에서 뺀다
  const normTitle = (s) => norm(String(s || '').replace(/\s*\*\s*$/, ''));

  /* ---------------- URL ---------------- */
  const URL_RE = /https?:\/\/[A-Za-z0-9\-._~:/?#[\]@!$&'*+,;=%()]+/g;
  function trimUrl(u) {
    let s = u;
    for (;;) {
      const last = s.slice(-1);
      if (!last) break;
      if (last === ')') {
        const open = (s.match(/\(/g) || []).length, close = (s.match(/\)/g) || []).length;
        if (close > open) { s = s.slice(0, -1); continue; }
        break;
      }
      if ('.,;:!?\'"]([<'.includes(last)) { s = s.slice(0, -1); continue; }
      break;
    }
    // 'goods/108736825(배우의' 처럼 괄호 뒤에 설명이 붙은 경우 — 괄호부터 자른다
    s = s.replace(/\($/, '');
    return s;
  }
  function extractUrls(text) {
    const out = [];
    String(text || '').replace(URL_RE, (m, idx) => {
      const u = trimUrl(m);
      if (u.length > 10) out.push({ url: u, index: idx, raw: m.slice(0, u.length) });
      return m;
    });
    return out;
  }
  function stripUrls(text) {
    let s = String(text || '');
    for (const u of extractUrls(s)) s = s.split(u.raw).join(' ');
    return s;
  }

  // 공유 링크의 추적용 꼬리(si, s, utm_…)는 같은 글을 가리키므로 비교에서 뺀다
  const TRACK = /^(utm_.*|si|s|t|a|hl|ref|ref_src|source|fbclid|igsh|igshid|img_index|fqnt|dmpr|feature|share|copy_link|from|sid|begin|start|time_continue|mibextid)$/i;
  function normUrl(u) {
    let x;
    try { x = new URL(String(u || '').trim()); } catch (e) { return norm(u); }
    const host = x.hostname.toLowerCase().replace(/^(www|m|mobile)\./, '');
    const p = x.pathname.replace(/\/+$/, '');
    let m;
    if (host === 'youtu.be') return 'yt:' + p.slice(1).split('/')[0];
    if (/(^|\.)youtube\.com$/.test(host)) {
      if (x.searchParams.get('v')) return 'yt:' + x.searchParams.get('v');
      if ((m = /^\/(?:shorts|live|embed|v)\/([^/]+)/.exec(p))) return 'yt:' + m[1];
    }
    if (/^(x|twitter|mobile\.twitter|fxtwitter|vxtwitter)\.com$/.test(host) && (m = /\/status(?:es)?\/(\d+)/.exec(p))) return 'x:' + m[1];
    if (/instagram\.com$/.test(host) && (m = /\/(?:p|reel|reels|tv)\/([^/]+)/.exec(p))) return 'ig:' + m[1];
    if (/yes24\.com$/.test(host) && (m = /goods\/(?:detail\/)?(\d+)/i.exec(p))) return 'y24:' + m[1];
    if (/aladin\.co\.kr$/.test(host) && x.searchParams.get('ItemId')) return 'ala:' + x.searchParams.get('ItemId');
    if (/blog\.naver\.com$/.test(host)) {
      const logNo = x.searchParams.get('logNo');
      const blogId = x.searchParams.get('blogId');
      if (logNo) return `nblog:${blogId || ''}/${logNo}`;
      return 'nblog:' + p.slice(1).toLowerCase();
    }
    const qs = [...x.searchParams].filter(([k]) => !TRACK.test(k)).sort().map(([k, v]) => `${k}=${v}`).join('&');
    return host + p + (qs ? '?' + qs : '');
  }
  const sameUrl = (a, b) => !!a && !!b && normUrl(a) === normUrl(b);

  /* ---------------- 제보 → 책 후보 ---------------- */
  const BULLET = /^\s*(?:[-–—*•·▪◦‣]+|\(?\d{1,2}[.)]|\d{1,2}\s*[.)]|[①-⑳])\s*/;
  const LABEL_SRC = /^\s*(?:출처|source|src)\s*[:：-]?\s*/i;
  const ROLE_TAIL = /\s*(?:저|지음|지은이|글|作|著|옮김|역|출판사?|출판)\s*$/;

  function cleanPiece(s) {
    return String(s || '')
      .replace(/^\s*(?:책\s*이름|책제목|제목|도서명|title|저자|author|출판사|publisher)\s*[:：]\s*/i, '')
      .replace(ROLE_TAIL, '')
      .replace(/^[\s,/|·:;\-–—]+|[\s,/|·:;\-–—]+$/g, '')
      .trim();
  }

  // 한 줄에 책이 여러 권 적힌 경우를 나눈다
  function splitMulti(line) {
    const s = line.trim();
    // 『A』 <B> 처럼 괄호로 감싼 제목이 둘 이상
    const br = s.match(/[<《『「〈][^>》』」〉]+[>》』」〉]/g) || [];
    if (br.length >= 2) {
      const rest = cleanPiece(s.replace(/[<《『「〈][^>》』」〉]+[>》』」〉]/g, ' ').replace(/\s+/g, ' '));
      return br.map(b => b.slice(1, -1) + (rest ? ' - ' + rest : ''));
    }
    // 'A by X, B by Y'
    if ((s.match(/\sby\s/gi) || []).length >= 2 && /\sby\s[^,;]+[,;]/i.test(s)) {
      const out = [];
      for (const part of s.split(/\s*[,;]\s*/)) {
        if (!part.trim()) continue;
        if (/\sby\s/i.test(part) || !out.length) out.push(part); else out[out.length - 1] += ', ' + part;
      }
      return out;
    }
    // 'A - X / B - Y' , 'A (X) / B (Y)' — 조각마다 저자 표시가 따로 있을 때만 나눈다
    // ('급류 / 정대건 / 민음사' 같은 제목/저자/출판사는 나누지 않는다)
    const parts = s.split(/\s+\/{1,2}\s+|\s*\/\/\s*/).map(x => x.trim()).filter(Boolean);
    if (parts.length >= 2 && parts.every(p => /\s-\s?|-|\(.+\)|\sby\s/i.test(p))) return parts;
    return [s];
  }

  function parseLine(raw) {
    let s = String(raw || '').replace(BULLET, '').trim();
    const memo = [];
    // 따옴표로 길게 인용한 추천사, '(출처: …)' 꼬리는 메모로
    s = s.replace(/["“”]([^"“”]{12,})["“”]/g, (m, q) => { memo.push(q.trim()); return ' '; });
    s = s.replace(/[(（]\s*출처\s*[:：]?([^)）]*)[)）]/g, (m, q) => { memo.push('출처: ' + q.trim()); return ' '; });
    s = s.replace(/\s*[/|,]?\s*출처\s*[:：].*$/, (m) => { const q = m.replace(/^\s*[/|,]?\s*출처\s*[:：]\s*/, '').trim(); if (q) memo.push('출처: ' + q); return ''; });
    s = s.replace(/(\s*[/|,]\s*)+$/, '').replace(/(\s*[/|]\s*){2,}/g, ' / ').replace(/\s+/g, ' ').trim();
    let title = '', author = '', publisher = '';
    const segs = [], parens = [];
    // 라벨 형식 — 책이름: A / 저자: B / 출판사: C, (Author: X / Publisher: Y)
    const lab = (re) => { const m = re.exec(s); return m ? cleanPiece(m[1]) : ''; };
    if (/(?:책\s*이름|저자|저지|지은이|출판사|author|publisher)\s*[:：]/i.test(s)) {
      const NEXT = '(?=\\s*(?:책\\s*이름|제목|도서명|title|저자|저지|지은이|author|출판사|출판|publisher)\\s*[:：]|[/|()（）]|$)';
      author = lab(new RegExp('(?:저자|저지|지은이|author)\\s*[:：]\\s*([^/|()（）]+?)' + NEXT, 'i'));
      publisher = lab(new RegExp('(?:출판사|출판|publisher)\\s*[:：]\\s*([^/|()（）]+?)' + NEXT, 'i'));
      title = lab(new RegExp('(?:책\\s*이름|제목|도서명|title)\\s*[:：]\\s*([^/|]+?)' + NEXT, 'i')) ||
        cleanPiece(s.replace(/[(（]?\s*(?:저자|저지|지은이|author|출판사|출판|publisher)\s*[:：].*$/i, ''));
    }
    const bracket = /[<《『「〈]([^>》』」〉]+)[>》』」〉]/.exec(s);
    if (!title && bracket) {
      title = bracket[1].trim();
      const ps = s.replace(bracket[0], ' ').split(/\s*[|/,()（）]\s*|\s+-\s*|\s*-\s+/).map(cleanPiece).filter(Boolean);
      author = ps[0] || ''; publisher = ps[1] || '';
    }
    if (!title) {
      // 괄호 안 (영원을 향하여) 같은 다른 이름은 따로 모은다
      let body = s.replace(/[(（]([^()（）]+)[)）]/g, (m, q) => { parens.push(q.trim()); return ' / '; });
      body = body.replace(/(\s*\/\s*)+$/, '').replace(/(\s*\/\s*){2,}/g, ' / ');
      let ps;
      const SEP = /\s*\|\s*|\s+by\s+|\s*\/\s*|\s+[-–—]+\s*|\s*[-–—]+\s+|(?<=[가-힣a-z)\]])[-–—](?=[가-힣])/i;
      if (SEP.test(body)) ps = body.split(new RegExp(SEP.source, 'gi'));
      else if (body.includes(',') && !parens.length) ps = body.split(',');
      else ps = [body];
      ps = ps.map(cleanPiece).filter(Boolean);
      if (!ps.length && parens.length) { ps = parens.splice(0, 1); }
      title = (ps[0] || '').replace(/\s+\d+\s*[&,]\s*\d+\s*$/, '').trim();
      author = ps[1] || (parens[0] && !HANGUL.test(parens[0]) === !HANGUL.test(title) ? '' : '') ;
      if (!ps[1] && parens.length) {
        // '제목(저자)' 꼴 — 괄호가 저자일 가능성이 크다 (제목과 같은 문자 체계면)
        const p0 = parens[0];
        if (!/^\d/.test(p0) && !/trans|번역|시리즈|series|^\d+권/i.test(p0)) author = p0;
      }
      publisher = ps[2] || '';
      segs.push(...ps.slice(1));
    }
    s.split(/[|/,()（）<>《》『』「」〈〉]|\s[-–—]\s|\sby\s/i).map(cleanPiece).filter(x => x.length >= 2).forEach(x => segs.push(x));
    segs.push(...parens);
    const hangul = hangulPart(title);
    if (hangul && hangul !== title) segs.push(hangul);
    const ko = hangul || parens.find(x => HANGUL.test(x) && !/번역|trans/i.test(x)) || '';
    return {
      title: title.trim(), author: author.trim(), publisher: publisher.trim(), ko,
      segs: [...new Set(segs.map(x => x.trim()).filter(Boolean))],
      memo: memo.join(' / '),
    };
  }

  // '오렌지 The Orange and Other Poems' → '오렌지' (한글 낱말만)
  function hangulPart(s) {
    const words = String(s || '').split(/\s+/);
    if (!words.some(w => HANGUL.test(w))) return '';
    // 한글 낱말이 이어진 앞부분 (숫자·부호 낱말은 이어 붙인다)
    const out = [];
    let started = false;
    for (const w of words) {
      if (HANGUL.test(w) || (started && /^[\d\p{P}]+$/u.test(w))) { out.push(w); started = true; }
      else if (started) break;
    }
    return out.join(' ').trim();
  }

  function searchQuery(b) {
    const t = b.ko || hangulPart(b.title) || b.title;
    const a = HANGUL.test(t) ? (hangulPart(b.author) || '') : (b.author || '');
    return [t, a].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  }

  const NOT_BOOK = /^(?:\*.*기준|해당 시가|출처|수정\s*(?:요청|사항)|책\s*(?:추천|제보)은\s*아니|좋은 사이트|감사합니다|https?:|\d{1,2}:\d{2}(?::\d{2})?\s*(?:부터|쯤|부근)?\s*$)/;
  // 책 제목도 '~했다'로 끝나는 게 많아서 말투가 분명한 끝맺음만 설명 문장으로 본다
  const SENTENCE = /(?:언급(?:했|함|하|됨)?\S*|말함|말했\S*|읽었음|읽었어\S*|했음|했어요|합니다|입니다|해요|봤어요|드립니다|드려요|감사\S*|부탁\S*|주세요|있어요|같아요|에용|네요|습니다|됩니다|ㅠ+|ㅜ+)[\s.!?~…ㅠㅜ]*$/;
  const FIX = /(?:사진|프로필|오타|잘못|바꿔|교체|제외|삭제|중복|수정\s*(?:요청|부탁|해)|기재\s*요청)/;
  const bulletKind = (l) => /^\s*\(?\d{1,2}\s*[.)]/.test(l) ? 'num' : /^\s*[*•▪◦‣]/.test(l) ? 'star' : /^\s*[-–—]/.test(l) ? 'dash' : '';

  /* 제보 한 줄 → { books:[{title,author,publisher,segs,urls,memo,line}], urls, memo } */
  function parseSubmission(text, source) {
    const books = [];
    const rowUrls = [];
    const rowMemo = [];
    const addUrls = (target, urls) => urls.forEach(u => { if (!target.includes(u)) target.push(u); });
    const addMemo = (b, m) => { if (!m) return; if (b) b.memo = [b.memo, m].filter(Boolean).join(' / '); else rowMemo.push(m); };

    const lines = String(text || '').split(/\r?\n/);
    // 1. 2. 처럼 번호(또는 * 표시)를 붙여 적었으면, 그 표시가 없는 줄은 앞 책의 설명으로 본다
    const kinds = lines.map(bulletKind);
    const cnt = (k) => kinds.filter(x => x === k).length;
    const lead = cnt('num') >= 2 ? 'num' : cnt('star') >= 2 ? 'star' : '';
    /* 링크 줄은 '앞 링크 뒤로 이어 적은 책들' 모두의 출처로 본다.
     *   책A / 책B / 책C / 링크1   → 링크1 은 A·B·C 셋 다
     *   책D / 링크2 / 링크3       → 둘 다 D
     * 책 줄에 링크가 같이 있으면 그 책 것이고, 묶음은 거기서 끊긴다. */
    let group = 0;          // 아직 링크를 못 받은 책 묶음의 시작
    let block = [];         // 바로 앞 링크가 붙은 책들 — 링크 줄이 이어지면 같은 묶음에 붙인다
    const toBlock = (urls) => {
      if (!urls.length) return;
      const fresh = books.slice(group);
      if (fresh.length) { block = fresh; group = books.length; }
      if (block.length) block.forEach(b => addUrls(b.urls, urls));
      else addUrls(rowUrls, urls);
    };
    for (let li = 0; li < lines.length; li++) {
      const rawLine = lines[li];
      const urls = extractUrls(rawLine).map(u => u.url);
      let rest = stripUrls(rawLine).replace(/\s+/g, ' ').trim();
      rest = rest.replace(/(\s*[/|,]\s*)+$/, '').replace(/^(\s*[/|,]\s*)+/, '').trim();
      const last = books[books.length - 1];
      if (!rest || /^[\s\p{P}\p{S}]*$/u.test(rest)) { toBlock(urls); continue; }
      if (LABEL_SRC.test(rest)) {
        const note = rest.replace(LABEL_SRC, '').trim();
        toBlock(urls);
        addMemo(last, note ? '출처: ' + note : '');
        continue;
      }
      const plain = rest.replace(/["“”][^"“”]{12,}["“”]/g, '');
      const isDesc = NOT_BOOK.test(rest) ||
        (lead && last && kinds[li] !== lead) ||
        (SENTENCE.test(plain.replace(/[(（][^)）]*[)）]/g, '').trim()) && !/\sby\s|[|/]|\s-\s|^\s*\d+[.)]/.test(rest)) ||
        (FIX.test(rest) && rest.length > 12 && !/\sby\s|[|/]|\s-\s/.test(rest));
      if (isDesc) { addMemo(last, rest.replace(BULLET, '')); toBlock(urls); continue; }
      for (const piece of splitMulti(rest)) {
        const p = parseLine(piece);
        if (!p.title) continue;
        if (p.title.length > 80 || piece.replace(/["“”][^"“”]{12,}["“”]/g, '').length > 160) { addMemo(books[books.length - 1], piece); continue; }
        books.push(Object.assign(p, { line: piece.trim(), urls: urls.slice() }));
      }
      if (urls.length) { block = books.slice(group); group = books.length; }
    }

    // 출처 칸: 책 제목이 적힌 줄 아래의 URL은 그 책 것, 나머지는 공통
    let cur = null;
    for (const rawLine of String(source || '').split(/\r?\n/)) {
      const urls = extractUrls(rawLine).map(u => u.url);
      const restRaw = stripUrls(rawLine).replace(/\s+/g, ' ').trim();
      const rest = restRaw.replace(LABEL_SRC, '').trim();
      if (rest && !/^[\s\p{P}\p{S}]*$/u.test(rest)) {
        const k = normTitle(rest);
        const hit = books.find(b => k && (normTitle(b.title) === k || (k.length >= 3 && normTitle(b.title).startsWith(k))));
        if (hit) { cur = hit; addUrls(hit.urls, urls); continue; }
        rowMemo.push(rest);
      }
      addUrls(cur ? cur.urls : rowUrls, urls);
    }
    const memo = rowMemo.join(' / ');
    const all = [];
    extractUrls(String(text || '') + '\n' + String(source || '')).forEach(u => { if (!all.includes(u.url)) all.push(u.url); });
    for (const b of books) {
      if (!b.urls.length) b.urls = rowUrls.slice();
      b.query = searchQuery(b);
    }
    return { books, urls: rowUrls, memo, allUrls: all };
  }

  /* AI 가 정리해 준 책 목록을 같은 모양으로 */
  function fromAi(ai, parsed) {
    const books = (ai.books || []).map(x => {
      const p = parseLine([x.title, x.author, x.publisher].filter(Boolean).join(' / '));
      const urls = x.source ? [x.source] : parsed.urls.slice();
      const segs = [...new Set([x.title, x.title_orig, ...(p.segs || [])].filter(Boolean))];
      const b = { title: x.title || p.title, author: x.author || '', publisher: x.publisher || '',
        segs, urls, memo: x.memo || '', line: [x.title, x.author].filter(Boolean).join(' - '), ai: true };
      b.query = x.query || searchQuery(b);
      return b;
    });
    return { books, urls: parsed.urls, allUrls: parsed.allUrls, memo: ai.memo != null ? ai.memo : parsed.memo };
  }

  /* ---------------- 셀럽 찾기 ---------------- */
  function splitName(n) {
    const m = /^(.*?)\s*[(（](.*)[)）]\s*$/.exec(String(n || ''));
    return m ? [m[1], m[2]] : [String(n || ''), ''];
  }
  // 그룹 이름 영문 표기가 데이터와 다른 경우
  const GROUP_ALIAS = { girlsgeneration: '소녀시대', snsd: '소녀시대', 소시: '소녀시대', bts: '방탄소년단', 방탄: '방탄소년단',
    tvxq: '동방신기', svt: '세븐틴', seventeen: '세븐틴', txt: '투바투', 투모로우바이투게더: '투바투', skz: '스트레이키즈', straykids: '스트레이키즈',
    xdinaryheroes: '엑스디너리히어로즈', 엑디즈: '엑스디너리히어로즈', ive: '아이브', aespa: '에스파', apink: '에이핑크', ateez: '에이티즈',
    theboyz: '더보이즈', 더비: '더보이즈', nuest: '뉴이스트', enhypen: '엔하이픈', babymonster: '베이비몬스터', 베몬: '베이비몬스터',
    shinee: '샤이니', exo: '엑소', blackpink: '블랙핑크', redvelvet: '레드벨벳', nmixx: '엔믹스', meovv: '미야오', whib: '휘브',
    alphadriveone: '알파드라이브원', ald1: '알파드라이브원', zerobaseone: '제로베이스원', zb1: '제로베이스원', tws: '투어스', ifeye: '이프아이' };
  let _groups = null, _groupsFor = null;
  function knownGroups(celebs) {
    if (_groupsFor === celebs && _groups) return _groups;
    const g = new Map();   // 정규화한 그룹 이름 → 대표(한글) 그룹 이름
    for (const c of celebs.values()) {
      const [, koG] = splitName(c.name), [, enG] = splitName(c.name_en);
      const k = norm(koG); if (!k) continue;
      g.set(k, k); if (norm(enG)) g.set(norm(enG), k);
    }
    for (const [a, b] of Object.entries(GROUP_ALIAS)) g.set(norm(a), norm(b));
    _groups = g; _groupsFor = celebs;
    return g;
  }
  // 제보 이름과 셀럽 목록을 비교해 점수 순으로 돌려준다
  function matchCeleb(subName, celebs, { aliases = {}, realNames = {} } = {}) {
    const raw = String(subName || '').trim();
    const whole = norm(raw);
    if (!whole) return [];
    if (aliases[whole] && celebs.has(aliases[whole])) return [{ name: aliases[whole], score: 1000 }];
    const groups = knownGroups(celebs);
    const toks = raw.split(/[\s()（）[\]/,·|&]+/).map(norm).filter(Boolean);
    const joins = new Set(toks);
    for (let i = 0; i < toks.length; i++) for (let j = i + 2; j <= toks.length; j++) joins.add(toks.slice(i, j).join(''));
    // 제보에 적힌 그룹 (알려진 그룹 이름만)
    const said = new Set();
    for (const t of joins) {
      if (groups.has(t)) said.add(groups.get(t));
      else for (const [k, v] of groups) if (k.length >= 3 && t.length >= 4 && t.includes(k) && t !== k) said.add(v);
    }
    const out = [];
    for (const c of celebs.values()) {
      const [koB, koG] = splitName(c.name).map(norm);
      const [enB, enG] = splitName(c.name_en).map(norm);
      const myG = koG ? (groups.get(koG) || koG) : '';
      const real = (realNames[c.name] || []).map(norm);
      let score = 0;
      if (whole === norm(c.name) || (c.name_en && whole === norm(c.name_en))) score = 100;
      else {
        let base = 0;
        if ((koB && joins.has(koB)) || (enB && joins.has(enB)) || real.some(r => joins.has(r) && !groups.has(r) && !GROUP_ALIAS[r])) base = 60;
        else if (koB.length >= 2 && [...joins].some(t => HANGUL.test(t) && t.length === koB.length + 1 && t.endsWith(koB))) base = 45;   // 이상원 → 상원
        if (!base) continue;
        let grp = 0;
        const sameG = (x) => x === myG || (x.length >= 3 && myG.length >= 3 && (x.startsWith(myG) || myG.startsWith(x)));
        if (myG && [...said].some(sameG)) grp = 30;
        else if (said.size && myG) grp = -30;                // 다른 그룹을 적었다 (솔로로 등록된 사람은 그대로)
        else if (/[(（]/.test(raw) && koG) grp = -10;         // 괄호에 뭔가 적었는데 그룹과 안 맞음
        score = base + grp;
      }
      if (score > 0) out.push({ name: c.name, score });
    }
    out.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'ko'));
    return out.slice(0, 8);
  }
  function autoCeleb(cands) {
    if (!cands.length) return '';
    const [a, b] = cands;
    if (a.score >= 1000) return a.name;
    if (a.score >= 55 && (!b || a.score - b.score >= 15)) return a.name;
    if (a.score >= 45 && (!b || a.score - b.score >= 15)) return a.name;
    return '';
  }

  /* ---------------- 반영 여부 ---------------- */
  function keysOf(b) {
    const ks = [normTitle(b.title), normTitle(b.title_en), normTitle(hangulPart(b.title))];
    const [base] = splitName(b.title);
    ks.push(normTitle(base));
    return [...new Set(ks.filter(Boolean))];
  }
  function titleHit(book, cand) {
    const bk = keysOf(book);
    const ck = [...new Set([cand.title, ...(cand.segs || [])].map(normTitle).filter(Boolean))];
    for (const a of ck) for (const b of bk) {
      if (a === b) return true;
      const [s, l] = a.length <= b.length ? [a, b] : [b, a];
      if (s.length >= 4 && l.includes(s) && s.length / l.length >= 0.45) return true;
    }
    const gid = (cand.urls || []).map(u => /yes24\.com\/(?:product\/)?goods\/(?:detail\/)?(\d+)/i.exec(u)).filter(Boolean).map(m => m[1]);
    if (gid.length && gid.some(g => (book.link || '').includes('/' + g) || (book.cover || '').includes('/' + g))) return true;
    return false;
  }
  /* 셀럽의 책 목록에서 후보를 찾는다 → { state: 'ok'|'src'|'miss', idx, book } */
  function checkBook(celeb, cand) {
    if (!celeb) return { state: 'miss', idx: -1 };
    let firstHit = -1;
    for (let i = 0; i < celeb.books.length; i++) {
      const b = celeb.books[i];
      if (!titleHit(b, cand)) continue;
      if (firstHit < 0) firstHit = i;
      if (!cand.urls || !cand.urls.length || cand.urls.some(u => sameUrl(u, b.source))) return { state: 'ok', idx: i, book: b };
    }
    if (firstHit >= 0) return { state: 'src', idx: firstHit, book: celeb.books[firstHit] };
    return { state: 'miss', idx: -1 };
  }

  const api = { norm, normTitle, normUrl, sameUrl, extractUrls, stripUrls, parseLine, parseSubmission, fromAi,
    hangulPart, searchQuery, matchCeleb, autoCeleb, checkBook, titleHit, splitName };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SubsCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
