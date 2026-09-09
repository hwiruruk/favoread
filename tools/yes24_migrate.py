"""
data.csv의 알라딘 상품 링크·표지 이미지를 예스24로 자동 교체하는 스크립트.

enrich_en.py와 같은 방식: 자동 처리 + 사람 검수 병행.
  - 도서명(+저자)으로 예스24 상품 검색(itemList) → 제목이 정확히 일치하고
    저자도 겹치는 경우에만 "확신" 판정 → data.csv의 링크·표지를 예스24로 교체.
  - 그 외(제목 불일치, 저자 불일치, 검색 결과 없음, API 오류)는 CSV를 건드리지
    않고 그대로 두며, 검토용 리포트(tools/yes24-migration-review.md)에 후보와
    함께 기록. 잘못된 책으로 링크가 바뀌는 사고를 막기 위한 안전장치.
  - 이미 예스24 링크인 행은 건너뜀 (재실행해도 중복 처리 안 함).

예스24 Open API는 X-Api-Key 헤더 인증이라 브라우저에서 직접 못 부르는 것과
마찬가지로, 이 스크립트도 직접 apis.yes24.com을 호출하지 않는다. 대신
tools/yes24-proxy/의 Cloudflare Worker를 거친다 — API Key는 Worker
환경변수에만 있고 이 스크립트·GitHub Actions 어디에도 필요 없다. 스크립트는
그 Worker의 URL만 알면 된다(환경변수 YES24_PROXY_URL).

사용법:
  YES24_PROXY_URL=https://yes24-proxy.xxx.workers.dev python3 tools/yes24_migrate.py [옵션]

옵션:
  --limit N     : 최대 처리 행 수 (0=무제한)
  --dry-run     : CSV에 쓰지 않고 결과만 출력
  --sleep S     : 요청 간격(초, 기본 0.15 — 예스24 초당 10회 한도 대비 여유)
"""
import csv, json, os, re, sys, time, urllib.parse, urllib.request, urllib.error, argparse

REVIEW_REPORT_PATH = 'tools/yes24-migration-review.md'


def find_col(headers, keywords, fallback_idx):
    for i, h in enumerate(headers):
        for kw in keywords:
            if kw in h:
                return i
    return fallback_idx


def normalize_title(s):
    """비교용 정규화: 공백·구두점 제거, 소문자화. '해리포터: 마법사의 돌'과
    '해리포터 마법사의돌' 같은 표기 차이를 흡수한다."""
    s = (s or '').lower()
    s = re.sub(r'[\s:,\.\-\(\)\[\]·"\'!?~]', '', s)
    return s


def author_overlaps(author_ko, candidate_author):
    """저자 필드가 하나라도 겹치면 True. 예스24 저자 필드가 역할 표기 없이
    단일 문자열로 오므로, 2자 이상 토큰 단위로 부분 포함 여부만 확인."""
    if not author_ko:
        return True  # 원본에 저자가 없으면 저자 불일치로 거를 수 없으니 통과
    cand = (candidate_author or '')
    tokens = re.split(r'[,·/&]| 및 | 외 ', author_ko)
    for t in tokens:
        t = t.strip()
        if len(t) >= 2 and t in cand:
            return True
    return False


def yes24_search(base_url, query, timeout=10):
    p = urllib.parse.urlencode({'query': query, 'category': 'BOOK', 'pageSize': '5', 'detail': 'N'})
    url = f"{base_url.rstrip('/')}/goods/itemList?{p}"
    req = urllib.request.Request(url, headers={'Accept': 'application/json', 'User-Agent': 'favoread-yes24-migrate/1.0'})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body = json.loads(r.read())
    except urllib.error.HTTPError as e:
        try:
            body = json.loads(e.read())
        except Exception:
            return None, f"HTTP {e.code}"
        if body.get('errorCode') == 'SEARCH_001':
            return [], None  # 검색 결과 0건 — 정상 응답으로 취급
        return None, f"{body.get('errorCode')}: {body.get('message')}"
    except Exception as e:
        return None, str(e)
    if not body.get('success'):
        return None, f"{body.get('errorCode')}: {body.get('message')}"
    items = (body.get('data') or {}).get('items') or []
    return items, None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--limit', type=int, default=0, help='최대 처리 행 수 (0=무제한)')
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--sleep', type=float, default=0.15, help='요청 간격(초)')
    args = ap.parse_args()

    base_url = os.environ.get('YES24_PROXY_URL', '').strip()
    if not base_url:
        print("❌ 환경변수 YES24_PROXY_URL이 설정되지 않았습니다. (Cloudflare Worker 주소)")
        sys.exit(1)

    with open('data.csv', encoding='utf-8', newline='') as f:
        rows = list(csv.reader(f))
    headers = rows[0]

    col_title    = find_col(headers, ['도서명'], 2)
    col_author   = find_col(headers, ['저자'], 4)
    col_link     = find_col(headers, ['도서 정보', '링크'], 8)
    col_cover    = find_col(headers, ['도서 이미지', '표지'], 9)
    col_name     = find_col(headers, ['연예인'], 0)

    processed = matched = reviewed = skipped_existing = 0
    review_rows = []  # (연예인, 도서명, 저자, 기존링크, 후보정보, 사유)
    # title_ko|author_ko → (matched_item|None, candidate_for_review|None, reason|None)
    cache = {}

    def lookup(title_ko, author_ko):
        """반환: (matched_item, candidate, reason).
        matched_item이 있으면 확신 매칭(자동 교체용). 없으면 candidate(있을 수도, 없을
        수도)와 reason으로 검토 리포트에 남긴다."""
        items, err = yes24_search(base_url, title_ko)
        time.sleep(args.sleep)
        if err:
            return None, None, f"API 오류: {err}"
        if not items:
            return None, None, "검색 결과 없음"

        norm_title = normalize_title(title_ko)
        exact = [it for it in items if normalize_title(it.get('title', '')) == norm_title]
        if not exact:
            return None, items[0], f"제목 불일치 (최상위 후보: {items[0].get('title','')})"

        good = next((it for it in exact if author_overlaps(author_ko, it.get('author', ''))), None)
        if good:
            return good, None, None
        return None, exact[0], f"제목은 일치하나 저자 불일치 (예스24: {exact[0].get('author','')})"

    for i, row in enumerate(rows[1:], start=1):
        while len(row) < len(headers):
            row.append('')

        title_ko  = row[col_title].strip()
        author_ko = row[col_author].strip()
        link      = row[col_link].strip()

        if not title_ko:
            continue
        if 'yes24.com' in link.lower():
            skipped_existing += 1
            continue
        if args.limit and processed >= args.limit:
            break

        cache_key = (title_ko, author_ko)
        if cache_key not in cache:
            cache[cache_key] = lookup(title_ko, author_ko)
        matched_item, candidate, reason = cache[cache_key]
        processed += 1

        if matched_item:
            new_link = matched_item.get('link', '')
            new_cover = matched_item.get('cover', '')
            if new_link:
                row[col_link] = new_link
            if new_cover:
                row[col_cover] = new_cover
            matched += 1
            print(f"  [{i:4d}] ✅ {title_ko} → {new_link}")
        else:
            reviewed += 1
            candidate_note = ''
            if candidate:
                candidate_note = f"{candidate.get('title','')} / {candidate.get('author','')} / {candidate.get('link','')}"
            review_rows.append((row[col_name], title_ko, author_ko, link, candidate_note, reason))
            print(f"  [{i:4d}] ⏭️  {title_ko} — {reason}")

    print(f"\n총 처리 {processed}행 · 자동 교체 {matched} · 검토 필요 {reviewed} · 이미 예스24 {skipped_existing}")

    # 검토 리포트 작성 (검토 대상이 없어도 "없음" 상태로 덮어써서 이전 실행 결과가 남지 않게 함)
    with open(REVIEW_REPORT_PATH, 'w', encoding='utf-8') as f:
        f.write('# 예스24 링크 자동 교체 — 검토 필요 목록\n\n')
        f.write(f'자동 교체 {matched}건, 검토 필요 {reviewed}건, 이미 예스24 링크라 건너뜀 {skipped_existing}건.\n\n')
        if review_rows:
            f.write('| 연예인 | 도서명 | 저자 | 기존 링크 | 예스24 후보 (제목/저자/링크) | 사유 |\n')
            f.write('|---|---|---|---|---|---|\n')
            for celeb, title, author, old_link, cand, reason in review_rows:
                f.write(f'| {celeb} | {title} | {author} | {old_link} | {cand} | {reason} |\n')
            f.write('\n확인 후 맞는 책이면 편집기에서 "예스24 검색"으로 직접 조회해 링크를 반영하세요. '
                    '후보가 실제로 맞으면 이 표의 "예스24 후보" 링크를 data.csv의 해당 행에 직접 붙여넣어도 됩니다.\n')
        else:
            f.write('검토 필요한 항목이 없습니다.\n')

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
    print(f"✅ data.csv 업데이트 완료. 검토 리포트: {REVIEW_REPORT_PATH}")


if __name__ == '__main__':
    main()
