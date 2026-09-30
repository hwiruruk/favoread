#!/usr/bin/env python3
"""책 분야(장르)를 알라딘에서 찾아 data/genres.json 에 채우는 배치.

'책 취향' 통계(tools/taste.py)의 재료다. data.csv 에는 분야 열이 없다.

    제목+저자 ──(알라딘 ItemSearch)──▶ categoryName
    '국내도서>소설/시/희곡>한국소설' ──▶ 큰 분야 '소설'

제목이 충분히 일치할 때만 받아들인다. 엉뚱한 책의 분야가 붙는 것보다 비워두는 게 낫다.
못 찾은 책은 misses 에 남기고 다음 실행 때 건너뛴다(--refresh 로 재시도).
네트워크 오류는 기록하지 않는다 — 잠깐 흔들린 책이 영영 건너뛰어지면 안 되니까.

실행
    export ALADIN_TTB_KEY=ttb...
    python3 tools/fetch_genres.py --count          # 아직 분야를 모르는 책 수만 출력
    python3 tools/fetch_genres.py --limit 30 --dry-run
    python3 tools/fetch_genres.py

옵션
    --count       조회 대상 권수만 출력하고 끝 (워크플로가 '10권 모였나' 볼 때 쓴다)
    --limit N     이번에 조회할 책 수 (0=무제한)
    --dry-run     파일에 쓰지 않고 결과만 출력
    --refresh     못 찾은 책도 다시 조회
    --sleep SEC   호출 간 대기 (기본 0.3)

data/genres.json 은 손으로 고쳐도 된다. 이미 있는 책은 다시 조회하지 않으니 덮어쓰이지 않는다.
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

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from taste import field_of  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_JSON = os.path.join(ROOT, 'data.json')
OUT_PATH = os.path.join(ROOT, 'data', 'genres.json')
UA = {'User-Agent': 'favorbook-genres/1.0'}


def norm(s):
    s = re.sub(r'\([^)]*\)', ' ', str(s or ''))
    return re.sub(r'[^0-9A-Za-z가-힣]+', '', s).lower()


def load_books():
    with open(DATA_JSON, encoding='utf-8') as f:
        celebs = json.load(f)['celebs']
    books = {}
    for info in celebs.values():
        for b in info.get('books', []):
            t = (b.get('title') or '').strip()
            if t and t not in books:
                books[t] = {'title': t, 'author': (b.get('author') or '').strip()}
    return books


def load_prev():
    try:
        with open(OUT_PATH, encoding='utf-8') as f:
            d = json.load(f)
        return d.get('genres') or {}, d.get('misses') or {}
    except (FileNotFoundError, json.JSONDecodeError):
        return {}, {}


def pending(books, genres, misses, refresh):
    return sorted((b for t, b in books.items()
                   if t not in genres and (refresh or t not in misses)),
                  key=lambda b: b['title'])


def search(book, ttb_key):
    """(항목, 오류, 일시적오류여부). 제목이 맞는 첫 결과를 돌려준다."""
    q = ' '.join(x for x in (book['title'], book['author']) if x)
    p = urllib.parse.urlencode({
        'ttbkey': ttb_key, 'Query': q, 'QueryType': 'Keyword', 'SearchTarget': 'Book',
        'MaxResults': 5, 'output': 'js', 'Version': '20131101',
    })
    try:
        req = urllib.request.Request('https://www.aladin.co.kr/ttb/api/ItemSearch.aspx?' + p, headers=UA)
        with urllib.request.urlopen(req, timeout=12) as r:
            d = json.loads(r.read().decode('utf-8', 'replace'))
    except Exception as e:
        return None, 'aladin: %s' % e, True
    if d.get('errorCode'):
        return None, 'aladin %s: %s' % (d.get('errorCode'), d.get('errorMessage')), True
    want = norm(book['title'])
    for it in d.get('item') or []:
        got = norm(it.get('title'))
        if got and want and (got == want or want in got or got in want):
            return it, None, False
    return None, '검색 결과에 제목이 맞는 책이 없음', False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--count', action='store_true')
    ap.add_argument('--limit', type=int, default=0)
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--refresh', action='store_true')
    ap.add_argument('--sleep', type=float, default=0.3)
    args = ap.parse_args()

    books = load_books()
    genres, misses = load_prev()
    todo = pending(books, genres, misses, args.refresh)

    if args.count:
        print(len(todo))
        return

    ttb_key = os.environ.get('ALADIN_TTB_KEY', '').strip()
    if not ttb_key:
        sys.exit('ALADIN_TTB_KEY 가 필요합니다.')
    if args.limit:
        todo = todo[:args.limit]
    print('고유 도서 %d권 · 분야 확인 %d · 실패 기록 %d · 이번에 조회 %d'
          % (len(books), len(genres), len(misses), len(todo)))

    ok = fail = net = streak = 0
    for i, b in enumerate(todo, 1):
        it, err, transient = search(b, ttb_key)
        time.sleep(args.sleep)
        t = b['title']
        if transient:
            streak += 1
            net += 1
            print('  [%d/%d] ⚠ %s — %s (기록 안 함)' % (i, len(todo), t, err))
            if streak >= 8:
                print('\n일시적 오류가 %d번 연달아 났습니다. 키를 확인하고 나중에 다시 돌려 주세요.' % streak)
                break
            continue
        streak = 0
        field = field_of((it or {}).get('categoryName')) if it else ''
        if not field:
            misses[t] = err or '분야를 알 수 없는 분류: %s' % (it or {}).get('categoryName')
            fail += 1
            print('  [%d/%d] ✗ %s — %s' % (i, len(todo), t, misses[t]))
            continue
        genres[t] = {'field': field, 'category': it.get('categoryName')}
        misses.pop(t, None)
        ok += 1
        print('  [%d/%d] ✓ %s — %s' % (i, len(todo), t, field))

    print('\n찾음 %d · 못 찾음 %d · 일시적 오류 %d · 합계 분야 확인 %d / %d권'
          % (ok, fail, net, len(genres), len(books)))
    if args.dry_run:
        print('--dry-run 이라 파일에 쓰지 않았습니다.')
        return
    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, 'w', encoding='utf-8') as f:
        json.dump({
            'generated': time.strftime('%Y-%m-%d'),
            'note': '책 분야. tools/fetch_genres.py 가 채운다. 손으로 고쳐도 된다(이미 있는 책은 다시 조회하지 않는다).',
            'genres': dict(sorted(genres.items())),
            'misses': dict(sorted(misses.items())),
        }, f, ensure_ascii=False, indent=1)
        f.write('\n')


if __name__ == '__main__':
    main()
