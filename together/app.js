/* ========================================================
   최애의 독서 — 함께 읽기 카드 메이커
   최애 사진을 배경으로, 최애가 읽은 책 표지를 스티커처럼 붙여
   인스타그램용 카드를 만들고 PNG로 내보낸다.
   ======================================================== */
'use strict';

const OUTPUT_SCALE = 2;
const BOOK_W_MIN = 90;    // 책 표지 폭 최소/최대 (카드 1080px 기준)
const BOOK_W_MAX = 900;
const PROXY = 'https://images.weserv.nl/?url=';
const SIZES = {
  portrait: [1080, 1350],
  square: [1080, 1080],
  story: [1080, 1920],
};

/* ---------- 테마 ---------- */
const THEMES = {
  pop:    { label: '스티커 팝',    emoji: '⭐', desc: '두꺼운 테두리', font: 'jua',   ink: '#111111', paper: '#ffffff', a: '#ff5d8f', b: '#ffe14d', c: '#7cf0a0' },
  pastel: { label: '파스텔 소다',  emoji: '🍡', desc: '말랑 파스텔',   font: 'jua',   ink: '#4a3f55', paper: '#fff8fb', a: '#ffc2dc', b: '#bfe4ff', c: '#dcd2ff' },
  neon:   { label: '네온 나이트',  emoji: '🌃', desc: '어두운 배경',   font: 'black', ink: '#f6f3ff', paper: '#141024', a: '#8b5cf6', b: '#22d3ee', c: '#f472b6' },
  cream:  { label: '크림 다이어리', emoji: '📔', desc: '손글씨 느낌',   font: 'gaegu', ink: '#453c31', paper: '#fdf6e9', a: '#f2c14e', b: '#cfe0c3', c: '#f7cdb8' },
  mono:   { label: '모노 클래식',  emoji: '🖤', desc: '흑백 담백',     font: 'serif', ink: '#111111', paper: '#f4f3f0', a: '#ffffff', b: '#111111', c: '#dedcd6' },
};
const THEME_KEYS = Object.keys(THEMES);

/* 배경색 · 글자색 프리셋 */
const PAPER_SWATCHES = [
  '#ffffff', '#fff8fb', '#fdf6e9', '#f4f3f0',
  '#ffe8f0', '#e8f4ff', '#3a3a44', '#141024',
];
const INK_SWATCHES = [
  '#111111', '#453c31', '#4a3f55', '#1f3a5f',
  '#7a1f3d', '#1f4d3d', '#f4f3f0', '#ffffff',
];

/* ---------- 상태 ---------- */
const state = {
  data: null,
  name: '',
  celeb: null,
  size: 'portrait',
  theme: 'pop',
  paperAuto: true,      // 배경색: 테마 기본값 사용
  paper: '#ffffff',
  inkAuto: true,        // 글자색: 테마 기본값 사용
  ink: '#111111',
  bookBorder: false,    // 책 표지 테두리(기본 없음)
  bookScale: 1,         // 책 표지 크기 배율 (자동 정렬 기준 폭에 곱한다)
  bookFace: 'spine',    // 책을 어떻게 보여줄지 — 'spine'(책등) | 'cover'(표지)
  proxy: true,
  watermark: true,
  credit: '',
  bg: { src: '', custom: null, fit: 'cover', zoom: 1, x: 50, y: 50, dim: 0 },
  items: [],
  sel: null,
  seq: 1,
};

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const escML = (s) => esc(s).replace(/\r\n|\r|\n/g, '<br>');
const status = (m) => { $('#statusMsg').textContent = m || ''; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const isBlank = (s) => !String(s == null ? '' : s).trim();

/* ── 책등 ─────────────────────────────────────────────────────────
 * 예스24는 표지와 같은 상품 ID로 책등 이미지를 준다.
 *   표지  https://image.yes24.com/goods/91901136/L
 *   책등  https://image.yes24.com/goods/91901136/side
 * 표지가 알라딘인 책은 ID를 모르니 제목에서 만든 색 책등으로 대신한다.
 * (generate.py의 yes24_spine_url / spine_tint 와 같은 규칙) */
const YES24_ID_RE = /image\.yes24\.com\/goods\/(?:detail\/)?(\d+)/i;
function yes24SpineUrl(coverUrl) {
  const m = YES24_ID_RE.exec(coverUrl || '');
  return m ? 'https://image.yes24.com/goods/' + m[1] + '/side' : '';
}
function hashOf(str, mul) {
  let h = 0;
  for (const ch of String(str || '')) h = (Math.imul(h, mul) + ch.codePointAt(0)) >>> 0;
  return h;
}
function spineTint(title) {
  const h = hashOf(title, 31);
  return `hsl(${h % 360},${32 + (h >>> 9) % 26}%,${26 + (h >>> 17) % 22}%)`;
}
const SPINE_RATIO = 4.3;   // 높이 / 폭
const displayName = (n) => String(n || '').replace(/\s*\(.*?\)\s*$/, '').trim() || n;

/* ---------- 한글 조사 ---------- */
function hasBatchim(ch) {
  if (!ch) return false;
  const c = ch.charCodeAt(0);
  if (c < 0xac00 || c > 0xd7a3) return false;
  return (c - 0xac00) % 28 !== 0;
}
const josa = (w, withB, withoutB) =>
  String(w || '') + (hasBatchim(String(w || '').slice(-1)) ? withB : withoutB);

/* ---------- 색 ---------- */
function hexToRgb(h) {
  const c = String(h).replace('#', '');
  return [parseInt(c.slice(0, 2), 16), parseInt(c.slice(2, 4), 16), parseInt(c.slice(4, 6), 16)];
}
function luminance(h) {
  const [r, g, b] = hexToRgb(h).map((x) => {
    x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const onColor = (bg) => (luminance(bg) < 0.5 ? '#ffffff' : '#141414');

/* ---------- 이미지 ---------- */
function cleanUrl(u) { return String(u || '').replace(/&amp;/g, '&').trim(); }
function proxify(u) {
  u = cleanUrl(u);
  if (!u || u.startsWith('data:')) return u;
  if (!state.proxy || !/^https?:\/\//i.test(u)) return u;
  return PROXY + encodeURIComponent(u.replace(/^https?:\/\//i, '')) + '&output=jpg&q=92';
}

/* 원본 크기를 기억해 두는 범용 이미지 툴 (어떤 비율의 사진이 와도 맞춰 준다) */
const imgMeta = Object.create(null);
let refitTimer;
function noteMeta(url) {
  if (!url || imgMeta[url] !== undefined) return;
  imgMeta[url] = null;
  const im = new Image();
  im.crossOrigin = 'anonymous';
  im.onload = () => {
    imgMeta[url] = { w: im.naturalWidth || 0, h: im.naturalHeight || 0 };
    clearTimeout(refitTimer);
    refitTimer = setTimeout(() => { applyFits(document); }, 60);
  };
  im.onerror = () => { imgMeta[url] = { w: 0, h: 0 }; };
  im.src = url;
}
/* 배경처럼 상자를 채우는 이미지: 상자 크기에 맞춰 배율을 계산 */
function applyFits(root) {
  $$('.tg-fit', root || document).forEach((d) => {
    const m = imgMeta[d.dataset.src];
    const W = d.clientWidth, H = d.clientHeight;
    if (!m || !m.w || !m.h || !W || !H) return;
    const base = d.dataset.fit === 'contain' ? Math.min(W / m.w, H / m.h) : Math.max(W / m.w, H / m.h);
    const z = parseFloat(d.dataset.zoom) || 1;
    d.style.backgroundSize = `${Math.round(m.w * base * z)}px ${Math.round(m.h * base * z)}px`;
    d.style.backgroundPosition = `${d.dataset.x}% ${d.dataset.y}%`;
  });
  /* 책 표지는 원본 비율 그대로 (잘리지 않게) */
  $$('.tg-book', root || document).forEach((d) => {
    const inner = d.querySelector('.tg-bookimg');
    if (!inner) return;
    const m = imgMeta[inner.dataset.src];
    const ratio = m && m.w && m.h ? m.h / m.w : 1.45;
    inner.style.height = `${Math.round(d.clientWidth * ratio)}px`;
  });
}
/* 업로드 사진은 긴 변 1600px로 축소 */
function readImageFile(file, cb) {
  const fr = new FileReader();
  fr.onload = () => {
    const im = new Image();
    im.onload = () => {
      const MAX = 1600;
      const s = Math.min(1, MAX / Math.max(im.naturalWidth, im.naturalHeight));
      if (s >= 1) { cb(fr.result); return; }
      const cv = document.createElement('canvas');
      cv.width = Math.round(im.naturalWidth * s);
      cv.height = Math.round(im.naturalHeight * s);
      cv.getContext('2d').drawImage(im, 0, 0, cv.width, cv.height);
      cb(cv.toDataURL('image/jpeg', 0.92));
    };
    im.onerror = () => cb(fr.result);
    im.src = fr.result;
  };
  fr.readAsDataURL(file);
}

/* ========================================================
   부트
   ======================================================== */
async function boot() {
  try {
    const res = await fetch('../data.json', { cache: 'no-cache' });
    state.data = await res.json();
    const n = Object.keys(state.data.celebs).length;
    status(`셀럽 ${n}명 준비 완료`);
  } catch (e) {
    status('데이터를 불러오지 못했어요'); console.error(e); return;
  }
  buildThemeGrid();
  buildColorSwatches();
  syncColorControls();
  bindSearch();
  bindOptions();
  bindCardEvents();
  const q = new URLSearchParams(location.search).get('celeb');
  if (q && state.data.celebs[q]) { $('#search').value = q; selectCeleb(q); }
}

/* ========================================================
   검색
   ======================================================== */
function bindSearch() {
  const input = $('#search'), box = $('#results');
  let active = -1, items = [];
  const render = (q) => {
    const ql = q.trim().toLowerCase();
    const names = Object.keys(state.data.celebs);
    items = !ql ? [] : names.filter((n) => n.toLowerCase().includes(ql)).slice(0, 40);
    if (!ql) { box.classList.add('hidden'); return; }
    box.classList.remove('hidden'); active = -1;
    if (!items.length) { box.innerHTML = '<li class="empty">검색 결과가 없어요</li>'; return; }
    box.innerHTML = items.map((n, i) => {
      const c = state.data.celebs[n];
      return `<li data-i="${i}" data-name="${esc(n)}">
        <img src="${esc(proxify(c.imageUrl))}" referrerpolicy="no-referrer" onerror="this.style.visibility='hidden'" alt="">
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
  function pick(name) { box.classList.add('hidden'); $('#search').value = name; selectCeleb(name); }
}

/* ========================================================
   최애 선택 — 기본 카드 한 장을 자동으로 만들어 준다
   ======================================================== */
function selectCeleb(name) {
  state.name = name;
  state.celeb = state.data.celebs[name];
  state.bg.custom = null;
  state.bg.src = state.celeb.imageUrl || '';
  state.bg.fit = 'cover'; state.bg.zoom = 1; state.bg.x = 50; state.bg.y = 50; state.bg.dim = 18;
  state.credit = '';
  state.items = [];
  state.sel = null;
  state.seq = 1;

  $('#celebThumb').src = proxify(state.bg.src);
  $('#celebName').textContent = name;
  $('#celebCount').textContent = `읽은 책 ${state.celeb.books.length}권`;
  ['#photoBlock', '#setBlock', '#booksBlock', '#stickerBlock'].forEach((s) => $(s).classList.remove('hidden'));
  $('#stageEmpty').classList.add('hidden');
  $('#cardWrap').classList.remove('hidden');
  $('#pngBtn').disabled = false;

  seedDefaults();
  syncPhotoControls();
  renderBookList();
  render();
}

/* 처음에는 글자 없이 사진 + 책 표지만. 문구는 ⑤에서 필요한 것만 올린다. */
function seedDefaults() {
  state.celeb.books.slice(0, 3).forEach((b) => addBook(b, false));
  layoutBooks();
}

/* ========================================================
   아이템
   ======================================================== */
function addItem(o) {
  const it = Object.assign({ id: 'i' + (state.seq++), rot: 0 }, o);
  state.items.push(it);
  return it;
}
function findItem(id) { return state.items.find((i) => i.id === id); }
function removeItem(id) {
  state.items = state.items.filter((i) => i.id !== id);
  if (state.sel === id) state.sel = null;
}
function bookItemFor(ref) {
  return state.items.find((i) => i.type === 'book' && i.title === ref.title && i.url === ref.coverUrl);
}
function addBook(ref, doLayout = true) {
  if (bookItemFor(ref)) return;
  addItem({ type: 'book', url: ref.coverUrl, title: ref.title, x: 120, y: 700, w: 260, rot: 0 });
  if (doLayout) layoutBooks();
}
function removeBook(ref) {
  const it = bookItemFor(ref);
  if (it) removeItem(it.id);
}

/* 책 표지를 카드 아래쪽에 가지런히(살짝 기울여) 깔아 준다 */
function layoutBooks() {
  const books = state.items.filter((i) => i.type === 'book');
  const n = books.length;
  if (!n) return;
  const [W, H] = SIZES[state.size];
  const margin = 70;

  if (state.bookFace === 'spine') {
    // 책장처럼 — 바닥선을 맞춰 나란히 세운다. 기울이지 않는다.
    // 카드를 시원하게 채우도록 — 가로로 들어갈 수 있는 폭과
    // 카드 높이의 62%를 넘지 않는 폭 중 작은 쪽을 쓴다.
    const gap = 6;
    const byWidth = Math.floor((W - margin * 2 - gap * (n - 1)) / n);
    const byHeight = Math.floor((H * 0.62) / SPINE_RATIO);
    const wEach = clamp(
      Math.round(Math.min(byWidth, byHeight, 150) * (state.bookScale || 1)), 20, 240);
    const step = n > 1
      ? Math.min(wEach + gap, Math.round((W - margin * 2 - wEach) / (n - 1)))
      : 0;
    const totalW = wEach + step * (n - 1);
    const startX = Math.round((W - totalW) / 2);
    const floorY = H - Math.round(H * 0.11);   // 바닥 여백
    books.forEach((b, i) => {
      b.w = wEach;
      b.rot = 0;
      // 높이를 조금씩 달리하고 바닥을 맞춘다
      const hv = 1 + ((hashOf(b.title, 17) % 14) - 7) / 100;   // ±7%
      const h = Math.round(wEach * SPINE_RATIO * hv);
      b.spineH = h;
      b.x = startX + i * step;
      b.y = clamp(floorY - h, 20, H - 120);
    });
    return;
  }

  const gap = n > 4 ? 14 : 22;
  const fitW = Math.floor((W - margin * 2 - gap * (n - 1)) / n);
  const wEach = clamp(Math.round(Math.min(300, fitW) * (state.bookScale || 1)), BOOK_W_MIN, BOOK_W_MAX);
  // 크게 키우면 한 줄에 다 안 들어가므로 카드 폭 안에서 겹쳐 편다
  const step = n > 1
    ? Math.min(wEach + gap, Math.round((W - margin * 2 - wEach) / (n - 1)))
    : 0;
  const totalW = wEach + step * (n - 1);
  const startX = Math.round((W - totalW) / 2);
  const baseY = H - Math.round(wEach * 1.45) - 150;
  books.forEach((b, i) => {
    b.w = wEach;
    b.x = startX + i * step;
    b.y = clamp(baseY + (i % 2 ? 26 : 0), 30, H - 220);
    b.rot = (i - (n - 1) / 2) * 4;
  });
}

/* ========================================================
   카드 렌더
   ======================================================== */
function themeDef() { return THEMES[state.theme] || THEMES.pop; }
function bgSrc() { return state.bg.custom || proxify(state.bg.src); }

function itemHTML(it) {
  const t = themeDef();
  const selCls = it.id === state.sel ? ' sel' : '';
  const base = `left:${it.x}px;top:${it.y}px;transform:rotate(${it.rot || 0}deg);`;

  if (it.type === 'book') {
    if (state.bookFace === 'spine') {
      const sp = yes24SpineUrl(it.url);
      const img = sp
        ? `<img class="tg-spine-i" src="${esc(proxify(sp))}" alt="" onerror="this.remove()">`
        : '';
      return `<div class="tg-item tg-spine${selCls}" data-id="${it.id}"
        style="${base}width:${it.w}px;height:${it.spineH || Math.round(it.w * SPINE_RATIO)}px;--c:${spineTint(it.title)}">
        <span class="tg-spine-t" style="font-size:${Math.max(11, Math.round(it.w * 0.34))}px"><i>${esc(it.title)}</i></span>${img}
      </div>`;
    }
    const url = it.url.startsWith('data:') ? it.url : proxify(it.url);
    noteMeta(url);
    return `<div class="tg-item tg-book${selCls}" data-id="${it.id}" style="${base}width:${it.w}px">
      <div class="tg-bookimg" data-src="${esc(url)}" style="background-image:url('${esc(url)}');height:${Math.round(it.w * 1.45)}px"></div>
    </div>`;
  }
  // 글자 스티커는 글자를 비워 둬도 쓸 수 있다 — 빈 말풍선·빈 라벨을 색 블록처럼
  // 올려두는 용도. 비면 글자 크기에 비례하는 최소 크기(em)를 줘서 카드 위에서
  // 잡아 끌 수 있게 하고, 폭·높이를 직접 정하면 그 값이 우선한다.
  const emptyCls = isBlank(it.text) ? ' is-empty' : '';
  const boxCls = emptyCls + (it.w ? ' has-w' : '') + (it.h ? ' has-h' : '');
  const boxStyle = (it.w ? `width:${it.w}px;max-width:none;` : '') + (it.h ? `height:${it.h}px;` : '');

  if (it.type === 'title') {
    return `<div class="tg-item tg-title${selCls}${boxCls}" data-id="${it.id}"
      style="${base}${boxStyle}font-size:${it.size}px">${escML(it.text)}</div>`;
  }
  if (it.type === 'bubble') {
    const bg = t[it.color] || t.b;
    return `<div class="tg-item tg-bubble${selCls}${boxCls}" data-id="${it.id}" data-shape="${it.shape}"
      style="${base}${boxStyle}font-size:${it.size}px;--bubble:${bg};background:${bg};color:${onColor(bg)}">${escML(it.text)}</div>`;
  }
  if (it.type === 'stars') {
    return `<div class="tg-item tg-stars${selCls}${boxCls}" data-id="${it.id}" style="${base}${boxStyle}font-size:${it.size}px">
      <span class="tg-star-row">${'★'.repeat(clamp(it.n || 5, 1, 5))}</span>
      ${it.text ? `<span class="tg-star-cap">${escML(it.text)}</span>` : ''}
    </div>`;
  }
  if (it.type === 'emoji') {
    return `<div class="tg-item tg-emoji${selCls}${boxCls}" data-id="${it.id}" style="${base}${boxStyle}font-size:${it.size}px">${escML(it.text)}</div>`;
  }
  // tag
  return `<div class="tg-item tg-tag${selCls}${boxCls}" data-id="${it.id}" style="${base}${boxStyle}font-size:${it.size}px">${escML(it.text)}</div>`;
}

function cardHTML() {
  const t = themeDef();
  const url = bgSrc();
  noteMeta(url);
  const photo = url
    ? `<div class="tg-bg tg-fit" data-src="${esc(url)}" data-fit="${state.bg.fit}" data-zoom="${state.bg.zoom}"
         data-x="${state.bg.x}" data-y="${state.bg.y}"
         style="background-image:url('${esc(url)}');background-size:${state.bg.fit};background-position:${state.bg.x}% ${state.bg.y}%"></div>`
    : '<div class="tg-bg empty"></div>';
  const dim = state.bg.dim ? `<div class="tg-dim" style="opacity:${state.bg.dim / 100}"></div>` : '';
  const mark = state.watermark
    ? `<div class="tg-mark">
         <span class="tg-mark-l">최애의 독서 · favorbook.co.kr</span>
         ${state.credit ? `<span class="tg-mark-r">${esc(state.credit)}</span>` : ''}
       </div>`
    : '';
  return photo + dim + state.items.map(itemHTML).join('') + mark;
}

function render(opts) {
  if (!state.celeb) return;
  const t = themeDef();
  const [W, H] = SIZES[state.size];
  const card = $('#card'), frame = $('#cardFrame');

  card.className = `tg-card th-${state.theme} font-${t.font}${state.bookBorder ? ' bd-on' : ''}`;
  card.style.setProperty('--ink', state.inkAuto ? t.ink : state.ink);
  card.style.setProperty('--paper', state.paperAuto ? t.paper : state.paper);
  card.style.setProperty('--a', t.a);
  card.style.setProperty('--b', t.b);
  card.style.setProperty('--c', t.c);
  card.style.width = `${W}px`;
  card.style.height = `${H}px`;
  card.innerHTML = cardHTML();

  const stageW = $('.stage').clientWidth - 56;
  const stageH = Math.max(420, window.innerHeight - 210);
  const s = Math.min(Math.min(430, Math.max(240, stageW)) / W, stageH / H);
  card.style.transform = `scale(${s})`;
  frame.style.width = `${Math.round(W * s)}px`;
  frame.style.height = `${Math.round(H * s)}px`;
  frame.dataset.scale = s;

  applyFits(card);
  renderLayers();
  // 슬라이더를 끄는 중에는 편집 패널을 새로 그리지 않는다 — 입력 요소가
  // 교체되면 드래그가 거기서 끊기기 때문.
  if (!opts || !opts.keepEditor) renderItemEditor();
}

let resizeT;
window.addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(render, 150); });

/* ========================================================
   카드 위 조작 (선택 · 드래그)
   ======================================================== */
function bindCardEvents() {
  const card = $('#card');
  let drag = null;

  card.addEventListener('pointerdown', (e) => {
    const el = e.target.closest('.tg-item');
    if (!el) { state.sel = null; render(); return; }
    const it = findItem(el.dataset.id);
    if (!it) return;
    state.sel = it.id;
    $$('.tg-item', card).forEach((n) => n.classList.toggle('sel', n === el));
    renderItemEditor(); renderLayers();
    const scale = parseFloat($('#cardFrame').dataset.scale) || 1;
    drag = { it, el, scale, sx: e.clientX, sy: e.clientY, ox: it.x, oy: it.y, moved: false };
    el.setPointerCapture(e.pointerId);
    e.preventDefault();
  });

  card.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const [W, H] = SIZES[state.size];
    const dx = (e.clientX - drag.sx) / drag.scale;
    const dy = (e.clientY - drag.sy) / drag.scale;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) drag.moved = true;
    drag.it.x = Math.round(clamp(drag.ox + dx, -200, W - 40));
    drag.it.y = Math.round(clamp(drag.oy + dy, -120, H - 40));
    drag.el.style.left = `${drag.it.x}px`;
    drag.el.style.top = `${drag.it.y}px`;
  });

  const end = () => { if (drag && drag.moved) renderLayers(); drag = null; };
  card.addEventListener('pointerup', end);
  card.addEventListener('pointercancel', end);
}

/* ========================================================
   패널 — 책 목록
   ======================================================== */
function renderBookList() {
  const ul = $('#bookList');
  ul.innerHTML = state.celeb.books.map((r, i) => {
    const on = !!bookItemFor(r);
    return `<li class="book-item" data-i="${i}">
      <label class="book-head">
        <input type="checkbox" class="bk-sel" ${on ? 'checked' : ''}>
        <img src="${esc(proxify(r.coverUrl))}" referrerpolicy="no-referrer" onerror="this.style.visibility='hidden'" alt="">
        <span class="bt"><b>${esc(r.title)}</b><span>${esc(r.author || '')}</span></span>
      </label>
    </li>`;
  }).join('');
  $$('.bk-sel', ul).forEach((chk, i) => {
    chk.addEventListener('change', (e) => {
      const ref = state.celeb.books[i];
      if (e.target.checked) addBook(ref); else { removeBook(ref); layoutBooks(); }
      render();
    });
  });
}

/* ========================================================
   패널 — 레이어 목록 / 선택 항목 편집
   ======================================================== */
const TYPE_LABEL = { book: '📕 책', title: '🔠 큰 제목', bubble: '💬 말풍선', stars: '⭐ 별점', emoji: '✨ 이모지', tag: '🏷 라벨' };

function renderLayers() {
  const ul = $('#layerList');
  ul.innerHTML = state.items.map((it, i) => {
    const txt = it.type === 'book'
      ? it.title
      : (isBlank(it.text) ? '(빈 칸)' : it.text.split('\n')[0]);
    return `<li class="layer${it.id === state.sel ? ' sel' : ''}" data-id="${it.id}">
      <span class="lb">${TYPE_LABEL[it.type] || it.type}</span>
      <span class="lt">${esc(txt)}</span>
      <span class="ltools">
        <button class="btn tiny" data-act="up" title="앞으로">▲</button>
        <button class="btn tiny" data-act="down" title="뒤로">▼</button>
        <button class="btn tiny" data-act="del" title="빼기">✕</button>
      </span>
    </li>`;
  }).join('');
  ul.onclick = (e) => {
    const li = e.target.closest('.layer'); if (!li) return;
    const id = li.dataset.id, btn = e.target.closest('button[data-act]');
    const idx = state.items.findIndex((x) => x.id === id);
    if (!btn) { state.sel = id; render(); return; }
    if (btn.dataset.act === 'del') {
      const it = state.items[idx];
      removeItem(id);
      if (it && it.type === 'book') { layoutBooks(); renderBookList(); }
    } else if (btn.dataset.act === 'up' && idx < state.items.length - 1) {
      state.items.splice(idx + 1, 0, state.items.splice(idx, 1)[0]);
    } else if (btn.dataset.act === 'down' && idx > 0) {
      state.items.splice(idx - 1, 0, state.items.splice(idx, 1)[0]);
    }
    render();
  };
}

function renderItemEditor() {
  const box = $('#itemEditor'), hint = $('#pickHint');
  const it = findItem(state.sel);
  if (!it) { box.classList.add('hidden'); box.innerHTML = ''; hint.classList.remove('hidden'); return; }
  hint.classList.add('hidden');
  box.classList.remove('hidden');

  const isText = it.type !== 'book';
  const sizeLabel = it.type === 'book' ? '크기(폭)' : '글자 크기';
  const sizeVal = it.type === 'book' ? it.w : it.size;
  const sizeMin = it.type === 'book' ? BOOK_W_MIN : 20;
  const sizeMax = it.type === 'book' ? BOOK_W_MAX : 180;
  const [CW, CH] = SIZES[state.size];

  box.innerHTML = `
    <div class="ie-head">${TYPE_LABEL[it.type] || it.type} 고치기</div>
    ${isText ? `<label class="field"><span>글자 <em>(엔터로 줄바꿈)</em></span>
      <textarea class="ie-text" rows="2">${esc(it.text || '')}</textarea></label>` : ''}
    ${it.type === 'stars' ? `<label class="field range"><span>별 개수 <output class="ie-n-o">${it.n}</output></span>
      <input class="ie-n" type="range" min="1" max="5" value="${it.n}"></label>` : ''}
    ${it.type === 'bubble' ? `
      <div class="field"><span>모양</span>
        <div class="seg seg-row">
          ${['blob', 'pill', 'burst'].map((sh) => `<label><input type="radio" name="ieShape" value="${sh}" ${it.shape === sh ? 'checked' : ''}> ${{ blob: '몽글', pill: '알약', burst: '뾰족' }[sh]}</label>`).join('')}
        </div>
      </div>
      <div class="field"><span>색</span>
        <div class="seg seg-row">
          ${['a', 'b', 'c'].map((k) => `<label><input type="radio" name="ieColor" value="${k}" ${it.color === k ? 'checked' : ''}> <i class="dot" style="background:${themeDef()[k]}"></i></label>`).join('')}
        </div>
      </div>` : ''}
    <label class="field range"><span>${sizeLabel} <output class="ie-size-o">${sizeVal}</output></span>
      <input class="ie-size" type="range" min="${sizeMin}" max="${sizeMax}" value="${sizeVal}"></label>
    ${isText ? `
    <label class="field range"><span>가로 폭
        <label class="chk inline"><input class="ie-w-auto" type="checkbox" ${it.w ? '' : 'checked'}> 자동</label>
        <output class="ie-w-o">${it.w ? it.w + 'px' : '글자에 맞춤'}</output></span>
      <input class="ie-w" type="range" min="60" max="${CW}" step="10" value="${it.w || Math.round(CW * 0.5)}" ${it.w ? '' : 'disabled'}></label>
    <label class="field range"><span>높이
        <label class="chk inline"><input class="ie-h-auto" type="checkbox" ${it.h ? '' : 'checked'}> 자동</label>
        <output class="ie-h-o">${it.h ? it.h + 'px' : '글자에 맞춤'}</output></span>
      <input class="ie-h" type="range" min="40" max="${CH}" step="10" value="${it.h || 160}" ${it.h ? '' : 'disabled'}></label>` : ''}
    <label class="field range"><span>기울기 <output class="ie-rot-o">${it.rot || 0}°</output></span>
      <input class="ie-rot" type="range" min="-25" max="25" value="${it.rot || 0}"></label>
    <div class="add-row">
      <button class="btn tiny" data-ie="front">맨 앞으로</button>
      <button class="btn tiny" data-ie="back">맨 뒤로</button>
      <button class="btn tiny" data-ie="del">이 스티커 빼기</button>
    </div>`;

  const upd = (fn) => { fn(); render(); };
  // 슬라이더용 — 카드만 다시 그리고 편집 패널은 그대로 둔다
  const live = (fn) => { fn(); render({ keepEditor: true }); };
  const setOut = (cls, v) => { const o = box.querySelector(cls); if (o) o.textContent = v; };
  const txt = box.querySelector('.ie-text');
  if (txt) txt.addEventListener('input', (e) => {
    it.text = e.target.value;
    const el = $(`.tg-item[data-id="${it.id}"]`);
    if (it.type === 'stars') { const c = el && el.querySelector('.tg-star-cap'); if (c) c.innerHTML = escML(it.text); }
    else if (el) el.innerHTML = escML(it.text);
    // 글자를 다 지우면 빈 칸용 최소 크기가 붙어야 카드 위에서 계속 잡을 수 있다
    if (el) el.classList.toggle('is-empty', isBlank(it.text));
    renderLayers();
  });
  const nRange = box.querySelector('.ie-n');
  if (nRange) nRange.addEventListener('input', (e) => live(() => {
    it.n = +e.target.value;
    setOut('.ie-n-o', it.n);
  }));
  box.querySelector('.ie-size').addEventListener('input', (e) => live(() => {
    const v = +e.target.value;
    if (it.type === 'book') it.w = v; else it.size = v;
    setOut('.ie-size-o', v);
  }));
  box.querySelector('.ie-rot').addEventListener('input', (e) => live(() => {
    it.rot = +e.target.value;
    setOut('.ie-rot-o', it.rot + '°');
  }));

  // 가로 폭 · 높이 — '자동'이면 글자에 맞추고, 끄면 슬라이더 값으로 고정한다.
  [['w', 'ie-w'], ['h', 'ie-h']].forEach(([key, cls]) => {
    const auto = box.querySelector('.' + cls + '-auto');
    const range = box.querySelector('.' + cls);
    if (!auto || !range) return;
    const out = '.' + cls + '-o';
    auto.addEventListener('change', (e) => {
      range.disabled = e.target.checked;
      live(() => {
        it[key] = e.target.checked ? null : +range.value;
        setOut(out, it[key] ? it[key] + 'px' : '글자에 맞춤');
      });
    });
    range.addEventListener('input', (e) => {
      auto.checked = false;
      range.disabled = false;
      live(() => {
        it[key] = +e.target.value;
        setOut(out, it[key] + 'px');
      });
    });
  });
  $$('input[name=ieShape]', box).forEach((r) => r.addEventListener('change', (e) => {
    if (e.target.checked) upd(() => { it.shape = e.target.value; });
  }));
  $$('input[name=ieColor]', box).forEach((r) => r.addEventListener('change', (e) => {
    if (e.target.checked) upd(() => { it.color = e.target.value; });
  }));
  box.querySelectorAll('button[data-ie]').forEach((b) => b.addEventListener('click', () => {
    const idx = state.items.findIndex((x) => x.id === it.id);
    if (b.dataset.ie === 'del') {
      removeItem(it.id);
      if (it.type === 'book') { layoutBooks(); renderBookList(); }
    } else if (b.dataset.ie === 'front') {
      state.items.push(state.items.splice(idx, 1)[0]);
    } else {
      state.items.unshift(state.items.splice(idx, 1)[0]);
    }
    render();
  }));
}

/* ========================================================
   패널 — 테마 · 옵션
   ======================================================== */
function buildThemeGrid() {
  const box = $('#themeGrid');
  box.innerHTML = THEME_KEYS.map((k) => {
    const t = THEMES[k];
    return `<button type="button" class="theme-chip" data-t="${k}">
      <span class="tc-dot" style="background:${t.paper};box-shadow:inset 0 0 0 4px ${t.a}"></span>
      <span class="tc-txt"><b>${t.emoji} ${esc(t.label)}</b><em>${esc(t.desc)}</em></span>
    </button>`;
  }).join('');
  box.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-t]'); if (!b) return;
    state.theme = b.dataset.t;
    // 테마를 고르면 배경색·글자색은 그 테마 기본값으로 돌아간다
    state.paperAuto = true; state.inkAuto = true;
    state.paper = THEMES[state.theme].paper;
    state.ink = THEMES[state.theme].ink;
    syncColorControls();
    render();
  });
  markTheme();
}
function markTheme() {
  $$('#themeGrid button').forEach((b) => b.classList.toggle('active', b.dataset.t === state.theme));
}

/* ---- 배경색 · 글자색 ---- */
function swatchHTML(list) {
  return list.map((c) => `<button type="button" data-c="${c}" style="background:${c}" title="${c}"></button>`).join('');
}
function buildColorSwatches() {
  const pb = $('#paperSwatches'), ib = $('#inkSwatches');
  pb.innerHTML = swatchHTML(PAPER_SWATCHES);
  ib.innerHTML = swatchHTML(INK_SWATCHES);
  pb.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-c]'); if (b) setPaper(b.dataset.c);
  });
  ib.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-c]'); if (b) setInk(b.dataset.c);
  });
}
const isHex = (c) => /^#[0-9a-f]{6}$/i.test(c || '');
function setPaper(c) {
  if (!isHex(c)) return;
  state.paper = c; state.paperAuto = false;
  syncColorControls(); render();
}
function setInk(c) {
  if (!isHex(c)) return;
  state.ink = c; state.inkAuto = false;
  syncColorControls(); render();
}
function syncColorControls() {
  const t = themeDef();
  $('#optPaperAuto').checked = state.paperAuto;
  $('#optInkAuto').checked = state.inkAuto;
  $('#optBookBorder').checked = state.bookBorder;
  $('#optPaperCustom').value = state.paperAuto ? t.paper : state.paper;
  $('#optInkCustom').value = state.inkAuto ? t.ink : state.ink;
  const eq = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
  $$('#paperSwatches button').forEach((b) => b.classList.toggle('active', !state.paperAuto && eq(b.dataset.c, state.paper)));
  $$('#inkSwatches button').forEach((b) => b.classList.toggle('active', !state.inkAuto && eq(b.dataset.c, state.ink)));
  markTheme();
}

function syncPhotoControls() {
  const b = state.bg;
  $$('input[name=bgfit]').forEach((r) => { r.checked = r.value === b.fit; });
  $('#bgZoom').value = Math.round(b.zoom * 100); $('#bgZoomOut').textContent = `${Math.round(b.zoom * 100)}%`;
  $('#bgX').value = b.x; $('#bgXOut').textContent = `${b.x}%`;
  $('#bgY').value = b.y; $('#bgYOut').textContent = `${b.y}%`;
  $('#bgDim').value = b.dim; $('#bgDimOut').textContent = `${b.dim}%`;
  $('#photoCredit').value = state.credit;
}

function bindOptions() {
  $$('input[name=size]').forEach((r) => r.addEventListener('change', (e) => {
    if (!e.target.checked) return;
    state.size = e.target.value;
    layoutBooks();
    render();
  }));
  $$('input[name=bgfit]').forEach((r) => r.addEventListener('change', (e) => {
    if (e.target.checked) { state.bg.fit = e.target.value; render(); }
  }));
  const slider = (id, outId, fn, fmt) => {
    $(id).addEventListener('input', (e) => {
      fn(+e.target.value);
      $(outId).textContent = fmt ? fmt(e.target.value) : `${e.target.value}%`;
      render();
    });
  };
  slider('#bgZoom', '#bgZoomOut', (v) => { state.bg.zoom = v / 100; });
  slider('#bgX', '#bgXOut', (v) => { state.bg.x = v; });
  slider('#bgY', '#bgYOut', (v) => { state.bg.y = v; });
  slider('#bgDim', '#bgDimOut', (v) => { state.bg.dim = v; });

  $('#photoCredit').addEventListener('input', (e) => { state.credit = e.target.value; render(); });

  $('#bgUpload').addEventListener('change', (e) => {
    const f = e.target.files[0]; if (!f) return;
    readImageFile(f, (dataUrl) => {
      state.bg.custom = dataUrl;
      $('#celebThumb').src = dataUrl;
      render();
    });
    e.target.value = '';
  });
  $('#bgReset').addEventListener('click', () => {
    state.bg.custom = null;
    $('#celebThumb').src = proxify(state.bg.src);
    render();
  });

  $('#optProxy').addEventListener('change', (e) => {
    state.proxy = e.target.checked;
    if (state.celeb) { $('#celebThumb').src = bgSrc(); renderBookList(); }
    render();
  });
  $('#optWatermark').addEventListener('change', (e) => { state.watermark = e.target.checked; render(); });

  $('#optPaperCustom').addEventListener('input', (e) => setPaper(e.target.value));
  $('#optInkCustom').addEventListener('input', (e) => setInk(e.target.value));
  $('#optPaperAuto').addEventListener('change', (e) => {
    state.paperAuto = e.target.checked; syncColorControls(); render();
  });
  $('#optInkAuto').addEventListener('change', (e) => {
    state.inkAuto = e.target.checked; syncColorControls(); render();
  });
  $('#optBookBorder').addEventListener('change', (e) => {
    state.bookBorder = e.target.checked; render();
  });

  $('#bkNone').addEventListener('click', () => {
    state.items = state.items.filter((i) => i.type !== 'book');
    renderBookList(); render();
  });
  $('#bkTidy').addEventListener('click', () => { layoutBooks(); render(); });

  $$('input[name=bookFace]').forEach((r) => r.addEventListener('change', (e) => {
    if (!e.target.checked) return;
    state.bookFace = e.target.value;
    layoutBooks();
    render();
  }));

  $('#bkScale').addEventListener('input', (e) => {
    state.bookScale = (+e.target.value) / 100;
    $('#bkScaleOut').textContent = e.target.value + '%';
    layoutBooks();
    render();
  });

  $$('button[data-add]').forEach((b) => b.addEventListener('click', () => addSticker(b.dataset.add)));

  $('#pngBtn').addEventListener('click', exportPNG);
}

/* 스티커의 대략적인 높이 — 새 스티커를 겹치지 않게 놓는 데만 쓴다 */
function estHeight(it) {
  if (it.h) return it.h + 20;
  const size = it.size || 40;
  const lines = isBlank(it.text) ? 1 : String(it.text).split('\n').length;
  if (it.type === 'title') return size * 1.15 * lines + 20;
  if (it.type === 'bubble') return size * 1.35 * lines + 105;
  if (it.type === 'stars') return size * (it.text ? 2.7 : 1.6) + 40;
  if (it.type === 'emoji') return size * 1.3 + 30;
  return size * 1.3 + 30;
}

function addSticker(kind) {
  const [W, H] = SIZES[state.size];
  const dn = displayName(state.name);
  // 새 스티커는 이미 올려둔 글자 아래에 차곡차곡 (겹치지 않게)
  const texts = state.items.filter((i) => i.type !== 'book');
  const bottom = texts.reduce((m, i) => Math.max(m, i.y + estHeight(i)), 0);
  const base = {
    x: clamp(80 + texts.length * 14, 40, W - 340),
    y: clamp(bottom ? bottom + 34 : 120, 60, H - 320),
  };
  let it;
  if (kind === 'title') it = addItem({ type: 'title', text: '내 최애가 읽은 책\n함께 읽기', size: 90, w: 860, rot: -2, ...base });
  else if (kind === 'bubble') it = addItem({ type: 'bubble', text: `${josa(dn, '이', '가')} 읽은 책`, size: 44, shape: 'blob', color: 'a', rot: -5, ...base });
  else if (kind === 'stars') it = addItem({ type: 'stars', text: '별이 다섯 개!', size: 40, n: 5, rot: 3, ...base });
  else if (kind === 'emoji') it = addItem({ type: 'emoji', text: '✨ 📚 🩷 ⭐️', size: 54, rot: 0, ...base });
  else it = addItem({ type: 'tag', text: `#${dn}_독서`, size: 34, rot: -3, ...base });
  state.sel = it.id;
  render();
}

/* ========================================================
   PNG 내보내기
   ======================================================== */
function waitForImages(node, timeout = 9000) {
  const tasks = [];
  $$('img', node).forEach((img) => {
    if (img.complete && img.naturalWidth) return;
    tasks.push(new Promise((res) => {
      img.addEventListener('load', res, { once: true });
      img.addEventListener('error', res, { once: true });
      setTimeout(res, timeout);
    }));
  });
  $$('.tg-bg, .tg-bookimg', node).forEach((d) => {
    const m = /url\(["']?(.*?)["']?\)/.exec(d.style.backgroundImage || '');
    if (!m || !m[1]) return;
    tasks.push(new Promise((res) => {
      const im = new Image();
      im.crossOrigin = 'anonymous';
      im.onload = res; im.onerror = res;
      im.src = m[1];
      setTimeout(res, timeout);
    }));
  });
  return Promise.all(tasks);
}

function safeName(s) { return String(s).replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, '_'); }

async function exportPNG() {
  if (!state.celeb) return;
  const [W, H] = SIZES[state.size];
  status('PNG 만드는 중…');
  const el = $('#card').cloneNode(true);
  el.style.transform = 'none';
  el.style.width = `${W}px`; el.style.height = `${H}px`;
  $$('.tg-item', el).forEach((n) => n.classList.remove('sel'));
  const holder = document.createElement('div');
  holder.style.cssText = 'position:fixed;left:-99999px;top:0;z-index:-1';
  holder.appendChild(el);
  document.body.appendChild(holder);
  try {
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    await waitForImages(el);
    applyFits(el);
    await new Promise((r) => setTimeout(r, 120));
    const canvas = await html2canvas(el, {
      width: W, height: H, windowWidth: W, windowHeight: H,
      scale: OUTPUT_SCALE, useCORS: true, backgroundColor: null, logging: false,
    });
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `함께읽기_${safeName(displayName(state.name))}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    status('저장했어요!');
  } catch (e) {
    console.error(e);
    status('저장 실패 — 이미지 프록시를 켜고 다시 해보세요');
  } finally { holder.remove(); }
}

boot();
