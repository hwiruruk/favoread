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


def lookup_google_books(title_ko, author_ko):
    """Google Books에서 한국어 제목으로 검색 → (title, authors) 반환."""
    q_parts = ['intitle:' + title_ko]
    if author_ko:
        q_parts.append('inauthor:' + author_ko)
    params = {
        'q': ' '.join(q_parts),
        'langRestrict': 'en',
        'maxResults': '5',
    }
    url = GOOGLE_BOOKS_API + '?' + urllib.parse.urlencode(params)
    try:
        data = http_get_json(url)
    except Exception as e:
        return None, None, f"google_books error: {e}"

    for item in data.get('items', []):
        info = item.get('volumeInfo', {})
        if info.get('language') != 'en':
            continue
        t = info.get('title')
        if not t:
            continue
        subtitle = info.get('subtitle')
        if subtitle:
            t = t + ': ' + subtitle
        authors = info.get('authors') or []
        author_en = ', '.join(authors) if authors else None
        return t, author_en, None
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


def find_en_title(title_ko, author_ko):
    """두 소스 순차 시도. 결과는 (title|None, author_en|None, source|None)."""
    t, a, _err = lookup_google_books(title_ko, author_ko)
    if t:
        return t, a, 'google_books'
    t, _err = lookup_open_library(title_ko, author_ko)
    if t:
        return t, None, 'open_library'
    return None, None, None


def lookup_celeb_en(name_ko):
    """한국어 위키피디아에서 인물 페이지 → Wikidata Q-id → 영문 라벨.

    한국 연예인은 대부분 한국어 위키 페이지가 있고, 거기에 Wikidata link가 걸려있음.
    그룹 표기가 포함된 경우 (예: '아이린(레드벨벳)') 괄호 부분 제거 후 시도.
    """
    # 그룹/괄호 제거: '아이린(레드벨벳)' → '아이린', 'V(BTS)' → 'V'
    base_name = name_ko.split('(')[0].strip()

    # 1. 한국어 Wikipedia에서 페이지 검색 (정확 매칭)
    params = {
        'action': 'query',
        'format': 'json',
        'titles': base_name,
        'prop': 'pageprops',
        'redirects': '1',
    }
    url = KO_WIKI_API + '?' + urllib.parse.urlencode(params)
    try:
        data = http_get_json(url)
    except Exception as e:
        return None, f'wiki error: {e}'

    pages = (data.get('query') or {}).get('pages') or {}
    qid = None
    for _pid, p in pages.items():
        pp = p.get('pageprops') or {}
        if pp.get('wikibase_item'):
            qid = pp['wikibase_item']
            break

    if not qid:
        return None, 'no wikidata link'

    # 2. Wikidata에서 영문 라벨 조회
    params2 = {
        'action': 'wbgetentities',
        'format': 'json',
        'ids': qid,
        'props': 'labels',
        'languages': 'en',
    }
    url2 = WIKIDATA_API + '?' + urllib.parse.urlencode(params2)
    try:
        data2 = http_get_json(url2)
    except Exception as e:
        return None, f'wikidata error: {e}'

    entity = (data2.get('entities') or {}).get(qid) or {}
    labels = entity.get('labels') or {}
    en_label = (labels.get('en') or {}).get('value')
    if not en_label:
        return None, 'no en label'

    # 그룹 정보를 괄호로 부기 (원래 한국어에 있었으면)
    if '(' in name_ko and ')' in name_ko:
        group = name_ko[name_ko.find('(')+1:name_ko.rfind(')')].strip()
        if group and group not in en_label:
            en_label = en_label + ' (' + group + ')'

    return en_label, 'wikidata'


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

            if args.limit and book_processed >= args.limit:
                break

            cache_key = (title_ko, author_ko)
            if cache_key in seen_titles:
                t, a, src = seen_titles[cache_key]
            else:
                t, a, src = find_en_title(title_ko, author_ko)
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
