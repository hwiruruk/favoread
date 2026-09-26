/*
 * 셀럽·책 하트 버튼
 *
 * 페이지에 <button class="heart-btn" data-heart="c:이름" hidden> 을 두면
 * 이 스크립트가 하트 수를 불러와 보여 주고, 누르면 하트를 넣거나 뺀다.
 * 키는 셀럽이면 "c:" + 한국어 이름, 책이면 "b:" + 한국어 제목.
 *
 * 서버는 tools/hearts-worker/ 의 Cloudflare Worker다.
 * 아래 API가 비어 있으면 아무것도 하지 않고 버튼도 숨긴 채로 둔다.
 */
(function () {
  'use strict';

  // 배포한 하트 Worker 주소를 여기에 넣는다 (예: https://favorbook-hearts.<계정>.workers.dev)
  var HEARTS_API = '';

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
    var n = counts[key] || 0;
    var ico = btn.querySelector('.heart-ico');
    var num = btn.querySelector('.heart-n');
    if (ico) ico.textContent = on ? '♥' : '♡';
    if (num) num.textContent = fmt(n);
    btn.classList.toggle('on', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  function buttonsFor(key) {
    return Array.prototype.filter.call(
      document.querySelectorAll('.heart-btn[data-heart]'),
      function (b) { return b.getAttribute('data-heart') === key; });
  }

  function renderKey(key) { buttonsFor(key).forEach(render); }

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

  // root 안의 하트 버튼을 보이게 하고 하트 수를 불러온다.
  // 모달처럼 나중에 data-heart가 바뀌는 곳에서도 다시 부르면 된다.
  function scan(root) {
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

    // 먼저 화면을 바꾸고 서버 응답으로 맞춘다
    if (on) mine[key] = true; else delete mine[key];
    counts[key] = Math.max(before + (on ? 1 : -1), 0);
    saveMine();
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
      counts[key] = before;
      saveMine();
    }).then(function () {
      delete pending[key];
      renderKey(key);
    });

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

  window.FavorHearts = { scan: scan };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { scan(); });
  } else {
    scan();
  }
})();
