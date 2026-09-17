#!/usr/bin/env python3
"""책등(spine) 이미지 URL을 모아 data/spines.json 에 채우는 배치.

예스24는 표지와 **같은 상품 ID**로 책등 이미지를 준다.

    표지  https://image.yes24.com/goods/91901136/L
    책등  https://image.yes24.com/goods/91901136/side

그래서 표지를 예스24에서 가져온 책은 API를 부르지 않고 URL만 바꾸면 된다.
문제는 표지가 알라딘인 책들 — 예스24 상품 ID를 모른다. 이 스크립트가 그걸 찾는다.

    알라딘 ItemId ──(알라딘 ItemLookUp)──▶ ISBN13
    ISBN13 ──(예스24 itemDetail)──▶ 예스24 표지 URL ──▶ 상품 ID ──▶ 책등 URL

ISBN으로 못 찾으면 제목+저자로 검색하고, 제목이 충분히 일치할 때만 받아들인다.
마지막으로 책등 이미지가 진짜 있는지 HEAD 로 확인하고 기록한다.

결과는 data/spines.json 한 파일이다. data.csv 는 건드리지 않는다 —
편집기가 CSV 컬럼을 자기 모델대로 다시 쓰기 때문에, 배치 결과를 CSV에 넣으면
다음 저장 때 날아갈 수 있다.

실행
    export ALADIN_TTB_KEY=ttb...            # 알라딘 TTB 키
    export YES24_PROXY=https://<worker>.workers.dev   # 또는
    export YES24_API_KEY=...                # 예스24 키를 직접 쓸 때
    python3 tools/fetch_spines.py --limit 50 --dry-run
    python3 tools/fetch_spines.py

옵션
    --limit N     이번 실행에서 새로 조회할 책 수 (0=무제한)
    --dry-run     파일에 쓰지 않고 결과만 출력
    --refresh     이미 실패로 기록된 책도 다시 조회
    --recheck     이미 찾은 책등도 아직 살아있는지 다시 확인
    --sleep SEC   호출 간 대기 (기본 0.34초 — 예스24 초당 한도 여유)
"""
import argparse
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_JSON = os.path.join(ROOT, 'data.json')
OUT_PATH = os.path.join(ROOT, 'data', 'spines.json')

YES24_ID_RE = re.compile(r'image\.yes24\.com/goods/(?:detail/)?(\d+)', re.I)
ALADIN_ID_RE = re.compile(r'ItemId=(\d+)', re.I)
UA = {'User-Agent': 'favorbook-spines/1.0'}


def spine_url(goods_id):
    return 'https://image.yes24.com/goods/%s/side' % goods_id


def yes24_id_from_cover(url):
    m = YES24_ID_RE.search(url or '')
    return m.group(1) if m else None


def norm(s):
    """제목 비교용 정규화 — 공백·문장부호·괄호 안 부제를 털어낸다."""
    s = re.sub(r'\([^)]*\)', ' ', str(s or ''))
    s = re.sub(r'[^0-9A-Za-z가-힣]+', '', s)
    return s.lower()


def http_json(url, headers=None, timeout=12):
    req = urllib.request.Request(url, headers={**UA, **(headers or {})})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode('utf-8', 'replace'))


def head_ok(url, timeout=10):
    """책등 이미지가 실제로 있는지. 예스24는 없는 책등에 404를 준다."""
    req = urllib.request.Request(url, headers=UA, method='HEAD')
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            ctype = (r.headers.get('Content-Type') or '').lower()
            length = int(r.headers.get('Content-Length') or 0)
            # 아주 작은 응답은 '이미지 없음' 자리표시일 수 있다
            return r.status == 200 and ctype.startswith('image/') and length > 1500
    except Exception:
        return False


# ── 알라딘 ─────────────────────────────────────────────────────────
def aladin_isbn13(item_id, ttb_key):
    p = urllib.parse.urlencode({
        'ttbkey': ttb_key, 'itemIdType': 'ItemId', 'ItemId': item_id,
        'output': 'js', 'Version': '20131101', 'Cover': 'Big',
    })
    try:
        d = http_json('https://www.aladin.co.kr/ttb/api/ItemLookUp.aspx?' + p)
    except Exception as e:
        return None, 'aladin: %s' % e
    items = (d or {}).get('item') or []
    if not items:
        return None, 'aladin: 결과 없음'
    it = items[0]
    isbn = (it.get('isbn13') or it.get('isbn') or '').strip()
    return (isbn if re.fullmatch(r'\d{13}', isbn) else None), None


# ── 예스24 ─────────────────────────────────────────────────────────
class Yes24:
    def __init__(self, proxy=None, api_key=None):
        self.proxy = (proxy or '').rstrip('/')
        self.api_key = api_key

    def _call(self, path, params):
        qs = urllib.parse.urlencode(params)
        if self.proxy:
            return http_json('%s%s?%s' % (self.proxy, path, qs))
        url = 'https://apis.yes24.com/v1%s?%s' % (path, qs)
        return http_json(url, headers={'X-Api-Key': self.api_key, 'Accept': 'application/json'})

    def _data(self, body):
        if not body or body.get('success') is not True:
            raise RuntimeError('예스24 %s: %s' % (body.get('errorCode') if body else '?',
                                                 body.get('message') if body else '응답 없음'))
        return body.get('data') or {}

    def by_isbn(self, isbn):
        d = self._data(self._call('/goods/itemDetail',
                                  {'searchType': 'ISBN13', 'query': isbn, 'detail': 'N'}))
        items = d.get('items') or []
        return items[0] if items else None

    def search(self, query, page_size=5):
        d = self._data(self._call('/goods/itemList',
                                  {'query': query, 'category': 'BOOK',
                                   'page': '1', 'pageSize': str(page_size), 'detail': 'N'}))
        return d.get('items') or []


def resolve(book, y24, ttb_key, sleep):
    """한 권의 예스24 상품 ID를 찾는다. (goods_id, 방법, 실패이유) 반환."""
    title = book['title']

    # 1) 표지가 이미 예스24면 조회가 필요 없다
    gid = yes24_id_from_cover(book.get('coverUrl'))
    if gid:
        return gid, 'cover', None

    # 2) 알라딘 ItemId → ISBN13 → 예스24
    m = ALADIN_ID_RE.search(book.get('link') or '')
    if m and ttb_key:
        isbn, err = aladin_isbn13(m.group(1), ttb_key)
        time.sleep(sleep)
        if isbn:
            try:
                it = y24.by_isbn(isbn)
                time.sleep(sleep)
            except Exception as e:
                it = None
                err = 'yes24 isbn: %s' % e
            gid = yes24_id_from_cover((it or {}).get('cover'))
            if gid:
                return gid, 'isbn', None

    # 3) 제목+저자 검색 — 제목이 맞을 때만 받는다
    q = ' '.join(x for x in (title, book.get('author')) if x).strip()
    if q:
        try:
            items = y24.search(q)
            time.sleep(sleep)
        except Exception as e:
            return None, None, 'yes24 search: %s' % e
        want = norm(title)
        for it in items:
            got = norm(it.get('title'))
            if not got or not want:
                continue
            if got == want or want in got or got in want:
                gid = yes24_id_from_cover(it.get('cover'))
                if gid:
                    return gid, 'search', None
        return None, None, '검색 결과에 제목이 맞는 책이 없음'

    return None, None, '조회할 단서 없음'


def load_books():
    """data.json에서 고유 도서를 모은다 — 같은 책을 여러 셀럽이 읽어도 한 번만."""
    with open(DATA_JSON, encoding='utf-8') as f:
        celebs = json.load(f)['celebs']
    books = {}
    for info in celebs.values():
        for b in info.get('books', []):
            t = (b.get('title') or '').strip()
            if t and t not in books:
                books[t] = {
                    'title': t,
                    'author': (b.get('author') or '').strip(),
                    'coverUrl': b.get('coverUrl') or '',
                    'link': b.get('link') or '',
                }
    return books


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--limit', type=int, default=0)
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--refresh', action='store_true')
    ap.add_argument('--recheck', action='store_true')
    ap.add_argument('--sleep', type=float, default=0.34)
    args = ap.parse_args()

    ttb_key = os.environ.get('ALADIN_TTB_KEY', '').strip()
    proxy = os.environ.get('YES24_PROXY', '').strip()
    api_key = os.environ.get('YES24_API_KEY', '').strip()
    if not proxy and not api_key:
        sys.exit('YES24_PROXY 또는 YES24_API_KEY 가 필요합니다. (tools/yes24-proxy/README.md 참고)')
    if not ttb_key:
        print('⚠️ ALADIN_TTB_KEY 가 없습니다 — ISBN 경로를 건너뛰고 제목 검색만 씁니다', file=sys.stderr)
    y24 = Yes24(proxy, api_key)

    prev = {'spines': {}, 'misses': {}}
    if os.path.exists(OUT_PATH):
        try:
            with open(OUT_PATH, encoding='utf-8') as f:
                loaded = json.load(f)
            prev['spines'] = loaded.get('spines') or {}
            prev['misses'] = loaded.get('misses') or {}
        except (json.JSONDecodeError, OSError) as e:
            print('⚠️ 기존 %s 를 읽지 못해 새로 만듭니다: %s' % (OUT_PATH, e), file=sys.stderr)

    books = load_books()
    spines = dict(prev['spines'])
    misses = dict(prev['misses'])

    todo = []
    for t, b in books.items():
        if t in spines and not args.recheck:
            continue
        if t in misses and not args.refresh:
            continue
        todo.append(b)
    todo.sort(key=lambda b: b['title'])
    if args.limit:
        todo = todo[:args.limit]

    print('고유 도서 %d권 · 이미 찾음 %d · 실패 기록 %d · 이번에 조회 %d'
          % (len(books), len(prev['spines']), len(prev['misses']), len(todo)))

    stats = {'cover': 0, 'isbn': 0, 'search': 0, 'no_image': 0, 'fail': 0}
    for i, b in enumerate(todo, 1):
        t = b['title']
        gid, how, err = resolve(b, y24, ttb_key, args.sleep)
        if not gid:
            misses[t] = err or '알 수 없음'
            stats['fail'] += 1
            print('  [%d/%d] ✗ %s — %s' % (i, len(todo), t, err))
            continue
        url = spine_url(gid)
        if not head_ok(url):
            misses[t] = '예스24에 책등 이미지 없음 (goods %s)' % gid
            stats['no_image'] += 1
            print('  [%d/%d] – %s — 상품은 찾았지만 책등 없음 (%s)' % (i, len(todo), t, gid))
            continue
        spines[t] = url
        misses.pop(t, None)
        stats[how] += 1
        print('  [%d/%d] ✓ %s — %s (%s)' % (i, len(todo), t, gid, how))

    print('\n표지에서 바로 %d · ISBN으로 %d · 검색으로 %d · 책등 없음 %d · 실패 %d'
          % (stats['cover'], stats['isbn'], stats['search'], stats['no_image'], stats['fail']))
    print('합계: 책등 %d / %d권 (%d%%)'
          % (len(spines), len(books), (len(spines) * 100 // len(books)) if books else 0))

    if args.dry_run:
        print('\n--dry-run 이라 파일에 쓰지 않았습니다.')
        return

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    out = {
        'generated': time.strftime('%Y-%m-%d'),
        'note': '예스24 책등 이미지 URL. tools/fetch_spines.py 가 채운다. 손으로 고쳐도 된다.',
        'spines': dict(sorted(spines.items())),
        'misses': dict(sorted(misses.items())),
    }
    with open(OUT_PATH, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
        f.write('\n')
    print('\n✅ %s 저장 (책등 %d · 실패 기록 %d)'
          % (os.path.relpath(OUT_PATH, ROOT), len(spines), len(misses)))


if __name__ == '__main__':
    main()
