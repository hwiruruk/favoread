/* ========================================================
   최애의 독서 — 함께 읽기 카드 메이커
   최애 사진을 배경으로, 최애가 읽은 책 표지를 스티커처럼 붙여
   인스타그램용 카드를 만들고 PNG로 내보낸다.
   ======================================================== */
'use strict';

const OUTPUT_SCALE = 2;
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

/* ---------- 상태 ---------- */
const state = {
  data: null,
  name: '',
  celeb: null,
  size: 'portrait',
  theme: 'pop',
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

function seedDefaults() {
  const dn = displayName(state.name);
  const [W] = SIZES[state.size];
  addItem({ type: 'title', text: '내 최애가 읽은 책\n함께 읽기', x: 70, y: 86, size: 96, rot: -2, w: 880 });
  addItem({ type: 'bubble', text: `${josa(dn, '이', '가')} 읽은 책`, x: 74, y: 320, size: 44, rot: -6, shape: 'blob', color: 'b' });
  addItem({ type: 'stars', text: '같이 읽어요!', x: W - 400, y: 400, size: 40, rot: 4, n: 5 });
  // 첫 3권을 자동으로 붙인다
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
  const gap = n > 4 ? 14 : 22;
  const wEach = Math.min(300, Math.floor((W - margin * 2 - gap * (n - 1)) / n));
  const totalW = wEach * n + gap * (n - 1);
  const startX = Math.round((W - totalW) / 2);
  const baseY = H - Math.round(wEach * 1.45) - 150;
  books.forEach((b, i) => {
    b.w = wEach;
    b.x = startX + i * (wEach + gap);
    b.y = baseY + (i % 2 ? 26 : 0);
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
    const url = it.url.startsWith('data:') ? it.url : proxify(it.url);
    noteMeta(url);
    return `<div class="tg-item tg-book${selCls}" data-id="${it.id}" style="${base}width:${it.w}px">
      <div class="tg-bookimg" data-src="${esc(url)}" style="background-image:url('${esc(url)}');height:${Math.round(it.w * 1.45)}px"></div>
    </div>`;
  }
  if (it.type === 'title') {
    return `<div class="tg-item tg-title${selCls}" data-id="${it.id}"
      style="${base}width:${it.w || 880}px;font-size:${it.size}px">${escML(it.text)}</div>`;
  }
  if (it.type === 'bubble') {
    const bg = t[it.color] || t.b;
    return `<div class="tg-item tg-bubble${selCls}" data-id="${it.id}" data-shape="${it.shape}"
      style="${base}font-size:${it.size}px;--bubble:${bg};background:${bg};color:${onColor(bg)}">${escML(it.text)}</div>`;
  }
  if (it.type === 'stars') {
    return `<div class="tg-item tg-stars${selCls}" data-id="${it.id}" style="${base}font-size:${it.size}px">
      <span class="tg-star-row">${'★'.repeat(clamp(it.n || 5, 1, 5))}</span>
      ${it.text ? `<span class="tg-star-cap">${escML(it.text)}</span>` : ''}
    </div>`;
  }
  if (it.type === 'emoji') {
    return `<div class="tg-item tg-emoji${selCls}" data-id="${it.id}" style="${base}font-size:${it.size}px">${escML(it.text)}</div>`;
  }
  // tag
  return `<div class="tg-item tg-tag${selCls}" data-id="${it.id}" style="${base}font-size:${it.size}px">${escML(it.text)}</div>`;
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

function render() {
  if (!state.celeb) return;
  const t = themeDef();
  const [W, H] = SIZES[state.size];
  const card = $('#card'), frame = $('#cardFrame');

  card.className = `tg-card th-${state.theme} font-${t.font}`;
  card.style.setProperty('--ink', t.ink);
  card.style.setProperty('--paper', t.paper);
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
  renderItemEditor();
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
    const txt = it.type === 'book' ? it.title : (it.text || '').split('\n')[0];
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
  const sizeMin = it.type === 'book' ? 90 : 20;
  const sizeMax = it.type === 'book' ? 640 : 180;

  box.innerHTML = `
    <div class="ie-head">${TYPE_LABEL[it.type] || it.type} 고치기</div>
    ${isText ? `<label class="field"><span>글자 <em>(엔터로 줄바꿈)</em></span>
      <textarea class="ie-text" rows="2">${esc(it.text || '')}</textarea></label>` : ''}
    ${it.type === 'stars' ? `<label class="field range"><span>별 개수 <output>${it.n}</output></span>
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
    <label class="field range"><span>기울기 <output class="ie-rot-o">${it.rot || 0}°</output></span>
      <input class="ie-rot" type="range" min="-25" max="25" value="${it.rot || 0}"></label>
    <div class="add-row">
      <button class="btn tiny" data-ie="front">맨 앞으로</button>
      <button class="btn tiny" data-ie="back">맨 뒤로</button>
      <button class="btn tiny" data-ie="del">이 스티커 빼기</button>
    </div>`;

  const upd = (fn) => { fn(); render(); };
  const txt = box.querySelector('.ie-text');
  if (txt) txt.addEventListener('input', (e) => {
    it.text = e.target.value;
    const el = $(`.tg-item[data-id="${it.id}"]`);
    if (it.type === 'stars') { const c = el && el.querySelector('.tg-star-cap'); if (c) c.innerHTML = escML(it.text); }
    else if (el) el.innerHTML = escML(it.text);
    renderLayers();
  });
  const nRange = box.querySelector('.ie-n');
  if (nRange) nRange.addEventListener('input', (e) => upd(() => { it.n = +e.target.value; }));
  box.querySelector('.ie-size').addEventListener('input', (e) => upd(() => {
    if (it.type === 'book') it.w = +e.target.value; else it.size = +e.target.value;
  }));
  box.querySelector('.ie-rot').addEventListener('input', (e) => upd(() => { it.rot = +e.target.value; }));
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
    markTheme();
    render();
  });
  markTheme();
}
function markTheme() {
  $$('#themeGrid button').forEach((b) => b.classList.toggle('active', b.dataset.t === state.theme));
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

  $('#bkNone').addEventListener('click', () => {
    state.items = state.items.filter((i) => i.type !== 'book');
    renderBookList(); render();
  });
  $('#bkTidy').addEventListener('click', () => { layoutBooks(); render(); });

  $$('button[data-add]').forEach((b) => b.addEventListener('click', () => addSticker(b.dataset.add)));

  $('#pngBtn').addEventListener('click', exportPNG);
}

function addSticker(kind) {
  const [W, H] = SIZES[state.size];
  const dn = displayName(state.name);
  // 새 스티커는 앞의 것과 겹치지 않게 계단식으로 놓는다
  const k = state.items.filter((i) => i.type !== 'book').length;
  const base = { x: 80 + (k % 4) * 46, y: 170 + (k % 6) * 92 };
  base.y = clamp(base.y, 60, H - 260);
  base.x = clamp(base.x, 40, W - 320);
  let it;
  if (kind === 'title') it = addItem({ type: 'title', text: '함께 읽어요', size: 90, w: 860, rot: -2, ...base });
  else if (kind === 'bubble') it = addItem({ type: 'bubble', text: '이 책 어때?', size: 44, shape: 'blob', color: 'a', rot: -5, ...base });
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
