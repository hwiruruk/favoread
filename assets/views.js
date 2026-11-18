/*
 * 페이지 조회수 보내기 — tools/hearts-worker/ 의 /view 로 한 번 알린다.
 * GA와 달리 광고 차단기에 덜 가려지고, 주소·날짜별 횟수만 서버에 남는다.
 * 같은 탭에서 같은 페이지를 다시 열어도 한 번만 센다(sessionStorage).
 */
(function () {
  'use strict';
  var API = (window.FAVOR_HEARTS_API || 'https://favorbook-hearts.twinwhee.workers.dev').replace(/\/+$/, '');
  if (!API || /^(localhost|127\.0\.0\.1)$/.test(location.hostname)) return;
  if (navigator.webdriver) return;

  var path = location.pathname.replace(/index\.html$/, '');
  var key = 'favorbook-view:' + path;
  try {
    if (window.sessionStorage.getItem(key)) return;
    window.sessionStorage.setItem(key, '1');
  } catch (e) {}

  function send() {
    var body = JSON.stringify({ path: path });
    try {
      if (navigator.sendBeacon && navigator.sendBeacon(API + '/view', new Blob([body], { type: 'text/plain' }))) return;
    } catch (e) {}
    try {
      fetch(API + '/view', { method: 'POST', body: body, headers: { 'Content-Type': 'text/plain' }, keepalive: true });
    } catch (e) {}
  }

  // 열자마자 닫는 방문까지 세려고 로드 직후에 보낸다. 화면이 숨겨진 채 열린 탭은 보일 때까지 기다린다.
  if (document.visibilityState === 'prerender' || document.hidden) {
    document.addEventListener('visibilitychange', function once() {
      if (!document.hidden) { document.removeEventListener('visibilitychange', once); send(); }
    });
  } else {
    send();
  }
})();
