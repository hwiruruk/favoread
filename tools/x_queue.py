#!/usr/bin/env python3
"""X(트위터)에 올릴 오늘의 트윗 3개를 만든다.

API를 쓰지 않는 반자동 봇이다. 이 스크립트는 글과 이미지 재료만 준비해
data/x_queue.json 에 넣고, 실제 게시는 /xbot/ 페이지에서 사람이 버튼으로 한다.
그래서 X API 비용이 0원이다.

하루 3칸:
  1. 새로 추가된 책이 있으면 '새로 추가', 없으면 '셀럽 책장'
  2. '이 책을 읽은 셀럽들' (3명 이상이 읽은 책)
  3. '셀럽 책장'

셀럽 책장은 시리즈다. 한 번에 최대 6권씩, 이미 나간 책은 빼고 #1, #2 … 로
이어 간다. 한 편은 타래로 만든다: 첫 글에 들어가는 만큼 책을 쓰고 나머지는 답글로. 인물은 한 바퀴를 다 돌 때까지 다시 나오지 않는다(가장 오래전에
나간 인물부터). 무엇을 언제 냈는지는 data/x_state.json 에 남는다.

책 줄에 붙는 출처(날짜 + 매체)는 URL에서 뽑고, URL에 날짜가 없으면 원문을
한 번 읽어 발행일을 찾는다. 결과는 data/x_sources.json 에 모아 두고 다시 읽지 않는다.
제목 앞 이모지는 제목 낱말로 고르고, data/x_emoji.json 에 적으면 그게 우선이다.

사용법:
  python3 tools/x_queue.py            # 오늘 치가 없을 때만 만든다
  python3 tools/x_queue.py --force    # 오늘 치를 다시 만든다
  python3 tools/x_queue.py --dry-run  # 파일은 안 바꾸고 결과만 출력
  python3 tools/x_queue.py --offline  # 원문을 읽지 않는다 (URL로 알 수 있는 것만)
"""
import argparse
import datetime
import hashlib
import json
import os
import random
import re
import sys
import urllib.request
from urllib.parse import quote, unquote, urlparse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_JSON = os.path.join(ROOT, 'data.json')
FEATURED_JSON = os.path.join(ROOT, 'data', 'featured.json')
SHORTLINKS_JSON = os.path.join(ROOT, 'data', 'shortlinks.json')
QUEUE_JSON = os.path.join(ROOT, 'data', 'x_queue.json')
STATE_JSON = os.path.join(ROOT, 'data', 'x_state.json')
SOURCES_JSON = os.path.join(ROOT, 'data', 'x_sources.json')
EMOJI_JSON = os.path.join(ROOT, 'data', 'x_emoji.json')
BOOKS_JSON = os.path.join(ROOT, 'data', 'x_books.json')

BASE = 'https://favorbook.co.kr/'
KST = datetime.timezone(datetime.timedelta(hours=9))

KEEP_DAYS = 7            # 큐에 남겨 둘 날짜 수 (놓친 날을 나중에 올릴 수 있게)
MIN_CELEB_BOOKS = 2      # 책장 시리즈를 시작할 최소 권수
MIN_BOOK_CELEBS = 3      # '이 책을 읽은 셀럽들'에 쓸 최소 인원
SERIES_SIZE = 6          # 책장 한 편에 담는 최대 권수 (이미지 4장 = 표지 1 + 책 2권씩 3장)
TWEET_LIMIT = 280
URL_WEIGHT = 23          # X는 링크를 길이와 상관없이 23으로 센다
HASHTAG = '#최애의독서'
SRC_MARK = '*'           # 책 줄에서 출처 앞에 붙는 기호. 빼려면 ''
PREFETCH = 120           # 한 번 돌 때 미리 읽어 둘 출처 원문 수(직접 고르기용 날짜 채우기)


# ── 파일 ───────────────────────────────────────────────────────────

def load_json(path, default):
    if not os.path.exists(path):
        return default
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def save_json(path, obj):
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(obj, f, ensure_ascii=False, indent=1)
        f.write('\n')


# ── 트윗 길이 ───────────────────────────────────────────────────────
#
# X는 라틴 문자 등은 1, 한글·이모지 등은 2로 센다(합계 280).
# twitter-text 의 가중치 범위를 그대로 옮겼다. 이모지 조합은 실제보다
# 조금 길게 세지만 넘치는 쪽이 아니라 괜찮다.

_LIGHT_RANGES = ((0, 4351), (8192, 8205), (8208, 8223), (8242, 8247))
_URL_RE = re.compile(r'https?://\S+')


def tweet_length(text):
    n = URL_WEIGHT * len(_URL_RE.findall(text))
    for ch in _URL_RE.sub('', text):
        cp = ord(ch)
        if cp == 0xFE0F:             # 이모지 변형 선택자는 따로 세지 않는다
            continue
        n += 1 if any(a <= cp <= b for a, b in _LIGHT_RANGES) else 2
    return n


# ── 출처 한 줄 (날짜 + 매체) ─────────────────────────────────────────
#
# 규칙: X 계정이면 @계정명, 언론·매체면 매체명. 날짜는 260101 처럼 붙인다.
#   예) 260101 조선일보 / 250312 @you_ricemeup

SOURCE_NAMES = [
    # 매거진
    ('vogue.co.kr', '보그'), ('elle.co.kr', '엘르'), ('allurekorea.com', '얼루어'),
    ('wkorea.com', 'W코리아'), ('marieclairekorea.com', '마리끌레르'),
    ('harpersbazaar.co.kr', '바자'), ('gqkorea.co.kr', 'GQ'), ('esquirekorea.co.kr', '에스콰이어'),
    ('cosmopolitan.co.kr', '코스모폴리탄'), ('dazedkorea.com', '데이즈드'),
    ('singleskorea.com', '싱글즈'), ('singles.co.kr', '싱글즈'), ('cine21.com', '씨네21'),
    ('mennoblesse.com', '맨노블레스'), ('design.co.kr', '월간디자인'), ('the-edit.co.kr', '디에디트'),
    ('magazine.weverse.io', '위버스매거진'), ('phaze.co.kr', '페이즈'),
    # 신문·방송·통신
    ('sedaily.com', '서울경제'), ('hankyung.com', '한국경제'), ('mk.co.kr', '매일경제'),
    ('chosun.com', '조선일보'), ('sports.donga.com', '스포츠동아'), ('donga.com', '동아일보'),
    ('joongang.co.kr', '중앙일보'), ('joins.com', '중앙일보'), ('hani.co.kr', '한겨레'),
    ('khan.co.kr', '경향신문'), ('hankookilbo.com', '한국일보'), ('seoul.co.kr', '서울신문'),
    ('kmib.co.kr', '국민일보'), ('dailian.co.kr', '데일리안'), ('newsen.com', '뉴스엔'),
    ('osen.co.kr', 'OSEN'), ('xportsnews.com', '엑스포츠뉴스'), ('tenasia.co.kr', '텐아시아'),
    ('sportschosun.com', '스포츠조선'), ('mydaily.co.kr', '마이데일리'), ('asiae.co.kr', '아시아경제'),
    ('starnewskorea.com', '스타뉴스'), ('yna.co.kr', '연합뉴스'), ('segye.com', '세계일보'),
    ('newsis.com', '뉴시스'), ('readersnews.com', '독서신문'), ('ggilbo.com', '금강일보'),
    ('ohmynews.com', '오마이뉴스'), ('kyeongin.com', '경인일보'), ('dt.co.kr', '디지털타임스'),
    ('fntimes.com', '한국금융신문'), ('acrofan.com', '아크로팬'), ('rollingstone.co.kr', '롤링스톤'),
    ('frontamagazine.com', '프론트매거진'), ('minumsa.com', '민음사'), ('welaaa.com', '윌라'),
    ('imbc.com', 'MBC'), ('kbs.co.kr', 'KBS'), ('sbs.co.kr', 'SBS'), ('jtbc', 'JTBC'),
    ('entertain.naver.com', '네이버연예'), ('news.naver.com', '네이버뉴스'),
    ('news.nate.com', '네이트뉴스'), ('v.daum.net', '다음뉴스'),
    # 서점·플랫폼
    ('ch.yes24.com', '채널예스'), ('yes24.com', '예스24'), ('millie.co.kr', '밀리의서재'),
    ('kyobobook', '교보문고'), ('aladin.co.kr', '알라딘'), ('ridibooks.com', '리디'),
    ('series.naver.com', '네이버시리즈'),
    # SNS·커뮤니티·블로그
    ('youtube.com', '유튜브'), ('youtu.be', '유튜브'), ('instagram.com', '인스타그램'),
    ('threads.com', '스레드'), ('threads.net', '스레드'), ('tiktok.com', '틱톡'),
    ('facebook.com', '페이스북'), ('weverse.io', '위버스'),
    ('theqoo.net', '더쿠'), ('dcinside.com', '디시인사이드'), ('fmkorea.com', '에펨코리아'),
    ('blog.naver.com', '네이버블로그'), ('cafe.naver.com', '네이버카페'), ('cafe.daum.net', '다음카페'),
    ('brunch.co.kr', '브런치'), ('tistory.com', '티스토리'), ('hatenadiary', '하테나블로그'),
    ('naver.me', '네이버'),
]
# 출처로 쓰지 않는 주소(이미지 파일 등)
SOURCE_SKIP = ('wikimedia.org', 'gstatic.com', 'wikipedia.org')
# URL 안의 숫자가 날짜처럼 보여도 날짜가 아닌 곳
NO_URL_DATE = ('youtube.com', 'youtu.be', 'instagram.com', 'x.com', 'twitter.com', 'blog.naver.com', 'tiktok.com')
X_HOSTS = ('x.com', 'twitter.com', 'mobile.twitter.com')
X_NOT_HANDLE = {'i', 'intent', 'search', 'hashtag', 'home', 'share'}

_URL_DATE_RE = re.compile(r'(?<!\d)(20[0-3]\d)[/._-]?(0[1-9]|1[0-2])[/._-]?(0[1-9]|[12]\d|3[01])')
_META_DATE_RES = [
    re.compile(r'(?:article:published_time|og:regDate|datePublished|uploadDate|pubdate|publish[_-]?date|dateCreated)'
               r'["\']?\s*(?:content|:)?\s*=?\s*["\']\s*(20\d{2})[-./]?(\d{2})[-./]?(\d{2})', re.I),
    re.compile(r'content=["\'](20\d{2})[-./](\d{2})[-./](\d{2})[^"\']*["\'][^>]*(?:published|datePublished)', re.I),
]


def _host(url):
    return re.sub(r'^(www\.|m\.)', '', urlparse(url).netloc.lower()) if url.startswith('http') else ''


def _yymmdd(y, m, d):
    try:
        day = datetime.date(int(y), int(m), int(d))
    except ValueError:
        return ''
    if day > datetime.date.today() + datetime.timedelta(days=1) or day.year < 2000:
        return ''
    return day.strftime('%y%m%d')


def x_status_date(url):
    """X 게시물 번호에는 작성 시각이 들어 있다(스노플레이크)."""
    m = re.search(r'/status(?:es)?/(\d{15,20})', url)
    if not m:
        return ''
    ms = (int(m.group(1)) >> 22) + 1288834974657
    day = datetime.datetime.fromtimestamp(ms / 1000, KST).date()
    return day.strftime('%y%m%d')


def source_label(url):
    """URL → (매체 이름 또는 @계정, URL만으로 안 날짜 '' 가능)."""
    url = (url or '').replace('&amp;', '&').strip()
    if not url.startswith('http'):
        # 'X에서 SUNGCHAN LANDS 님 : …' 처럼 글로 적힌 출처
        m = re.match(r'X에서\s+(.+?)\s*님', url)
        return (m.group(1).strip(), '') if m else ('', '')
    host = _host(url)
    if any(s in host for s in SOURCE_SKIP):
        return '', ''
    if host in X_HOSTS:
        parts = [p for p in urlparse(url).path.split('/') if p]
        handle = parts[0] if parts and parts[0].lower() not in X_NOT_HANDLE else ''
        return ('@' + handle if handle else 'X'), x_status_date(url)
    name = next((n for k, n in SOURCE_NAMES if k in host), '')
    date = ''
    if not any(k in host for k in NO_URL_DATE):
        m = _URL_DATE_RE.search(unquote(urlparse(url).path + '?' + urlparse(url).query))
        if m:
            date = _yymmdd(*m.groups())
    return name, date


def fetch_published(url, timeout=8):
    """원문 HTML에서 발행일을 찾는다. 못 찾으면 ''."""
    req = urllib.request.Request(url, headers={
        'User-Agent': 'Mozilla/5.0 (compatible; favorbook-xbot/1.0; +https://favorbook.co.kr/)',
        'Accept-Language': 'ko,en;q=0.8',
    })
    with urllib.request.urlopen(req, timeout=timeout) as res:
        html = res.read(600_000).decode('utf-8', 'replace')
    for rx in _META_DATE_RES:
        m = rx.search(html)
        if m:
            d = _yymmdd(*m.groups())
            if d:
                return d
    return ''


def source_info(url, cache, offline=False):
    """책 한 권의 출처 '260101 조선일보'. 원문을 읽은 결과는 cache 에 남긴다."""
    url = (url or '').replace('&amp;', '&').strip()
    if not url:
        return ''
    name, date = source_label(url)
    if not name:
        return ''
    if not date and url.startswith('http'):
        hit = cache.get(url)
        if hit is not None:
            date = hit
        elif not offline:
            try:
                date = fetch_published(url)
                cache[url] = date            # 날짜가 없던 곳도 기억해서 다시 안 읽는다
            except Exception as e:           # 막힌 곳·404 는 이번엔 날짜 없이, 다음에 다시
                print('  출처 읽기 실패: ' + url[:80] + ' (' + type(e).__name__ + ')')
                date = ''
    return (date + ' ' + name) if date else name


# ── 책 제목 이모지 ──────────────────────────────────────────────────
#
# 제목 낱말로 고른다. 앞에 있는 것이 먼저다. 맞는 게 없으면 책 색깔 이모지.
# 틀리게 붙는 게 있으면 data/x_emoji.json 에 {"책 제목": "🥚"} 로 적어 두면 된다.

EMOJI_RULES = [
    (('살인', '죽음', '범죄', '탐정', '추리', '미스터리', '용의자'), '🔍'),
    (('고양이', '냥'), '🐈'), (('강아지', '개와'), '🐕'), (('고래',), '🐋'), (('물고기',), '🐟'),
    (('나비',), '🦋'), (('여우',), '🦊'), (('토끼',), '🐇'), (('곰',), '🐻'), (('고슴도치',), '🦔'),
    (('아몬드',), '🌰'), (('커피',), '☕'), (('요리', '식탁', '레시피', '밥'), '🍳'),
    (('바다', '파도', '해변'), '🌊'), (('섬',), '🏝️'), (('숲', '나무'), '🌲'), (('꽃', '정원'), '🌷'),
    (('여름',), '🌻'), (('겨울', '눈사람'), '❄️'), (('봄',), '🌸'), (('가을', '낙엽'), '🍂'),
    (('밤', '달'), '🌙'), (('별', '우주', '은하', '행성'), '🌌'), (('빛', '햇살', '태양'), '☀️'),
    (('빗', '비가', '장마'), '☔'), (('꿈',), '💭'),
    (('사랑', '연애', '이별'), '💌'), (('편지',), '✉️'), (('행복',), '🍀'),
    (('불안', '우울', '슬픔'), '🌧️'), (('마음', '심리', '감정'), '🫧'),
    (('철학', '생각', '사유', '질문'), '🤔'), (('말의', '말하기', '대화', '언어'), '💬'),
    (('글쓰기', '쓰기', '문장', '작가'), '✍️'), (('책', '서점', '도서관', '독서'), '📚'),
    (('음악', '노래', '피아노'), '🎵'), (('그림', '미술', '화가'), '🎨'), (('영화',), '🎬'),
    (('과학', '물리', '뇌'), '🔬'), (('역사',), '📜'), (('왕', '왕국', '왕녀', '왕자'), '👑'),
    (('전쟁',), '⚔️'), (('신화',), '⚡'), (('마법', '마녀'), '🪄'),
    (('여행', '길 위', '떠나'), '✈️'), (('기차', '열차'), '🚂'), (('집',), '🏠'),
    (('돈', '부자', '경제', '투자'), '💰'), (('시간', '시계'), '⏰'), (('기억', '추억'), '📷'),
    (('인생', '삶', '살아'), '🌱'), (('청춘', '소년', '소녀'), '🌿'), (('자존감', '나를', '나로'), '🪞'),
]
FALLBACK_EMOJI = ('📕', '📗', '📘', '📙', '📔')


def book_emoji(title, overrides):
    t = title.strip()
    if overrides.get(t):
        return overrides[t]
    for words, emo in EMOJI_RULES:
        if any(w in t for w in words):
            return emo
    h = int(hashlib.md5(t.encode('utf-8')).hexdigest(), 16)
    return FALLBACK_EMOJI[h % len(FALLBACK_EMOJI)]


# ── 이름·링크 ───────────────────────────────────────────────────────

def celeb_url(name, celeb):
    return celeb.get('shortUrl') or (BASE + 'share/' + quote(name.replace('/', '_').replace('\\', '_'), safe='') + '.html')


def book_url(title, shortlinks):
    slug = shortlinks.get('book', {}).get(title)
    if slug:
        return BASE + 's/b/' + slug + '.html'
    safe = title
    for ch in '/\\:"?':
        safe = safe.replace(ch, '_')
    return BASE + 'share/book/' + quote(safe, safe='') + '.html'


def hashtags_for(name):
    """'카리나(에스파)' → ['#카리나', '#에스파']. 공백·기호는 뺀다."""
    m = re.match(r'^(.*?)\((.*?)\)$', name)
    parts = [m.group(1), m.group(2)] if m else [name]
    tags = []
    for p in parts:
        t = re.sub(r'[^0-9A-Za-z가-힣_]', '', p)
        if t and not t.isdigit():
            tags.append('#' + t)
    return tags


# 받침 있는 글자로 끝나면 '이', 아니면 '가'. 괄호 속 그룹명은 빼고 이름 끝 글자로 본다.
# 영문·숫자는 읽는 소리로 (RM → 알엠 → '이', V → 브이 → '가')
_BATCHIM_LATIN = set('LMNRlmnr')
_BATCHIM_DIGIT = set('013678')


def josa_iga(name):
    base = re.sub(r'\(.*?\)\s*$', '', name).strip() or name
    ch = base[-1]
    if '가' <= ch <= '힣':
        has = (ord(ch) - 0xAC00) % 28 != 0
    elif ch.isdigit():
        has = ch in _BATCHIM_DIGIT
    else:
        has = ch in _BATCHIM_LATIN
    return '이' if has else '가'


def display_name(name):
    """글·이미지에 쓰는 이름: '주훈(코르티스)' → '코르티스 주훈'.

    괄호 안이 숫자뿐이면(동명이인 구분용 '유라(1993)') 그대로 둔다.
    """
    m = re.match(r'^(.*?)\s*\((.+?)\)$', name)
    if not m or m.group(2).strip().isdigit():
        return name
    return m.group(2).strip() + ' ' + m.group(1).strip()


def byline(b):
    """'양귀자 | 쓰다' — 저자나 출판사가 비면 있는 것만."""
    return ' | '.join(x for x in ((b.get('author') or '').strip(), (b.get('publisher') or '').strip()) if x)


def book_line(b, src):
    by = byline(b)
    line = b['emoji'] + ' ' + b['title'].strip() + ('(' + by + ')' if by else '')
    if src:
        line += ' ' + SRC_MARK + src
    return line


def fit_lines(head, lines, tail):
    """넣을 수 있는 만큼 앞에서부터 책 줄을 넣는다. (글, 넣은 줄 수)"""
    for keep in range(len(lines), 0, -1):
        text = head + '\n'.join(lines[:keep]) + tail
        if tweet_length(text) <= TWEET_LIMIT:
            return text, keep
    # 한 줄도 안 들어가면 출처를 떼고 다시
    first = lines[0].split(' ' + SRC_MARK)[0] if SRC_MARK else lines[0]
    return head + first + tail, 1


def thread_replies(lines):
    """첫 글에 못 넣은 책 줄을 답글들로 나눈다(글마다 280 안)."""
    replies, cur = [], []
    for line in lines:
        if cur and tweet_length('\n'.join(cur + [line])) > TWEET_LIMIT:
            replies.append('\n'.join(cur))
            cur = []
        cur.append(line)
    if cur:
        replies.append('\n'.join(cur))
    return replies


# ── 트윗 만들기 ─────────────────────────────────────────────────────

def dedupe_books(books):
    seen, out = set(), []
    for b in books:                       # 같은 책이 두 번 들어간 경우가 있다
        t = b['title'].strip()
        if t not in seen:
            seen.add(t)
            out.append(b)
    return out


def order_books(books, book_idx, rng):
    """가나다순 대신 여러 셀럽이 함께 읽은 책을 앞에, 나머지는 섞어서."""
    books = dedupe_books(books)
    rng.shuffle(books)
    return sorted(books, key=lambda b: -len(book_idx.get(b['title'].strip(), {}).get('celebs', [])))


def image_book(b, src):
    return {
        'title': b['title'].strip(),
        'by': byline(b),
        'src': src,
        'emoji': b['emoji'],
        'cover': b.get('coverUrl') or '',
        'source': (b.get('source') or '').replace('&amp;', '&').strip(),
    }


def make_shelf_item(kind, name, celeb, books, series, ctx):
    """셀럽 책장(kind='celeb') 또는 새로 추가(kind='new')."""
    total = len(dedupe_books(celeb['books']))
    srcs = [source_info(b.get('source'), ctx['sources'], ctx['offline']) for b in books]
    if kind == 'new':
        head = '🆕 ' + display_name(name) + josa_iga(name) + ' 읽은 책\n\n'
    else:
        head = '📚 ' + display_name(name) + '의 책장\n\n'
    url = celeb_url(name, celeb)
    tags = ' '.join([HASHTAG] + hashtags_for(name)[:2])
    tail = '\n\n전체 목록(' + str(total) + '권)\n' + url + '\n\n' + tags
    # 타래: 첫 글은 위 모양 그대로, 못 넣은 책은 답글로 이어 쓴다
    lines = [book_line(b, s) for b, s in zip(books, srcs)]
    text, used = fit_lines(head, lines, tail)
    thread = [text] + thread_replies(lines[used:])
    return {
        'type': kind,
        'key': name,
        'label': '새로 추가' if kind == 'new' else '셀럽 책장',
        'series': series,
        'titles': [b['title'].strip() for b in books],
        'text': text,
        'thread': thread,
        'url': url,
        'image': {
            'name': display_name(name),
            'series': series,
            'total': total,
            'portrait': celeb.get('imageUrl') or '',
            'books': [image_book(b, s) for b, s in zip(books, srcs)],
        },
    }


def make_book_item(title, entry, shortlinks, ctx):
    names = entry['celebs']
    book = entry['book']
    by = byline(book)
    head = book['emoji'] + ' ' + title + ('(' + by + ')' if by else '') + '\n' + title + ' 읽은 사람 모여라~\n\n'
    url = book_url(title, shortlinks)
    tail = '\n\n전체 목록:\n' + url + '\n\n' + HASHTAG
    text = None
    for keep in range(len(names), 0, -1):
        shown = ', '.join(display_name(n) for n in names[:keep])
        rest = len(names) - keep
        if rest:
            shown += ' 외 ' + str(rest) + '명'
        cand = head + shown + tail
        if tweet_length(cand) <= TWEET_LIMIT:
            text = cand
            break
    if text is None:
        text = head.rstrip() + tail
    return {
        'type': 'book',
        'key': title,
        'label': '이 책을 읽은 셀럽들',
        'text': text,
        'url': url,
        'image': {
            'book': image_book(book, ''),
            'names': [display_name(n) for n in names],
            'portraits': [ctx['celebs'][n].get('imageUrl') or '' for n in names],
        },
    }


# ── 고르기 ─────────────────────────────────────────────────────────

def pick_least_recent(candidates, last_used, rng, priority=()):
    """한 번도 안 나간 것 → 가장 오래전에 나간 것 순. 동률이면 priority 먼저, 그다음 무작위."""
    if not candidates:
        return None
    prio = {k: i for i, k in enumerate(priority)}
    shuffled = list(candidates)
    rng.shuffle(shuffled)
    return min(shuffled, key=lambda k: (last_used.get(k, ''), prio.get(k, len(prio))))


def build_book_index(celebs):
    idx = {}
    for name, c in celebs.items():
        for b in c['books']:
            t = b['title'].strip()
            e = idx.setdefault(t, {'book': b, 'celebs': []})
            if name not in e['celebs']:
                e['celebs'].append(name)
            if not e['book'].get('coverUrl') and b.get('coverUrl'):
                e['book'] = b
    return idx


def detect_new(celebs, state):
    """지난 실행 이후 새로 생긴 (셀럽, 책) 짝을 pending_new 에 쌓는다.

    첫 실행이면 지금 있는 것 전부를 '이미 알던 것'으로 기록만 한다
    (1,900권을 전부 새 책이라고 알리지 않도록).
    """
    first_run = 'known' not in state
    known = state.setdefault('known', {})
    pending = state.setdefault('pending_new', {})
    for name, c in celebs.items():
        titles = [b['title'].strip() for b in c['books']]
        seen = set(known.get(name, []))
        fresh = [t for t in titles if t not in seen]
        if fresh and not first_run:
            lst = pending.setdefault(name, [])
            lst.extend(t for t in fresh if t not in lst)
        known[name] = sorted(set(titles) | seen)
    # 사이에 지워진 인물·책은 대기열에서도 뺀다
    for name in list(pending):
        cur = {b['title'].strip() for b in celebs.get(name, {}).get('books', [])}
        pending[name] = [t for t in pending[name] if t in cur]
        if not pending[name]:
            del pending[name]


def build_day(date_str, ctx, state, rng):
    celebs = ctx['celebs']
    celeb_last = state.setdefault('celeb_last', {})
    book_last = state.setdefault('book_last', {})
    pending = state.setdefault('pending_new', {})
    posted = state.setdefault('posted', {})          # 인물별로 이미 내보낸 책
    series_no = state.setdefault('series', {})       # 인물별 마지막 시리즈 번호
    book_idx = build_book_index(celebs)

    def unposted(name):
        done = set(posted.get(name, []))
        return [b for b in order_books(celebs[name]['books'], book_idx, rng) if b['title'].strip() not in done]

    def with_emoji(books):
        for b in books:
            b['emoji'] = book_emoji(b['title'], ctx['emoji'])
        return books

    def take(name, books):
        posted.setdefault(name, []).extend(b['title'].strip() for b in books)
        series_no[name] = series_no.get(name, 0) + 1
        celeb_last[name] = date_str
        used.add(name)
        return series_no[name]

    celeb_pool = [n for n, c in celebs.items() if len(dedupe_books(c['books'])) >= MIN_CELEB_BOOKS]
    book_pool = [t for t, e in book_idx.items() if len(e['celebs']) >= MIN_BOOK_CELEBS]
    used = set()

    def next_shelf():
        pool = [n for n in celeb_pool if n not in used and unposted(n)]
        name = pick_least_recent(pool, celeb_last, rng, ctx['featured'])
        if name is None:
            return None
        books = with_emoji([dict(b) for b in unposted(name)[:SERIES_SIZE]])
        n = take(name, books)
        return make_shelf_item('celeb', name, celebs[name], books, n, ctx)

    items = []

    # 1칸: 새로 추가 (가장 많이 들어온 인물부터) / 없으면 책장
    if pending:
        name = max(pending, key=lambda n: (len(pending[n]), n))
        fresh = set(pending.pop(name))
        books = [b for b in order_books(celebs[name]['books'], book_idx, rng) if b['title'].strip() in fresh]
        books = with_emoji([dict(b) for b in books[:SERIES_SIZE]])
        if len(fresh) > SERIES_SIZE:          # 남은 새 책은 다음 날로
            pending[name] = sorted(fresh - {b['title'].strip() for b in books})
        n = take(name, books)
        items.append(make_shelf_item('new', name, celebs[name], books, n, ctx))
    else:
        items.append(next_shelf())

    # 2칸: 이 책을 읽은 셀럽들 (처음 한 바퀴는 많이 읽힌 책부터)
    by_count = sorted(book_pool, key=lambda t: -len(book_idx[t]['celebs']))
    title = pick_least_recent(book_pool, book_last, rng, by_count)
    if title:
        book_last[title] = date_str
        entry = dict(book_idx[title])
        entry['book'] = with_emoji([dict(entry['book'])])[0]
        items.append(make_book_item(title, entry, ctx['shortlinks'], ctx))
    else:
        items.append(next_shelf())

    # 3칸: 책장
    items.append(next_shelf())

    items = [it for it in items if it]
    for i, it in enumerate(items, 1):
        it['id'] = date_str + '-' + str(i)
        it['length'] = tweet_length(it['text'])
    return {'date': date_str, 'items': items}


def export_books(ctx, date_str):
    """게시 도우미의 '직접 고르기'용 재료: 인물별 책 줄(이모지·저자|출판사·출처)을 미리 만들어 둔다.

    페이지가 출처 규칙·이모지 규칙을 따로 갖지 않도록, 여기서 만든 그대로 쓴다.
    아직 날짜를 못 찾은 출처는 PREFETCH 개까지 원문을 읽어 채운다(나머지는 다음 날).
    """
    celebs = ctx['celebs']
    book_idx = build_book_index(celebs)
    budget = [0 if ctx['offline'] else PREFETCH]

    def src_of(url):
        offline = budget[0] <= 0
        before = len(ctx['sources'])
        out = source_info(url, ctx['sources'], offline)
        if len(ctx['sources']) > before:
            budget[0] -= 1
        return out

    out = {}
    for name, c in celebs.items():
        books = dedupe_books(c['books'])
        books.sort(key=lambda b: -len(book_idx.get(b['title'].strip(), {}).get('celebs', [])))
        out[name] = {
            'url': celeb_url(name, c),
            'portrait': c.get('imageUrl') or '',
            'display': display_name(name),
            'josa': josa_iga(name),
            'tags': ' '.join([HASHTAG] + hashtags_for(name)[:2]),
            'books': [dict(image_book(dict(b, emoji=book_emoji(b['title'], ctx['emoji'])),
                                      src_of(b.get('source'))),
                           n=len(book_idx.get(b['title'].strip(), {}).get('celebs', [])))
                      for b in books],
        }
    # 페이지가 통째로 내려받는 파일이라 들여쓰기 없이 작게 쓴다
    with open(BOOKS_JSON, 'w', encoding='utf-8') as f:
        json.dump({'updated': date_str, 'mark': SRC_MARK, 'celebs': out}, f, ensure_ascii=False, separators=(',', ':'))
        f.write('\n')


def release_day(day, date_str, state):
    """--force 로 다시 만들 때, 그날 뽑혔던 것을 '안 나간 것'으로 되돌린다."""
    for it in day['items']:
        if it['type'] == 'book':
            if state.get('book_last', {}).get(it['key']) == date_str:
                del state['book_last'][it['key']]
            continue
        name = it['key']
        if state.get('celeb_last', {}).get(name) == date_str:
            del state['celeb_last'][name]
        titles = it.get('titles', [])
        if name in state.get('posted', {}):
            state['posted'][name] = [t for t in state['posted'][name] if t not in titles]
        if it.get('series') and state.get('series', {}).get(name) == it['series']:
            state['series'][name] = it['series'] - 1
        if it['type'] == 'new':
            lst = state.setdefault('pending_new', {}).setdefault(name, [])
            lst.extend(t for t in titles if t not in lst)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--date', help='만들 날짜 (YYYY-MM-DD, 기본: 오늘 KST)')
    ap.add_argument('--force', action='store_true', help='그날 치가 이미 있어도 다시 만든다')
    ap.add_argument('--dry-run', action='store_true', help='파일은 안 바꾸고 출력만')
    ap.add_argument('--offline', action='store_true', help='출처 원문을 읽지 않는다')
    args = ap.parse_args()

    date_str = args.date or datetime.datetime.now(KST).date().isoformat()
    celebs = load_json(DATA_JSON, {})['celebs']
    ctx = {
        'celebs': celebs,
        'featured': [p['name'] for p in load_json(FEATURED_JSON, {}).get('picks', []) if p.get('name') in celebs],
        'shortlinks': load_json(SHORTLINKS_JSON, {}),
        'sources': load_json(SOURCES_JSON, {}),
        'emoji': {k: v for k, v in load_json(EMOJI_JSON, {}).items() if not k.startswith('_')},
        'offline': args.offline,
    }
    state = load_json(STATE_JSON, {})
    queue = load_json(QUEUE_JSON, {'days': []})

    old = next((d for d in queue['days'] if d['date'] == date_str), None)
    if old and not args.force:
        print(date_str + ' 치는 이미 있습니다. 다시 만들려면 --force')
        return 0
    if old:
        release_day(old, date_str, state)
    detect_new(celebs, state)
    rng = random.Random(date_str)
    day = build_day(date_str, ctx, state, rng)

    for it in day['items']:
        print('─' * 40)
        posts = it.get('thread') or [it['text']]
        for k, t in enumerate(posts, 1):
            tag = ' (타래 ' + str(k) + '/' + str(len(posts)) + ')' if len(posts) > 1 else ''
            print('[' + it['label'] + '] ' + str(tweet_length(t)) + '/280' + tag)
            print(t)
    print('─' * 40)

    if args.dry_run:
        print('(연습 모드 — 파일은 그대로)')
        return 0

    days = [d for d in queue['days'] if d['date'] != date_str] + [day]
    days.sort(key=lambda d: d['date'], reverse=True)
    save_json(QUEUE_JSON, {'updated': date_str, 'days': days[:KEEP_DAYS]})
    save_json(STATE_JSON, state)
    export_books(ctx, date_str)
    save_json(SOURCES_JSON, dict(sorted(ctx['sources'].items())))
    print('저장: data/x_queue.json, data/x_state.json, data/x_sources.json, data/x_books.json')
    return 0


if __name__ == '__main__':
    sys.exit(main())
