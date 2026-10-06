#!/usr/bin/env python3
"""책 분야를 예스24 카테고리에서 받아 data/categories.json 에 채우는 배치.

'책 취향' 통계(tools/taste.py)의 재료다. 분야는 서점 분류를 그대로 쓴다.

    표지 URL ──▶ 예스24 상품 번호 ──▶ 카테고리 경로 (국내도서 > 소설/시/희곡 > 한국소설 > 한국 장편소설)

예전에는 도서관 분류(KDC)를 썼는데 810(한국문학)처럼 문학인 것만 알고 소설인지 시인지 모르는 책이 많아 뺐다.
서점 카테고리는 소설·시·에세이·만화·자기계발을 처음부터 나눠 둔다.

카테고리는 두 군데서 찾는다.
    1. 예스24 Open API itemDetail(detail=Y) 응답 — 이름에 'categ' 가 든 필드. 키(YES24_PROXY/YES24_API_KEY)가 있을 때만
    2. 예스24 상품 페이지의 '카테고리 분류' 칸 — 키가 없어도 된다
API 응답에 카테고리가 있는지 문서로 확인하지 못해서 둘 다 본다. 어디서 받았는지는 책마다 from 에 남는다.
한 책이 여러 카테고리에 걸려 있으면 예스24가 적은 순서대로 모두 남긴다 (첫 경로가 대표 분류다).

네트워크 오류는 기록하지 않는다 — 잠깐 흔들린 책이 영영 건너뛰어지면 안 되니까.
처음 몇 권이 연달아 카테고리를 못 읽으면(페이지 구조가 바뀌었거나 막혔으면) 실패로 기록하지 않고 멈춘다.

실행
    export YES24_PROXY=https://<worker>.workers.dev     # 또는 YES24_API_KEY (없어도 상품 페이지로 돈다)
    python3 tools/fetch_categories.py --count
    python3 tools/fetch_categories.py --limit 5 --dry-run
    python3 tools/fetch_categories.py

옵션
    --count       조회 대상 권수만 출력하고 끝
    --limit N     이번에 조회할 책 수 (0=무제한)
    --dry-run     파일에 쓰지 않고 결과만 출력
    --refresh     못 찾은 책도 다시 조회
    --sleep SEC   책 사이 대기 (기본 1초 — 상품 페이지를 받으니 넉넉히 쉰다)

data/categories.json 은 손으로 고치지 말고, 분야가 틀리면 편집기 '🏷️ 분야 검수'에서 고친다
(data/genres.json 에 남고 자동 분류보다 먼저 쓰인다).
"""
import argparse
import html
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fetch_bookinfo as fb  # noqa: E402  예스24 API 호출·책 목록을 그대로 쓴다

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_PATH = os.path.join(ROOT, 'data', 'categories.json')
PAGE_URL = 'https://www.yes24.com/product/goods/%s'
PAGE_UA = {'User-Agent': 'Mozilla/5.0 (compatible; favorbook-categories/1.0; +https://favorbook.co.kr)',
           'Accept-Language': 'ko-KR,ko;q=0.9'}
CAT_LINK_RE = re.compile(r'<a\b[^>]*href="[^"]*category/display/(\d+)[^"]*"[^>]*>(.*?)</a>', re.I | re.S)
TAG_RE = re.compile(r'<[^>]+>')
SAFETY_FIRST = 5     # 처음 이만큼 연달아 카테고리를 못 읽으면 멈춘다


def _clean(s):
    return re.sub(r'\s+', ' ', html.unescape(TAG_RE.sub('', s))).strip()


def _split_path(s):
    parts = [_clean(x) for x in re.split(r'\s*(?:>|&gt;|›)\s*', str(s))]
    return [x for x in parts if x]


# ── 1. API 응답 ─────────────────────────────────────────────────────
def api_paths(it):
    """API 응답에서 카테고리 경로를 찾는다. 필드 모양을 몰라서 'categ' 가 든 키 아래의
    'A > B > C' 꼴 문자열만 경로로 본다. 못 찾으면 []."""
    paths = []

    def strings(x):
        if isinstance(x, str):
            yield x
        elif isinstance(x, dict):
            for v in x.values():
                yield from strings(v)
        elif isinstance(x, list):
            for v in x:
                yield from strings(v)

    def walk(x):
        if isinstance(x, dict):
            for k, v in x.items():
                if 'categ' in str(k).lower():
                    for s in strings(v):
                        p = _split_path(s) if '>' in s else []
                        if len(p) >= 2 and p not in paths:
                            paths.append(p)
                else:
                    walk(v)
        elif isinstance(x, list):
            for v in x:
                walk(v)
    walk(it)
    return paths


def api_categ_raw(it):
    """로그용 — 'categ' 가 든 필드를 그대로 모은다 (응답 모양을 확인하려고)."""
    out = {}

    def walk(x, pre=''):
        if isinstance(x, dict):
            for k, v in x.items():
                if 'categ' in str(k).lower():
                    out[pre + str(k)] = v
                else:
                    walk(v, pre + str(k) + '.')
        elif isinstance(x, list) and x:
            walk(x[0], pre + '0.')
    walk(it)
    return out


# ── 2. 상품 페이지 ───────────────────────────────────────────────────
def fetch_page(item_id):
    req = urllib.request.Request(PAGE_URL % item_id, headers=PAGE_UA)
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            raw = r.read()
            cs = r.headers.get_content_charset() or 'utf-8'
    except urllib.error.HTTPError as e:
        if e.code == 404:
            raise fb.Missing('상품 페이지 404')
        if e.code in (403, 429):
            raise fb.Fatal('예스24 상품 페이지가 막혔습니다 (HTTP %d). 잠시 뒤 다시 돌려 주세요.' % e.code)
        raise fb.Transient('HTTP %d' % e.code)
    except Exception as e:
        raise fb.Transient(str(e))
    try:
        return raw.decode(cs, 'replace')
    except LookupError:
        return raw.decode('utf-8', 'replace')


def page_paths(doc):
    """상품 페이지의 '카테고리 분류' 칸에서 경로를 읽는다. 경로 하나가 <li> 하나이고,
    각 단계가 /category/display/<번호> 링크다. 칸을 못 찾으면 None, 칸은 있는데 비었으면 []."""
    starts = [m.start() for m in re.finditer(r'카테고리 분류|infoset_goodsCate', doc)]
    if not starts:
        return None
    for i in starts:   # 같은 말이 메뉴·스크립트에도 있을 수 있어 경로가 나오는 첫 칸을 쓴다
        block = doc[i:]
        end = re.search(r'</ul>|</dl>', block, re.I)
        if end:
            block = block[:end.start()]
        paths = []
        for li in re.split(r'<li\b', block, flags=re.I)[1:] or [block]:
            links = CAT_LINK_RE.findall(li)
            p = [_clean(name) for _, name in links if _clean(name)]
            if len(p) >= 2 and p not in [x['path'] for x in paths]:
                paths.append({'path': p, 'code': links[-1][0]})
        if paths:
            return paths
    return []


# ── 실행 ────────────────────────────────────────────────────────────
def load_json(path):
    try:
        with open(path, encoding='utf-8') as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def lookup(item_id, proxy, api_key, state):
    """→ (경로 목록, 출처). 둘 다 못 찾으면 ([], '')."""
    if state['api']:
        try:
            it = fb.item_detail(item_id, proxy, api_key)
            if not state['api_shown']:
                state['api_shown'] = True
                raw = api_categ_raw(it)
                print('  (API 첫 응답 상품 %s) 카테고리 필드: %s'
                      % (item_id, json.dumps(raw, ensure_ascii=False)[:600] if raw else '없음'))
            p = api_paths(it)
            if p:
                return [{'path': x} for x in p], 'api'
            state['api_empty'] += 1
            if state['api_empty'] >= SAFETY_FIRST and not state['api_hit']:
                state['api'] = False
                print('  → API 응답에 카테고리 경로가 없어 이번 실행은 상품 페이지만 봅니다.')
        except fb.Missing:
            pass   # API에 없으면 페이지에서 찾아 본다
        except fb.Fatal as e:
            state['api'] = False
            print('  → %s — 이번 실행은 상품 페이지만 봅니다.' % e)
    doc = fetch_page(item_id)
    p = page_paths(doc)
    if not p and not state['page_hit']:
        # 아직 한 권도 못 읽었으면 페이지 구조를 의심한다 — 실패로 기록하지 않고(다음에 다시 본다) 로그를 남긴다
        state['page_fail'] += 1
        title = re.search(r'<title[^>]*>(.*?)</title>', doc, re.I | re.S)
        print('  (상품 %s 페이지) 길이 %d · 제목 %r · \'카테고리 분류\' %s · 카테고리 링크 %d개'
              % (item_id, len(doc), _clean(title.group(1)) if title else '', '있음' if p is not None else '없음',
                 len(CAT_LINK_RE.findall(doc))))
        if state['page_fail'] >= SAFETY_FIRST:
            raise fb.Fatal('상품 페이지에서 \'카테고리 분류\' 칸을 %d권 연달아 못 읽었습니다. '
                           '페이지 구조가 바뀌었는지 확인해 주세요 (tools/fetch_categories.py 의 page_paths).'
                           % state['page_fail'])
        raise fb.Transient('카테고리 칸을 못 읽음')
    return p or [], 'page' if p else ''


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--count', action='store_true')
    ap.add_argument('--limit', type=int, default=0)
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--refresh', action='store_true')
    ap.add_argument('--sleep', type=float, default=1.0)
    args = ap.parse_args()

    books = fb.load_books()
    prev = load_json(OUT_PATH)
    have, misses = prev.get('books') or {}, prev.get('misses') or {}
    todo = sorted(t for t, b in books.items()
                  if b['id'] and t not in have and (args.refresh or t not in misses))
    if args.count:
        print(len(todo))
        return
    if args.limit:
        todo = todo[:args.limit]

    proxy = os.environ.get('YES24_PROXY', '').strip()
    api_key = os.environ.get('YES24_API_KEY', '').strip()
    state = {'api': bool(proxy or api_key), 'api_shown': False, 'api_empty': 0, 'api_hit': False,
             'page_fail': 0, 'page_hit': False}
    print('책 %d권 · 분야 확인 %d · 실패 기록 %d · 이번에 조회 %d (API %s · 상품 페이지 켬)'
          % (len(books), len(have), len(misses), len(todo), '켬' if state['api'] else '끔'))

    ok = fail = net = streak = 0
    for i, t in enumerate(todo, 1):
        item_id = books[t]['id']
        try:
            paths, src = lookup(item_id, proxy, api_key, state)
            time.sleep(args.sleep)
            if not paths:
                misses[t] = '카테고리 없음 (goods %s)' % item_id
                fail += 1
                streak = 0
                print('  [%d/%d] ✗ %s — %s' % (i, len(todo), t, misses[t]))
                continue
            state['api_hit'] |= src == 'api'
            state['page_hit'] |= src == 'page'
            have[t] = {'itemId': int(item_id), 'from': src, 'cats': paths}
            misses.pop(t, None)
            ok += 1
            streak = 0
            print('  [%d/%d] ✓ %s — %s' % (i, len(todo), t, ' > '.join(paths[0]['path'])))
        except fb.Missing as e:
            misses[t] = '예스24에 없음 (%s, goods %s)' % (e, item_id)
            fail += 1
            streak = 0
            print('  [%d/%d] ✗ %s — %s' % (i, len(todo), t, misses[t]))
        except fb.Transient as e:
            streak += 1
            net += 1
            print('  [%d/%d] ⚠ %s — %s (기록 안 함)' % (i, len(todo), t, e))
            if streak >= 8:
                print('\n일시적 오류가 %d번 연달아 났습니다. 나중에 다시 돌려 주세요.' % streak)
                break
            time.sleep(args.sleep * 3)
        except fb.Fatal as e:
            print('\n' + str(e) + '\n여기까지 받은 것만 저장합니다.')
            break

    print('\n찾음 %d · 없음 %d · 일시적 오류 %d · 합계 분야 확인 %d / %d권'
          % (ok, fail, net, len(have), len(books)))
    if args.dry_run:
        print('--dry-run 이라 파일에 쓰지 않았습니다.')
        return
    if not ok and not fail:
        print('새로 받은 게 없어 파일을 그대로 둡니다.')
        return
    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, 'w', encoding='utf-8') as f:
        json.dump({
            'generated': time.strftime('%Y-%m-%d'),
            'note': '책 분야(예스24 카테고리). tools/fetch_categories.py 가 채운다. 첫 경로가 예스24 대표 분류다. '
                    '분야가 틀리면 편집기 🏷️ 분야 검수에서 고친다(data/genres.json).',
            'books': dict(sorted(have.items())),
            'misses': dict(sorted(misses.items())),
        }, f, ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main()
