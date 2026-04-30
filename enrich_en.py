"""
data.csv의 영문 메타데이터(`연예인_en`, `도서명_en`)를 자동/수동 하이브리드로 채우는 스크립트.

워크플로우:
  1. 로컬에서 `python3 enrich_en.py` 실행
  2. 비어있는 `도서명_en`에 대해 Google Books → Open Library 순으로 영문 제목 탐색
  3. 자동 제안값은 `?` 접두사를 붙여 사람이 검수해야 함을 명시 (예: `?The Vegetarian`)
  4. 사람이 CSV를 열어 검수 후 `?` 제거 → 빌드시 정식 제목으로 사용
  5. `연예인_en`은 자동화 정확도가 낮아 자동 채움 안 함 (수동 입력)

옵션:
  --limit N    : 최대 N개 행만 처리 (기본 무제한)
  --dry-run    : CSV에 쓰지 않고 결과만 출력
  --refresh    : `?` 접두사 붙은 기존 제안도 다시 조회

빈 칸으로 두면 해당 행은 영문 페이지에 노출되지 않습니다.
"""
import csv, json, sys, time, urllib.parse, urllib.request, argparse

GOOGLE_BOOKS_API = "https://www.googleapis.com/books/v1/volumes"
OPEN_LIBRARY_API = "https://openlibrary.org/search.json"


def http_get_json(url, timeout=10):
    req = urllib.request.Request(url, headers={'User-Agent': 'favoread-enrich/1.0'})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


def lookup_google_books(title_ko, author_ko):
    """Google Books에서 한국어 제목으로 검색 → 영문판이 있으면 그 제목 반환."""
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
        return None, f"google_books error: {e}"

    for item in data.get('items', []):
        info = item.get('volumeInfo', {})
        if info.get('language') != 'en':
            continue
        t = info.get('title')
        if not t:
            continue
        # subtitle이 있으면 합침
        subtitle = info.get('subtitle')
        if subtitle:
            t = t + ': ' + subtitle
        return t, None
    return None, "google_books no en match"


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
    """두 소스 순차 시도. 결과는 (title|None, source|None)."""
    t, _err = lookup_google_books(title_ko, author_ko)
    if t:
        return t, 'google_books'
    t, _err = lookup_open_library(title_ko, author_ko)
    if t:
        return t, 'open_library'
    return None, None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--limit', type=int, default=0, help='최대 처리 행 수 (0=무제한)')
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--refresh', action='store_true', help='?접두사 제안도 재조회')
    ap.add_argument('--sleep', type=float, default=0.3, help='요청 간격(초)')
    args = ap.parse_args()

    with open('data.csv', encoding='utf-8', newline='') as f:
        rows = list(csv.reader(f))

    headers = rows[0]
    try:
        col_name   = headers.index('연예인')
        col_title  = headers.index('도서명')
        col_title_en = headers.index('도서명_en')
        col_author = headers.index('저자')
    except ValueError as e:
        print(f"❌ CSV에 필요한 컬럼이 없습니다: {e}")
        print(f"  현재 헤더: {headers}")
        sys.exit(1)

    processed = filled = skipped = 0
    seen_titles = {}  # 중복 책 제목은 첫 결과 재사용

    for i, row in enumerate(rows[1:], start=1):
        while len(row) < len(headers):
            row.append('')

        title_ko  = row[col_title].strip()
        author_ko = row[col_author].strip()
        existing  = row[col_title_en].strip()

        if not title_ko:
            continue

        # 이미 사람이 확정한 값(? 없음)은 건드리지 않음
        if existing and not existing.startswith('?'):
            skipped += 1
            continue
        # ? 제안값은 --refresh일 때만 다시 조회
        if existing.startswith('?') and not args.refresh:
            skipped += 1
            continue

        if args.limit and processed >= args.limit:
            break

        # 같은 책 제목+저자 조합은 캐시
        cache_key = (title_ko, author_ko)
        if cache_key in seen_titles:
            t, src = seen_titles[cache_key]
        else:
            t, src = find_en_title(title_ko, author_ko)
            seen_titles[cache_key] = (t, src)
            time.sleep(args.sleep)

        processed += 1
        if t:
            row[col_title_en] = '?' + t
            filled += 1
            print(f"  [{i:4d}] {title_ko} → ?{t}  ({src})")
        else:
            print(f"  [{i:4d}] {title_ko} → (no match)")

    print(f"\n처리: {processed}, 채움: {filled}, 건너뜀(기존값): {skipped}")

    if args.dry_run:
        print("--dry-run: data.csv 변경 안 함")
        return

    with open('data.csv', 'w', encoding='utf-8', newline='') as f:
        w = csv.writer(f)
        w.writerow(headers)
        for r in rows[1:]:
            while len(r) < len(headers):
                r.append('')
            w.writerow(r)
    print(f"✅ data.csv 업데이트 완료. ?접두사 제안값을 검수 후 ? 를 제거하세요.")


if __name__ == '__main__':
    main()
