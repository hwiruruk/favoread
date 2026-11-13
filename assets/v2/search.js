// 새 디자인 공용 검색. 페이지 어디든 <div class="site-search"></div> 를 두면
// 그 자리에 검색창이 생긴다. 이름·책 제목·저자로 찾아 셀럽 페이지나 책 페이지로 보낸다.
// data.json(약 1MB)은 검색창에 처음 들어올 때 한 번만 받는다.
(function () {
  var slots = document.querySelectorAll('.site-search');
  if (!slots.length) return;

  var css = document.createElement('style');
  css.textContent =
    '.site-search{position:relative;width:min(340px,100%)}' +
    '.site-search input{width:100%;font:inherit;font-size:14px;padding:12px 20px;border-radius:99px;border:1px solid var(--border);background:var(--bg);color:var(--ink);outline:none;-webkit-appearance:none}' +
    '.site-search input:focus{border-color:var(--ink)}' +
    '.site-search.sm{width:min(220px,100%)}' +
    '.site-search.sm input{font-size:13px;padding:8px 16px}' +
    '.ss-box{position:absolute;z-index:50;top:calc(100% + 6px);right:0;width:max(100%,300px);max-width:calc(100vw - 32px);background:var(--bg);border:1px solid var(--ink);border-radius:16px;text-align:left;overflow:hidden;display:none;box-shadow:0 12px 32px rgba(0,0,0,.12)}' +
    '.ss-box.open{display:block}' +
    '.ss-box a{display:flex;justify-content:space-between;align-items:baseline;gap:12px;padding:10px 16px;font-size:14px;color:var(--ink);text-decoration:none}' +
    '.ss-box a:hover,.ss-box a.on{background:var(--hover)}' +
    '.ss-box a span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '.ss-box small{color:var(--muted);white-space:nowrap;font-size:12px}' +
    '.ss-box .none{padding:12px 16px;font-size:13px;color:var(--muted)}' +
    '@media (max-width:720px){.site-search.sm{width:100%}.ss-box{left:0;right:auto}}';
  document.head.appendChild(css);

  var esc = function (s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var norm = function (s) { return String(s).toLowerCase().replace(/\s+/g, ''); };
  var celebUrl = function (n) { return '/share/' + encodeURIComponent(n.replace(/[\/\\]/g, '_')) + '.html'; };
  var bookUrl = function (t) { return '/share/book/' + encodeURIComponent(t.replace(/[\/\\:"?]/g, '_')) + '.html'; };

  // 영문판(<html lang="en">)은 생성기가 만들어 둔 영문 색인을 쓴다.
  var EN = document.documentElement.lang === 'en';
  var T = EN
    ? { ph: 'Search a star or a book', loading: 'Loading…', fail: 'Search is unavailable right now. Please try again shortly.', none: 'No results. Try another name or title.' }
    : { ph: '최애 이름이나 책 제목 검색', loading: '불러오는 중이에요…', fail: '검색 데이터를 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.', none: '찾는 결과가 없어요. 다른 이름이나 제목으로 검색해 보세요.' };

  var index = null, loading = null;
  function load() {
    if (index) return Promise.resolve(index);
    if (loading) return loading;
    if (EN) {
      loading = fetch('/assets/v2/search-en.json').then(function (r) { return r.json(); }).then(function (rows) {
        index = rows.map(function (r) { return { label: r[0], key: r[1], meta: r[2], href: r[3], rank: r[4], n: r[5] }; });
        return index;
      });
      return loading;
    }
    loading = fetch('/data.json').then(function (r) { return r.json(); }).then(function (data) {
      var celebs = data.celebs || {}, books = {}, list = [];
      Object.keys(celebs).forEach(function (n) {
        var bs = celebs[n].books || [];
        list.push({ key: norm(n + (celebs[n].nameEn || '')), label: n, meta: bs.length + '권', href: celebUrl(n), rank: 0 });
        bs.forEach(function (b) {
          if (!b.title) return;
          var e = books[b.title] || (books[b.title] = { author: b.author || '', en: b.title_en || '', readers: [] });
          if (e.readers.indexOf(n) < 0) e.readers.push(n);
        });
      });
      Object.keys(books).forEach(function (t) {
        var e = books[t];
        // 책 페이지는 2명 이상 읽은 책에만 있다. 한 명만 읽은 책은 그 사람 페이지로 보낸다.
        list.push({
          key: norm(t + e.en), akey: norm(e.author), label: t,
          meta: e.readers.length >= 2 ? e.readers.length + '명이 읽음' : e.readers[0] + ' 읽음',
          href: e.readers.length >= 2 ? bookUrl(t) : celebUrl(e.readers[0]), rank: 1, n: e.readers.length
        });
      });
      index = list;
      return list;
    });
    return loading;
  }

  function find(term) {
    var hits = [];
    for (var i = 0; i < index.length; i++) {
      var x = index[i], score = -1;
      if (x.key.indexOf(term) === 0) score = 0;
      else if (x.key.indexOf(term) > 0) score = 1;
      else if (x.akey && x.akey.indexOf(term) >= 0) score = 2;
      if (score >= 0) hits.push([score, x]);
    }
    // 이름·제목 앞부분이 맞는 것 먼저, 사람 먼저, 책은 많이 읽힌 순
    hits.sort(function (a, b) { return a[0] - b[0] || a[1].rank - b[1].rank || (b[1].n || 0) - (a[1].n || 0); });
    return hits.slice(0, 8).map(function (h) { return h[1]; });
  }

  [].forEach.call(slots, function (slot) {
    slot.innerHTML =
      '<input type="search" autocomplete="off" placeholder="' + T.ph + '" aria-label="' + T.ph + '">' +
      '<div class="ss-box" role="listbox"></div>';
    var q = slot.querySelector('input'), box = slot.querySelector('.ss-box'), on = -1;

    function render() {
      var term = norm(q.value);
      on = -1;
      if (!term) { box.classList.remove('open'); return; }
      if (!index) {
        box.innerHTML = '<div class="none">' + T.loading + '</div>';
        box.classList.add('open');
        load().then(render, function () { box.innerHTML = '<div class="none">' + T.fail + '</div>'; });
        return;
      }
      var hits = find(term);
      box.innerHTML = hits.length
        ? hits.map(function (h) { return '<a href="' + h.href + '"><span>' + esc(h.label) + '</span><small>' + esc(h.meta) + '</small></a>'; }).join('')
        : '<div class="none">' + T.none + '</div>';
      box.classList.add('open');
    }
    function move(d) {
      var as = box.querySelectorAll('a');
      if (!as.length) return;
      if (as[on]) as[on].classList.remove('on');
      on = (on + d + as.length) % as.length;
      as[on].classList.add('on');
    }

    q.addEventListener('focus', function () { load().catch(function () {}); render(); });
    q.addEventListener('input', render);
    q.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
      else if (e.key === 'Enter') { var a = box.querySelector('a.on') || box.querySelector('a'); if (a) location.href = a.href; }
      else if (e.key === 'Escape') { box.classList.remove('open'); q.blur(); }
    });
    document.addEventListener('click', function (e) { if (!slot.contains(e.target)) box.classList.remove('open'); });
  });
})();
