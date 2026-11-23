/*
 * 셀럽·책 하트 버튼
 *
 * 페이지에 <button class="heart-btn" data-heart="c:이름" hidden> 을 두면
 * 이 스크립트가 하트 수를 불러와 보여 주고, 누르면 하트를 넣거나 뺀다.
 * 키는 셀럽이면 "c:" + 한국어 이름, 책이면 "b:" + 한국어 제목.
 *
 * 누를 수 없는 숫자만 보여 줄 때는 <span class="heart-count" data-heart-count="c:이름" hidden>
 * 을 둔다 (메인 카드). 셀럽 숫자는 /celebs 한 번으로 전부 받아 온다.
 *
 * 서버는 tools/hearts-worker/ 의 Cloudflare Worker다.
 * 아래 API가 비어 있으면 아무것도 하지 않고 버튼도 숨긴 채로 둔다.
 */
(function () {
  'use strict';

  // 배포한 하트 Worker 주소를 여기에 넣는다 (예: https://favorbook-hearts.<계정>.workers.dev)
  var HEARTS_API = 'https://favorbook-hearts.twinwhee.workers.dev';

  var API = window.FAVOR_HEARTS_API || HEARTS_API;
  if (!API) return;
  API = API.replace(/\/+$/, '');

  var MINE_KEY = 'favorbook-hearts';
  var VOTER_KEY = 'favorbook-voter';

  function load(k) {
    try { return window.localStorage.getItem(k); } catch (e) { return null; }
  }
  function save(k, v) {
    try { window.localStorage.setItem(k, v); } catch (e) {}
  }

  var mine = {};
  try {
    (JSON.parse(load(MINE_KEY) || '[]') || []).forEach(function (k) { mine[k] = true; });
  } catch (e) {}

  function saveMine() { save(MINE_KEY, JSON.stringify(Object.keys(mine))); }

  // '내 하트' 서랍에서 책을 셀럽별로 묶으려고, 하트를 누른 때와 그때 보던 셀럽을 따로 적어 둔다.
  // {키: [셀럽 이름 또는 '', 누른 시각]}. 예전에 누른 하트에는 없으므로 서랍에서 짐작해 묶는다.
  var META_KEY = 'favorbook-hearts-meta';
  var meta = {};
  try { meta = JSON.parse(load(META_KEY) || '{}') || {}; } catch (e) {}

  function saveMeta() {
    var keep = {};
    Object.keys(meta).forEach(function (k) { if (mine[k]) keep[k] = meta[k]; });
    meta = keep;
    save(META_KEY, JSON.stringify(meta));
  }

  // 책 하트를 누른 곳의 셀럽. 버튼에 data-heart-celeb이 있으면 그것을, 없으면
  // 셀럽 페이지 머리의 셀럽 하트 버튼을 본다. 책 페이지처럼 셀럽이 없으면 ''.
  function contextCeleb(btn) {
    if (btn.hasAttribute('data-heart-celeb')) return btn.getAttribute('data-heart-celeb');
    var c = document.querySelector('.heart-row .heart-btn[data-heart^="c:"]');
    return c ? c.getAttribute('data-heart').slice(2) : '';
  }

  function voterId() {
    var v = load(VOTER_KEY);
    if (v && /^[A-Za-z0-9-]{16,64}$/.test(v)) return v;
    if (window.crypto && crypto.randomUUID) {
      v = crypto.randomUUID();
    } else {
      v = '';
      for (var i = 0; i < 32; i++) v += Math.floor(Math.random() * 16).toString(16);
    }
    save(VOTER_KEY, v);
    return v;
  }

  var counts = {};
  var pending = {};

  var css =
    '.heart-row{margin:10px 0 0}'
    + '.heart-btn{display:inline-flex;align-items:center;justify-content:center;gap:5px;'
    + 'padding:5px 11px;border:1px solid var(--border,#000);background:var(--bg,#fff);box-shadow:none;'
    + 'font:800 13px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--ink,#000);'
    + 'cursor:pointer;transition:transform .1s,box-shadow .1s,background .1s;vertical-align:middle}'
    + '.heart-btn[hidden]{display:none}'
    + '.heart-btn:hover{transform:translate(-1px,-1px);box-shadow:none;background:var(--card,#fbcfe8)}'
    + '.heart-btn:active{transform:none;box-shadow:none}'
    + '.heart-btn.on{background:var(--card,#fbcfe8)}'
    + '.heart-btn .heart-ico{font-size:15px;line-height:1;color:#e11d48}'
    + '.heart-btn .heart-n{min-width:1ch;font-variant-numeric:tabular-nums}'
    + '.heart-btn.sm{padding:3px 8px;font-size:12px;box-shadow:none;border-width:1.5px}'
    + '.heart-btn.sm .heart-ico{font-size:13px}'
    + '.heart-btn.pop .heart-ico{animation:heart-pop .35s ease-out}'
    + '.heart-count{display:inline-flex;align-items:center;gap:3px;font:800 12px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;'
    + 'color:#e11d48;font-variant-numeric:tabular-nums;white-space:nowrap}'
    + '.heart-count[hidden]{display:none}'
    + '@media (min-width:640px){.heart-count{font-size:14px}}'
    + '.heart-count::before{content:"\\2665"}'
    + '@keyframes heart-pop{0%{transform:scale(1)}40%{transform:scale(1.45)}100%{transform:scale(1)}}'
    // 책장 이미지 저장 중에는 그림에 찍히지 않게 숨긴다
    + '.is-capturing .heart-btn{display:none!important}'
    + '@media (prefers-reduced-motion:reduce){.heart-btn.pop .heart-ico{animation:none}}';
  var style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  var EN = /^en/i.test(document.documentElement.lang || '');

  function fmt(n) {
    if (EN) return n >= 1000 ? (Math.round(n / 100) / 10) + 'k' : String(n);
    return n >= 10000 ? (Math.round(n / 1000) / 10) + '만' : String(n);
  }

  function render(btn) {
    var key = btn.getAttribute('data-heart');
    var on = !!mine[key];
    // 캐시된 숫자가 내 하트를 아직 못 셌을 수 있다
    var n = Math.max(counts[key] || 0, on ? 1 : 0);
    var ico = btn.querySelector('.heart-ico');
    var num = btn.querySelector('.heart-n');
    if (ico) ico.textContent = on ? '♥' : '♡';
    if (num) num.textContent = fmt(n);
    btn.classList.toggle('on', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  function renderCount(el) {
    var key = el.getAttribute('data-heart-count');
    var n = Math.max(counts[key] || 0, mine[key] ? 1 : 0);
    el.textContent = fmt(n);
    el.hidden = !n;
    el.setAttribute('aria-label', (EN ? 'Hearts ' : '하트 ') + n);
  }

  function renderKey(key) {
    Array.prototype.forEach.call(document.querySelectorAll('.heart-btn[data-heart]'), function (b) {
      if (b.getAttribute('data-heart') === key) render(b);
    });
    Array.prototype.forEach.call(document.querySelectorAll('.heart-count[data-heart-count]'), function (el) {
      if (el.getAttribute('data-heart-count') === key) renderCount(el);
    });
  }

  function post(path, body) {
    return fetch(API + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(function (r) {
      if (!r.ok) throw new Error('hearts ' + r.status);
      return r.json();
    });
  }

  // 모든 셀럽의 하트 수. 서버와 브라우저에서 잠깐 캐시되므로 방문자가 많아도 가볍다.
  var celebsLoaded = null;
  function loadCelebs() {
    if (!celebsLoaded) {
      celebsLoaded = fetch(API + '/celebs').then(function (r) {
        if (!r.ok) throw new Error('hearts ' + r.status);
        return r.json();
      }).then(function (d) {
        var c = d.counts || {};
        Object.keys(c).forEach(function (k) { if (!pending[k]) counts[k] = c[k]; });
        return true;
      }).catch(function () { celebsLoaded = null; return false; });
    }
    return celebsLoaded;
  }

  // 숫자만 보여 주는 칸을 채운다. 셀럽 목록에 없는(하트 0) 셀럽은 0으로 둔다.
  function scanCounts(root) {
    var els = (root || document).querySelectorAll('.heart-count[data-heart-count]');
    if (!els.length) return;
    loadCelebs().then(function (ok) {
      Array.prototype.forEach.call(els, function (el) {
        var key = el.getAttribute('data-heart-count');
        if (ok && !(key in counts)) counts[key] = 0;
        renderCount(el);
      });
    });
  }

  // root 안의 하트 버튼을 보이게 하고 하트 수를 불러온다.
  // 모달처럼 나중에 data-heart가 바뀌는 곳에서도 다시 부르면 된다.
  function scan(root) {
    scanCounts(root);
    var btns = (root || document).querySelectorAll('.heart-btn[data-heart]');
    var ask = {};
    Array.prototype.forEach.call(btns, function (b) {
      var key = b.getAttribute('data-heart');
      if (!key) return;
      b.hidden = false;
      render(b);
      if (!(key in counts)) ask[key] = true;
    });
    var keys = Object.keys(ask);
    for (var i = 0; i < keys.length; i += 300) {
      (function (chunk) {
        post('/counts', { keys: chunk }).then(function (d) {
          chunk.forEach(function (k) {
            counts[k] = (d.counts && d.counts[k]) || 0;
            renderKey(k);
          });
        }).catch(function () {});
      })(keys.slice(i, i + 300));
    }
  }

  // 하트를 넣거나 뺀다. metaVal은 넣을 때 적어 둘 [보던 셀럽, 누른 시각].
  function setHeart(key, on, metaVal) {
    if (!key || pending[key] || !!mine[key] === on) return false;
    var before = counts[key] || 0;
    var metaBefore = meta[key];

    // 먼저 화면을 바꾸고 서버 응답으로 맞춘다
    if (on) {
      mine[key] = true;
      meta[key] = metaVal || ['', Date.now()];
    } else delete mine[key];
    counts[key] = Math.max(before + (on ? 1 : -1), 0);
    saveMine();
    saveMeta();
    renderKey(key);

    pending[key] = true;
    post('/heart', { key: key, voter: voterId(), on: on }).then(function (d) {
      if (typeof d.n === 'number') counts[key] = d.n;
    }).catch(function () {
      if (on) delete mine[key]; else mine[key] = true;
      if (metaBefore) meta[key] = metaBefore;
      counts[key] = before;
      saveMine();
      saveMeta();
    }).then(function () {
      delete pending[key];
      renderKey(key);
      renderFab();
    });
    renderFab();

    if (on && typeof window.gtag === 'function') {
      try { window.gtag('event', 'heart', { item: key }); } catch (e) {}
    }
    return true;
  }

  function toggle(btn) {
    var key = btn.getAttribute('data-heart');
    if (!key) return;
    var on = !mine[key];
    if (!setHeart(key, on, [key.charAt(0) === 'b' ? contextCeleb(btn) : '', Date.now()])) return;
    if (on) {
      btn.classList.remove('pop');
      void btn.offsetWidth;
      btn.classList.add('pop');
    }
  }

  document.addEventListener('click', function (e) {
    var btn = e.target.closest && e.target.closest('.heart-btn[data-heart]');
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    toggle(btn);
  }, true);

  // ── 내 하트 서랍 ──────────────────────────────────────────────────
  //
  // 이 브라우저에서 하트를 누른 셀럽과 책을 장바구니처럼 모아 본다.
  // 책은 하트를 누를 때 보던 셀럽 아래에 묶고, 그 기록이 없으면
  // 하트한 셀럽 중 그 책을 읽은 사람 → 읽은 사람이 한 명뿐이면 그 사람 순으로 짐작한다.
  // 여러 셀럽이 읽은 책을 책 페이지에서 담았으면 '여러 셀럽이 읽은 책'으로 따로 둔다.
  // 셀럽·책 정보는 서랍을 처음 열 때 /data.json에서 한 번 읽는다.

  var T = EN ? {
    fab: 'My shelf', title: 'My shelf', close: 'Close', empty: 'Nothing here yet. Tap ♡ on a celeb or a book to keep it here.',
    note: 'Saved only in this browser. It won’t show on other devices or browsers, and clearing this site’s data will delete it. Use Save image or Copy text to keep a backup.',
    saveImg: 'Save image', making: 'Making…', savedImg: 'Saved!', copyTxt: 'Copy text', copyMd: 'Copy Markdown', copied: 'Copied!', loading: 'Loading…',
    shelfTitle: 'My bookshelf', counts: function (c, b) { return (c ? c + (c === 1 ? ' celeb · ' : ' celebs · ') : '') + b + (b === 1 ? ' book' : ' books'); },
    imgFail: 'Could not make the image. Please try again.', brand: 'Favorbook', site: 'https://favorbook.co.kr/en/', siteShort: 'favorbook.co.kr/en',
    asOf: 'as of', sharedMd: 'Read by several celebs', cont: ' (cont.)',
    fail: 'Could not load the list. Please try again later.', shared: 'Books read by several celebs',
    del: 'Remove', delAll: 'Remove all', undo: 'Undo',
    removed: function (what) { return 'Removed “' + what + '”'; },
    books: function (n) { return n + (n === 1 ? ' book' : ' books'); },
    readBy: function (names, more) { return 'Read by ' + names.join(', ') + (more ? ' +' + more : ''); },
  } : {
    fab: '내 책장', title: '내 책장', close: '닫기', empty: '아직 담긴 게 없어요. 셀럽이나 책의 ♡를 누르면 여기에 담겨요.',
    note: '이 브라우저에만 저장돼요. 다른 기기나 다른 브라우저에서는 보이지 않고, 브라우저의 사이트 데이터(방문 기록·쿠키 등)를 지우면 사라져요. 중요한 목록은 ‘이미지 저장’이나 ‘텍스트 복사’로 따로 보관해 두세요.',
    saveImg: '이미지 저장', making: '만드는 중…', savedImg: '저장했어요', copyTxt: '텍스트 복사', copyMd: '마크다운 복사', copied: '복사했어요', loading: '불러오는 중…',
    shelfTitle: '내 책장', counts: function (c, b) { return (c ? '셀럽 ' + c + '명 · ' : '') + '책 ' + b + '권'; },
    imgFail: '이미지를 만들지 못했어요. 잠시 후 다시 시도해 주세요.', brand: '최애의 독서', site: 'https://favorbook.co.kr/', siteShort: 'favorbook.co.kr',
    asOf: '기준', sharedMd: '여러 셀럽이 읽은 책', cont: ' (이어서)',
    fail: '목록을 불러오지 못했어요. 잠시 후 다시 열어 주세요.', shared: '여러 셀럽이 읽은 책',
    del: '빼기', delAll: '모두 빼기', undo: '되돌리기',
    removed: function (what) { return '‘' + what + '’ 뺐어요'; },
    books: function (n) { return '책 ' + n + '권'; },
    readBy: function (names, more) { return names.join(', ') + (more ? ' 외 ' + more + '명' : '') + ' 읽음'; },
  };

  css =
    '.mh-fab{position:fixed;left:16px;bottom:16px;z-index:45;display:inline-flex;align-items:center;gap:6px;'
    + 'padding:9px 14px;border:1px solid var(--border,#000);background:var(--card,#fbcfe8);box-shadow:none;color:var(--ink,#000);'
    + 'font:800 14px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;cursor:pointer}'
    + '.mh-fab[hidden]{display:none}'
    + '.mh-fab:hover{transform:translate(-1px,-1px);box-shadow:none}'
    + '.mh-fab .mh-ico{color:#e11d48;font-size:16px;line-height:1}'
    + '.mh-fab .mh-n{min-width:1ch;padding:2px 6px;background:var(--ink,#000);color:var(--bg,#fff);font-size:12px;font-variant-numeric:tabular-nums}'
    + '.mh-bg{position:fixed;inset:0;z-index:60;background:rgba(0,0,0,.45)}'
    + '.mh-bg[hidden]{display:none}'
    + '.mh-panel{position:absolute;top:0;right:0;bottom:0;width:min(420px,100%);display:flex;flex-direction:column;'
    + 'background:var(--bg,#fff);border-left:1px solid var(--border,#000);box-shadow:-8px 0 24px rgb(0 0 0 / .12);color:var(--ink,#000);'
    + 'font:15px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}'
    // 페이지의 h2·ul·img 스타일이 서랍 안으로 번지지 않게 한다
    + '.mh-panel *{box-sizing:border-box}'
    + '.mh-panel h2{border:0;padding:0;letter-spacing:normal;text-transform:none}'
    + '.mh-panel img{max-width:none}'
    + '.mh-head{display:flex;align-items:center;gap:8px;padding:14px 16px;border-bottom:1px solid var(--border,#000);background:var(--card,#fbcfe8)}'
    + '.mh-head h2{margin:0;flex:1;font-size:18px;font-weight:900}'
    + '.mh-head h2 span{color:#e11d48}'
    + '.mh-btn{padding:6px 10px;border:1px solid var(--border,#000);background:var(--bg,#fff);box-shadow:none;color:var(--ink,#000);'
    + 'font-weight:800;font-size:12px;line-height:1;font-family:inherit;cursor:pointer}'
    + '.mh-btn:hover{background:var(--hover,#fef08a)}'
    + '.mh-x{width:34px;height:34px;padding:0;font-size:18px}'
    + '.mh-tools{display:flex;gap:6px;padding:10px 16px;border-bottom:1px solid var(--border,#000);background:var(--bg,#fff)}'
    + '.mh-tools[hidden]{display:none}'
    + '.mh-tools .mh-btn{flex:1;min-width:0;padding:10px 4px;font-size:13px;white-space:nowrap}'
    + '.mh-tools .mh-primary{background:var(--ink,#000);color:var(--bg,#fff)}'
    + '.mh-tools .mh-primary:hover{background:var(--ink,#000);opacity:.85}'
    + '.mh-tools .mh-btn:disabled{opacity:.55;cursor:wait}'
    + '.mh-body{flex:1;overflow-y:auto;padding:14px 16px 24px;-webkit-overflow-scrolling:touch}'
    + '.mh-msg{margin:24px 0;color:var(--soft,#555);text-align:center}'
    + '.mh-note{margin:0;padding:8px 16px;border-top:1px solid var(--border,#000);font-size:12px;color:var(--soft,#555);background:var(--bg,#fff)}'
    + '.mh-g{margin:0 0 14px;border:1px solid var(--border,#000);background:var(--bg,#fff);box-shadow:none}'
    + '.mh-gh{display:flex;align-items:center;gap:10px;padding:10px 12px}'
    + '.mh-ph{flex:none;width:42px;height:42px;border:1px solid var(--border,#000);border-radius:50%;object-fit:cover;background:var(--card,#fbcfe8)}'
    + '.mh-gn{flex:1;min-width:0}'
    + '.mh-gn a,.mh-gn b{display:block;font-weight:900;color:var(--ink,#000);text-decoration:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
    + '.mh-gn a:hover{text-decoration:underline}'
    + '.mh-gn small{color:var(--soft,#555);font-size:12px}'
    + '.mh-bk{display:flex;align-items:center;gap:10px;margin:0;padding:8px 12px;border-top:1px dashed var(--border,#000);list-style:none}'
    + '.mh-cv{flex:none;width:34px;height:50px;border:1px solid var(--border,#000);background:var(--card,#fbcfe8);object-fit:cover}'
    + '.mh-bt{flex:1;min-width:0}'
    + '.mh-bt a,.mh-bt b{display:block;font-weight:800;font-size:14px;color:var(--ink,#000);text-decoration:none}'
    + '.mh-bt a:hover{text-decoration:underline}'
    + '.mh-bt small{display:block;color:var(--soft,#555);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
    + '.mh-ul{margin:0;padding:0}'
    + '.mh-del{flex:none;width:30px;height:30px;padding:0;border:1px solid var(--border,#000);background:var(--bg,#fff);color:var(--ink,#000);'
    + 'font:800 14px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;cursor:pointer}'
    + '.mh-del:hover{background:#fee2e2;color:#b91c1c}'
    + '.mh-gh .mh-del{width:auto;padding:0 8px;font-size:12px}'
    + '.mh-undo{display:flex;align-items:center;gap:10px;margin:0;padding:10px 16px;border-top:1px solid var(--border,#000);background:var(--ink,#000);color:var(--bg,#fff);font-size:13px}'
    + '.mh-undo[hidden]{display:none}'
    + '.mh-undo span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
    + '.mh-undo button{padding:5px 10px;border:2px solid #fff;background:#fde047;color:var(--on-yellow,#111);font-weight:800;font-size:12px;font-family:inherit;cursor:pointer}'
    + 'html.mh-open{overflow:hidden}'
    + '.is-capturing .mh-fab{display:none!important}'
    + '@media print{.mh-fab,.mh-bg{display:none!important}}';
  style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  function escHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function mineKeys() {
    return Object.keys(mine).filter(function (k) { return /^[cb]:./.test(k); });
  }

  var fab = null;
  function renderFab() {
    var n = mineKeys().length;
    if (!fab) {
      if (!n || !document.body) return;
      fab = document.createElement('button');
      fab.type = 'button';
      fab.className = 'mh-fab';
      fab.innerHTML = '<span class="mh-ico" aria-hidden="true">♥</span><span>' + T.fab + '</span><span class="mh-n"></span>';
      fab.addEventListener('click', openDrawer);
      document.body.appendChild(fab);
    }
    fab.querySelector('.mh-n').textContent = String(n);
    fab.setAttribute('aria-label', T.fab + ' ' + n);
    fab.hidden = !n;
  }

  var siteData = null;
  function loadSite() {
    if (!siteData) {
      var urls = ['/data.json'];
      if (EN) urls.push('/data/en_slugs.json');
      siteData = Promise.all(urls.map(function (u) {
        return fetch(u).then(function (r) {
          if (!r.ok) throw new Error(u + ' ' + r.status);
          return r.json();
        });
      })).then(function (res) {
        return { celebs: (res[0] && res[0].celebs) || {}, slugs: res[1] || {} };
      }).catch(function (e) { siteData = null; throw e; });
    }
    return siteData;
  }

  // generate.py의 make_celeb_url·make_book_url, en 쪽은 data/en_slugs.json과 같은 규칙
  function celebUrl(site, name) {
    var slug = EN && site.slugs.celeb && site.slugs.celeb[name];
    if (slug) return '/en/share/' + slug + '.html';
    return '/share/' + encodeURIComponent(name.replace(/[\/\\]/g, '_')) + '.html';
  }
  function bookUrl(site, title) {
    var slug = EN && site.slugs.book && site.slugs.book[title];
    if (slug) return '/en/share/book/' + slug + '.html';
    return '/share/book/' + encodeURIComponent(title.replace(/[\/\\:"?]/g, '_')) + '.html';
  }

  // 셀럽·책 정보로 서랍에 보일 묶음을 만든다
  function buildGroups(site) {
    var celebs = site.celebs;
    var readers = {};  // 책 제목 → 읽은 셀럽 (data.json 순서)
    var info = {};     // 책 제목 → 처음 나온 책 정보
    Object.keys(celebs).forEach(function (name) {
      (celebs[name].books || []).forEach(function (b) {
        var t = String(b.title || '').trim();
        if (!t) return;
        (readers[t] = readers[t] || []);
        if (readers[t].indexOf(name) < 0) readers[t].push(name);
        if (!info[t] || (!info[t].coverUrl && b.coverUrl)) info[t] = b;
      });
    });

    var keys = mineKeys();
    var when = function (k) { return (meta[k] && meta[k][1]) || 0; };
    var groups = {};
    var shared = { books: [], t: 0 };
    function group(name) {
      return groups[name] || (groups[name] = { name: name, books: [], t: 0 });
    }

    keys.forEach(function (k) {
      if (k.charAt(0) !== 'c' || !celebs[k.slice(2)]) return;
      var g = group(k.slice(2));
      g.hearted = true;
      g.t = Math.max(g.t, when(k));
    });
    keys.forEach(function (k) {
      if (k.charAt(0) !== 'b') return;
      var t = k.slice(2);
      var rs = readers[t] || [];
      var at = meta[k] && meta[k][0];
      var owner = (at && rs.indexOf(at) >= 0) ? at : '';
      if (!owner) {
        rs.some(function (r) { if (mine['c:' + r]) { owner = r; return true; } return false; });
      }
      if (!owner && rs.length === 1) owner = rs[0];
      var item = { key: k, title: t, info: info[t] || {}, readers: rs, t: when(k) };
      var g = owner ? group(owner) : shared;
      g.books.push(item);
      g.t = Math.max(g.t, item.t);
    });

    var byTime = function (a, b) { return (b.t - a.t) || (a.name || a.title).localeCompare(b.name || b.title); };
    var list = Object.keys(groups).map(function (n) { return groups[n]; }).sort(byTime);
    list.forEach(function (g) { g.books.sort(byTime); });
    shared.books.sort(byTime);
    return { list: list, shared: shared };
  }

  // 영문 제목·작가. 편집기가 기계 번역한 값 끝의 ' *' 표시는 서랍에서는 뗀다
  function enOr(v, ko) {
    v = EN && v ? String(v).replace(/\s*\*\s*$/, '') : '';
    return v || ko || '';
  }

  function bookRow(site, b, owner) {
    var href = owner
      ? celebUrl(site, owner) + '#h=' + encodeURIComponent(b.key)
      : (b.readers.length ? bookUrl(site, b.title) : '');
    var title = enOr(b.info.title_en, b.title);
    var by = owner ? enOr(b.info.author_en, b.info.author)
                   : (b.readers.length ? T.readBy(b.readers.slice(0, 2), Math.max(b.readers.length - 2, 0)) : '');
    var cover = b.info.coverUrl
      ? '<img class="mh-cv" src="' + escHtml(b.info.coverUrl) + '" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.removeAttribute(\'src\')">'
      : '<span class="mh-cv"></span>';
    return '<li class="mh-bk">' + cover
      + '<span class="mh-bt">' + (href ? '<a href="' + escHtml(href) + '">' + escHtml(title) + '</a>' : '<b>' + escHtml(title) + '</b>')
      + (by ? '<small>' + escHtml(by) + '</small>' : '') + '</span>'
      + delBtn([b.key], title, T.del) + '</li>';
  }

  // 셀럽 하트 버튼. 책만 담긴 셀럽도 여기서 바로 하트를 넣을 수 있다.
  function heartBtn(key) {
    return '<button type="button" class="heart-btn sm" data-heart="' + escHtml(key) + '"'
      + ' aria-pressed="false" hidden><span class="heart-ico" aria-hidden="true">♡</span><span class="heart-n"></span></button>';
  }

  // 빼기 버튼. keys의 하트를 모두 빼고 그 줄(묶음)을 서랍에서 지운다.
  function delBtn(keys, what, label) {
    var short = label === T.del;
    return '<button type="button" class="mh-del" data-del="' + escHtml(JSON.stringify(keys)) + '"'
      + ' data-what="' + escHtml(what) + '" aria-label="' + escHtml(what + ' ' + label) + '" title="' + escHtml(label) + '">'
      + (short ? '✕' : escHtml(label)) + '</button>';
  }

  function renderDrawer(body, site) {
    var gs = buildGroups(site);
    var html = '';
    gs.list.forEach(function (g) {
      var c = site.celebs[g.name] || {};
      html += '<section class="mh-g"><div class="mh-gh">'
        + (c.imageUrl ? '<img class="mh-ph" src="' + escHtml(c.imageUrl) + '" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.removeAttribute(\'src\')">' : '<span class="mh-ph"></span>')
        + '<span class="mh-gn"><a href="' + escHtml(celebUrl(site, g.name)) + '">' + escHtml(g.name) + '</a>'
        + (g.books.length ? '<small>' + T.books(g.books.length) + '</small>' : '') + '</span>'
        + heartBtn('c:' + g.name)
        + delBtn(['c:' + g.name].concat(g.books.map(function (b) { return b.key; })), g.name, T.delAll) + '</div>'
        + (g.books.length ? '<ul class="mh-ul">' + g.books.map(function (b) { return bookRow(site, b, g.name); }).join('') + '</ul>' : '')
        + '</section>';
    });
    if (gs.shared.books.length) {
      html += '<section class="mh-g"><div class="mh-gh"><span class="mh-gn"><b>' + T.shared + '</b>'
        + '<small>' + T.books(gs.shared.books.length) + '</small></span>'
        + delBtn(gs.shared.books.map(function (b) { return b.key; }), T.shared, T.delAll) + '</div><ul class="mh-ul">'
        + gs.shared.books.map(function (b) { return bookRow(site, b, ''); }).join('') + '</ul></section>';
    }
    body.innerHTML = html || '<p class="mh-msg">' + T.empty + '</p>';
    scan(body);
    return gs;
  }

  // ── 내보내기: 텍스트 · 마크다운 · 책장 이미지 ───────────────────────────
  // 세 가지 모두 buildGroups() 결과(셀럽별 묶음 + 여러 셀럽이 읽은 책)를 그대로 쓴다.
  var SITE = 'https://favorbook.co.kr';

  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function today(sep) {
    var d = new Date();
    return d.getFullYear() + sep + pad2(d.getMonth() + 1) + sep + pad2(d.getDate());
  }
  function bookLine(b) {
    var a = enOr(b.info.author_en, b.info.author);
    return enOr(b.info.title_en, b.title) + (a ? ' - ' + a : '');
  }
  // 책 상세 주소. 셀럽 아래 책은 그 셀럽 페이지의 그 책 칸으로, 아니면 책 페이지로 간다
  function bookHref(site, b, owner) {
    if (owner) return SITE + celebUrl(site, owner) + '#h=' + encodeURIComponent(b.key);
    return b.readers.length ? SITE + bookUrl(site, b.title) : '';
  }
  function countOf(gs) {
    return { celebs: gs.list.length, books: gs.list.reduce(function (n, g) { return n + g.books.length; }, 0) + gs.shared.books.length };
  }

  // 일반 텍스트 — 카톡·메모·한글 어디에 붙여도 번호가 그대로 나오는 형식
  function plainText(site, gs) {
    var c = countOf(gs);
    var out = ['♥ ' + T.shelfTitle + ' · ' + T.counts(c.celebs, c.books), today('.') + ' ' + T.asOf, ''];
    var section = function (head, books) {
      out.push('■ ' + head + (books.length ? ' (' + T.books(books.length) + ')' : ''));
      books.forEach(function (b, i) { out.push((i + 1) + '. ' + bookLine(b)); });
      out.push('');
    };
    gs.list.forEach(function (g) { section(g.name, g.books); });
    if (gs.shared.books.length) section(T.shared, gs.shared.books);
    out.push(T.brand + ' ' + T.site);
    return out.join('\n');
  }

  // 마크다운 — 노션·옵시디언·깃허브 등에 붙이면 제목·목록·링크가 살아난다
  function markdownText(site, gs) {
    var c = countOf(gs);
    var esc = function (s) { return String(s).replace(/([\\\[\]*_`])/g, '\\$1'); };
    var out = ['# ♥ ' + T.shelfTitle, '', T.counts(c.celebs, c.books) + ' · ' + today('-') + ' ' + T.asOf, ''];
    var section = function (head, books, owner) {
      out.push('## ' + esc(head) + (books.length ? ' · ' + T.books(books.length) : ''), '');
      books.forEach(function (b) {
        var href = bookHref(site, b, owner).replace(/\(/g, '%28').replace(/\)/g, '%29');
        var title = esc(enOr(b.info.title_en, b.title));
        var a = enOr(b.info.author_en, b.info.author);
        out.push('- ' + (href ? '[' + title + '](' + href + ')' : title) + (a ? ' — ' + esc(a) : ''));
      });
      out.push('');
    };
    gs.list.forEach(function (g) { section(g.name, g.books, g.name); });
    if (gs.shared.books.length) section(T.shared, gs.shared.books, '');
    out.push('---', '[' + T.brand + '](' + T.site + ')');
    return out.join('\n');
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
    return new Promise(function (ok, no) {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy') ? ok() : no(); } catch (e) { no(e); }
      document.body.removeChild(ta);
    });
  }

  // ── 책장 이미지 (PNG) ───────────────────────────────────────────────
  // 책등 사진을 세워 선반에 꽂은 모양. 편집기(editor/shelf.js)와 같은 방식으로 canvas에 직접 그린다.
  // 예스24 이미지는 CORS가 없어 canvas가 막히므로 images.weserv.nl을 거치고, 못 불러온 책은 색 책등으로 대신한다.
  var PROXY = 'https://images.weserv.nl/?url=';
  var SERIF = '"KoPubWorld Batang","Noto Serif KR",Batang,serif';
  var SANS = '-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans KR","Malgun Gothic",sans-serif';
  var INK = '#1c1a17', SOFT = '#7a7064', ACCENT = '#e11d48';

  function hashOf(s, mul) {
    var h = 0;
    for (var ch of String(s || '')) h = (Math.imul(h, mul) + ch.codePointAt(0)) >>> 0;
    return h;
  }
  function tint(title) {
    var h = hashOf(title, 31);
    return 'hsl(' + (h % 360) + ',' + (32 + (h >>> 9) % 26) + '%,' + (26 + (h >>> 17) % 22) + '%)';
  }
  function isLight(hex) {
    var m = /^#([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return false;
    var lin = [0, 2, 4].map(function (i) {
      var c = parseInt(m[1].slice(i, i + 2), 16) / 255;
      return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2] > 0.4;
  }
  // 본제목만 — 부제와 끝의 판형 표기는 뗀다
  function spineTitle(t) {
    t = String(t || '').trim();
    return t.split(/\s+[-–—]\s+/)[0].replace(/\s*[(\[][^)\]]*[)\]]\s*$/, '').trim() || t;
  }
  function yes24Spine(cover) {
    var m = /image\.yes24\.com\/goods\/(?:detail\/)?(\d+)/i.exec(cover || '');
    return m ? 'https://image.yes24.com/goods/' + m[1] + '/side' : '';
  }
  function loadImage(url) {
    return new Promise(function (resolve) {
      var im = new Image(), done = false;
      var fin = function (v) { if (!done) { done = true; resolve(v); } };
      im.crossOrigin = 'anonymous';
      im.onload = function () { fin(im.naturalWidth && im.naturalHeight ? im : null); };
      im.onerror = function () { fin(null); };
      setTimeout(function () { fin(null); }, 10000);
      im.src = PROXY + encodeURIComponent(url.replace(/^https?:\/\//i, '')) + '&output=png';
    });
  }

  function prepareSpines(books) {
    return Promise.all(books.map(function (b) {
      var url = b.info.spineUrl || yes24Spine(b.info.coverUrl);
      var title = spineTitle(enOr(b.info.title_en, b.title));
      var color = b.info.spineColor || '';
      var make = function (img) {
        if (img && img.naturalWidth / img.naturalHeight > 0.4) img = null;   // 넙적하면 '이미지 준비중' 그림이므로 색 책등으로
        return {
          title: title, img: img, color: color || tint(b.title), light: !!color && isLight(color),
          ratio: img ? img.naturalWidth / img.naturalHeight : (24 + hashOf(title, 13) % 10) / 310,
          f: 0.88 + (hashOf(b.title, 17) % 13) / 100,   // 책마다 키가 조금씩 달라 진짜 책장처럼 보인다
        };
      };
      return url ? loadImage(url).then(make) : Promise.resolve(make(null));
    }));
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h); ctx.lineTo(x, y + h); ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
  }

  // 세로 제목 — 한글은 똑바로 쌓고, 라틴·숫자 묶음은 시계 방향으로 눕힌다
  function drawVertical(ctx, text, cx, top, maxLen, w, color) {
    var runs = [];
    for (var ch of text) {
      var cjk = ch.codePointAt(0) > 0x2E7F, last = runs[runs.length - 1];
      if (last && last.cjk === cjk && !cjk) last.s += ch; else runs.push({ cjk: cjk, s: ch });
    }
    var size = Math.max(11, Math.min(Math.round(w * 0.42), 34));
    var lenAt = function (fs) {
      ctx.font = '300 ' + fs + 'px ' + SERIF;
      var n = 0;
      runs.forEach(function (r) { n += r.cjk ? fs * 1.18 : (r.s.trim() ? ctx.measureText(r.s).width + fs * 0.2 : fs * 0.45); });
      return n;
    };
    while (size > 9 && lenAt(size) > maxLen) size -= 1;
    ctx.font = '300 ' + size + 'px ' + SERIF;
    ctx.fillStyle = color;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    var y = top;
    runs.forEach(function (r) {
      if (!r.cjk && !r.s.trim()) { y += size * 0.45; return; }
      if (r.cjk) { ctx.fillText(r.s, cx, y + size * 0.59); y += size * 1.18; return; }
      var len = ctx.measureText(r.s).width;
      ctx.save();
      ctx.translate(cx, y + len / 2);
      ctx.rotate(Math.PI / 2);
      ctx.fillText(r.s, 0, 0);
      ctx.restore();
      y += len + size * 0.2;
    });
  }

  function drawSpine(ctx, c, x, y) {
    var it = c.it, w = c.w, h = c.h;
    // 책 밑에 옅은 그림자
    ctx.save();
    ctx.shadowColor = 'rgba(40,30,10,.22)'; ctx.shadowBlur = 8; ctx.shadowOffsetX = 2; ctx.shadowOffsetY = 1;
    ctx.fillStyle = it.color;
    roundRect(ctx, x, y, w, h, 3); ctx.fill();
    ctx.restore();
    ctx.save();
    roundRect(ctx, x, y, w, h, 3);
    ctx.clip();
    if (it.img) {
      ctx.drawImage(it.img, x, y, w, h);
    } else {
      ctx.fillStyle = it.color;
      ctx.fillRect(x, y, w, h);
      var g = ctx.createLinearGradient(x, 0, x + w, 0);
      g.addColorStop(0, 'rgba(255,255,255,.10)'); g.addColorStop(.18, 'rgba(255,255,255,0)');
      g.addColorStop(.82, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.14)');
      ctx.fillStyle = g;
      ctx.fillRect(x, y, w, h);
      drawVertical(ctx, it.title, x + w / 2, y + 16, h - 32, w, it.light ? '#111' : '#fff');
    }
    ctx.restore();
  }

  function drawHeart(ctx, x, y, s, color) {   // (x,y)가 왼쪽 위인 s×s 하트
    ctx.save();
    ctx.translate(x, y); ctx.scale(s / 32, s / 32);
    ctx.beginPath();
    ctx.moveTo(16, 29);
    ctx.bezierCurveTo(-8, 13, 5, -4, 16, 8);
    ctx.bezierCurveTo(27, -4, 40, 13, 16, 29);
    ctx.fillStyle = color; ctx.fill();
    ctx.restore();
  }

  // 이미지·머리글에 쓸 셀럽 이름 (영문 페이지는 영문 이름)
  function celebLabel(site, name) {
    var c = site.celebs[name] || {};
    return (EN && c.nameEn) || name;
  }

  function fitText(ctx, text, maxW) {
    if (ctx.measureText(text).width <= maxW) return text;
    while (text.length > 1 && ctx.measureText(text + '…').width > maxW) text = text.slice(0, -1);
    return text + '…';
  }

  // 셀럽(묶음)별로 책을 모아 선반에 놓는다. 묶음 밑에 이름표를 붙이고, 한 줄에 안 들어가면 다음 줄로 이어 간다
  var BLOCKGAP = 30, LABELFONT = '700 23px ' + SANS;
  function arrange(blocks, H, availW, ctx) {
    var rows = [], row = [], rw = 0;
    ctx.font = LABELFONT;
    var place = function (chunk) {
      if (row.length && rw + BLOCKGAP + chunk.w > availW) { rows.push({ chunks: row, w: rw }); row = []; rw = 0; }
      rw += (row.length ? BLOCKGAP : 0) + chunk.w;
      row.push(chunk);
    };
    blocks.forEach(function (b) {
      var cur = [], cw = 0, first = true;
      var flush = function () {
        if (!cur.length) return;
        var label = first ? b.label : b.label + T.cont;
        var lw = Math.min(Math.ceil(ctx.measureText(label).width), availW);
        place({ label: label, cont: !first, cells: cur, w: Math.max(cw, lw) });
        cur = []; cw = 0; first = false;
      };
      b.items.forEach(function (it) {
        var h = Math.round(H * it.f), w = Math.max(14, Math.round(it.ratio * h));
        if (cur.length && cw + 4 + w > availW) flush();
        cw += (cur.length ? 4 : 0) + w;
        cur.push({ it: it, w: w, h: h });
      });
      flush();
    });
    if (row.length) rows.push({ chunks: row, w: rw });
    return rows;
  }

  function renderShelf(site, gs) {
    var W = 1080, PAD = 72, HEAD = 270, FOOT = 140, BOARD = 12, LABELH = 52, ROWGAP = 92, MAXH = 1920, MINH = 820;
    var groups = gs.list.filter(function (g) { return g.books.length; }).map(function (g) {
      return { label: celebLabel(site, g.name), books: g.books };
    });
    if (gs.shared.books.length) groups.push({ label: T.shared, books: gs.shared.books });
    var books = [];
    groups.forEach(function (g) { books = books.concat(g.books); });
    var c = countOf(gs);
    var fonts = document.fonts && document.fonts.load ? Promise.all([
      document.fonts.load('300 20px "KoPubWorld Batang"', '가나다abc'),
      document.fonts.load('700 20px "KoPubWorld Batang"', '가나다abc'),
    ]).catch(function () {}) : Promise.resolve();

    return Promise.all([prepareSpines(books), fonts]).then(function (res) {
      var all = res[0], n = 0;
      var blocks = groups.map(function (g) {
        var items = all.slice(n, n + g.books.length);
        n += g.books.length;
        return { label: g.label, items: items };
      });
      var cv = document.createElement('canvas');
      var ctx = cv.getContext('2d');
      var availW = W - PAD * 2, H = 360, rows, total;
      var totalOf = function () { return rows.length * (H + BOARD + LABELH) + Math.max(rows.length - 1, 0) * ROWGAP; };
      for (; H >= 110; H -= 6) {
        rows = arrange(blocks, H, availW, ctx);
        total = totalOf();
        if (HEAD + total + FOOT <= MAXH) break;
      }
      if (H < 110) { H = 110; rows = arrange(blocks, H, availW, ctx); total = totalOf(); }
      var CH = Math.max(MINH, HEAD + total + FOOT);

      cv.width = W; cv.height = CH;
      ctx = cv.getContext('2d');
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
      // 배경은 칠하지 않는다 — 투명 PNG라 어디에 올려도 책장만 얹힌다

      // 머리글: ♥ 내 책장 / 셀럽 n명 · 책 n권 / 셀럽 이름들
      drawHeart(ctx, PAD, 78, 50, ACCENT);
      ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
      ctx.fillStyle = INK; ctx.font = '700 70px ' + SERIF;
      ctx.fillText(T.shelfTitle, PAD + 70, 130);
      ctx.fillStyle = SOFT; ctx.font = '500 28px ' + SANS;
      ctx.fillText(T.counts(c.celebs, c.books), PAD + 2, 186);
      if (gs.list.length) {
        ctx.font = '400 25px ' + SANS;
        var names = gs.list.slice(0, 4).map(function (g) { return celebLabel(site, g.name); }).join(' · ')
          + (gs.list.length > 4 ? (EN ? ' +' : ' 외 ') + (gs.list.length - 4) + (EN ? '' : '명') : '');
        ctx.fillStyle = '#a0968a';
        ctx.fillText(fitText(ctx, names, W - PAD * 2), PAD + 2, 226);
      }
      ctx.textAlign = 'right'; ctx.fillStyle = '#a0968a'; ctx.font = '500 25px ' + SANS;
      ctx.fillText(today('.'), W - PAD, 130);

      // 선반: 책은 왼쪽부터 꽂고 줄마다 얇은 판자를 깐다. 책장 전체를 머리글과 바닥글 사이에 가운데 맞춘다
      var top = HEAD + Math.max(0, (CH - HEAD - FOOT - total) / 2);
      rows.forEach(function (row, ri) {
        var y0 = top + ri * (H + BOARD + LABELH + ROWGAP), base = y0 + H;
        var x = PAD;
        row.chunks.forEach(function (chunk) {
          var bx = x;
          chunk.cells.forEach(function (cell) {
            drawSpine(ctx, cell, bx, base - cell.h);
            bx += cell.w + 4;
          });
          x += chunk.w + BLOCKGAP;
        });
        ctx.fillStyle = INK;
        roundRect(ctx, PAD - 28, base, W - PAD * 2 + 56, BOARD, 3); ctx.fill();
        var sh = ctx.createLinearGradient(0, base + BOARD, 0, base + BOARD + 14);
        sh.addColorStop(0, 'rgba(60,40,10,.14)'); sh.addColorStop(1, 'rgba(60,40,10,0)');
        ctx.fillStyle = sh; ctx.fillRect(PAD - 28, base + BOARD, W - PAD * 2 + 56, 14);

        // 이름표: 묶음의 첫 책 아래에 왼쪽 맞춰 적고, 판자에서 이름표까지 짧은 선으로 이어 준다
        x = PAD;
        row.chunks.forEach(function (chunk) {
          ctx.fillStyle = chunk.cont ? '#a0968a' : INK;
          ctx.fillRect(x, base + BOARD + 10, Math.min(chunk.w, 44), 3);
          ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
          ctx.font = LABELFONT;
          ctx.fillText(chunk.label, x, base + BOARD + 40);
          x += chunk.w + BLOCKGAP;
        });
      });

      // 바닥글
      var fy = CH - 62;
      drawHeart(ctx, PAD, fy - 26, 30, ACCENT);
      ctx.textAlign = 'left'; ctx.fillStyle = INK; ctx.font = '700 30px ' + SERIF;
      ctx.fillText(T.brand, PAD + 42, fy);
      ctx.textAlign = 'right'; ctx.fillStyle = SOFT; ctx.font = '500 26px ' + SANS;
      ctx.fillText(T.siteShort, W - PAD, fy);
      return cv;
    });
  }

  // 휴대폰에서는 공유 창(→ 사진에 저장), 컴퓨터에서는 바로 내려받는다
  function deliverPng(blob, name) {
    var file = null;
    try { file = new File([blob], name, { type: 'image/png' }); } catch (e) {}
    var touch = window.matchMedia && window.matchMedia('(pointer:coarse)').matches;
    var download = function () {
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
    };
    if (file && touch && navigator.canShare && navigator.canShare({ files: [file] })) {
      return navigator.share({ files: [file], title: T.shelfTitle }).catch(function (e) {
        if (e && e.name === 'AbortError') throw e;
        download();   // 이미지를 만드는 동안 '누른 직후' 조건이 풀려 공유가 막히면 내려받기로
      });
    }
    download();
    return Promise.resolve();
  }

  function saveShelfImage(site, gs) {
    return renderShelf(site, gs).then(function (cv) {
      return new Promise(function (ok, no) {
        cv.toBlob(function (b) { b ? ok(b) : no(new Error('toBlob')); }, 'image/png');
      });
    }).then(function (blob) {
      if (typeof window.gtag === 'function') {
        try { window.gtag('event', 'my_shelf_image', { n: countOf(gs).books }); } catch (e) {}
      }
      return deliverPng(blob, 'favorbook-shelf-' + today('') + '.png');
    });
  }

  var drawer = null;
  var drawerSite = null;
  var lastFocus = null;

  // 빼기 — 하트를 빼고(서버의 하트 수도 줄어든다) 그 줄을 바로 지운다.
  // 잘못 눌렀을 때를 위해 마지막으로 뺀 것은 잠깐 되돌릴 수 있다.
  var lastRemoved = null;
  var undoTimer = null;

  function removeFromDrawer(btn) {
    var keys;
    try { keys = JSON.parse(btn.getAttribute('data-del')) || []; } catch (e) { return; }
    var gone = [];
    keys.forEach(function (k) {
      if (!mine[k]) return;
      var m = meta[k];
      if (setHeart(k, false)) gone.push([k, m]);
    });
    var row = btn.closest('.mh-bk') || btn.closest('.mh-g');
    var sec = btn.closest('.mh-g');
    if (row) row.parentNode.removeChild(row);
    // 책을 다 뺀 묶음: 셀럽 하트도 없으면 묶음째 지우고, 있으면 권수만 고친다
    if (sec && sec.parentNode && row !== sec) {
      var left = sec.querySelectorAll('.mh-bk').length;
      var ch = sec.querySelector('.mh-gh .heart-btn');
      if (!left && !(ch && mine[ch.getAttribute('data-heart')])) sec.parentNode.removeChild(sec);
      else {
        var small = sec.querySelector('.mh-gn small');
        if (small) { if (left) small.textContent = T.books(left); else small.parentNode.removeChild(small); }
        var all = sec.querySelector('.mh-gh .mh-del');
        if (all) {
          try {
            all.setAttribute('data-del', JSON.stringify(JSON.parse(all.getAttribute('data-del')).filter(function (k) {
              return keys.indexOf(k) < 0;
            })));
          } catch (e) {}
        }
      }
    }
    var body = drawer.querySelector('.mh-body');
    if (!body.querySelector('.mh-g')) {
      body.innerHTML = '<p class="mh-msg">' + T.empty + '</p>';
      drawer.querySelector('.mh-tools').hidden = true;
    }
    if (!gone.length) return;
    lastRemoved = gone;
    var bar = drawer.querySelector('.mh-undo');
    bar.querySelector('span').textContent = T.removed(btn.getAttribute('data-what') || '');
    bar.hidden = false;
    clearTimeout(undoTimer);
    undoTimer = setTimeout(hideUndo, 6000);
  }

  function hideUndo() {
    clearTimeout(undoTimer);
    lastRemoved = null;
    if (drawer) drawer.querySelector('.mh-undo').hidden = true;
  }

  function undoRemove() {
    var back = lastRemoved;
    hideUndo();
    if (!back || !drawerSite) return;
    // 빼는 요청이 아직 서버에 가는 중이면 끝날 때까지 잠깐 기다렸다 다시 넣는다
    var tries = 0;
    (function apply() {
      if (back.some(function (x) { return pending[x[0]]; }) && tries++ < 30) { setTimeout(apply, 100); return; }
      back.forEach(function (x) { setHeart(x[0], true, x[1]); });
      var gs = renderDrawer(drawer.querySelector('.mh-body'), drawerSite);
      drawer.querySelector('.mh-tools').hidden = !(gs.list.length || gs.shared.books.length);
    })();
  }
  function closeDrawer() {
    if (!drawer || drawer.hidden) return;
    drawer.hidden = true;
    document.documentElement.classList.remove('mh-open');
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  function openDrawer() {
    if (!drawer) {
      drawer = document.createElement('div');
      drawer.className = 'mh-bg';
      drawer.hidden = true;
      drawer.innerHTML = '<div class="mh-panel" role="dialog" aria-modal="true" aria-labelledby="mh-title">'
        + '<div class="mh-head"><h2 id="mh-title"><span aria-hidden="true">♥</span> ' + T.title + '</h2>'
        + '<button type="button" class="mh-btn mh-x" aria-label="' + T.close + '">✕</button></div>'
        + '<div class="mh-tools" hidden>'
        + '<button type="button" class="mh-btn mh-primary mh-img">' + T.saveImg + '</button>'
        + '<button type="button" class="mh-btn mh-txt">' + T.copyTxt + '</button>'
        + '<button type="button" class="mh-btn mh-md">' + T.copyMd + '</button></div>'
        + '<div class="mh-body"></div>'
        + '<p class="mh-undo" role="status" hidden><span></span><button type="button">' + T.undo + '</button></p>'
        + '<p class="mh-note">' + T.note + '</p></div>';
      drawer.addEventListener('click', function (e) {
        if (e.target === drawer || (e.target.closest && e.target.closest('.mh-x'))) { closeDrawer(); return; }
        var del = e.target.closest && e.target.closest('.mh-del');
        if (del) removeFromDrawer(del);
      });
      drawer.querySelector('.mh-undo button').addEventListener('click', undoRemove);
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') closeDrawer();
      });
      document.body.appendChild(drawer);
    }
    lastFocus = document.activeElement;
    drawer.hidden = false;
    document.documentElement.classList.add('mh-open');
    var body = drawer.querySelector('.mh-body');
    var tools = drawer.querySelector('.mh-tools');
    body.innerHTML = '<p class="mh-msg">' + T.loading + '</p>';
    tools.hidden = true;
    drawer.querySelector('.mh-x').focus();

    hideUndo();
    loadSite().then(function (site) {
      drawerSite = site;
      var gs = renderDrawer(body, site);
      tools.hidden = !(gs.list.length || gs.shared.books.length);
      // 서랍을 연 뒤 뺀 하트는 결과에서도 빠지도록 누를 때마다 목록을 새로 만든다
      var flash = function (btn, label, orig) {
        btn.textContent = label;
        setTimeout(function () { btn.textContent = orig; }, 1600);
      };
      var bindCopy = function (sel, make, orig) {
        var btn = tools.querySelector(sel);
        btn.textContent = orig;
        btn.onclick = function () {
          copyText(make(site, buildGroups(site))).then(function () { flash(btn, T.copied, orig); }, function () {});
        };
      };
      bindCopy('.mh-txt', plainText, T.copyTxt);
      bindCopy('.mh-md', markdownText, T.copyMd);
      var imgBtn = tools.querySelector('.mh-img');
      imgBtn.textContent = T.saveImg;
      imgBtn.onclick = function () {
        if (imgBtn.disabled) return;
        imgBtn.disabled = true;
        imgBtn.textContent = T.making;
        saveShelfImage(site, buildGroups(site)).then(function () {
          flash(imgBtn, T.savedImg, T.saveImg);
        }, function (e) {
          if (e && e.name === 'AbortError') { imgBtn.textContent = T.saveImg; return; }   // 공유 창을 닫은 경우
          imgBtn.textContent = T.saveImg;
          alert(T.imgFail);
        }).then(function () { imgBtn.disabled = false; });
      };
    }).catch(function () {
      body.innerHTML = '<p class="mh-msg">' + T.fail + '</p>';
    });

    if (typeof window.gtag === 'function') {
      try { window.gtag('event', 'my_hearts_open', { n: mineKeys().length }); } catch (e) {}
    }
  }

  // 서랍의 책 링크(셀럽 페이지#h=b:제목)로 들어오면 그 책 칸으로 내려가 노란 테두리로 표시한다
  function jumpToHeart() {
    var m = /^#h=(.+)$/.exec(location.hash);
    if (!m) return;
    var key;
    try { key = decodeURIComponent(m[1]); } catch (e) { return; }
    var hit = null;
    Array.prototype.some.call(document.querySelectorAll('.heart-btn[data-heart]'), function (b) {
      if (b.getAttribute('data-heart') === key && b.closest('.rl-item')) { hit = b.closest('.rl-item'); return true; }
      return false;
    });
    if (hit && hit.id) location.replace('#' + hit.id);
    else if (hit) hit.scrollIntoView();
  }

  window.FavorHearts = { scan: scan, open: openDrawer };

  function start() {
    scan();
    renderFab();
    jumpToHeart();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
