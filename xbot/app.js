/* ============ Favorbook X 게시 도우미 ============
 *
 * data/x_queue.json (tools/x_queue.py 가 매일 만든다)을 읽어
 * 날짜별 트윗 3개를 카드로 보여 준다. 게시는 X의 공유 링크(intent)로 하므로
 * API 키도 비용도 필요 없다. 이미지는 여기서 캔버스로 그려 복사·저장한다.
 */

const QUEUE_URL = '../data/x_queue.json';
const PROXY = 'https://images.weserv.nl/?url=';
const INTENT = 'https://x.com/intent/post?text=';
const DONE_KEY = 'xbot-done';
const W = 1200, H = 675;           // X 타임라인에서 잘리지 않는 16:9

const $ = (s, el = document) => el.querySelector(s);
const state = { days: [], day: null };

/* ---------- 게시 완료 표시 (이 브라우저에만) ---------- */
function loadDone() {
  try { return JSON.parse(localStorage.getItem(DONE_KEY) || '{}'); } catch (e) { return {}; }
}
function setDone(id, on) {
  const d = loadDone();
  if (on) d[id] = true; else delete d[id];
  try { localStorage.setItem(DONE_KEY, JSON.stringify(d)); } catch (e) { /* 저장 불가 환경 */ }
}

/* ---------- 트윗 길이 (tools/x_queue.py 와 같은 규칙) ---------- */
const LIGHT = [[0, 4351], [8192, 8205], [8208, 8223], [8242, 8247]];
function tweetLength(text) {
  let n = 0;
  text = text.replace(/https?:\/\/\S+/g, () => { n += 23; return ''; });
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    n += LIGHT.some(([a, b]) => cp >= a && cp <= b) ? 1 : 2;
  }
  return n;
}

/* ---------- 이미지 ---------- */
function proxify(u) {
  u = String(u || '').replace(/&amp;/g, '&').trim();
  if (!/^https?:\/\//i.test(u)) return '';
  return PROXY + encodeURIComponent(u.replace(/^https?:\/\//i, '')) + '&output=jpg&q=90';
}
function loadImage(u) {
  return new Promise((res) => {
    const src = proxify(u);
    if (!src) return res(null);
    const im = new Image();
    im.crossOrigin = 'anonymous';
    im.onload = () => res(im);
    im.onerror = () => res(null);
    im.src = src;
  });
}

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
    const more = ' 외 ' + (names.length - i) + '명';
    const parts = cur.split(sep);
    while (parts.length > 1 && ctx.measureText(parts.join(sep) + more).width > maxW) { parts.pop(); i--; }
    cur = parts.join(sep) + ' 외 ' + (names.length - i) + '명';
  }
  if (cur) lines.push(cur);
  return lines;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawCover(ctx, im, x, y, w, h) {
  ctx.save();
  ctx.shadowColor = 'rgba(40,30,15,.28)';
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 8;
  ctx.fillStyle = '#d8cfbd';
  ctx.fillRect(x, y, w, h);
  ctx.restore();
  if (!im) return;
  // 표지 비율을 지키며 칸 안에 맞춘다
  const r = Math.min(w / im.width, h / im.height);
  const dw = im.width * r, dh = im.height * r;
  ctx.fillStyle = '#f4efe4';
  ctx.fillRect(x, y, w, h);
  ctx.drawImage(im, x + (w - dw) / 2, y + (h - dh), dw, dh);
}

async function drawCard(canvas, img, type) {
  const ctx = canvas.getContext('2d');
  canvas.width = W; canvas.height = H;
  const bg = '#f4efe4', ink = '#1f1d19', mute = '#7a7162';
  const accent = type === 'new' ? '#c9a21a' : type === 'book' ? '#3f6a95' : '#9a6a3a';

  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // 오른쪽: 표지
  const covers = await Promise.all((img.covers || []).map(loadImage));
  const area = { x: 640, y: 60, w: 500, h: 555 };
  if (covers.length <= 1) {
    const h = 470, w = Math.round(h * 0.68);
    drawCover(ctx, covers[0], area.x + (area.w - w) / 2, area.y + (area.h - h) / 2, w, h);
  } else {
    const cols = covers.length <= 2 ? 2 : 3;
    const rows = Math.ceil(covers.length / cols);
    const gap = 22;
    let cw = (area.w - gap * (cols - 1)) / cols;
    let ch = cw / 0.68;
    if (ch * rows + gap * (rows - 1) > area.h) {
      ch = (area.h - gap * (rows - 1)) / rows;
      cw = ch * 0.68;
    }
    const totalW = cw * cols + gap * (cols - 1);
    const totalH = ch * rows + gap * (rows - 1);
    covers.forEach((im, i) => {
      const r = Math.floor(i / cols), c = i % cols;
      const inRow = Math.min(cols, covers.length - r * cols);
      const rowW = cw * inRow + gap * (inRow - 1);
      const x0 = area.x + (area.w - totalW) / 2 + (totalW - rowW) / 2;
      drawCover(ctx, im, x0 + c * (cw + gap), area.y + (area.h - totalH) / 2 + r * (ch + gap), cw, ch);
    });
  }

  // 왼쪽: 글
  const L = 70, maxW = 520;
  let y = 120;

  ctx.fillStyle = accent;
  ctx.font = '700 26px "KoPubWorld Dotum", sans-serif';
  ctx.fillText(img.kicker || '', L, y);
  y += 30;

  ctx.fillStyle = ink;
  ctx.font = '700 62px "KoPubWorld Batang", serif';
  for (const line of wrap(ctx, img.title, maxW, 3)) {
    y += 78;
    ctx.fillText(line, L, y);
  }

  if (img.sub) {
    y += 56;
    ctx.fillStyle = mute;
    ctx.font = '500 28px "KoPubWorld Dotum", sans-serif';
    for (const line of wrap(ctx, img.sub, maxW, 2)) { ctx.fillText(line, L, y); y += 40; }
    y -= 40;
  }

  if (img.names && img.names.length) {
    y += 58;
    ctx.fillStyle = ink;
    ctx.font = '500 25px "KoPubWorld Dotum", sans-serif';
    const lines = wrapNames(ctx, img.names, maxW, Math.max(1, Math.floor((H - 110 - y) / 38)));
    for (const line of lines) { ctx.fillText(line, L, y); y += 38; }
  }

  // 아래: 주소
  ctx.fillStyle = accent;
  roundRect(ctx, L, H - 92, 8, 34, 4);
  ctx.fill();
  ctx.fillStyle = ink;
  ctx.font = '700 26px "KoPubWorld Dotum", sans-serif';
  ctx.fillText('favorbook.co.kr', L + 22, H - 66);
  ctx.fillStyle = mute;
  ctx.font = '500 22px "KoPubWorld Dotum", sans-serif';
  ctx.fillText('최애의 독서 · 그들이 읽은 책', L + 232, H - 66);
}

// 캔버스에만 쓰는 글꼴은 저절로 내려받지 않으니 미리 불러 둔다
const fontsReady = Promise.all([
  '700 62px "KoPubWorld Batang"',
  '700 26px "KoPubWorld Dotum"',
  '500 26px "KoPubWorld Dotum"',
].map((f) => document.fonts.load(f, '가A'))).catch(() => {});

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
      '<canvas></canvas>' +
      '<div class="actions">' +
        '<button class="btn" data-act="copyimg">이미지 복사</button>' +
        '<button class="btn" data-act="saveimg">이미지 저장</button>' +
        '<button class="btn" data-act="share" hidden>공유 (글+이미지)</button>' +
      '</div>' +
    '</div>';

  $('.tag', el).textContent = it.label;
  const ta = $('textarea', el);
  const len = $('.len', el);
  const doneBtn = $('[data-act="done"]', el);
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

  const canvas = $('canvas', el);
  const ready = fontsReady.then(() => drawCard(canvas, it.image || {}, it.type));

  const fileName = it.id + '.png';
  const shareBtn = $('[data-act="share"]', el);
  if (navigator.canShare && navigator.canShare({ files: [new File([''], 'x.png', { type: 'image/png' })] })) {
    shareBtn.hidden = false;
  }

  el.addEventListener('click', async (e) => {
    const act = e.target.dataset && e.target.dataset.act;
    if (!act) return;
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
        const blob = ready.then(() => canvasBlob(canvas));
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        status('이미지를 복사했어요. X 작성창에서 Ctrl+V');
      } else {
        await ready;
        const blob = await canvasBlob(canvas);
        if (act === 'saveimg') {
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = fileName;
          a.click();
          setTimeout(() => URL.revokeObjectURL(a.href), 2000);
        } else if (act === 'share') {
          await navigator.share({ text: ta.value, files: [new File([blob], fileName, { type: 'image/png' })] });
        }
      }
    } catch (err) {
      if (err && err.name === 'AbortError') return;
      console.warn(err);
      status(act === 'copyimg'
        ? '이 브라우저는 이미지 복사를 못 해요. 이미지 저장을 써 주세요'
        : '실패했어요: ' + (err && err.message ? err.message : err));
    }
  });
  return el;
}

async function init() {
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
