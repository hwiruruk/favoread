/* ========================================================
   Favorbook 카드뉴스 빌더
   인물 검색 → 읽은 책/출처 불러오기 → antiegg 풍 인스타 카드
   (표지 · 본문 · 출처 · 홍보) 생성 → PNG/ZIP 내보내기
   ======================================================== */
'use strict';

const OUTPUT_SCALE = 2;
const DEFAULT_SELECT = 5;
const PROXY = 'https://images.weserv.nl/?url=';

/* ---------- 배경 프리셋 ---------- */
const SWATCHES = [
  '#f4f1e9', '#faf8f3', '#efe7d6', '#f0e6e1',
  '#e4e8e0', '#e2e8ec', '#1f1d18', '#14110d',
  '#fff6cc', '#ffe3ec', '#dff3ff', '#0e0b1f',
];

/* ---------- 글자색 프리셋 ---------- */
const INK_SWATCHES = [
  '#181511', '#000000', '#3b332c', '#2b2a4a',
  '#7a1f3d', '#1f4d3d', '#f1ece0', '#ffffff',
];

/* ---------- 포인트 색 프리셋 ---------- */
const ACCENT_SWATCHES = [
  '#ff4d6d', '#ff8a3d', '#ffd23f', '#3ddc84',
  '#4cc9f0', '#8b5cf6', '#e2483d', '#8a7b63',
];

/* ---------- Z세대 테마 (레이아웃 + 색 + 폰트) ----------
   각 테마는 .cn-slide 에 th-{key} 클래스를 붙여 styles.css 가 마감을 담당한다.
   테마를 고르면 배경/포인트 색이 그 테마 기본값으로 초기화된다. */
const THEMES = {
  editorial: { label: '에디토리얼', emoji: '📰', desc: '잡지풍 기본', bg: '#f4f1e9', accent: '#8a7b63' },
  pop:       { label: '스티커 팝',  emoji: '⭐', desc: '두꺼운 테두리·그림자', bg: '#fff6cc', accent: '#ff4d6d' },
  y2k:       { label: 'Y2K 사이버', emoji: '💿', desc: '네온 다크', bg: '#0e0b1f', accent: '#8b5cf6' },
  diary:     { label: '다이어리',   emoji: '✏️', desc: '손글씨 · 폴라로이드', bg: '#fdf4ee', accent: '#7fb069' },
  zine:      { label: '뉴트로 진',  emoji: '🗞', desc: '흑백 편집숍', bg: '#ecebe6', accent: '#e2483d' },
};
const THEME_KEYS = Object.keys(THEMES);

/* ---------- 다국어 문구 ---------- */
const L = {
  ko: {
    brand: '최애의 독서',
    tagline: '당신이 좋아하는, 그들이 읽은 책',
    book: 'BOOK', source: 'SOURCE', books: 'BOOKS',
    sources: '출처', imgGroup: '이미지', txtGroup: '텍스트',
    bookCredit: (names) => `도서 이미지 ⓒ ${names}`,
    coverPhoto: '표지 사진',
    promoTag: '당신이 좋아하는, 그들이 읽은 책',
    promoStat: (c, b) => `셀럽 ${c.toLocaleString()}명의 책 ${b.toLocaleString()}권을 만나보세요`,
    promoCta: '더 보러 가기',
    title: (n) => `${n}의 책장`,
    subtitle: (n, c) => `${josa(n, '이', '가')} 읽은 책 ${c}권`,
    noSrc: '출처 미상',
  },
  en: {
    brand: 'FAVORBOOK',
    tagline: 'The books your faves are reading',
    book: 'BOOK', source: 'SOURCE', books: 'BOOKS',
    sources: 'Sources', imgGroup: 'Images', txtGroup: 'Text',
    bookCredit: (names) => `Book images ⓒ ${names}`,
    coverPhoto: 'Cover photo',
    promoTag: 'The books your faves are reading',
    promoStat: (c, b) => `Discover ${b.toLocaleString()} books from ${c} celebrities`,
    promoCta: 'Explore more',
    title: (n) => `${n}'s Bookshelf`,
    subtitle: (n, c) => `${c} books ${n} read`,
    noSrc: 'Source unknown',
  },
};
const T = () => L[state.opts.lang];

/* ---------- 상태 ---------- */
const state = {
  data: null,
  celebCount: 0,
  bookCount: 0,
  name: '',
  celeb: null,
  customImage: null,
  autoText: true,           // 제목/부제 자동 채움 여부
  stickerScope: null,       // 스티커를 올릴 장
  selSticker: null,         // { sscope, id } — 지금 고른 스티커
  books: [],
  opts: {
    lang: 'ko',
    theme: 'editorial',
    format: 'portrait',
    coverLayout: 'split',   // split(좌우) | stack(상하)
    fit: 'cover',           // 인물 사진: cover(채움) | contain(전체)
    bg: '#f4f1e9',
    inkAuto: true,          // 글자색 자동(배경 명도 기준)
    ink: '#181511',         // 자동이 아닐 때 쓸 글자색
    accentAuto: true,       // 포인트 색 테마 기본값 사용
    accent: '#ff4d6d',
    coverPhoto: { x: 50, y: 50, zoom: 1 },  // 표지 인물 사진 초점·확대 (마우스로 조정)
    adj: {},                // 표지 슬라이드 요소별 마우스 조정값
    stickers: {},           // 장(scope)별 스티커 목록 — '함께 읽기 카드'와 같은 자유 배치 레이어
    stickerSeq: 1,
    mono: false,
    covers: true,           // 표지에 책 표지 노출
    bookGrid: true,         // (구버전 호환) 그리드 여부 — 새 파일은 bookCols를 본다
    bookCols: 2,            // 표지 그리드 열 수 0=한 줄 | 2 | 3 | 4
    bookFace: 'spine',      // 표지 장에서 책을 어떻게 — 'spine'(책등) | 'cover'(표지)
    imgPos: 'center',       // 표지 사진 세로 위치 top|center|bottom
    noImage: false,         // 표지 사진 비우고 프레임만
    outro: true,
    promo: true,
    proxy: true,
    title: '',
    subtitle: '',
    coverSrc: '',
    handle: 'favorbook.co.kr',
  },
};

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
/* 엔터(줄바꿈)를 카드에 그대로 반영 */
const escML = (s) => esc(s).replace(/\r\n|\r|\n/g, '<br>');
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

/* ---------- 색상 유틸 (배경에 맞춰 글자색 자동) ---------- */
function hexToRgb(h) {
  const c = h.replace('#', '');
  return [parseInt(c.slice(0, 2), 16), parseInt(c.slice(2, 4), 16), parseInt(c.slice(4, 6), 16)];
}
function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('');
}
function mix(a, b, t) {
  const [r1, g1, b1] = hexToRgb(a), [r2, g2, b2] = hexToRgb(b);
  return rgbToHex(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t);
}
function luminance(h) {
  const [r, g, b] = hexToRgb(h).map((x) => {
    x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
/* 어떤 바탕색 위에 글자를 얹을 때 읽히는 색 */
const onColor = (bg) => (luminance(bg) < 0.5 ? '#ffffff' : '#141414');

function paletteFor(bg, inkOverride) {
  const dark = luminance(bg) < 0.42;
  const ink = /^#[0-9a-f]{6}$/i.test(inkOverride || '')
    ? inkOverride
    : (dark ? '#f1ece0' : '#181511');
  return {
    '--paper': bg,
    '--ink': ink,
    '--soft': mix(bg, ink, dark ? 0.72 : 0.66),
    '--mute': mix(bg, ink, dark ? 0.5 : 0.45),
    '--line': mix(bg, ink, dark ? 0.26 : 0.2),
    '--panel': bg,          // 이미지 상자의 빈 공간은 배경색과 같게
  };
}

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
  ['ch.yes24.com', '채널예스', '웹'],
  ['yes24.com', '예스24', '도서플랫폼'],
  ['millie.co.kr', '밀리의 서재', '도서플랫폼'],
  ['kyobobook', '교보문고', '도서플랫폼'],
  ['aladin.co.kr', '알라딘', '도서플랫폼'],
  ['ridibooks.com', '리디', '도서플랫폼'],
  ['munhak.com', '문학동네', '도서플랫폼'],
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
  ['imbc.com', 'MBC', '방송'],
  ['kbs.co.kr', 'KBS', '방송'],
  ['sbs.co.kr', 'SBS', '방송'],
  ['jtbc', 'JTBC', '방송'],
  ['tvn', 'tvN', '방송'],
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
  ['wikimedia.org', '위키미디어 커먼즈', '이미지'],
  ['wikipedia.org', '위키백과', '이미지'],
  ['namu.wiki', '나무위키', '이미지'],
  ['tmdb', 'TMDB', '이미지'],
  ['talkimg.imbc.com', 'MBC', '방송'],
];

/* 계정명으로 볼 수 없는 경로 조각 (섹션·기능 이름) */
const NOT_HANDLE = new Set([
  'p', 'reel', 'reels', 'tv', 'explore', 'stories', 'accounts', 'direct',
  'watch', 'shorts', 'embed', 'channel', 'playlist', 'results', 'feed',
  'i', 'home', 'search', 'hashtag', 'intent', 'share', 'status',
  'video', 'photo', 'tag', 'about', 'post', 'posts', 'article', 'news',
  'square', 'board', 'view', 'read', 'list', 'index', 'main', 'shop', 'm',
]);

/* URL 경로에서 계정명(@) 뽑기 */
function detectHandle(u, host) {
  let seg = [];
  try { seg = new URL(u).pathname.split('/').filter(Boolean).map(decodeURIComponent); }
  catch { return ''; }
  const at = seg.find((x) => x.startsWith('@') && x.length > 1);     // /@handle 형태
  if (at) return at;
  const first = seg[0] || '';
  const ok = (x) => x && !NOT_HANDLE.has(x.toLowerCase()) && !/^\d+$/.test(x) && x.length <= 40;

  if (/tistory\.com$/.test(host)) {
    const sub = host.replace(/\.tistory\.com$/, '');
    return sub && sub !== 'www' ? '@' + sub : '';
  }
  if (/instagram\.com$/.test(host) || /threads\.net$/.test(host)) return ok(first) ? '@' + first : '';
  if (/(twitter\.com|x\.com)$/.test(host)) return ok(first) ? '@' + first : '';
  if (/tiktok\.com$/.test(host)) return ok(first) ? '@' + first : '';
  if (/blog\.naver\.com$/.test(host) || /post\.naver\.com$/.test(host)) return ok(first) ? '@' + first : '';
  if (/cafe\.naver\.com$/.test(host)) return ok(first) ? '@' + first : '';
  if (/brunch\.co\.kr$/.test(host)) return ok(first) ? '@' + first : '';
  if (/weverse\.io$/.test(host)) return ok(first) ? '@' + first : '';
  if (/youtube\.com$/.test(host)) {
    const i = seg.findIndex((x) => x === 'c' || x === 'user');
    return i >= 0 && ok(seg[i + 1]) ? '@' + seg[i + 1] : '';
  }
  return '';
}

/* URL 슬러그에서 페이지 제목 짐작하기 (한글 슬러그가 있는 매거진·블로그에 잘 맞음)
   글 번호·게시물 ID 같은 건 제목이 아니므로 버린다.
   받아들이는 건 (1) 한글이 들어간 슬러그 또는 (2) 단어가 둘 이상인 영문 슬러그뿐. */
function detectTitleFromUrl(u, handle) {
  let seg = [];
  try { seg = new URL(u).pathname.split('/').filter(Boolean); } catch { return ''; }
  const bare = String(handle || '').replace(/^@/, '').toLowerCase();
  for (let i = seg.length - 1; i >= 0 && i >= seg.length - 2; i--) {
    let t = seg[i];
    try { t = decodeURIComponent(t); } catch { /* 그대로 */ }
    t = t.replace(/\.(html?|php|aspx?|jsp)$/i, '')
      .replace(/[-_+]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!t) continue;
    if (NOT_HANDLE.has(t.toLowerCase())) continue;
    if (bare && t.toLowerCase().replace(/^@/, '') === bare) continue;   // 계정명과 같으면 제목이 아님
    if (!/[A-Za-z가-힣]/.test(t)) continue;                              // 글자가 없으면 버림
    const hangul = /[가-힣]/.test(t);
    const words = t.split(' ').filter(Boolean);
    if (!hangul) {
      if (words.length < 2) continue;                                   // 한 덩어리 영문 = 대개 ID
      if (words.some((w) => /\d/.test(w) && /[A-Za-z]/.test(w))) continue; // 영문+숫자 뒤섞이면 ID
      if (words.every((w) => w.length <= 2)) continue;
    }
    if (t.replace(/\s/g, '').length < 4) continue;
    if (t.length > 90) t = t.slice(0, 90).trim() + '…';
    return t;
  }
  return '';
}

function detectSource(url) {
  const u = cleanUrl(url);
  let host = '';
  try { host = new URL(u).hostname.replace(/^www\.|^m\./, ''); } catch { /* ignore */ }
  let name = host || '', type = '웹';
  for (const [needle, n, t] of SRC_MAP) {
    if (u.includes(needle)) { name = n; type = t; break; }
  }
  let date = '';
  let m = u.match(/\/(20\d{2})[\/\-_.](\d{1,2})[\/\-_.](\d{1,2})(?:\D|$)/);
  if (!m) m = u.match(/(?:^|\D)(20\d{2})(\d{2})(\d{2})(?:\D|$)/);
  if (m) {
    const mm = m[2].padStart(2, '0'), dd = m[3].padStart(2, '0');
    if (+mm >= 1 && +mm <= 12 && +dd >= 1 && +dd <= 31) date = `${m[1]}.${mm}.${dd}`;
  }
  const handle = detectHandle(u, host);
  return { name, type, date, handle, title: detectTitleFromUrl(u, handle) };
}

/* ---------- 영상 제목·채널 가져오기 (oEmbed, 브라우저에서 바로 호출 가능) ----------
   유튜브·비메오는 공개 oEmbed 를 열어 두어서 제목과 채널명을 그대로 받을 수 있다.
   실패하면(오프라인·차단) URL에서 뽑은 값을 그대로 쓴다. */
const oembedCache = Object.create(null);

function oembedEndpoint(u) {
  if (/(?:youtube\.com|youtu\.be)/i.test(u)) {
    return `https://www.youtube.com/oembed?url=${encodeURIComponent(u)}&format=json`;
  }
  if (/vimeo\.com/i.test(u)) {
    return `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(u)}`;
  }
  return '';
}
async function fetchOEmbed(url) {
  const u = cleanUrl(url);
  const ep = oembedEndpoint(u);
  if (!ep) return null;
  if (oembedCache[u] !== undefined) return oembedCache[u];
  try {
    const res = await fetch(ep, { cache: 'force-cache' });
    if (!res.ok) throw new Error('oembed ' + res.status);
    const j = await res.json();
    let author = String(j.author_name || '').trim();
    // 핸들처럼 생겼을 때만 @ 를 붙인다 (채널 표시 이름은 그대로)
    if (author && !author.startsWith('@') && /^[A-Za-z0-9._-]+$/.test(author)) author = '@' + author;
    const out = { title: String(j.title || '').trim(), author };
    oembedCache[u] = out;
    return out;
  } catch (e) {
    oembedCache[u] = null;
    return null;
  }
}

/* ---------- 한글 → 영문 이름 (로마자) ---------- */
const RR_INI = ['g', 'kk', 'n', 'd', 'tt', 'r', 'm', 'b', 'pp', 's', 'ss', '', 'j', 'jj', 'ch', 'k', 't', 'p', 'h'];
const RR_MED = ['a', 'ae', 'ya', 'yae', 'eo', 'e', 'yeo', 'ye', 'o', 'wa', 'wae', 'oe', 'yo', 'u', 'wo', 'we', 'wi', 'yu', 'eu', 'ui', 'i'];
const RR_FIN = ['', 'k', 'k', 'k', 'n', 'n', 'n', 't', 'l', 'k', 'm', 'l', 'l', 'l', 'p', 'l', 'm', 'p', 'p', 't', 't', 'ng', 't', 't', 'k', 't', 'p', 't'];
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const hasHangul = (s) => /[가-힣]/.test(s);
function romanizeWord(s) {
  let out = '';
  for (const ch of String(s)) {
    const c = ch.charCodeAt(0);
    if (c >= 0xac00 && c <= 0xd7a3) {
      const x = c - 0xac00;
      out += RR_INI[Math.floor(x / 588)] + RR_MED[Math.floor((x % 588) / 28)] + RR_FIN[x % 28];
    } else out += ch;
  }
  return out;
}
const SURNAME = { '김': 'Kim', '이': 'Lee', '박': 'Park', '최': 'Choi', '정': 'Jung', '강': 'Kang', '조': 'Cho', '윤': 'Yoon', '장': 'Jang', '임': 'Lim', '한': 'Han', '오': 'Oh', '서': 'Seo', '신': 'Shin', '권': 'Kwon', '황': 'Hwang', '안': 'Ahn', '송': 'Song', '전': 'Jeon', '홍': 'Hong', '유': 'Yoo', '고': 'Ko', '문': 'Moon', '양': 'Yang', '손': 'Son', '배': 'Bae', '백': 'Baek', '허': 'Heo', '노': 'Noh', '심': 'Shim', '하': 'Ha', '곽': 'Kwak', '성': 'Sung', '차': 'Cha', '주': 'Joo', '우': 'Woo', '구': 'Koo', '민': 'Min', '류': 'Ryu', '나': 'Na', '진': 'Jin', '지': 'Ji', '엄': 'Eom', '채': 'Chae', '원': 'Won', '천': 'Cheon', '방': 'Bang', '공': 'Kong', '현': 'Hyun', '함': 'Ham', '변': 'Byun', '염': 'Yeom', '여': 'Yeo', '추': 'Chu', '도': 'Do', '소': 'So', '석': 'Seok', '선': 'Sun', '설': 'Seol', '마': 'Ma', '길': 'Gil', '연': 'Yeon', '위': 'Wi', '표': 'Pyo', '명': 'Myung', '기': 'Ki', '반': 'Ban', '라': 'Ra', '왕': 'Wang', '옥': 'Ok', '육': 'Yook', '인': 'In', '제': 'Je', '모': 'Mo', '남': 'Nam', '탁': 'Tak', '국': 'Kook', '은': 'Eun', '편': 'Pyun', '용': 'Yong', '예': 'Ye', '봉': 'Bong' };
const COMPOUND = { '남궁': 'Namgung', '황보': 'Hwangbo', '선우': 'Sunwoo', '제갈': 'Jegal', '독고': 'Dokgo', '서문': 'Seomun', '사공': 'Sagong' };
function romanizeName(full) {
  const base = displayName(full);
  if (!hasHangul(base)) return base;
  if (/\(/.test(full)) return cap(romanizeWord(base));   // 괄호 = 활동명(모노님)
  let sur, given;
  if (base.length >= 3 && COMPOUND[base.slice(0, 2)]) { sur = COMPOUND[base.slice(0, 2)]; given = base.slice(2); }
  else { sur = SURNAME[base[0]] || cap(romanizeWord(base[0])); given = base.slice(1); }
  if (!given) return sur;
  const g = [...given].map((ch) => romanizeWord(ch)).filter(Boolean);
  return `${sur} ${g.map((x, i) => (i === 0 ? cap(x) : x)).join('-')}`;
}
function enName() { return state.opts.lang === 'en' ? romanizeName(state.name) : displayName(state.name); }

/* ---------- 출처 매체명 한글 → 영문 ---------- */
const SRC_EN = [
  ['위키미디어 커먼즈', 'Wikimedia Commons'], ['네이버 블로그', 'Naver blog'], ['네이버 포스트', 'Naver post'],
  ['네이버 카페', 'Naver cafe'], ['네이버 뉴스', 'Naver News'], ['밀리의 서재', 'Millie'], ['채널예스', 'Channel Yes'],
  ['교보문고', 'Kyobo Book'], ['엑스포츠뉴스', 'Xportsnews'], ['스포츠조선', 'Sports Chosun'], ['마이데일리', 'MyDaily'],
  ['디시인사이드', 'DCinside'], ['에펨코리아', 'FM Korea'], ['인스타그램', 'Instagram'], ['유튜브', 'YouTube'],
  ['트위터', 'Twitter'], ['더쿠', 'theqoo'], ['브런치', 'Brunch'], ['티스토리', 'Tistory'], ['위버스', 'Weverse'],
  ['틱톡', 'TikTok'], ['씨네21', 'Cine21'], ['예스24', 'Yes24'], ['알라딘', 'Aladin'], ['리디', 'Ridi'],
  ['문학동네', 'Munhakdongne'], ['서울경제', 'Seoul Economic Daily'], ['한국경제', 'Korea Economic Daily'],
  ['매일경제', 'Maeil Business'], ['조선일보', 'Chosun Ilbo'], ['동아일보', 'Donga Ilbo'], ['중앙일보', 'JoongAng Ilbo'],
  ['한겨레', 'Hankyoreh'], ['경향신문', 'Kyunghyang Shinmun'], ['한국일보', 'Hankook Ilbo'], ['서울신문', 'Seoul Shinmun'],
  ['국민일보', 'Kookmin Ilbo'], ['데일리안', 'Dailian'], ['뉴스엔', 'Newsen'], ['텐아시아', 'TenAsia'],
  ['나무위키', 'Namuwiki'], ['위키백과', 'Wikipedia'], ['다음', 'Daum'], ['엑스', 'X'],
].sort((a, b) => b[0].length - a[0].length);
function translateSourceEn(str) {
  let s = String(str || '');
  for (const [ko, en] of SRC_EN) if (s.includes(ko)) s = s.split(ko).join(en);
  return s;
}
const srcDisp = (name) => (state.opts.lang === 'en' ? translateSourceEn(name) : name);

/* 카드 출처 줄: 매체명 · @계정 · 날짜  /  아래에 「페이지 제목」 */
function citeParts(b) {
  const head = [];
  if (b.srcName) head.push(`<b>${esc(srcDisp(b.srcName))}</b>`);
  if (b.srcHandle) head.push(esc(b.srcHandle));
  if (b.srcDate) head.push(esc(b.srcDate));
  const line1 = head.join(' · ');
  const line2 = b.srcTitle ? `<span class="cn-cite-t">「${esc(b.srcTitle)}」</span>` : '';
  if (!line1 && !line2) return '';
  return (line1 ? `<span class="cn-cite-m">${line1}</span>` : '') + line2;
}
/* 글로 옮길 때 (출처 슬라이드·원고 복사) */
function citeText(b) {
  const parts = [];
  if (b.srcName) parts.push(srcDisp(b.srcName.trim()));
  if (b.srcHandle) parts.push(b.srcHandle.trim());
  if (b.srcDate) parts.push(b.srcDate.trim());
  const head = parts.join(' · ');
  return b.srcTitle ? `${head}${head ? ' · ' : ''}「${b.srcTitle.trim()}」` : head;
}
const citeHead = (b) => [b.srcName ? srcDisp(b.srcName.trim()) : '', b.srcHandle, b.srcDate]
  .filter(Boolean).join(' · ');

/* ========================================================
   부트
   ======================================================== */
/* ========================================================
   되돌리기 · 단축키
   상태가 작아서 통째로 찍어 쌓는 방식이 가장 간단하고 안전하다.
   끌거나 슬라이더를 미는 동안에는 같은 키로 묶어 한 동작 = 한 번 되돌리기가 되게 한다.
   ======================================================== */
const UNDO_MAX = 60;
const undoStack = [];
const redoStack = [];
let undoAt = 0;

/* 올린 사진은 data: 주소라 그대로 담으면 한 장 찍을 때마다 수 MB가 복사된다.
   문자열 하나만 따로 모아 두고 자리표시자로 바꿔 둔다. */
const BIG_TAG = '__bigref__';
const bigRefs = [];
const packBig = (v) => {
  if (typeof v !== 'string' || !v.startsWith('data:')) return v;
  let i = bigRefs.indexOf(v);
  if (i < 0) i = bigRefs.push(v) - 1;
  return BIG_TAG + i;
};
const unpackBig = (v) =>
  (typeof v === 'string' && v.startsWith(BIG_TAG)) ? bigRefs[+v.slice(BIG_TAG.length)] : v;

/* 되돌릴 대상만 골라 찍는다 — data.json 원본은 뺀다.
   담는 항목은 프로젝트 저장(saveProject)과 같은 것들이다. */
function snapshot() {
  return JSON.stringify({
    opts: state.opts,
    autoText: state.autoText,
    customImage: state.customImage,
    stickerScope: state.stickerScope,
    selSticker: state.selSticker,
    books: state.books.map((b) => ({
      selected: b.selected, quote: b.quote, noQuote: b.noQuote,
      srcName: b.srcName, srcHandle: b.srcHandle, srcTitle: b.srcTitle, srcDate: b.srcDate,
      photo: b.photo || null,
      adj: b.adj || {},
    })),
  }, (k, v) => packBig(v));
}

function applySnapshot(json) {
  const o = JSON.parse(json, (k, v) => unpackBig(v));
  state.opts = o.opts;
  state.autoText = o.autoText;
  state.customImage = o.customImage;
  state.stickerScope = o.stickerScope;
  state.selSticker = o.selSticker;
  (o.books || []).forEach((m, i) => {
    const b = state.books[i];
    if (!b) return;
    b.selected = m.selected; b.quote = m.quote; b.noQuote = m.noQuote;
    b.srcName = m.srcName; b.srcHandle = m.srcHandle;
    b.srcTitle = m.srcTitle; b.srcDate = m.srcDate;
    b.photo = m.photo || null;
    b.adj = m.adj || {};
  });
  const thumb = $('#celebThumb');
  if (thumb) thumb.src = state.customImage || (state.celeb ? proxify(state.celeb.imageUrl) : '');
  syncControls();
  renderBookList();
  renderPreview();
}

/* 바뀌기 '직전'을 찍어 두되, 바로 쌓지 않고 한 칸(pending)에 들고 있는다.
   다음에 또 부를 때 그 사이에 실제로 바뀐 게 있을 때만 쌓는다 —
   아무것도 안 바꾼 클릭까지 되돌리기 목록에 들어가 Ctrl+Z가 헛도는 걸 막는다.
   key를 주면 잠깐 사이에 같은 key로 또 부를 때 묶는다 (드래그·슬라이더용). */
let pending = null;

function flushUndo() {
  if (!pending) return;
  if (pending.snap !== snapshot()) {
    undoStack.push(pending.snap);
    if (undoStack.length > UNDO_MAX) undoStack.shift();
    redoStack.length = 0;
  }
  pending = null;
}

function pushUndo(key) {
  if (!state.celeb) return;
  const now = Date.now();
  if (pending && key && key === pending.key && now - undoAt < 700) { undoAt = now; return; }
  flushUndo();
  undoAt = now;
  pending = { key: key || null, snap: snapshot() };
}

/* 최애를 바꾸면 이전 셀럽 기준으로 찍어 둔 것은 못 쓴다 — 목록을 비운다 */
function resetUndo() {
  undoStack.length = 0;
  redoStack.length = 0;
  pending = null;
}

/* 같은 상태가 겹쳐 쌓였으면 건너뛴다 (안전망) */
function popDifferent(stack, cur) {
  while (stack.length) { const s = stack.pop(); if (s !== cur) return s; }
  return null;
}

function undo() {
  flushUndo();
  const cur = snapshot();
  const prev = popDifferent(undoStack, cur);
  if (prev === null) { status('되돌릴 게 없어요'); return; }
  redoStack.push(cur);
  applySnapshot(prev);
  status('되돌렸어요 (Ctrl+Shift+Z로 다시)');
}

function redo() {
  flushUndo();
  const cur = snapshot();
  const next = popDifferent(redoStack, cur);
  if (next === null) { status('다시 할 게 없어요'); return; }
  undoStack.push(cur);
  applySnapshot(next);
  status('다시 했어요');
}

function duplicateSticker() {
  const it = selSticker();
  if (!it) return;
  pushUndo();
  const sscope = state.selSticker.sscope;
  const copy = {
    ...it,
    id: 's' + (state.opts.stickerSeq = (state.opts.stickerSeq || 1) + 1),
    x: (it.x || 0) + 30, y: (it.y || 0) + 30,
  };
  stickersOf(sscope).push(copy);
  state.selSticker = { sscope, id: copy.id };
  renderPreview();
}

function nudgeSticker(dx, dy) {
  const it = selSticker();
  if (!it) return;
  pushUndo('nudge');
  const [W, H] = dims();
  it.x = Math.round(Math.max(-200, Math.min((it.x || 0) + dx, W - 40)));
  it.y = Math.round(Math.max(-120, Math.min((it.y || 0) + dy, H - 40)));
  renderPreview({ keepPanel: true });
}

function resizeSticker(mul) {
  const it = selSticker();
  if (!it) return;
  pushUndo('stksize');
  it.size = Math.round(clampNum(it.size * mul, 20, 200));
  renderPreview({ keepPanel: true });
  const o = $('#stkEditor .stk-size-o'), r = $('#stkEditor .stk-size');
  if (o) o.textContent = it.size;
  if (r) r.value = it.size;
}

/* 왼쪽 패널에서 일어나는 변경을 한 군데서 찍어 둔다.
   각 핸들러가 값을 바꾸기 '전'에 잡아야 하므로 캡처 단계에서 듣는다.
   키는 '어떤 칸'이 아니라 '지금 화면에 있는 바로 그 칸'으로 잡는다 —
   같은 슬라이더를 죽 미는 동안엔 한 번만 쌓이고, 패널이 다시 그려지면
   새 칸이라 다음 동작으로 끊긴다. */
const ctlKeys = new WeakMap();
let ctlSeq = 0;
function ctlKey(el) {
  let k = ctlKeys.get(el);
  if (!k) { k = 'c' + (++ctlSeq); ctlKeys.set(el, k); }
  return k;
}

function bindPanelUndo() {
  const panel = $('.panel');
  if (!panel) return;
  const grab = (e) => {
    const t = e.target;
    if (!t || !/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || '')) return;
    if (t.type === 'file') return;          // 파일 고르기는 읽은 뒤에 따로 찍는다
    pushUndo(ctlKey(t));
  };
  panel.addEventListener('input', grab, true);
  panel.addEventListener('change', grab, true);
  panel.addEventListener('click', (e) => {
    if (e.target.closest('button')) pushUndo();
  }, true);
}

function bindShortcuts() {
  const TEXT_TYPES = /^(text|search|email|url|tel|number|password)$/;
  document.addEventListener('keydown', (e) => {
    const t = e.target, tag = (t && t.tagName) || '';
    // 글자를 치는 중엔 브라우저 기본 동작에 맡긴다 (textarea의 Ctrl+Z 등)
    const typing = tag === 'TEXTAREA' || (t && t.isContentEditable)
                || (tag === 'INPUT' && TEXT_TYPES.test(t.type));
    if (typing) {
      if (e.key === 'Escape') t.blur();
      return;
    }
    if (!state.celeb) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    // 라디오·체크박스·슬라이더·드롭다운은 낱개 키(화살표 등)를 스스로 쓴다.
    // Ctrl 조합만 가로채고 나머지는 그대로 넘긴다.
    const onControl = tag === 'SELECT' || (tag === 'INPUT' && !TEXT_TYPES.test(t.type));

    if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (mod && k === 'y') { e.preventDefault(); redo(); return; }
    if (mod && k === 'd') { e.preventDefault(); duplicateSticker(); return; }
    if (mod && k === 's') { e.preventDefault(); e.shiftKey ? saveProject() : exportZip(); return; }
    if (mod) return;                       // 그 밖의 Ctrl 조합은 브라우저에 넘긴다
    if (onControl) { if (e.key === 'Escape') t.blur(); return; }

    if (e.key === 'Escape') {
      state.selSticker = null;
      renderStickerPanel();
      markSelectedSticker();
      return;
    }

    if (e.key === 'Delete' || e.key === 'Backspace') {
      const it = selSticker();
      if (!it) return;
      e.preventDefault();
      pushUndo();
      removeSticker(state.selSticker.sscope, it.id);
      renderPreview();
      return;
    }

    // 카드가 1080px이라 1px씩은 티가 안 난다 — 기본 3px, Shift면 30px
    const step = (e.shiftKey ? 10 : 1) * 3;
    if (e.key === 'ArrowLeft')  { e.preventDefault(); nudgeSticker(-step, 0); return; }
    if (e.key === 'ArrowRight') { e.preventDefault(); nudgeSticker(step, 0); return; }
    if (e.key === 'ArrowUp')    { e.preventDefault(); nudgeSticker(0, -step); return; }
    if (e.key === 'ArrowDown')  { e.preventDefault(); nudgeSticker(0, step); return; }

    // + - 글자 크기
    if (e.key === '+' || e.key === '=') { e.preventDefault(); resizeSticker(1.06); return; }
    if (e.key === '-' || e.key === '_') { e.preventDefault(); resizeSticker(1 / 1.06); return; }

    // [ 뒤로  ] 앞으로
    if (e.key === '[' || e.key === ']') {
      const it = selSticker();
      if (!it) return;
      e.preventDefault();
      pushUndo();
      const arr = stickersOf(state.selSticker.sscope);
      const i = arr.findIndex((x) => x.id === it.id);
      if (e.key === ']') arr.push(arr.splice(i, 1)[0]);
      else arr.unshift(arr.splice(i, 1)[0]);
      renderPreview();
    }
  });
}

async function boot() {
  status('데이터 불러오는 중…');
  try {
    const res = await fetch('../data.json', { cache: 'no-cache' });
    state.data = await res.json();
    state.celebCount = Object.keys(state.data.celebs).length;
    state.bookCount = Object.values(state.data.celebs).reduce((a, c) => a + c.books.length, 0);
    status(`${state.celebCount}명 · 책 ${state.bookCount}권 로드됨`);
  } catch (e) {
    status('data.json 로드 실패'); console.error(e); return;
  }
  buildSwatches();
  bindOptions();
  bindSearch();
  bindAdjust();
  bindShortcuts();
  bindPanelUndo();
  $('#loadBtn').disabled = false;
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
    box.classList.remove('hidden'); active = -1;
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
    if (e.key === 'ArrowDown') active = Math.min(active + 1, items.length - 1);
    else if (e.key === 'ArrowUp') active = Math.max(active - 1, 0);
    else if (e.key === 'Enter') { if (active >= 0) pick(items[active]); return; }
    else return;
    e.preventDefault();
    $$('li', box).forEach((li, i) => li.classList.toggle('active', i === active));
  });
  box.addEventListener('click', (e) => {
    const li = e.target.closest('li[data-name]'); if (li) pick(li.dataset.name);
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-wrap')) box.classList.add('hidden');
  });
  function pick(name) { box.classList.add('hidden'); input.value = name; selectCeleb(name); }
}

/* ========================================================
   인물 선택
   ======================================================== */
function applyAutoText() {
  const dn = enName();
  const c = selectedBooks().length || DEFAULT_SELECT;
  state.opts.title = T().title(dn);
  state.opts.subtitle = T().subtitle(dn, c);
  $('#optTitle').value = state.opts.title;
  $('#optSubtitle').value = state.opts.subtitle;
}
function refreshAutoText() {
  if (state.autoText && state.name) { applyAutoText(); }
}

function selectCeleb(name) {
  resetUndo();
  state.name = name;
  state.celeb = state.data.celebs[name];
  state.customImage = null;
  state.autoText = true;
  state.opts.adj = {};
  state.opts.coverPhoto = { x: 50, y: 50, zoom: 1 };

  const cs = detectSource(state.celeb.imageUrl);
  state.opts.coverSrc = cs.name ? `ⓒ ${cs.name}${cs.date ? ' · ' + cs.date : ''}` : '';
  $('#optCoverSrc').value = state.opts.coverSrc;

  state.books = state.celeb.books.map((ref, i) => {
    const q = (ref.comment || '').trim();
    const d = detectSource(ref.source);
    return {
      ref, selected: i < DEFAULT_SELECT, quote: q, noQuote: !q,
      srcName: d.name, srcHandle: d.handle, srcTitle: d.title, srcDate: d.date,
      photo: null,          // {src, fit, zoom, x, y, w}
      adj: {},              // 이 카드 요소별 마우스 조정값
    };
  });
  applyAutoText();

  $('#celebBlock').classList.remove('hidden');
  $('#optsBlock').classList.remove('hidden');
  $('#booksBlock').classList.remove('hidden');
  $('#stickerBlock').classList.remove('hidden');
  $('#celebThumb').src = proxify(state.celeb.imageUrl);
  $('#celebName').textContent = name;
  $('#celebCount').textContent = `책 ${state.celeb.books.length}권`;
  $('#zipBtn').disabled = false;
  $('#copyBtn').disabled = false;
  $('#saveBtn').disabled = false;

  renderBookList();
  renderPreview();
  enrichSources();
}

/* 유튜브·비메오 출처는 oEmbed 로 영상 제목과 채널명을 채워 준다.
   네트워크가 막혀 있으면 조용히 URL에서 뽑은 값만 쓴다. */
async function enrichSources(list) {
  const targets = (list || state.books)
    .filter((b) => b.selected && !b.srcTitle && oembedEndpoint(cleanUrl(b.ref.source)));
  if (!targets.length) return;
  let done = 0;
  for (const b of targets) {
    const info = await fetchOEmbed(b.ref.source);
    if (info && (info.title || info.author)) {
      if (info.title && !b.srcTitle) b.srcTitle = info.title;
      if (info.author && !b.srcHandle) b.srcHandle = info.author;
      done++;
    }
  }
  if (done) { renderBookList(); renderPreview(); status(`출처 ${done}건을 영상 정보로 채웠어요`); }
}
function renderBookList() {
  const ul = $('#bookList');
  ul.innerHTML = state.books.map((b, i) => {
    const r = b.ref;
    const ph = b.photo && b.photo.src ? normPhoto(b.photo) : null;
    return `<li class="book-item${ph ? ' has-photo' : ''}" data-i="${i}">
      <div class="book-head">
        <input type="checkbox" class="bk-sel" ${b.selected ? 'checked' : ''} title="카드에 포함">
        <img src="${esc(proxify(r.coverUrl))}" referrerpolicy="no-referrer" onerror="this.style.visibility='hidden'">
        <div class="bt"><b>${esc(r.title)}</b><span>${esc(r.author || '')}${r.publisher ? ' · ' + esc(r.publisher) : ''}</span></div>
        ${(!b.noQuote && b.quote) ? '<span class="badge-on">대목</span>' : ''}
        ${ph ? '<span class="badge-on ph">사진</span>' : ''}
        <span class="caret">▸</span>
      </div>
      <div class="book-edit">
        <label class="chk" style="margin-top:11px"><input type="checkbox" class="bk-noq" ${b.noQuote ? 'checked' : ''}> 언급 대목 없음 (책·제목을 가운데 배치)</label>
        <label class="field">
          <span>언급 대목 (인용문) ${r.source ? `· <a class="src-open" href="${esc(cleanUrl(r.source))}" target="_blank" rel="noreferrer">출처 열기 ↗</a>` : ''}</span>
          <textarea class="bk-quote" rows="3" placeholder="이 인물이 책을 언급/추천한 문장을 붙여넣으세요" ${b.noQuote ? 'disabled' : ''}>${esc(b.quote)}</textarea>
        </label>
        <div class="field src-block">
          <span>출처 <em>(URL에서 자동으로 뽑아 둔 값 — 고칠 수 있어요)</em></span>
          <div class="src-grid">
            <input class="bk-name" type="text" value="${esc(b.srcName)}" placeholder="매체명 (예: VOGUE KOREA)">
            <input class="bk-handle" type="text" value="${esc(b.srcHandle || '')}" placeholder="계정명 (예: @favoritesbook)">
          </div>
          <input class="bk-srctitle" type="text" value="${esc(b.srcTitle || '')}" placeholder="페이지·영상 제목">
          <div class="src-grid">
            <input class="bk-srcdate" type="text" value="${esc(b.srcDate || '')}" placeholder="날짜 (예: 2024.05.12)">
            <button type="button" class="btn tiny bk-src-refetch">↻ URL에서 다시 읽기</button>
          </div>
        </div>

        <div class="field ph-block">
          <span>이 카드 사진 <em>(넣으면 책 왼쪽 · 사진 오른쪽)</em></span>
          <div class="ph-row">
            <label class="mini-file">🖼 사진 올리기<input class="bk-photo" type="file" accept="image/*" hidden></label>
            <button type="button" class="btn tiny bk-photo-del"${ph ? '' : ' disabled'}>사진 빼기</button>
          </div>
          <input class="bk-photo-url" type="text" placeholder="또는 이미지 주소(URL) 붙여넣기"
            value="${esc(ph && !ph.src.startsWith('data:') ? ph.src : '')}">
        </div>

        <div class="ph-adj${ph ? '' : ' hidden'}">
          <div class="field">
            <span>사진 맞춤</span>
            <div class="seg seg-row">
              <label><input type="radio" name="phfit${i}" value="cover" ${!ph || ph.fit !== 'contain' ? 'checked' : ''}> 꽉 채움</label>
              <label><input type="radio" name="phfit${i}" value="contain" ${ph && ph.fit === 'contain' ? 'checked' : ''}> 전체 보기 <em>(안 잘림)</em></label>
            </div>
          </div>
          <label class="field range">
            <span>확대 <output class="bk-ph-zoom-o">${Math.round((ph ? ph.zoom : 1) * 100)}%</output></span>
            <input class="bk-ph-zoom" type="range" min="100" max="300" step="5" value="${Math.round((ph ? ph.zoom : 1) * 100)}">
          </label>
          <label class="field range">
            <span>가로 초점 <output class="bk-ph-x-o">${ph ? ph.x : 50}%</output></span>
            <input class="bk-ph-x" type="range" min="0" max="100" step="1" value="${ph ? ph.x : 50}">
          </label>
          <label class="field range">
            <span>세로 초점 <output class="bk-ph-y-o">${ph ? ph.y : 50}%</output></span>
            <input class="bk-ph-y" type="range" min="0" max="100" step="1" value="${ph ? ph.y : 50}">
          </label>
          <label class="field range">
            <span>사진 폭 <output class="bk-ph-w-o">${ph ? ph.w : 42}%</output></span>
            <input class="bk-ph-w" type="range" min="28" max="62" step="1" value="${ph ? ph.w : 42}">
          </label>
        </div>
      </div>
    </li>`;
  }).join('');

  $$('.book-item', ul).forEach((li) => {
    const i = +li.dataset.i, b = state.books[i];
    li.querySelector('.book-head').addEventListener('click', (e) => {
      if (e.target.classList.contains('bk-sel')) return;
      li.classList.toggle('open');
    });
    li.querySelector('.bk-sel').addEventListener('change', (e) => {
      b.selected = e.target.checked;
      refreshAutoText(); renderPreview();
      if (b.selected) enrichSources([b]);
    });
    const reflectBadge = () => {
      const head = li.querySelector('.book-head');
      let badge = head.querySelector('.badge-on');
      const show = !b.noQuote && b.quote;
      if (show && !badge) { badge = document.createElement('span'); badge.className = 'badge-on'; badge.textContent = '대목'; head.insertBefore(badge, head.querySelector('.caret')); }
      else if (!show && badge) badge.remove();
    };
    li.querySelector('.bk-noq').addEventListener('change', (e) => {
      b.noQuote = e.target.checked;
      li.querySelector('.bk-quote').disabled = b.noQuote;
      reflectBadge(); renderPreview();
    });
    li.querySelector('.bk-quote').addEventListener('input', (e) => { b.quote = e.target.value; reflectBadge(); renderPreview(); });
    li.querySelector('.bk-name').addEventListener('input', (e) => { b.srcName = e.target.value; renderPreview(); });
    li.querySelector('.bk-handle').addEventListener('input', (e) => { b.srcHandle = e.target.value; renderPreview(); });
    li.querySelector('.bk-srctitle').addEventListener('input', (e) => { b.srcTitle = e.target.value; renderPreview(); });
    li.querySelector('.bk-srcdate').addEventListener('input', (e) => { b.srcDate = e.target.value; renderPreview(); });
    li.querySelector('.bk-src-refetch').addEventListener('click', async () => {
      const d = detectSource(b.ref.source);
      b.srcName = d.name; b.srcHandle = d.handle; b.srcTitle = d.title; b.srcDate = d.date;
      li.querySelector('.bk-name').value = b.srcName;
      li.querySelector('.bk-handle').value = b.srcHandle;
      li.querySelector('.bk-srctitle').value = b.srcTitle;
      li.querySelector('.bk-srcdate').value = b.srcDate;
      renderPreview();
      const info = await fetchOEmbed(b.ref.source);
      if (info && (info.title || info.author)) {
        if (info.title) b.srcTitle = info.title;
        if (info.author) b.srcHandle = info.author;
        li.querySelector('.bk-srctitle').value = b.srcTitle;
        li.querySelector('.bk-handle').value = b.srcHandle;
        renderPreview();
      }
    });

    /* ---- 카드별 사진 ---- */
    const adj = li.querySelector('.ph-adj');
    const setPhoto = (src) => {
      if (!src) { b.photo = null; } else { b.photo = normPhoto({ ...(b.photo || {}), src }); }
      const on = !!(b.photo && b.photo.src);
      adj.classList.toggle('hidden', !on);
      li.classList.toggle('has-photo', on);
      li.querySelector('.bk-photo-del').disabled = !on;
      const head = li.querySelector('.book-head');
      let badge = head.querySelector('.badge-on.ph');
      if (on && !badge) {
        badge = document.createElement('span');
        badge.className = 'badge-on ph'; badge.textContent = '사진';
        head.insertBefore(badge, head.querySelector('.caret'));
      } else if (!on && badge) badge.remove();
      renderPreview();
    };
    li.querySelector('.bk-photo').addEventListener('change', (e) => {
      const f = e.target.files[0]; if (!f) return;
      readImageFile(f, (dataUrl) => {
        li.querySelector('.bk-photo-url').value = '';
        setPhoto(dataUrl);
      });
      e.target.value = '';
    });
    li.querySelector('.bk-photo-url').addEventListener('input', (e) => {
      setPhoto(cleanUrl(e.target.value));
    });
    li.querySelector('.bk-photo-del').addEventListener('click', () => {
      li.querySelector('.bk-photo-url').value = '';
      setPhoto('');
    });
    const tweak = (sel, outSel, key, fn) => {
      const input = li.querySelector(sel), out = li.querySelector(outSel);
      input.addEventListener('input', (e) => {
        if (!b.photo) return;
        b.photo = normPhoto({ ...b.photo, [key]: fn(e.target.value) });
        if (out) out.textContent = key === 'zoom' ? `${e.target.value}%` : `${e.target.value}%`;
        renderPreview();
      });
    };
    tweak('.bk-ph-zoom', '.bk-ph-zoom-o', 'zoom', (v) => +v / 100);
    tweak('.bk-ph-x', '.bk-ph-x-o', 'x', (v) => +v);
    tweak('.bk-ph-y', '.bk-ph-y-o', 'y', (v) => +v);
    tweak('.bk-ph-w', '.bk-ph-w-o', 'w', (v) => +v);
    $$(`input[name=phfit${i}]`, li).forEach((r2) => r2.addEventListener('change', (e) => {
      if (!b.photo || !e.target.checked) return;
      b.photo = normPhoto({ ...b.photo, fit: e.target.value });
      renderPreview();
    }));
  });
}

/* ========================================================
   옵션 바인딩
   ======================================================== */
function swatchHTML(list) {
  return list.map((c) => `<button type="button" data-c="${c}" style="background:${c}" title="${c}"></button>`).join('');
}

function buildSwatches() {
  const box = $('#swatches');
  box.innerHTML = swatchHTML(SWATCHES);
  box.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-c]'); if (!btn) return;
    setBg(btn.dataset.c);
  });

  const inkBox = $('#inkSwatches');
  inkBox.innerHTML = swatchHTML(INK_SWATCHES);
  inkBox.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-c]'); if (!btn) return;
    setInk(btn.dataset.c);
  });

  const acBox = $('#accentSwatches');
  acBox.innerHTML = swatchHTML(ACCENT_SWATCHES);
  acBox.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-c]'); if (!btn) return;
    setAccent(btn.dataset.c);
  });

  buildThemeGrid();
  markSwatch();
}

function buildThemeGrid() {
  const box = $('#themeGrid');
  box.innerHTML = THEME_KEYS.map((k) => {
    const t = THEMES[k];
    return `<button type="button" class="theme-chip" data-t="${k}">
      <span class="tc-dot" style="background:${t.bg};box-shadow:inset 0 0 0 3px ${t.accent}"></span>
      <span class="tc-txt"><b>${t.emoji} ${esc(t.label)}</b><em>${esc(t.desc)}</em></span>
    </button>`;
  }).join('');
  box.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-t]'); if (!btn) return;
    setTheme(btn.dataset.t);
  });
  markTheme();
}
function markTheme() {
  $$('#themeGrid button').forEach((b) => b.classList.toggle('active', b.dataset.t === state.opts.theme));
}
function setTheme(k) {
  if (!THEMES[k]) return;
  state.opts.theme = k;
  // 테마를 고르면 배경·포인트 색을 그 테마 기본값으로 초기화 (글자색은 자동으로)
  state.opts.bg = THEMES[k].bg;
  state.opts.accentAuto = true;
  state.opts.accent = THEMES[k].accent;
  state.opts.inkAuto = true;
  syncControls();
  renderPreview();
}

function markSwatch() {
  const eq = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
  $$('#swatches button').forEach((b) => b.classList.toggle('active', eq(b.dataset.c, state.opts.bg)));
  $$('#inkSwatches button').forEach((b) => b.classList.toggle('active', !state.opts.inkAuto && eq(b.dataset.c, state.opts.ink)));
  $$('#accentSwatches button').forEach((b) => b.classList.toggle('active', !state.opts.accentAuto && eq(b.dataset.c, state.opts.accent)));
  markTheme();
}
function setBg(c) {
  state.opts.bg = c;
  $('#optBgCustom').value = /^#[0-9a-f]{6}$/i.test(c) ? c : '#f4f1e9';
  markSwatch();
  renderPreview();
}
function setInk(c) {
  if (!/^#[0-9a-f]{6}$/i.test(c)) return;
  state.opts.ink = c;
  state.opts.inkAuto = false;
  $('#optInkAuto').checked = false;
  $('#optInkCustom').value = c;
  markSwatch();
  renderPreview();
}
function setAccent(c) {
  if (!/^#[0-9a-f]{6}$/i.test(c)) return;
  state.opts.accent = c;
  state.opts.accentAuto = false;
  $('#optAccentAuto').checked = false;
  $('#optAccentCustom').value = c;
  markSwatch();
  renderPreview();
}

function bindOptions() {
  $('#optTitle').addEventListener('input', (e) => { state.opts.title = e.target.value; state.autoText = false; renderPreview(); });
  $('#optSubtitle').addEventListener('input', (e) => { state.opts.subtitle = e.target.value; state.autoText = false; renderPreview(); });
  $('#optCoverSrc').addEventListener('input', (e) => { state.opts.coverSrc = e.target.value; renderPreview(); });
  $('#optHandle').addEventListener('input', (e) => { state.opts.handle = e.target.value; renderPreview(); });
  $('#optBgCustom').addEventListener('input', (e) => setBg(e.target.value));
  $('#optInkCustom').addEventListener('input', (e) => setInk(e.target.value));
  $('#optAccentCustom').addEventListener('input', (e) => setAccent(e.target.value));
  $('#optInkAuto').addEventListener('change', (e) => {
    state.opts.inkAuto = e.target.checked; markSwatch(); renderPreview();
  });
  $('#optAccentAuto').addEventListener('change', (e) => {
    state.opts.accentAuto = e.target.checked; markSwatch(); renderPreview();
  });
  $('#optCoverZoom').addEventListener('input', (e) => {
    state.opts.coverPhoto.zoom = +e.target.value / 100;
    $('#optCoverZoomOut').textContent = `${e.target.value}%`;
    renderPreview();
  });

  $$('input[name=lang]').forEach((r) => r.addEventListener('change', () => {
    state.opts.lang = $$('input[name=lang]').find((x) => x.checked).value;
    refreshAutoText();
    renderPreview();
  }));
  $$('input[name=format]').forEach((r) => r.addEventListener('change', () => {
    state.opts.format = $$('input[name=format]').find((x) => x.checked).value; renderPreview();
  }));
  $$('input[name=fit]').forEach((r) => r.addEventListener('change', () => {
    state.opts.fit = $$('input[name=fit]').find((x) => x.checked).value; renderPreview();
  }));
  $$('input[name=coverLayout]').forEach((r) => r.addEventListener('change', () => {
    state.opts.coverLayout = $$('input[name=coverLayout]').find((x) => x.checked).value; renderPreview();
  }));
  $$('input[name=bookFace]').forEach((r) => r.addEventListener('change', (e) => {
    if (!e.target.checked) return;
    state.opts.bookFace = e.target.value;
    $('#bookColsField').hidden = state.opts.bookFace === 'spine';
    renderPreview();
  }));

  $$('input[name=bookGrid]').forEach((r) => r.addEventListener('change', () => {
    const v = $$('input[name=bookGrid]').find((x) => x.checked).value;
    state.opts.bookCols = v === 'row' ? 0 : +v;
    state.opts.bookGrid = state.opts.bookCols !== 0;   // 구버전 필드도 맞춰 둔다
    renderPreview();
  }));
  $$('input[name=imgPos]').forEach((r) => r.addEventListener('change', () => {
    state.opts.imgPos = $$('input[name=imgPos]').find((x) => x.checked).value;
    // 라디오를 누르면 마우스로 옮긴 초점도 그 위치로 맞춘다
    state.opts.coverPhoto.x = 50;
    state.opts.coverPhoto.y = { top: 18, center: 50, bottom: 82 }[state.opts.imgPos] ?? 50;
    renderPreview();
  }));
  $('#optMono').addEventListener('change', (e) => { state.opts.mono = e.target.checked; renderPreview(); });
  $('#optCovers').addEventListener('change', (e) => { state.opts.covers = e.target.checked; renderPreview(); });
  $('#optNoImage').addEventListener('change', (e) => { state.opts.noImage = e.target.checked; renderPreview(); });
  $('#optOutro').addEventListener('change', (e) => { state.opts.outro = e.target.checked; renderPreview(); });
  $('#optPromo').addEventListener('change', (e) => { state.opts.promo = e.target.checked; renderPreview(); });
  $('#optProxy').addEventListener('change', (e) => {
    state.opts.proxy = e.target.checked;
    if (state.celeb) { $('#celebThumb').src = proxify(state.celeb.imageUrl); renderBookList(); }
    renderPreview();
  });

  $('#selAll').addEventListener('click', () => {
    state.books.forEach((b) => b.selected = true);
    refreshAutoText(); renderBookList(); renderPreview(); enrichSources();
  });
  $('#selNone').addEventListener('click', () => { state.books.forEach((b) => b.selected = false); refreshAutoText(); renderBookList(); renderPreview(); });

  $('#celebUpload').addEventListener('change', (e) => {
    const f = e.target.files[0]; if (!f) return;
    readImageFile(f, (dataUrl) => {
      state.customImage = dataUrl;
      $('#celebThumb').src = dataUrl;
      renderPreview();
    });
    e.target.value = '';
  });

  $('#zipBtn').addEventListener('click', exportZip);
  $('#copyBtn').addEventListener('click', copyScript);
  $('#stkScope').addEventListener('change', (e) => {
    state.stickerScope = e.target.value;
    if (state.selSticker && state.selSticker.sscope !== state.stickerScope) state.selSticker = null;
    renderStickerPanel();
  });
  $('#stkGal').addEventListener('click', (e) => {
    const cell = e.target.closest('.stk-cell');
    if (cell) addSticker(cell.dataset.preset);
  });

  $('#saveBtn').addEventListener('click', saveProject);
  $('#loadBtn').addEventListener('click', () => $('#loadFile').click());
  $('#loadFile').addEventListener('change', (e) => {
    const f = e.target.files[0]; if (!f) return;
    const fr = new FileReader();
    fr.onload = () => loadProject(fr.result);
    fr.readAsText(f);
    e.target.value = '';
  });
}

/* ========================================================
   프로젝트 저장 / 불러오기 (JSON)
   ======================================================== */
function setRadio(name, val) { const el = $$(`input[name=${name}]`).find((x) => x.value === val); if (el) el.checked = true; }

function syncControls() {
  $('#optTitle').value = state.opts.title;
  $('#optSubtitle').value = state.opts.subtitle;
  $('#optCoverSrc').value = state.opts.coverSrc;
  $('#optHandle').value = state.opts.handle;
  setRadio('lang', state.opts.lang);
  $('#optInkAuto').checked = state.opts.inkAuto !== false;
  $('#optAccentAuto').checked = state.opts.accentAuto !== false;
  if (/^#[0-9a-f]{6}$/i.test(state.opts.ink || '')) $('#optInkCustom').value = state.opts.ink;
  if (/^#[0-9a-f]{6}$/i.test(state.opts.accent || '')) $('#optAccentCustom').value = state.opts.accent;
  const cz = Math.round(((state.opts.coverPhoto && state.opts.coverPhoto.zoom) || 1) * 100);
  $('#optCoverZoom').value = cz;
  $('#optCoverZoomOut').textContent = `${cz}%`;
  setRadio('format', state.opts.format);
  setRadio('fit', state.opts.fit);
  setRadio('coverLayout', state.opts.coverLayout);
  setRadio('imgPos', state.opts.imgPos);
  setRadio('bookGrid', bookCols() ? String(bookCols()) : 'row');
  setRadio('bookFace', state.opts.bookFace === 'cover' ? 'cover' : 'spine');
  $('#bookColsField').hidden = state.opts.bookFace !== 'cover';
  $('#optMono').checked = !!state.opts.mono;
  $('#optCovers').checked = !!state.opts.covers;
  $('#optNoImage').checked = !!state.opts.noImage;
  $('#optOutro').checked = !!state.opts.outro;
  $('#optPromo').checked = !!state.opts.promo;
  $('#optProxy').checked = !!state.opts.proxy;
  if (!/^#[0-9a-f]{6}$/i.test(state.opts.bg)) state.opts.bg = '#f4f1e9';
  $('#optBgCustom').value = state.opts.bg;
  markSwatch();
}

function saveProject() {
  if (!state.celeb) return;
  const proj = {
    app: 'favorbook-cardnews', version: 1, savedAt: new Date().toISOString(),
    name: state.name,
    autoText: state.autoText,
    customImage: state.customImage || null,
    opts: state.opts,
    books: state.books.map((b) => ({
      title: b.ref.title, author: b.ref.author,
      selected: b.selected, quote: b.quote, noQuote: b.noQuote,
      srcName: b.srcName, srcHandle: b.srcHandle, srcTitle: b.srcTitle, srcDate: b.srcDate,
      photo: b.photo || null,
      adj: b.adj || {},
    })),
  };
  const blob = new Blob([JSON.stringify(proj, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `favorbook_cardnews_${safeName(displayName(state.name))}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  status('프로젝트를 저장했어요 (JSON)');
}

function loadProject(text) {
  let proj;
  try { proj = JSON.parse(text); } catch { status('JSON을 읽지 못했어요'); return; }
  // 'favoread-cardnews'는 구버전(구 영문명) 프로젝트 파일 — 계속 읽을 수 있게 함께 허용
  if (!proj || (proj.app !== 'favorbook-cardnews' && proj.app !== 'favoread-cardnews')) { status('이 도구의 프로젝트 파일이 아니에요'); return; }
  const name = proj.name;
  if (!name || !state.data.celebs[name]) { status(`'${name || '?'}'(은)는 현재 데이터에 없어요`); return; }

  selectCeleb(name);                       // 데이터에서 책/UI 재구성
  Object.assign(state.opts, proj.opts || {});
  if (!state.opts.coverPhoto) {
    // 예전 파일 호환: coverZoom + 사진 위치를 새 구조로 옮긴다
    state.opts.coverPhoto = {
      x: 50, y: { top: 18, center: 50, bottom: 82 }[state.opts.imgPos] ?? 50,
      zoom: state.opts.coverZoom || 1,
    };
  }
  if (!state.opts.adj) state.opts.adj = {};
  if (!state.opts.stickers || typeof state.opts.stickers !== 'object') state.opts.stickers = {};
  state.selSticker = null;
  state.stickerScope = null;
  state.autoText = proj.autoText !== undefined ? proj.autoText : false;
  state.customImage = proj.customImage || null;

  const saved = Array.isArray(proj.books) ? proj.books : [];
  state.books.forEach((b, i) => {
    let m = saved[i] && saved[i].title === b.ref.title ? saved[i] : null;
    if (!m) m = saved.find((s) => s.title === b.ref.title);
    if (m) {
      b.selected = !!m.selected;
      b.quote = m.quote || '';
      b.noQuote = !!m.noQuote;
      if (m.srcName != null) b.srcName = m.srcName;
      if (m.srcHandle != null) b.srcHandle = m.srcHandle;
      if (m.srcTitle != null) b.srcTitle = m.srcTitle;
      if (m.srcDate != null) b.srcDate = m.srcDate;
      b.photo = m.photo && m.photo.src ? normPhoto(m.photo) : null;
      b.adj = m.adj && typeof m.adj === 'object' ? m.adj : {};
    }
  });

  if (state.customImage) $('#celebThumb').src = state.customImage;
  $('#search').value = name;
  syncControls();
  renderBookList();
  renderPreview();
  resetUndo();                             // 불러온 파일이 새 출발점
  status('프로젝트를 불러왔어요');
}

/* ========================================================
   카드 슬라이드 생성
   ======================================================== */
function dims() { return state.opts.format === 'square' ? [1080, 1080] : [1080, 1350]; }
function selectedBooks() { return state.books.filter((b) => b.selected); }

function topBar(left, right) {
  return `<div class="cn-top"><span class="cn-kicker">${esc(left)}</span>
    ${right ? `<span class="cn-kicker r">${esc(right)}</span>` : ''}</div>`;
}

// 이미지는 <img object-fit> 대신 background-image div로 그린다
// (html2canvas가 object-fit을 제대로 못 그려 세로로 늘어나는 문제 방지)
function imgBg(url, cls, w, h, extraStyle, attrs) {
  const wh = (w && h) ? `width:${w}px;height:${h}px;` : '';
  return `<div class="cn-imgbg ${cls}"${attrs || ''} style="${wh}${extraStyle || ''}background-image:url('${esc(url)}')"></div>`;
}

/* ========================================================
   범용 이미지 맞춤 툴
   가로/세로/정사각 등 어떤 비율의 사진이 들어와도
   (1) 원본 크기를 읽어 두고 (2) 상자 크기에 맞춰 정확한
   background-size 를 계산한다. 확대(zoom)와 초점(x,y)도 함께.
   ======================================================== */
const imgMeta = Object.create(null);   // url → {w,h} | null(로딩 중)
let refitTimer;

function noteMeta(url) {
  if (!url || imgMeta[url] !== undefined) return;
  imgMeta[url] = null;
  const im = new Image();
  im.crossOrigin = 'anonymous';
  im.onload = () => {
    imgMeta[url] = { w: im.naturalWidth || 0, h: im.naturalHeight || 0 };
    clearTimeout(refitTimer);
    refitTimer = setTimeout(() => applyPhotoFits(document), 60);
  };
  im.onerror = () => { imgMeta[url] = { w: 0, h: 0 }; };
  im.src = url;
}

function normPhoto(ph) {
  const p = ph || {};
  return {
    src: p.src || '',
    fit: p.fit === 'contain' ? 'contain' : 'cover',
    zoom: Number(p.zoom) > 0 ? Number(p.zoom) : 1,
    x: p.x == null ? 50 : +p.x,
    y: p.y == null ? 50 : +p.y,
    w: p.w == null ? 42 : +p.w,       // 카드에서 사진이 차지할 가로 비율(%)
  };
}

/* 사진 한 장을 그린다. 실제 배율은 DOM 삽입 후 applyPhotoFits 가 확정한다. */
function fitImg(url, cls, ph, extraStyle, attrs) {
  const p = normPhoto(ph);
  noteMeta(url);
  return `<div class="cn-imgbg cn-fitimg ${cls}"${attrs || ''}
    data-src="${esc(url)}" data-fit="${p.fit}" data-zoom="${p.zoom}" data-x="${p.x}" data-y="${p.y}"
    style="${extraStyle || ''}background-image:url('${esc(url)}');background-size:${p.fit};background-position:${p.x}% ${p.y}%"></div>`;
}

/* 책 표지 상자를 표지 원본 비율에 맞춘다.
   상자가 고정 비율이면 표지가 상자 안에서 남는 여백이 생기고,
   그림자·테두리는 상자 기준이라 표지와 어긋나 보인다.
   원본 크기를 알면 상자를 표지에 딱 맞춰 그림자가 표지를 감싸게 한다. */
function coverBox(url, cls, maxW, maxH, extraStyle, attrs) {
  noteMeta(url);
  const m = imgMeta[url];
  let w = maxW, h = maxH;
  if (m && m.w && m.h) {
    const k = Math.min(maxW / m.w, maxH / m.h);
    w = Math.round(m.w * k); h = Math.round(m.h * k);
  }
  const data = ` data-src="${esc(url)}" data-maxw="${maxW}" data-maxh="${maxH}"`;
  return imgBg(url, `${cls} cn-fitbox`, w, h, extraStyle, (attrs || '') + data);
}

function applyCoverBoxes(root) {
  $$('.cn-fitbox', root || document).forEach((d) => {
    const m = imgMeta[d.dataset.src];
    if (!m || !m.w || !m.h) return;
    const cs = getComputedStyle(d);
    // 테두리를 두르는 테마가 있으므로 테두리 두께를 빼고 계산한다 (box-sizing: border-box)
    const bx = (parseFloat(cs.borderLeftWidth) || 0) + (parseFloat(cs.borderRightWidth) || 0);
    const by = (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.borderBottomWidth) || 0);
    const maxW = Math.max(1, (+d.dataset.maxw || 0) - bx);
    const maxH = Math.max(1, (+d.dataset.maxh || 0) - by);
    const k = Math.min(maxW / m.w, maxH / m.h);
    d.style.width = `${Math.round(m.w * k + bx)}px`;
    d.style.height = `${Math.round(m.h * k + by)}px`;
    d.style.backgroundSize = 'cover';   // 상자가 표지 비율과 같으므로 잘리지 않는다
  });
}

function applyPhotoFits(root) {
  applyCoverBoxes(root);
  $$('.cn-fitimg', root || document).forEach((d) => {
    const m = imgMeta[d.dataset.src];
    const W = d.clientWidth, H = d.clientHeight;
    if (!m || !m.w || !m.h || !W || !H) return;
    const base = d.dataset.fit === 'contain'
      ? Math.min(W / m.w, H / m.h)
      : Math.max(W / m.w, H / m.h);
    const z = parseFloat(d.dataset.zoom) || 1;
    d.style.backgroundSize = `${Math.round(m.w * base * z)}px ${Math.round(m.h * base * z)}px`;
    d.style.backgroundPosition = `${d.dataset.x}% ${d.dataset.y}%`;
  });
}

/* 업로드 이미지는 긴 변 1600px로 줄여 둔다 (PNG 저장·JSON 용량 대비) */
function readImageFile(file, cb) {
  const fr = new FileReader();
  fr.onload = () => {
    const im = new Image();
    im.onload = () => {
      const MAX = 1600;
      const scale = Math.min(1, MAX / Math.max(im.naturalWidth, im.naturalHeight));
      if (scale >= 1) { cb(fr.result); return; }
      const cv = document.createElement('canvas');
      cv.width = Math.round(im.naturalWidth * scale);
      cv.height = Math.round(im.naturalHeight * scale);
      cv.getContext('2d').drawImage(im, 0, 0, cv.width, cv.height);
      cb(cv.toDataURL('image/jpeg', 0.92));
    };
    im.onerror = () => cb(fr.result);
    im.src = fr.result;
  };
  fr.readAsDataURL(file);
}

/* ========================================================
   마우스 조정 (끌어서 이동 · 휠로 크기)
   - move: 제목·인용구·책 표지 등 → translate + scale
   - pan : 사진 → 초점(배경 위치) 이동, 휠은 확대
   조정값은 표지는 state.opts.adj, 본문은 책마다 b.adj 에 남는다.
   ======================================================== */
function scopeStore(scope) {
  if (scope === 'cover') {
    if (!state.opts.adj) state.opts.adj = {};
    return state.opts.adj;
  }
  const b = state.books[+String(scope).split(':')[1]];
  if (!b) return null;
  if (!b.adj) b.adj = {};
  return b.adj;
}
function getAdj(scope, key) {
  const st = scopeStore(scope);
  if (!st) return null;
  if (!st[key]) st[key] = { dx: 0, dy: 0, s: 1 };
  return st[key];
}
function peekAdj(scope, key) {
  const st = scopeStore(scope);
  return st ? st[key] : null;
}
/* 저장된 조정값을 인라인 transform 으로 */
function adjStyle(scope, key) {
  const a = peekAdj(scope, key);
  if (!a || (!a.dx && !a.dy && (a.s == null || a.s === 1))) return '';
  const sc = a.s && a.s !== 1 ? ` scale(${a.s})` : '';
  return `transform:translate(${a.dx || 0}px,${a.dy || 0}px)${sc};`;
}
const adjAttr = (scope, key, kind) =>
  ` data-adj="${key}" data-scope="${scope}" data-kind="${kind || 'move'}"`;

/* 사진의 초점·확대값 (pan 대상) */
function photoProps(scope) {
  if (scope === 'cover') return state.opts.coverPhoto;
  const b = state.books[+String(scope).split(':')[1]];
  return b && b.photo ? b.photo : null;
}
/* 마우스로 사진을 만졌을 때 패널 슬라이더도 같은 값으로 */
function syncPhotoPanel(scope) {
  const ph = photoProps(scope);
  if (!ph) return;
  if (scope === 'cover') {
    const z = Math.round((ph.zoom || 1) * 100);
    $('#optCoverZoom').value = z;
    $('#optCoverZoomOut').textContent = `${z}%`;
    return;
  }
  const li = $(`.book-item[data-i="${+String(scope).split(':')[1]}"]`);
  if (!li) return;
  const put = (sel, out, v) => {
    const el = li.querySelector(sel), o = li.querySelector(out);
    if (el) el.value = v;
    if (o) o.textContent = `${v}%`;
  };
  put('.bk-ph-zoom', '.bk-ph-zoom-o', Math.round((ph.zoom || 1) * 100));
  put('.bk-ph-x', '.bk-ph-x-o', Math.round(ph.x));
  put('.bk-ph-y', '.bk-ph-y-o', Math.round(ph.y));
}

/* 한 슬라이드의 조정값을 모두 되돌린다 */
function resetAdj(scope) {
  pushUndo();
  const st = scopeStore(scope);
  if (st) Object.keys(st).forEach((k) => delete st[k]);
  const ph = photoProps(scope);
  if (ph) { ph.x = 50; ph.y = 50; ph.zoom = 1; }
  syncPhotoPanel(scope);
  renderPreview();
}

/* 사진 소스: 업로드(data:)는 그대로, 외부 URL은 프록시를 태운다 */
function photoSrc(ph) {
  const u = (ph && ph.src) || '';
  return u.startsWith('data:') ? u : proxify(u);
}
function coverCell(b, w, h) { return coverBox(proxify(b.ref.coverUrl), 'bk', w, h); }

/* 표지 그리드 열 수. 0이면 한 줄. 구버전 프로젝트 파일은 bookGrid만 갖고 있다. */
function bookCols() {
  const c = state.opts.bookCols;
  if (c === 0 || c === 2 || c === 3 || c === 4) return c;
  return state.opts.bookGrid ? 2 : 0;
}

/* 책등 줄 — 표지 장에 책장처럼 세워 놓는다 */
function bookSpines(sel, sq) {
  const at = adjAttr('cover', 'covers'), st = adjStyle('cover', 'covers');
  const [W, H] = dims();
  const n = sel.length;
  const avail = (state.opts.coverLayout === 'split' ? 430 : 880);
  const gap = 5;
  const byWidth = Math.floor((avail - gap * (n - 1)) / n);
  const byHeight = Math.floor((sq ? 360 : 470) / SPINE_RATIO);
  const w = Math.max(14, Math.min(byWidth, byHeight, 96));
  const cells = sel.map((b) => {
    const t = b.ref.title;
    const h = Math.round(w * SPINE_RATIO);                    // 높이는 모두 같게
    const sp = b.ref.spineUrl || yes24SpineUrl(b.ref.coverUrl);
    // 상자 폭을 고정하면 실제 책등이 좌우로 잘린다. 높이만 맞추고 폭은
    // 이미지 원본 비율을 따르게 두고, 못 불러오면 색 책등 폭으로 돌아간다.
    const img = sp
      ? `<img class="cn-sp-i" src="${esc(proxify(sp))}" alt=""
           onerror="this.parentNode.classList.add('cn-sp-fail');this.remove()">`
      : '';
    return `<div class="cn-sp${sp ? '' : ' cn-sp-noimg'}" style="--w:${w}px;height:${h}px;--c:${spineTint(t)}">
      <span class="cn-sp-t" style="font-size:${Math.max(9, Math.round(w * 0.34))}px"><i>${esc(t)}</i></span>${img}
    </div>`;
  }).join('');
  return `<div class="cn-covers shelf"${at} style="gap:${gap}px;${st}">${cells}</div>`;
}

function bookCovers(sel, sq) {
  if (!state.opts.covers || !sel.length) return '';
  if (state.opts.bookFace === 'spine') return bookSpines(sel, sq);
  const at = adjAttr('cover', 'covers') , st = adjStyle('cover', 'covers');
  const cols = bookCols();
  if (cols) {
    const n = Math.min(sel.length, cols * 5);      // 최대 5행
    const rows = Math.ceil(n / cols);
    const gap = cols >= 4 ? 10 : (cols === 3 ? 13 : 16);
    // 세로로 남은 자리와 가로로 남은 자리 중 좁은 쪽에 맞춘다.
    // split 레이아웃은 왼쪽 단(1080의 53%)에서 여백을 뺀 만큼만 쓸 수 있어서
    // 열을 늘리면 가로가 먼저 걸린다.
    const hBudget = sq ? 460 : 640;
    const wBudget = (state.opts.coverLayout === 'split' ? 430 : 880) - (cols - 1) * gap;
    const hByRow = Math.floor((hBudget - (rows - 1) * gap) / rows);
    const hByCol = Math.floor((wBudget / cols) / 0.66);
    const h = Math.max(72, Math.min(sq ? 230 : 300, hByRow, hByCol));
    const w = Math.round(h * 0.66);
    return `<div class="cn-covers grid"${at} style="gap:${gap}px;grid-template-columns:repeat(${cols},auto);${st}">${sel.slice(0, n).map((b) => coverCell(b, w, h)).join('')}</div>`;
  }
  const n = Math.min(sel.length, sq ? 4 : 5), h = sq ? 128 : 168, w = Math.round(h * 0.66);
  return `<div class="cn-covers row"${at} style="${st}">${sel.slice(0, n).map((b) => coverCell(b, w, h)).join('')}</div>`;
}

function coverHTML() {
  const sel = selectedBooks();
  const img = state.customImage || proxify(state.celeb.imageUrl);
  const sq = state.opts.format === 'square';
  const foot = state.opts.coverSrc ? `<div class="cn-foot"><span>${esc(srcDisp(state.opts.coverSrc))}</span></div>` : '';
  const covers = bookCovers(sel, sq);

  const cp = state.opts.coverPhoto;
  const coverPhotoOpt = { fit: state.opts.fit, zoom: cp.zoom, x: cp.x, y: cp.y };
  const photoAttr = adjAttr('cover', 'photo', 'pan');
  const textAttr = adjAttr('cover', 'text'), textStyle = adjStyle('cover', 'text');

  if (state.opts.coverLayout === 'split') {
    const photo = state.opts.noImage
      ? `<div class="cn-split-photo empty"></div>`
      : fitImg(img, 'cn-split-photo', coverPhotoOpt, '', photoAttr);
    return `<div class="cn-cover split">
      <div class="cn-split-main">
        <div class="cn-cv-brand"><span class="cn-kicker">${esc(T().brand)}</span><span class="cn-kicker tag">${esc(T().tagline)}</span></div>
        <div class="cn-cv-body"${textAttr} style="${textStyle}">
          <h1 class="cn-title">${escML(state.opts.title)}</h1>
          ${state.opts.subtitle ? `<div class="cn-sub">${escML(state.opts.subtitle)}</div>` : ''}
        </div>
        ${covers}
        ${foot}
      </div>
      ${photo}
    </div>`;
  }

  // stack (기본 상하)
  const photo = state.opts.noImage
    ? `<div class="cn-photo empty"></div>`
    : fitImg(img, 'cn-photo', coverPhotoOpt, '', photoAttr);
  return `<div class="cn-pad cn-cover">
    ${topBar(T().brand, T().tagline)}
    <div class="cn-cv-body"${textAttr} style="${textStyle}">
      <h1 class="cn-title">${escML(state.opts.title)}</h1>
      ${state.opts.subtitle ? `<div class="cn-sub">${escML(state.opts.subtitle)}</div>` : ''}
    </div>
    ${photo}
    ${covers}
    ${foot}
  </div>`;
}

function bookTitle(r) { return state.opts.lang === 'en' ? (r.title_en || r.title) : r.title; }
function bookAuthor(r) { return state.opts.lang === 'en' ? (r.author_en || r.author) : r.author; }

function bookHTML(b, idx, total) {
  const r = b.ref, sq = state.opts.format === 'square';
  const cite = citeParts(b);
  const meta = [bookAuthor(r), state.opts.lang === 'en' ? '' : r.publisher].filter(Boolean).join(' · ');
  const showQuote = !b.noQuote && (b.quote || '').trim();
  const scope = `book:${state.books.indexOf(b)}`;
  const quote = showQuote
    ? `<div class="cn-quote"${adjAttr(scope, 'quote')} style="${adjStyle(scope, 'quote')}">
        <span class="qmark">“</span><p>${escML(b.quote)}</p></div>`
    : '';
  const headBlock = `<div class="cn-bk-head"${adjAttr(scope, 'title')} style="${adjStyle(scope, 'title')}">
      <h2 class="cn-bk-title">${esc(bookTitle(r))}</h2>
      ${meta ? `<div class="cn-bk-meta">${esc(meta)}</div>` : ''}
    </div>`;
  const head = `<div class="cn-top">
      <span class="cn-big-num"><span class="cn-num-lat">${String(idx).padStart(2, '0')}</span> / ${String(total).padStart(2, '0')}</span>
      <span class="cn-kicker r">${esc(T().brand)}</span>
    </div>`;
  const foot = cite
    ? `<div class="cn-src"><span class="cn-src-lab">${esc(T().source)}</span><span class="cn-cite">${cite}</span></div>`
    : '';

  // 사진이 있는 카드 — 왼쪽: 책 / 오른쪽: 사진
  const ph = b.photo && b.photo.src ? normPhoto(b.photo) : null;
  const coverAttr = adjAttr(scope, 'cover'), coverStyle = adjStyle(scope, 'cover');
  if (ph) {
    const ch2 = sq ? 240 : 320, cw2 = Math.round(ch2 * 0.66);
    return `<div class="cn-pad cn-book duo">
      ${head}
      <div class="cn-duo">
        <div class="cn-duo-l">
          ${coverBox(proxify(r.coverUrl), 'cn-cover-img', cw2, ch2, coverStyle, coverAttr)}
          ${headBlock}
          ${quote}
        </div>
        <div class="cn-duo-r" style="width:${ph.w}%">
          ${fitImg(photoSrc(ph), 'cn-duo-photo', ph, '', adjAttr(scope, 'photo', 'pan'))}
        </div>
      </div>
      ${foot}
    </div>`;
  }

  const ch = sq ? 360 : 470, cw = Math.round(ch * 0.66);
  return `<div class="cn-pad cn-book${showQuote ? '' : ' centered'}">
    ${head}
    <div class="cn-body">
      ${coverBox(proxify(r.coverUrl), 'cn-cover-img', cw, ch, coverStyle, coverAttr)}
      ${headBlock}
      ${quote}
    </div>
    ${foot}
  </div>`;
}

/* 카드에 실제로 실린 도서 이미지의 출처를 뽑는다.
 * 표지는 알라딘·예스24·교보가 섞여 있고 책등은 전부 예스24라서,
 * 한 곳으로 고정해 적으면 어느 쪽이든 사실과 어긋난다.
 * 그래서 이번 카드가 쓴 이미지 주소만 보고 적는다. */
const IMG_HOSTS = [
  [/(^|\.)yes24\.com$/i,        '예스24 (yes24.com)',      'Yes24 (yes24.com)'],
  [/(^|\.)aladin\.co\.kr$/i,    '알라딘 (aladin.co.kr)',   'Aladin (aladin.co.kr)'],
  [/kyobobook\.co\.kr$/i,       '교보문고 (kyobobook.co.kr)', 'Kyobo Book (kyobobook.co.kr)'],
];

function bookImageCredit(sel) {
  const seen = new Map();
  sel.forEach((b) => {
    // 책등 모드면 책등을, 표지 모드면 표지를 — 실제로 카드에 그려진 쪽
    const url = state.opts.bookFace === 'spine'
      ? (b.ref.spineUrl || yes24SpineUrl(b.ref.coverUrl) || b.ref.coverUrl)
      : b.ref.coverUrl;
    let host;
    try { host = new URL(cleanUrl(url)).hostname; } catch { return; }
    const hit = IMG_HOSTS.find(([re]) => re.test(host));
    if (hit) seen.set(hit[0], hit);
    else seen.set(host, [null, host, host]);
  });
  const i = state.opts.lang === 'en' ? 2 : 1;
  const names = [...seen.values()].map((h) => h[i]);
  return names.length ? T().bookCredit(names.join(' · ')) : '';
}

function outroHTML() {
  const sel = selectedBooks();
  // 텍스트(인용) 출처
  const txt = sel.map((b, i) => {
    const head = citeHead(b);
    return `<li><span class="n">${String(i + 1).padStart(2, '0')}</span>
      <span class="t"><b>《${esc(bookTitle(b.ref))}》</b> — ${esc(head || T().noSrc)}
        ${b.srcTitle ? `<span class="sub">「${esc(b.srcTitle)}」</span>` : ''}</span></li>`;
  }).join('');
  // 이미지 출처
  const imgItems = [];
  if (state.opts.coverSrc) imgItems.push(`${T().coverPhoto} — ${srcDisp(state.opts.coverSrc).replace(/^ⓒ\s*/, '')}`);
  const bookCredit = bookImageCredit(sel);
  if (bookCredit) imgItems.push(bookCredit);
  const img = imgItems.map((s, i) =>
    `<li><span class="n">${String(i + 1).padStart(2, '0')}</span><span class="t">${esc(s)}</span></li>`).join('');
  return `<div class="cn-pad cn-outro">
    ${topBar(T().brand, T().tagline)}
    <h2 class="cn-otitle">${esc(T().sources)}</h2>
    <div class="cn-srcgroup">
      <div class="cn-glab">${esc(T().txtGroup)}</div>
      <ul class="cn-srclist">${txt}</ul>
    </div>
    <div class="cn-srcgroup">
      <div class="cn-glab">${esc(T().imgGroup)}</div>
      <ul class="cn-srclist">${img}</ul>
    </div>
    <div class="cn-spacer"></div>
    <div class="cn-foot"><span class="h">${esc(enName())}</span><span class="g">${esc(state.opts.handle)}</span></div>
  </div>`;
}

function promoHTML() {
  return `<div class="cn-pad cn-promo">
    <div class="cn-bn">${esc(T().brand)}</div>
    <div class="cn-tag">${esc(T().promoTag)}</div>
    <div class="cn-stat">${esc(T().promoStat(state.celebCount, state.bookCount))}</div>
    <div class="cn-cta">${esc(state.opts.handle)} <span class="arr">→</span></div>
  </div>`;
}

/* ========================================================
   스티커 레이어 — '함께 읽기 카드 만들기'(/together/)의 자유 배치 기능을
   카드뉴스에도 들여온 것. 장(sscope)마다 따로 얹히고, 카드 좌표(1080 기준)에
   절대 위치로 놓인다. 글자를 비워도 남고, 크기·기울기·앞뒤를 바꿀 수 있다.
   ======================================================== */
const STK_LABEL = {
  title: '🔠 큰 제목', bubble: '💬 말풍선', stars: '⭐ 별점', emoji: '✨ 이모지', tag: '🏷 라벨',
  soft: '🧁 요즘 박스', deco: '🧸 그림', outline: '🖍 외곽선 글자',
};
const STK_SHAPES = { blob: '몽글', pill: '알약', burst: '뾰족' };
const SOFT_SHAPES = { round: '둥근 박스', chip: '단색 라벨', line: '얇은 테두리', note: '메모지', tape: '테이프' };
const isBlank = (v) => !String(v == null ? '' : v).trim();

/* ── 책등 ─────────────────────────────────────────────────────────
 * 예스24는 표지와 같은 상품 ID로 책등 이미지를 준다.
 *   표지  https://image.yes24.com/goods/91901136/L
 *   책등  https://image.yes24.com/goods/91901136/side
 * 표지가 알라딘인 책은 ID를 모르니 제목에서 만든 색 책등으로 대신한다.
 * (generate.py · together/app.js 와 같은 규칙) */
const YES24_ID_RE = /image\.yes24\.com\/goods\/(?:detail\/)?(\d+)/i;
function yes24SpineUrl(coverUrl) {
  const m = YES24_ID_RE.exec(coverUrl || '');
  return m ? 'https://image.yes24.com/goods/' + m[1] + '/side' : '';
}
function hashOf(str, mul) {
  let h = 0;
  for (const ch of String(str || '')) h = (Math.imul(h, mul) + ch.codePointAt(0)) >>> 0;
  return h;
}
function spineTint(title) {
  const h = hashOf(title, 31);
  return `hsl(${h % 360},${32 + (h >>> 9) % 26}%,${26 + (h >>> 17) % 22}%)`;
}
const SPINE_RATIO = 4.3;

function stickersOf(sscope) {
  if (!state.opts.stickers) state.opts.stickers = {};
  if (!state.opts.stickers[sscope]) state.opts.stickers[sscope] = [];
  return state.opts.stickers[sscope];
}
function findSticker(sscope, id) { return stickersOf(sscope).find((x) => x.id === id); }
function selSticker() {
  const s = state.selSticker;
  return s ? findSticker(s.sscope, s.id) : null;
}

function stickerHTML(it, sscope) {
  const base = `left:${it.x}px;top:${it.y}px;transform:rotate(${it.rot || 0}deg);`;
  const boxCls = (isBlank(it.text) ? ' is-empty' : '') + (it.w ? ' has-w' : '') + (it.h ? ' has-h' : '');
  const boxStyle = (it.w ? `width:${it.w}px;max-width:none;` : '') + (it.h ? `height:${it.h}px;` : '');
  const at = ` data-stk="${it.id}" data-sscope="${sscope}"`;
  const style = `${base}${boxStyle}font-size:${it.size}px;`;

  if (it.type === 'title') {
    return `<div class="cn-stk cn-stk-title${boxCls}"${at} style="${style}">${escML(it.text)}</div>`;
  }
  if (it.type === 'bubble') {
    return `<div class="cn-stk cn-stk-bubble${boxCls}"${at} data-shape="${esc(it.shape)}"
      style="${style}--bubble:${esc(stickerColor(it))};background:${esc(stickerColor(it))};color:${esc(onColor(stickerColor(it)))}">${escML(it.text)}</div>`;
  }
  if (it.type === 'stars') {
    return `<div class="cn-stk cn-stk-stars${boxCls}"${at} style="${style}">
      <span class="cn-stk-starrow">${'★'.repeat(Math.max(1, Math.min(5, it.n || 5)))}</span>
      ${it.text ? `<span class="cn-stk-starcap">${escML(it.text)}</span>` : ''}
    </div>`;
  }
  if (it.type === 'emoji') {
    return `<div class="cn-stk cn-stk-emoji${boxCls}"${at} style="${style}">${escML(it.text)}</div>`;
  }
  // 요즘 스타일 박스 — 두꺼운 테두리 없이 옅은 바탕에 진한 글자.
  // 모양만 바꿔 라벨·얇은 테두리·메모지·테이프까지 한 종류로 쓴다.
  if (it.type === 'soft') {
    const pal = paletteFor(state.opts.bg, state.opts.inkAuto ? '' : state.opts.ink);
    const c = stickerColor(it), sh = it.shape || 'round';
    const bg = mix(c, pal['--paper'], 0.76), fg = mix(c, pal['--ink'], 0.58);
    let sty = '';
    if (sh === 'chip') sty = `background:${c};color:${onColor(c)};`;
    else if (sh === 'line') sty = `background:${pal['--paper']};color:${fg};border-color:${fg};`;
    else if (sh === 'tape') sty = `background:${mix(c, pal['--paper'], 0.45)};color:${fg};`;
    else sty = `background:${bg};color:${fg};`;
    return `<div class="cn-stk cn-stk-soft${boxCls}"${at} data-shape="${esc(sh)}" style="${style}${sty}">${escML(it.text)}</div>`;
  }
  // 그림 스티커 — 상자 없이 이모지만. 여백을 채우는 용도.
  if (it.type === 'deco') {
    return `<div class="cn-stk cn-stk-deco${boxCls}"${at} style="${style}">${escML(it.text)}</div>`;
  }
  // 외곽선 글자 — 사진 위에 얹어도 읽히는 한 줄 문구
  if (it.type === 'outline') {
    return `<div class="cn-stk cn-stk-outline${boxCls}"${at} style="${style}">${escML(it.text)}</div>`;
  }
  return `<div class="cn-stk cn-stk-tag${boxCls}"${at} style="${style}">${escML(it.text)}</div>`;
}

/* 말풍선 색: 포인트 색 / 배경색 / 글자색 중에서 고른다 (테마를 바꿔도 따라온다) */
function stickerColor(it) {
  const pal = paletteFor(state.opts.bg, state.opts.inkAuto ? '' : state.opts.ink);
  if (it.color === 'paper') return pal['--paper'];
  if (it.color === 'ink') return pal['--ink'];
  return accentColor();
}

function stickerLayerHTML(sscope) {
  const list = (state.opts.stickers && state.opts.stickers[sscope]) || [];
  if (!list.length) return '';
  return `<div class="cn-stk-layer">${list.map((it) => stickerHTML(it, sscope)).join('')}</div>`;
}

/* 새 스티커는 이미 올려둔 것 아래로 차곡차곡 (겹치지 않게) */
function stickerEstHeight(it) {
  if (it.h) return it.h + 20;
  const size = it.size || 40;
  const lines = isBlank(it.text) ? 1 : String(it.text).split('\n').length;
  if (it.type === 'title') return size * 1.15 * lines + 20;
  if (it.type === 'bubble') return size * 1.35 * lines + 105;
  if (it.type === 'stars') return size * (it.text ? 2.7 : 1.6) + 40;
  if (it.type === 'soft') return size * 1.35 * lines + 40;
  if (it.type === 'deco') return size * 1.05;
  if (it.type === 'outline') return size * 1.2 * lines + 16;
  return size * 1.3 + 30;
}

/* ========================================================
   스티커 고르기 — 미리보기 갤러리
   버튼 이름만 보고는 어떤 모양이 나오는지 알 수 없어서,
   실제로 올라갈 모습을 그대로 작게 그려 보여준다.
   글자는 예시일 뿐이라 그대로 써도 되고 지워도 된다.
   ======================================================== */
const STK_PRESETS = [
  { key: 'soft-round', name: '둥근 박스', group: 'soft',
    make: () => ({ type: 'soft', shape: 'round', color: 'accent', text: '가을이 오면은', size: 52, rot: -1 }) },
  { key: 'soft-chip', name: '단색 라벨', group: 'soft',
    make: () => ({ type: 'soft', shape: 'chip', color: 'accent', text: '깊생 금지', size: 44, rot: -2 }) },
  { key: 'soft-line', name: '얇은 테두리', group: 'soft',
    make: () => ({ type: 'soft', shape: 'line', color: 'ink', text: '느낌 좋은', size: 42, rot: 2 }) },
  { key: 'soft-note', name: '메모지', group: 'soft',
    make: () => ({ type: 'soft', shape: 'note', color: 'accent', text: '천고마비의\n계절', size: 44, rot: -3 }) },
  { key: 'soft-tape', name: '테이프 (빈 칸)', group: 'soft',
    make: () => ({ type: 'soft', shape: 'tape', color: 'accent', text: '', size: 36, w: 420, h: 72, rot: -7 }) },
  { key: 'outline', name: '외곽선 글자', group: 'soft',
    make: () => ({ type: 'outline', text: '행복은 이렇게나 많다', size: 64, rot: -9 }) },

  { key: 'deco-bear', name: '곰돌이', group: 'deco',
    make: () => ({ type: 'deco', text: '🧸', size: 130, rot: -6 }) },
  { key: 'deco-cafe', name: '커피', group: 'deco',
    make: () => ({ type: 'deco', text: '☕', size: 120, rot: 5 }) },
  { key: 'deco-ribbon', name: '리본', group: 'deco',
    make: () => ({ type: 'deco', text: '🎀', size: 120, rot: -8 }) },
  { key: 'deco-moon', name: '달·별', group: 'deco',
    make: () => ({ type: 'deco', text: '🌙', size: 120, rot: 4 }) },

  { key: 'title', name: '큰 제목', group: 'basic',
    make: (dn) => ({ type: 'title', text: `${dn}의\n책장`, size: 92, w: 820, rot: -2 }) },
  { key: 'bubble', name: '말풍선', group: 'basic',
    make: (dn) => ({ type: 'bubble', text: `${josa(dn, '이', '가')} 읽은 책`, size: 44, shape: 'blob', color: 'accent', rot: -4 }) },
  { key: 'stars', name: '별점', group: 'basic',
    make: () => ({ type: 'stars', text: '별이 다섯 개!', size: 40, n: 5, rot: 3 }) },
  { key: 'emoji', name: '이모지 줄', group: 'basic',
    make: () => ({ type: 'emoji', text: '✨ 📚 🩷 ⭐️', size: 54, rot: 0 }) },
  { key: 'tag', name: '작은 라벨', group: 'basic',
    make: (dn) => ({ type: 'tag', text: `#${dn}_독서`, size: 34, rot: -3 }) },
];

const STK_GROUPS = [
  ['soft', '요즘 스타일'],
  ['deco', '그림 스티커'],
  ['basic', '기본'],
];

function presetSticker(p) {
  const dn = displayName(state.name) || '최애';
  return { id: 'prev', x: 0, y: 0, rot: 0, ...p.make(dn) };
}

function buildStickerGallery() {
  const box = $('#stkGal');
  if (!box) return;
  // 장 위와 똑같은 색이 나오도록 팔레트를 그대로 넘긴다
  const pal = paletteFor(state.opts.bg, state.opts.inkAuto ? '' : state.opts.ink);
  let vars = '';
  for (const k in pal) vars += `${k}:${pal[k]};`;
  vars += `--accent:${accentColor()};`;
  box.innerHTML = STK_GROUPS.map(([g, label]) => {
    const cells = STK_PRESETS.filter((p) => p.group === g).map((p) => `
      <button class="stk-cell" type="button" data-preset="${p.key}" title="${esc(p.name)} 올리기">
        <span class="stk-prev" style="${vars}background:${pal['--paper']}">
          <span class="stk-prev-in">${stickerHTML(presetSticker(p), 'prev')}</span>
        </span>
        <span class="stk-cell-n">${esc(p.name)}</span>
      </button>`).join('');
    return `<div class="stk-gal-h">${esc(label)}</div><div class="stk-gal-row">${cells}</div>`;
  }).join('');
  fitStickerPreviews();
}

/* 실제 크기 그대로 그린 뒤 칸에 맞게 줄인다 — 미리 정한 배율을 쓰면
   글자 수가 다른 스티커끼리 크기가 들쭉날쭉해진다. */
function fitStickerPreviews() {
  $$('.stk-prev').forEach((box) => {
    const inner = box.querySelector('.stk-prev-in');
    if (!inner) return;
    inner.style.transform = 'none';
    const w = inner.offsetWidth, h = inner.offsetHeight;
    if (!w || !h) return;
    const s = Math.min((box.clientWidth - 10) / w, (box.clientHeight - 10) / h, 1);
    inner.style.transform = `scale(${s})`;
  });
}

function addSticker(key) {
  const sscope = state.stickerScope;
  if (!sscope) { status('스티커를 올릴 장을 먼저 고르세요'); return; }
  const p = STK_PRESETS.find((x) => x.key === key);
  if (!p) return;
  const [W, H] = dims();
  const list = stickersOf(sscope);
  const bottom = list.reduce((m, i) => Math.max(m, i.y + stickerEstHeight(i)), 0);
  const it = presetSticker(p);
  it.id = 's' + (state.opts.stickerSeq = (state.opts.stickerSeq || 1) + 1);
  it.x = Math.max(60, Math.min(80 + list.length * 14, W - 360));
  // 첫 스티커는 카드 중간쯤에서 시작한다 — 위쪽은 제목·브랜드가 이미 차 있다.
  // 두 번째부터는 앞 스티커 아래로 쌓는다.
  it.y = Math.max(70, Math.min(bottom ? bottom + 34 : Math.round(H * 0.42), H - 300));
  list.push(it);
  state.selSticker = { sscope, id: it.id };
  renderPreview();
}

function removeSticker(sscope, id) {
  state.opts.stickers[sscope] = stickersOf(sscope).filter((x) => x.id !== id);
  if (state.selSticker && state.selSticker.id === id) state.selSticker = null;
}

/* ---- 스티커 패널 ---- */
function slideLabel(sl, i) {
  const labels = { cover: '표지', sources: '출처', promo: '홍보' };
  return `${String(i + 1).padStart(2, '0')} ${labels[sl.name] || '본문 ' + sl.name.replace('book', '')}`;
}

function renderStickerPanel() {
  const block = $('#stickerBlock');
  if (!state.celeb) { block.classList.add('hidden'); return; }
  block.classList.remove('hidden');

  // 올릴 장 목록 — 슬라이드 구성이 바뀌면 같이 바뀐다
  const slides = buildSlides();
  const sel = $('#stkScope');
  if (!slides.some((sl) => sl.sscope === state.stickerScope)) {
    state.stickerScope = slides.length ? slides[0].sscope : null;
  }
  sel.innerHTML = slides.map((sl, i) => {
    const n = ((state.opts.stickers || {})[sl.sscope] || []).length;
    return `<option value="${esc(sl.sscope)}"${sl.sscope === state.stickerScope ? ' selected' : ''}>${esc(slideLabel(sl, i))}${n ? ` · 스티커 ${n}` : ''}</option>`;
  }).join('');

  buildStickerGallery();   // 지금 배경색·포인트색으로 미리보기를 다시 그린다
  renderStickerEditor();
  renderStickerLayers();
}

function renderStickerLayers() {
  const ul = $('#stkLayers');
  const list = (state.opts.stickers || {})[state.stickerScope] || [];
  if (!list.length) { ul.innerHTML = ''; return; }
  ul.innerHTML = list.map((it) => {
    const txt = isBlank(it.text) ? '(빈 칸)' : it.text.split('\n')[0];
    const on = state.selSticker && state.selSticker.id === it.id;
    return `<li class="layer${on ? ' sel' : ''}" data-id="${it.id}">
      <span class="lb">${STK_LABEL[it.type] || it.type}</span>
      <span class="lt">${esc(txt)}</span>
      <span class="ltools">
        <button class="btn tiny" data-act="up" title="앞으로">▲</button>
        <button class="btn tiny" data-act="down" title="뒤로">▼</button>
        <button class="btn tiny" data-act="del" title="빼기">✕</button>
      </span>
    </li>`;
  }).join('');
  ul.onclick = (e) => {
    const li = e.target.closest('.layer'); if (!li) return;
    const id = li.dataset.id, btn = e.target.closest('button[data-act]');
    const arr = stickersOf(state.stickerScope);
    const idx = arr.findIndex((x) => x.id === id);
    if (!btn) { state.selSticker = { sscope: state.stickerScope, id }; }
    else if (btn.dataset.act === 'del') removeSticker(state.stickerScope, id);
    else if (btn.dataset.act === 'up' && idx < arr.length - 1) arr.splice(idx + 1, 0, arr.splice(idx, 1)[0]);
    else if (btn.dataset.act === 'down' && idx > 0) arr.splice(idx - 1, 0, arr.splice(idx, 1)[0]);
    renderStickerPanel();
    renderPreview();
  };
}

function renderStickerEditor() {
  const box = $('#stkEditor'), hint = $('#stkPickHint');
  const it = selSticker();
  if (!it) { box.classList.add('hidden'); box.innerHTML = ''; hint.classList.remove('hidden'); return; }
  hint.classList.add('hidden');
  box.classList.remove('hidden');
  const [CW, CH] = dims();

  box.innerHTML = `
    <div class="ie-head">${STK_LABEL[it.type] || it.type} 고치기</div>
    <label class="field"><span>글자 <em>(엔터로 줄바꿈 · 비워도 됩니다)</em></span>
      <textarea class="stk-text" rows="2">${esc(it.text || '')}</textarea></label>
    ${it.type === 'stars' ? `<label class="field range"><span>별 개수 <output class="stk-n-o">${it.n}</output></span>
      <input class="stk-n" type="range" min="1" max="5" value="${it.n}"></label>` : ''}
    ${it.type === 'bubble' ? `
      <div class="field"><span>모양</span>
        <div class="seg seg-row">
          ${Object.keys(STK_SHAPES).map((sh) => `<label><input type="radio" name="stkShape" value="${sh}"${it.shape === sh ? ' checked' : ''}> ${STK_SHAPES[sh]}</label>`).join('')}
        </div>
      </div>` : ''}
    ${it.type === 'soft' ? `
      <div class="field"><span>모양</span>
        <div class="seg">
          ${Object.keys(SOFT_SHAPES).map((sh) => `<label><input type="radio" name="stkShape" value="${sh}"${(it.shape || 'round') === sh ? ' checked' : ''}> ${SOFT_SHAPES[sh]}</label>`).join('')}
        </div>
      </div>` : ''}
    ${(it.type === 'bubble' || it.type === 'soft') ? `
      <div class="field"><span>색</span>
        <div class="seg seg-row">
          ${[['accent', '포인트'], ['paper', '배경'], ['ink', '글자']].map(([k, lb]) => `<label><input type="radio" name="stkColor" value="${k}"${(it.color || 'accent') === k ? ' checked' : ''}> ${lb}</label>`).join('')}
        </div>
      </div>` : ''}
    <label class="field range"><span>글자 크기 <output class="stk-size-o">${it.size}</output></span>
      <input class="stk-size" type="range" min="20" max="200" value="${it.size}"></label>
    <label class="field range"><span>가로 폭
        <label class="chk inline"><input class="stk-w-auto" type="checkbox"${it.w ? '' : ' checked'}> 자동</label>
        <output class="stk-w-o">${it.w ? it.w + 'px' : '글자에 맞춤'}</output></span>
      <input class="stk-w" type="range" min="60" max="${CW}" step="10" value="${it.w || Math.round(CW * 0.5)}"${it.w ? '' : ' disabled'}></label>
    <label class="field range"><span>높이
        <label class="chk inline"><input class="stk-h-auto" type="checkbox"${it.h ? '' : ' checked'}> 자동</label>
        <output class="stk-h-o">${it.h ? it.h + 'px' : '글자에 맞춤'}</output></span>
      <input class="stk-h" type="range" min="40" max="${CH}" step="10" value="${it.h || 160}"${it.h ? '' : ' disabled'}></label>
    <label class="field range"><span>기울기 <output class="stk-rot-o">${it.rot || 0}°</output></span>
      <input class="stk-rot" type="range" min="-25" max="25" value="${it.rot || 0}"></label>
    <div class="add-row">
      <button class="btn tiny" data-stk-ie="front">맨 앞으로</button>
      <button class="btn tiny" data-stk-ie="back">맨 뒤로</button>
      <button class="btn tiny" data-stk-ie="del">이 스티커 빼기</button>
    </div>`;

  // 슬라이더를 끄는 동안 패널을 다시 그리면 input이 교체돼 드래그가 끊긴다.
  // 카드만 다시 그리고 출력 라벨은 직접 갱신한다.
  const live = (fn) => { fn(); renderPreview({ keepPanel: true }); };
  const setOut = (cls, v) => { const o = box.querySelector(cls); if (o) o.textContent = v; };

  box.querySelector('.stk-text').addEventListener('input', (e) => {
    it.text = e.target.value;
    renderPreview({ keepPanel: true });
    renderStickerLayers();
  });
  const nR = box.querySelector('.stk-n');
  if (nR) nR.addEventListener('input', (e) => live(() => { it.n = +e.target.value; setOut('.stk-n-o', it.n); }));
  box.querySelector('.stk-size').addEventListener('input', (e) => live(() => {
    it.size = +e.target.value; setOut('.stk-size-o', it.size);
  }));
  box.querySelector('.stk-rot').addEventListener('input', (e) => live(() => {
    it.rot = +e.target.value; setOut('.stk-rot-o', it.rot + '°');
  }));
  [['w', 'stk-w'], ['h', 'stk-h']].forEach(([key, cls]) => {
    const auto = box.querySelector('.' + cls + '-auto');
    const range = box.querySelector('.' + cls);
    const out = '.' + cls + '-o';
    auto.addEventListener('change', (e) => {
      range.disabled = e.target.checked;
      live(() => {
        it[key] = e.target.checked ? null : +range.value;
        setOut(out, it[key] ? it[key] + 'px' : '글자에 맞춤');
      });
    });
    range.addEventListener('input', (e) => {
      auto.checked = false; range.disabled = false;
      live(() => { it[key] = +e.target.value; setOut(out, it[key] + 'px'); });
    });
  });
  $$('input[name=stkShape]', box).forEach((r) => r.addEventListener('change', (e) => {
    if (e.target.checked) { it.shape = e.target.value; renderPreview(); }
  }));
  $$('input[name=stkColor]', box).forEach((r) => r.addEventListener('change', (e) => {
    if (e.target.checked) { it.color = e.target.value; renderPreview(); }
  }));
  box.querySelectorAll('button[data-stk-ie]').forEach((b) => b.addEventListener('click', () => {
    const arr = stickersOf(state.selSticker.sscope);
    const idx = arr.findIndex((x) => x.id === it.id);
    const act = b.dataset.stkIe;
    if (act === 'del') removeSticker(state.selSticker.sscope, it.id);
    else if (act === 'front') arr.push(arr.splice(idx, 1)[0]);
    else arr.unshift(arr.splice(idx, 1)[0]);
    renderStickerPanel();
    renderPreview();
  }));
}

function buildSlides() {
  const slides = [], sel = selectedBooks();
  slides.push({ name: 'cover', html: coverHTML(), scope: 'cover' });
  sel.forEach((b, i) => slides.push({
    name: `book${i + 1}`, html: bookHTML(b, i + 1, sel.length),
    scope: `book:${state.books.indexOf(b)}`,
  }));
  if (state.opts.outro && sel.length) slides.push({ name: 'sources', html: outroHTML() });
  if (state.opts.promo) slides.push({ name: 'promo', html: promoHTML() });
  // 스티커는 장 위에 얹는 별도 레이어라 본문 HTML을 만든 뒤 붙인다.
  // scope는 기존 마우스 조정 전용이므로 건드리지 않고 sscope를 따로 둔다.
  slides.forEach((sl) => {
    sl.sscope = sl.scope || sl.name;
    sl.html += stickerLayerHTML(sl.sscope);
  });
  return slides;
}

function themeDef() { return THEMES[state.opts.theme] || THEMES.editorial; }
function accentColor() {
  return state.opts.accentAuto ? themeDef().accent : (state.opts.accent || themeDef().accent);
}

function makeSlideEl(html) {
  const el = document.createElement('div');
  el.className = 'cn-slide'
    + ' th-' + (THEMES[state.opts.theme] ? state.opts.theme : 'editorial')
    + (state.opts.format === 'square' ? ' square' : '')
    + (state.opts.mono ? ' cn-mono' : '')
    + (state.opts.fit === 'cover' ? ' fit-cover' : ' fit-contain');
  const pal = paletteFor(state.opts.bg, state.opts.inkAuto ? '' : state.opts.ink);
  for (const k in pal) el.style.setProperty(k, pal[k]);
  el.style.setProperty('--accent', accentColor());
  el.style.background = pal['--paper'];
  const posMap = { top: 'center 18%', center: 'center', bottom: 'center 82%' };
  el.style.setProperty('--imgpos', posMap[state.opts.imgPos] || 'center');
  el.innerHTML = html;
  return el;
}

/* ========================================================
   미리보기
   ======================================================== */
function renderPreview(opts) {
  if (!state.celeb) return;
  const wrap = $('#slides');
  $('#stageEmpty').classList.add('hidden');
  $('#stageTip').classList.remove('hidden');
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
    frame.style.width = `${w * s}px`; frame.style.height = `${h * s}px`;
    frame.dataset.scale = s;
    frame.appendChild(el);

    const bar = document.createElement('div');
    bar.className = 'slide-bar';
    const labels = { cover: '표지', sources: '출처', promo: '홍보' };
    const label = labels[sl.name] || `본문 ${sl.name.replace('book', '')}`;
    bar.innerHTML = `<b>${String(i + 1).padStart(2, '0')}</b> ${label}`;
    if (sl.scope) {
      const rs = document.createElement('button');
      rs.textContent = '↺ 조정 초기화';
      rs.title = '이 장에서 마우스로 옮기거나 키운 것을 되돌려요';
      rs.addEventListener('click', () => resetAdj(sl.scope));
      bar.appendChild(rs);
    }
    const dl = document.createElement('button');
    dl.textContent = '⤓ PNG';
    dl.addEventListener('click', () => exportOne(sl, i));
    bar.appendChild(dl);

    const sw = document.createElement('div');
    sw.className = 'slide-wrap';
    sw.append(frame, bar);
    wrap.appendChild(sw);
  });
  applyPhotoFits(wrap);   // DOM에 올라간 뒤 실제 상자 크기로 사진 배율 확정
  // 슬라이더를 끄는 중에는 패널을 다시 그리지 않는다 — 끌고 있던 input이
  // 교체되면 거기서 조절이 끊기기 때문.
  if (!opts || !opts.keepPanel) renderStickerPanel();
  markSelectedSticker();  // 선택 표시는 미리보기에만 (PNG에는 안 나가야 하므로)
}

/* 선택 테두리는 HTML에 넣지 않고 그린 뒤에 붙인다 — slideToCanvas는 같은 HTML을
   다시 쓰기 때문에, 클래스로 넣어두면 PNG에도 점선이 찍힌다. */
function markSelectedSticker() {
  $$('#slides .cn-stk.sel').forEach((el) => el.classList.remove('sel'));
  const s = state.selSticker;
  if (!s) return;
  const el = $(`#slides .cn-stk[data-stk="${s.id}"][data-sscope="${s.sscope}"]`);
  if (el) el.classList.add('sel');
}
let resizeT;
window.addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(renderPreview, 150); });

/* ========================================================
   미리보기 위에서 마우스로 조정
   · 끌기  : 글자·책 표지는 위치 이동, 사진은 초점 이동
   · 휠    : 글자·책 표지는 크기, 사진은 확대
   ======================================================== */
function bindAdjust() {
  const wrap = $('#slides');
  let drag = null;

  const scaleOf = (el) => parseFloat(el.closest('.cn-frame')?.dataset.scale) || 1;

  wrap.addEventListener('pointerdown', (e) => {
    // 스티커가 먼저 — 장 위에 얹힌 레이어라 아래 요소보다 우선한다
    const stk = e.target.closest('[data-stk]');
    if (stk && e.button === 0) {
      const { stk: id, sscope } = stk.dataset;
      const it = findSticker(sscope, id);
      if (it) {
        pushUndo('drag:' + id);
        state.stickerScope = sscope;
        state.selSticker = { sscope, id };
        renderStickerPanel();
        markSelectedSticker();
        drag = {
          el: stk, kind: 'stk', it, scale: scaleOf(stk),
          sx: e.clientX, sy: e.clientY, ox: it.x, oy: it.y,
        };
        stk.setPointerCapture(e.pointerId);
        stk.classList.add('adj-on');
        e.preventDefault();
        return;
      }
    }
    const el = e.target.closest('[data-adj]');
    if (!el || e.button !== 0) return;
    const { adj: key, scope, kind } = el.dataset;
    if (kind === 'pan') {
      const ph = photoProps(scope);
      if (!ph) return;
      const m = /(\d+(?:\.\d+)?)px\s+(\d+(?:\.\d+)?)px/.exec(el.style.backgroundSize || '');
      pushUndo('pan:' + scope);
      drag = {
        el, kind, ph, sx: e.clientX, sy: e.clientY, ox: ph.x, oy: ph.y, scale: scaleOf(el),
        imgW: m ? +m[1] : 0, imgH: m ? +m[2] : 0,
      };
    } else {
      const a = getAdj(scope, key);
      if (!a) return;
      pushUndo('move:' + scope + ':' + key);
      drag = { el, kind: 'move', a, sx: e.clientX, sy: e.clientY, ox: a.dx, oy: a.dy, scale: scaleOf(el) };
    }
    el.setPointerCapture(e.pointerId);
    el.classList.add('adj-on');
    e.preventDefault();
  });

  wrap.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = (e.clientX - drag.sx) / drag.scale;
    const dy = (e.clientY - drag.sy) / drag.scale;
    if (drag.kind === 'stk') {
      const [W, H] = dims();
      drag.it.x = Math.round(Math.max(-200, Math.min(drag.ox + dx, W - 40)));
      drag.it.y = Math.round(Math.max(-120, Math.min(drag.oy + dy, H - 40)));
      drag.el.style.left = `${drag.it.x}px`;
      drag.el.style.top = `${drag.it.y}px`;
      return;
    }
    if (drag.kind === 'pan') {
      // 0~100% 가 움직이는 실제 거리(넘치는 폭 또는 남는 여백)로 나눠야 손끝을 따라온다.
      // 꽉 채움이면 사진이 반대로, 전체 보기(여백 있음)면 같은 방향으로 움직인다.
      // 넘치지도 남지도 않는 축은 움직일 여지가 없으므로 그대로 둔다.
      const W = drag.el.clientWidth || 1, H = drag.el.clientHeight || 1;
      const rawX = (drag.imgW || W) - W, rawY = (drag.imgH || H) - H;
      const moveAxis = (o, d, raw) => {
        const denom = Math.abs(raw);
        if (denom <= 1) return o;
        return clampNum(o + (raw > 0 ? -1 : 1) * (d / denom) * 100, 0, 100);
      };
      drag.ph.x = moveAxis(drag.ox, dx, rawX);
      drag.ph.y = moveAxis(drag.oy, dy, rawY);
      drag.el.dataset.x = drag.ph.x;
      drag.el.dataset.y = drag.ph.y;
      drag.el.style.backgroundPosition = `${drag.ph.x}% ${drag.ph.y}%`;
    } else {
      drag.a.dx = Math.round(drag.ox + dx);
      drag.a.dy = Math.round(drag.oy + dy);
      drag.el.style.transform = transformOf(drag.a);
    }
  });

  const endDrag = () => {
    if (!drag) return;
    drag.el.classList.remove('adj-on');
    if (drag.kind === 'pan') syncPhotoPanel(drag.el.dataset.scope);
    drag = null;
  };
  wrap.addEventListener('pointerup', endDrag);
  wrap.addEventListener('pointercancel', endDrag);

  wrap.addEventListener('wheel', (e) => {
    const stk = e.target.closest('[data-stk]');
    if (stk) {
      const it = findSticker(stk.dataset.sscope, stk.dataset.stk);
      if (!it) return;
      e.preventDefault();
      pushUndo('wheel:' + it.id);
      it.size = Math.round(clampNum(it.size * (e.deltaY < 0 ? 1.06 : 1 / 1.06), 20, 200));
      stk.style.fontSize = `${it.size}px`;
      const o = $('#stkEditor .stk-size-o'), r = $('#stkEditor .stk-size');
      if (o && state.selSticker && state.selSticker.id === it.id) { o.textContent = it.size; r.value = it.size; }
      return;
    }
    const el = e.target.closest('[data-adj]');
    if (!el) return;
    e.preventDefault();
    const { adj: key, scope, kind } = el.dataset;
    pushUndo('wheel:' + scope + ':' + (key || kind));
    const step = e.deltaY < 0 ? 1.06 : 1 / 1.06;
    if (kind === 'pan') {
      const ph = photoProps(scope);
      if (!ph) return;
      ph.zoom = clampNum((ph.zoom || 1) * step, 1, 4);
      el.dataset.zoom = ph.zoom;
      applyPhotoFits(el.parentElement || document);
      syncPhotoPanel(scope);
    } else {
      const a = getAdj(scope, key);
      if (!a) return;
      a.s = clampNum((a.s || 1) * step, 0.4, 3);
      el.style.transform = transformOf(a);
    }
  }, { passive: false });
}
const clampNum = (v, a, b) => Math.max(a, Math.min(b, Math.round(v * 100) / 100));
function transformOf(a) {
  const sc = a.s && a.s !== 1 ? ` scale(${a.s})` : '';
  return `translate(${a.dx || 0}px,${a.dy || 0}px)${sc}`;
}

/* ========================================================
   내보내기
   ======================================================== */
function waitForImages(node, timeout = 9000) {
  const tasks = [];
  // <img> 요소
  $$('img', node).forEach((img) => {
    if (img.complete && img.naturalWidth) return;
    tasks.push(new Promise((resolve) => {
      img.addEventListener('load', resolve, { once: true });
      img.addEventListener('error', resolve, { once: true });
      setTimeout(resolve, timeout);
    }));
  });
  // background-image div (카드 이미지)
  $$('.cn-imgbg', node).forEach((d) => {
    const m = /url\(["']?(.*?)["']?\)/.exec(d.style.backgroundImage || '');
    if (!m || !m[1]) return;
    const url = m[1];
    tasks.push(new Promise((resolve) => {
      const im = new Image();
      im.crossOrigin = 'anonymous';
      im.onload = () => {
        if (!imgMeta[url] || !imgMeta[url].w) {
          imgMeta[url] = { w: im.naturalWidth || 0, h: im.naturalHeight || 0 };
        }
        resolve();
      };
      im.onerror = resolve;
      im.src = url;
      setTimeout(resolve, timeout);
    }));
  });
  return Promise.all(tasks);
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
    applyPhotoFits(el);
    await new Promise((r) => setTimeout(r, 120));
    return await html2canvas(el, {
      width: w, height: h, windowWidth: w, windowHeight: h,
      scale: OUTPUT_SCALE, useCORS: true, backgroundColor: null, logging: false,
    });
  } finally { holder.remove(); }
}
function safeName(s) { return String(s).replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, '_'); }
function canvasToBlob(c) { return new Promise((r) => c.toBlob(r, 'image/png')); }

async function exportOne(sl, i) {
  status('PNG 만드는 중…');
  try {
    const blob = await canvasToBlob(await slideToCanvas(sl));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${safeName(displayName(state.name))}_${String(i + 1).padStart(2, '0')}_${sl.name}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    status('완료');
  } catch (e) { console.error(e); status('저장 실패 (프록시를 켜고 다시 시도해 보세요)'); }
}
async function exportZip() {
  if (!state.celeb) return;
  const slides = buildSlides(), zip = new JSZip(), base = safeName(displayName(state.name));
  for (let i = 0; i < slides.length; i++) {
    status(`PNG ${i + 1}/${slides.length} 만드는 중…`);
    const blob = await canvasToBlob(await slideToCanvas(slides[i]));
    zip.file(`${base}_${String(i + 1).padStart(2, '0')}_${slides[i].name}.png`, blob);
  }
  status('ZIP 압축 중…');
  const out = await zip.generateAsync({ type: 'blob' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(out);
  a.download = `favorbook_cardnews_${base}.zip`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  status(`완료 · ${slides.length}장`);
}

/* ========================================================
   전체 원고 복사
   ======================================================== */
function buildScript() {
  const dn = displayName(state.name), sel = selectedBooks(), lines = [];
  lines.push(`[${T().brand}] ${state.opts.title}`);
  if (state.opts.subtitle) lines.push(state.opts.subtitle);
  if (state.opts.coverSrc) lines.push(state.opts.coverSrc);
  lines.push('');
  sel.forEach((b, i) => {
    const r = b.ref;
    lines.push(`${String(i + 1).padStart(2, '0')}. 《${bookTitle(r)}》 ${[bookAuthor(r), state.opts.lang === 'en' ? '' : r.publisher].filter(Boolean).join(' · ')}`);
    if (b.quote) lines.push(`“${b.quote}”`);
    const c = citeText(b); if (c) lines.push(`${T().source}: ${c}`);
    if (b.ref.source) lines.push(cleanUrl(b.ref.source));
    lines.push('');
  });
  lines.push(`[${T().sources}]`);
  lines.push(`· ${T().txtGroup}`);
  sel.forEach((b, i) => {
    lines.push(`  ${i + 1}. 《${bookTitle(b.ref)}》 — ${citeText(b) || T().noSrc}`);
    if (b.ref.source) lines.push(`     ${cleanUrl(b.ref.source)}`);
  });
  lines.push(`· ${T().imgGroup}`);
  if (state.opts.coverSrc) lines.push(`  - ${T().coverPhoto} — ${state.opts.coverSrc.replace(/^ⓒ\s*/, '')}`);
  const _bc = bookImageCredit(sel);
  if (_bc) lines.push(`  - ${_bc}`);
  lines.push('');
  lines.push(`${T().brand} · ${T().promoTag}`);
  lines.push(`${T().promoStat(state.celebCount, state.bookCount)} · ${state.opts.handle}`);
  return lines.join('\n');
}
async function copyScript() {
  const text = buildScript();
  try {
    await navigator.clipboard.writeText(text);
    status('원고가 복사되었어요');
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); status('원고가 복사되었어요'); }
    catch { status('복사 실패'); }
    ta.remove();
  }
}

boot();
