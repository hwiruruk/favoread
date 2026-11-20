/* 책장 이미지 저장 — 선택한 연예인의 책등만 세워 PNG로 저장한다.
 * 배경은 투명, 이름·워터마크·선반선 등 다른 요소는 일절 넣지 않는다.
 *   인스타그램  1080 × 1350 (4:5 세로)
 *   X(트위터)   1600 ×  900 (16:9 가로)
 * html2canvas 없이 canvas로 직접 그린다. app.js 의 State·$·toast 를 쓰므로 app.js 뒤에 불러온다.
 * 책등 사진은 예스24 `/goods/{번호}/side`(표지 URL에서 번호를 얻음)이고, 없거나 못 불러오면
 * 표지 대표색(data/cover_colors.json)으로 칠한 색 책등에 제목을 세로로 얹는다.
 * 규칙은 generate.py 의 책등(.sp)과 같다.
 */
(function () {
  const FORMATS = {
    insta: { w: 1080, h: 1350, label: '인스타그램', head: 60, foot: 60, maxSpine: 760, pad: 50 },
    x:     { w: 1600, h: 900,  label: 'X',          head: 50, foot: 50, maxSpine: 700, pad: 60 },
  };
  const PROXY = 'https://images.weserv.nl/?url=';   // 예스24 이미지에 CORS가 없어 canvas가 막히므로 거친다
  const SPINE_MAX_RATIO = 0.4;                      // 이보다 넙적하면 '이미지 준비중' 안내 그림
    const SERIF = '"KoPubWorld Batang","Noto Serif KR",Batang,serif';

  let extra = null;   // { spines: {제목: URL}, colors: {표지 URL: '#rrggbb'} }

  async function loadExtra() {
    if (extra) return extra;
    extra = { spines: {}, colors: {} };
    try {
      const r = await fetch('../data/spines.json', { cache: 'no-cache' });
      if (r.ok) {
        const d = await r.json();
        for (const [t, v] of Object.entries(d.spines || {})) {
          const u = spineValue(v);
          if (u) extra.spines[String(t).trim()] = u;
        }
      }
    } catch (e) { /* 없으면 표지 URL에서만 유도 */ }
    try {
      const r = await fetch('../data/cover_colors.json', { cache: 'no-cache' });
      if (r.ok) extra.colors = (await r.json()).colors || {};
    } catch (e) { /* 없으면 제목으로 만든 색 */ }
    return extra;
  }

  function spineValue(v) {
    v = String(v || '').trim();
    if (/^\d+$/.test(v)) return 'https://image.yes24.com/goods/' + v + '/side';
    const m = /yes24\.com\/(?:product\/)?goods\/(?:detail\/)?(\d+)/i.exec(v);
    if (m) return 'https://image.yes24.com/goods/' + m[1] + '/side';
    return /^https?:/.test(v) ? v : '';
  }
  function yes24Spine(cover) {
    const m = /image\.yes24\.com\/goods\/(?:detail\/)?(\d+)/i.exec(cover || '');
    return m ? 'https://image.yes24.com/goods/' + m[1] + '/side' : '';
  }
  function hashOf(s, mul) {
    let h = 0;
    for (const ch of String(s || '')) h = (Math.imul(h, mul) + ch.codePointAt(0)) >>> 0;
    return h;
  }
  function tint(title) {
    const h = hashOf(title, 31);
    return `hsl(${h % 360},${32 + (h >>> 9) % 26}%,${26 + (h >>> 17) % 22}%)`;
  }
  function isLight(hex) {
    const m = /^#([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return false;
    const lin = [0, 2, 4].map((i) => {
      const c = parseInt(m[1].slice(i, i + 2), 16) / 255;
      return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2] > 0.4;
  }
  // 본제목만 — 부제와 끝의 판형 표기는 뗀다 (generate.py spine_title)
  function spineTitle(t) {
    t = String(t || '').trim();
    t = t.split(/\s+[-–—]\s+/)[0].replace(/\s*[(\[][^)\]]*[)\]]\s*$/, '').trim();
    return t || String(t || '');
  }

  function loadImage(url) {
    return new Promise((resolve) => {
      const im = new Image();
      im.crossOrigin = 'anonymous';
      let done = false;
      const fin = (v) => { if (!done) { done = true; resolve(v); } };
      im.onload = () => fin(im.naturalWidth && im.naturalHeight ? im : null);
      im.onerror = () => fin(null);
      setTimeout(() => fin(null), 10000);
      im.src = PROXY + encodeURIComponent(url.replace(/^https?:\/\//i, '')) + '&output=png';
    });
  }

  /* 책 하나 → { title, color, light, img|null, ratio } */
  async function prepare(books, ex) {
    return Promise.all(books.map(async (b) => {
      const title = spineTitle(b.title);
      const url = ex.spines[String(b.title || '').trim()] || yes24Spine(b.cover);
      let img = null;
      if (url) {
        img = await loadImage(url);
        if (img && img.naturalWidth / img.naturalHeight > SPINE_MAX_RATIO) img = null;
      }
      const cc = ex.colors[b.cover];
      const color = cc || tint(b.title);
      return {
        title, img, color, light: !!cc && isLight(cc),
        ratio: img ? img.naturalWidth / img.naturalHeight : (24 + hashOf(title, 13) % 10) / 310,
      };
    }));
  }

  /* 책등 높이를 키워 보며 가장 큰 높이로 줄을 나눈다 */
  function layout(items, fmt) {
    const availW = fmt.w - fmt.pad * 2;
    const availH = fmt.h - fmt.head - fmt.foot;
    const gap = 4, rowGap = 40;
    for (let H = fmt.maxSpine; H >= 90; H -= 6) {
      const rows = [];
      let row = [], rw = 0;
      for (const it of items) {
        const w = Math.max(14, Math.round(it.ratio * H));
        if (row.length && rw + gap + w > availW) { rows.push({ cells: row, w: rw }); row = []; rw = 0; }
        rw += (row.length ? gap : 0) + w;
        row.push({ it, w });
      }
      if (row.length) rows.push({ cells: row, w: rw });
      const total = rows.length * H + (rows.length - 1) * rowGap;
      if (total <= availH) return { rows, H, gap, rowGap, total, availH };
    }
    return null;
  }

  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h); ctx.lineTo(x, y + h); ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
  }

  /* 세로 제목 — 한글은 똑바로 쌓고, 라틴·숫자 묶음은 시계 방향으로 눕힌다 */
  function drawVertical(ctx, text, cx, top, maxLen, w, color) {
    const runs = [];
    for (const ch of text) {
      const cjk = ch.codePointAt(0) > 0x2E7F;
      const last = runs[runs.length - 1];
      if (last && last.cjk === cjk && !cjk) last.s += ch; else runs.push({ cjk, s: ch });
    }
    let size = Math.max(11, Math.min(Math.round(w * 0.42), 34));
    const lenAt = (fs) => {
      ctx.font = `300 ${fs}px ${SERIF}`;
      let n = 0;
      for (const r of runs) n += r.cjk ? fs * 1.18 : (r.s.trim() ? ctx.measureText(r.s).width + fs * 0.2 : fs * 0.45);
      return n;
    };
    while (size > 9 && lenAt(size) > maxLen) size -= 1;
    ctx.font = `300 ${size}px ${SERIF}`;
    ctx.fillStyle = color;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    let y = top;
    for (const r of runs) {
      if (!r.cjk && !r.s.trim()) {
        y += size * 0.45;                       // 띄어쓰기는 좁은 틈만
      } else if (r.cjk) {
        ctx.fillText(r.s, cx, y + size * 0.59);
        y += size * 1.18;
      } else {
        const len = ctx.measureText(r.s).width;
        ctx.save();
        ctx.translate(cx, y + len / 2);
        ctx.rotate(Math.PI / 2);
        ctx.fillText(r.s, 0, 0);
        ctx.restore();
        y += len + size * 0.2;
      }
    }
  }

  function drawSpine(ctx, c, x, y, H) {
    const { it, w } = c;
    ctx.save();
    rr(ctx, x, y, w, H, 3);
    ctx.clip();
    if (it.img) {
      ctx.drawImage(it.img, x, y, w, H);
    } else {
      ctx.fillStyle = it.color;
      ctx.fillRect(x, y, w, H);
      // 은은한 입체감 — 좌우 가장자리만 살짝
      const g = ctx.createLinearGradient(x, 0, x + w, 0);
      g.addColorStop(0, 'rgba(255,255,255,.10)');
      g.addColorStop(.18, 'rgba(255,255,255,0)');
      g.addColorStop(.82, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(0,0,0,.14)');
      ctx.fillStyle = g;
      ctx.fillRect(x, y, w, H);
      drawVertical(ctx, it.title, x + w / 2, y + 16, H - 32, w, it.light ? '#111' : '#fff');
    }
    ctx.restore();
  }

  async function render(kind, celebName, books) {
    const fmt = FORMATS[kind];
    const ex = await loadExtra();
    if (document.fonts && document.fonts.load) {
      try {
        await Promise.all([
          document.fonts.load(`300 20px "KoPubWorld Batang"`, '가나다abc'),
          document.fonts.load(`700 20px "KoPubWorld Batang"`, '가나다abc'),
        ]);
      } catch (e) { /* 폰트 없으면 대체 폰트 */ }
    }
    const items = await prepare(books, ex);
    const lay = layout(items, fmt);
    if (!lay) throw new Error('책이 너무 많아 한 장에 담기지 않습니다 (' + books.length + '권)');

    const cv = document.createElement('canvas');
    cv.width = fmt.w; cv.height = fmt.h;
    const ctx = cv.getContext('2d');
    // 원본 책등 사진(높이 약 1200px)을 크게 줄여 그리므로 고품질 보간을 켠다 (기본값은 low라 계단이 생김)
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    // 책장
    const top = fmt.head + (lay.availH - lay.total) / 2;
    lay.rows.forEach((row, ri) => {
      const y = top + ri * (lay.H + lay.rowGap);
      let x = Math.round((fmt.w - row.w) / 2);
      for (const c of row.cells) {
        drawSpine(ctx, c, x, y, lay.H);
        x += c.w + lay.gap;
      }
    });

    return { canvas: cv, fmt, missing: items.filter((i) => !i.img).length };
  }

  const safe = (s) => String(s).replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, '_');

  async function save(kind) {
    const name = State.selected;
    const c = name && State.celebs.get(name);
    if (!c || !c.books.length) { toast('책이 있는 연예인을 먼저 선택하세요', 'err'); return; }
    const btns = $$('.shelf-save');
    btns.forEach((b) => { b.disabled = true; });
    setStatus('책장 이미지 만드는 중… (책등 사진을 불러옵니다)');
    try {
      const { canvas, fmt, missing } = await render(kind, c.name, c.books);
      const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${safe(c.name)}_책장_${kind === 'insta' ? '인스타' : 'X'}_${fmt.w}x${fmt.h}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      toast(`${fmt.label} 책장 저장 완료 · 색 책등 ${missing}권`, 'ok');
    } catch (e) {
      console.error(e);
      toast('저장 실패: ' + e.message, 'err');
    } finally {
      btns.forEach((b) => { b.disabled = false; });
      setStatus('');
    }
  }

  document.addEventListener('click', (e) => {
    const b = e.target.closest('.shelf-save');
    if (b) save(b.dataset.kind);
  });
})();
