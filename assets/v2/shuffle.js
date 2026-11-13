// 새 디자인: 들어올 때마다 다른 것을 보여 주는 자리.
// <div data-pick="5"> 안의 후보를 섞어 앞의 5개만 보이게 한다(나머지는 .hid).
// 스크립트가 돌지 않아도 생성기가 정해 둔 처음 5개는 그대로 보인다.
(function () {
  [].forEach.call(document.querySelectorAll('[data-pick]'), function (box) {
    var n = parseInt(box.getAttribute('data-pick'), 10) || 0;
    var items = [].slice.call(box.children);
    for (var i = items.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = items[i]; items[i] = items[j]; items[j] = t;
    }
    items.forEach(function (el, k) {
      el.classList.toggle('hid', k >= n);
      box.appendChild(el);
    });
  });
})();
