#!/usr/bin/env python3
"""셀럽 페이지 공유 미리보기(OG) 이미지를 만든다.

카카오톡·X·검색 결과에 링크를 걸면 뜨는 1200×630 이미지다. 예전엔 외부 사이트의
셀럽 사진을 그대로 썼는데, 그 주소가 깨지면 미리보기가 비고 초상권 부담도 있었다.
그래서 이름 · 권수 · 대표 책 제목 · 표지 5장으로 사이트가 직접 카드를 그린다.

    og/<짧은 주소>.jpg     이미지 (짧은 주소 = data/shortlinks.json 의 celeb 값)
    data/og.json           셀럽 → {file, fp}. generate.py 가 og:image 로 쓴다.

카드 내용(이름·권수·대표 책·표지 주소)의 지문(fp)이 같으면 다시 그리지 않는다.
표지를 못 받은 칸은 제목을 적은 색 표지로 그리고, 다음 실행 때 다시 받아 본다.

    python3 tools/make_og.py                 # 바뀐 셀럽만
    python3 tools/make_og.py --only 'RM(BTS)' --force
    python3 tools/make_og.py --offline       # 표지를 받지 않고 색 표지로만 (확인용)

generate.py 다음에 돌린다 (data.json 을 읽는다). 워크플로는 tools/build_site.sh 참고.
"""
import argparse, colorsys, hashlib, io, json, os, re, sys, urllib.error, urllib.request

from concurrent.futures import ThreadPoolExecutor

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, 'og')
INDEX = os.path.join(ROOT, 'data', 'og.json')
FONT_BOLD = os.path.join(ROOT, 'assets', 'fonts', 'kopubworld-dotum-bold.woff2')
FONT_MED = os.path.join(ROOT, 'assets', 'fonts', 'kopubworld-dotum-medium.woff2')

# 그림을 바꾸면 올린다 — 모든 카드를 다시 그린다
VERSION = 1

W, H = 1200, 630
PAPER = (252, 250, 245)
INK = (0, 0, 0)
YELLOW = (253, 224, 71)
GREY = (85, 85, 85)

# 표지 자리: (x, y, 너비, 높이, 기울기 °, 시계방향 +). 첫 칸이 가운데 큰 표지.
SLOTS = [
    (770, 80, 210, 300, 3),
    (610, 130, 150, 215, -7),
    (970, 140, 150, 215, 8),
    (680, 370, 150, 215, -3),
    (930, 380, 150, 215, 5),
]

UA = 'favorbook-og/1.0 (https://favorbook.co.kr)'
_fonts = {}


def font(size, bold=True):
    k = (size, bold)
    if k not in _fonts:
        _fonts[k] = ImageFont.truetype(FONT_BOLD if bold else FONT_MED, size)
    return _fonts[k]


def title_sort_key(title):
    return re.sub(r'\s+', '', title or '').lower()


def tint(title):
    """generate.py spine_tint()와 같은 색"""
    h = 0
    for ch in (title or ''):
        h = (h * 31 + ord(ch)) & 0xFFFFFFFF
    hue, sat, lig = h % 360, 32 + (h >> 9) % 26, 26 + (h >> 17) % 22
    r, g, b = colorsys.hls_to_rgb(hue / 360, lig / 100, sat / 100)
    return (round(r * 255), round(g * 255), round(b * 255))


def text_w(draw, s, f):
    return draw.textlength(s, font=f)


def fit(draw, s, f, width):
    """width 안에 들어가게 끝을 … 로 자른다"""
    if text_w(draw, s, f) <= width:
        return s
    while s and text_w(draw, s + '…', f) > width:
        s = s[:-1]
    return s + '…'


def wrap(draw, s, f, width, max_lines):
    """글자 단위로 줄을 나눈다. 넘치면 마지막 줄 끝을 … 로"""
    lines, cur = [], ''
    for ch in s:
        if cur and text_w(draw, cur + ch, f) > width:
            lines.append(cur.rstrip())
            cur = '' if ch == ' ' else ch
        else:
            cur += ch
    if cur.strip():
        lines.append(cur.rstrip())
    if len(lines) > max_lines:
        last = lines[max_lines - 1]
        while last and text_w(draw, last + '…', f) > width:
            last = last[:-1]
        lines = lines[:max_lines - 1] + [last + '…']
    return lines


_cover_cache = {}
_cover_gone = set()   # 표지가 아예 없는 주소 (404, '이미지 준비중') — 다시 받아 봐도 소용없다


def fetch_cover(url, offline):
    if offline or not (url or '').startswith('http'):
        return None
    if url in _cover_cache:
        return _cover_cache[url]
    img = None
    try:
        req = urllib.request.Request(url, headers={'User-Agent': UA})
        with urllib.request.urlopen(req, timeout=15) as r:
            img = Image.open(io.BytesIO(r.read())).convert('RGB')
        # 예스24가 표지 없는 책에 주는 '이미지 준비중' 그림은 정사각형에 가깝다 → 버린다
        if img.width / img.height > 0.9:
            img = None
            _cover_gone.add(url)
    except urllib.error.HTTPError as e:
        if e.code in (404, 410):
            _cover_gone.add(url)
        print('  표지 못 받음:', url, e.code, file=sys.stderr)
    except Exception as e:
        print('  표지 못 받음:', url, type(e).__name__, file=sys.stderr)
    _cover_cache[url] = img
    return img


def cover_tile(book, w, h, offline):
    """테두리·그림자까지 붙은 표지 한 장 (RGBA). 표지를 못 받으면 (tile, False)."""
    img = fetch_cover(book.get('coverUrl'), offline)
    face = Image.new('RGB', (w, h), tint(book['title']))
    ok = img is not None
    if ok:
        # 표지 비율을 맞춰 가운데를 자른다
        r = max(w / img.width, h / img.height)
        img = img.resize((max(w, round(img.width * r)), max(h, round(img.height * r))), Image.LANCZOS)
        x, y = (img.width - w) // 2, (img.height - h) // 2
        face = img.crop((x, y, x + w, y + h))
    else:
        d = ImageDraw.Draw(face)
        f = font(18 if w > 180 else 16)
        for i, line in enumerate(wrap(d, book['title'], f, w - 24, 4)):
            d.text((12, 12 + i * 24), line, font=f, fill=(255, 255, 255))
        fa = font(12, bold=False)
        d.text((12, h - 26), fit(d, book.get('author') or '', fa, w - 24), font=fa, fill=(235, 235, 235))
    B, S = 3, 7   # 테두리, 그림자
    tile = Image.new('RGBA', (w + 2 * B + S, h + 2 * B + S), (0, 0, 0, 0))
    td = ImageDraw.Draw(tile)
    td.rectangle((S, S, w + 2 * B + S - 1, h + 2 * B + S - 1), fill=INK)
    td.rectangle((0, 0, w + 2 * B - 1, h + 2 * B - 1), fill=INK)
    tile.paste(face, (B, B))
    return tile, ok


def picks_for(books, read_count):
    seen, out = set(), []
    for b in books:
        t = b['title'].strip()
        if t and t not in seen:
            seen.add(t)
            out.append(b)
    return sorted(out, key=lambda b: (-read_count.get(b['title'].strip(), 0), title_sort_key(b['title'])))


def render(name, books, offline):
    """→ (Image, 모든 표지를 받았는지)"""
    im = Image.new('RGB', (W, H), PAPER)
    d = ImageDraw.Draw(im)

    # 오른쪽: 표지 (아래 칸부터 깔고 가운데 큰 표지를 맨 위에)
    all_ok = True
    covers = books[:len(SLOTS)]
    if len(covers) == 1:
        slots = [(800, 130, 250, 360, 3)]
    elif len(covers) <= 3:
        # 윗줄만 쓰면 아래가 비어 보여서 가운데로 내린다
        slots = [(x, y + 90, w, h, a) for x, y, w, h, a in SLOTS]
    else:
        slots = SLOTS
    for i in reversed(range(len(covers))):
        x, y, w, h, ang = slots[i]
        tile, ok = cover_tile(covers[i], w, h, offline)
        _u = covers[i].get('coverUrl') or ''
        all_ok = all_ok and (ok or not _u.startswith('http') or _u in _cover_gone)
        rot = tile.rotate(-ang, resample=Image.BICUBIC, expand=True)
        im.paste(rot, (x - (rot.width - tile.width) // 2, y - (rot.height - tile.height) // 2), rot)

    # 왼쪽: 글자
    LX, LW = 66, 500
    f_brand = font(24)
    bw = text_w(d, '최애의 독서', f_brand)
    d.rectangle((LX + 4, 58 + 4, LX + bw + 28 + 4, 58 + 44 + 4), fill=INK)
    d.rectangle((LX, 58, LX + bw + 28, 58 + 44), fill=YELLOW, outline=INK, width=3)
    d.text((LX + 14, 66), '최애의 독서', font=f_brand, fill=INK)

    m = re.match(r'^(.*?)\s*\(([^)]*)\)\s*$', name)
    main, group = (m.group(1), m.group(2)) if m and m.group(1) else (name, '')
    size = 84
    while size > 44 and text_w(d, main, font(size)) > LW:
        size -= 4
    y = 136
    d.text((LX, y), fit(d, main, font(size), LW), font=font(size), fill=INK)
    y += size + 14
    if group:
        d.text((LX, y), fit(d, group, font(30, bold=False), LW), font=font(30, bold=False), fill=GREY)
        y += 46
    else:
        y += 6

    f_sub = font(34)
    sub = '추천 책 · 읽은 책'
    d.text((LX, y), sub, font=f_sub, fill=INK)
    n_txt = str(len(books)) + '권'
    nx = LX + text_w(d, sub, f_sub) + 14
    d.rectangle((nx, y - 2, nx + text_w(d, n_txt, f_sub) + 20, y + 42), fill=INK)
    d.text((nx + 10, y), n_txt, font=f_sub, fill=YELLOW)
    y += 70

    f_t = font(26, bold=False)
    for b in books[:3]:
        if y > 520:
            break
        d.text((LX, y), fit(d, '『' + b['title'].strip() + '』', f_t, LW), font=f_t, fill=(51, 51, 51))
        y += 42
    if len(books) > 3 and y <= 520:
        d.text((LX, y), '외 ' + str(len(books) - 3) + '권', font=font(22, bold=False), fill=GREY)

    d.text((LX, 556), 'favorbook.co.kr', font=font(24), fill=GREY)
    d.rectangle((0, 0, W - 1, H - 1), outline=INK, width=10)
    return im, all_ok


# 사이트 대표 카드 — 메인·목록 페이지처럼 셀럽 한 명이 아닌 페이지의 og:image.
# X는 카드 왼쪽 아래에 제목을 덮어 쓰므로 그 자리엔 중요한 글자를 두지 않는다.
SITE_CARDS = {'ko': 'og/_site.jpg', 'en': 'og/_site-en.jpg'}
FONT_EN = os.path.join(ROOT, 'assets', 'fonts', 'space-grotesk-latin.woff2')


def font_en(size, weight='Bold'):
    k = ('en', size, weight)
    if k not in _fonts:
        f = ImageFont.truetype(FONT_EN, size)
        f.set_variation_by_name(weight)
        _fonts[k] = f
    return _fonts[k]


def render_site(lang, n_celebs, n_books, covers, offline):
    """→ (Image, 모든 표지를 받았는지)"""
    im = Image.new('RGB', (W, H), PAPER)
    d = ImageDraw.Draw(im)

    all_ok = True
    for i in reversed(range(min(len(covers), len(SLOTS)))):
        x, y, w, h, ang = SLOTS[i]
        tile, ok = cover_tile(covers[i], w, h, offline)
        all_ok = all_ok and ok
        rot = tile.rotate(-ang, resample=Image.BICUBIC, expand=True)
        im.paste(rot, (x - (rot.width - tile.width) // 2, y - (rot.height - tile.height) // 2), rot)

    ko = lang == 'ko'
    LX, LW = 66, 520
    # 수는 내림해서 적는다 — 셀럽 한 명 늘 때마다 카드를 다시 그리지 않게
    celebs_txt = f'{n_celebs // 10 * 10:,}+'
    books_txt = f'{n_books // 100 * 100:,}+'
    if ko:
        brand, f_brand = '최애의 독서', font(24)
        head, f_head = ['내 최애는', '무슨 책을 읽을까?'], font(68)
        rows = [('아이돌·배우·셀럽', celebs_txt.replace('+', '명+')),
                ('읽은 책·추천 책', books_txt.replace('+', '권+'))]
        f_row, f_url = font(32), font(22, bold=False)
        lead = '인터뷰·방송·SNS 출처와 함께'
        f_lead = font(24, bold=False)
    else:
        brand, f_brand = 'Favorbook', font_en(26)
        head, f_head = ['What K-pop idols', '& K-drama actors', 'are reading'], font_en(56)
        rows = [('Korean stars', celebs_txt), ('books, with sources', books_txt)]
        f_row, f_url = font_en(30, 'Medium'), font_en(22, 'Medium')
        lead, f_lead = '', None

    # 배지 + 주소
    bw = text_w(d, brand, f_brand)
    d.rectangle((LX + 4, 58 + 4, LX + bw + 28 + 4, 58 + 44 + 4), fill=INK)
    d.rectangle((LX, 58, LX + bw + 28, 58 + 44), fill=YELLOW, outline=INK, width=3)
    d.text((LX + 14, 80), brand, font=f_brand, fill=INK, anchor='lm')
    d.text((LX + bw + 52, 80), 'favorbook.co.kr', font=f_url, fill=GREY, anchor='lm')

    # 큰 제목 — 넘치면 줄인다
    size = f_head.size
    mk = (lambda s: font(s)) if ko else (lambda s: font_en(s))
    while size > 40 and max(text_w(d, s, mk(size)) for s in head) > LW:
        size -= 2
    fh = mk(size)
    y = 150
    for s in head:
        d.text((LX, y), s, font=fh, fill=INK)
        y += round(size * 1.22)
    y += 30

    # 숫자 줄: 한국어는 '설명 [수]', 영어는 '[수] 설명'
    for label, num in rows:
        nw = text_w(d, num, f_row)
        if ko:
            d.text((LX, y), label, font=f_row, fill=INK)
            nx = LX + text_w(d, label, f_row) + 14
            d.rectangle((nx, y - 4, nx + nw + 20, y + 42), fill=INK)
            d.text((nx + 10, y), num, font=f_row, fill=YELLOW)
        else:
            d.rectangle((LX, y - 4, LX + nw + 20, y + 40), fill=INK)
            d.text((LX + 10, y), num, font=f_row, fill=YELLOW)
            d.text((LX + nw + 34, y), label, font=f_row, fill=INK)
        y += 58
    if lead:
        d.text((LX, y + 6), lead, font=f_lead, fill=GREY)

    d.rectangle((0, 0, W - 1, H - 1), outline=INK, width=10)
    return im, all_ok


def make_site_cards(celebs, read_count, offline):
    """사이트 대표 카드 두 장. 가장 많이 읽힌 책 표지 5장을 깐다.
    표지를 다 받았을 때만 덮어쓴다 (한 장이라도 빠지면 있던 카드를 둔다)."""
    pool = [b for info in celebs.values() for b in info['books']]
    cands, seen = [], set()
    for b in sorted(pool, key=lambda b: (-read_count.get(b['title'].strip(), 0), title_sort_key(b['title']))):
        t = b['title'].strip()
        if t in seen or not (b.get('coverUrl') or '').startswith('http'):
            continue
        seen.add(t)
        cands.append(b)
        if len(cands) == 3 * len(SLOTS):
            break
    # 받히는 표지부터 쓴다. 다 안 받히면(표지 서버 장애) 앞에서부터 색 표지로.
    if not offline:
        with ThreadPoolExecutor(max_workers=8) as ex:
            list(ex.map(lambda b: fetch_cover(b['coverUrl'], False), cands))
    got = [b for b in cands if _cover_cache.get(b['coverUrl']) is not None]
    covers = (got if len(got) >= len(SLOTS) else cands)[:len(SLOTS)]
    n_books = len({b['title'].strip() for b in pool})
    changed = 0
    for lang, rel in SITE_CARDS.items():
        im, ok = render_site(lang, len(celebs), n_books, covers, offline)
        path = os.path.join(ROOT, rel)
        if not ok and os.path.exists(path):
            continue
        buf = io.BytesIO()
        im.save(buf, 'JPEG', quality=88, optimize=True, progressive=True)
        old = open(path, 'rb').read() if os.path.exists(path) else b''
        if buf.getvalue() != old:
            with open(path, 'wb') as f:
                f.write(buf.getvalue())
            changed += 1
    return changed


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--only', help='이 셀럽만')
    ap.add_argument('--force', action='store_true', help='지문이 같아도 다시 그린다')
    ap.add_argument('--offline', action='store_true', help='표지를 받지 않는다 (색 표지)')
    ap.add_argument('--limit', type=int, default=0, help='이번에 그릴 최대 장수 (0=무제한)')
    args = ap.parse_args()

    with open(os.path.join(ROOT, 'data.json'), encoding='utf-8') as f:
        celebs = json.load(f)['celebs']
    with open(os.path.join(ROOT, 'data', 'shortlinks.json'), encoding='utf-8') as f:
        shorts = json.load(f).get('celeb', {})
    try:
        with open(INDEX, encoding='utf-8') as f:
            index = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        index = {}

    read_count = {}
    for info in celebs.values():
        for t in {b['title'].strip() for b in info['books']}:
            read_count[t] = read_count.get(t, 0) + 1

    # 다시 그릴 셀럽부터 고른다
    todo = []
    for name in sorted(celebs):
        if args.only and name != args.only:
            continue
        slug = shorts.get(name)
        if not slug:
            continue
        books = picks_for(celebs[name]['books'], read_count)
        if not books:
            continue
        fp = hashlib.sha1(json.dumps(
            [VERSION, name, len(books), [[b['title'], b.get('author'), b.get('coverUrl')] for b in books[:5]]],
            ensure_ascii=False).encode('utf-8')).hexdigest()[:12]
        rel = 'og/' + slug + '.jpg'
        prev = index.get(name) or {}
        if (not args.force and prev.get('fp') == fp and prev.get('file') == rel
                and prev.get('complete') and os.path.exists(os.path.join(ROOT, rel))):
            continue
        todo.append((name, books, fp, rel))
    if args.limit:
        todo = todo[:args.limit]

    # 표지는 한꺼번에 나눠 받는다 (처음엔 2천 장이 넘는다)
    if not args.offline:
        urls = sorted({b.get('coverUrl') for _n, books, _f, _r in todo for b in books[:len(SLOTS)]
                       if (b.get('coverUrl') or '').startswith('http')})
        with ThreadPoolExecutor(max_workers=8) as ex:
            list(ex.map(lambda u: fetch_cover(u, False), urls))

    os.makedirs(OUT_DIR, exist_ok=True)
    for name, books, fp, rel in todo:
        im, ok = render(name, books, args.offline)
        im.save(os.path.join(ROOT, rel), 'JPEG', quality=85, optimize=True, progressive=True)
        index[name] = {'file': rel, 'fp': fp, 'complete': ok}
    drawn = len(todo)
    if not args.only:
        drawn += make_site_cards(celebs, read_count, args.offline)

    # 사라진 셀럽의 카드는 지운다
    for name in [n for n in index if n not in celebs]:
        p = os.path.join(ROOT, index[name].get('file', ''))
        if os.path.isfile(p):
            os.remove(p)
        del index[name]

    with open(INDEX, 'w', encoding='utf-8') as f:
        json.dump(index, f, ensure_ascii=False, indent=1, sort_keys=True)
        f.write('\n')
    print(f'✅ OG 이미지: {drawn}장 새로 그림 (전체 {len(index)}장)')


if __name__ == '__main__':
    main()
