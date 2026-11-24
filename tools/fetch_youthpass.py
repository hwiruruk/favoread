#!/usr/bin/env python3
"""청년문화예술패스로 살 수 있는 책인지 예스24 상품 페이지로 확인해 data/youthpass.json 에 채우는 배치.

    표지 URL ──▶ 예스24 상품 번호 ──(상품 페이지)──▶ 청년패스 아이콘 여부 · ISBN-13

예스24는 패스로 결제할 수 있는 책의 제목 옆에 '청년패스' 아이콘을 달고, '#청년패스' 해시태그
(hashTagNo 9203)를 붙인다. 해시태그는 판매가 끝난 책에도 남아 있어서 판정은 아이콘으로 하고,
태그 여부(tag)는 참고로만 남긴다.
같은 책을 서점ON(bookshop.or.kr)에서도 찾을 수 있게 ISBN-13을 함께 남긴다 —
서점ON 검색에 ISBN을 넣으면 그 판본 하나만 나온다.

네트워크 오류·5xx 는 기록하지 않는다(다음 실행 때 다시 본다).
대상 여부는 바뀔 수 있으니 --refresh 로 전부 다시 볼 수 있다.

실행
    python3 tools/fetch_youthpass.py --count
    python3 tools/fetch_youthpass.py --limit 20 --dry-run
    python3 tools/fetch_youthpass.py              # 아직 안 본 책만
    python3 tools/fetch_youthpass.py --refresh    # 전부 다시

옵션
    --count       조회 대상 권수만 출력
    --limit N     이번에 조회할 책 수 (0=무제한)
    --dry-run     파일에 쓰지 않고 결과만 출력
    --refresh     이미 본 책도 다시 조회
    --sleep SEC   한 조회가 끝난 뒤 쉬는 시간 (기본 0.8초)
    --workers N   동시에 조회할 수 (기본 2)
"""
import argparse
import concurrent.futures
import datetime
import html
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_JSON = os.path.join(ROOT, 'data.json')
OUT_PATH = os.path.join(ROOT, 'data', 'youthpass.json')
YES24_ID_RE = re.compile(r'image\.yes24\.com/goods/(?:detail/)?(\d+)', re.I)
PAGE = 'https://www.yes24.com/product/goods/{}'
UA = {'User-Agent': 'Mozilla/5.0 (compatible; favorbook-youthpass/1.0)'}
TAG = '청년패스'
TAG_NO = '9203'   # 예스24 해시태그 번호 (참고용)
KW_RE = re.compile(r'<meta name="keywords" content="([^"]*)"', re.I)
ISBN_RE = re.compile(r'97[89]\d{10}')
ICON = 'iconC youthPass'
FLAG_RE = re.compile(r"g_YouthCulturePass\s*=\s*'([YN])'")
SAVE_EVERY = 50


class Transient(Exception):
    pass


class Missing(Exception):
    pass


def load_out():
    if os.path.exists(OUT_PATH):
        with open(OUT_PATH, encoding='utf-8') as f:
            return json.load(f)
    return {}


def save_out(out):
    out['generated'] = datetime.date.today().isoformat()
    out['books'] = dict(sorted(out['books'].items(), key=lambda kv: int(kv[0])))
    tmp = OUT_PATH + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
        f.write('\n')
    os.replace(tmp, OUT_PATH)


def goods_ids():
    """data.json 에 나오는 예스24 상품 번호 → 제목 (처음 나온 제목)"""
    with open(DATA_JSON, encoding='utf-8') as f:
        celebs = json.load(f)['celebs']
    ids = {}
    for v in celebs.values():
        for b in v['books']:
            m = YES24_ID_RE.search(b.get('coverUrl') or '')
            if m:
                ids.setdefault(m.group(1), b['title'].strip())
    return ids


def _read_until(r, marker, extra, cap):
    """응답을 조금씩 읽다가 marker 가 나오고 extra 바이트를 더 읽으면 멈춘다(최대 cap)."""
    buf = b''
    stop = None
    while len(buf) < cap:
        chunk = r.read(16 * 1024)
        if not chunk:
            break
        buf += chunk
        if stop is None:
            i = buf.find(marker)
            if i >= 0:
                stop = i + extra
        if stop is not None and len(buf) >= stop:
            break
    return buf.decode('utf-8', 'ignore')


def fetch(gid):
    """청년패스로 살 수 있는지와 ISBN-13.

    판정은 제목 옆 '청년패스 아이콘'(<span class="iconC youthPass">)으로 한다.
    페이지 맨 끝의 g_YouthCulturePass = 'Y'/'N' 과 같은 값이다.
    meta keywords 의 '청년패스' 해시태그는 판매가 끝난 책에도 남아 있어 판정에 쓰지 않는다.
    페이지는 600KB가 넘어 제목(gd_name)이 나오는 데까지만 받는다."""
    req = urllib.request.Request(PAGE.format(gid), headers=UA)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            page = _read_until(r, b'class="gd_name"', 2048, 1024 * 1024)
    except urllib.error.HTTPError as e:
        if e.code == 404:
            raise Missing()
        raise Transient('HTTP %s' % e.code)
    except Exception as e:  # 연결 끊김·시간 초과
        raise Transient(str(e))
    kw = KW_RE.search(page)
    if not kw or 'gd_name' not in page:
        # 상품 정보가 없는 페이지(판매 중지·안내 페이지 등)
        raise Missing()
    words = [w.strip() for w in html.unescape(kw.group(1)).split(',')]
    isbn = next((w for w in words if ISBN_RE.fullmatch(w)), '')
    flag = FLAG_RE.search(page)   # 끝까지 받았을 때만 보인다
    ok = (flag.group(1) == 'Y') if flag else (ICON in page)
    return {'pass': ok, 'tag': TAG in words, 'isbn': isbn}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--count', action='store_true')
    ap.add_argument('--limit', type=int, default=0)
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--refresh', action='store_true')
    ap.add_argument('--sleep', type=float, default=0.8)
    ap.add_argument('--workers', type=int, default=2)
    a = ap.parse_args()

    out = load_out()
    out.setdefault('note', 'pass: 예스24 상품 페이지에 청년패스 아이콘이 있는지(=청년패스로 결제 가능). '
                           'tag: #청년패스 해시태그(hashTagNo ' + TAG_NO + ') 여부(참고). isbn: ISBN-13. '
                           'tools/fetch_youthpass.py 가 채운다. 값은 확인한 날(checked) 기준.')
    out.setdefault('books', {})
    out.setdefault('misses', {})
    ids = goods_ids()
    todo = [g for g in ids if a.refresh or (g not in out['books'] and g not in out['misses'])]
    if a.count:
        print(len(todo))
        return
    if a.limit:
        todo = todo[:a.limit]
    today = datetime.date.today().isoformat()
    n_pass = n_err = 0

    def job(gid):
        try:
            return gid, fetch(gid), None
        except (Missing, Transient) as e:
            return gid, None, e
        finally:
            time.sleep(a.sleep)

    with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, a.workers)) as pool:
        for i, (gid, r, err) in enumerate(pool.map(job, todo), 1):
            if isinstance(err, Missing):
                out['misses'][gid] = ids[gid]
                out['books'].pop(gid, None)
                print('%d/%d %s 없음 (%s)' % (i, len(todo), gid, ids[gid]), flush=True)
            elif err is not None:
                n_err += 1
                print('%d/%d %s 일시 오류 %s' % (i, len(todo), gid, err), file=sys.stderr, flush=True)
                if n_err >= 30:
                    print('오류가 너무 많아 멈춘다', file=sys.stderr)
                    pool.shutdown(wait=False, cancel_futures=True)
                    break
            else:
                r['checked'] = today
                out['books'][gid] = r
                out['misses'].pop(gid, None)
                n_pass += r['pass']
                print('%d/%d %s %s %s %s' % (i, len(todo), gid, '✔' if r['pass'] else '·', r['isbn'], ids[gid]),
                      flush=True)
            if not a.dry_run and i % SAVE_EVERY == 0:
                save_out(out)
    if not a.dry_run:
        save_out(out)
    total = sum(1 for v in out['books'].values() if v['pass'])
    print('이번에 %d권 중 %d권 청년패스 대상 · 전체 대상 %d권 / 확인 %d권' % (len(todo), n_pass, total, len(out['books'])))


if __name__ == '__main__':
    main()
