"""
data.csv의 영문 메타데이터(`연예인_en`, `도서명_en`)를 자동/수동 하이브리드로 채우는 스크립트.

워크플로우:
  1. (로컬 또는 GitHub Actions에서) `python3 enrich_en.py` 실행
  2. 비어있는 `도서명_en` → Google Books → Open Library 순으로 영문판 제목 탐색
  3. 비어있는 `연예인_en` → 한국어 Wikipedia → Wikidata 영문 라벨 조회
  4. 자동 제안값은 `?` 접두사를 붙여 사람 검수가 필요함을 명시 (예: `?The Vegetarian`)
  5. 검수 후 `?` 제거 → 빌드시 정식 값으로 사용

옵션:
  --limit N         : 책 제목 최대 처리 행 수 (0=무제한)
  --celeb-limit N   : 셀럽 이름 최대 처리 행 수 (0=무제한)
  --dry-run         : CSV에 쓰지 않고 결과만 출력
  --refresh         : `?` 접두사 붙은 기존 제안도 다시 조회
  --skip-books      : 책 제목 조회 건너뛰기
  --skip-celebs     : 셀럽 이름 조회 건너뛰기

빈 칸으로 두면 해당 행은 영문 페이지에 노출되지 않습니다.
"""
import csv, json, sys, time, urllib.parse, urllib.request, argparse

GOOGLE_BOOKS_API = "https://www.googleapis.com/books/v1/volumes"
OPEN_LIBRARY_API = "https://openlibrary.org/search.json"
KO_WIKI_API      = "https://ko.wikipedia.org/w/api.php"
WIKIDATA_API     = "https://www.wikidata.org/w/api.php"


def http_get_json(url, timeout=10):
    req = urllib.request.Request(url, headers={'User-Agent': 'favoread-enrich/1.0'})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


def is_foreign_author(author_en):
    """영문 작가명이 외국인일 가능성이 높은지. Korean romanization은 보통
    'Kim/Lee/Park/Han/Choi/Jung/Yoon ...' 등의 성으로 시작."""
    if not author_en:
        return False
    KOREAN_SURNAMES = {
        'kim', 'lee', 'park', 'choi', 'jung', 'jeong', 'cho', 'jo', 'jang',
        'han', 'kang', 'yoon', 'yun', 'shin', 'song', 'suh', 'seo', 'oh',
        'hwang', 'ahn', 'an', 'no', 'noh', 'bae', 'baek', 'paik', 'son',
        'sohn', 'go', 'ko', 'gu', 'koo', 'ku', 'min', 'sung', 'seung',
        'hong', 'moon', 'mun', 'cha', 'do', 'do', 'ryu', 'yu', 'yoo', 'ha',
    }
    first_word = author_en.strip().split()[0].lower().rstrip(',')
    return first_word not in KOREAN_SURNAMES


def title_similarity(title_a, title_b):
    """대소문자/공백 무시하고 단어 교집합 비율로 유사도 측정 (0~1)."""
    if not title_a or not title_b:
        return 0
    def tokens(s):
        s = s.lower()
        s = re.sub(r'[^\w가-힣]+', ' ', s)
        return set(t for t in s.split() if len(t) > 1)
    a, b = tokens(title_a), tokens(title_b)
    if not a or not b:
        return 0
    return len(a & b) / max(len(a), len(b))


import re


def google_books_query(query, lang_restrict=True, max_results=10):
    """Google Books 일반 쿼리 — 결과 list 반환.
    각 결과: {'title', 'subtitle', 'authors', 'language', 'ratingsCount'}
    """
    params = {'q': query, 'maxResults': str(max_results)}
    if lang_restrict:
        params['langRestrict'] = 'en'
    url = GOOGLE_BOOKS_API + '?' + urllib.parse.urlencode(params)
    try:
        data = http_get_json(url)
    except Exception:
        return []
    results = []
    for item in data.get('items', []):
        info = item.get('volumeInfo', {})
        if lang_restrict and info.get('language') != 'en':
            continue
        t = info.get('title')
        if not t:
            continue
        sub = info.get('subtitle')
        full_title = (t + ': ' + sub) if sub else t
        authors = info.get('authors') or []
        results.append({
            'title': full_title,
            'authors': ', '.join(authors) if authors else None,
            'language': info.get('language'),
            'ratings': info.get('ratingsCount', 0) or 0,
        })
    return results


def lookup_google_books(title_ko, author_ko):
    """레거시 시그니처 호환. 단순 한국어 검색만 사용."""
    q = 'intitle:' + title_ko
    if author_ko:
        q += ' inauthor:' + author_ko
    res = google_books_query(q, lang_restrict=True, max_results=5)
    if res:
        return res[0]['title'], res[0]['authors'], None
    return None, None, "google_books no en match"


def lookup_open_library(title_ko, author_ko):
    """Open Library 폴백 — 한국어 제목으로 작품(work) 검색 후 영문판 제목 추출."""
    params = {'title': title_ko, 'limit': '5'}
    if author_ko:
        params['author'] = author_ko
    url = OPEN_LIBRARY_API + '?' + urllib.parse.urlencode(params)
    try:
        data = http_get_json(url)
    except Exception as e:
        return None, f"open_library error: {e}"

    for doc in data.get('docs', []):
        # title_english 같은 필드는 없으므로 영문자 비율로 휴리스틱 판단
        t = doc.get('title')
        if not t:
            continue
        ascii_ratio = sum(1 for c in t if ord(c) < 128) / max(len(t), 1)
        if ascii_ratio > 0.85:
            return t, None
    return None, "open_library no en match"


def find_en_title(title_ko, author_ko, author_en=None):
    """다단계 폴백 검색. 결과는 (title|None, author_en|None, source|None).

    전략 순서:
      1. 영문 작가 + 한국어 제목 검색 (가장 정확)
      2. 외국 작가의 책: 작가만으로 검색 → 가장 popular 결과
      3. 한국 작가의 책: 작가 영문명만으로 검색 → 첫 결과
      4. 한국어 검색 (기존 방식)
      5. langRestrict 제거하고 메타에서 영문 표기 추출
      6. Open Library 폴백
    """

    # 전략 1: 영문 작가 + 한국어 제목
    if author_en:
        res = google_books_query(
            'intitle:' + title_ko + ' inauthor:' + author_en,
            lang_restrict=True, max_results=5,
        )
        if res:
            return res[0]['title'], res[0]['authors'], 'gb:title+author_en'

    # 전략 2 & 3: 작가 영문명만으로 검색
    if author_en:
        res = google_books_query(
            'inauthor:' + author_en,
            lang_restrict=True, max_results=20,
        )
        if res:
            # 외국 작가 → ratings 많은 것 중 제목 유사도 best
            # 한국 작가 → 같은 사람의 책이 적으니 유사도 best
            scored = []
            for r in res:
                sim = title_similarity(title_ko, r['title'])
                # ratings는 log scale로 가중 (있으면 유리, 없어도 OK)
                ratings_boost = (r['ratings'] ** 0.3) if r['ratings'] else 0
                scored.append((sim * 10 + ratings_boost, sim, r))
            scored.sort(reverse=True)
            best_score, best_sim, best = scored[0]
            # 유사도 0이어도 외국 작가면 popular한 책 채택 (검수 단계에서 거름)
            if is_foreign_author(author_en) or best_sim > 0.3:
                src = 'gb:author_en_only' + (' (foreign)' if is_foreign_author(author_en) else '')
                return best['title'], best['authors'], src

    # 전략 4: 기존 방식 (한국어 제목+한국어 작가)
    res = google_books_query(
        'intitle:' + title_ko + (' inauthor:' + author_ko if author_ko else ''),
        lang_restrict=True, max_results=5,
    )
    if res:
        return res[0]['title'], res[0]['authors'], 'gb:title_ko+author_ko'

    # 전략 5: langRestrict 제거 — 한글판이 잡혀도 영문 메타 있을 수 있음
    res = google_books_query(
        'intitle:' + title_ko + (' inauthor:' + author_ko if author_ko else ''),
        lang_restrict=False, max_results=5,
    )
    for r in res:
        # ASCII 비율 높은 제목/작가만 채택
        if sum(1 for c in r['title'] if ord(c) < 128) / max(len(r['title']), 1) > 0.85:
            return r['title'], r['authors'], 'gb:relaxed'

    # 전략 6: Open Library
    t, _err = lookup_open_library(title_ko, author_ko)
    if t:
        return t, None, 'open_library'

    return None, None, None


# Hangul 음절 분해 + Revised Romanization (간단 버전).
# 한국 인명에서 자주 쓰이는 관습적 표기는 surname overrides로 처리.
HANGUL_INITIALS = ['g','kk','n','d','tt','r','m','b','pp','s','ss','','j','jj','ch','k','t','p','h']
HANGUL_VOWELS = ['a','ae','ya','yae','eo','e','yeo','ye','o','wa','wae','oe','yo','u','wo','we','wi','yu','eu','ui','i']
HANGUL_FINALS = ['','k','k','ks','n','nj','nh','t','l','lk','lm','lp','ls','lt','lp','lh','m','p','ps','t','t','ng','t','t','k','t','p','t']

# 한국 인명 관습 표기 (RR 표기보다 우선)
KOREAN_SURNAME_OVERRIDES = {
    '김': 'Kim', '이': 'Lee', '박': 'Park', '최': 'Choi', '정': 'Jung',
    '강': 'Kang', '조': 'Cho', '윤': 'Yoon', '장': 'Jang', '임': 'Lim',
    '한': 'Han', '신': 'Shin', '오': 'Oh', '서': 'Seo', '권': 'Kwon',
    '황': 'Hwang', '안': 'Ahn', '송': 'Song', '전': 'Jeon', '홍': 'Hong',
    '유': 'Yoo', '고': 'Ko', '문': 'Moon', '양': 'Yang', '손': 'Son',
    '배': 'Bae', '백': 'Baek', '허': 'Heo', '남': 'Nam', '심': 'Shim',
    '노': 'Noh', '하': 'Ha', '곽': 'Kwak', '성': 'Sung', '차': 'Cha',
    '주': 'Joo', '우': 'Woo', '구': 'Koo', '나': 'Na', '민': 'Min',
    '진': 'Jin', '지': 'Ji', '엄': 'Eom', '채': 'Chae', '원': 'Won',
    '천': 'Chun', '방': 'Bang', '공': 'Gong', '현': 'Hyun', '함': 'Ham',
    '변': 'Byun', '염': 'Yeom', '여': 'Yeo', '추': 'Choo', '도': 'Do',
    '소': 'So', '신': 'Shin', '석': 'Seok', '선': 'Sun', '설': 'Seol',
    '마': 'Ma', '길': 'Gil', '연': 'Yeon', '위': 'Wi', '표': 'Pyo',
}


def romanize_korean_syllable(ch):
    """한글 음절 1자 → 로마자."""
    code = ord(ch) - 0xAC00
    if code < 0 or code > 11171:
        return ch
    initial = code // 588
    vowel = (code % 588) // 28
    final = code % 28
    return HANGUL_INITIALS[initial] + HANGUL_VOWELS[vowel] + HANGUL_FINALS[final]


def romanize_korean_name(name_ko):
    """한국 인명을 영문으로 (Surname Firstname 형식). 검수 필요."""
    name_ko = name_ko.strip()
    if not name_ko:
        return None
    # 첫 글자 = 성 (관습 표기 우선)
    surname = KOREAN_SURNAME_OVERRIDES.get(name_ko[0])
    if surname:
        rest = name_ko[1:].strip()
    else:
        # 관습 표기에 없는 성은 RR 그대로
        surname = romanize_korean_syllable(name_ko[0]).capitalize()
        rest = name_ko[1:].strip()
    if not rest:
        return surname
    # 이름은 RR로, 첫 글자만 대문자, 음절 사이 하이픈
    given_parts = [romanize_korean_syllable(c) for c in rest if 0xAC00 <= ord(c) <= 0xD7A3]
    if not given_parts:
        return surname
    given = '-'.join(p.capitalize() if i == 0 else p for i, p in enumerate(given_parts))
    given = given_parts[0].capitalize() + ('-' + given_parts[1].lower() if len(given_parts) > 1 else '')
    if len(given_parts) > 2:
        given += '-' + '-'.join(p.lower() for p in given_parts[2:])
    return surname + ' ' + given


def _wikidata_label_from_qid(qid):
    """Q-id → 영문 라벨."""
    params = {
        'action': 'wbgetentities',
        'format': 'json',
        'ids': qid,
        'props': 'labels',
        'languages': 'en',
    }
    url = WIKIDATA_API + '?' + urllib.parse.urlencode(params)
    try:
        data = http_get_json(url)
    except Exception:
        return None
    entity = (data.get('entities') or {}).get(qid) or {}
    labels = entity.get('labels') or {}
    return (labels.get('en') or {}).get('value')


def _wiki_qid_from_title(title):
    """한국어 Wikipedia 페이지 제목 → Wikidata Q-id."""
    params = {
        'action': 'query',
        'format': 'json',
        'titles': title,
        'prop': 'pageprops',
        'redirects': '1',
    }
    url = KO_WIKI_API + '?' + urllib.parse.urlencode(params)
    try:
        data = http_get_json(url)
    except Exception:
        return None
    pages = (data.get('query') or {}).get('pages') or {}
    for _pid, p in pages.items():
        pp = p.get('pageprops') or {}
        if pp.get('wikibase_item'):
            return pp['wikibase_item']
    return None


def _wiki_search_top_pages(query, limit=3):
    """한국어 Wiki 검색 → 상위 N개 페이지 제목."""
    params = {
        'action': 'query',
        'format': 'json',
        'list': 'search',
        'srsearch': query,
        'srlimit': str(limit),
    }
    url = KO_WIKI_API + '?' + urllib.parse.urlencode(params)
    try:
        data = http_get_json(url)
    except Exception:
        return []
    return [s['title'] for s in (data.get('query') or {}).get('search') or []]


def lookup_celeb_en(name_ko):
    """다단계 폴백:
      1. 한국어 Wiki 정확 매칭 → Wikidata 영문 라벨
      2. Wiki 검색(broad) 상위 결과들 시도
      3. 한국어 로마자화 (Surname overrides + RR)

    그룹 표기('아이린(레드벨벳)')는 괄호 부분 제거 후 시도.
    """
    base_name = name_ko.split('(')[0].strip()
    group_suffix = ''
    if '(' in name_ko and ')' in name_ko:
        group = name_ko[name_ko.find('(')+1:name_ko.rfind(')')].strip()
        if group:
            group_suffix = ' (' + group + ')'

    def _attach_group(label):
        if group_suffix and group_suffix.strip(' ()') not in label:
            return label + group_suffix
        return label

    # 전략 1: 정확 매칭
    qid = _wiki_qid_from_title(base_name)
    if qid:
        en = _wikidata_label_from_qid(qid)
        if en:
            return _attach_group(en), 'wikidata:exact'

    # 전략 2: Wiki 검색 (broad). 상위 결과 중 Q-id 있고 영문 라벨 잡히는 첫 항목
    candidates = _wiki_search_top_pages(base_name, limit=3)
    for cand in candidates:
        qid = _wiki_qid_from_title(cand)
        if not qid:
            continue
        en = _wikidata_label_from_qid(qid)
        if en:
            # 결과 라벨이 ASCII 위주여야 (한국어 라벨이면 의미 없음)
            ascii_ratio = sum(1 for c in en if ord(c) < 128) / max(len(en), 1)
            if ascii_ratio > 0.7:
                return _attach_group(en), 'wikidata:search'

    # 전략 3: 한국어 로마자화 (마지막 폴백)
    rom = romanize_korean_name(base_name)
    if rom:
        return _attach_group(rom), 'romanized'

    return None, 'no match'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--limit', type=int, default=0, help='책 제목 최대 처리 행 수 (0=무제한)')
    ap.add_argument('--celeb-limit', type=int, default=0, help='셀럽 이름 최대 처리 수 (0=무제한)')
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--refresh', action='store_true', help='?접두사 제안도 재조회')
    ap.add_argument('--sleep', type=float, default=0.3, help='요청 간격(초)')
    ap.add_argument('--skip-books', action='store_true', help='책 제목 조회 건너뛰기')
    ap.add_argument('--skip-celebs', action='store_true', help='셀럽 이름 조회 건너뛰기')
    args = ap.parse_args()

    with open('data.csv', encoding='utf-8', newline='') as f:
        rows = list(csv.reader(f))

    headers = rows[0]
    try:
        col_name   = headers.index('연예인')
        col_name_en = headers.index('연예인_en')
        col_title  = headers.index('도서명')
        col_title_en = headers.index('도서명_en')
        col_author = headers.index('저자')
    except ValueError as e:
        print(f"❌ CSV에 필요한 컬럼이 없습니다: {e}")
        print(f"  현재 헤더: {headers}")
        sys.exit(1)

    # 저자_en 컬럼 (옵션)
    col_author_en = headers.index('저자_en') if '저자_en' in headers else None

    # ── 1. 책 제목 + 작가 영문 조회 ───────────────────────────────
    book_processed = book_filled = book_skipped = 0
    author_filled = 0
    seen_titles = {}  # (title_ko, author_ko) → (title_en, author_en, src)

    if not args.skip_books:
        print("\n=== 책 제목 (도서명_en) + 작가 (저자_en) ===")
        for i, row in enumerate(rows[1:], start=1):
            while len(row) < len(headers):
                row.append('')

            title_ko  = row[col_title].strip()
            author_ko = row[col_author].strip()
            existing  = row[col_title_en].strip()

            if not title_ko:
                continue

            need_title  = not existing or (existing.startswith('?') and args.refresh)
            existing_au = row[col_author_en].strip() if col_author_en is not None else ''
            need_author = (col_author_en is not None and author_ko
                           and (not existing_au or (existing_au.startswith('?') and args.refresh)))

            if not need_title and not need_author:
                book_skipped += 1
                continue

            # 검수 완료된 영문 작가가 있으면 그걸 검색에 활용 (전략 1~3)
            confirmed_author_en = (existing_au if existing_au and not existing_au.startswith('?') else None)

            if args.limit and book_processed >= args.limit:
                break

            cache_key = (title_ko, author_ko, confirmed_author_en)
            if cache_key in seen_titles:
                t, a, src = seen_titles[cache_key]
            else:
                t, a, src = find_en_title(title_ko, author_ko, confirmed_author_en)
                seen_titles[cache_key] = (t, a, src)
                time.sleep(args.sleep)

            book_processed += 1
            if need_title and t:
                row[col_title_en] = '?' + t
                book_filled += 1
            if need_author and a:
                row[col_author_en] = '?' + a
                author_filled += 1
            if t or a:
                msg = []
                if t: msg.append(f"title=?{t}")
                if a: msg.append(f"author=?{a}")
                print(f"  [{i:4d}] {title_ko} / {author_ko} → {', '.join(msg)}  ({src})")
            else:
                print(f"  [{i:4d}] {title_ko} → (no match)")

        print(f"책 제목: 처리 {book_processed}, 채움 {book_filled}, 작가 채움 {author_filled}, 건너뜀 {book_skipped}")

    # ── 2. 셀럽 영문명 조회 (Wikipedia/Wikidata) ──────────────────
    celeb_processed = celeb_filled = celeb_skipped = 0
    seen_celebs = {}  # name_ko → (name_en, src)

    if not args.skip_celebs:
        print("\n=== 셀럽 이름 (연예인_en) ===")
        # 동일 셀럽이 여러 행에 등장하므로, 한 번 조회한 결과를 모든 행에 적용
        for i, row in enumerate(rows[1:], start=1):
            while len(row) < len(headers):
                row.append('')

            name_ko  = row[col_name].strip()
            existing = row[col_name_en].strip()

            if not name_ko:
                continue

            if existing and not existing.startswith('?'):
                celeb_skipped += 1
                continue
            if existing.startswith('?') and not args.refresh:
                celeb_skipped += 1
                continue

            if args.celeb_limit and celeb_processed >= args.celeb_limit:
                break

            if name_ko in seen_celebs:
                en, src = seen_celebs[name_ko]
            else:
                en, src = lookup_celeb_en(name_ko)
                seen_celebs[name_ko] = (en, src)
                time.sleep(args.sleep)

            celeb_processed += 1
            if en:
                row[col_name_en] = '?' + en
                celeb_filled += 1
                print(f"  [{i:4d}] {name_ko} → ?{en}  ({src})")
            else:
                print(f"  [{i:4d}] {name_ko} → (no match: {src})")

        print(f"셀럽 이름: 처리 {celeb_processed}, 채움 {celeb_filled}, 건너뜀 {celeb_skipped}")

    if args.dry_run:
        print("\n--dry-run: data.csv 변경 안 함")
        return

    with open('data.csv', 'w', encoding='utf-8', newline='') as f:
        w = csv.writer(f)
        w.writerow(headers)
        for r in rows[1:]:
            while len(r) < len(headers):
                r.append('')
            w.writerow(r)
    print(f"\n✅ data.csv 업데이트 완료. ?접두사 제안값을 검수 후 ? 를 제거하세요.")


if __name__ == '__main__':
    main()
