#!/usr/bin/env python3
"""책등 사진이 없는 책의 표지 대표색을 뽑아 data/cover_colors.json 에 채운다.

예스24에 책등 사진이 없는 책은 색 책등으로 그린다. 예전에는 표지를 세로로
잘라 책등 자리에 깔았는데, 표지 가운데 그림·글자가 토막 나서 지저분해 보였다.
그래서 표지에서 가장 많이 쓰인 색 하나를 뽑아 그 색으로 책등을 칠한다.

    표지 ──(작게 줄여 색 6개로 묶기)──▶ 가장 넓게 칠해진 색 ──▶ "#rrggbb"

data.json 의 책 중 spineUrl 이 없는 책만 본다(generate.py 가 먼저 돌아야 한다).
한 번 뽑은 표지는 다시 받지 않는다 — 키가 표지 URL이라 표지가 바뀌면 새로 뽑는다.
표지가 아예 없는 주소(404, '이미지 준비중' 그림)는 null 로 남겨 다시 받지 않는다.
연결이 잠깐 흔들린 표지는 기록하지 않고 다음 빌드 때 다시 시도한다.

실행
    python3 tools/cover_colors.py            # tools/build_site.sh 가 부른다
    python3 tools/cover_colors.py --refresh  # 이미 뽑은 색도 다시 뽑기
"""
import argparse
import io
import json
import os
import sys
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_JSON = os.path.join(ROOT, 'data.json')
OUT_PATH = os.path.join(ROOT, 'data', 'cover_colors.json')
UA = 'Mozilla/5.0 (compatible; favoread-cover-colors/1.0)'


def dominant_color(img):
    """표지에서 가장 넓게 칠해진 색. 가장자리 테두리·스캔 여백은 조금 떼고 본다."""
    img = img.convert('RGB')
    w, h = img.size
    dx, dy = max(1, w // 25), max(1, h // 25)
    img = img.crop((dx, dy, w - dx, h - dy)).resize((60, 90))
    q = img.quantize(colors=6, method=Image.Quantize.MEDIANCUT)
    pal = q.getpalette()
    count, idx = max(q.getcolors())
    r, g, b = pal[idx * 3:idx * 3 + 3]
    return '#%02x%02x%02x' % (r, g, b)


def fetch(url):
    """(url, 색 | None, 확정 여부). 확정이 아니면 기록하지 않는다."""
    try:
        req = urllib.request.Request(url, headers={'User-Agent': UA})
        with urllib.request.urlopen(req, timeout=15) as r:
            img = Image.open(io.BytesIO(r.read()))
            img.load()
    except urllib.error.HTTPError as e:
        return url, None, e.code in (403, 404, 410)
    except Exception:
        return url, None, False
    # 예스24가 표지 없는 책에 주는 '이미지 준비중' 그림은 정사각형에 가깝다
    if img.width / img.height > 0.9:
        return url, None, True
    return url, dominant_color(img), True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--refresh', action='store_true')
    args = ap.parse_args()

    with open(DATA_JSON, encoding='utf-8') as f:
        celebs = json.load(f)['celebs']
    want = set()
    for info in celebs.values():
        for b in info.get('books', []):
            u = (b.get('coverUrl') or '').strip()
            if u.startswith('http') and not b.get('spineUrl'):
                want.add(u)

    colors = {}
    if os.path.exists(OUT_PATH):
        try:
            with open(OUT_PATH, encoding='utf-8') as f:
                colors = json.load(f).get('colors') or {}
        except (json.JSONDecodeError, OSError) as e:
            print('⚠️ %s 를 읽지 못해 새로 만듭니다: %s' % (OUT_PATH, e), file=sys.stderr)

    todo = sorted(u for u in want if args.refresh or u not in colors)
    print('표지 대표색 — 책등 사진 없는 표지 %d개 · 이번에 받을 표지 %d개' % (len(want), len(todo)))

    got = miss = net = 0
    if todo:
        with ThreadPoolExecutor(max_workers=8) as ex:
            for url, color, sure in ex.map(fetch, todo):
                if color:
                    colors[url] = color
                    got += 1
                elif sure:
                    colors[url] = None
                    miss += 1
                else:
                    net += 1
        print('  뽑음 %d · 표지 없음 %d · 연결 실패 %d(다음에 다시)' % (got, miss, net))

    # 데이터에서 빠진 책은 지운다. 책등 사진이 새로 생긴 책도 여기서 빠진다.
    colors = {u: colors[u] for u in sorted(colors) if u in want}
    out = {
        'note': '책등 사진이 없는 책의 표지 대표색. 키는 표지 URL, null은 표지를 못 받는 주소. '
                'tools/cover_colors.py 가 채운다.',
        'colors': colors,
    }
    text = json.dumps(out, ensure_ascii=False, indent=1) + '\n'
    old = None
    if os.path.exists(OUT_PATH):
        with open(OUT_PATH, encoding='utf-8') as f:
            old = f.read()
    if text != old:
        os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
        with open(OUT_PATH, 'w', encoding='utf-8') as f:
            f.write(text)
        print('✅ %s 저장 (%d개)' % (os.path.relpath(OUT_PATH, ROOT), len(colors)))


if __name__ == '__main__':
    main()
