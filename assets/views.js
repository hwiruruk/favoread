/*
 * 조회수·메인 검색창 검색어 보내기 — tools/hearts-worker/ 의 /view, /search 로 알린다.
 * GA와 달리 광고 차단기에 덜 가려지고, 서버에는 주소·검색어와 날짜별 횟수만 남는다.
 *
 * 1) 조회수: 같은 탭에서 같은 페이지를 다시 열어도 한 번만 센다(sessionStorage).
 * 2) 메인 검색창: 한국어·영문 메인은 입력할 때마다 목록을 바로 걸러 주는 자체 검색창이라
 *    assets/v2/search.js 가 닿지 않는다. 여기서 입력창에 붙어, 사람이 입력을 멈춘 뒤 한 번
 *    검색어와 '결과 없음' 여부를 보낸다. (다른 페이지의 검색창은 assets/v2/search.js 가 맡는다.)
 */
(function () {
  'use strict';
  var API = (window.FAVOR_HEARTS_API || 'https://favorbook-hearts.twinwhee.workers.dev').replace(/\/+$/, '');
  if (!API || /^(localhost|127\.0\.0\.1)$/.test(location.hostname)) return;
  if (navigator.webdriver) return;

  // Workers 무료 요청 한도(하루 10만 건)를 아끼려고 조회수·검색어는 SAMPLE번 중 1번만 보내고,
  // 보낼 때 w(가중치)=SAMPLE을 함께 실어 서버가 그만큼 더한다. 그래서 통계 숫자는 전체에 가깝게 나온다.
  // 비율을 바꾸려면 이 값(과 assets/v2/search.js 의 같은 값)만 고치면 된다. 1이면 전부 보낸다.
  var SAMPLE = 3;

  function post(path, payload) {
    if (SAMPLE > 1) {
      if (Math.random() * SAMPLE >= 1) return;
      payload.w = SAMPLE;
    }
    var body = JSON.stringify(payload);
    try {
      if (navigator.sendBeacon && navigator.sendBeacon(API + path, new Blob([body], { type: 'text/plain' }))) return;
    } catch (e) {}
    try {
      fetch(API + path, { method: 'POST', body: body, headers: { 'Content-Type': 'text/plain' }, keepalive: true });
    } catch (e) {}
  }

  // ── 1) 조회수 ───────────────────────────────────────────────────
  function countView() {
    var path = location.pathname.replace(/index\.html$/, '');
    var key = 'favorbook-view:' + path;
    try {
      if (window.sessionStorage.getItem(key)) return;
      window.sessionStorage.setItem(key, '1');
    } catch (e) {}

    // 열자마자 닫는 방문까지 세려고 로드 직후에 보낸다. 화면이 숨겨진 채 열린 탭은 보일 때까지 기다린다.
    if (document.visibilityState === 'prerender' || document.hidden) {
      document.addEventListener('visibilitychange', function once() {
        if (!document.hidden) { document.removeEventListener('visibilitychange', once); post('/view', { path: path }); }
      });
    } else {
      post('/view', { path: path });
    }
  }

  // ── 2) 메인 검색창 검색어 ────────────────────────────────────────
  // input: 입력창, summary: 걸러진 결과를 적어 주는 문구, none: '결과 없음'으로 읽는 문구,
  // results: 결과 카드가 들어 있는 칸(여기를 누르면 '결과 클릭'으로 센다)
  var MAIN_SEARCH = [
    { input: 'search-input', summary: 'search-summary', none: /^결과 없음/, results: '#grid, #book-hits-list' },
    { input: 'en-search-input', summary: 'en-search-summary', none: /^No results/i, results: '#celebs, #en-book-hits-list' }
  ];

  function bindSearch(cfg) {
    var input = document.getElementById(cfg.input);
    var summary = document.getElementById(cfg.summary);
    if (!input || !summary) return;
    var timer = null, logged = '', clicked = '';

    function term() {
      return input.value.trim().replace(/\s+/g, ' ').toLowerCase().slice(0, 40);
    }
    // 입력을 멈춘 뒤 그 검색어를 한 번만 기록한다. 같은 검색어는 다시 세지 않는다.
    function flush() {
      clearTimeout(timer);
      var t = term();
      if (t.length < 2 || t === logged) return t;
      var text = (summary.textContent || '').trim();
      if (!text) return t;   // 아직 결과가 그려지지 않았다
      logged = t;
      post('/search', { kind: 's', q: t, hits: cfg.none.test(text) ? 0 : 1 });
      return t;
    }

    input.addEventListener('input', function (e) {
      // 책 칩을 눌러 자동으로 채워지는 검색(searchBook)은 사람이 친 말이 아니므로 세지 않는다
      if (e && e.isTrusted === false) return;
      clearTimeout(timer);
      timer = setTimeout(flush, 1200);
    });
    input.addEventListener('blur', function () { setTimeout(flush, 200); });
    document.addEventListener('visibilitychange', function () { if (document.hidden) flush(); });

    // 검색 뒤 결과 카드를 눌렀는지 (검색어마다 한 번)
    document.addEventListener('click', function (e) {
      var el = e.target && e.target.closest ? e.target.closest('a, button[data-reader]') : null;
      if (!el || !el.closest(cfg.results)) return;
      var t = flush();
      if (t.length < 2 || t === clicked) return;
      clicked = t;
      post('/search', { kind: 'c', q: t });
    });
  }

  function start() {
    countView();
    MAIN_SEARCH.forEach(bindSearch);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
