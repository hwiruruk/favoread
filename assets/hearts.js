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
    + 'padding:5px 11px;border:2px solid #000;background:#fff;box-shadow:2px 2px 0 0 #000;'
    + 'font:800 13px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#000;'
    + 'cursor:pointer;transition:transform .1s,box-shadow .1s,background .1s;vertical-align:middle}'
    + '.heart-btn[hidden]{display:none}'
    + '.heart-btn:hover{transform:translate(-1px,-1px);box-shadow:3px 3px 0 0 #000;background:#fdf2f8}'
    + '.heart-btn:active{transform:none;box-shadow:1px 1px 0 0 #000}'
    + '.heart-btn.on{background:#fbcfe8}'
    + '.heart-btn .heart-ico{font-size:15px;line-height:1;color:#e11d48}'
    + '.heart-btn .heart-n{min-width:1ch;font-variant-numeric:tabular-nums}'
    + '.heart-btn.sm{padding:3px 8px;font-size:12px;box-shadow:1px 1px 0 0 #000;border-width:1.5px}'
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

  function toggle(btn) {
    var key = btn.getAttribute('data-heart');
    if (!key || pending[key]) return;
    var on = !mine[key];
    var before = counts[key] || 0;
    var metaBefore = meta[key];

    // 먼저 화면을 바꾸고 서버 응답으로 맞춘다
    if (on) {
      mine[key] = true;
      meta[key] = [key.charAt(0) === 'b' ? contextCeleb(btn) : '', Date.now()];
    } else delete mine[key];
    counts[key] = Math.max(before + (on ? 1 : -1), 0);
    saveMine();
    saveMeta();
    renderKey(key);
    if (on) {
      btn.classList.remove('pop');
      void btn.offsetWidth;
      btn.classList.add('pop');
    }

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
    fab: 'My hearts', title: 'My hearts', close: 'Close', empty: 'No hearts yet. Tap ♡ on a celeb or a book to keep it here.',
    note: 'Saved only in this browser.', copy: 'Copy list', copied: 'Copied!', loading: 'Loading…',
    fail: 'Could not load the list. Please try again later.', shared: 'Books read by several celebs',
    books: function (n) { return n + (n === 1 ? ' book' : ' books'); },
    readBy: function (names, more) { return 'Read by ' + names.join(', ') + (more ? ' +' + more : ''); },
  } : {
    fab: '내 하트', title: '내 하트', close: '닫기', empty: '아직 하트가 없어요. 셀럽이나 책의 ♡를 누르면 여기에 담겨요.',
    note: '이 브라우저에만 저장돼요.', copy: '목록 복사', copied: '복사했어요', loading: '불러오는 중…',
    fail: '목록을 불러오지 못했어요. 잠시 후 다시 열어 주세요.', shared: '여러 셀럽이 읽은 책',
    books: function (n) { return '책 ' + n + '권'; },
    readBy: function (names, more) { return names.join(', ') + (more ? ' 외 ' + more + '명' : '') + ' 읽음'; },
  };

  css =
    '.mh-fab{position:fixed;left:16px;bottom:16px;z-index:45;display:inline-flex;align-items:center;gap:6px;'
    + 'padding:9px 14px;border:2px solid #000;background:#fbcfe8;box-shadow:3px 3px 0 0 #000;color:#000;'
    + 'font:800 14px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;cursor:pointer}'
    + '.mh-fab[hidden]{display:none}'
    + '.mh-fab:hover{transform:translate(-1px,-1px);box-shadow:4px 4px 0 0 #000}'
    + '.mh-fab .mh-ico{color:#e11d48;font-size:16px;line-height:1}'
    + '.mh-fab .mh-n{min-width:1ch;padding:2px 6px;background:#000;color:#fff;font-size:12px;font-variant-numeric:tabular-nums}'
    + '.mh-bg{position:fixed;inset:0;z-index:60;background:rgba(0,0,0,.45)}'
    + '.mh-bg[hidden]{display:none}'
    + '.mh-panel{position:absolute;top:0;right:0;bottom:0;width:min(420px,100%);display:flex;flex-direction:column;'
    + 'background:#fffdf7;border-left:3px solid #000;box-shadow:-4px 0 0 0 #000;color:#000;'
    + 'font:15px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}'
    // 페이지의 h2·ul·img 스타일이 서랍 안으로 번지지 않게 한다
    + '.mh-panel *{box-sizing:border-box}'
    + '.mh-panel h2{border:0;padding:0;letter-spacing:normal;text-transform:none}'
    + '.mh-panel img{max-width:none}'
    + '.mh-head{display:flex;align-items:center;gap:8px;padding:14px 16px;border-bottom:2px solid #000;background:#fbcfe8}'
    + '.mh-head h2{margin:0;flex:1;font-size:18px;font-weight:900}'
    + '.mh-head h2 span{color:#e11d48}'
    + '.mh-btn{padding:6px 10px;border:2px solid #000;background:#fff;box-shadow:2px 2px 0 0 #000;color:#000;'
    + 'font-weight:800;font-size:12px;line-height:1;font-family:inherit;cursor:pointer}'
    + '.mh-btn:hover{background:#fef08a}'
    + '.mh-x{width:34px;height:34px;padding:0;font-size:18px}'
    + '.mh-body{flex:1;overflow-y:auto;padding:14px 16px 24px;-webkit-overflow-scrolling:touch}'
    + '.mh-msg{margin:24px 0;color:#555;text-align:center}'
    + '.mh-note{margin:0;padding:8px 16px;border-top:2px solid #000;font-size:12px;color:#555;background:#fff}'
    + '.mh-g{margin:0 0 14px;border:2px solid #000;background:#fff;box-shadow:3px 3px 0 0 #000}'
    + '.mh-gh{display:flex;align-items:center;gap:10px;padding:10px 12px}'
    + '.mh-ph{flex:none;width:42px;height:42px;border:1.5px solid #000;border-radius:50%;object-fit:cover;background:#f4f4f0}'
    + '.mh-gn{flex:1;min-width:0}'
    + '.mh-gn a,.mh-gn b{display:block;font-weight:900;color:#000;text-decoration:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
    + '.mh-gn a:hover{text-decoration:underline}'
    + '.mh-gn small{color:#666;font-size:12px}'
    + '.mh-bk{display:flex;align-items:center;gap:10px;margin:0;padding:8px 12px;border-top:1.5px dashed #bbb;list-style:none}'
    + '.mh-cv{flex:none;width:34px;height:50px;border:1.5px solid #000;background:#f4f4f0;object-fit:cover}'
    + '.mh-bt{flex:1;min-width:0}'
    + '.mh-bt a,.mh-bt b{display:block;font-weight:800;font-size:14px;color:#000;text-decoration:none}'
    + '.mh-bt a:hover{text-decoration:underline}'
    + '.mh-bt small{display:block;color:#666;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
    + '.mh-ul{margin:0;padding:0}'
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
      + heartBtn(b.key, owner) + '</li>';
  }

  // 서랍 안의 하트 버튼. 눌러서 빼도 서랍을 닫을 때까지는 자리에 남아 바로 되돌릴 수 있다.
  function heartBtn(key, owner) {
    return '<button type="button" class="heart-btn sm" data-heart="' + escHtml(key) + '"'
      + (key.charAt(0) === 'b' ? ' data-heart-celeb="' + escHtml(owner || '') + '"' : '')
      + ' aria-pressed="false" hidden><span class="heart-ico" aria-hidden="true">♡</span><span class="heart-n"></span></button>';
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
        + heartBtn('c:' + g.name) + '</div>'
        + (g.books.length ? '<ul class="mh-ul">' + g.books.map(function (b) { return bookRow(site, b, g.name); }).join('') + '</ul>' : '')
        + '</section>';
    });
    if (gs.shared.books.length) {
      html += '<section class="mh-g"><div class="mh-gh"><span class="mh-gn"><b>' + T.shared + '</b>'
        + '<small>' + T.books(gs.shared.books.length) + '</small></span></div><ul class="mh-ul">'
        + gs.shared.books.map(function (b) { return bookRow(site, b, ''); }).join('') + '</ul></section>';
    }
    body.innerHTML = html || '<p class="mh-msg">' + T.empty + '</p>';
    scan(body);
    return gs;
  }

  // 목록 복사 — 셀럽별로 책 제목을 줄줄이 적어 메모나 메신저에 붙여 넣을 수 있게 한다
  function listText(site, gs) {
    var lines = [];
    var line = function (b) {
      var a = enOr(b.info.author_en, b.info.author);
      return '- ' + enOr(b.info.title_en, b.title) + (a ? ' (' + a + ')' : '');
    };
    gs.list.forEach(function (g) {
      // 메신저에 붙여도 짧도록 짧은 주소(/s/…)를 먼저 쓴다
      var c = site.celebs[g.name] || {};
      var url = (!EN && c.shortUrl) || (location.origin + celebUrl(site, g.name));
      lines.push((mine['c:' + g.name] ? '♥ ' : '') + g.name + ' — ' + url);
      g.books.forEach(function (b) { lines.push(line(b)); });
      lines.push('');
    });
    if (gs.shared.books.length) {
      lines.push(T.shared);
      gs.shared.books.forEach(function (b) { lines.push(line(b)); });
      lines.push('');
    }
    lines.push((EN ? 'Favorbook' : '최애의 독서') + ' ' + location.origin + '/');
    return lines.join('\n');
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

  var drawer = null;
  var lastFocus = null;
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
        + '<button type="button" class="mh-btn mh-copy">' + T.copy + '</button>'
        + '<button type="button" class="mh-btn mh-x" aria-label="' + T.close + '">✕</button></div>'
        + '<div class="mh-body"></div><p class="mh-note">' + T.note + '</p></div>';
      drawer.addEventListener('click', function (e) {
        if (e.target === drawer || (e.target.closest && e.target.closest('.mh-x'))) closeDrawer();
      });
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') closeDrawer();
      });
      document.body.appendChild(drawer);
    }
    lastFocus = document.activeElement;
    drawer.hidden = false;
    document.documentElement.classList.add('mh-open');
    var body = drawer.querySelector('.mh-body');
    var copy = drawer.querySelector('.mh-copy');
    body.innerHTML = '<p class="mh-msg">' + T.loading + '</p>';
    copy.hidden = true;
    drawer.querySelector('.mh-x').focus();

    loadSite().then(function (site) {
      var gs = renderDrawer(body, site);
      copy.hidden = !(gs.list.length || gs.shared.books.length);
      copy.textContent = T.copy;
      copy.onclick = function () {
        // 서랍을 연 뒤 뺀 하트는 목록에서도 뺀다
        copyText(listText(site, buildGroups(site))).then(function () {
          copy.textContent = T.copied;
          setTimeout(function () { copy.textContent = T.copy; }, 1600);
        }, function () {});
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
