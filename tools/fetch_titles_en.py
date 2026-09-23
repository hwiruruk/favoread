#!/usr/bin/env python3
"""책의 공식 영문판 제목 후보를 모아 data/titles_en.json 에 채우는 배치.

예전 방식(enrich_en.py, 편집기의 '직역*' 버튼)은 한국어 제목을 영어로
번역하거나 한국어 제목 그대로 영어 책을 검색했다. 영문판에는 한국어 제목이
없으니 거의 걸리지 않았고, 빈자리는 직역으로 채워졌다.

    소년이 온다  → The Boy Is Coming *   (공식: Human Acts)
    데미안       → Damian *              (공식: Demian)

이 스크립트는 번역하지 않는다. 이미 누군가 적어 둔 '원제'와 '영어 문서 이름'을
찾아 온다.

    알라딘 API          subInfo.originalTitle 번역서의 원제 (키 필요, 첫 실행에서 가장 잘 맞음)
    예스24 상품 페이지  품목정보의 원서명      알라딘 키가 없을 때 대비
    한국어 위키백과     영어 문서 링크         한국 문학·고전 (소년이 온다 → Human Acts)
    한국문학번역원      English Title(Printed) 한국 문학 번역서 (library.ltikorea.or.kr)
    위키데이터          작품의 영어 이름표     위키백과 문서가 없는 한국 문학 (흰 → The White Book)
    Open Library        한국어판이 속한 작품   Goodreads처럼 여러 언어판을 한 작품으로 묶는다
    Open Library        후보 제목·저자의 영어판이 실제로 있는지 확인 (무료)

모은 후보는 사람이 편집기(/editor/)의 '🔤 영문 제목 검수' 창에서 고른다.
여기서 정하지 않는다. 다만 data.csv 에 이미 적힌 값이 후보와 똑같으면
확인된 것으로 보고 자동 승인해 둔다 — 검수할 양을 줄이려고.

결과는 data/titles_en.json 한 파일이다. data.csv 는 건드리지 않는다
(편집기가 CSV를 자기 모델대로 다시 쓰기 때문에 배치 결과가 날아갈 수 있다).
사람이 승인·수정한 항목(status approved / none)은 다시 돌려도 그대로 둔다.

실행
    python3 tools/fetch_titles_en.py --limit 20 --dry-run
    python3 tools/fetch_titles_en.py

옵션
    --limit N      이번에 새로 조회할 책 수 (0=무제한)
    --dry-run      파일에 쓰지 않고 결과만 출력
    --refresh      이미 조회한 미검수 책도 다시 조회
    --only 제목     이 제목(쉼표로 여러 개)만 조회. 이미 조회했어도 다시 한다
    --sleep SEC    요청 사이 대기 (기본 0.5초)

환경변수 (없어도 돈다)
    ALADIN_TTB_KEY        있으면 알라딘에서 원제를 찾는다 (강력 추천)
    GOOGLE_BOOKS_API_KEY  (선택) 있으면 Google Books 로도 확인한다. 없어도 된다
"""
import argparse
import collections
import csv
import datetime
import html
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CSV_PATH = os.path.join(ROOT, 'data.csv')
OUT_PATH = os.path.join(ROOT, 'data', 'titles_en.json')

# 위키백과는 연락처가 들어간 User-Agent가 없으면 403을 준다
UA = 'favorbook-titles/1.0 (+https://favorbook.co.kr)'
BROWSER_UA = ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
              '(KHTML, like Gecko) Chrome/124.0 Safari/537.36')

# 조회 방식이 바뀌면 올린다. 이보다 낮은 버전으로 조회한 미검수 책은 다시 조회한다.
#   2: 예스24 부제 오인 제거, 알라딘 항상 조회, 위키백과 저자 확인, Open Library 추가
#   3: 위키데이터 추가 (한국 문학: 흰 → The White Book)
#   4: 한국문학번역원 디지털 도서관 추가 (English Title(Printed))
#   5: 번역원 검색을 GET 으로 먼저, 한국어 화면·괄호 없는 '영문 제목' 칸도 읽기 (4는 거의 못 잡았다)
LOOKUP_VERSION = 5

NOTE = (
    'Official English edition titles, one entry per book. '
    'Key: "<도서명>|<저자>" — both must match data.csv exactly. '
    'candidates는 tools/fetch_titles_en.py 가 원제·위키백과에서 모은 후보. '
    'status: pending(미검수) | approved(공식 영문판 제목 = value) | '
    'none(공식 영문판 없음 — value가 있으면 직역으로 * 을 붙여 노출, 비면 영문 페이지에서 뺌). '
    'pending이면 data.csv의 도서명_en 값을 그대로 쓴다. '
    "편집기의 '🔤 영문 제목 검수' 창에서 검수한다."
)

# generate.py 의 en_title_problem() 과 같은 규칙. 둘을 같이 고친다.
PROBLEM_RULES = [
    (re.compile(r'\(\s*or\b', re.I), '"(or ...)" 대안 문구'),
    (re.compile(r'\bor similar\b|\bno (?:widely )?confirmed\b|\bofficial english\b'
                r'|\bunofficial\b|\bnot (?:officially )?translated\b', re.I), 'AI 설명 문구'),
    (re.compile(r'[가-힣ㄱ-ㅎㅏ-ㅣ]'), '한글이 섞임'),
    (re.compile(r'^\?'), '? 미검수 표시'),
]


def title_problem(title_ko, value):
    """영문 제목 값에서 사이트에 내보내면 안 되는 흔적을 찾는다. 없으면 None."""
    v = (value or '').strip()
    if not v:
        return None
    for rx, why in PROBLEM_RULES:
        if rx.search(v):
            return why
    # 한국어 제목에 / 가 없는데 영문에만 있으면 "A / B" 식으로 후보를 늘어놓은 것
    if ' / ' in v and '/' not in (title_ko or ''):
        return '"A / B" 후보 나열'
    return None


def is_starred(v):
    return bool(re.search(r'\*\s*$', (v or '').strip()))


def plain(v):
    return re.sub(r'\s*\*\s*$', '', (v or '').strip())


def norm_en(s):
    """영문 제목 비교용 — 대소문자·문장부호·관사·부제를 털어낸다."""
    s = html.unescape(str(s or '')).lower()
    s = s.split(':')[0]
    s = re.sub(r'\([^)]*\)', ' ', s)
    s = re.sub(r'[^0-9a-z]+', ' ', s)
    s = re.sub(r'^(the|a|an) ', '', s.strip())
    return re.sub(r'\s+', ' ', s).strip()


def norm_ko(s):
    s = re.sub(r'\([^)]*\)', ' ', str(s or ''))
    return re.sub(r'[^0-9A-Za-z가-힣]+', '', s).lower()


def looks_english(s):
    """라틴 문자 위주인가. 일본어·중국어 원제는 영문판 제목이 아니다."""
    s = (s or '').strip()
    if not s:
        return False
    letters = [c for c in s if c.isalpha()]
    if not letters:
        return False
    latin = sum(1 for c in letters if ord(c) < 0x250)
    return latin / len(letters) > 0.9


# 라틴 문자지만 영어가 아닌 원제 — 알라딘 원제·위키데이터 이름표에 섞여 온다.
# 세 번째 실행에서 후보 첫 줄 566건 중 53건이 이랬다 ('11분' → Onze Minutos,
# '느림' → La lenteur, '공중그네' → Kūchū Buranko). 영문판 제목이 아니니 후보에서 뺀다.
# 다만 영어판도 원제를 그대로 쓰는 책(Les Misérables)이 있어서, 영어 위키백과 문서
# 이름이 그 제목이면 남기고 순서만 뒤로 보낸다. Open Library 확인은 근거로 치지 않는다 —
# 언어 표시가 엉성해서 La lenteur 도 '영어판'으로 걸렸다.
# 'die'·'el' 처럼 영어 제목에도 흔한 말은 넣지 않는다 (Before I Die).
FOREIGN_RE = re.compile(
    r"[àâäçéèêëîïôöùûüÿñãõáíóúōūāēīåøæœß]"
    r"|\b(?:le|la|les|des|du|l'|d'|et|der|das|und|ein|eine|um|uma|os|il|della|och|jag|het|een)\b",
    re.I)


def looks_foreign(s):
    return bool(FOREIGN_RE.search(s or ''))


def is_english_title(s):
    return looks_english(s) and not looks_foreign(s)


def clean_candidates(cands):
    """영어가 아닌 후보를 빼고(영어판 확인된 것은 뒤로), 이미 저장된 후보에도 쓴다."""
    keep = [c for c in (cands or []) if looks_english(c.get('title'))
            and (not looks_foreign(c.get('title')) or 'wikipedia' in (c.get('sources') or []))]
    return sorted(keep, key=lambda c: looks_foreign(c.get('title')))   # 안정 정렬


# ── 영문 제목 표기 원칙: 단어 첫 글자만 대문자 (Title Case) ────────────────
# 출처마다 표기가 제각각이다 — 번역원은 THE DALLERGUT DREAM DEPARTMENT STORE,
# 위키데이터는 The black deer. 영어 제목 관례대로 맞춘다.
#   · 단어 첫 글자는 대문자, 나머지는 원래대로 (iPhone, McDonald, BTS, 1Q84 는 건드리지 않음)
#   · 전부 대문자로 온 제목만 소문자로 풀어서 다시 맞춘다
#   · 관사·짧은 전치사·접속사(a, the, of, and …)는 첫 단어·끝 단어·콜론 뒤가 아니면 소문자
#   · 로마 숫자(VIII)는 대문자, 영어가 아닌 제목(La lenteur)은 그 언어 관례가 달라 손대지 않음
# generate.py 의 en_title_case(), editor/app.js 의 enTitleCase() 와 같은 규칙. 셋을 같이 고친다.
TITLE_SMALL = {'a', 'an', 'the', 'and', 'but', 'or', 'nor', 'for', 'so', 'yet', 'as', 'at',
               'by', 'in', 'of', 'on', 'to', 'up', 'via', 'with', 'from', 'into', 'onto',
               'over', 'per', 'than', 'vs'}
ROMAN_RE = re.compile(r'^(?=[ivxlcdm]+$)m{0,3}(cm|cd|d?c{0,3})(xc|xl|l?x{0,3})(ix|iv|v?i{0,3})$', re.I)


def en_title_case(value):
    v = (value or '').strip()
    star = ''
    m = re.search(r'\s*\*\s*$', v)
    if m:
        star, v = ' *', v[:m.start()]
    if not v or looks_foreign(v):
        return v + star
    letters = [c for c in v if c.isalpha()]
    shouting = len(letters) > 3 and sum(c.isupper() for c in letters) / len(letters) > 0.8
    tokens = re.split(r'(\s+)', v)
    words = [i for i, t in enumerate(tokens) if t.strip()]
    for n, i in enumerate(words):
        w = tokens[i]
        core = re.sub(r"^\W+|\W+$", '', w)
        if not core:
            continue
        edge = n == 0 or n == len(words) - 1 or re.search(r'[:.?!—–]$', tokens[words[n - 1]])
        low = core.lower()
        if ROMAN_RE.match(core) and (shouting or core.isupper()):
            new = core.upper()
        elif shouting or core.islower():
            base = low if shouting else core
            new = base if (low in TITLE_SMALL and not edge) else base[:1].upper() + base[1:]
        elif low in TITLE_SMALL and not edge and core[:1].isupper() and core[1:].islower():
            new = low
        else:
            new = core
        tokens[i] = w.replace(core, new, 1)
    return ''.join(tokens) + star


def tidy(s):
    """원제 칸에 붙어 오는 연도·판 표시 같은 꼬리를 뗀다."""
    s = html.unescape(re.sub(r'<[^>]+>', ' ', str(s or '')))
    s = re.sub(r'\s+', ' ', s).strip(' ,;·')
    s = re.sub(r'\s*\(\s*\d{4}\s*년?\s*\)\s*$', '', s)       # (1919년)
    s = re.sub(r'\s*\((?:개정판|번역|원서|paperback|hardcover)[^)]*\)\s*$', '', s, flags=re.I)
    return s.strip()


# ── HTTP ─────────────────────────────────────────────────────────────
class Transient(Exception):
    """네트워크가 잠깐 흔들린 것. 이런 실패는 기록하지 않고 다음에 다시 본다."""


def http_get(url, ua=UA, timeout=15, tries=3):
    """429(너무 잦은 요청)는 Retry-After 만큼 쉬었다가 다시 시도한다.

    위키백과는 요청이 조금만 몰려도 429를 준다 — 예전 enrich_en.py 가 0.3초 간격으로
    부르다 스무 번 넘게 막혔다. 쉬었다 다시 하면 대개 풀린다.
    """
    req = urllib.request.Request(url, headers={'User-Agent': ua,
                                               'Accept-Language': 'ko,en;q=0.8'})
    for attempt in range(tries):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read().decode('utf-8', 'replace')
        except urllib.error.HTTPError as e:
            if e.code in (404, 410):
                return ''
            if e.code in (429, 503) and attempt + 1 < tries:
                try:
                    wait = float(e.headers.get('Retry-After') or 0)
                except ValueError:
                    wait = 0
                time.sleep(min(max(wait, 5 * (attempt + 1)), 60))
                continue
            raise Transient('%s %s' % (e.code, url.split('?')[0]))
        except Exception as e:
            raise Transient('%s %s' % (e, url.split('?')[0]))


def http_json(url, **kw):
    body = http_get(url, **kw)
    return json.loads(body) if body else {}


# ── 1. 예스24 상품 페이지의 원제 ──────────────────────────────────────
YES24_GOODS_RE = re.compile(r'yes24\.com/(?:product/)?goods/(?:detail/)?(\d+)', re.I)

# 예스24 품목정보 표의 원서명만 믿는다.
#   <th>원서명/저자명</th><td>The Moon and Sixpence/Maugham, W. Somerset</td>
# 제목 아래 gd_nameE 는 원제가 아니라 부제('양귀자 장편소설', '리커버 에디션')였고,
# 본문의 '원제:' 는 책 소개 문장까지 끌려왔다(2026-09-23 첫 실행). 둘 다 뺐다.
YES24_PATTERNS = [
    (re.compile(r'원서명\s*/\s*저자명\s*</th>\s*<td[^>]*>(.*?)</td>', re.S), True),
    (re.compile(r'원서명\s*</th>\s*<td[^>]*>(.*?)</td>', re.S), False),
]


def parse_yes24_original(page):
    for rx, has_author in YES24_PATTERNS:
        m = rx.search(page)
        if not m:
            continue
        v = tidy(m.group(1))
        if has_author and '/' in v:
            v = tidy(v.rsplit('/', 1)[0])   # "제목/저자" 에서 저자를 뗀다
        if v and v not in ('-', '없음'):
            return v
    return None


def yes24_original(link):
    m = YES24_GOODS_RE.search(link or '')
    if not m:
        return None, None
    url = 'https://www.yes24.com/product/goods/' + m.group(1)
    page = http_get(url, ua=BROWSER_UA)
    return parse_yes24_original(page), url


# ── 2. 알라딘 API 의 originalTitle ────────────────────────────────────
def aladin_original(title, author, ttb_key):
    q = urllib.parse.urlencode({
        'ttbkey': ttb_key, 'Query': (title + ' ' + (author or '')).strip(),
        'QueryType': 'Keyword', 'SearchTarget': 'Book', 'MaxResults': '5',
        'output': 'js', 'Version': '20131101',
    })
    d = http_json('https://www.aladin.co.kr/ttb/api/ItemSearch.aspx?' + q)
    want = norm_ko(title)
    for it in (d or {}).get('item') or []:
        got = norm_ko(re.split(r'\s+-\s+', it.get('title') or '')[0])
        if not (got and want and (got == want or got.startswith(want))):
            continue
        p = urllib.parse.urlencode({
            'ttbkey': ttb_key, 'itemIdType': 'ItemId', 'ItemId': it.get('itemId'),
            'output': 'js', 'Version': '20131101',
        })
        d2 = http_json('https://www.aladin.co.kr/ttb/api/ItemLookUp.aspx?' + p)
        items = (d2 or {}).get('item') or []
        sub = (items[0].get('subInfo') if items else None) or {}
        orig = tidy(sub.get('originalTitle'))
        return (orig or None), it.get('link')
    return None, None


# ── 3. 한국어 위키백과 → 영어 문서 ────────────────────────────────────
def wikipedia_en(title, author):
    """한국어 위키백과에서 책 문서를 찾아 영어 문서 이름을 돌려준다.

    문서 제목이 책 제목과 같을 때만 받는다 ('데미안' 또는 '데미안 (소설)').
    검색 결과 첫 줄을 그냥 믿으면 같은 이름의 영화·노래가 걸린다.
    """
    p = urllib.parse.urlencode({
        'action': 'query', 'format': 'json', 'formatversion': '2',
        'generator': 'search', 'gsrsearch': (title + ' ' + (author or '')).strip(),
        'gsrlimit': '5', 'prop': 'langlinks|extracts', 'lllang': 'en', 'redirects': '1',
        'exintro': '1', 'explaintext': '1', 'exlimit': 'max',
    })
    d = http_json('https://ko.wikipedia.org/w/api.php?' + p)
    want = norm_ko(title)
    # 저자 이름 조각('무라카미 하루키' → 무라카미, 하루키). 한 글자 이름은 오탐이 많아 뺀다
    marks = [w for w in re.split(r'[\s,·/]+', re.sub(r'\([^)]*\)', ' ', author or '')) if len(w) >= 2]
    pages = sorted(((d or {}).get('query') or {}).get('pages') or [],
                   key=lambda x: x.get('index', 99))
    for pg in pages:
        ko_title = pg.get('title') or ''
        base = re.sub(r'\s*\([^)]*\)\s*$', '', ko_title)
        if norm_ko(base) != want:
            continue
        # 괄호가 붙었으면 책 문서여야 한다 — '(영화)', '(노래)' 등은 버린다
        qual = re.search(r'\(([^)]*)\)\s*$', ko_title)
        if qual and not re.search(r'소설|책|도서|시집|수필|에세이|만화|동화|희곡|작품|문학|연작', qual.group(1)):
            continue
        # 제목만 같은 일반 문서('모순' → Contradiction)를 거른다. 첫 문단에 저자가 나와야 한다
        intro = pg.get('extract') or ''
        if marks and not any(m in intro for m in marks):
            continue
        for ll in pg.get('langlinks') or []:
            en = ll.get('title') or ''
            en = re.sub(r'\s*\((?:[^)]*(?:novel|book|novella|memoir|poetry|collection|play|essay|series)[^)]*)\)\s*$',
                        '', en, flags=re.I)
            if en and not re.search(r'\(disambiguation\)\s*$', en, re.I):   # 동음이의 문서
                return en, 'https://ko.wikipedia.org/wiki/' + urllib.parse.quote(ko_title.replace(' ', '_'))
    return None, None


# ── 4. Open Library: 한국어판이 걸린 작품(work)의 이름 ──────────────────
def open_library_work(title, author, author_en):
    """Open Library는 한 작품의 여러 언어판을 한 work 로 묶는다(Goodreads와 같은 구조).
    한국어 제목으로 찾으면 그 한국어판이 속한 work 의 대표 제목(대개 원서·영어판)이 나온다.

    같은 제목의 다른 책이 걸리지 않게, 저자가 맞을 때만 받는다.
    """
    # q= 에 한 글자 제목('흰')을 넣으면 422 를 준다. title= 은 받는다
    p = urllib.parse.urlencode({'title': title, 'fields': 'key,title,author_name,language',
                                'limit': '8'})
    d = http_json('https://openlibrary.org/search.json?' + p)
    ko_marks = [w for w in re.split(r'[\s,·/]+', re.sub(r'\([^)]*\)', ' ', author or '')) if len(w) >= 2]
    en_marks = [w.lower() for w in re.split(r'[\s,.]+', plain(author_en or '')) if len(w) >= 3]
    for doc in (d or {}).get('docs') or []:
        t = doc.get('title') or ''
        if not looks_english(t):
            continue
        names = ' '.join(doc.get('author_name') or [])
        low = names.lower()
        if not ((en_marks and any(m in low for m in en_marks))
                or (ko_marks and any(m in names for m in ko_marks))):
            continue
        return t, 'https://openlibrary.org' + (doc.get('key') or '')
    return None, None


# ── 5. 위키데이터: 한국어 이름표가 붙은 작품의 영어 이름표 ────────────────
WIKIDATA_API = 'https://www.wikidata.org/w/api.php'
# 작품·책·소설 등. 이 가운데 하나여야 받는다 (같은 이름의 영화·노래를 거른다)
WD_WORK_TYPES = {'Q7725634', 'Q47461344', 'Q571', 'Q8261', 'Q1667921', 'Q49084', 'Q5185279',
                 'Q7725310', 'Q12308638', 'Q35760', 'Q25379', 'Q1279564', 'Q3331189', 'Q14406742',
                 'Q21198342', 'Q208628', 'Q182357', 'Q112983'}


def _wd_claim_ids(ent, prop):
    out = []
    for c in (ent.get('claims') or {}).get(prop) or []:
        v = ((c.get('mainsnak') or {}).get('datavalue') or {}).get('value') or {}
        if isinstance(v, dict) and v.get('id'):
            out.append(v['id'])
    return out


def wikidata_en(title, author):
    """위키백과 문서가 없는 한국 문학도 위키데이터에는 항목이 있는 경우가 많다.
    한국어 이름표가 책 제목과 같고, 저자(P50)의 한국어 이름이 맞을 때만 영어 이름표를 받는다.
    """
    marks = [w for w in re.split(r'[\s,·/]+', re.sub(r'\([^)]*\)', ' ', author or '')) if len(w) >= 2]
    if not marks:
        return None, None
    p = urllib.parse.urlencode({'action': 'wbsearchentities', 'format': 'json', 'type': 'item',
                                'search': title, 'language': 'ko', 'uselang': 'ko', 'limit': '7'})
    hits = (http_json(WIKIDATA_API + '?' + p) or {}).get('search') or []
    want = norm_ko(title)
    ids = [h['id'] for h in hits if norm_ko(h.get('label') or (h.get('match') or {}).get('text')) == want]
    if not ids:
        return None, None
    p = urllib.parse.urlencode({'action': 'wbgetentities', 'format': 'json', 'ids': '|'.join(ids),
                                'props': 'labels|claims', 'languages': 'ko|en'})
    ents = (http_json(WIKIDATA_API + '?' + p) or {}).get('entities') or {}
    books = []
    for qid in ids:
        e = ents.get(qid) or {}
        en = ((e.get('labels') or {}).get('en') or {}).get('value')
        authors = _wd_claim_ids(e, 'P50')
        types = set(_wd_claim_ids(e, 'P31'))
        if en and authors and (types & WD_WORK_TYPES or not types):
            books.append((qid, en, authors))
    if not books:
        return None, None
    aids = sorted({a for _, _, al in books for a in al})[:40]
    p = urllib.parse.urlencode({'action': 'wbgetentities', 'format': 'json', 'ids': '|'.join(aids),
                                'props': 'labels|aliases', 'languages': 'ko'})
    aents = (http_json(WIKIDATA_API + '?' + p) or {}).get('entities') or {}

    def ko_names(aid):
        a = aents.get(aid) or {}
        names = [((a.get('labels') or {}).get('ko') or {}).get('value') or '']
        names += [x.get('value') or '' for x in (a.get('aliases') or {}).get('ko') or []]
        return ' '.join(names)

    for qid, en, al in books:
        if any(m in ko_names(a) for a in al for m in marks):
            return en, 'https://www.wikidata.org/wiki/' + qid
    return None, None


# ── 5-1. 한국문학번역원 디지털 도서관 ─────────────────────────────────
# library.ltikorea.or.kr 원작(Original Works) 상세 페이지의 'English Title(Printed)' 는
# 실제로 나온 영어 번역서의 제목이다.
#   <dt>English Title(Printed)</dt><dd>THE DALLERGUT DREAM DEPARTMENT STORE</dd>
# 검색은 CSRF 토큰이 든 POST 폼이라 세션(쿠키)을 유지한다.
LTI_BASE = 'https://library.ltikorea.or.kr'
LTI = {'opener': None, 'csrf': None}
# 목록의 책 링크. 화면 언어·검색 방식에 따라 마크업이 조금씩 달라서 링크만 느슨하게 잡는다.
LTI_LINK_RE = re.compile(
    r'<a[^>]*href="(?:https?://library\.ltikorea\.or\.kr)?/originalworks/(\d+)"[^>]*>(.*?)</a>', re.S)
# 상세 페이지의 영어 제목 칸. 영어 화면은 'English Title(Printed)', 한국어 화면은 '영문 제목'.
# 괄호가 없는 칸도 있다(불편한 편의점: 영문 제목 The Inconvenient Convenience Store).
LTI_EN_RE = re.compile(
    r'<dt[^>]*>\s*(?:English\s*Title|영문\s*제목)\s*(?:\(([^)]*)\))?\s*</dt>\s*<dd[^>]*>(.*?)</dd>',
    re.S | re.I)


def lti_search(title, retried=False):
    """원작 목록 검색 결과 HTML. GET 으로 먼저 해 보고, 안 되면 CSRF 토큰을 받아 POST."""
    q = urllib.parse.urlencode({'search_word': title, 'pageSize': '30', 'rowPerPage': '30'})
    page = _lti_open(LTI_BASE + '/originalworks?' + q)
    if LTI_LINK_RE.search(page or ''):
        return page
    if not LTI['csrf']:
        m = re.search(r'name="_csrf" value="([^"]+)"', page or '')
        if not m:
            m = re.search(r'name="_csrf" value="([^"]+)"', _lti_open(LTI_BASE + '/originalworks'))
        if not m:
            raise Transient('번역원: 검색 토큰(_csrf)을 못 찾음')
        LTI['csrf'] = m.group(1)
    form = {'_csrf': LTI['csrf'], 'search_word': title, 'num_current_page': '1',
            'pageSize': '30', 'rowPerPage': '30', 'listType': 'list', 'sortTarget': 'CRDT'}
    try:
        return _lti_open(LTI_BASE + '/originalworks', form)
    except Transient as e:
        if str(e).startswith('403') and not retried:   # 세션이 끊겨 토큰이 바뀜 → 한 번만 다시
            LTI['csrf'] = None
            return lti_search(title, retried=True)
        raise


def ltikorea_en(title, author):
    """(영어 제목, 출간본인가, 상세 URL, 메모)

    목록에서 한국어 제목이 같은 원작을 고르고, 상세 페이지에 저자 한국어 이름이 있을 때만 받는다.
    'English Title(Printed)' 는 실제 출간된 번역서 제목이라 출간본(True),
    괄호 없는 '영문 제목'은 번역원이 붙인 영어 제목이라 출간 여부를 모른다(False).
    """
    marks = [w for w in re.split(r'[\s,·/]+', re.sub(r'\([^)]*\)', ' ', author or '')) if len(w) >= 2]
    page = lti_search(title)
    want = norm_ko(title)
    links = LTI_LINK_RE.findall(page or '')
    ids = []
    for wid, t in links:
        if wid not in ids and norm_ko(html.unescape(re.sub(r'<[^>]+>', '', t))) == want:
            ids.append(wid)
    if not ids:
        return None, False, None, '번역원: 검색 결과 %d건 중 제목 일치 없음' % len({w for w, _ in links})
    for wid in ids[:3]:
        url = '%s/originalworks/%s' % (LTI_BASE, wid)
        detail = _lti_open(url)
        if marks and not any(m in detail for m in marks):
            continue
        best = None
        for kind, v in LTI_EN_RE.findall(detail):
            v = tidy(v)
            if not v or v == '-':
                continue
            printed = bool(re.search(r'print|출판|출간', kind or '', re.I))
            if printed:
                return v, True, url, None
            best = best or v
        if best:
            return best, False, url, None
        return None, False, url, '번역원: 원작은 있으나 영어 제목 칸이 비어 있음'
    return None, False, None, '번역원: 제목은 맞으나 저자가 다름'


# ── 6. 영어판이 실제로 있는지 확인 ───────────────────────────────────
# Open Library(무료, 키 없음)에 같은 제목·같은 저자의 영어판이 있으면 '확인'.
# Google Books 는 GOOGLE_BOOKS_API_KEY 가 있을 때만 보조로 쓴다 — 키 없이는
# GitHub Actions 에서 늘 429 였다(두 번째 실행 11번 중 11번).
def open_library_verify(cand, author_en):
    surname = [w for w in re.split(r'[\s,.]+', plain(author_en or '')) if len(w) >= 3]
    if not surname:
        return None   # 저자 없이 제목만 맞추면 흔한 제목('White')에서 엉뚱한 책이 걸린다
    p = urllib.parse.urlencode({'title': cand, 'author': surname[-1], 'language': 'eng',
                                'fields': 'key,title', 'limit': '10'})
    d = http_json('https://openlibrary.org/search.json?' + p)
    want = norm_en(cand)
    for doc in (d or {}).get('docs') or []:
        if norm_en(doc.get('title')) == want:
            return 'https://openlibrary.org' + (doc.get('key') or '')
    return None


def verify_english(cand, author_en):
    """(확인 URL|None, 실패 메모|None)"""
    err = None
    try:
        v = open_library_verify(cand, author_en)
        if v:
            return v, None
    except Transient as e:
        err = 'Open Library 확인 못 함: %s' % e
    if os.environ.get('GOOGLE_BOOKS_API_KEY'):
        try:
            v = google_books_verify(cand, author_en)
            if v:
                return v, None
        except Transient as e:
            err = err or 'Google Books 확인 못 함: %s' % e
    return None, err


# ── 6-1. Google Books (키가 있을 때만) ───────────────────────────────
# 키가 있어도 막히면(429/403) 이번 실행에서는 더 부르지 않는다.
GOOGLE_BLOCKED = {'on': False}


def google_books_verify(cand, author_en):
    if GOOGLE_BLOCKED['on']:
        return None
    q = 'intitle:"%s"' % cand
    surname = plain(author_en or '').split(',')[0].split()[-1:] if author_en else []
    if surname:
        q += ' inauthor:' + surname[0]
    params = {'q': q, 'langRestrict': 'en', 'maxResults': '10', 'printType': 'books'}
    # 키 없이 부르면 GitHub Actions 서버들이 나눠 쓰는 한도에 걸린다 (첫 실행에서 0건 확인)
    if os.environ.get('GOOGLE_BOOKS_API_KEY'):
        params['key'] = os.environ['GOOGLE_BOOKS_API_KEY']
    p = urllib.parse.urlencode(params)
    try:
        d = http_json('https://www.googleapis.com/books/v1/volumes?' + p, tries=1)
    except Transient as e:
        if str(e).startswith('429') or str(e).startswith('403'):
            GOOGLE_BLOCKED['on'] = True
            print('  ⚠ Google Books 가 막혀서(%s) 이번 실행에서는 확인을 건너뜁니다. '
                  'Open Library 확인만 씁니다.' % str(e).split()[0])
        raise
    want = norm_en(cand)
    for it in (d or {}).get('items') or []:
        info = it.get('volumeInfo') or {}
        if info.get('language') not in (None, 'en'):
            continue
        if norm_en(info.get('title')) == want:
            return info.get('infoLink') or info.get('canonicalVolumeLink') or True
    return None


# ── 한 권 조회 ───────────────────────────────────────────────────────
def lookup(book, ttb_key, sleep):
    """후보 목록과 조회 메모를 돌려준다. 네트워크 오류는 Transient 로 올린다."""
    found = []   # (title, source, url)
    notes = []
    reached = 0  # 응답을 받은 출처 수. 0이면 조회를 못 한 것이라 기록하지 않는다

    orig, url = None, None
    try:
        orig, url = yes24_original(book['link'])
        reached += 1 if book['link'] else 0
    except Transient as e:
        notes.append('예스24 못 읽음: %s' % e)
    time.sleep(sleep)
    if orig:
        found.append((orig, 'yes24', url))

    if not looks_english(orig) and ttb_key:
        try:
            a_orig, a_url = aladin_original(book['title'], book['author'], ttb_key)
            reached += 1
        except Transient as e:
            a_orig, a_url = None, None
            notes.append('알라딘 못 읽음: %s' % e)
        time.sleep(sleep)
        if a_orig:
            found.append((a_orig, 'aladin', a_url))
            if not orig or looks_english(a_orig):
                orig = a_orig

    try:
        ol, ol_url = open_library_work(book['title'], book['author'], book.get('author_en'))
        reached += 1
    except Transient as e:
        ol, ol_url = None, None
        notes.append('Open Library 못 읽음: %s' % e)
    time.sleep(sleep)
    if ol:
        found.append((ol, 'openlibrary', ol_url))

    try:
        wen, wurl = wikipedia_en(book['title'], book['author'])
        reached += 1
    except Transient as e:
        wen, wurl = None, None
        notes.append('위키백과 못 읽음: %s' % e)
    time.sleep(sleep)
    try:
        wd, wd_url = wikidata_en(book['title'], book['author'])
        reached += 1
    except Transient as e:
        wd, wd_url = None, None
        notes.append('위키데이터 못 읽음: %s' % e)
    time.sleep(sleep)
    # 번역원은 한국 책의 번역서 목록이라, 알라딘이 영어 원제를 준 번역서(외국 책)는 건너뛴다
    if not looks_english(orig):
        try:
            lti, lti_printed, lti_url, lti_note = ltikorea_en(book['title'], book['author'])
            reached += 1
        except Transient as e:
            lti, lti_printed, lti_url, lti_note = None, False, None, None
            notes.append('번역원 못 읽음: %s' % e)
        time.sleep(sleep)
        if lti:
            found.append((lti, 'ltikorea' if lti_printed else 'ltikorea_title', lti_url))
        if lti_note:
            notes.append(lti_note)
    if not reached:
        raise Transient('; '.join(notes) or '조회할 곳이 없음')
    if wen:
        found.append((wen, 'wikipedia', wurl))
    if wd:
        found.append((wd, 'wikidata', wd_url))

    if orig and not looks_english(orig):
        notes.append('원제가 영어가 아님: %s' % orig)

    # 같은 제목끼리 묶는다 (대소문자·관사 차이는 같은 것으로)
    groups = collections.OrderedDict()
    for t, src, u in found:
        if not looks_english(t):
            continue
        k = norm_en(t)
        if not k:
            continue
        t = en_title_case(t)
        g = groups.setdefault(k, {'title': t, 'sources': [], 'urls': []})
        if src not in g['sources']:
            g['sources'].append(src)
        if u and u not in g['urls']:
            g['urls'].append(u)
        # 위키백과 표기(대소문자가 정돈된 쪽)를 우선한다
        if src == 'wikipedia':
            g['title'] = t

    cands = list(groups.values())
    for c in cands:
        v, err = verify_english(c['title'], book.get('author_en'))
        if err and not any(n.split(':')[0] == err.split(':')[0] for n in notes):
            notes.append(err)
        time.sleep(sleep)
        c['verified'] = bool(v)
        if isinstance(v, str) and v not in c['urls']:
            c['urls'].append(v)

    for c in cands:
        if looks_foreign(c['title']) and 'wikipedia' not in c['sources']:
            notes.append('원제(외국어): %s' % c['title'])
    cands = clean_candidates(cands)
    cands.sort(key=lambda c: (looks_foreign(c['title']), -(len(c['sources']) + (2 if c['verified'] else 0)
                                + (1 if {'wikipedia', 'wikidata'} & set(c['sources']) else 0))))
    return cands, notes, orig


def confidence(cands):
    if not cands:
        return 'none'
    top = cands[0]
    # 번역원 'English Title(Printed)' 는 실제 출간된 번역서라 그 자체로 확인된 것으로 본다
    if top['verified'] or len(top['sources']) >= 2 or 'ltikorea' in top['sources']:
        return 'high'
    return 'mid'


# ── 데이터 ───────────────────────────────────────────────────────────
def load_books():
    """data.csv 에서 고유 도서(도서명|저자)를 모은다."""
    with open(CSV_PATH, encoding='utf-8', newline='') as f:
        rows = list(csv.reader(f))
    h = rows[0]

    def col(name, *alts):
        for n in (name,) + alts:
            if n in h:
                return h.index(n)
        for i, x in enumerate(h):
            if any(a in x for a in (name,) + alts):
                return i
        return None

    c_title, c_author = col('도서명'), col('저자')
    c_title_en, c_author_en, c_link = col('도서명_en'), col('저자_en'), col('도서 정보')
    books = collections.OrderedDict()
    for r in rows[1:]:
        def get(c):
            return r[c].strip() if c is not None and c < len(r) else ''
        t = get(c_title)
        if not t:
            continue
        key = t + '|' + get(c_author)
        b = books.setdefault(key, {'title': t, 'author': get(c_author), 'link': '',
                                   'author_en': '', 'csv_values': collections.Counter()})
        if not b['link'] and 'yes24' in get(c_link):
            b['link'] = get(c_link)
        if not b['author_en'] and get(c_author_en) and not get(c_author_en).startswith('?'):
            b['author_en'] = get(c_author_en)
        if get(c_title_en):
            b['csv_values'][get(c_title_en)] += 1
    for b in books.values():
        b['csv'] = b['csv_values'].most_common(1)[0][0] if b['csv_values'] else ''
        del b['csv_values']
    return books


def load_out():
    if not os.path.exists(OUT_PATH):
        return {'_comment': NOTE, 'titles': {}}
    with open(OUT_PATH, encoding='utf-8') as f:
        doc = json.load(f) or {}
    doc.setdefault('titles', {})
    return doc


def flags_for(book, cands, checked=True):
    """검수 우선순위를 가르는 표시."""
    cur = book['csv']
    f = []
    if not cur:
        f.append('csv_empty')
    elif title_problem(book['title'], cur):
        f.append('csv_problem')
    elif is_starred(cur):
        f.append('csv_star')
    if cands and cur and norm_en(plain(cur)) != norm_en(cands[0]['title']):
        f.append('conflict')
    if not checked:
        f.append('unchecked')
    elif not cands:
        f.append('no_candidate')
    return f


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--limit', type=int, default=0)
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--refresh', action='store_true')
    ap.add_argument('--only', default='')
    ap.add_argument('--sleep', type=float, default=0.5)
    ap.add_argument('--no-lookup', action='store_true',
                    help='조회 없이 data.csv 의 책을 목록에만 올린다 (검수 창에 바로 뜨게)')
    args = ap.parse_args()

    ttb_key = os.environ.get('ALADIN_TTB_KEY', '').strip()
    only = {s.strip() for s in args.only.split(',') if s.strip()}
    today = datetime.date.today().isoformat()

    books = load_books()
    doc = load_out()
    titles = doc['titles']

    done = hits = auto = errors = streak = 0
    stop = False
    for key, b in books.items():
        ent = titles.get(key)
        if not ent:
            # 아직 조회 전인 책도 목록에는 올린다 — 검수 창에서 data.csv 값을 바로 볼 수 있게.
            # checked 가 없으니 다음 조회 때 차례가 온다.
            ent = titles[key] = {'title': b['title'], 'author': b['author'],
                                 'csv': b['csv'], 'candidates': [], 'status': 'pending',
                                 'value': ''}
        # data.csv 쪽 값이 바뀌었으면 기록만 갱신한다 (조회는 안 함)
        ent['csv'] = b['csv']
        if ent.get('auto') and (norm_en(plain(b['csv'])) != norm_en(ent.get('value'))
                                or ent.get('v', 1) < 2):
            # 버전 1(첫 실행)의 자동 승인은 믿지 않는다 ('모순' → Contradiction 이 이렇게 승인됐다)
            # 또는 자동 승인의 근거(CSV 값 = 후보)가 사라졌다 → 다시 사람 몫
            ent['status'] = 'pending'
            ent['value'] = (ent.get('candidates') or [{}])[0].get('title', '')
            ent.pop('auto', None)
        for c in ent.get('candidates') or []:
            c['title'] = en_title_case(c['title'])
        if ent.get('status') == 'pending' and ent.get('value'):
            ent['value'] = en_title_case(ent['value'])
        if ent.get('candidates'):
            kept = clean_candidates(ent['candidates'])
            if kept != ent['candidates']:
                gone = [c['title'] for c in ent['candidates'] if c not in kept]
                ent['candidates'] = kept
                ent['confidence'] = confidence(kept)
                ent.setdefault('notes', []).extend('원제(외국어): %s' % t for t in gone
                                                   if '원제(외국어): %s' % t not in ent['notes'])
                if ent.get('status') == 'pending' and ent.get('value') in gone:
                    ent['value'] = kept[0]['title'] if kept else ''
        if ent.get('status') == 'pending' or ent.get('auto'):
            ent['flags'] = flags_for(b, ent.get('candidates') or [], bool(ent.get('checked')))
        human = ent.get('status') in ('approved', 'none') and not ent.get('auto')

        if args.no_lookup:
            continue

        if only:
            if b['title'] not in only:
                continue
        else:
            if human:
                continue
            if (ent.get('checked') and ent.get('v', 1) >= LOOKUP_VERSION
                    and not args.refresh):
                continue
        if stop or (args.limit and done + errors >= args.limit):
            continue   # 조회는 멈추되 나머지 책의 CSV 값 동기화는 계속한다

        try:
            cands, notes, orig = lookup(b, ttb_key, args.sleep)
        except Transient as e:
            errors += 1
            streak += 1
            print('  ✗ %s — 일시 오류, 다음에 다시: %s' % (b['title'], e))
            if streak >= 8:
                stop = True
                print('  ⚠ 연달아 %d번 실패 — 네트워크 문제로 보고 조회를 멈춥니다' % streak)
            continue
        done += 1
        streak = 0

        new = {
            'title': b['title'], 'author': b['author'], 'csv': b['csv'],
            'candidates': cands,
            'confidence': confidence(cands),
            'flags': flags_for(b, cands),
            'checked': today,
            'v': LOOKUP_VERSION,
        }
        if orig:
            new['original'] = orig
        if notes:
            new['notes'] = notes

        if human:
            # 사람이 정한 값은 두고 후보만 새로 붙인다
            for k in ('status', 'value', 'reviewed', 'memo'):
                if k in ent:
                    new[k] = ent[k]
        elif (cands and b['csv'] and not title_problem(b['title'], b['csv'])
              and norm_en(plain(b['csv'])) == norm_en(cands[0]['title'])
              # 직역(*)이 한 출처와 우연히 같은 건 근거가 약하다 ('모순' → Contradiction)
              and (new['confidence'] == 'high' or not is_starred(b['csv']))):
            # data.csv 에 이미 적힌 값이 근거 있는 후보와 같다 → 확인된 것으로 본다
            new['status'] = 'approved'
            new['value'] = plain(b['csv'])
            new['auto'] = True
            auto += 1
        else:
            new['status'] = 'pending'
            new['value'] = cands[0]['title'] if cands else ''
            if ent.get('memo'):
                new['memo'] = ent['memo']

        if cands:
            hits += 1
        titles[key] = new
        mark = {'high': '●', 'mid': '◐', 'none': '○'}[new['confidence']]
        print('  %s %s / %s → %s%s' % (
            mark, b['title'], b['author'] or '-',
            ' | '.join('%s (%s%s)' % (c['title'], '+'.join(c['sources']),
                                      ', 확인' if c['verified'] else '') for c in cands)
            or '(후보 없음%s)' % ''.join(' · ' + n for n in notes if n.startswith('번역원')),
            '  [자동 승인]' if new.get('auto') else ''))

    n = collections.Counter(v.get('status', 'pending') for v in titles.values())
    print('\n조회 %d권 · 후보 찾음 %d · 자동 승인 %d · 일시 오류 %d' % (done, hits, auto, errors))
    print('파일 전체: 미검수 %d · 승인 %d · 공식판 없음 %d · 전체 %d' % (
        n['pending'], n['approved'], n['none'], len(titles)))

    if args.dry_run:
        print('--dry-run: 파일을 쓰지 않았습니다')
        return
    doc['_comment'] = doc.get('_comment') or NOTE
    doc['_updated'] = today
    doc['titles'] = dict(sorted(titles.items()))
    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, 'w', encoding='utf-8') as f:
        json.dump(doc, f, ensure_ascii=False, indent=2)
        f.write('\n')
    print('✅ %s 저장' % os.path.relpath(OUT_PATH, ROOT))


if __name__ == '__main__':
    sys.exit(main())
