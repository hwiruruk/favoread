/* ========================================================
   Favoread 카드뉴스 빌더
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
    bookCoverCredit: '도서 표지 ⓒ 알라딘 (aladin.co.kr)',
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
    bookCoverCredit: 'Book covers ⓒ Aladin (aladin.co.kr)',
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
    mono: false,
    covers: true,           // 표지에 책 표지 노출
    bookGrid: true,         // 책 표지 2열 그리드(아니면 한 줄)
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
  $$('input[name=bookGrid]').forEach((r) => r.addEventListener('change', () => {
    state.opts.bookGrid = $$('input[name=bookGrid]').find((x) => x.checked).value === 'grid'; renderPreview();
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
  setRadio('bookGrid', state.opts.bookGrid ? 'grid' : 'row');
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
    app: 'favoread-cardnews', version: 1, savedAt: new Date().toISOString(),
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
  if (!proj || proj.app !== 'favoread-cardnews') { status('이 도구의 프로젝트 파일이 아니에요'); return; }
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

function bookCovers(sel, sq) {
  if (!state.opts.covers || !sel.length) return '';
  const at = adjAttr('cover', 'covers') , st = adjStyle('cover', 'covers');
  if (state.opts.bookGrid) {
    const n = Math.min(sel.length, 10);            // 최대 2열 × 5행
    const rows = Math.ceil(n / 2), gap = 16, budget = sq ? 460 : 640;
    const h = Math.max(96, Math.min(sq ? 230 : 300, Math.floor((budget - (rows - 1) * gap) / rows)));
    const w = Math.round(h * 0.66);
    return `<div class="cn-covers grid"${at} style="gap:${gap}px;${st}">${sel.slice(0, n).map((b) => coverCell(b, w, h)).join('')}</div>`;
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
  imgItems.push(T().bookCoverCredit);
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

function buildSlides() {
  const slides = [], sel = selectedBooks();
  slides.push({ name: 'cover', html: coverHTML(), scope: 'cover' });
  sel.forEach((b, i) => slides.push({
    name: `book${i + 1}`, html: bookHTML(b, i + 1, sel.length),
    scope: `book:${state.books.indexOf(b)}`,
  }));
  if (state.opts.outro && sel.length) slides.push({ name: 'sources', html: outroHTML() });
  if (state.opts.promo) slides.push({ name: 'promo', html: promoHTML() });
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
function renderPreview() {
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
    const el = e.target.closest('[data-adj]');
    if (!el || e.button !== 0) return;
    const { adj: key, scope, kind } = el.dataset;
    if (kind === 'pan') {
      const ph = photoProps(scope);
      if (!ph) return;
      const m = /(\d+(?:\.\d+)?)px\s+(\d+(?:\.\d+)?)px/.exec(el.style.backgroundSize || '');
      drag = {
        el, kind, ph, sx: e.clientX, sy: e.clientY, ox: ph.x, oy: ph.y, scale: scaleOf(el),
        imgW: m ? +m[1] : 0, imgH: m ? +m[2] : 0,
      };
    } else {
      const a = getAdj(scope, key);
      if (!a) return;
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
    const el = e.target.closest('[data-adj]');
    if (!el) return;
    e.preventDefault();
    const { adj: key, scope, kind } = el.dataset;
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
  lines.push(`  - ${T().bookCoverCredit}`);
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
