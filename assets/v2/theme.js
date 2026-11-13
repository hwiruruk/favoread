// 새 디자인의 밝은/어두운 화면 전환. <head>에서 바로 실행해 화면이 깜빡이지 않게 한다.
// 고른 값은 이 브라우저에 기억한다. 주소 뒤에 ?theme=dark / ?theme=light 를 붙여도 된다.
(function () {
  var KEY = 'favorbook-theme';
  var root = document.documentElement;
  var stored = null;
  try { stored = localStorage.getItem(KEY); } catch (e) {}
  var asked = (location.search.match(/[?&]theme=(dark|light)/) || [])[1];
  var theme = asked || stored || 'light';
  root.setAttribute('data-theme', theme);
  if (asked) { try { localStorage.setItem(KEY, asked); } catch (e) {} }

  document.addEventListener('DOMContentLoaded', function () {
    var slot = document.querySelector('.bar .right');
    if (!slot) return;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'theme-btn';
    var paint = function () {
      var dark = root.getAttribute('data-theme') === 'dark';
      var en = root.lang === 'en';
      btn.textContent = dark ? (en ? '☀ Light' : '☀ 밝게') : (en ? '☾ Dark' : '☾ 어둡게');
      btn.setAttribute('aria-label', dark
        ? (en ? 'Switch to light mode' : '밝은 화면으로 바꾸기')
        : (en ? 'Switch to dark mode' : '어두운 화면으로 바꾸기'));
    };
    btn.addEventListener('click', function () {
      var next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      try { localStorage.setItem(KEY, next); } catch (e) {}
      paint();
    });
    paint();
    slot.appendChild(btn);
  });
})();
