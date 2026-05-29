/* ========================================================
   Favoread 카드뉴스 빌더
   인물 검색 → 읽은 책/출처 불러오기 → antiegg 풍 인스타 카드
   (표지 · 본문 · 출처 · 홍보) 생성 → PNG/ZIP 내보내기
   ======================================================== */
'use strict';

const OUTPUT_SCALE = 2;
const DEFAULT_SELECT = 5;
const PROXY = 'https://images.weserv.nl/?url=';

/* ---------- 배경 프리셋 ---------- */
const SWATCHES = [
  '#f4f1e9', '#faf8f3', '#efe7d6', '#f0e6e1',
  '#e4e8e0', '#e2e8ec', '#1f1d18', '#14110d',
];

/* ---------- 다국어 문구 ---------- */
const L = {
  ko: {
    brand: '최애의 독서',
    tagline: '당신이 좋아하는, 그들이 읽은 책',
    book: 'BOOK', source: 'SOURCE', books: 'BOOKS',
    sources: '출처', imgGroup: '이미지', txtGroup: '텍스트',
    bookCoverCredit: '도서 표지 ⓒ 알라딘 (aladin.co.kr)',
    coverPhoto: '표지 사진',
    promoTag: '당신이 좋아하는, 그들이 읽은 책',
    promoStat: (c, b) => `셀럽 ${c.toLocaleString()}명의 책 ${b.toLocaleString()}권을 만나보세요`,
    promoCta: '더 보러 가기',
    title: (n) => `${n}의 책장`,
    subtitle: (n, c) => `${josa(n, '이', '가')} 읽은 책 ${c}권`,
    noSrc: '출처 미상',
  },
  en: {
    brand: 'FAVOREAD',
    tagline: 'The books your faves are reading',
    book: 'BOOK', source: 'SOURCE', books: 'BOOKS',
    sources: 'Sources', imgGroup: 'Images', txtGroup: 'Text',
    bookCoverCredit: 'Book covers ⓒ Aladin (aladin.co.kr)',
    coverPhoto: 'Cover photo',
    promoTag: 'The books your faves are reading',
    promoStat: (c, b) => `Discover ${b.toLocaleString()} books from ${c} celebrities`,
    promoCta: 'Explore more',
    title: (n) => `${n}'s Bookshelf`,
    subtitle: (n, c) => `${c} books ${n} read`,
    noSrc: 'Source unknown',
  },
};
const T = () => L[state.opts.lang];

/* ---------- 상태 ---------- */
const state = {
  data: null,
  celebCount: 0,
  bookCount: 0,
  name: '',
  celeb: null,
  customImage: null,
  autoText: true,           // 제목/부제 자동 채움 여부
  books: [],
  opts: {
    lang: 'ko',
    format: 'portrait',
    coverLayout: 'split',   // split(좌우) | stack(상하)
    fit: 'contain',
    bg: '#f4f1e9',
    mono: false,
    covers: true,           // 표지에 책 표지 노출
    noImage: false,         // 표지 사진 비우고 프레임만
    outro: true,
    promo: true,
    proxy: true,
    title: '',
    subtitle: '',
    coverSrc: '',
    handle: 'favorbook.co.kr',
  },
};

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const status = (m) => { $('#statusMsg').textContent = m || ''; };

/* ---------- 한글 조사 ---------- */
function hasBatchim(ch) {
  if (!ch) return false;
  const c = ch.charCodeAt(0);
  if (c < 0xac00 || c > 0xd7a3) return false;
  return (c - 0xac00) % 28 !== 0;
}
function josa(word, withB, withoutB) {
  const w = String(word || '');
  return w + (hasBatchim(w[w.length - 1]) ? withB : withoutB);
}
const displayName = (n) => String(n || '').replace(/\s*\(.*?\)\s*$/, '').trim() || n;

/* ---------- 색상 유틸 (배경에 맞춰 글자색 자동) ---------- */
function hexToRgb(h) {
  const c = h.replace('#', '');
  return [parseInt(c.slice(0, 2), 16), parseInt(c.slice(2, 4), 16), parseInt(c.slice(4, 6), 16)];
}
function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('');
}
function mix(a, b, t) {
  const [r1, g1, b1] = hexToRgb(a), [r2, g2, b2] = hexToRgb(b);
  return rgbToHex(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t);
}
function luminance(h) {
  const [r, g, b] = hexToRgb(h).map((x) => {
    x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function paletteFor(bg) {
  const dark = luminance(bg) < 0.42;
  const ink = dark ? '#f1ece0' : '#181511';
  return {
    '--paper': bg,
    '--ink': ink,
    '--soft': mix(bg, ink, dark ? 0.72 : 0.66),
    '--mute': mix(bg, ink, dark ? 0.5 : 0.45),
    '--line': mix(bg, ink, dark ? 0.26 : 0.2),
    '--panel': mix(bg, ink, 0.06),
  };
}

/* ---------- 이미지 프록시 ---------- */
function cleanUrl(u) { return String(u || '').replace(/&amp;/g, '&').trim(); }
function proxify(u) {
  u = cleanUrl(u);
  if (!u || u.startsWith('data:')) return u;
  if (!state.opts.proxy) return u;
  if (!/^https?:\/\//i.test(u)) return u;
  return PROXY + encodeURIComponent(u.replace(/^https?:\/\//i, '')) + '&output=jpg&q=92';
}

/* ---------- 출처 매체 자동 인식 ---------- */
const SRC_MAP = [
  ['vogue.co.kr', 'VOGUE KOREA', '매거진'],
  ['elle.co.kr', 'ELLE KOREA', '매거진'],
  ['allurekorea.com', 'ALLURE KOREA', '매거진'],
  ['wkorea.com', 'W KOREA', '매거진'],
  ['marieclairekorea.com', 'MARIE CLAIRE KOREA', '매거진'],
  ['harpersbazaar.co.kr', "HARPER'S BAZAAR KOREA", '매거진'],
  ['gqkorea.co.kr', 'GQ KOREA', '매거진'],
  ['esquirekorea.co.kr', 'ESQUIRE KOREA', '매거진'],
  ['cosmopolitan.co.kr', 'COSMOPOLITAN KOREA', '매거진'],
  ['dazedkorea.com', 'DAZED KOREA', '매거진'],
  ['singles.co.kr', 'SINGLES', '매거진'],
  ['cine21.com', '씨네21', '매거진'],
  ['ch.yes24.com', '채널예스', '웹'],
  ['yes24.com', '예스24', '도서플랫폼'],
  ['millie.co.kr', '밀리의 서재', '도서플랫폼'],
  ['kyobobook', '교보문고', '도서플랫폼'],
  ['aladin.co.kr', '알라딘', '도서플랫폼'],
  ['ridibooks.com', '리디', '도서플랫폼'],
  ['munhak.com', '문학동네', '도서플랫폼'],
  ['sedaily.com', '서울경제', '신문'],
  ['hankyung.com', '한국경제', '신문'],
  ['mk.co.kr', '매일경제', '신문'],
  ['chosun.com', '조선일보', '신문'],
  ['donga.com', '동아일보', '신문'],
  ['joongang.co.kr', '중앙일보', '신문'],
  ['joins.com', '중앙일보', '신문'],
  ['hani.co.kr', '한겨레', '신문'],
  ['khan.co.kr', '경향신문', '신문'],
  ['hankookilbo.com', '한국일보', '신문'],
  ['seoul.co.kr', '서울신문', '신문'],
  ['kmib.co.kr', '국민일보', '신문'],
  ['dailian.co.kr', '데일리안', '신문'],
  ['newsen.com', '뉴스엔', '신문'],
  ['osen.co.kr', 'OSEN', '신문'],
  ['xportsnews.com', '엑스포츠뉴스', '신문'],
  ['tenasia.co.kr', '텐아시아', '신문'],
  ['sportschosun.com', '스포츠조선', '신문'],
  ['mydaily.co.kr', '마이데일리', '신문'],
  ['imbc.com', 'MBC', '방송'],
  ['kbs.co.kr', 'KBS', '방송'],
  ['sbs.co.kr', 'SBS', '방송'],
  ['jtbc', 'JTBC', '방송'],
  ['tvn', 'tvN', '방송'],
  ['youtube.com', '유튜브', '영상'],
  ['youtu.be', '유튜브', '영상'],
  ['instagram.com', '인스타그램', 'SNS'],
  ['twitter.com', 'X (트위터)', 'SNS'],
  ['x.com', 'X (트위터)', 'SNS'],
  ['tiktok.com', '틱톡', 'SNS'],
  ['weverse.io', '위버스', 'SNS'],
  ['news.naver.com', '네이버 뉴스', '웹'],
  ['v.daum.net', '다음', '웹'],
  ['theqoo.net', '더쿠', '커뮤니티'],
  ['fmkorea.com', '에펨코리아', '커뮤니티'],
  ['dcinside.com', '디시인사이드', '커뮤니티'],
  ['blog.naver.com', '네이버 블로그', '블로그'],
  ['post.naver.com', '네이버 포스트', '웹'],
  ['cafe.naver.com', '네이버 카페', '커뮤니티'],
  ['brunch.co.kr', '브런치', '블로그'],
  ['tistory.com', '티스토리', '블로그'],
  ['wikimedia.org', '위키미디어 커먼즈', '이미지'],
  ['wikipedia.org', '위키백과', '이미지'],
  ['namu.wiki', '나무위키', '이미지'],
  ['talkimg.imbc.com', 'MBC', '방송'],
];

function detectSource(url) {
  const u = cleanUrl(url);
  let host = '';
  try { host = new URL(u).hostname.replace(/^www\.|^m\./, ''); } catch { /* ignore */ }
  let name = host || '', type = '웹';
  for (const [needle, n, t] of SRC_MAP) {
    if (u.includes(needle)) { name = n; type = t; break; }
  }
  let date = '';
  let m = u.match(/\/(20\d{2})[\/\-_.](\d{1,2})[\/\-_.](\d{1,2})(?:\D|$)/);
  if (!m) m = u.match(/(?:^|\D)(20\d{2})(\d{2})(\d{2})(?:\D|$)/);
  if (m) {
    const mm = m[2].padStart(2, '0'), dd = m[3].padStart(2, '0');
    if (+mm >= 1 && +mm <= 12 && +dd >= 1 && +dd <= 31) date = `${m[1]}.${mm}.${dd}`;
  }
  return { name, type, date };
}

function citeParts(b) { return b.srcName ? `<b>${esc(b.srcName)}</b>` : ''; }
function citeText(b) { return (b.srcName || '').trim(); }

/* ========================================================
   부트
   ======================================================== */
async function boot() {
  status('데이터 불러오는 중…');
  try {
    const res = await fetch('../data.json', { cache: 'no-cache' });
    state.data = await res.json();
    state.celebCount = Object.keys(state.data.celebs).length;
    state.bookCount = Object.values(state.data.celebs).reduce((a, c) => a + c.books.length, 0);
    status(`${state.celebCount}명 · 책 ${state.bookCount}권 로드됨`);
  } catch (e) {
    status('data.json 로드 실패'); console.error(e); return;
  }
  buildSwatches();
  bindOptions();
  bindSearch();
}

/* ========================================================
   검색
   ======================================================== */
function bindSearch() {
  const input = $('#search'), box = $('#results');
  let active = -1, items = [];
  const render = (q) => {
    const names = Object.keys(state.data.celebs);
    const ql = q.trim().toLowerCase();
    items = !ql ? [] : names.filter((n) => n.toLowerCase().includes(ql)).slice(0, 40);
    if (!ql) { box.classList.add('hidden'); return; }
    box.classList.remove('hidden'); active = -1;
    if (!items.length) { box.innerHTML = '<li class="empty">검색 결과가 없어요</li>'; return; }
    box.innerHTML = items.map((n, i) => {
      const c = state.data.celebs[n];
      return `<li data-i="${i}" data-name="${esc(n)}">
        <img src="${esc(proxify(c.imageUrl))}" referrerpolicy="no-referrer" onerror="this.style.visibility='hidden'">
        <span>${esc(n)}</span><span class="rc">책 ${c.books.length}</span></li>`;
    }).join('');
  };
  input.addEventListener('input', () => render(input.value));
  input.addEventListener('focus', () => { if (input.value.trim()) render(input.value); });
  input.addEventListener('keydown', (e) => {
    if (box.classList.contains('hidden')) return;
    if (e.key === 'ArrowDown') active = Math.min(active + 1, items.length - 1);
    else if (e.key === 'ArrowUp') active = Math.max(active - 1, 0);
    else if (e.key === 'Enter') { if (active >= 0) pick(items[active]); return; }
    else return;
    e.preventDefault();
    $$('li', box).forEach((li, i) => li.classList.toggle('active', i === active));
  });
  box.addEventListener('click', (e) => {
    const li = e.target.closest('li[data-name]'); if (li) pick(li.dataset.name);
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-wrap')) box.classList.add('hidden');
  });
  function pick(name) { box.classList.add('hidden'); input.value = name; selectCeleb(name); }
}

/* ========================================================
   인물 선택
   ======================================================== */
function applyAutoText() {
  const dn = displayName(state.name);
  const c = selectedBooks().length || DEFAULT_SELECT;
  state.opts.title = T().title(dn);
  state.opts.subtitle = T().subtitle(dn, c);
  $('#optTitle').value = state.opts.title;
  $('#optSubtitle').value = state.opts.subtitle;
}
function refreshAutoText() {
  if (state.autoText && state.name) { applyAutoText(); }
}

function selectCeleb(name) {
  state.name = name;
  state.celeb = state.data.celebs[name];
  state.customImage = null;
  state.autoText = true;

  const cs = detectSource(state.celeb.imageUrl);
  state.opts.coverSrc = cs.name ? `ⓒ ${cs.name}${cs.date ? ' · ' + cs.date : ''}` : '';
  $('#optCoverSrc').value = state.opts.coverSrc;

  state.books = state.celeb.books.map((ref, i) => {
    const q = (ref.comment || '').trim();
    return {
      ref, selected: i < DEFAULT_SELECT, quote: q, noQuote: !q,
      srcName: detectSource(ref.source).name,
    };
  });
  applyAutoText();

  $('#celebBlock').classList.remove('hidden');
  $('#optsBlock').classList.remove('hidden');
  $('#booksBlock').classList.remove('hidden');
  $('#celebThumb').src = proxify(state.celeb.imageUrl);
  $('#celebName').textContent = name;
  $('#celebCount').textContent = `책 ${state.celeb.books.length}권`;
  $('#zipBtn').disabled = false;
  $('#copyBtn').disabled = false;

  renderBookList();
  renderPreview();
}

/* ========================================================
   책 목록 패널
   ======================================================== */
function renderBookList() {
  const ul = $('#bookList');
  ul.innerHTML = state.books.map((b, i) => {
    const r = b.ref;
    return `<li class="book-item" data-i="${i}">
      <div class="book-head">
        <input type="checkbox" class="bk-sel" ${b.selected ? 'checked' : ''} title="카드에 포함">
        <img src="${esc(proxify(r.coverUrl))}" referrerpolicy="no-referrer" onerror="this.style.visibility='hidden'">
        <div class="bt"><b>${esc(r.title)}</b><span>${esc(r.author || '')}${r.publisher ? ' · ' + esc(r.publisher) : ''}</span></div>
        ${(!b.noQuote && b.quote) ? '<span class="badge-on">대목</span>' : ''}
        <span class="caret">▸</span>
      </div>
      <div class="book-edit">
        <label class="chk" style="margin-top:11px"><input type="checkbox" class="bk-noq" ${b.noQuote ? 'checked' : ''}> 언급 대목 없음 (책·제목을 가운데 배치)</label>
        <label class="field">
          <span>언급 대목 (인용문) ${r.source ? `· <a class="src-open" href="${esc(cleanUrl(r.source))}" target="_blank" rel="noreferrer">출처 열기 ↗</a>` : ''}</span>
          <textarea class="bk-quote" rows="3" placeholder="이 인물이 책을 언급/추천한 문장을 붙여넣으세요" ${b.noQuote ? 'disabled' : ''}>${esc(b.quote)}</textarea>
        </label>
        <label class="field"><span>매체명 (출처)</span><input class="bk-name" type="text" value="${esc(b.srcName)}" placeholder="예: VOGUE KOREA"></label>
      </div>
    </li>`;
  }).join('');

  $$('.book-item', ul).forEach((li) => {
    const i = +li.dataset.i, b = state.books[i];
    li.querySelector('.book-head').addEventListener('click', (e) => {
      if (e.target.classList.contains('bk-sel')) return;
      li.classList.toggle('open');
    });
    li.querySelector('.bk-sel').addEventListener('change', (e) => { b.selected = e.target.checked; refreshAutoText(); renderPreview(); });
    const reflectBadge = () => {
      const head = li.querySelector('.book-head');
      let badge = head.querySelector('.badge-on');
      const show = !b.noQuote && b.quote;
      if (show && !badge) { badge = document.createElement('span'); badge.className = 'badge-on'; badge.textContent = '대목'; head.insertBefore(badge, head.querySelector('.caret')); }
      else if (!show && badge) badge.remove();
    };
    li.querySelector('.bk-noq').addEventListener('change', (e) => {
      b.noQuote = e.target.checked;
      li.querySelector('.bk-quote').disabled = b.noQuote;
      reflectBadge(); renderPreview();
    });
    li.querySelector('.bk-quote').addEventListener('input', (e) => { b.quote = e.target.value; reflectBadge(); renderPreview(); });
    li.querySelector('.bk-name').addEventListener('input', (e) => { b.srcName = e.target.value; renderPreview(); });
  });
}

/* ========================================================
   옵션 바인딩
   ======================================================== */
function buildSwatches() {
  const box = $('#swatches');
  box.innerHTML = SWATCHES.map((c) =>
    `<button data-c="${c}" style="background:${c}" title="${c}"></button>`).join('');
  box.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-c]'); if (!btn) return;
    setBg(btn.dataset.c);
  });
  markSwatch();
}
function markSwatch() {
  $$('#swatches button').forEach((b) => b.classList.toggle('active', b.dataset.c.toLowerCase() === state.opts.bg.toLowerCase()));
}
function setBg(c) {
  state.opts.bg = c;
  $('#optBgCustom').value = /^#[0-9a-f]{6}$/i.test(c) ? c : '#f4f1e9';
  markSwatch();
  renderPreview();
}

function bindOptions() {
  $('#optTitle').addEventListener('input', (e) => { state.opts.title = e.target.value; state.autoText = false; renderPreview(); });
  $('#optSubtitle').addEventListener('input', (e) => { state.opts.subtitle = e.target.value; state.autoText = false; renderPreview(); });
  $('#optCoverSrc').addEventListener('input', (e) => { state.opts.coverSrc = e.target.value; renderPreview(); });
  $('#optHandle').addEventListener('input', (e) => { state.opts.handle = e.target.value; renderPreview(); });
  $('#optBgCustom').addEventListener('input', (e) => setBg(e.target.value));

  $$('input[name=lang]').forEach((r) => r.addEventListener('change', () => {
    state.opts.lang = $$('input[name=lang]').find((x) => x.checked).value;
    refreshAutoText();
    renderPreview();
  }));
  $$('input[name=format]').forEach((r) => r.addEventListener('change', () => {
    state.opts.format = $$('input[name=format]').find((x) => x.checked).value; renderPreview();
  }));
  $$('input[name=fit]').forEach((r) => r.addEventListener('change', () => {
    state.opts.fit = $$('input[name=fit]').find((x) => x.checked).value; renderPreview();
  }));
  $$('input[name=coverLayout]').forEach((r) => r.addEventListener('change', () => {
    state.opts.coverLayout = $$('input[name=coverLayout]').find((x) => x.checked).value; renderPreview();
  }));
  $('#optMono').addEventListener('change', (e) => { state.opts.mono = e.target.checked; renderPreview(); });
  $('#optCovers').addEventListener('change', (e) => { state.opts.covers = e.target.checked; renderPreview(); });
  $('#optNoImage').addEventListener('change', (e) => { state.opts.noImage = e.target.checked; renderPreview(); });
  $('#optOutro').addEventListener('change', (e) => { state.opts.outro = e.target.checked; renderPreview(); });
  $('#optPromo').addEventListener('change', (e) => { state.opts.promo = e.target.checked; renderPreview(); });
  $('#optProxy').addEventListener('change', (e) => {
    state.opts.proxy = e.target.checked;
    if (state.celeb) { $('#celebThumb').src = proxify(state.celeb.imageUrl); renderBookList(); }
    renderPreview();
  });

  $('#selAll').addEventListener('click', () => { state.books.forEach((b) => b.selected = true); refreshAutoText(); renderBookList(); renderPreview(); });
  $('#selNone').addEventListener('click', () => { state.books.forEach((b) => b.selected = false); refreshAutoText(); renderBookList(); renderPreview(); });

  $('#celebUpload').addEventListener('change', (e) => {
    const f = e.target.files[0]; if (!f) return;
    const fr = new FileReader();
    fr.onload = () => { state.customImage = fr.result; $('#celebThumb').src = fr.result; renderPreview(); };
    fr.readAsDataURL(f);
  });

  $('#zipBtn').addEventListener('click', exportZip);
  $('#copyBtn').addEventListener('click', copyScript);
}

/* ========================================================
   카드 슬라이드 생성
   ======================================================== */
function dims() { return state.opts.format === 'square' ? [1080, 1080] : [1080, 1350]; }
function selectedBooks() { return state.books.filter((b) => b.selected); }

function topBar(left, right) {
  return `<div class="cn-top"><span class="cn-kicker">${esc(left)}</span>
    ${right ? `<span class="cn-kicker r">${esc(right)}</span>` : ''}</div>`;
}

function fanHTML(sel, n, h) {
  if (!state.opts.covers || !sel.length) return '';
  return `<div class="cn-fan" style="height:${h}px">${sel.slice(0, n).map((b) => {
    const w = Math.round(h * 0.66);
    return `<div class="bk" style="width:${w}px"><img src="${esc(proxify(b.ref.coverUrl))}" crossorigin="anonymous" referrerpolicy="no-referrer"></div>`;
  }).join('')}</div>`;
}

function coverHTML() {
  const sel = selectedBooks();
  const img = state.customImage || proxify(state.celeb.imageUrl);
  const sq = state.opts.format === 'square';
  const foot = state.opts.coverSrc ? `<div class="cn-foot"><span>${esc(state.opts.coverSrc)}</span></div>` : '';

  if (state.opts.coverLayout === 'split') {
    const fan = fanHTML(sel, sq ? 3 : 4, sq ? 118 : 150);
    const photo = state.opts.noImage
      ? `<div class="cn-split-photo empty"></div>`
      : `<div class="cn-split-photo"><img src="${esc(img)}" crossorigin="anonymous" referrerpolicy="no-referrer"></div>`;
    return `<div class="cn-cover split">
      <div class="cn-split-main">
        <div class="cn-cv-brand"><span class="cn-kicker">${esc(T().brand)}</span><span class="cn-kicker tag">${esc(T().tagline)}</span></div>
        <div class="cn-cv-body">
          <h1 class="cn-title">${esc(state.opts.title)}</h1>
          ${state.opts.subtitle ? `<div class="cn-sub">${esc(state.opts.subtitle)}</div>` : ''}
        </div>
        ${fan}
        ${foot}
      </div>
      ${photo}
    </div>`;
  }

  // stack (기본 상하)
  const fan = fanHTML(sel, sq ? 4 : 5, sq ? 128 : 168);
  const photo = state.opts.noImage
    ? `<div class="cn-photo empty"></div>`
    : `<div class="cn-photo"><img src="${esc(img)}" crossorigin="anonymous" referrerpolicy="no-referrer"></div>`;
  return `<div class="cn-pad cn-cover">
    ${topBar(T().brand, T().tagline)}
    <h1 class="cn-title">${esc(state.opts.title)}</h1>
    ${state.opts.subtitle ? `<div class="cn-sub">${esc(state.opts.subtitle)}</div>` : ''}
    ${photo}
    ${fan}
    ${foot}
  </div>`;
}

function bookTitle(r) { return state.opts.lang === 'en' ? (r.title_en || r.title) : r.title; }
function bookAuthor(r) { return state.opts.lang === 'en' ? (r.author_en || r.author) : r.author; }

function bookHTML(b, idx, total) {
  const r = b.ref, sq = state.opts.format === 'square';
  const ch = sq ? 360 : 470, cw = Math.round(ch * 0.66);
  const cite = citeParts(b);
  const meta = [bookAuthor(r), state.opts.lang === 'en' ? '' : r.publisher].filter(Boolean).join(' · ');
  const showQuote = !b.noQuote && (b.quote || '').trim();
  const quote = showQuote
    ? `<div class="cn-quote"><span class="qmark">“</span><p>${esc(b.quote)}</p></div>`
    : '';
  return `<div class="cn-pad cn-book${showQuote ? '' : ' centered'}">
    <div class="cn-top">
      <span class="cn-big-num"><span class="cn-num-lat">${String(idx).padStart(2, '0')}</span> / ${String(total).padStart(2, '0')}</span>
      <span class="cn-kicker r">${esc(T().brand)}</span>
    </div>
    <div class="cn-body">
      <div class="cn-cover-img" style="width:${cw}px;height:${ch}px">
        <img src="${esc(proxify(r.coverUrl))}" crossorigin="anonymous" referrerpolicy="no-referrer">
      </div>
      <h2 class="cn-bk-title">${esc(bookTitle(r))}</h2>
      ${meta ? `<div class="cn-bk-meta">${esc(meta)}</div>` : ''}
      ${quote}
    </div>
    ${cite ? `<div class="cn-src"><span class="cn-src-lab">${esc(T().source)}</span><span class="cn-cite">${cite}</span></div>` : ''}
  </div>`;
}

function outroHTML() {
  const sel = selectedBooks();
  // 텍스트(인용) 출처
  const txt = sel.map((b, i) =>
    `<li><span class="n">${String(i + 1).padStart(2, '0')}</span>
      <span class="t"><b>《${esc(bookTitle(b.ref))}》</b> — ${esc(citeText(b) || T().noSrc)}</span></li>`).join('');
  // 이미지 출처
  const imgItems = [];
  if (state.opts.coverSrc) imgItems.push(`${T().coverPhoto} — ${state.opts.coverSrc.replace(/^ⓒ\s*/, '')}`);
  imgItems.push(T().bookCoverCredit);
  const img = imgItems.map((s, i) =>
    `<li><span class="n">${String(i + 1).padStart(2, '0')}</span><span class="t">${esc(s)}</span></li>`).join('');
  return `<div class="cn-pad cn-outro">
    ${topBar(T().brand, T().tagline)}
    <h2 class="cn-otitle">${esc(T().sources)}</h2>
    <div class="cn-srcgroup">
      <div class="cn-glab">${esc(T().txtGroup)}</div>
      <ul class="cn-srclist">${txt}</ul>
    </div>
    <div class="cn-srcgroup">
      <div class="cn-glab">${esc(T().imgGroup)}</div>
      <ul class="cn-srclist">${img}</ul>
    </div>
    <div class="cn-spacer"></div>
    <div class="cn-foot"><span class="h">${esc(displayName(state.name))}</span><span class="g">${esc(state.opts.handle)}</span></div>
  </div>`;
}

function promoHTML() {
  return `<div class="cn-pad cn-promo">
    <div class="cn-bn">${esc(T().brand)}</div>
    <div class="cn-tag">${esc(T().promoTag)}</div>
    <div class="cn-stat">${esc(T().promoStat(state.celebCount, state.bookCount))}</div>
    <div class="cn-cta">${esc(state.opts.handle)} <span class="arr">→</span></div>
  </div>`;
}

function buildSlides() {
  const slides = [], sel = selectedBooks();
  slides.push({ name: 'cover', html: coverHTML() });
  sel.forEach((b, i) => slides.push({ name: `book${i + 1}`, html: bookHTML(b, i + 1, sel.length) }));
  if (state.opts.outro && sel.length) slides.push({ name: 'sources', html: outroHTML() });
  if (state.opts.promo) slides.push({ name: 'promo', html: promoHTML() });
  return slides;
}

function makeSlideEl(html) {
  const el = document.createElement('div');
  el.className = 'cn-slide'
    + (state.opts.format === 'square' ? ' square' : '')
    + (state.opts.mono ? ' cn-mono' : '')
    + (state.opts.fit === 'cover' ? ' fit-cover' : ' fit-contain');
  const pal = paletteFor(state.opts.bg);
  for (const k in pal) el.style.setProperty(k, pal[k]);
  el.style.background = pal['--paper'];
  el.innerHTML = html;
  return el;
}

/* ========================================================
   미리보기
   ======================================================== */
function renderPreview() {
  if (!state.celeb) return;
  const wrap = $('#slides');
  $('#stageEmpty').classList.add('hidden');
  const slides = buildSlides();
  const [w, h] = dims();
  const stageW = $('.stage').clientWidth - 56;
  const previewW = Math.min(400, Math.max(240, stageW));
  const s = previewW / w;

  wrap.innerHTML = '';
  slides.forEach((sl, i) => {
    const el = makeSlideEl(sl.html);
    el.style.transform = `scale(${s})`;
    const frame = document.createElement('div');
    frame.className = 'cn-frame';
    frame.style.width = `${w * s}px`; frame.style.height = `${h * s}px`;
    frame.appendChild(el);

    const bar = document.createElement('div');
    bar.className = 'slide-bar';
    const labels = { cover: '표지', sources: '출처', promo: '홍보' };
    const label = labels[sl.name] || `본문 ${sl.name.replace('book', '')}`;
    bar.innerHTML = `<b>${String(i + 1).padStart(2, '0')}</b> ${label}`;
    const dl = document.createElement('button');
    dl.textContent = '⤓ PNG';
    dl.addEventListener('click', () => exportOne(sl, i));
    bar.appendChild(dl);

    const sw = document.createElement('div');
    sw.className = 'slide-wrap';
    sw.append(frame, bar);
    wrap.appendChild(sw);
  });
}
let resizeT;
window.addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(renderPreview, 150); });

/* ========================================================
   내보내기
   ======================================================== */
function waitForImages(node, timeout = 9000) {
  return Promise.all($$('img', node).map((img) => {
    if (img.complete && img.naturalWidth) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => resolve();
      img.addEventListener('load', done, { once: true });
      img.addEventListener('error', done, { once: true });
      setTimeout(done, timeout);
    });
  }));
}
async function slideToCanvas(sl) {
  const [w, h] = dims();
  const el = makeSlideEl(sl.html);
  el.style.transform = 'none';
  const holder = document.createElement('div');
  holder.style.cssText = 'position:fixed;left:-99999px;top:0;z-index:-1';
  holder.appendChild(el);
  document.body.appendChild(holder);
  try {
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    await waitForImages(el);
    await new Promise((r) => setTimeout(r, 120));
    return await html2canvas(el, {
      width: w, height: h, windowWidth: w, windowHeight: h,
      scale: OUTPUT_SCALE, useCORS: true, backgroundColor: null, logging: false,
    });
  } finally { holder.remove(); }
}
function safeName(s) { return String(s).replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, '_'); }
function canvasToBlob(c) { return new Promise((r) => c.toBlob(r, 'image/png')); }

async function exportOne(sl, i) {
  status('PNG 만드는 중…');
  try {
    const blob = await canvasToBlob(await slideToCanvas(sl));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${safeName(displayName(state.name))}_${String(i + 1).padStart(2, '0')}_${sl.name}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    status('완료');
  } catch (e) { console.error(e); status('저장 실패 (프록시를 켜고 다시 시도해 보세요)'); }
}
async function exportZip() {
  if (!state.celeb) return;
  const slides = buildSlides(), zip = new JSZip(), base = safeName(displayName(state.name));
  for (let i = 0; i < slides.length; i++) {
    status(`PNG ${i + 1}/${slides.length} 만드는 중…`);
    const blob = await canvasToBlob(await slideToCanvas(slides[i]));
    zip.file(`${base}_${String(i + 1).padStart(2, '0')}_${slides[i].name}.png`, blob);
  }
  status('ZIP 압축 중…');
  const out = await zip.generateAsync({ type: 'blob' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(out);
  a.download = `favoread_cardnews_${base}.zip`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  status(`완료 · ${slides.length}장`);
}

/* ========================================================
   전체 원고 복사
   ======================================================== */
function buildScript() {
  const dn = displayName(state.name), sel = selectedBooks(), lines = [];
  lines.push(`[${T().brand}] ${state.opts.title}`);
  if (state.opts.subtitle) lines.push(state.opts.subtitle);
  if (state.opts.coverSrc) lines.push(state.opts.coverSrc);
  lines.push('');
  sel.forEach((b, i) => {
    const r = b.ref;
    lines.push(`${String(i + 1).padStart(2, '0')}. 《${bookTitle(r)}》 ${[bookAuthor(r), state.opts.lang === 'en' ? '' : r.publisher].filter(Boolean).join(' · ')}`);
    if (b.quote) lines.push(`“${b.quote}”`);
    const c = citeText(b); if (c) lines.push(`${T().source}: ${c}`);
    lines.push('');
  });
  lines.push(`[${T().sources}]`);
  lines.push(`· ${T().txtGroup}`);
  sel.forEach((b, i) => lines.push(`  ${i + 1}. 《${bookTitle(b.ref)}》 — ${citeText(b) || T().noSrc}`));
  lines.push(`· ${T().imgGroup}`);
  if (state.opts.coverSrc) lines.push(`  - ${T().coverPhoto} — ${state.opts.coverSrc.replace(/^ⓒ\s*/, '')}`);
  lines.push(`  - ${T().bookCoverCredit}`);
  lines.push('');
  lines.push(`${T().brand} · ${T().promoTag}`);
  lines.push(`${T().promoStat(state.celebCount, state.bookCount)} · ${state.opts.handle}`);
  return lines.join('\n');
}
async function copyScript() {
  const text = buildScript();
  try {
    await navigator.clipboard.writeText(text);
    status('원고가 복사되었어요');
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); status('원고가 복사되었어요'); }
    catch { status('복사 실패'); }
    ta.remove();
  }
}

boot();
