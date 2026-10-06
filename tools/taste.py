"""셀럽별 '책 취향' 통계 — 분야·작가·번역서·출간 시기·분량·출판사를 세어 믿을 만한 것만 문장으로 돌려준다.

generate.py 가 빌드 때 부른다. 네트워크도 모델도 쓰지 않는다.
같은 입력이면 늘 같은 결과가 나온다.

믿을 수 없는 통계는 내지 않는 게 원칙이다. 그래서 기준이 빡빡하다.

    - 책이 MIN_BOOKS(5)권 미만이면 아무것도 내지 않는다
    - 번역서·출간 시기·분량은 그 정보가 확인된 책이 5권 이상이고 전체의 70% 이상이어야 한다
      (절반 넘게 모르는데 나머지로 취향을 말하면 왜곡된다)
    - 그 위에, 사이트 전체 평균과 눈에 띄게 다를 때만 말한다
      ("번역서를 즐겨 읽는다"가 모두에게 해당하면 그 사람의 취향이 아니다)
    - 작가는 서로 다른 작품이 2권 이상일 때만 꼽는다 (한 권짜리 작가는 취향이 아니다)
      같은 시리즈의 권수 늘리기는 한 작품으로 센다
    - 출판사는 3권 이상이고 비중 30% 이상일 때만 꼽는다
    - 분야는 분야를 아는 책이 5권 이상·70% 이상이면 많은 순으로 보여준다 (예스24 카테고리 → genre())

책 정보(번역서·출간일·쪽수·시리즈)는 data/bookinfo.json (tools/fetch_bookinfo.py).
분야는 data/categories.json (tools/fetch_categories.py — 예스24 카테고리).
작가·출판사는 data.csv 에서 온다. 상수는 여기 한 곳에서만 고친다.
"""
import re

MIN_BOOKS = 5            # 이 권수 미만이면 취향을 내지 않는다
MIN_COVERAGE = 0.7       # 정보가 확인된 책 비율
MIN_AUTHOR_WORKS = 2     # 작가로 꼽을 최소 작품 수 (시리즈는 1작품)
MIN_PUB_BOOKS = 3        # 출판사로 꼽을 최소 권수
MIN_PUB_SHARE = 0.30
MAX_AUTHORS = 3
NOTE_MAX = 90            # 참고 코멘트 최대 글자 수

GAP = 0.25               # 사이트 평균보다 이만큼(비율) 벗어나야 말한다
RECENT_YEARS = 2         # '최근 출간'으로 볼 기간
MIN_RECENT_SHARE = 0.50
THICK_PAGES = 500        # 이 쪽수 이상이면 두꺼운 책
THIN_PAGES = 250         # 이 쪽수 이하면 얇은 책
MIN_PAGE_SHARE = 0.50

# 분야 (data/categories.json — tools/fetch_categories.py)
GENRE_TOP = 3            # 분야는 많은 순으로 이만큼까지 보여준다
GENRE_GAP = 0.20         # 한 분야 비중이 사이트 평균보다 이만큼 높으면 따로 말한다
MIN_GENRE_BOOKS = 3      # 그 분야 책이 이 권수 이상일 때만

_NO_AUTHOR = {'', '편집부', '저자 미상', '미상', '작자 미상', '엮음', '지음', '글', '그림'}


def _work_key(title):
    """같은 작품의 여러 권(1권·2권, 상·하)이면 같은 키.
    예스24 '시리즈'는 쓰지 않는다. 출판사 전집(세계문학전집·시인선)이나 작가 모음
    (한강 작품 전부가 한 시리즈)까지 들어 있어서, 서로 다른 책이 한 작품으로 묶인다."""
    t = re.sub(r'\([^)]*\)|\[[^\]]*\]', ' ', title or '')
    t = re.sub(r'(제?\s*\d+\s*(권|부|편|화)?|[ⅠⅡⅢⅣⅤ]+|상|중|하)\s*$', '', t.strip())
    return re.sub(r'[^0-9A-Za-z가-힣]+', '', t).lower()


def _flags(info, this_year):
    """한 권의 정보에서 (번역서, 최근출간, 두꺼움, 얇음) 을 뽑는다. 모르면 None."""
    if not info:
        return None, None, None, None
    tr = info.get('translated')
    y = (info.get('publishDate') or '')[:4]
    recent = (int(y) >= this_year - RECENT_YEARS + 1) if y.isdigit() else None
    pg = info.get('pages')
    thick = (pg >= THICK_PAGES) if isinstance(pg, int) and pg > 0 else None
    thin = (pg <= THIN_PAGES) if isinstance(pg, int) and pg > 0 else None
    return tr, recent, thick, thin


_KEYS = ('translated', 'recent', 'thick', 'thin')


# 분야 이름과 영문 — 편집기 '🏷️ 분야 검수'(editor/app.js 의 GENRES)와 같은 목록·순서
GENRE_EN = {
    '소설': 'Fiction', '시': 'Poetry', '에세이': 'Essays', '기타 문학': 'Other literature',
    '인문': 'Humanities', '사회': 'Society', '경제·경영': 'Business', '자기계발': 'Self-help',
    '과학': 'Science', '실용·생활': 'Practical', '예술': 'Arts', '만화': 'Comics', '여행': 'Travel',
    '어린이책': "Children's books", '기타': 'Other',
}
GENRE_EXCLUDE = '제외'   # 검수에서 '통계에서 뺌'을 고른 책

# 예스24 카테고리 → 분야. 국내도서 바로 아래 분류 이름(공백 뺀 것)을 위에서부터 맞춰 본다.
# editor/app.js 의 Y24_TOP 과 같은 표 (같이 고칠 것)
_Y24_TOP = [
    (r'소설|시/?희곡|문학', 'lit'),
    (r'에세이', '에세이'),
    (r'만화|라이트노벨', '만화'),
    (r'자기계발', '자기계발'),
    (r'경제|경영', '경제·경영'),
    (r'인문|역사|종교|인물|철학', '인문'),
    (r'사회|정치', '사회'),
    (r'과학|IT|모바일|컴퓨터', '과학'),
    (r'가정|살림|건강|취미|요리|외국어|사전|레저|스포츠', '실용·생활'),
    (r'예술|대중문화', '예술'),
    (r'여행', '여행'),
    (r'어린이|유아', '어린이책'),
    (r'청소년', 'teen'),
    (r'잡지|수험|자격증|참고서|교재|전집|대학', '기타'),
]
_MALLS = re.compile(r'국내도서|외국도서|eBook|중고', re.I)


def _lit(names):
    """문학 아래 분류 이름들 → 소설·시·에세이·기타 문학. 가장 자세한 단계부터 본다. 모르면 None."""
    for x in reversed(names):
        n = x.replace(' ', '')
        if re.search(r'소설|노벨', n):
            return '소설'
        if re.search(r'에세이|수필', n):
            return '에세이'
        if n.endswith('희곡') and '시' not in n[:-2]:
            return '기타 문학'
        if n.endswith('시') or n.startswith('시/') or re.search(r'시집|시조', n):
            return '시'
    return None


def _top(name):
    n = name.replace(' ', '')
    return next((g for pat, g in _Y24_TOP if re.search(pat, n, re.I)), None)


def path_genre(path):
    """예스24 카테고리 경로 하나(['국내도서', '소설/시/희곡', '한국소설', ...]) → 분야 이름. 모르면 None.
    문학은 아래 단계(한국소설·한국시·한국에세이)까지 봐야 형식을 안다.
    청소년은 아래 단계로 다시 맞춘다 (청소년 소설 → 소설, 청소년 인문 → 인문)."""
    p = [x.strip() for x in path or [] if x and x.strip()]
    if p and _MALLS.fullmatch(p[0].replace(' ', '')):
        p = p[1:]
    if not p:
        return None
    g = _top(p[0])
    if g == 'lit':
        return _lit(p[1:])
    if g == '만화' and any('노벨' in x for x in p[1:]):
        return '소설'   # 만화/라이트노벨 > 라이트노벨
    if g == 'teen':
        return _lit(p[1:]) or next((x for x in map(_top, reversed(p[1:])) if x and x not in ('lit', 'teen')), None)
    return g


def genre(cats):
    """예스24 카테고리 경로 목록 → (분야, 영문). 예스24가 먼저 적은 경로(대표 분류)부터 보고
    분야를 정할 수 있는 첫 경로를 쓴다. 모르면 None."""
    for c in cats or []:
        g = path_genre(c.get('path') if isinstance(c, dict) else c)
        if g:
            return (g, GENRE_EN.get(g, g))
    return None


def _genre_of(subjects, t):
    """사람이 정한 분야(data/genres.json → genre_override)가 있으면 그걸, 없으면 예스24 카테고리로 정한다."""
    s = (subjects or {}).get(t) or {}
    g = s.get('genre_override')
    if g:
        return None if g == GENRE_EXCLUDE else (g, GENRE_EN.get(g, g))
    return genre(s.get('cats'))


def site_baseline(celebs, bookinfo, this_year, subjects=None):
    """사이트 전체에서 각 성질의 비중 (고유 책 기준). 평균과 다른지 비교하는 기준선.
    '_genre' 는 분야별 비중."""
    seen, tot, yes = set(), dict.fromkeys(_KEYS, 0), dict.fromkeys(_KEYS, 0)
    genres = {}
    for info in celebs.values():
        for b in info['books']:
            t = b['title'].strip()
            if t in seen:
                continue
            seen.add(t)
            for k, v in zip(_KEYS, _flags(bookinfo.get(t), this_year)):
                if v is not None:
                    tot[k] += 1
                    yes[k] += 1 if v else 0
            g = _genre_of(subjects, t)
            if g:
                genres[g[0]] = genres.get(g[0], 0) + 1
    base = {k: yes[k] / tot[k] for k in _KEYS if tot[k]}
    n_genre = sum(genres.values())
    base['_genre'] = {g: n / n_genre for g, n in genres.items()} if n_genre else {}
    return base


def _trim(text, n):
    text = re.sub(r'\s*\((출처|Source):[^)]*\)\s*$', '', (text or '').strip())
    return text if len(text) <= n else text[:n - 1].rstrip() + '…'


def compute(books, bookinfo, baseline, this_year, subjects=None):
    """books: 그 셀럽의 책 목록(dict: title, author, publisher, comment, ...).
    bookinfo: {제목: 책 정보}. baseline: site_baseline() 결과.
    subjects: {제목: 카테고리} (data/categories.json). 없으면 분야 줄이 빠진다.
    믿을 만한 게 없으면 None."""
    uniq = {}
    for b in books:
        uniq.setdefault(b['title'].strip(), b)
    n_all = len(uniq)
    if n_all < MIN_BOOKS:
        return None

    # 번역서·출간 시기·분량 — 성질마다 정보가 확인된 책이 충분해야 한다
    facts = []   # (키, 문장 재료)
    flags = {t: _flags(bookinfo.get(t), this_year) for t in uniq}
    for i, k in enumerate(_KEYS):
        known = [f[i] for f in flags.values() if f[i] is not None]
        if len(known) < MIN_BOOKS or len(known) / n_all < MIN_COVERAGE or k not in baseline:
            continue
        n, share, base = sum(known), sum(known) / len(known), baseline[k]
        pct = round(share * 100)
        if k == 'translated':
            if share >= base + GAP:
                facts.append({'key': 'translated_high', 'n': n, 'of': len(known), 'pct': pct})
            elif share <= base - GAP:
                facts.append({'key': 'translated_low', 'n': len(known) - n, 'of': len(known), 'pct': 100 - pct})
        elif k == 'recent':
            if share >= MIN_RECENT_SHARE and share >= base + GAP:
                facts.append({'key': 'recent', 'n': n, 'of': len(known), 'pct': pct})
        else:
            if share >= MIN_PAGE_SHARE and share >= base + GAP:
                facts.append({'key': k, 'n': n, 'of': len(known), 'pct': pct})

    # 분야 — 분야를 아는 책이 충분할 때만. 많은 순으로 보여주고, 평균보다 크게 높은 분야는 따로 말한다
    genres, genre_of = [], 0
    labels = {t: _genre_of(subjects, t) for t in uniq}
    known_g = [g for g in labels.values() if g]
    if len(known_g) >= MIN_BOOKS and len(known_g) / n_all >= MIN_COVERAGE:
        cnt = {}
        for g in known_g:
            cnt[g] = cnt.get(g, 0) + 1
        genre_of = len(known_g)
        ranked = sorted(cnt.items(), key=lambda x: (-x[1], x[0][0]))
        genres = [{'ko': g[0], 'en': g[1], 'n': n} for g, n in ranked[:GENRE_TOP] if n >= 2 or n == genre_of]
        gb = baseline.get('_genre') or {}
        high = [(n / genre_of - gb.get(g[0], 0), g, n) for g, n in cnt.items()
                if n >= MIN_GENRE_BOOKS and n / genre_of >= gb.get(g[0], 0) + GENRE_GAP]
        if high:
            _, g, n = max(high)
            facts.insert(0, {'key': 'genre_high', 'label': g[0], 'label_en': g[1], 'n': n, 'of': genre_of,
                             'pct': round(n / genre_of * 100), 'base': round(gb.get(g[0], 0) * 100)})

    # 작가 — 서로 다른 작품 수
    by_author, en_name = {}, {}
    for t, b in uniq.items():
        a = (b.get('author') or '').strip()
        if a in _NO_AUTHOR:
            continue
        by_author.setdefault(a, {}).setdefault(_work_key(t), t)
        en_name.setdefault(a, (b.get('author_en') or '').strip().rstrip('*').strip())
    authors = [{'author': a, 'author_en': en_name.get(a) or a, 'count': len(w), 'titles': sorted(w.values())}
               for a, w in by_author.items() if len(w) >= MIN_AUTHOR_WORKS]
    authors.sort(key=lambda x: (-x['count'], x['author']))
    authors = authors[:MAX_AUTHORS]

    # 출판사
    pubs = {}
    for t, b in uniq.items():
        p = (b.get('publisher') or '').strip()
        if p:
            pubs.setdefault(p, []).append(t)
    publisher = None
    if pubs:
        p, ts = max(pubs.items(), key=lambda x: (len(x[1]), x[0]))
        if len(ts) >= MIN_PUB_BOOKS and len(ts) / n_all >= MIN_PUB_SHARE:
            publisher = {'name': p, 'count': len(ts), 'titles': sorted(ts)}

    if not facts and not authors and not publisher and not genres:
        return None

    # 참고 코멘트 — 꼽힌 작가·출판사의 책 중 코멘트가 붙은 첫 권
    picked = {t for a in authors for t in a['titles']} | set((publisher or {}).get('titles', []))
    note = None
    for t in sorted(picked):
        c = (uniq[t].get('comment') or '').strip()
        if c:
            note = {'title': t, 'ko': _trim(c, NOTE_MAX),
                    'en': _trim(uniq[t].get('comment_en') or '', NOTE_MAX)}
            break
    return {'n': n_all, 'facts': facts, 'authors': authors, 'publisher': publisher, 'note': note,
            'genres': genres, 'genre_of': genre_of}


_KO = {
    'genre_high': '{label} 비중이 사이트 평균보다 높아요: {of}권 중 {n}권({pct}%, 평균 {base}%)',
    'translated_high': '번역서가 많아요: {of}권 중 {n}권({pct}%)',
    'translated_low': '국내 저자의 책이 많아요: {of}권 중 {n}권({pct}%)',
    'recent': '최근 2년 안에 나온 책이 많아요: {of}권 중 {n}권({pct}%)',
    'thick': '두꺼운 책(500쪽 이상)도 잘 읽어요: {of}권 중 {n}권({pct}%)',
    'thin': '가벼운 분량(250쪽 이하)의 책이 많아요: {of}권 중 {n}권({pct}%)',
}
_EN = {
    'genre_high': 'More {label_en} than the site average: {n} of {of} ({pct}%, avg {base}%)',
    'translated_high': 'Reads a lot of translated books: {n} of {of} ({pct}%)',
    'translated_low': 'Mostly books by Korean authors: {n} of {of} ({pct}%)',
    'recent': 'Favors recent releases (last 2 years): {n} of {of} ({pct}%)',
    'thick': 'Takes on long books (500+ pages): {n} of {of} ({pct}%)',
    'thin': 'Leans toward short books (250 pages or fewer): {n} of {of} ({pct}%)',
}


def text_ko(t):
    """한 줄씩 끊어 쓴 문장 목록 (HTML 이스케이프 전)."""
    out = []
    if t.get('genres'):
        out.append('주로 읽는 분야: ' + ', '.join('%s %d권' % (g['ko'], g['n']) for g in t['genres'])
                   + ' (분야를 아는 %d권 중).' % t['genre_of'])
    out += [_KO[f['key']].format(**f) + '.' for f in t['facts']]
    if t['authors']:
        out.append('같은 작가를 여러 권 골랐어요: ' + ', '.join(
            '%s %d권' % (x['author'], x['count']) for x in t['authors']) + '.')
    if t['publisher']:
        out.append('%s 책이 %d권이에요.' % (t['publisher']['name'], t['publisher']['count']))
    return out


def text_en(t):
    out = []
    if t.get('genres'):
        out.append('Main genres: ' + ', '.join('%s (%d)' % (g['en'], g['n']) for g in t['genres'])
                   + ' of %d books with a known genre.' % t['genre_of'])
    out += [_EN[f['key']].format(**f) + '.' for f in t['facts']]
    if t['authors']:
        out.append('Returns to the same author: ' + ', '.join(
            '%s (%d books)' % (x['author_en'], x['count']) for x in t['authors']) + '.')
    if t['publisher']:
        out.append('%d books from %s.' % (t['publisher']['count'], t['publisher']['name']))
    return out
