#!/usr/bin/env python3
"""공유 미리보기(OG) 이미지를 만든다.

카카오톡·X·검색 결과에 링크를 걸면 뜨는 1200×630 이미지다. 예전엔 외부 사이트의
셀럽 사진을 그대로 썼는데, 그 주소가 깨지면 미리보기가 비고 초상권 부담도 있었다.
그래서 사이트가 직접 '리딩 리스트' 카드를 그린다 — 왼쪽에 표지 6장 격자,
오른쪽에 큰 글씨('카리나의 독서' / "KARINA'S READING LIST")와 권수.

    og/<짧은 주소>.jpg      셀럽 카드 (짧은 주소 = data/shortlinks.json 의 celeb 값)
    og/en/<짧은 주소>.jpg   영문 셀럽 카드 (영문 페이지가 있는 셀럽만)
    og/_site.jpg, og/_site-en.jpg   사이트 대표 카드 (메인·목록 페이지)
    data/og.json            셀럽 → {file, fp, file_en, fp_en}. generate.py 가 og:image 로 쓴다.

카드 내용(이름·권수·표지 주소)의 지문(fp)이 같으면 다시 그리지 않는다.
표지를 못 받은 칸은 제목을 적은 색 표지로 그리고, 다음 실행 때 다시 받아 본다.

    python3 tools/make_og.py                 # 바뀐 셀럽만
    python3 tools/make_og.py --only 'RM(BTS)' --force
    python3 tools/make_og.py --offline       # 표지를 받지 않고 색 표지로만 (확인용)

generate.py 다음에 돌린다 (data.json 을 읽는다). 워크플로는 tools/build_site.sh 참고.
"""
import argparse, colorsys, datetime, hashlib, io, json, os, random, re, sys, urllib.error, urllib.request

from concurrent.futures import ThreadPoolExecutor

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, 'og')
INDEX = os.path.join(ROOT, 'data', 'og.json')
FONT_BOLD = os.path.join(ROOT, 'assets', 'fonts', 'kopubworld-dotum-bold.woff2')
FONT_MED = os.path.join(ROOT, 'assets', 'fonts', 'kopubworld-dotum-medium.woff2')
FONT_EN = os.path.join(ROOT, 'assets', 'fonts', 'space-grotesk-latin.woff2')

# 그림을 바꾸면 올린다 — 모든 카드를 다시 그린다
VERSION = 2

W, H = 1200, 630
TAUPE = (88, 78, 74)

# 표지 격자: 3×2, 표지 크기·간격·왼쪽 위
N_COVERS = 6
CW, CH, GX, GY, X0, Y0 = 164, 240, 26, 30, 56, 50
# 오른쪽 글씨 자리
TX = X0 + 3 * CW + 2 * GX + 60
TW = W - 50 - TX
NUM_Y = Y0 + 2 * CH + GY + 6        # 권수 글씨 밑선 = 둘째 줄 표지 밑선
HEAD_H = NUM_Y - 64 - 40 - (Y0 - 8)   # 큰 글씨가 쓸 수 있는 높이

UA = 'favorbook-og/1.0 (https://favorbook.co.kr)'
_fonts = {}


def font(size, bold=True):
    k = (size, bold)
    if k not in _fonts:
        _fonts[k] = ImageFont.truetype(FONT_BOLD if bold else FONT_MED, size)
    return _fonts[k]


def font_en(size, weight='Medium'):
    k = ('en', size, weight)
    if k not in _fonts:
        f = ImageFont.truetype(FONT_EN, size)
        f.set_variation_by_name(weight)
        _fonts[k] = f
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


def picks_for(books, read_count):
    seen, out = set(), []
    for b in books:
        t = b['title'].strip()
        if t and t not in seen:
            seen.add(t)
            out.append(b)
    return sorted(out, key=lambda b: (-read_count.get(b['title'].strip(), 0), title_sort_key(b['title'])))


def grid_tile(book, w, h, offline):
    """흰 테두리 + 오른쪽 아래 검은 그림자가 붙은 표지 (RGBA). 표지를 못 받으면 (tile, False)."""
    img = fetch_cover(book.get('coverUrl'), offline)
    if img is not None:
        # 표지 비율을 맞춰 가운데를 자른다
        r = max(w / img.width, h / img.height)
        img = img.resize((max(w, round(img.width * r)), max(h, round(img.height * r))), Image.LANCZOS)
        x, y = (img.width - w) // 2, (img.height - h) // 2
        face = img.crop((x, y, x + w, y + h))
    else:
        face = Image.new('RGB', (w, h), tint(book['title']))
        d = ImageDraw.Draw(face)
        for i, line in enumerate(wrap(d, book['title'], font(16), w - 20, 4)):
            d.text((10, 10 + i * 22), line, font=font(16), fill=(255, 255, 255))
    B, S = 3, 6   # 흰 테두리, 그림자
    tile = Image.new('RGBA', (w + 2 * B + S, h + 2 * B + S), (0, 0, 0, 0))
    td = ImageDraw.Draw(tile)
    td.rectangle((S, S, w + 2 * B + S - 1, h + 2 * B + S - 1), fill=(20, 20, 20))
    td.rectangle((0, 0, w + 2 * B - 1, h + 2 * B - 1), fill=(255, 255, 255))
    tile.paste(face, (B, B))
    return tile, img is not None


def draw_card(heads, ko, num, covers, offline):
    """리딩 리스트 카드 → (Image, 모든 표지를 받았는지).
    heads: 큰 글씨 줄 나눔 후보들. 글씨를 가장 크게 쓸 수 있는 것을 고른다.
    num: 오른쪽 아래 권수 글씨 ('58 books')"""
    # 위에서 아래로 옅은 회색 그러데이션
    im = Image.new('RGB', (W, H))
    top, bot = (246, 245, 243), (214, 213, 211)
    d = ImageDraw.Draw(im)
    for y in range(H):
        t = y / (H - 1)
        d.line((0, y, W, y), fill=tuple(round(a + (b - a) * t) for a, b in zip(top, bot)))

    # 왼쪽: 표지. 4장 이상이면 3+나머지 두 줄, 3장 이하면 가운데 한 줄.
    all_ok = True
    covers = covers[:N_COVERS]
    for i, b in enumerate(covers):
        tile, ok = grid_tile(b, CW, CH, offline)
        u = b.get('coverUrl') or ''
        all_ok = all_ok and (ok or not u.startswith('http') or u in _cover_gone)
        if len(covers) > 3:
            x, y = X0 + (i % 3) * (CW + GX), Y0 + (i // 3) * (CH + GY)
        else:
            pad = (3 - len(covers)) * (CW + GX) // 2
            x, y = X0 + pad + i * (CW + GX), (H - CH) // 2
        im.paste(tile, (x, y), tile)

    # 오른쪽 위: 큰 글씨
    mk = (lambda s: font(s, bold=False)) if ko else (lambda s: font_en(s))
    lh = 1.08 if ko else 0.98
    best = None
    for lines in heads:
        size = 110 if ko else 100
        while size > 40 and (max(text_w(d, s, mk(size)) for s in lines) > TW
                             or len(lines) * size * lh > HEAD_H):
            size -= 2
        if best is None or size > best[0]:
            best = (size, lines)
    size, lines = best
    y = Y0 - 8
    for s in lines:
        d.text((TX, y), fit(d, s, mk(size), TW), font=mk(size), fill=TAUPE)
        y += round(size * lh)

    # 오른쪽 아래: 권수
    d.text((TX, NUM_Y), num, font=font_en(64), fill=TAUPE, anchor='ls')
    return im, all_ok


def split_name(name):
    """'카리나(에스파)' → '카리나'"""
    m = re.match(r'^(.*?)\s*\(([^)]*)\)\s*$', name or '')
    return m.group(1) if m and m.group(1) else (name or '')


def heads_ko(name):
    main = split_name(name)
    out = [[main + '의', '독서']]
    words = main.split()
    if len(words) > 1:
        out.append(words[:-1] + [words[-1] + '의', '독서'])
    elif len(main) > 4:
        k = len(main) // 2
        out.append([main[:k], main[k:] + '의', '독서'])
    return out


def heads_en(name_en):
    main = split_name(name_en).upper()
    out = [[main + "'S", 'READING', 'LIST']]
    words = main.split()
    if len(words) > 1:
        out.append(words[:-1] + [words[-1] + "'S", 'READING', 'LIST'])
        out.append(words[:-1] + [words[-1] + "'S", 'READING LIST'])
    return out


def books_txt(n):
    return f'{n:,} book' + ('' if n == 1 else 's')


def render(name, books, offline):
    return draw_card(heads_ko(name), True, books_txt(len(books)), books, offline)


def render_en(name_en, books, offline):
    return draw_card(heads_en(name_en), False, books_txt(len(books)), books, offline)


# 사이트 대표 카드 — 메인·목록 페이지처럼 셀럽 한 명이 아닌 페이지의 og:image.
# 표지는 무작위로 고르되 주(週) 단위로 고정한다 — 빌드할 때마다 그림이 바뀌어 커밋이 쌓이지 않게.
SITE_CARDS = {'ko': 'og/_site.jpg', 'en': 'og/_site-en.jpg'}


def make_site_cards(celebs, offline):
    """사이트 대표 카드 두 장. 표지가 있는 책에서 6권을 무작위로 (주마다 바뀐다).
    표지를 다 받았을 때만 덮어쓴다 (한 장이라도 빠지면 있던 카드를 둔다)."""
    pool = [b for info in celebs.values() for b in info['books']]
    books, seen = [], set()
    for b in sorted(pool, key=lambda b: title_sort_key(b['title'])):
        t = b['title'].strip()
        if t not in seen and (b.get('coverUrl') or '').startswith('http'):
            seen.add(t)
            books.append(b)
    y, w, _ = datetime.date.today().isocalendar()
    random.Random(f'{y}-{w}').shuffle(books)
    covers = []
    if offline:
        covers = books[:N_COVERS]
    else:
        # 몇 장씩 받아 보며 받히는 표지로 6장을 채운다
        i = 0
        while len(covers) < N_COVERS and i < min(len(books), 8 * N_COVERS):
            batch = books[i:i + N_COVERS]
            i += N_COVERS
            with ThreadPoolExecutor(max_workers=8) as ex:
                list(ex.map(lambda b: fetch_cover(b['coverUrl'], False), batch))
            covers += [b for b in batch if _cover_cache.get(b['coverUrl']) is not None]
        if len(covers) < N_COVERS:
            covers = books[:N_COVERS]
        covers = covers[:N_COVERS]
    # 수는 100권 단위로 내림 — 책 한 권 늘 때마다 다시 그리지 않게
    n_books = len({b['title'].strip() for b in pool})
    num = f'{n_books // 100 * 100:,}+ books'
    heads = {'ko': [['최애의', '독서', '리스트']], 'en': [["K-STARS'", 'READING', 'LIST']]}
    changed = 0
    for lang, rel in SITE_CARDS.items():
        im, ok = draw_card(heads[lang], lang == 'ko', num, covers, offline)
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


def fingerprint(*parts):
    return hashlib.sha1(json.dumps([VERSION, *parts], ensure_ascii=False).encode('utf-8')).hexdigest()[:12]


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

    def fresh(prev, fp_key, file_key, fp, rel):
        return (not args.force and prev.get(fp_key) == fp and prev.get(file_key) == rel
                and prev.get('complete') and os.path.exists(os.path.join(ROOT, rel)))

    # 다시 그릴 셀럽부터 고른다. 한국어·영문 카드 중 하나라도 바뀌면 둘 다 다시 그린다.
    todo = []
    for name in sorted(celebs):
        if args.only and name != args.only:
            continue
        slug = shorts.get(name)
        if not slug:
            continue
        info = celebs[name]
        books = picks_for(info['books'], read_count)
        if not books:
            continue
        fp = fingerprint(name, len(books), [[b['title'], b.get('coverUrl')] for b in books[:N_COVERS]])
        rel = 'og/' + slug + '.jpg'
        # 영문 페이지는 영문 제목이 있는 책만 보여 준다 (generate.py 와 같은 기준)
        name_en = info.get('nameEn')
        en_books = picks_for([b for b in info['books'] if b.get('title_en')], read_count) if name_en else []
        if en_books:
            fp_en = fingerprint(name_en, len(en_books), [[b['title'], b.get('coverUrl')] for b in en_books[:N_COVERS]])
            rel_en = 'og/en/' + slug + '.jpg'
        else:
            fp_en = rel_en = None
        prev = index.get(name) or {}
        if fresh(prev, 'fp', 'file', fp, rel) and (
                fresh(prev, 'fp_en', 'file_en', fp_en, rel_en) if rel_en else not prev.get('file_en')):
            continue
        todo.append((name, books, fp, rel, name_en, en_books, fp_en, rel_en))
    if args.limit:
        todo = todo[:args.limit]

    # 표지는 한꺼번에 나눠 받는다 (처음엔 2천 장이 넘는다)
    if not args.offline:
        urls = sorted({b.get('coverUrl') for t in todo for b in t[1][:N_COVERS] + t[5][:N_COVERS]
                       if (b.get('coverUrl') or '').startswith('http')})
        with ThreadPoolExecutor(max_workers=8) as ex:
            list(ex.map(lambda u: fetch_cover(u, False), urls))

    os.makedirs(os.path.join(OUT_DIR, 'en'), exist_ok=True)
    drawn = 0
    for name, books, fp, rel, name_en, en_books, fp_en, rel_en in todo:
        im, ok = render(name, books, args.offline)
        im.save(os.path.join(ROOT, rel), 'JPEG', quality=85, optimize=True, progressive=True)
        entry = {'file': rel, 'fp': fp, 'complete': ok}
        drawn += 1
        old_en = (index.get(name) or {}).get('file_en')
        if rel_en:
            im, ok_en = render_en(name_en, en_books, args.offline)
            im.save(os.path.join(ROOT, rel_en), 'JPEG', quality=85, optimize=True, progressive=True)
            entry.update(file_en=rel_en, fp_en=fp_en, complete=ok and ok_en)
            drawn += 1
        if old_en and old_en != rel_en and os.path.isfile(os.path.join(ROOT, old_en)):
            os.remove(os.path.join(ROOT, old_en))
        index[name] = entry
    if not args.only:
        drawn += make_site_cards(celebs, args.offline)

    # 사라진 셀럽의 카드는 지운다
    for name in [n for n in index if n not in celebs]:
        for k in ('file', 'file_en'):
            p = os.path.join(ROOT, index[name].get(k) or '')
            if os.path.isfile(p):
                os.remove(p)
        del index[name]

    with open(INDEX, 'w', encoding='utf-8') as f:
        json.dump(index, f, ensure_ascii=False, indent=1, sort_keys=True)
        f.write('\n')
    print(f'✅ OG 이미지: {drawn}장 새로 그림 (셀럽 {len(index)}명)')


if __name__ == '__main__':
    main()
