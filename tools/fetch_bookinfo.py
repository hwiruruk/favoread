#!/usr/bin/env python3
"""책 정보(번역서 여부·출간일·쪽수·시리즈)를 예스24 API에서 받아 data/bookinfo.json 에 채우는 배치.

'책 취향' 통계(tools/taste.py)의 재료다.

    표지 URL ──▶ 예스24 상품 번호(ItemId) ──(itemDetail, detail=Y)──▶ 책 정보

제목 검색을 쓰지 않는다. 표지 URL에 든 상품 번호로 곧장 조회하니 엉뚱한 책이 붙을 일이 없다.
표지가 예스24가 아닌 책은 조회하지 않고 misses 에 남긴다 (통계에서 빠질 뿐이다).

네트워크 오류·503 은 기록하지 않는다 — 잠깐 흔들린 책이 영영 건너뛰어지면 안 되니까.
못 찾은 책(404)은 misses 에 남기고 다음 실행 때 건너뛴다(--refresh 로 재시도).

실행
    export YES24_PROXY=https://<worker>.workers.dev     # 또는
    export YES24_API_KEY=...
    python3 tools/fetch_bookinfo.py --count            # 아직 모르는 책 수만 출력
    python3 tools/fetch_bookinfo.py --limit 20 --dry-run
    python3 tools/fetch_bookinfo.py

옵션
    --count       조회 대상 권수만 출력하고 끝 (워크플로가 '10권 모였나' 볼 때 쓴다)
    --limit N     이번에 조회할 책 수 (0=무제한)
    --dry-run     파일에 쓰지 않고 결과만 출력
    --refresh     못 찾은 책도 다시 조회
    --sleep SEC   호출 간 대기 (기본 0.34초 — 예스24 초당 한도 여유)

data/bookinfo.json 은 손으로 고쳐도 된다. 이미 있는 책은 다시 조회하지 않으니 덮어쓰이지 않는다.
번역서 판정(translated)에 쓴 원값(original_title, original_translation)을 같이 남겨
맞는지 눈으로 확인할 수 있게 했다.
"""
import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_JSON = os.path.join(ROOT, 'data.json')
OUT_PATH = os.path.join(ROOT, 'data', 'bookinfo.json')
YES24_ID_RE = re.compile(r'image\.yes24\.com/goods/(?:detail/)?(\d+)', re.I)
UA = {'User-Agent': 'favorbook-bookinfo/1.0'}
YES = {'y', 'yes', 'true', '1', '번역서', '번역'}


class Fatal(Exception):
    """키가 잘못됐다 등 — 더 돌려봐야 소용없는 오류."""


class Transient(Exception):
    """일시적 오류 — 기록하지 않고 다음에 다시 시도."""


class Missing(Exception):
    """예스24에 그 상품이 없다."""


def load_books():
    with open(DATA_JSON, encoding='utf-8') as f:
        celebs = json.load(f)['celebs']
    books = {}
    for info in celebs.values():
        for b in info.get('books', []):
            t = (b.get('title') or '').strip()
            if t and t not in books:
                m = YES24_ID_RE.search(b.get('coverUrl') or '')
                books[t] = {'title': t, 'id': m.group(1) if m else ''}
    return books


def load_prev():
    try:
        with open(OUT_PATH, encoding='utf-8') as f:
            d = json.load(f)
        return d.get('books') or {}, d.get('misses') or {}
    except (FileNotFoundError, json.JSONDecodeError):
        return {}, {}


def pending(books, have, misses, refresh):
    return sorted((b for t, b in books.items()
                   if t not in have and (refresh or t not in misses)),
                  key=lambda b: b['title'])


def item_detail(item_id, proxy, api_key):
    qs = urllib.parse.urlencode({'searchType': 'ItemId', 'query': item_id, 'detail': 'Y'})
    if proxy:
        url, headers = '%s/goods/itemDetail?%s' % (proxy.rstrip('/'), qs), {}
    else:
        url, headers = ('https://apis.yes24.com/v1/goods/itemDetail?' + qs,
                        {'X-Api-Key': api_key, 'Accept': 'application/json'})
    req = urllib.request.Request(url, headers={**UA, **headers})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            body = json.loads(r.read().decode('utf-8', 'replace'))
    except urllib.error.HTTPError as e:
        try:
            body = json.loads(e.read().decode('utf-8', 'replace'))
        except Exception:
            body = {}
        code = body.get('errorCode') or ''
        if e.code == 401:
            raise Fatal('예스24 인증 실패 (%s) — YES24_API_KEY/YES24_PROXY 를 확인하세요' % (code or e.code))
        if e.code == 404:
            raise Missing(code or '404')
        raise Transient('%s %s' % (e.code, code))
    except Exception as e:
        raise Transient(str(e))
    if not body.get('success'):
        code = body.get('errorCode') or ''
        if code.startswith('GOODS_') or code.startswith('SEARCH_'):
            raise Missing(code)
        raise Transient(code or '응답 이상')
    items = ((body.get('data') or {}).get('items')) or []
    if not items:
        raise Missing('항목 없음')
    return items[0]


def to_info(it):
    orig_title = (it.get('originalTitle') or '').strip()
    orig_tr = it.get('originalTranslation')
    orig_tr = '' if orig_tr is None else str(orig_tr).strip()
    pages = it.get('pages')
    return {
        'itemId': it.get('itemId'),
        # 원제가 있거나 번역서 표시가 있으면 번역서. 판정에 쓴 원값을 아래에 같이 남긴다.
        'translated': bool(orig_title) or orig_tr.lower() in YES,
        'original_title': orig_title,
        'original_translation': orig_tr,
        'publishDate': (it.get('publishDate') or '').strip(),
        'pages': pages if isinstance(pages, int) and pages > 0 else None,
        'series': [s.get('seriesId') for s in (it.get('series') or []) if s.get('seriesId')],
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--count', action='store_true')
    ap.add_argument('--limit', type=int, default=0)
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--refresh', action='store_true')
    ap.add_argument('--sleep', type=float, default=0.34)
    args = ap.parse_args()

    books = load_books()
    have, misses = load_prev()
    # 예스24 상품 번호가 없는 책은 조회할 수 없으니 대상에서 뺀다 (세면 영영 10권이 안 넘어가는 원인이 된다)
    for t, b in books.items():
        if not b['id'] and t not in have:
            misses.setdefault(t, '표지가 예스24가 아님 — 상품 번호를 모름')
    todo = [b for b in pending(books, have, misses, args.refresh) if b['id']]

    if args.count:
        print(len(todo))
        return

    proxy = os.environ.get('YES24_PROXY', '').strip()
    api_key = os.environ.get('YES24_API_KEY', '').strip()
    if not proxy and not api_key:
        sys.exit('YES24_PROXY 또는 YES24_API_KEY 가 필요합니다. (tools/yes24-proxy/README.md 참고)')
    if args.limit:
        todo = todo[:args.limit]
    print('고유 도서 %d권 · 정보 확인 %d · 실패 기록 %d · 이번에 조회 %d'
          % (len(books), len(have), len(misses), len(todo)))

    ok = fail = net = streak = 0
    for i, b in enumerate(todo, 1):
        t = b['title']
        try:
            have[t] = to_info(item_detail(b['id'], proxy, api_key))
            misses.pop(t, None)
            ok += 1
            streak = 0
            print('  [%d/%d] ✓ %s' % (i, len(todo), t))
        except Missing as e:
            misses[t] = '예스24에 없음 (%s, goods %s)' % (e, b['id'])
            fail += 1
            streak = 0
            print('  [%d/%d] ✗ %s — %s' % (i, len(todo), t, misses[t]))
        except Transient as e:
            streak += 1
            net += 1
            print('  [%d/%d] ⚠ %s — %s (기록 안 함)' % (i, len(todo), t, e))
            if streak >= 8:
                print('\n일시적 오류가 %d번 연달아 났습니다. 키·프록시를 확인하고 나중에 다시 돌려 주세요.' % streak)
                break
        except Fatal as e:
            print('\n' + str(e))
            break
        time.sleep(args.sleep)

    print('\n찾음 %d · 없음 %d · 일시적 오류 %d · 합계 정보 확인 %d / %d권'
          % (ok, fail, net, len(have), len(books)))
    if args.dry_run:
        print('--dry-run 이라 파일에 쓰지 않았습니다.')
        return
    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, 'w', encoding='utf-8') as f:
        json.dump({
            'generated': time.strftime('%Y-%m-%d'),
            'note': '책 정보(예스24). tools/fetch_bookinfo.py 가 채운다. 손으로 고쳐도 된다(이미 있는 책은 다시 조회하지 않는다).',
            'books': dict(sorted(have.items())),
            'misses': dict(sorted(misses.items())),
        }, f, ensure_ascii=False, indent=1)
        f.write('\n')


if __name__ == '__main__':
    main()
