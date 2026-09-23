#!/usr/bin/env python3
"""책의 공식 영문판 제목 후보를 모아 data/titles_en.json 에 채우는 배치.

예전 방식(enrich_en.py, 편집기의 '직역*' 버튼)은 한국어 제목을 영어로
번역하거나 한국어 제목 그대로 영어 책을 검색했다. 영문판에는 한국어 제목이
없으니 거의 걸리지 않았고, 빈자리는 직역으로 채워졌다.

    소년이 온다  → The Boy Is Coming *   (공식: Human Acts)
    데미안       → Damian *              (공식: Demian)

이 스크립트는 번역하지 않는다. 이미 누군가 적어 둔 '원제'와 '영어 문서 이름'을
찾아 온다.

    예스24 상품 페이지  원서명/원제          번역서라면 거의 다 적혀 있다
    알라딘 API          subInfo.originalTitle 예스24가 막혔을 때 대신 (키 필요)
    한국어 위키백과     영어 문서 링크         한국 문학·고전 (소년이 온다 → Human Acts)
    Google Books        위 후보가 실제 영어판으로 나왔는지 확인만 한다

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
    ALADIN_TTB_KEY  있으면 예스24에서 원제를 못 찾은 책을 알라딘에서 한 번 더 찾는다
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


def http_get(url, ua=UA, timeout=15):
    req = urllib.request.Request(url, headers={'User-Agent': ua,
                                               'Accept-Language': 'ko,en;q=0.8'})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.read().decode('utf-8', 'replace')
    except urllib.error.HTTPError as e:
        if e.code in (404, 410):
            return ''
        raise Transient('%s %s' % (e.code, url.split('?')[0]))
    except Exception as e:
        raise Transient('%s %s' % (e, url.split('?')[0]))


def http_json(url, **kw):
    body = http_get(url, **kw)
    return json.loads(body) if body else {}


# ── 1. 예스24 상품 페이지의 원제 ──────────────────────────────────────
YES24_GOODS_RE = re.compile(r'yes24\.com/(?:product/)?goods/(?:detail/)?(\d+)', re.I)

# 예스24는 번역서의 원제를 두 군데에 적는다.
#   품목정보 표   <th>원서명/저자명</th><td>The Moon and Sixpence/Maugham, W. Somerset</td>
#   제목 아래     <h3 class="gd_nameE">The Moon and Sixpence</h3>
YES24_PATTERNS = [
    (re.compile(r'원서명\s*/\s*저자명\s*</th>\s*<td[^>]*>(.*?)</td>', re.S), True),
    (re.compile(r'원서명\s*</th>\s*<td[^>]*>(.*?)</td>', re.S), False),
    (re.compile(r'class="gd_nameE"[^>]*>(.*?)</', re.S), False),
    (re.compile(r'원제\s*[:：]\s*([^<\n]{2,200})'), False),
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
        'gsrlimit': '5', 'prop': 'langlinks', 'lllang': 'en', 'redirects': '1',
    })
    d = http_json('https://ko.wikipedia.org/w/api.php?' + p)
    want = norm_ko(title)
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
        for ll in pg.get('langlinks') or []:
            en = ll.get('title') or ''
            en = re.sub(r'\s*\((?:[^)]*(?:novel|book|novella|memoir|poetry|collection|play|essay|series)[^)]*)\)\s*$',
                        '', en, flags=re.I)
            if en:
                return en, 'https://ko.wikipedia.org/wiki/' + urllib.parse.quote(ko_title.replace(' ', '_'))
    return None, None


# ── 4. Google Books 로 영어판이 실제로 있는지 확인 ─────────────────────
def google_books_verify(cand, author_en):
    q = 'intitle:"%s"' % cand
    surname = plain(author_en or '').split(',')[0].split()[-1:] if author_en else []
    if surname:
        q += ' inauthor:' + surname[0]
    p = urllib.parse.urlencode({'q': q, 'langRestrict': 'en', 'maxResults': '10',
                                'printType': 'books'})
    d = http_json('https://www.googleapis.com/books/v1/volumes?' + p)
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

    if not orig and ttb_key:
        try:
            orig, url = aladin_original(book['title'], book['author'], ttb_key)
            reached += 1
        except Transient as e:
            notes.append('알라딘 못 읽음: %s' % e)
        time.sleep(sleep)
        if orig:
            found.append((orig, 'aladin', url))

    try:
        wen, wurl = wikipedia_en(book['title'], book['author'])
        reached += 1
    except Transient as e:
        wen, wurl = None, None
        notes.append('위키백과 못 읽음: %s' % e)
    time.sleep(sleep)
    if not reached:
        raise Transient('; '.join(notes) or '조회할 곳이 없음')
    if wen:
        found.append((wen, 'wikipedia', wurl))

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
        try:
            v = google_books_verify(c['title'], book.get('author_en'))
        except Transient:
            v = None
        time.sleep(sleep)
        c['verified'] = bool(v)
        if isinstance(v, str) and v not in c['urls']:
            c['urls'].append(v)

    cands.sort(key=lambda c: (-(len(c['sources']) + (2 if c['verified'] else 0)
                                + (1 if 'wikipedia' in c['sources'] else 0))))
    return cands, notes, orig


def confidence(cands):
    if not cands:
        return 'none'
    top = cands[0]
    if top['verified'] or len(top['sources']) >= 2:
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
        if ent.get('auto') and norm_en(plain(b['csv'])) != norm_en(ent.get('value')):
            # 자동 승인의 근거(CSV 값 = 후보)가 사라졌다 → 다시 사람 몫
            ent['status'] = 'pending'
            ent['value'] = (ent.get('candidates') or [{}])[0].get('title', '')
            ent.pop('auto', None)
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
            if ent.get('checked') and not args.refresh:
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
              and norm_en(plain(b['csv'])) == norm_en(cands[0]['title'])):
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
                                      ', 확인' if c['verified'] else '') for c in cands) or '(후보 없음)',
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
