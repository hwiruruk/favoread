/* ========================================================
   Favoread 카드뉴스 빌더
   - data.json 에서 인물 검색 → 책/정보 불러오기
   - antiegg 풍 인스타그램 카드(표지/본문/출처) 생성 → PNG 내보내기
   ======================================================== */
'use strict';

const OUTPUT_SCALE = 2;            // 1080 → 2160px export
const DEFAULT_SELECT = 6;          // 처음 자동 선택할 책 수
const PROXY = 'https://images.weserv.nl/?url=';

/* ---------- 상태 ---------- */
const state = {
  data: null,
  name: '',
  celeb: null,
  customImage: null,     // dataURL (표지 사진 교체)
  books: [],             // {ref, selected, quote, srcName, srcType, srcDate}
  opts: {
    format: 'portrait',
    mono: false,
    outro: true,
    proxy: true,
    title: '',
    subtitle: '',
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
  // 패션·라이프스타일 매거진
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
  // 도서 채널
  ['ch.yes24.com', '채널예스', '웹'],
  ['yes24.com', '예스24', '도서플랫폼'],
  ['millie.co.kr', '밀리의 서재', '도서플랫폼'],
  ['kyobobook', '교보문고', '도서플랫폼'],
  ['aladin.co.kr', '알라딘', '도서플랫폼'],
  ['ridibooks.com', '리디', '도서플랫폼'],
  ['munhak.com', '문학동네', '도서플랫폼'],
  // 신문·뉴스
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
  // 방송
  ['imbc.com', 'MBC', '방송'],
  ['kbs.co.kr', 'KBS', '방송'],
  ['sbs.co.kr', 'SBS', '방송'],
  ['jtbc', 'JTBC', '방송'],
  ['tvn', 'tvN', '방송'],
  // 영상·SNS·커뮤니티
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
];

function detectSource(url) {
  const u = cleanUrl(url);
  let host = '';
  try { host = new URL(u).hostname.replace(/^www\.|^m\./, ''); } catch { /* ignore */ }
  let name = host || '', type = '웹';
  for (const [needle, n, t] of SRC_MAP) {
    if (u.includes(needle)) { name = n; type = t; break; }
  }
  // 날짜 추출: /2024/05/12/ 또는 20240512
  let date = '';
  let m = u.match(/\/(20\d{2})[\/\-_.](\d{1,2})[\/\-_.](\d{1,2})(?:\D|$)/);
  if (!m) m = u.match(/(?:^|\D)(20\d{2})(\d{2})(\d{2})(?:\D|$)/);
  if (m) {
    const mm = m[2].padStart(2, '0'), dd = m[3].padStart(2, '0');
    if (+mm >= 1 && +mm <= 12 && +dd >= 1 && +dd <= 31) date = `${m[1]}.${mm}.${dd}`;
  }
  return { name, type, date };
}

/* ---------- 인용/출처 표기 ---------- */
function citeParts(b) {
  const out = [];
  if (b.srcName) out.push(`<b>${esc(b.srcName)}</b>`);
  if (b.srcType) out.push(esc(b.srcType));
  if (b.srcDate) out.push(esc(b.srcDate));
  return out.join(' · ');
}
function citeText(b) {
  return [b.srcName, b.srcType, b.srcDate].filter(Boolean).join(' · ');
}

/* ========================================================
   데이터 로드
   ======================================================== */
async function boot() {
  status('데이터 불러오는 중…');
  try {
    const res = await fetch('../data.json', { cache: 'no-cache' });
    state.data = await res.json();
    status(`${Object.keys(state.data.celebs).length}명 로드됨`);
  } catch (e) {
    status('data.json 로드 실패');
    console.error(e);
    return;
  }
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
    box.classList.remove('hidden');
    active = -1;
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
    if (e.key === 'ArrowDown') { active = Math.min(active + 1, items.length - 1); }
    else if (e.key === 'ArrowUp') { active = Math.max(active - 1, 0); }
    else if (e.key === 'Enter') { if (active >= 0) pick(items[active]); return; }
    else return;
    e.preventDefault();
    $$('li', box).forEach((li, i) => li.classList.toggle('active', i === active));
  });
  box.addEventListener('click', (e) => {
    const li = e.target.closest('li[data-name]');
    if (li) pick(li.dataset.name);
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-wrap')) box.classList.add('hidden');
  });

  function pick(name) {
    box.classList.add('hidden');
    input.value = name;
    selectCeleb(name);
  }
}

/* ========================================================
   인물 선택
   ======================================================== */
function selectCeleb(name) {
  state.name = name;
  state.celeb = state.data.celebs[name];
  state.customImage = null;
  const dn = displayName(name);

  state.opts.title = `${dn}의 책장`;
  state.opts.subtitle = `${josa(dn, '이', '가')} 읽고 추천한 책`;
  $('#optTitle').value = state.opts.title;
  $('#optSubtitle').value = state.opts.subtitle;

  state.books = state.celeb.books.map((ref, i) => {
    const d = detectSource(ref.source);
    return {
      ref,
      selected: i < DEFAULT_SELECT,
      quote: (ref.comment || '').trim(),
      srcName: d.name,
      srcType: d.type,
      srcDate: d.date,
    };
  });

  // 패널
  $('#celebBlock').classList.remove('hidden');
  $('#optsBlock').classList.remove('hidden');
  $('#booksBlock').classList.remove('hidden');
  $('#celebThumb').src = proxify(state.celeb.imageUrl);
  $('#celebName').textContent = name;
  $('#celebCount').textContent = `책 ${state.celeb.books.length}권`;
  $('#zipBtn').disabled = false;

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
        ${b.quote ? '<span class="badge-on">대목</span>' : ''}
        <span class="caret">▸</span>
      </div>
      <div class="book-edit">
        <label class="field">
          <span>언급 대목 (인용문) ${r.source ? `· <a class="src-open" href="${esc(cleanUrl(r.source))}" target="_blank" rel="noreferrer">출처 열기 ↗</a>` : ''}</span>
          <textarea class="bk-quote" rows="3" placeholder="이 인물이 책을 언급/추천한 문장을 붙여넣으세요">${esc(b.quote)}</textarea>
        </label>
        <div class="row3">
          <label class="field"><span>매체명</span><input class="bk-name" type="text" value="${esc(b.srcName)}"></label>
          <label class="field"><span>유형</span><input class="bk-type" type="text" list="srcTypes" value="${esc(b.srcType)}"></label>
        </div>
        <label class="field"><span>날짜 (예: 2024.05.12)</span><input class="bk-date" type="text" value="${esc(b.srcDate)}"></label>
      </div>
    </li>`;
  }).join('') + `<datalist id="srcTypes">
      <option>매거진</option><option>인터뷰</option><option>신문</option><option>방송</option>
      <option>영상</option><option>SNS</option><option>커뮤니티</option><option>블로그</option>
      <option>도서플랫폼</option><option>웹</option></datalist>`;

  $$('.book-item', ul).forEach((li) => {
    const i = +li.dataset.i, b = state.books[i];
    li.querySelector('.book-head').addEventListener('click', (e) => {
      if (e.target.classList.contains('bk-sel')) return;
      li.classList.toggle('open');
    });
    li.querySelector('.bk-sel').addEventListener('change', (e) => {
      b.selected = e.target.checked; renderPreview();
    });
    const reflectBadge = () => {
      const head = li.querySelector('.book-head');
      let badge = head.querySelector('.badge-on');
      if (b.quote && !badge) { badge = document.createElement('span'); badge.className = 'badge-on'; badge.textContent = '대목'; head.insertBefore(badge, head.querySelector('.caret')); }
      else if (!b.quote && badge) badge.remove();
    };
    li.querySelector('.bk-quote').addEventListener('input', (e) => { b.quote = e.target.value; reflectBadge(); renderPreview(); });
    li.querySelector('.bk-name').addEventListener('input', (e) => { b.srcName = e.target.value; renderPreview(); });
    li.querySelector('.bk-type').addEventListener('input', (e) => { b.srcType = e.target.value; renderPreview(); });
    li.querySelector('.bk-date').addEventListener('input', (e) => { b.srcDate = e.target.value; renderPreview(); });
  });
}

/* ========================================================
   옵션 바인딩
   ======================================================== */
function bindOptions() {
  $('#optTitle').addEventListener('input', (e) => { state.opts.title = e.target.value; renderPreview(); });
  $('#optSubtitle').addEventListener('input', (e) => { state.opts.subtitle = e.target.value; renderPreview(); });
  $('#optHandle').addEventListener('input', (e) => { state.opts.handle = e.target.value; renderPreview(); });
  $$('input[name=format]').forEach((r) => r.addEventListener('change', () => {
    state.opts.format = $$('input[name=format]').find((x) => x.checked).value; renderPreview();
  }));
  $('#optMono').addEventListener('change', (e) => { state.opts.mono = e.target.checked; renderPreview(); });
  $('#optOutro').addEventListener('change', (e) => { state.opts.outro = e.target.checked; renderPreview(); });
  $('#optProxy').addEventListener('change', (e) => { state.opts.proxy = e.target.checked; if (state.celeb) { $('#celebThumb').src = proxify(state.celeb.imageUrl); renderBookList(); } renderPreview(); });

  $('#selAll').addEventListener('click', () => { state.books.forEach((b) => b.selected = true); renderBookList(); renderPreview(); });
  $('#selNone').addEventListener('click', () => { state.books.forEach((b) => b.selected = false); renderBookList(); renderPreview(); });

  $('#celebUpload').addEventListener('change', (e) => {
    const f = e.target.files[0]; if (!f) return;
    const fr = new FileReader();
    fr.onload = () => { state.customImage = fr.result; $('#celebThumb').src = fr.result; renderPreview(); };
    fr.readAsDataURL(f);
  });

  $('#zipBtn').addEventListener('click', exportZip);
}

/* ========================================================
   카드 슬라이드 생성
   ======================================================== */
function dims() {
  return state.opts.format === 'square' ? [1080, 1080] : [1080, 1350];
}
function selectedBooks() { return state.books.filter((b) => b.selected); }

function coverHTML() {
  const dn = displayName(state.name);
  const n = selectedBooks().length;
  const img = state.customImage || proxify(state.celeb.imageUrl);
  return `<div class="cn-pad cn-cover">
    <div class="cn-top"><span class="cn-kicker">Reading List</span><span class="cn-kicker">Favoread</span></div>
    <h1 class="cn-title">${esc(state.opts.title)}</h1>
    ${state.opts.subtitle ? `<div class="cn-sub">${esc(state.opts.subtitle)}</div>` : ''}
    <div class="cn-photo"><img src="${esc(img)}" crossorigin="anonymous" referrerpolicy="no-referrer"></div>
    <div class="cn-foot"><span>${esc(state.name)}</span><span class="cn-cnt">${String(n).padStart(2, '0')} BOOKS</span></div>
  </div>`;
}

function bookHTML(b, idx, total) {
  const r = b.ref;
  const [, h] = dims();
  const ch = state.opts.format === 'square' ? 360 : 470;
  const cw = Math.round(ch * 0.66);
  const cite = citeParts(b);
  const quote = b.quote
    ? `<div class="cn-quote"><span class="qmark">“</span><p>${esc(b.quote)}</p></div>`
    : `<div class="cn-quote empty"><span class="qmark">“</span><p>${esc(displayName(state.name))}의 책장에 놓인 한 권.</p></div>`;
  return `<div class="cn-pad cn-book">
    <div class="cn-top">
      <span class="cn-big-num"><span class="cn-num-lat">${String(idx).padStart(2, '0')}</span> / ${String(total).padStart(2, '0')}</span>
      <span class="cn-kicker">Book</span>
    </div>
    <div class="cn-body">
      <div class="cn-cover-img" style="width:${cw}px;height:${ch}px">
        <img src="${esc(proxify(r.coverUrl))}" crossorigin="anonymous" referrerpolicy="no-referrer">
      </div>
      <h2 class="cn-bk-title">${esc(r.title)}</h2>
      <div class="cn-bk-meta">${esc(r.author || '')}${r.publisher ? ' · ' + esc(r.publisher) : ''}</div>
      ${quote}
    </div>
    ${cite ? `<div class="cn-src"><span class="cn-src-lab">Source</span><span class="cn-cite">${cite}</span></div>` : ''}
  </div>`;
}

function outroHTML() {
  const list = selectedBooks().map((b, i) => {
    const c = citeText(b) || '출처 미상';
    return `<li><span class="n">${String(i + 1).padStart(2, '0')}</span>
      <span class="t"><b>《${esc(b.ref.title)}》</b> — ${esc(c)}</span></li>`;
  }).join('');
  return `<div class="cn-pad cn-outro">
    <div class="cn-top"><span class="cn-kicker">Sources</span><span class="cn-kicker">Favoread</span></div>
    <h2 class="cn-otitle">기록의 출처</h2>
    <div class="cn-osub">언급과 추천이 확인된 곳들</div>
    <ul class="cn-srclist">${list}</ul>
    <div class="cn-foot"><span class="h">${esc(displayName(state.name))}의 독서</span><span class="g">${esc(state.opts.handle)}</span></div>
  </div>`;
}

function buildSlides() {
  const slides = [];
  const sel = selectedBooks();
  slides.push({ name: 'cover', html: coverHTML() });
  sel.forEach((b, i) => slides.push({ name: `book${i + 1}`, html: bookHTML(b, i + 1, sel.length) }));
  if (state.opts.outro && sel.length) slides.push({ name: 'sources', html: outroHTML() });
  return slides;
}

function makeSlideEl(html) {
  const el = document.createElement('div');
  el.className = 'cn-slide' + (state.opts.format === 'square' ? ' square' : '') + (state.opts.mono ? ' cn-mono' : '');
  el.innerHTML = html;
  return el;
}

/* ========================================================
   미리보기 렌더
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
    frame.style.width = `${w * s}px`;
    frame.style.height = `${h * s}px`;
    frame.appendChild(el);

    const bar = document.createElement('div');
    bar.className = 'slide-bar';
    const labels = { cover: '표지', sources: '출처 모음' };
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
   내보내기 (html2canvas)
   ======================================================== */
function waitForImages(node, timeout = 9000) {
  const imgs = $$('img', node);
  return Promise.all(imgs.map((img) => {
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
  } finally {
    holder.remove();
  }
}

function safeName(s) { return String(s).replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, '_'); }

function canvasToBlob(canvas) {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

async function exportOne(sl, i) {
  status('PNG 만드는 중…');
  try {
    const canvas = await slideToCanvas(sl);
    const blob = await canvasToBlob(canvas);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${safeName(displayName(state.name))}_${String(i + 1).padStart(2, '0')}_${sl.name}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    status('완료');
  } catch (e) {
    console.error(e); status('저장 실패 (프록시를 켜고 다시 시도해 보세요)');
  }
}

async function exportZip() {
  if (!state.celeb) return;
  const slides = buildSlides();
  const zip = new JSZip();
  const base = safeName(displayName(state.name));
  for (let i = 0; i < slides.length; i++) {
    status(`PNG ${i + 1}/${slides.length} 만드는 중…`);
    const canvas = await slideToCanvas(slides[i]);
    const blob = await canvasToBlob(canvas);
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

boot();
