"""셀럽별 '책 취향' 통계 — 분야·작가를 세어 믿을 만한 것만 문장으로 돌려준다.

generate.py 가 빌드 때 부른다. 네트워크도 모델도 쓰지 않는다.
같은 입력이면 늘 같은 결과가 나온다.

믿을 수 없는 통계는 내지 않는 게 원칙이다. 그래서 기준이 빡빡하다.

    - 책이 MIN_BOOKS(5)권 미만이면 아무것도 내지 않는다
    - 분야는 분야가 확인된 책이 5권 이상이고, 전체 책의 70% 이상이어야 한다
      (절반 넘게 모르는데 나머지로 취향을 말하면 왜곡된다)
    - 분야는 3권 이상 + 비중 30% 이상 + 사이트 전체 평균보다 높을 때만 꼽는다
      ("소설을 즐겨 읽는다"가 모두에게 해당하면 그 사람의 취향이 아니다)
    - 작가는 서로 다른 작품이 2권 이상일 때만 꼽는다 (한 권짜리 작가는 취향이 아니다)
      같은 시리즈의 권수 늘리기는 한 작품으로 센다

상수는 여기 한 곳에서만 고친다.
"""
import re

MIN_BOOKS = 5            # 이 권수 미만이면 취향을 내지 않는다
MIN_COVERAGE = 0.7       # 분야가 확인된 책 비율
MIN_FIELD_BOOKS = 3      # 분야로 꼽을 최소 권수
MIN_FIELD_SHARE = 0.30   # 분야로 꼽을 최소 비중
MIN_AUTHOR_WORKS = 2     # 작가로 꼽을 최소 작품 수 (시리즈는 1작품)
MAX_FIELDS = 2
MAX_AUTHORS = 3
NOTE_MAX = 90            # 참고 코멘트 최대 글자 수

FIELD_EN = {
    '소설': 'fiction', '시·희곡': 'poetry & plays', '에세이': 'essays',
    '인문학': 'humanities', '사회과학': 'social sciences', '경제경영': 'business & economics',
    '자기계발': 'self-help', '과학': 'science', '역사': 'history',
    '예술·대중문화': 'arts & pop culture', '종교·역학': 'religion & philosophy',
    '만화': 'comics', '어린이': "children's books", '청소년': 'young adult',
    '여행': 'travel', '건강·취미': 'health & hobbies', '요리·살림': 'cooking & home',
    '컴퓨터·모바일': 'computing', '외국어': 'language learning', '좋은부모': 'parenting',
}

_NO_AUTHOR = {'', '편집부', '저자 미상', '미상', '작자 미상', '엮음', '지음', '글', '그림'}


def field_of(category_name):
    """알라딘 categoryName('국내도서>소설/시/희곡>한국소설')을 큰 분야 하나로."""
    parts = [p.strip() for p in (category_name or '').split('>') if p.strip()]
    if len(parts) < 2:
        return ''
    lv2 = parts[1]
    if lv2.startswith('소설/시'):
        lv3 = parts[2] if len(parts) > 2 else ''
        return '시·희곡' if ('시' == lv3[:1] and '소설' not in lv3) or '희곡' in lv3 else '소설'
    return lv2.replace('/', '·')


def _work_key(title):
    """시리즈 권수를 떼어 같은 작품이면 같은 키가 되게 한다."""
    t = re.sub(r'\([^)]*\)|\[[^\]]*\]', ' ', title or '')
    t = re.sub(r'(제?\s*\d+\s*(권|부|편|화)?|[ⅠⅡⅢⅣⅤ]+|상|중|하)\s*$', '', t.strip())
    return re.sub(r'[^0-9A-Za-z가-힣]+', '', t).lower()


def site_field_share(celebs, genres):
    """사이트 전체에서 분야별 비중 (고유 책 기준). 평균보다 높은지 비교하는 기준선."""
    seen, total, cnt = set(), 0, {}
    for info in celebs.values():
        for b in info['books']:
            t = b['title'].strip()
            if t in seen:
                continue
            seen.add(t)
            f = (genres.get(t) or {}).get('field')
            if f:
                total += 1
                cnt[f] = cnt.get(f, 0) + 1
    return {f: n / total for f, n in cnt.items()} if total else {}


def _trim(text, n):
    text = re.sub(r'\s*\((출처|Source):[^)]*\)\s*$', '', (text or '').strip())
    return text if len(text) <= n else text[:n - 1].rstrip() + '…'


def compute(books, genres, baseline):
    """books: 그 셀럽의 책 목록(dict: title, author, comment, comment_en).
    genres: {제목: {'field': ...}}. baseline: site_field_share() 결과.
    믿을 만한 게 없으면 None."""
    uniq = {}
    for b in books:
        uniq.setdefault(b['title'].strip(), b)
    n_all = len(uniq)
    if n_all < MIN_BOOKS:
        return None

    # 분야
    fields = []
    with_field = {t: genres[t]['field'] for t in uniq if (genres.get(t) or {}).get('field')}
    n_known = len(with_field)
    field_ok = n_known >= MIN_BOOKS and n_known / n_all >= MIN_COVERAGE
    if field_ok:
        cnt = {}
        for f in with_field.values():
            cnt[f] = cnt.get(f, 0) + 1
        for f, c in sorted(cnt.items(), key=lambda x: (-x[1], x[0])):
            share = c / n_known
            if c >= MIN_FIELD_BOOKS and share >= MIN_FIELD_SHARE and share > baseline.get(f, 0):
                fields.append({'field': f, 'count': c, 'share': round(share * 100)})
        fields = fields[:MAX_FIELDS]

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

    if not fields and not authors:
        return None

    # 참고 코멘트 — 꼽힌 분야·작가의 책 중 코멘트가 붙은 첫 권
    picked = {t for a in authors for t in a['titles']}
    picked |= {t for t, f in with_field.items() if f in {x['field'] for x in fields}}
    note = None
    for t in sorted(picked):
        c = (uniq[t].get('comment') or '').strip()
        if c:
            note = {'title': t, 'ko': _trim(c, NOTE_MAX),
                    'en': _trim(uniq[t].get('comment_en') or '', NOTE_MAX)}
            break
    return {'n': n_all, 'n_field': n_known, 'fields': fields, 'authors': authors, 'note': note}


def text_ko(t):
    """한 줄씩 끊어 쓴 문장 목록 (HTML 이스케이프 전)."""
    out = []
    if t['fields']:
        out.append('가장 많이 읽은 분야는 ' + ', '.join(
            '%s %d권(%d%%)' % (x['field'], x['count'], x['share']) for x in t['fields'])
            + '이에요. (분야를 아는 책 %d권 기준)' % t['n_field'])
    if t['authors']:
        out.append('같은 작가를 여러 권 골랐어요: ' + ', '.join(
            '%s %d권' % (x['author'], x['count']) for x in t['authors']) + '.')
    return out


def text_en(t):
    out = []
    if t['fields']:
        out.append('Most-read categories: ' + ', '.join(
            '%s (%d books, %d%%)' % (FIELD_EN.get(x['field'], x['field']), x['count'], x['share'])
            for x in t['fields']) + ' — based on %d books with a known category.' % t['n_field'])
    if t['authors']:
        out.append('Returns to the same author: ' + ', '.join(
            '%s (%d books)' % (x['author_en'], x['count']) for x in t['authors']) + '.')
    return out
