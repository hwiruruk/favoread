/* ============ Favorbook X 게시 도우미 ============
 *
 * data/x_queue.json (tools/x_queue.py 가 매일 만든다)을 읽어
 * 날짜별 트윗 3개를 카드로 보여 준다. 게시는 X의 공유 링크(intent)로 하므로
 * API 키도 비용도 필요 없다. 이미지는 여기서 캔버스로 그려 복사·저장한다.
 *
 * 이미지는 X 모바일 타임라인에서 잘리지 않는 비율로 만든다.
 *   책장 3권 이상 → 4장(표지 + 책 2권씩), 각 16:9 — 2×2 격자 칸이 16:9
 *   책장 2권 이하 → 2장(표지 + 책), 각 8:9 — 나란히 두 칸이 8:9
 *   이 책을 읽은 셀럽들 → 1장, 1:1
 */

const QUEUE_URL = '../data/x_queue.json';
const PROXY = 'https://images.weserv.nl/?url=';
const INTENT = 'https://x.com/intent/post?text=';
const DONE_KEY = 'xbot-done';
const BG_KEY = 'xbot-bg';

const WIDE = [1200, 675];     // 16:9
const TALL = [1080, 1215];    // 8:9
const SQUARE = [1200, 1200];

const BGS = { white: '#ffffff', ivory: '#fbf8f1' };
const INK = '#161616', MUTE = '#6e6e6e', LINE = '#e6e3dc';
const ACCENT = { celeb: '#2f5d8a', new: '#c8453a', book: '#2f7a5b' };

const $ = (s, el = document) => el.querySelector(s);
const state = { days: [], day: null, bg: 'white' };

/* ---------- 브라우저 저장 (이 브라우저에만) ---------- */
function store(key, val) {
  try {
    if (val === undefined) return localStorage.getItem(key);
    localStorage.setItem(key, val);
  } catch (e) { /* 저장 불가 환경 */ }
  return null;
}
function loadDone() {
  try { return JSON.parse(store(DONE_KEY) || '{}'); } catch (e) { return {}; }
}
function setDone(id, on) {
  const d = loadDone();
  if (on) d[id] = true; else delete d[id];
  store(DONE_KEY, JSON.stringify(d));
}

/* ---------- 트윗 길이 (tools/x_queue.py 와 같은 규칙) ---------- */
const LIGHT = [[0, 4351], [8192, 8205], [8208, 8223], [8242, 8247]];
function tweetLength(text) {
  let n = 0;
  text = text.replace(/https?:\/\/\S+/g, () => { n += 23; return ''; });
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp === 0xFE0F) continue;
    n += LIGHT.some(([a, b]) => cp >= a && cp <= b) ? 1 : 2;
  }
  return n;
}

/* ---------- 이미지 불러오기 ---------- */
function proxify(u, w) {
  u = String(u || '').replace(/&amp;/g, '&').trim();
  if (!/^https?:\/\//i.test(u)) return '';
  return PROXY + encodeURIComponent(u.replace(/^https?:\/\//i, '')) + '&output=jpg&q=90' + (w ? '&w=' + w : '');
}
const imgCache = new Map();
function loadImage(u, w) {
  const src = proxify(u, w);
  if (!src) return Promise.resolve(null);
  if (!imgCache.has(src)) {
    imgCache.set(src, new Promise((res) => {
      const im = new Image();
      im.crossOrigin = 'anonymous';
      im.onload = () => res(im);
      im.onerror = () => res(null);
      im.src = src;
    }));
  }
  return imgCache.get(src);
}

// 캔버스에만 쓰는 글꼴은 저절로 내려받지 않으니 미리 불러 둔다
const fontsReady = Promise.all([
  '700 62px "KoPubWorld Batang"',
  '700 26px "KoPubWorld Dotum"',
  '500 26px "KoPubWorld Dotum"',
].map((f) => document.fonts.load(f, '가A'))).catch(() => {});

/* ---------- 글자 ---------- */
const BATANG = (px, w = 700) => w + ' ' + px + 'px "KoPubWorld Batang", serif';
const DOTUM = (px, w = 500) => w + ' ' + px + 'px "KoPubWorld Dotum", sans-serif';

// 한글은 띄어쓰기 없이도 줄을 바꿀 수 있어서 글자 단위로 자른다
function wrap(ctx, text, maxW, maxLines) {
  const lines = [];
  let cur = '';
  for (const ch of String(text || '')) {
    if (ctx.measureText(cur + ch).width > maxW && cur) {
      lines.push(cur.trimEnd());
      cur = ch === ' ' ? '' : ch;
      if (lines.length === maxLines) break;
    } else {
      cur += ch;
    }
  }
  if (lines.length < maxLines && cur) lines.push(cur);
  else if (lines.length === maxLines && cur) {
    let last = lines[maxLines - 1];
    while (last && ctx.measureText(last + '…').width > maxW) last = last.slice(0, -1);
    lines[maxLines - 1] = last + '…';
  }
  return lines;
}

// 이름은 중간에서 끊지 않고 이름 단위로 줄을 바꾼다. 다 못 넣으면 '외 N명'
function wrapNames(ctx, names, maxW, maxLines) {
  const sep = ' · ';
  const lines = [];
  let cur = '', i = 0;
  for (; i < names.length; i++) {
    const next = cur ? cur + sep + names[i] : names[i];
    if (ctx.measureText(next).width <= maxW || !cur) { cur = next; continue; }
    if (lines.length === maxLines - 1) break;
    lines.push(cur);
    cur = names[i];
  }
  if (i < names.length) {
    const parts = cur.split(sep);
    const more = () => ' 외 ' + (names.length - i) + '명';
    while (parts.length > 1 && ctx.measureText(parts.join(sep) + more()).width > maxW) { parts.pop(); i--; }
    cur = parts.join(sep) + more();
  }
  if (cur) lines.push(cur);
  return lines;
}

// align: 'left' | 'center'. 줄마다 그리고 다음 y 를 돌려준다
function drawLines(ctx, lines, x, y, lh, align = 'left') {
  ctx.textAlign = align;
  for (const l of lines) { ctx.fillText(l, x, y); y += lh; }
  ctx.textAlign = 'left';
  return y;
}

/* ---------- 그림 조각 ---------- */

// 표지는 실제 비율대로 상자 안에 맞추고, 그림자는 표지에만 준다(여백에는 안 생김)
function drawCover(ctx, im, box, anchor = 'center', emoji = '') {
  const ratio = im ? im.width / im.height : 0.68;
  let w = box.w, h = w / ratio;
  if (h > box.h) { h = box.h; w = h * ratio; }
  const x = box.x + (box.w - w) / 2;
  const y = anchor === 'bottom' ? box.y + box.h - h : anchor === 'top' ? box.y : box.y + (box.h - h) / 2;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,.16)';
  ctx.shadowBlur = 22;
  ctx.shadowOffsetY = 8;
  ctx.fillStyle = '#ecebe7';
  ctx.fillRect(x, y, w, h);
  ctx.restore();
  if (im) {
    ctx.drawImage(im, x, y, w, h);
  } else if (emoji) {
    ctx.font = Math.round(w * 0.3) + 'px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(emoji, x + w / 2, y + h / 2);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }
  return { x, y, w, h };
}

// 사진을 상자에 꽉 채운다(넘치는 쪽을 자름). 얼굴이 위쪽에 있는 경우가 많아 위를 남긴다
function drawPhoto(ctx, im, box, radius = 0) {
  const r = Math.max(box.w / im.width, box.h / im.height);
  const sw = box.w / r, sh = box.h / r;
  const sx = (im.width - sw) / 2, sy = Math.max(0, (im.height - sh) * 0.2);
  ctx.save();
  if (radius) {
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(box.x, box.y, box.w, box.h, radius) : ctx.rect(box.x, box.y, box.w, box.h);
    ctx.clip();
  }
  ctx.drawImage(im, sx, sy, sw, sh, box.x, box.y, box.w, box.h);
  ctx.restore();
}

function drawCircle(ctx, im, cx, cy, r) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  drawPhoto(ctx, im, { x: cx - r, y: cy - r, w: r * 2, h: r * 2 });
  ctx.restore();
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
}

// 모든 장 아래쪽: 왼쪽 주소, 오른쪽 아주 작은 시리즈·쪽 번호
function drawFooter(ctx, W, H, pad, right) {
  const s = W / 1200;
  ctx.fillStyle = MUTE;
  ctx.font = DOTUM(Math.round(22 * s), 700);
  ctx.fillText('favorbook.co.kr', pad, H - pad * 0.7);
  if (right) {
    ctx.font = DOTUM(Math.round(19 * s));
    ctx.textAlign = 'right';
    ctx.fillText(right, W - pad, H - pad * 0.7);
    ctx.textAlign = 'left';
  }
}

function newCanvas([W, H], bg) {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  return { c, ctx, W, H };
}

/* ---------- 책장: 표지 장 ---------- */
async function drawShelfCover(size, img, type, opts) {
  const { c, ctx, W, H } = newCanvas(size, opts.bg);
  const accent = ACCENT[type];
  const s = W / 1200;
  const pad = Math.round(64 * s);
  const wide = W > H;
  const photo = opts.portrait && img.portrait ? await loadImage(img.portrait, 1200) : null;

  // 사진(또는 표지 모음) 자리
  const media = wide
    ? { x: 0, y: 0, w: Math.round(W * 0.42), h: H }
    : { x: 0, y: 0, w: W, h: Math.round(H * 0.5) };
  if (photo) {
    drawPhoto(ctx, photo, media);
  } else {
    const covers = await Promise.all(img.books.map((b) => loadImage(b.cover, 400)));
    const n = covers.length, cols = n <= 2 ? n : 3, rows = Math.ceil(n / cols);
    const inner = { x: media.x + pad, y: media.y + pad, w: media.w - pad * (wide ? 1.2 : 2), h: media.h - pad * 1.6 };
    const gap = 18 * s;
    const cw = (inner.w - gap * (cols - 1)) / cols;
    const ch = Math.min((inner.h - gap * (rows - 1)) / rows, cw / 0.68);   // 칸이 표지보다 길면 줄 사이가 벌어지니 맞춘다
    const y0 = inner.y + (inner.h - (ch * rows + gap * (rows - 1))) / 2;
    covers.forEach((im, i) => {
      const r = Math.floor(i / cols), k = i % cols;
      drawCover(ctx, im, { x: inner.x + k * (cw + gap), y: y0 + r * (ch + gap), w: cw, h: ch }, 'center', img.books[i].emoji);
    });
  }

  // 글
  const tx = wide ? media.w + pad : pad;
  const tw = W - tx - pad;
  let y = wide ? pad + 70 * s : media.h + pad + 40 * s;

  ctx.fillStyle = accent;
  ctx.font = DOTUM(Math.round(28 * s), 700);
  ctx.fillText(type === 'new' ? 'NEW · 새로 들어온 책' : '최애의 독서', tx, y);

  ctx.fillStyle = INK;
  ctx.font = BATANG(Math.round(76 * s));
  y = drawLines(ctx, wrap(ctx, img.name, tw, 2), tx, y + 96 * s, 90 * s);
  ctx.font = BATANG(Math.round(56 * s));
  y = drawLines(ctx, ['의 책장'], tx, y - 10 * s, 70 * s);

  ctx.fillStyle = MUTE;
  ctx.font = DOTUM(Math.round(28 * s));
  const n = img.books.length;
  const sub = type === 'new'
    ? n + '권 추가 · 전체 ' + img.total + '권'
    : '전체 ' + img.total + '권 중 ' + n + '권';
  drawLines(ctx, [sub], tx, y + 24 * s, 40 * s);

  // 아주 작게 시리즈 번호
  ctx.font = DOTUM(Math.round(22 * s), 700);
  ctx.fillStyle = MUTE;
  ctx.textAlign = 'right';
  ctx.fillText('#' + img.series, W - pad * 0.6, pad * 0.6 + 16 * s);
  ctx.textAlign = 'left';

  // 주소는 사진과 겹치지 않게 글 쪽 아래에
  ctx.fillStyle = MUTE;
  ctx.font = DOTUM(Math.round(22 * s), 700);
  ctx.fillText('favorbook.co.kr', tx, H - pad * 0.7);
  return c;
}

/* ---------- 책장: 책 장 ---------- */
async function drawShelfBooks(size, books, type, opts, pageLabel) {
  const { c, ctx, W, H } = newCanvas(size, opts.bg);
  const accent = ACCENT[type];
  const s = W / 1200;
  const pad = Math.round(64 * s);
  const covers = await Promise.all(books.map((b) => loadImage(b.cover, 600)));
  const wide = W > H;

  if (books.length === 1 && wide) {
    // 한 권: 표지 왼쪽 크게, 글 오른쪽
    const b = books[0];
    const box = { x: pad, y: pad, w: W * 0.36, h: H - pad * 2.4 };
    const r = drawCover(ctx, covers[0], box, 'center', b.emoji);
    const tx = r.x + r.w + pad, tw = W - tx - pad;
    let y = H * 0.36;
    ctx.fillStyle = INK;
    ctx.font = BATANG(Math.round(54 * s));
    y = drawLines(ctx, wrap(ctx, b.emoji + ' ' + b.title, tw, 3), tx, y, 70 * s);
    ctx.fillStyle = MUTE;
    ctx.font = DOTUM(Math.round(30 * s));
    y = drawLines(ctx, wrap(ctx, b.by, tw, 2), tx, y + 14 * s, 42 * s);
    if (b.src) {
      ctx.fillStyle = accent;
      ctx.font = DOTUM(Math.round(26 * s), 700);
      drawLines(ctx, wrap(ctx, b.src, tw, 1), tx, y + 18 * s, 36 * s);
    }
  } else {
    // 여러 권: 칸마다 위에 표지, 아래에 제목·저자·출처
    const n = books.length, gap = pad * 0.8;
    const colW = (W - pad * 2 - gap * (n - 1)) / n;
    const titlePx = Math.round((wide ? 36 : 44) * s);
    const textH = titlePx * 1.3 * 2 + 36 * s * 2 + 40 * s;
    // 표지 + 글 덩어리를 위아래 가운데에 둔다(좁은 판에서 위가 비지 않게)
    const top = pad * 0.8, bottom = H - pad * 1.5;
    const coverW = colW * 0.82;
    const coverH = Math.min(bottom - top - textH, coverW / 0.68);
    const y0 = top + (bottom - top - coverH - textH) / 2;
    const coverBox = (i) => ({ x: pad + i * (colW + gap), y: y0, w: coverW, h: coverH });
    books.forEach((b, i) => {
      const box = coverBox(i);
      box.x += (colW - box.w) / 2;
      drawCover(ctx, covers[i], box, 'bottom', b.emoji);
      const cx = pad + i * (colW + gap) + colW / 2;
      let y = box.y + box.h + 30 * s + titlePx;
      ctx.fillStyle = INK;
      ctx.font = BATANG(titlePx);
      y = drawLines(ctx, wrap(ctx, b.emoji + ' ' + b.title, colW, 2), cx, y, titlePx * 1.3, 'center');
      ctx.fillStyle = MUTE;
      ctx.font = DOTUM(Math.round((wide ? 23 : 28) * s));
      y = drawLines(ctx, wrap(ctx, b.by, colW, 1), cx, y + 4 * s, 34 * s, 'center');
      if (b.src) {
        ctx.fillStyle = accent;
        ctx.font = DOTUM(Math.round((wide ? 21 : 25) * s), 700);
        drawLines(ctx, wrap(ctx, b.src, colW, 1), cx, y + 2 * s, 32 * s, 'center');
      }
    });
  }
  drawFooter(ctx, W, H, pad, pageLabel);
  return c;
}

/* ---------- 이 책을 읽은 셀럽들 ---------- */
async function drawBookCard(img, opts) {
  const { c, ctx, W, H } = newCanvas(SQUARE, opts.bg);
  const accent = ACCENT.book;
  const s = W / 1200;
  const pad = Math.round(72 * s);
  const b = img.book;
  const cover = await loadImage(b.cover, 700);

  const box = { x: pad, y: pad, w: 400 * s, h: 580 * s };
  const r = drawCover(ctx, cover, box, 'top', b.emoji);
  const tx = r.x + r.w + pad * 0.9, tw = W - tx - pad;
  let y = pad + 40 * s;
  ctx.fillStyle = accent;
  ctx.font = DOTUM(Math.round(30 * s), 700);
  ctx.fillText('셀럽 ' + img.names.length + '명이 읽은 책', tx, y);
  ctx.fillStyle = INK;
  ctx.font = BATANG(Math.round(64 * s));
  y = drawLines(ctx, wrap(ctx, b.title, tw, 3), tx, y + 100 * s, 80 * s);
  ctx.fillStyle = MUTE;
  ctx.font = DOTUM(Math.round(30 * s));
  drawLines(ctx, wrap(ctx, b.by, tw, 2), tx, y + 10 * s, 42 * s);

  // 아래: 인물 사진 줄(선택) + 이름
  y = r.y + r.h + pad * 0.9;
  if (opts.portrait) {
    const photos = (await Promise.all(img.portraits.slice(0, 6).map((u) => loadImage(u, 300))));
    const shown = photos.map((im, i) => [im, img.names[i]]).filter(([im]) => im);
    if (shown.length) {
      const rad = 62 * s, step = rad * 2 + 30 * s;
      shown.forEach(([im], i) => drawCircle(ctx, im, pad + rad + i * step, y + rad, rad));
      y += rad * 2 + 50 * s;
    }
  }
  ctx.fillStyle = INK;
  ctx.font = DOTUM(Math.round(32 * s));
  const maxLines = Math.max(1, Math.floor((H - pad * 1.4 - y) / (46 * s)));
  drawLines(ctx, wrapNames(ctx, img.names, W - pad * 2, maxLines), pad, y + 20 * s, 46 * s);

  drawFooter(ctx, W, H, pad, '');
  return c;
}

/* ---------- 한 트윗의 이미지 묶음 ---------- */

// 책을 n 장에 앞에서부터 고르게 나눈다(6권 → 2,2,2 / 5권 → 2,2,1 / 4권 → 2,1,1)
function chunk(books, n) {
  const out = [];
  let k = 0;
  for (let i = 0; i < n; i++) {
    const sz = Math.floor(books.length / n) + (i < books.length % n ? 1 : 0);
    out.push(books.slice(k, k + sz));
    k += sz;
  }
  return out;
}

async function buildImages(it, opts) {
  await fontsReady;
  const img = it.image || {};
  if (it.type === 'book') return [await drawBookCard(img, opts)];
  const books = img.books || [];
  // 3권 이상 → 표지 + 책 3장(16:9 네 장), 2권 이하 → 표지 + 책 1장(8:9 두 장)
  const wide = books.length >= 3;
  const size = wide ? WIDE : TALL;
  const groups = wide ? chunk(books, 3) : [books];
  const total = groups.length + 1;
  const pages = [await drawShelfCover(size, img, it.type, opts)];
  for (let i = 0; i < groups.length; i++) {
    pages.push(await drawShelfBooks(size, groups[i], it.type, opts, img.name + ' #' + img.series + ' · ' + (i + 2) + '/' + total));
  }
  return pages;
}

function canvasBlob(canvas) {
  return new Promise((res) => canvas.toBlob(res, 'image/png'));
}

/* ---------- 화면 ---------- */
function status(msg) { $('#statusMsg').textContent = msg || ''; }

function renderDays() {
  const done = loadDone();
  const nav = $('#days');
  nav.innerHTML = '';
  for (const d of state.days) {
    const b = document.createElement('button');
    b.className = 'day' + (d === state.day ? ' on' : '');
    const left = d.items.filter((it) => !done[it.id]).length;
    b.innerHTML = d.date.slice(5).replace('-', '/') + '<span class="cnt">' + (left ? left + '개 남음' : '완료') + '</span>';
    b.onclick = () => { state.day = d; renderDays(); renderCards(); };
    nav.appendChild(b);
  }
}

function renderCards() {
  const wrapEl = $('#cards');
  wrapEl.innerHTML = '';
  if (!state.day) {
    wrapEl.innerHTML = '<p class="empty">아직 만들어진 트윗이 없어요. GitHub Actions의 "X Queue" 워크플로를 한 번 실행해 주세요.</p>';
    return;
  }
  const done = loadDone();
  state.day.items.forEach((it) => wrapEl.appendChild(cardEl(it, !!done[it.id])));
}

function hasPortrait(it) {
  const img = it.image || {};
  return it.type === 'book' ? (img.portraits || []).some(Boolean) : !!img.portrait;
}

function cardEl(it, isDone) {
  const el = document.createElement('article');
  el.className = 'card' + (isDone ? ' done' : '');
  el.innerHTML =
    '<div>' +
      '<div class="card-head"><span class="tag ' + it.type + '"></span><span class="len"></span></div>' +
      '<textarea spellcheck="false"></textarea>' +
      '<div class="actions">' +
        '<button class="btn primary" data-act="post">𝕏 X에 쓰기</button>' +
        '<button class="btn" data-act="copytext">글 복사</button>' +
        '<button class="btn" data-act="done"></button>' +
      '</div>' +
    '</div>' +
    '<div>' +
      '<div class="preview-head">' +
        '<span class="muted">X 모바일 미리보기</span>' +
        '<label class="toggle"><input type="checkbox" data-opt="portrait"> 인물 사진</label>' +
      '</div>' +
      '<div class="xgrid"></div>' +
      '<div class="thumbs"></div>' +
      '<div class="actions">' +
        '<button class="btn" data-act="saveall">이미지 모두 저장</button>' +
        '<button class="btn" data-act="share" hidden>공유 (글+이미지)</button>' +
      '</div>' +
    '</div>';

  $('.tag', el).textContent = it.label + (it.series ? ' #' + it.series : '');
  const ta = $('textarea', el);
  const len = $('.len', el);
  const doneBtn = $('[data-act="done"]', el);
  const portraitBox = $('[data-opt="portrait"]', el);
  ta.value = it.text;

  const updateLen = () => {
    const n = tweetLength(ta.value);
    len.textContent = n + ' / 280';
    len.classList.toggle('over', n > 280);
  };
  const updateDone = () => {
    const on = el.classList.contains('done');
    doneBtn.textContent = on ? '✓ 올렸어요' : '올렸어요';
    doneBtn.classList.toggle('ok', on);
  };
  const grow = () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 2 + 'px'; };
  ta.addEventListener('input', () => { updateLen(); grow(); });
  updateLen();
  requestAnimationFrame(grow);
  updateDone();

  // 인물 사진: 있으면 기본으로 넣고, 체크를 풀면 뺀다
  portraitBox.checked = hasPortrait(it);
  portraitBox.disabled = !hasPortrait(it);
  if (!hasPortrait(it)) portraitBox.parentElement.title = '저장된 인물 사진이 없어요';

  let pages = [];
  let ready = null;
  const render = () => {
    ready = buildImages(it, { bg: BGS[state.bg], portrait: portraitBox.checked }).then((cs) => {
      pages = cs;
      showPreview(el, cs);
      return cs;
    });
    return ready;
  };
  el._render = render;
  render();
  portraitBox.addEventListener('change', render);

  const shareBtn = $('[data-act="share"]', el);
  if (navigator.canShare && navigator.canShare({ files: [new File([''], 'x.png', { type: 'image/png' })] })) {
    shareBtn.hidden = false;
  }
  const fileName = (i) => it.id + '-' + (i + 1) + '.png';

  el.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-act]');
    if (!t) return;
    const act = t.dataset.act;
    try {
      if (act === 'post') {
        window.open(INTENT + encodeURIComponent(ta.value), '_blank', 'noopener');
      } else if (act === 'copytext') {
        await navigator.clipboard.writeText(ta.value);
        status('글을 복사했어요');
      } else if (act === 'done') {
        const on = !el.classList.contains('done');
        el.classList.toggle('done', on);
        setDone(it.id, on);
        updateDone();
        renderDays();
      } else if (act === 'copyimg') {
        // 사파리는 클릭 직후 바로 write 를 불러야 해서 blob 대신 약속(promise)을 넘긴다
        const i = +t.dataset.i;
        const blob = ready.then((cs) => canvasBlob(cs[i]));
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        status((i + 1) + '번 이미지를 복사했어요. X 작성창에서 Ctrl+V');
      } else if (act === 'saveimg' || act === 'saveall') {
        const cs = await ready;
        const idx = act === 'saveimg' ? [+t.dataset.i] : cs.map((_, i) => i);
        for (const i of idx) {
          const a = document.createElement('a');
          a.href = URL.createObjectURL(await canvasBlob(cs[i]));
          a.download = fileName(i);
          a.click();
          setTimeout(() => URL.revokeObjectURL(a.href), 3000);
          await new Promise((r) => setTimeout(r, 250));   // 여러 장을 연달아 받을 때 브라우저가 막지 않게
        }
      } else if (act === 'share') {
        const cs = await ready;
        const files = await Promise.all(cs.map(async (cv, i) => new File([await canvasBlob(cv)], fileName(i), { type: 'image/png' })));
        await navigator.share({ text: ta.value, files });
      }
    } catch (err) {
      if (err && err.name === 'AbortError') return;
      console.warn(err);
      status(act === 'copyimg'
        ? '이 브라우저는 이미지 복사를 못 해요. 저장을 써 주세요'
        : '실패했어요: ' + (err && err.message ? err.message : err));
    }
  });
  return el;
}

// X 모바일 타임라인처럼 잘라서 보여 주고, 아래에 원본 크기 썸네일을 둔다
function showPreview(el, canvases) {
  const grid = $('.xgrid', el);
  grid.className = 'xgrid n' + canvases.length;
  grid.innerHTML = '';
  const thumbs = $('.thumbs', el);
  thumbs.innerHTML = '';
  canvases.forEach((cv, i) => {
    const url = cv.toDataURL('image/jpeg', 0.85);
    const cell = document.createElement('div');
    cell.className = 'cell c' + i;
    cell.innerHTML = '<img alt="">';
    cell.firstChild.src = url;
    grid.appendChild(cell);

    const t = document.createElement('figure');
    t.className = 'thumb';
    t.innerHTML = '<img alt=""><figcaption>' + (i + 1) + '/' + canvases.length +
      ' <button class="btn tiny" data-act="copyimg" data-i="' + i + '">복사</button>' +
      '<button class="btn tiny" data-act="saveimg" data-i="' + i + '">저장</button></figcaption>';
    t.firstChild.src = url;
    thumbs.appendChild(t);
  });
}

function setBg(bg) {
  state.bg = BGS[bg] ? bg : 'white';
  store(BG_KEY, state.bg);
  document.querySelectorAll('[data-bg]').forEach((b) => b.classList.toggle('on', b.dataset.bg === state.bg));
  document.querySelectorAll('.card').forEach((c) => c._render && c._render());
}

async function init() {
  state.bg = BGS[store(BG_KEY)] ? store(BG_KEY) : 'white';
  document.querySelectorAll('[data-bg]').forEach((b) => {
    b.classList.toggle('on', b.dataset.bg === state.bg);
    b.onclick = () => setBg(b.dataset.bg);
  });
  status('불러오는 중…');
  try {
    const res = await fetch(QUEUE_URL + '?t=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) throw new Error(res.status);
    const q = await res.json();
    state.days = q.days || [];
    state.day = state.days[0] || null;
    status(q.updated ? '마지막 생성 ' + q.updated : '');
  } catch (e) {
    status('x_queue.json 을 못 읽었어요');
  }
  renderDays();
  renderCards();
}

init();
