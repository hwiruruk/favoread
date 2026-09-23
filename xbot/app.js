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
const STYLE_KEY = 'xbot-style';

const WIDE = [1200, 675];     // 16:9
const TALL = [1080, 1215];    // 8:9
const SQUARE = [1200, 1200];

const CLEAR = 'transparent';
const BGS = { white: '#ffffff', ivory: '#fbf8f1', clear: CLEAR };
const INK = '#161616', MUTE = '#6e6e6e', LINE = '#e6e3dc';
const ACCENT = { celeb: '#2f5d8a', new: '#c8453a', book: '#2f7a5b' };

const $ = (s, el = document) => el.querySelector(s);
const state = { days: [], day: null, bg: 'white', style: 'card' };

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
  '700 26px "KoPubWorld Dotum"',
  '500 26px "KoPubWorld Dotum"',
].map((f) => document.fonts.load(f, '가A'))).catch(() => {});

/* ---------- 글자 ----------
 * 이미지 글자는 전부 코펍월드 돋움. 제목은 굵게(700), 나머지는 보통(500). */
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
  if (bg === CLEAR) {
    // 투명 배경: X 어두운 화면에서도 글자가 보이도록, 바탕 위에 바로 쓰는 어두운 글자에
    // 흰 테두리를 얇게 두른다(말풍선·카드 안의 흰 글자는 그대로).
    const fill = ctx.fillText.bind(ctx);
    ctx.fillText = (t, x, y, mw) => {
      const f = String(ctx.fillStyle).toLowerCase();
      if (f !== '#ffffff' && !f.startsWith('rgba(255')) {
        ctx.save();
        ctx.strokeStyle = 'rgba(255,255,255,.92)';
        ctx.lineJoin = 'round';
        ctx.lineWidth = Math.max(2, parseFloat(ctx.font.split(' ')[1]) * 0.13);
        ctx.strokeText(t, x, y, mw);
        ctx.restore();
      }
      fill(t, x, y, mw);
    };
  } else {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
  }
  return { c, ctx, W, H };
}

/* ---------- 책장: 표지 장 ---------- */
async function drawShelfCover(size, img, type, opts) {
  const { c, ctx, W, H } = newCanvas(size, opts.bg);
  const accent = ACCENT[type];
  const s = W / 1200;
  const pad = Math.round(64 * s);
  const wide = W > H;
  const photo = !opts.portrait ? null : opts.photo || (img.portrait ? await loadImage(img.portrait, 1200) : null);

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
  ctx.font = DOTUM(Math.round(76 * s), 700);
  y = drawLines(ctx, wrap(ctx, img.name, tw, 2), tx, y + 96 * s, 90 * s);
  ctx.font = DOTUM(Math.round(56 * s), 700);
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
    ctx.font = DOTUM(Math.round(54 * s), 700);
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
      ctx.font = DOTUM(titlePx, 700);
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
  ctx.font = DOTUM(Math.round(64 * s), 700);
  y = drawLines(ctx, wrap(ctx, b.title, tw, 3), tx, y + 100 * s, 80 * s);
  ctx.fillStyle = MUTE;
  ctx.font = DOTUM(Math.round(30 * s));
  drawLines(ctx, wrap(ctx, b.by, tw, 2), tx, y + 10 * s, 42 * s);

  // 아래: 인물 사진 줄(선택) + 이름
  y = r.y + r.h + pad * 0.9;
  if (opts.portrait) {
    // 올린 사진이 있으면 맨 앞 동그라미로
    const photos = (opts.photo ? [opts.photo] : [])
      .concat(await Promise.all(img.portraits.slice(0, opts.photo ? 5 : 6).map((u) => loadImage(u, 300))));
    const shown = photos.map((im) => [im]).filter(([im]) => im);
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

/* ---------- 채팅 디자인 ----------
 * '최애의 독서'가 채팅방에서 책을 소개하는 모양. 말하는 사람은 언제나
 * '최애의 독서'이고, 인물 본인이 보낸 메시지처럼 꾸미지 않는다(인증 마크·1인칭 없음).
 * 편집기에서 승인된 코멘트(3인칭 정리글)가 있는 책은 출처와 함께 말풍선으로 덧붙인다. */
const BUBBLE = '#eef0f4';

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
}

// 대화방 윗줄: 동그란 로고 + '최애의 독서'
function chatHeader(ctx, x, y, s, accent) {
  const r = 30 * s;
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.arc(x + r, y + r, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.font = Math.round(30 * s) + 'px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('📚', x + r, y + r + 2 * s);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = INK;
  ctx.font = DOTUM(Math.round(28 * s), 700);
  ctx.fillText('최애의 독서', x + r * 2 + 16 * s, y + r + 10 * s);
  return y + r * 2 + 18 * s;
}

// 글 말풍선. 글 길이에 맞춰 폭을 줄인다. 아래 끝 y 를 돌려준다
function textBubble(ctx, x, y, maxW, text, s, o = {}) {
  const px = Math.round((o.px || 30) * s), lh = px * 1.45, padX = 26 * s, padY = 20 * s;
  ctx.font = DOTUM(px, o.weight || 500);
  // o.names 가 있으면 이름 단위로 줄을 바꾼다(이름 중간에서 안 끊김)
  const lines = o.names
    ? wrapNames(ctx, o.names, maxW - padX * 2, o.maxLines || 4)
    : wrap(ctx, text, maxW - padX * 2, o.maxLines || 4);
  const w = Math.min(maxW, Math.max(...lines.map((l) => ctx.measureText(l).width)) + padX * 2);
  const capPx = Math.round(20 * s);
  const h = padY * 2 + lh * lines.length - (lh - px) + (o.caption ? capPx * 1.8 : 0);
  ctx.fillStyle = o.bg || BUBBLE;
  roundRectPath(ctx, x, y, w, h, 26 * s);
  ctx.fill();
  ctx.fillStyle = o.color || INK;
  ctx.font = DOTUM(px, o.weight || 500);
  drawLines(ctx, lines, x + padX, y + padY + px * 0.85, lh);
  if (o.caption) {
    ctx.fillStyle = MUTE;
    ctx.font = DOTUM(capPx, 500);
    ctx.fillText(o.caption, x + padX, y + h - padY * 0.9);
  }
  return y + h;
}

// 책 카드 말풍선: 진한 바탕에 표지 + 제목·저자·출처
function bookBubble(ctx, x, y, w, h, book, im, accent, s) {
  ctx.fillStyle = accent;
  roundRectPath(ctx, x, y, w, h, 26 * s);
  ctx.fill();
  const pad = 22 * s;
  const r = drawCover(ctx, im, { x: x + pad, y: y + pad, w: (h - pad * 2) * 0.7, h: h - pad * 2 }, 'center', book.emoji);
  const tx = r.x + r.w + pad, tw = x + w - tx - pad;
  const px = Math.round(34 * s);
  ctx.fillStyle = '#ffffff';
  ctx.font = DOTUM(px, 700);
  let ty = y + pad + px;
  ty = drawLines(ctx, wrap(ctx, book.emoji + ' ' + book.title, tw, 3), tx, ty, px * 1.3);
  ctx.fillStyle = 'rgba(255,255,255,.82)';
  ctx.font = DOTUM(Math.round(24 * s));
  ty = drawLines(ctx, wrap(ctx, book.by, tw, 2), tx, ty + 4 * s, 32 * s);
  if (book.src) {
    ctx.fillStyle = 'rgba(255,255,255,.7)';
    ctx.font = DOTUM(Math.round(21 * s), 700);
    drawLines(ctx, wrap(ctx, book.src, tw, 1), tx, ty + 6 * s, 28 * s);
  }
}

async function drawChatCover(size, img, type, opts) {
  const { c, ctx, W, H } = newCanvas(size, opts.bg);
  const accent = ACCENT[type];
  const s = W / 1200, pad = Math.round(56 * s), wide = W > H;
  const photo = !opts.portrait ? null : opts.photo || (img.portrait ? await loadImage(img.portrait, 1000) : null);
  let y = chatHeader(ctx, pad, pad * 0.8, s, accent);
  const maxW = wide ? W * 0.56 : W - pad * 2;
  const n = img.books.length;
  y = textBubble(ctx, pad, y, maxW,
    type === 'new' ? img.name + ' 책장에 새 책이 들어왔어요 🆕' : img.name + '의 책장을 열어 볼게요 📚', s, { px: 34, weight: 700 });
  y = textBubble(ctx, pad, y + 14 * s, maxW,
    type === 'new' ? n + '권 추가 · 전체 ' + img.total + '권' : '전체 ' + img.total + '권 중 ' + n + '권 골라 왔어요', s);
  // 사진(또는 표지 모음) 말풍선: 넓은 판은 오른쪽, 좁은 판은 아래
  const box = wide
    ? { x: W * 0.62, y: pad * 0.8, w: W * 0.38 - pad, h: H - pad * 2.2 }
    : { x: pad, y: y + 20 * s, w: W - pad * 2, h: H - (y + 20 * s) - pad * 1.6 };
  if (photo) {
    drawPhoto(ctx, photo, box, 26 * s);
  } else {
    ctx.fillStyle = BUBBLE;
    roundRectPath(ctx, box.x, box.y, box.w, box.h, 26 * s);
    ctx.fill();
    const covers = await Promise.all(img.books.map((b) => loadImage(b.cover, 400)));
    const cols = n <= 2 ? n : (wide ? 2 : 3), rows = Math.ceil(n / cols), gap = 14 * s, ip = 24 * s;
    const cw = (box.w - ip * 2 - gap * (cols - 1)) / cols;
    const ch = Math.min((box.h - ip * 2 - gap * (rows - 1)) / rows, cw / 0.68);
    const y0 = box.y + (box.h - (ch * rows + gap * (rows - 1))) / 2;
    covers.forEach((im, i) => drawCover(ctx, im,
      { x: box.x + ip + (i % cols) * (cw + gap), y: y0 + Math.floor(i / cols) * (ch + gap), w: cw, h: ch }, 'center', img.books[i].emoji));
  }
  ctx.font = DOTUM(Math.round(22 * s), 700);
  ctx.fillStyle = MUTE;
  ctx.textAlign = 'right';
  ctx.fillText('#' + img.series, W - pad * 0.5, pad * 0.5 + 12 * s);
  ctx.textAlign = 'left';
  drawFooter(ctx, W, H, pad, '');
  return c;
}

async function drawChatBooks(size, books, type, opts, pageLabel) {
  const { c, ctx, W, H } = newCanvas(size, opts.bg);
  const accent = ACCENT[type];
  const s = W / 1200, pad = Math.round(56 * s), wide = W > H;
  const covers = await Promise.all(books.map((b) => loadImage(b.cover, 500)));
  const top = chatHeader(ctx, pad, pad * 0.8, s, accent);
  // 넓은 판은 책을 나란히, 좁은 판은 위아래로
  const n = books.length, gap = 28 * s;
  const colW = wide ? (W - pad * 2 - gap * (n - 1)) / n : W - pad * 2;
  const areaH = H - top - pad * 1.6;
  const rowH = wide ? areaH : (areaH - gap * (n - 1)) / n;
  books.forEach((b, i) => {
    const x = wide ? pad + i * (colW + gap) : pad;
    const y = wide ? top : top + i * (rowH + gap);
    const cardH = b.note ? Math.min(rowH * 0.5, 300 * s) : Math.min(rowH, 340 * s);
    bookBubble(ctx, x, y, colW, cardH, b, covers[i], accent, s);
    if (b.note) {
      const lines = Math.max(2, Math.floor((rowH - cardH - 14 * s - 80 * s) / (26 * s * 1.45)));
      textBubble(ctx, x, y + cardH + 14 * s, colW, '💬 ' + b.note, s,
        { px: 26, maxLines: lines, caption: b.noteSrc ? '출처 · ' + b.noteSrc : '' });
    }
  });
  drawFooter(ctx, W, H, pad, pageLabel);
  return c;
}

async function drawChatBookCard(img, opts) {
  const { c, ctx, W, H } = newCanvas(SQUARE, opts.bg);
  const accent = ACCENT.book;
  const s = W / 1200, pad = Math.round(64 * s);
  const b = img.book;
  let y = chatHeader(ctx, pad, pad * 0.8, s, accent);
  y = textBubble(ctx, pad, y, W - pad * 2, b.title + ' 읽은 사람 모여라~', s, { px: 38, weight: 700 });
  const cover = await loadImage(b.cover, 600);
  bookBubble(ctx, pad, y + 16 * s, W * 0.72, 330 * s, b, cover, accent, s);
  y += 16 * s + 330 * s + 16 * s;
  if (opts.portrait) {
    const photos = (opts.photo ? [opts.photo] : [])
      .concat(await Promise.all(img.portraits.slice(0, opts.photo ? 6 : 7).map((u) => loadImage(u, 300))))
      .filter(Boolean);
    if (photos.length) {
      const rad = 50 * s, step = rad * 2 + 18 * s;
      const w = Math.min(W - pad * 2, photos.length * step + 36 * s);
      ctx.fillStyle = BUBBLE;
      roundRectPath(ctx, pad, y, w, rad * 2 + 36 * s, 26 * s);
      ctx.fill();
      photos.forEach((im, i) => drawCircle(ctx, im, pad + 18 * s + rad + i * step, y + 18 * s + rad, rad));
      y += rad * 2 + 36 * s + 16 * s;
    }
  }
  y = textBubble(ctx, pad, y, W - pad * 2, img.names.length + '명이 읽었어요 👀', s, { px: 32, weight: 700 }) + 14 * s;
  const maxLines = Math.max(1, Math.floor((H - pad * 1.8 - y - 50 * s) / (32 * s * 1.45)));
  textBubble(ctx, pad, y, W - pad * 2, '', s, { px: 32, names: img.names, maxLines });
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
  const chat = opts.style === 'chat';
  if (it.type === 'book') return [await (chat ? drawChatBookCard : drawBookCard)(img, opts)];
  const books = img.books || [];
  // 3권 이상 → 표지 + 책 3장(16:9 네 장), 2권 이하 → 표지 + 책 1장(8:9 두 장)
  const wide = books.length >= 3;
  const size = wide ? WIDE : TALL;
  const groups = wide ? chunk(books, 3) : [books];
  const total = groups.length + 1;
  const pages = [await (chat ? drawChatCover : drawShelfCover)(size, img, it.type, opts)];
  for (let i = 0; i < groups.length; i++) {
    pages.push(await (chat ? drawChatBooks : drawShelfBooks)(size, groups[i], it.type, opts, img.name + ' #' + img.series + ' · ' + (i + 2) + '/' + total));
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
      '<div class="card-head"><span class="tag ' + it.type + '"></span><span class="muted thread-n"></span></div>' +
      '<div class="posts"></div>' +
      '<details class="sources" hidden><summary></summary><ul></ul></details>' +
      '<div class="actions"><button class="btn" data-act="done"></button></div>' +
    '</div>' +
    '<div>' +
      '<div class="preview-head">' +
        '<span class="muted">X 모바일 미리보기 (첫 글 이미지)</span>' +
        '<span class="photo-tools">' +
          '<label class="toggle"><input type="checkbox" data-opt="portrait"> 인물 사진</label>' +
          '<label class="btn tiny" title="내 컴퓨터·휴대폰의 사진으로 바꿔요">📷 사진 올리기<input type="file" accept="image/*" data-opt="upload" hidden></label>' +
          '<button class="btn tiny" data-act="unphoto" hidden title="올린 사진 빼기">✕</button>' +
        '</span>' +
      '</div>' +
      '<div class="xgrid"></div>' +
      '<div class="thumbs"></div>' +
      '<div class="actions">' +
        '<button class="btn" data-act="saveall">이미지 모두 저장</button>' +
        '<button class="btn" data-act="share" hidden>공유 (첫 글+이미지)</button>' +
      '</div>' +
    '</div>';

  $('.tag', el).textContent = it.label + (it.series ? ' #' + it.series : '');
  const doneBtn = $('[data-act="done"]', el);
  const portraitBox = $('[data-opt="portrait"]', el);

  // 타래: 첫 글 + 답글들. 답글은 앞 글 주소를 붙여넣으면 그 글에 이어서 쓴다
  const posts = (it.thread && it.thread.length ? it.thread : [it.text]);
  if (posts.length > 1) $('.thread-n', el).textContent = '🧵 타래 ' + posts.length + '개';
  const postsEl = $('.posts', el);
  const areas = [], urls = [];
  posts.forEach((text, k) => {
    const p = document.createElement('div');
    p.className = 'post' + (k ? ' reply' : '');
    p.innerHTML =
      '<div class="post-head"><span></span><span class="len"></span></div>' +
      '<textarea spellcheck="false"></textarea>' +
      '<div class="actions">' +
        '<button class="btn' + (k ? '' : ' primary') + '" data-act="post" data-k="' + k + '">' + (k ? '↳ 답글 쓰기' : '𝕏 X에 쓰기') + '</button>' +
        '<button class="btn" data-act="copytext" data-k="' + k + '">글 복사</button>' +
      '</div>' +
      (k < posts.length - 1
        ? '<input class="posted-url" type="url" inputmode="url" placeholder="올린 글 주소 붙여넣기 → 다음 답글이 여기에 이어져요">'
        : '');
    $('.post-head span', p).textContent = posts.length > 1 ? (k ? '답글 ' + k : '첫 글') + ' · ' + (k + 1) + '/' + posts.length : '';
    const ta = $('textarea', p);
    const len = $('.len', p);
    ta.value = text;
    const updateLen = () => {
      const n = tweetLength(ta.value);
      len.textContent = n + ' / 280';
      len.classList.toggle('over', n > 280);
    };
    const grow = () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 2 + 'px'; };
    ta.addEventListener('input', () => { updateLen(); grow(); });
    updateLen();
    requestAnimationFrame(grow);
    areas.push(ta);
    const u = $('.posted-url', p);
    if (u) {
      const key = 'xbot-url-' + it.id + '-' + k;
      u.value = store(key) || '';
      u.addEventListener('change', () => store(key, u.value.trim()));
      urls.push(u);
    }
    postsEl.appendChild(p);
  });
  const ta = areas[0];

  // 출처 확인: 올리기 전에 원문을 열어 볼 수 있게
  const srcBooks = ((it.image || {}).books || []).filter((bk) => /^https?:\/\//i.test(bk.source || ''));
  if (srcBooks.length) {
    const det = $('.sources', el);
    det.hidden = false;
    $('summary', det).textContent = '출처 확인 (' + srcBooks.length + ')';
    const ul = $('ul', det);
    srcBooks.forEach((bk) => {
      const li = document.createElement('li');
      li.innerHTML = '<span></span> <a target="_blank" rel="noopener"></a>';
      li.firstChild.textContent = bk.emoji + ' ' + bk.title + (bk.src ? ' · ' + bk.src : '');
      li.lastChild.href = bk.source;
      li.lastChild.textContent = '열기 ↗';
      ul.appendChild(li);
    });
  }

  const updateDone = () => {
    const on = el.classList.contains('done');
    doneBtn.textContent = on ? '✓ 올렸어요' : '올렸어요';
    doneBtn.classList.toggle('ok', on);
  };
  updateDone();

  // 인물 사진: 있으면 기본으로 넣고, 체크를 풀면 뺀다
  portraitBox.checked = hasPortrait(it);
  portraitBox.disabled = !hasPortrait(it);
  if (!hasPortrait(it)) portraitBox.parentElement.title = '저장된 인물 사진이 없어요';

  let pages = [];
  let ready = null;
  let upPhoto = null, upUrl = '';   // '사진 올리기'로 고른 사진(아래에서 채움)
  const render = () => {
    ready = buildImages(it, { bg: BGS[state.bg], style: state.style, portrait: portraitBox.checked, photo: upPhoto }).then((cs) => {
      pages = cs;
      showPreview(el, cs);
      return cs;
    });
    return ready;
  };
  el._render = render;
  render();
  portraitBox.addEventListener('change', render);

  // 사진 올리기: 고른 파일은 이 브라우저 안에서만 쓰고 어디에도 올라가지 않는다.
  // 같은 출처(blob:)라 캔버스가 막히지 않는다.
  const unBtn = $('[data-act="unphoto"]', el);
  $('[data-opt="upload"]', el).addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!f) return;
    const im = new Image();
    const u = URL.createObjectURL(f);
    im.onload = () => {
      if (upUrl) URL.revokeObjectURL(upUrl);
      upPhoto = im; upUrl = u;
      portraitBox.disabled = false;
      portraitBox.checked = true;
      unBtn.hidden = false;
      status('올린 사진으로 바꿨어요');
      render();
    };
    im.onerror = () => { URL.revokeObjectURL(u); status('이 파일은 사진으로 읽을 수 없어요'); };
    im.src = u;
  });

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
        const k = +t.dataset.k;
        let url = INTENT + encodeURIComponent(areas[k].value);
        if (k > 0) {
          const id = statusId(urls[k - 1].value);
          if (!id) {
            status('앞 글을 올린 뒤 그 주소를 붙여넣어야 답글로 이어져요');
            urls[k - 1].focus();
            return;
          }
          url += '&in_reply_to=' + id;
        }
        // PC에서 첫 글을 쓸 때는 첫 번째 이미지를 클립보드에 미리 넣어 둔다.
        // 작성창이 열리면 Ctrl+V 한 번으로 붙는다. 창이 열리면 이 페이지가 포커스를
        // 잃어 복사가 막히므로, 복사를 먼저 끝내고(길어야 2초) 창을 연다.
        let copied = false;
        if (k === 0 && window.matchMedia('(pointer: fine)').matches && window.ClipboardItem && navigator.clipboard) {
          try {
            const blob = ready.then((cs) => canvasBlob(cs[0]));
            await Promise.race([
              navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]),
              new Promise((_, no) => setTimeout(() => no(new Error('timeout')), 2000)),
            ]);
            copied = true;
          } catch (e) { /* 복사가 안 돼도 글쓰기 창은 연다 */ }
        }
        const w = window.open(url, '_blank');
        if (w) w.opener = null;
        if (!w) status('브라우저가 새 창을 막았어요. 한 번 더 눌러 주세요');
        else if (copied) status('1번 이미지를 복사해 뒀어요. 작성창에서 Ctrl+V (나머지는 썸네일의 복사로)');
      } else if (act === 'unphoto') {
        if (upUrl) URL.revokeObjectURL(upUrl);
        upPhoto = null; upUrl = '';
        unBtn.hidden = true;
        portraitBox.checked = hasPortrait(it);
        portraitBox.disabled = !hasPortrait(it);
        render();
      } else if (act === 'copytext') {
        await navigator.clipboard.writeText(areas[+t.dataset.k].value);
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

// 'https://x.com/계정/status/123…' → '123…'
function statusId(u) {
  const m = String(u || '').match(/status(?:es)?\/(\d{5,})/);
  return m ? m[1] : '';
}

// X 모바일 타임라인처럼 잘라서 보여 주고, 아래에 원본 크기 썸네일을 둔다
function showPreview(el, canvases) {
  const grid = $('.xgrid', el);
  grid.className = 'xgrid n' + canvases.length;
  grid.innerHTML = '';
  const thumbs = $('.thumbs', el);
  thumbs.innerHTML = '';
  canvases.forEach((cv, i) => {
    // 투명 배경은 JPEG로 줄이면 까맣게 되니 PNG 그대로 보여 준다
    const url = state.bg === 'clear' ? cv.toDataURL('image/png') : cv.toDataURL('image/jpeg', 0.85);
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

function setStyle(st) {
  state.style = st === 'chat' ? 'chat' : 'card';
  store(STYLE_KEY, state.style);
  document.querySelectorAll('[data-style]').forEach((b) => b.classList.toggle('on', b.dataset.style === state.style));
  document.querySelectorAll('.card').forEach((c) => c._render && c._render());
}

function setBg(bg) {
  state.bg = BGS[bg] ? bg : 'white';
  store(BG_KEY, state.bg);
  document.querySelectorAll('[data-bg]').forEach((b) => b.classList.toggle('on', b.dataset.bg === state.bg));
  document.querySelectorAll('.card').forEach((c) => c._render && c._render());
}

async function init() {
  state.bg = BGS[store(BG_KEY)] ? store(BG_KEY) : 'white';
  state.style = store(STYLE_KEY) === 'chat' ? 'chat' : 'card';
  document.querySelectorAll('[data-style]').forEach((b) => {
    b.classList.toggle('on', b.dataset.style === state.style);
    b.onclick = () => setStyle(b.dataset.style);
  });
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

/* ---------- 인물 골라서 만들기 ----------
 * tools/x_queue.py 가 만들어 둔 data/x_books.json(인물별 책 줄 재료)과
 * data/x_state.json(이미 나간 책·시리즈 번호)을 읽어, 고른 인물·책으로
 * 매일 트윗과 같은 모양의 카드를 그 자리에서 만든다. */
const BOOKS_URL = '../data/x_books.json';
const STATE_URL = '../data/x_state.json';
const PICK_MAX = 6;
const picker = { books: null, state: null };

function fitLines(head, lines, tail) {
  for (let keep = lines.length; keep > 0; keep--) {
    const text = head + lines.slice(0, keep).join('\n') + tail;
    if (tweetLength(text) <= 280) return [text, keep];
  }
  return [head + lines[0] + tail, 1];
}
function threadReplies(lines) {
  const out = [];
  let cur = [];
  for (const l of lines) {
    if (cur.length && tweetLength(cur.concat(l).join('\n')) > 280) { out.push(cur.join('\n')); cur = []; }
    cur.push(l);
  }
  if (cur.length) out.push(cur.join('\n'));
  return out;
}

function makePickedItem(name, books) {
  const c = picker.books.celebs[name];
  const mark = picker.books.mark || '';
  const series = ((picker.state.series || {})[name] || 0) + 1;
  const lines = books.map((b) => b.emoji + ' ' + b.title + (b.by ? '(' + b.by + ')' : '') + (b.src ? ' ' + mark + b.src : ''));
  const head = '📚 ' + (c.display || name) + '의 책장\n\n';
  const tail = '\n\n전체 목록(' + c.books.length + '권)\n' + c.url + '\n\n' + c.tags;
  const [text, used] = fitLines(head, lines, tail);
  return {
    id: 'pick-' + Date.now(),
    type: 'celeb',
    key: name,
    label: '직접 고른 책장',
    series,
    text,
    thread: [text].concat(threadReplies(lines.slice(used))),
    url: c.url,
    image: { name: c.display || name, series, total: c.books.length, portrait: c.portrait, books },
  };
}

async function openPicker() {
  if (picker.books) return;
  $('#pickInfo').textContent = '불러오는 중…';
  try {
    const [b, st] = await Promise.all([BOOKS_URL, STATE_URL].map((u) =>
      fetch(u + '?t=' + Date.now(), { cache: 'no-store' }).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })));
    picker.books = b;
    picker.state = st;
  } catch (e) {
    $('#pickInfo').textContent = 'x_books.json 을 못 읽었어요. X Queue 워크플로가 한 번 돈 뒤에 쓸 수 있어요.';
    return;
  }
  const dl = $('#celebList');
  Object.keys(picker.books.celebs).sort((a, b) => a.localeCompare(b, 'ko')).forEach((n) => {
    const o = document.createElement('option');
    o.value = n;
    if (picker.books.celebs[n].display !== n) o.label = picker.books.celebs[n].display;
    dl.appendChild(o);
  });
  $('#pickInfo').textContent = '인물 ' + dl.children.length + '명 중에서 고르세요.';
}

function showPickBooks() {
  const name = $('#pickName').value.trim();
  const ul = $('#pickBooks');
  const btn = $('#pickMake');
  ul.innerHTML = '';
  btn.disabled = true;
  const c = picker.books && picker.books.celebs[name];
  if (!c) return;
  const posted = new Set(((picker.state.posted || {})[name]) || []);
  const fresh = c.books.filter((b) => !posted.has(b.title));
  const preset = new Set((fresh.length ? fresh : c.books).slice(0, PICK_MAX).map((b) => b.title));
  const series = ((picker.state.series || {})[name] || 0) + 1;
  $('#pickInfo').textContent = '전체 ' + c.books.length + '권 · 나간 책 ' + posted.size + '권 · 이번이 #' + series +
    ' · 최대 ' + PICK_MAX + '권까지 고를 수 있어요';
  // 안 나간 책을 먼저, 그 안에서는 여러 셀럽이 함께 읽은 책부터
  const order = fresh.concat(c.books.filter((b) => posted.has(b.title)));
  order.forEach((b) => {
    const li = document.createElement('li');
    li.innerHTML = '<label><input type="checkbox"><span></span></label>';
    const box = $('input', li);
    box.checked = preset.has(b.title);
    box._book = b;
    $('span', li).textContent = b.emoji + ' ' + b.title + (b.src ? ' · ' + b.src : '');
    if (posted.has(b.title)) {
      const tag = document.createElement('em');
      tag.className = 'posted';
      tag.textContent = '나감';
      $('label', li).appendChild(tag);
    }
    ul.appendChild(li);
  });
  syncPickLimit();
}

function syncPickLimit() {
  const boxes = [...document.querySelectorAll('#pickBooks input')];
  const n = boxes.filter((b) => b.checked).length;
  boxes.forEach((b) => { b.disabled = !b.checked && n >= PICK_MAX; });
  $('#pickMake').disabled = n === 0;
  $('#pickMake').textContent = n ? n + '권으로 트윗 만들기' : '트윗 만들기';
}

$('#picker').addEventListener('toggle', (e) => { if (e.target.open) openPicker(); });
$('#pickName').addEventListener('input', showPickBooks);
$('#pickBooks').addEventListener('change', syncPickLimit);
$('#pickMake').addEventListener('click', () => {
  const name = $('#pickName').value.trim();
  const books = [...document.querySelectorAll('#pickBooks input')].filter((b) => b.checked).map((b) => b._book);
  if (!books.length) return;
  $('#picked').prepend(cardEl(makePickedItem(name, books), false));
  status(name + ' 트윗을 만들었어요');
  $('#picked').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

init();
