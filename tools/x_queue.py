#!/usr/bin/env python3
"""X(트위터)에 올릴 오늘의 트윗 3개를 만든다.

API를 쓰지 않는 반자동 봇이다. 이 스크립트는 글과 이미지 재료만 준비해
data/x_queue.json 에 넣고, 실제 게시는 /xbot/ 페이지에서 사람이 버튼으로 한다.
그래서 X API 비용이 0원이다.

하루 3칸:
  1. 새로 추가된 책이 있으면 '🆕 새로 추가', 없으면 '셀럽 책장'
  2. '이 책을 읽은 셀럽들' (3명 이상이 읽은 책)
  3. '셀럽 책장'

같은 인물·책은 한 바퀴를 다 돌 때까지 다시 나오지 않는다(가장 오래전에
나간 것부터). 무엇을 언제 냈는지는 data/x_state.json 에 남는다.

사용법:
  python3 tools/x_queue.py            # 오늘 치가 없을 때만 만든다
  python3 tools/x_queue.py --force    # 오늘 치를 다시 만든다
  python3 tools/x_queue.py --dry-run  # 파일은 안 바꾸고 결과만 출력
"""
import argparse
import datetime
import json
import os
import random
import re
import sys
from urllib.parse import quote

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_JSON = os.path.join(ROOT, 'data.json')
FEATURED_JSON = os.path.join(ROOT, 'data', 'featured.json')
SHORTLINKS_JSON = os.path.join(ROOT, 'data', 'shortlinks.json')
QUEUE_JSON = os.path.join(ROOT, 'data', 'x_queue.json')
STATE_JSON = os.path.join(ROOT, 'data', 'x_state.json')

BASE = 'https://favorbook.co.kr/'
KST = datetime.timezone(datetime.timedelta(hours=9))

KEEP_DAYS = 7            # 큐에 남겨 둘 날짜 수 (놓친 날을 나중에 올릴 수 있게)
MIN_CELEB_BOOKS = 2      # 책장 트윗에 쓸 최소 권수
MIN_BOOK_CELEBS = 3      # '이 책을 읽은 셀럽들'에 쓸 최소 인원
MAX_COVERS = 6           # 이미지에 넣을 표지 수
TWEET_LIMIT = 280
URL_WEIGHT = 23          # X는 링크를 길이와 상관없이 23으로 센다
HASHTAG = '#최애의독서'


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
# twitter-text 의 가중치 범위를 그대로 옮겼다.

_LIGHT_RANGES = ((0, 4351), (8192, 8205), (8208, 8223), (8242, 8247))
_URL_RE = re.compile(r'https?://\S+')


def tweet_length(text):
    n = 0
    for u in _URL_RE.findall(text):
        n += URL_WEIGHT
    text = _URL_RE.sub('', text)
    for ch in text:
        cp = ord(ch)
        n += 1 if any(a <= cp <= b for a, b in _LIGHT_RANGES) else 2
    return n


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


def book_line(b):
    author = (b.get('author') or '').strip()
    return '· ' + b['title'].strip() + (' (' + author + ')' if author else '')


def fit(head, lines, tail, more_fmt):
    """head + lines + tail 이 280을 넘으면 줄을 뒤에서부터 빼고 '외 N…'을 붙인다."""
    for keep in range(len(lines), 0, -1):
        body = lines[:keep]
        rest = len(lines) - keep
        if rest:
            body = body + [more_fmt.format(rest)]
        text = head + '\n'.join(body) + tail
        if tweet_length(text) <= TWEET_LIMIT:
            return text
    return head.rstrip() + tail


# ── 트윗 만들기 ─────────────────────────────────────────────────────

def order_books(books, book_idx, rng):
    """가나다순 대신 여러 셀럽이 함께 읽은 책을 앞에, 나머지는 섞어서."""
    seen, books_ = set(), []
    for b in books:                       # 같은 책이 두 번 들어간 경우가 있다
        t = b['title'].strip()
        if t not in seen:
            seen.add(t)
            books_.append(b)
    books = books_
    rng.shuffle(books)
    return sorted(books, key=lambda b: -len(book_idx.get(b['title'].strip(), {}).get('celebs', [])))


def make_celeb_item(name, celeb, variant, books):
    heads = [
        '📚 {n}의 책장\n\n',
        '📚 {n}의 인생책·추천 책\n\n',
        '📚 최애의 독서 — {n}\n\n',
    ]
    head = heads[variant % len(heads)].format(n=name)
    url = celeb_url(name, celeb)
    tags = ' '.join([HASHTAG] + hashtags_for(name)[:2])
    tail = '\n\n출처와 함께 전체 목록 보기 ▶\n' + url + '\n\n' + tags
    text = fit(head, [book_line(b) for b in books], tail, '외 {}권')
    return {
        'type': 'celeb',
        'key': name,
        'label': '셀럽 책장',
        'text': text,
        'url': url,
        'image': {
            'kicker': '최애의 독서',
            'title': name + '의 책장',
            'sub': '읽은 책 · 추천 책 ' + str(len(books)) + '권',
            'covers': [b.get('coverUrl') for b in books if b.get('coverUrl')][:MAX_COVERS],
        },
    }


def make_new_item(name, celeb, titles, books):
    new_books = [b for b in books if b['title'].strip() in titles]
    url = celeb_url(name, celeb)
    head = '🆕 새로 추가됐어요\n{n}의 책장에 {k}권이 들어왔어요\n\n'.format(n=name, k=len(new_books))
    tags = ' '.join([HASHTAG] + hashtags_for(name)[:2])
    tail = '\n\n전체 목록과 출처 ▶\n' + url + '\n\n' + tags
    text = fit(head, [book_line(b) for b in new_books], tail, '외 {}권')
    return {
        'type': 'new',
        'key': name,
        'titles': sorted(titles),
        'label': '새로 추가',
        'text': text,
        'url': url,
        'image': {
            'kicker': 'NEW · 최애의 독서',
            'title': name + '의 새 책',
            'sub': str(len(new_books)) + '권 추가 · 전체 ' + str(len(celeb['books'])) + '권',
            'covers': [b.get('coverUrl') for b in new_books if b.get('coverUrl')][:MAX_COVERS],
        },
    }


def make_book_item(title, entry, shortlinks, variant):
    names = entry['celebs']
    book = entry['book']
    author = (book.get('author') or '').strip()
    heads = [
        '📖 셀럽 {c}명이 읽은 책\n『{t}』{a}\n\n',
        '📖 『{t}』{a}\n이 책을 읽은 셀럽 {c}명\n\n',
    ]
    head = heads[variant % len(heads)].format(c=len(names), t=title, a=(' ' + author if author else ''))
    url = book_url(title, shortlinks)
    tail = '\n\n누가 어떤 이유로 읽었는지 ▶\n' + url + '\n\n' + HASHTAG
    # 이름은 쉼표로 이어 붙이고, 넘치면 뒤에서부터 빼고 '외 N명'
    text = None
    for keep in range(len(names), 0, -1):
        shown = ', '.join(names[:keep])
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
            'kicker': '셀럽 ' + str(len(names)) + '명이 읽은 책',
            'title': '『' + title + '』',
            'sub': author,
            'covers': [book['coverUrl']] if book.get('coverUrl') else [],
            'names': names,
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


def build_day(date_str, celebs, featured, shortlinks, state, rng):
    celeb_last = state.setdefault('celeb_last', {})
    book_last = state.setdefault('book_last', {})
    pending = state.setdefault('pending_new', {})
    book_idx = build_book_index(celebs)
    variant = datetime.date.fromisoformat(date_str).toordinal()

    celeb_pool = [n for n, c in celebs.items() if len(c['books']) >= MIN_CELEB_BOOKS]
    book_pool = [t for t, e in book_idx.items() if len(e['celebs']) >= MIN_BOOK_CELEBS]
    used_celebs = set()

    def next_celeb():
        pool = [n for n in celeb_pool if n not in used_celebs]
        name = pick_least_recent(pool, celeb_last, rng, featured)
        used_celebs.add(name)
        celeb_last[name] = date_str
        return make_celeb_item(name, celebs[name], variant, order_books(celebs[name]['books'], book_idx, rng))

    items = []

    # 1칸: 새로 추가 (가장 많이 들어온 인물부터) / 없으면 책장
    if pending:
        name = max(pending, key=lambda n: (len(pending[n]), n))
        books = order_books(celebs[name]['books'], book_idx, rng)
        items.append(make_new_item(name, celebs[name], set(pending.pop(name)), books))
        used_celebs.add(name)
        celeb_last[name] = date_str
    else:
        items.append(next_celeb())

    # 2칸: 이 책을 읽은 셀럽들
    # 처음 한 바퀴는 많이 읽힌 책부터
    by_count = sorted(book_pool, key=lambda t: -len(book_idx[t]['celebs']))
    title = pick_least_recent(book_pool, book_last, rng, by_count)
    if title:
        book_last[title] = date_str
        items.append(make_book_item(title, book_idx[title], shortlinks, variant))
    else:
        items.append(next_celeb())

    # 3칸: 책장
    items.append(next_celeb())

    for i, it in enumerate(items, 1):
        it['id'] = date_str + '-' + str(i)
        it['length'] = tweet_length(it['text'])
    return {'date': date_str, 'items': items}


def release_day(day, date_str, state):
    """--force 로 다시 만들 때, 그날 뽑혔던 것을 '안 나간 것'으로 되돌린다."""
    for it in day['items']:
        last = state.get('book_last' if it['type'] == 'book' else 'celeb_last', {})
        if last.get(it['key']) == date_str:
            del last[it['key']]
        if it['type'] == 'new':
            lst = state.setdefault('pending_new', {}).setdefault(it['key'], [])
            lst.extend(t for t in it.get('titles', []) if t not in lst)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--date', help='만들 날짜 (YYYY-MM-DD, 기본: 오늘 KST)')
    ap.add_argument('--force', action='store_true', help='그날 치가 이미 있어도 다시 만든다')
    ap.add_argument('--dry-run', action='store_true', help='파일은 안 바꾸고 출력만')
    args = ap.parse_args()

    date_str = args.date or datetime.datetime.now(KST).date().isoformat()
    celebs = load_json(DATA_JSON, {})['celebs']
    featured = [p['name'] for p in load_json(FEATURED_JSON, {}).get('picks', []) if p.get('name') in celebs]
    shortlinks = load_json(SHORTLINKS_JSON, {})
    state = load_json(STATE_JSON, {})
    queue = load_json(QUEUE_JSON, {'days': []})

    if any(d['date'] == date_str for d in queue['days']) and not args.force:
        print(date_str + ' 치는 이미 있습니다. 다시 만들려면 --force')
        return 0

    old = next((d for d in queue['days'] if d['date'] == date_str), None)
    if old:
        release_day(old, date_str, state)
    detect_new(celebs, state)
    rng = random.Random(date_str)
    day = build_day(date_str, celebs, featured, shortlinks, state, rng)

    for it in day['items']:
        print('─' * 40)
        print('[' + it['label'] + '] ' + str(it['length']) + '/280')
        print(it['text'])
    print('─' * 40)

    if args.dry_run:
        print('(연습 모드 — 파일은 그대로)')
        return 0

    days = [d for d in queue['days'] if d['date'] != date_str] + [day]
    days.sort(key=lambda d: d['date'], reverse=True)
    queue = {'updated': date_str, 'days': days[:KEEP_DAYS]}
    save_json(QUEUE_JSON, queue)
    save_json(STATE_JSON, state)
    print('저장: data/x_queue.json, data/x_state.json')
    return 0


if __name__ == '__main__':
    sys.exit(main())
