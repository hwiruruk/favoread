#!/usr/bin/env python3
"""작업 결과를 data/blurbs.json 에 합친다.

    python3 tools/blurb_merge.py /tmp/blurbs_today.json

입력: [{"title": "도서명", "ko": "한국어 1~2줄", "en": "English 1-2 lines"}, ...]
이미 있는 책은 덮어쓰지 않는다. ko/en 이 비었거나 너무 길면 건너뛴다.
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BLURBS = os.path.join(ROOT, 'data', 'blurbs.json')


def main():
    new = json.load(open(sys.argv[1], encoding='utf-8'))
    cur = {'note': '책 한 줄 소개(한·영). tools/blurb_queue.py 로 대기열을 만들고 blurb_merge.py 로 합친다. 손으로 고쳐도 된다.',
           'books': {}}
    if os.path.exists(BLURBS):
        cur = json.load(open(BLURBS, encoding='utf-8'))
    added = skipped = 0
    for x in new:
        t, ko, en = x.get('title'), (x.get('ko') or '').strip(), (x.get('en') or '').strip()
        if not t or t in cur['books'] or not ko or not en or len(ko) > 160 or len(en) > 320:
            skipped += 1
            continue
        cur['books'][t] = {'ko': ko, 'en': en}
        added += 1
    cur['books'] = dict(sorted(cur['books'].items()))
    json.dump(cur, open(BLURBS, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('추가', added, '건너뜀', skipped, '누적', len(cur['books']))


if __name__ == '__main__':
    main()
