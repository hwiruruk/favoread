"""셀럽별 '책 취향' 통계 — 작가·번역서·출간 시기·분량·출판사를 세어 믿을 만한 것만 문장으로 돌려준다.

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

책 정보(번역서·출간일·쪽수·시리즈)는 data/bookinfo.json (tools/fetch_bookinfo.py).
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

_NO_AUTHOR = {'', '편집부', '저자 미상', '미상', '작자 미상', '엮음', '지음', '글', '그림'}


def _work_key(title, info):
    """같은 시리즈나 같은 작품이면 같은 키. 시리즈 번호를 알면 그걸 쓴다."""
    ids = (info or {}).get('series') or []
    if ids:
        return 'S%s' % ids[0]
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


def site_baseline(celebs, bookinfo, this_year):
    """사이트 전체에서 각 성질의 비중 (고유 책 기준). 평균과 다른지 비교하는 기준선."""
    seen, tot, yes = set(), dict.fromkeys(_KEYS, 0), dict.fromkeys(_KEYS, 0)
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
    return {k: yes[k] / tot[k] for k in _KEYS if tot[k]}


def _trim(text, n):
    text = re.sub(r'\s*\((출처|Source):[^)]*\)\s*$', '', (text or '').strip())
    return text if len(text) <= n else text[:n - 1].rstrip() + '…'


def compute(books, bookinfo, baseline, this_year):
    """books: 그 셀럽의 책 목록(dict: title, author, publisher, comment, ...).
    bookinfo: {제목: 책 정보}. baseline: site_baseline() 결과.
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

    # 작가 — 서로 다른 작품 수
    by_author, en_name = {}, {}
    for t, b in uniq.items():
        a = (b.get('author') or '').strip()
        if a in _NO_AUTHOR:
            continue
        by_author.setdefault(a, {}).setdefault(_work_key(t, bookinfo.get(t)), t)
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

    if not facts and not authors and not publisher:
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
    return {'n': n_all, 'facts': facts, 'authors': authors, 'publisher': publisher, 'note': note}


_KO = {
    'translated_high': '번역서가 많아요: {of}권 중 {n}권({pct}%)',
    'translated_low': '국내 저자의 책이 많아요: {of}권 중 {n}권({pct}%)',
    'recent': '최근 2년 안에 나온 책이 많아요: {of}권 중 {n}권({pct}%)',
    'thick': '두꺼운 책(500쪽 이상)도 잘 읽어요: {of}권 중 {n}권({pct}%)',
    'thin': '가벼운 분량(250쪽 이하)의 책이 많아요: {of}권 중 {n}권({pct}%)',
}
_EN = {
    'translated_high': 'Reads a lot of translated books: {n} of {of} ({pct}%)',
    'translated_low': 'Mostly books by Korean authors: {n} of {of} ({pct}%)',
    'recent': 'Favors recent releases (last 2 years): {n} of {of} ({pct}%)',
    'thick': 'Takes on long books (500+ pages): {n} of {of} ({pct}%)',
    'thin': 'Leans toward short books (250 pages or fewer): {n} of {of} ({pct}%)',
}


def text_ko(t):
    """한 줄씩 끊어 쓴 문장 목록 (HTML 이스케이프 전)."""
    out = [_KO[f['key']].format(**f) + '.' for f in t['facts']]
    if t['authors']:
        out.append('같은 작가를 여러 권 골랐어요: ' + ', '.join(
            '%s %d권' % (x['author'], x['count']) for x in t['authors']) + '.')
    if t['publisher']:
        out.append('%s 책이 %d권이에요.' % (t['publisher']['name'], t['publisher']['count']))
    return out


def text_en(t):
    out = [_EN[f['key']].format(**f) + '.' for f in t['facts']]
    if t['authors']:
        out.append('Returns to the same author: ' + ', '.join(
            '%s (%d books)' % (x['author_en'], x['count']) for x in t['authors']) + '.')
    if t['publisher']:
        out.append('%d books from %s.' % (t['publisher']['count'], t['publisher']['name']))
    return out
