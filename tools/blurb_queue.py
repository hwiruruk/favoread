#!/usr/bin/env python3
"""책 한 줄 소개(한·영) 작업 대기열을 만든다.

인기순(읽은 셀럽 수 많은 순)으로 아직 소개가 없는 책을 N권 골라, 예스24 '책소개' 원문을
내려받아 JSON 으로 내보낸다. 원문은 요약 재료일 뿐 그대로 싣지 않는다.

    python3 tools/blurb_queue.py --limit 200 --out /tmp/queue.json

소개는 data/blurbs.json 에 책 제목(한국어 도서명)을 키로 쌓는다.
    { "books": { "<도서명>": {"ko": "1~2줄", "en": "1~2 lines"} } }
tools/blurb_merge.py 가 작업 결과를 이 파일에 합친다.
"""
import argparse
import collections
import html
import json
import os
import re
import time
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'data.json')
INFO = os.path.join(ROOT, 'data', 'bookinfo.json')
BLURBS = os.path.join(ROOT, 'data', 'blurbs.json')
UA = {'User-Agent': 'Mozilla/5.0 (favorbook-blurbs)'}


def load_blurbs():
    if os.path.exists(BLURBS):
        return json.load(open(BLURBS, encoding='utf-8')).get('books', {})
    return {}


def popularity():
    d = json.load(open(DATA, encoding='utf-8'))
    readers = collections.defaultdict(set)
    meta = {}
    for name, c in d['celebs'].items():
        for b in c.get('books', []):
            readers[b['title']].add(name)
            meta.setdefault(b['title'], b)
    return sorted(readers, key=lambda t: (-len(readers[t]), t)), readers, meta


def fetch_blurb(item_id):
    req = urllib.request.Request('https://www.yes24.com/product/goods/%s' % item_id, headers=UA)
    t = urllib.request.urlopen(req, timeout=25).read().decode('utf-8', 'ignore')
    i = t.find('책소개')
    seg = t[i:i + 8000] if i >= 0 else ''
    m = re.search(r'class="infoWrap_txt">(.*?)</div>', seg, re.S)
    txt = m.group(1) if m else ''
    if not txt:
        m = re.search(r'property="og:description" content="([^"]*)"', t)
        txt = m.group(1) if m else ''
    txt = re.sub(r'<br\s*/?>', ' ', txt)
    txt = re.sub(r'<[^>]+>', '', txt)
    return re.sub(r'\s+', ' ', html.unescape(txt)).strip()[:900]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--limit', type=int, default=200)
    ap.add_argument('--out', default='/tmp/blurb_queue.json')
    ap.add_argument('--sleep', type=float, default=0.4)
    a = ap.parse_args()
    done = load_blurbs()
    info = json.load(open(INFO, encoding='utf-8'))['books']
    order, readers, meta = popularity()
    todo = [t for t in order if t not in done]
    print('남은 책', len(todo), '/ 전체', len(order))
    out = []
    for t in todo:
        if len(out) >= a.limit:
            break
        b = meta[t]
        item = (info.get(t) or {}).get('itemId')
        src = ''
        if item:
            try:
                src = fetch_blurb(item)
            except Exception as e:  # 일시 오류는 원문 없이 제목만으로 진행
                print('  원문 실패', t, e)
            time.sleep(a.sleep)
        out.append({'title': t, 'title_en': b.get('title_en', ''), 'author': b.get('author', ''),
                    'author_en': b.get('author_en', ''), 'readers': len(readers[t]), 'source': src})
    json.dump(out, open(a.out, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('대기열', len(out), '권 →', a.out, '(원문 있음', sum(1 for x in out if x['source']), ')')


if __name__ == '__main__':
    main()
