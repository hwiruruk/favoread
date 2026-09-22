#!/usr/bin/env python3
"""data.csv의 알라딘 도서 링크·표지를 예스24로 바꾼다.

책등은 이미 예스24로 옮겼다(tools/fetch_spines.py). 그때 제목마다 찾아둔
예스24 상품 번호가 data/spines.json에 남아 있으므로, 조회를 다시 하지 않고
그 번호만으로 링크와 표지를 만들 수 있다.

    링크  https://www.yes24.com/product/goods/91901136
    표지  https://image.yes24.com/goods/91901136/L
    책등  https://image.yes24.com/goods/91901136/side   (generate.py가 만든다)

상품 번호는 두 곳에서 모은다.
  · spines  — 책등까지 찾은 책
  · misses  — "예스24에 책등 이미지 없음 (goods N)". 책등은 없어도 상품은
              있으니 링크와 표지는 만들 수 있다

바꾸는 칸은 '도서 정보'와 '도서 이미지' 둘뿐이고, 값에 aladin이 들어 있을
때만 손댄다. 빈 칸이나 '검색 결과 없음' 같은 메모는 그대로 둔다 —
비어 있던 걸 채우는 건 이 스크립트의 일이 아니다.

    python3 tools/relink_yes24.py --dry-run   # 무엇이 바뀌는지만 본다
    python3 tools/relink_yes24.py             # data.csv를 고친다
"""

import csv
import io
import json
import os
import re
import sys

CSV_PATH = 'data.csv'
SPINES_PATH = os.path.join('data', 'spines.json')

GOODS_IN_URL = re.compile(r'yes24\.com/(?:product/)?goods/(?:detail/)?(\d+)', re.I)
GOODS_IN_MISS = re.compile(r'goods (\d+)')


def product_url(goods_id):
    return 'https://www.yes24.com/product/goods/' + goods_id


def cover_url(goods_id):
    return 'https://image.yes24.com/goods/' + goods_id + '/L'


def load_goods_ids():
    """제목 → 예스24 상품 번호. spines가 misses보다 우선한다."""
    with open(SPINES_PATH, encoding='utf-8') as fp:
        raw = json.load(fp) or {}
    ids = {}
    for title, reason in (raw.get('misses') or {}).items():
        m = GOODS_IN_MISS.search(str(reason))
        if m:
            ids[str(title).strip()] = m.group(1)
    for title, value in (raw.get('spines') or {}).items():
        v = str(value).strip()
        m = GOODS_IN_URL.search(v)
        if m:
            ids[str(title).strip()] = m.group(1)
        elif v.isdigit():
            ids[str(title).strip()] = v
    return ids


def find_col(headers, keywords, fallback):
    """generate.py와 같은 방식으로 칸을 찾는다."""
    for i, h in enumerate(headers):
        if any(w in h.lower() for w in keywords):
            return i
    return fallback


def main():
    dry_run = '--dry-run' in sys.argv[1:]

    ids = load_goods_ids()
    print('예스24 상품 번호를 아는 제목: %d개' % len(ids))

    with open(CSV_PATH, encoding='utf-8', newline='') as fp:
        rows = list(csv.reader(io.StringIO(fp.read())))
    headers = rows[0]
    C_NAME = find_col(headers, ['연예인', '이름', '인물'], 0)
    C_TITLE = find_col(headers, ['도서명', '제목', '책'], 1)
    C_LINK = find_col(headers, ['도서 정보', '링크', 'url'], 5)
    C_COVER = find_col(headers, ['도서 이미지', '표지'], 6)

    n_link = n_cover = 0
    leftovers = []

    for row in rows[1:]:
        if not row or not row[C_NAME].strip():
            continue
        if len(row) <= C_TITLE or not row[C_TITLE].strip():
            continue
        title = row[C_TITLE].strip()
        link = row[C_LINK].strip() if len(row) > C_LINK else ''
        cover = row[C_COVER].strip() if len(row) > C_COVER else ''
        if 'aladin' not in link.lower() and 'aladin' not in cover.lower():
            continue

        goods_id = ids.get(title)
        if not goods_id:
            leftovers.append((row[C_NAME].strip(), title, link or '(빈 칸)'))
            continue

        if 'aladin' in link.lower():
            row[C_LINK] = product_url(goods_id)
            n_link += 1
        if 'aladin' in cover.lower():
            row[C_COVER] = cover_url(goods_id)
            n_cover += 1

    print('바꾼 링크 %d건 · 바꾼 표지 %d건' % (n_link, n_cover))
    if leftovers:
        print('\n상품 번호를 몰라 알라딘으로 남긴 %d건:' % len(leftovers))
        for name, title, link in leftovers:
            print('  %s | %s | %s' % (name, title, link[:70]))
        print('\n  예스24에서 찾아 data/spines.json의 spines에 상품 번호를 적고')
        print('  다시 돌리면 된다. 책등이 없는 책이면 misses 쪽 문구에 (goods N)이')
        print('  들어가도 읽는다.')

    if dry_run:
        print('\n--dry-run — data.csv는 그대로 둔다.')
        return

    out = io.StringIO(newline='')
    csv.writer(out, lineterminator='\n').writerows(rows)
    with open(CSV_PATH, 'w', encoding='utf-8', newline='') as fp:
        fp.write(out.getvalue())
    print('\n✅ %s 갱신. 사이트에 반영하려면 python3 generate.py' % CSV_PATH)


if __name__ == '__main__':
    main()
