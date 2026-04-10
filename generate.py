import csv, datetime, os, json, re, html
from urllib.parse import quote

BASE = "https://hwiruruk.github.io/favoread/"
TODAY = datetime.date.today().isoformat()

LINK_CLASS = (
    'inline-block px-3 py-1.5 border-2 border-ink rounded-none '
    'bg-white hover:bg-neo-yellow shadow-neo-sm hover:shadow-neo '
    'hover:-translate-y-0.5 transition-all text-[11px] sm:text-xs '
    'font-bold font-sans text-ink'
)

# ── 유틸리티 함수 ────────────────────────────────────────────────────

def esc(text):
    """HTML 특수문자 이스케이프"""
    return html.escape(text, quote=True)

def esc_xml(text):
    """XML용 이스케이프 (sitemap/feed)"""
    return (text
        .replace('&', '&amp;')
        .replace('<', '&lt;')
        .replace('>', '&gt;')
        .replace('"', '&quot;')
        .replace("'", '&apos;'))

def safe_filename(name):
    """파일명 안전 변환"""
    return name.replace('/', '_').replace('\\', '_')

def safe_book_filename(title):
    """책 제목 → 안전한 파일명"""
    return title.replace('/', '_').replace('\\', '_').replace(':', '_').replace('"', '_').replace('?', '_')

def make_celeb_url(name):
    """셀럽 share 페이지 URL"""
    return BASE + 'share/' + quote(safe_filename(name), safe='') + '.html'

def make_book_url(title):
    """책 share 페이지 URL"""
    return BASE + 'share/book/' + quote(safe_book_filename(title), safe='') + '.html'

# ── 1. CSV 파싱 ──────────────────────────────────────────────────────

celebs = {}

with open("data.csv", encoding="utf-8") as f:
    reader = csv.reader(f)
    headers = next(reader)

    def find_col(keywords, fallback):
        for i, h in enumerate(headers):
            if any(w in h.lower() for w in keywords):
                return i
        return fallback

    C = {
        'name':    find_col(['연예인', '이름', '인물'], 0),
        'title':   find_col(['도서명', '제목', '책'], 1),
        'author':  find_col(['저자', '작가'], 2),
        'pub':     find_col(['출판사'], 3),
        'src':     find_col(['출처', '근거'], 4),
        'link':    find_col(['도서 정보', '링크', 'url'], 5),
        'cover':   find_col(['도서 이미지', '표지'], 6),
        'img':     find_col(['연예인이미지', 'photo', '이미지주소'], 7),
        'comment': find_col(['코멘트', '한마디'], 8),
    }

    for row in reader:
        if not row or not row[C['name']].strip():
            continue
        name  = row[C['name']].strip()
        title = row[C['title']].strip() if len(row) > C['title'] else ''
        if not title:
            continue

        def get(col):
            return row[col].strip() if len(row) > col else ''

        img_url = get(C['img'])
        if not img_url.startswith('http'):
            img_url = BASE + 'og-image.jpg'

        if name not in celebs:
            celebs[name] = {'img': img_url, 'books': []}

        celebs[name]['books'].append({
            'title':     title,
            'author':    get(C['author']),
            'publisher': get(C['pub']),
            'source':    get(C['src']),
            'link':      get(C['link']),
            'coverUrl':  get(C['cover']),
            'comment':   get(C['comment']),
        })

print(f"CSV 파싱 완료: {len(celebs)}명")

# ── 2. data.json 생성 ────────────────────────────────────────────────

data_json = {
    'generated': TODAY,
    'celebs': {
        name: {
            'imageUrl': info['img'],
            'books':    info['books'],
        }
        for name, info in celebs.items()
    }
}

with open('data.json', 'w', encoding='utf-8') as f:
    json.dump(data_json, f, ensure_ascii=False, separators=(',', ':'))
print(f"✅ data.json 생성: {os.path.getsize('data.json') // 1024}KB")

# ── 3. index.html 정적 셀럽 목록 갱신 ───────────────────────────────

sorted_names = sorted(celebs.keys(), key=lambda x: x.lower())

new_links = '\n'.join(
    '    <a href="share/' + quote(safe_filename(n), safe='') + '.html" class="' + LINK_CLASS + '">' + n + '</a>'
    for n in sorted_names
)

with open('index.html', 'r', encoding='utf-8') as f:
    idx_html = f.read()

idx_html = re.sub(
    r'등록된 셀럽 · 아이돌 · 배우 전체 목록 \d+명',
    '등록된 셀럽 · 아이돌 · 배우 전체 목록 ' + str(len(celebs)) + '명',
    idx_html
)

idx_html = re.sub(
    r'(<div id="all-celebs-container"[^>]*>).*?(</div>\s*</section>\s*</main>)',
    lambda m: m.group(1) + '\n' + new_links + '\n    ' + m.group(2),
    idx_html,
    flags=re.DOTALL
)

# JS 에러 핸들링 패치: renderDynamicSections/setupQuiz 에러가
# "목록 파일을 찾을 수 없습니다" 메시지를 덮어쓰지 않도록 개별 try-catch 처리
patched = re.sub(
    r'renderDynamicSections\(\);\s*setupQuiz\(\);',
    'try { renderDynamicSections(); } catch(e) { console.warn("renderDynamicSections:", e); }\n        try { setupQuiz(); } catch(e) { console.warn("setupQuiz:", e); }',
    idx_html,
    count=1
)
if patched != idx_html:
    idx_html = patched
    print("✅ JS 에러 핸들링 패치 적용")
else:
    print("⚠️ JS 패치 대상을 찾지 못함 (이미 적용되었거나 구조가 다름)")

with open('index.html', 'w', encoding='utf-8') as f:
    f.write(idx_html)
print(f"✅ index.html 정적 목록 갱신: {len(sorted_names)}명")

# ── 4. share 페이지 생성 (SEO 강화) ─────────────────────────────────

os.makedirs('share', exist_ok=True)

# sitemap 이미지 정보 수집용
sitemap_images = {}  # { url: [image_url, ...] }

for name, info in celebs.items():
    img   = info['img']
    books = info['books']
    safe  = quote(name, safe='')
    fn    = safe_filename(name)
    page_url    = make_celeb_url(name)
    redirect_url = BASE + '?celeb=' + safe

    # 이미지 수집
    page_images = []
    if img and img.startswith('http'):
        page_images.append(img)
    for b in books:
        if b['coverUrl'] and b['coverUrl'].startswith('http'):
            page_images.append(b['coverUrl'])
    sitemap_images[page_url] = page_images

    # 책 목록 (최대 10권만 description에 포함)
    book_names_for_desc = ', '.join(esc(b['title']) for b in books[:10])
    if len(books) > 10:
        book_names_for_desc += ' 외 ' + str(len(books) - 10) + '권'

    desc_text = esc(name) + '이(가) 읽거나 추천한 책 ' + str(len(books)) + '권: ' + book_names_for_desc

    json_ld = {
        '@context': 'https://schema.org',
        '@type': 'ProfilePage',
        'name': name + '의 독서 리스트 | 최애의 독서',
        'url': page_url,
        'description': name + '이(가) 읽거나 추천한 책 ' + str(len(books)) + '권',
        'mainEntity': {
            '@type': 'Person',
            'name': name,
            'image': img,
            'description': name + '이(가) 읽거나 추천한 책 ' + str(len(books)) + '권',
            'knowsAbout': {
                '@type': 'ItemList',
                'numberOfItems': len(books),
                'itemListElement': [
                    {
                        '@type': 'ListItem',
                        'position': i + 1,
                        'name': b['title'],
                        'item': {
                            '@type': 'Book',
                            'name': b['title'],
                            'author': {'@type': 'Person', 'name': b['author']} if b['author'] else None,
                            'publisher': {'@type': 'Organization', 'name': b['publisher']} if b['publisher'] else None,
                        }
                    }
                    for i, b in enumerate(books)
                ]
            }
        },
        'isPartOf': {
            '@type': 'WebSite',
            'name': '최애의 독서',
            'url': BASE
        }
    }

    # JSON-LD에서 None 값 정리
    def clean_none(obj):
        if isinstance(obj, dict):
            return {k: clean_none(v) for k, v in obj.items() if v is not None}
        if isinstance(obj, list):
            return [clean_none(i) for i in obj]
        return obj

    json_ld = clean_none(json_ld)

    # 책 테이블 행 (이미지 포함)
    book_rows = ''
    for i, b in enumerate(books):
        cover_td = ''
        if b['coverUrl'] and b['coverUrl'].startswith('http'):
            cover_td = '<img src="' + esc(b['coverUrl']) + '" alt="' + esc(b['title']) + ' 표지" width="60" height="85" loading="lazy" style="object-fit:cover">'
        book_rows += (
            '    <tr>'
            '<td>' + str(i+1) + '</td>'
            '<td>' + cover_td + '</td>'
            '<td>' + esc(b['title']) + '</td>'
            '<td>' + esc(b['author']) + '</td>'
            '<td>' + esc(b['publisher']) + '</td>'
            '</tr>\n'
        )

    page = (
        '<!DOCTYPE html>\n'
        '<html lang="ko">\n'
        '<head>\n'
        '  <meta charset="utf-8">\n'
        '  <meta name="viewport" content="width=device-width, initial-scale=1">\n'
        '  <title>' + esc(name) + '의 독서 리스트 | 최애의 독서</title>\n'
        '  <meta name="description" content="' + desc_text + '">\n'
        '  <meta name="keywords" content="' + esc(name) + ', 독서, 책추천, 읽은책, 인생책, 셀럽독서, 최애의 독서">\n'
        '\n'
        '  <!-- Open Graph -->\n'
        '  <meta property="og:title" content="' + esc(name) + ' | 최애의 독서">\n'
        '  <meta property="og:description" content="' + desc_text + '">\n'
        '  <meta property="og:image" content="' + esc(img) + '">\n'
        '  <meta property="og:image:width" content="600">\n'
        '  <meta property="og:image:height" content="600">\n'
        '  <meta property="og:image:alt" content="' + esc(name) + '의 독서 리스트">\n'
        '  <meta property="og:url" content="' + esc(page_url) + '">\n'
        '  <meta property="og:type" content="profile">\n'
        '  <meta property="og:site_name" content="최애의 독서">\n'
        '  <meta property="og:locale" content="ko_KR">\n'
        '\n'
        '  <!-- Twitter Card -->\n'
        '  <meta name="twitter:card" content="summary_large_image">\n'
        '  <meta name="twitter:title" content="' + esc(name) + ' | 최애의 독서">\n'
        '  <meta name="twitter:description" content="' + desc_text + '">\n'
        '  <meta name="twitter:image" content="' + esc(img) + '">\n'
        '  <meta name="twitter:image:alt" content="' + esc(name) + '의 독서 리스트">\n'
        '\n'
        '  <link rel="canonical" href="' + esc(page_url) + '">\n'
        '  <link rel="icon" href="' + BASE + 'favicon.png" type="image/png">\n'
        '\n'
        '  <script type="application/ld+json">\n'
        '  ' + json.dumps(json_ld, ensure_ascii=False, indent=2) + '\n'
        '  </script>\n'
        '\n'
        '  <style>\n'
        '    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; color: #333; }\n'
        '    .celeb-header { display: flex; align-items: center; gap: 20px; margin-bottom: 24px; }\n'
        '    .celeb-img { width: 120px; height: 120px; border-radius: 50%; object-fit: cover; }\n'
        '    table { width: 100%; border-collapse: collapse; }\n'
        '    th, td { border: 1px solid #ddd; padding: 8px; text-align: left; font-size: 14px; }\n'
        '    th { background: #f5f5f5; }\n'
        '    a { color: #2563eb; }\n'
        '  </style>\n'
        '</head>\n'
        '<body>\n'
        '  <nav><a href="' + BASE + '">← 최애의 독서 홈</a></nav>\n'
        '\n'
        '  <div class="celeb-header">\n'
        '    <img class="celeb-img" src="' + esc(img) + '" alt="' + esc(name) + ' 프로필 사진" width="120" height="120">\n'
        '    <div>\n'
        '      <h1>' + esc(name) + '의 독서 리스트</h1>\n'
        '      <p>' + esc(name) + '이(가) 읽거나 추천한 책 <strong>' + str(len(books)) + '권</strong>입니다.</p>\n'
        '    </div>\n'
        '  </div>\n'
        '\n'
        '  <table>\n'
        '    <thead><tr><th>#</th><th>표지</th><th>도서명</th><th>저자</th><th>출판사</th></tr></thead>\n'
        '    <tbody>\n'
        + book_rows +
        '    </tbody>\n'
        '  </table>\n'
        '\n'
        '  <p style="margin-top:24px"><a href="' + redirect_url + '">최애의 독서에서 ' + esc(name) + ' 전체 목록 보기 →</a></p>\n'
        '\n'
        '  <script>\n'
        '    if (!/bot|crawl|spider|googlebot|bingbot|yandex|naver|daum/i.test(navigator.userAgent)) {\n'
        '      window.location.replace("' + redirect_url + '");\n'
        '    }\n'
        '  </script>\n'
        '</body>\n'
        '</html>'
    )

    with open('share/' + fn + '.html', 'w', encoding='utf-8') as f:
        f.write(page)

print(f"✅ share 페이지 생성: {len(celebs)}개")

# ── 5. 책 역방향 페이지 (share/book/*.html) ──────────────────────────

os.makedirs('share/book', exist_ok=True)

book_celebs = {}
for name, info in celebs.items():
    seen = set()
    for b in info['books']:
        t = b['title'].strip()
        if t in seen:
            continue
        seen.add(t)
        if t not in book_celebs:
            book_celebs[t] = {
                'celebs': [], 'author': b['author'],
                'publisher': b['publisher'],
                'coverUrl': b.get('coverUrl', '')
            }
        book_celebs[t]['celebs'].append(name)

book_pages = []

for title, binfo in book_celebs.items():
    if len(binfo['celebs']) < 2:
        continue

    fn       = safe_book_filename(title)
    page_url = make_book_url(title)
    celeb_count = len(binfo['celebs'])

    celeb_names_str = ', '.join(esc(c) for c in sorted(binfo['celebs']))

    celeb_rows = '\n'.join(
        '    <li><a href="../' + quote(safe_filename(c), safe='') + '.html">' + esc(c) + '</a></li>'
        for c in sorted(binfo['celebs'])
    )

    cover_html = ''
    if binfo['coverUrl'] and binfo['coverUrl'].startswith('http'):
        cover_html = (
            '  <img src="' + esc(binfo['coverUrl']) + '" alt="' + esc(title) + ' 표지"'
            ' width="200" height="280" loading="lazy" style="object-fit:cover; margin:16px 0">\n'
        )

    desc_text = esc(title) + '을(를) ' + str(celeb_count) + '명의 셀럽이 읽었습니다: ' + celeb_names_str

    json_ld = {
        '@context': 'https://schema.org',
        '@type': 'Book',
        'name': title,
        'description': str(celeb_count) + '명의 셀럽이 읽은 책',
    }
    if binfo['author']:
        json_ld['author'] = {'@type': 'Person', 'name': binfo['author']}
    if binfo['publisher']:
        json_ld['publisher'] = {'@type': 'Organization', 'name': binfo['publisher']}
    if binfo['coverUrl'] and binfo['coverUrl'].startswith('http'):
        json_ld['image'] = binfo['coverUrl']

    page = (
        '<!DOCTYPE html>\n'
        '<html lang="ko">\n'
        '<head>\n'
        '  <meta charset="utf-8">\n'
        '  <meta name="viewport" content="width=device-width, initial-scale=1">\n'
        '  <title>' + esc(title) + ' - ' + str(celeb_count) + '명의 셀럽이 읽은 책 | 최애의 독서</title>\n'
        '  <meta name="description" content="' + desc_text + '">\n'
        '  <meta name="keywords" content="' + esc(title) + ', ' + esc(binfo['author']) + ', 셀럽독서, 책추천, 최애의 독서">\n'
        '\n'
        '  <meta property="og:title" content="' + esc(title) + ' | ' + str(celeb_count) + '명의 셀럽이 읽은 책">\n'
        '  <meta property="og:description" content="' + celeb_names_str + ' 등 ' + str(celeb_count) + '명이 읽은 책">\n'
        '  <meta property="og:url" content="' + esc(page_url) + '">\n'
        '  <meta property="og:type" content="book">\n'
        '  <meta property="og:site_name" content="최애의 독서">\n'
        '  <meta property="og:locale" content="ko_KR">\n'
        + ('  <meta property="og:image" content="' + esc(binfo['coverUrl']) + '">\n' if binfo['coverUrl'] and binfo['coverUrl'].startswith('http') else '')
        + '  <meta name="twitter:card" content="summary">\n'
        '  <link rel="canonical" href="' + esc(page_url) + '">\n'
        '  <link rel="icon" href="' + BASE + 'favicon.png" type="image/png">\n'
        '\n'
        '  <script type="application/ld+json">\n'
        '  ' + json.dumps(json_ld, ensure_ascii=False, indent=2) + '\n'
        '  </script>\n'
        '\n'
        '  <style>\n'
        '    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; color: #333; }\n'
        '    ul { line-height: 2; }\n'
        '    a { color: #2563eb; }\n'
        '  </style>\n'
        '</head>\n'
        '<body>\n'
        '  <nav><a href="' + BASE + '">← 최애의 독서 홈</a></nav>\n'
        '\n'
        '  <h1>' + esc(title) + '</h1>\n'
        '  <p>' + esc(binfo['author']) + ((' · ' + esc(binfo['publisher'])) if binfo['publisher'] else '') + '</p>\n'
        + cover_html +
        '  <h2>이 책을 읽은 셀럽 (' + str(celeb_count) + '명)</h2>\n'
        '  <ul>\n' + celeb_rows + '\n  </ul>\n'
        '\n'
        '  <p><a href="' + BASE + '">최애의 독서 홈으로 →</a></p>\n'
        '\n'
        '  <script>\n'
        '    if (!/bot|crawl|spider|googlebot|bingbot|yandex|naver|daum/i.test(navigator.userAgent)) {\n'
        '      window.location.replace("' + BASE + '?q=' + quote(title, safe='') + '");\n'
        '    }\n'
        '  </script>\n'
        '</body>\n'
        '</html>'
    )

    with open('share/book/' + fn + '.html', 'w', encoding='utf-8') as f:
        f.write(page)
    book_pages.append((fn, title))

print(f"✅ 책 역방향 페이지 생성: {len(book_pages)}개")

# ── 6. 랭킹 페이지 (share/ranking.html) ─────────────────────────────

top_books = sorted(book_celebs.items(), key=lambda x: len(x[1]['celebs']), reverse=True)[:30]

top_authors = {}
top_publishers = {}
for name, info in celebs.items():
    for b in info['books']:
        a = b['author'].strip()
        p = b['publisher'].strip()
        if a:
            top_authors[a] = top_authors.get(a, 0) + 1
        if p:
            top_publishers[p] = top_publishers.get(p, 0) + 1

top_authors_list    = sorted(top_authors.items(),    key=lambda x: x[1], reverse=True)[:20]
top_publishers_list = sorted(top_publishers.items(), key=lambda x: x[1], reverse=True)[:15]

ranking_books_html = '\n'.join(
    '    <tr><td>' + str(i+1) + '</td><td>' + esc(t) + '</td><td>' + str(len(bi['celebs'])) + '명</td>'
    '<td>' + ', '.join(esc(c) for c in bi['celebs'][:5]) + ('...' if len(bi['celebs']) > 5 else '') + '</td></tr>'
    for i, (t, bi) in enumerate(top_books)
)

ranking_authors_html = '\n'.join(
    '    <tr><td>' + str(i+1) + '</td><td>' + esc(a) + '</td><td>' + str(c) + '회</td></tr>'
    for i, (a, c) in enumerate(top_authors_list)
)

ranking_pub_html = '\n'.join(
    '    <tr><td>' + str(i+1) + '</td><td>' + esc(p) + '</td><td>' + str(c) + '회</td></tr>'
    for i, (p, c) in enumerate(top_publishers_list)
)

ranking_url = BASE + 'share/ranking.html'

ranking_page = (
    '<!DOCTYPE html>\n'
    '<html lang="ko">\n'
    '<head>\n'
    '  <meta charset="utf-8">\n'
    '  <meta name="viewport" content="width=device-width, initial-scale=1">\n'
    '  <title>셀럽이 가장 많이 읽은 책·저자·출판사 랭킹 | 최애의 독서</title>\n'
    '  <meta name="description" content="셀럽이 가장 많이 읽은 책 TOP 30, 저자 TOP 20, 출판사 TOP 15를 확인해 보세요. 아이돌·배우·뮤지션의 독서 트렌드!">\n'
    '  <meta name="keywords" content="셀럽 독서 랭킹, 인기 책, 아이돌 추천 책, 셀럽 인생책, 최애의 독서">\n'
    '  <meta property="og:title" content="셀럽 독서 랭킹 | 최애의 독서">\n'
    '  <meta property="og:description" content="셀럽이 가장 많이 읽은 책·저자·출판사 랭킹">\n'
    '  <meta property="og:url" content="' + ranking_url + '">\n'
    '  <meta property="og:site_name" content="최애의 독서">\n'
    '  <meta property="og:locale" content="ko_KR">\n'
    '  <link rel="canonical" href="' + ranking_url + '">\n'
    '  <link rel="icon" href="' + BASE + 'favicon.png" type="image/png">\n'
    '\n'
    '  <style>\n'
    '    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; max-width: 900px; margin: 0 auto; padding: 20px; color: #333; }\n'
    '    table { width: 100%; border-collapse: collapse; margin-bottom: 32px; }\n'
    '    th, td { border: 1px solid #ddd; padding: 8px; text-align: left; font-size: 14px; }\n'
    '    th { background: #f5f5f5; }\n'
    '    a { color: #2563eb; }\n'
    '  </style>\n'
    '</head>\n'
    '<body>\n'
    '  <nav><a href="' + BASE + '">← 최애의 독서 홈</a></nav>\n'
    '  <h1>셀럽 독서 랭킹</h1>\n'
    '\n'
    '  <h2>가장 많이 읽힌 책 TOP 30</h2>\n'
    '  <table>\n'
    '    <thead><tr><th>#</th><th>도서명</th><th>읽은 셀럽</th><th>누가 읽었나</th></tr></thead>\n'
    '    <tbody>\n' + ranking_books_html + '\n    </tbody>\n'
    '  </table>\n'
    '\n'
    '  <h2>가장 많이 읽힌 저자 TOP 20</h2>\n'
    '  <table>\n'
    '    <thead><tr><th>#</th><th>저자</th><th>언급 횟수</th></tr></thead>\n'
    '    <tbody>\n' + ranking_authors_html + '\n    </tbody>\n'
    '  </table>\n'
    '\n'
    '  <h2>가장 많이 읽힌 출판사 TOP 15</h2>\n'
    '  <table>\n'
    '    <thead><tr><th>#</th><th>출판사</th><th>언급 횟수</th></tr></thead>\n'
    '    <tbody>\n' + ranking_pub_html + '\n    </tbody>\n'
    '  </table>\n'
    '\n'
    '  <p><a href="' + BASE + '">최애의 독서 홈으로 →</a></p>\n'
    '\n'
    '  <script>\n'
    '    if (!/bot|crawl|spider|googlebot|bingbot|yandex|naver|daum/i.test(navigator.userAgent)) {\n'
    '      window.location.replace("' + BASE + '");\n'
    '    }\n'
    '  </script>\n'
    '</body>\n'
    '</html>'
)

with open('share/ranking.html', 'w', encoding='utf-8') as f:
    f.write(ranking_page)
print("✅ 랭킹 페이지 생성: share/ranking.html")

# ── 7. sitemap.xml 생성 (이미지 사이트맵 포함) ──────────────────────
#
# Google 이미지 사이트맵 네임스페이스를 추가하여
# 각 페이지에 연결된 이미지를 명시적으로 알려줍니다.
# 이렇게 하면 구글이 올바른 이미지를 연결합니다.

IMAGE_NS = 'xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"'

lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" ' + IMAGE_NS + '>',
    '  <url>',
    '    <loc>' + BASE + '</loc>',
    '    <lastmod>' + TODAY + '</lastmod>',
    '    <changefreq>daily</changefreq>',
    '    <priority>1.0</priority>',
    '  </url>',
    '  <url>',
    '    <loc>' + ranking_url + '</loc>',
    '    <lastmod>' + TODAY + '</lastmod>',
    '    <changefreq>weekly</changefreq>',
    '    <priority>0.8</priority>',
    '  </url>',
]

# 셀럽 페이지 (이미지 포함)
for name in sorted(celebs.keys()):
    fn = safe_filename(name)
    url = BASE + 'share/' + quote(fn, safe='') + '.html'
    img_url = celebs[name]['img']

    lines += [
        '  <url>',
        '    <loc>' + esc_xml(url) + '</loc>',
        '    <lastmod>' + TODAY + '</lastmod>',
        '    <changefreq>weekly</changefreq>',
        '    <priority>0.7</priority>',
    ]

    # 셀럽 프로필 이미지
    if img_url and img_url.startswith('http'):
        lines += [
            '    <image:image>',
            '      <image:loc>' + esc_xml(img_url) + '</image:loc>',
            '      <image:title>' + esc_xml(name) + ' 프로필</image:title>',
            '      <image:caption>' + esc_xml(name) + '의 독서 리스트 - 최애의 독서</image:caption>',
            '    </image:image>',
        ]

    # 책 표지 이미지 (최대 5개)
    added_covers = 0
    for b in celebs[name]['books']:
        if added_covers >= 5:
            break
        if b['coverUrl'] and b['coverUrl'].startswith('http'):
            lines += [
                '    <image:image>',
                '      <image:loc>' + esc_xml(b['coverUrl']) + '</image:loc>',
                '      <image:title>' + esc_xml(b['title']) + ' 표지</image:title>',
                '    </image:image>',
            ]
            added_covers += 1

    lines.append('  </url>')

# 책 역방향 페이지
for fn, title in book_pages:
    url = BASE + 'share/book/' + quote(fn, safe='') + '.html'
    lines += [
        '  <url>',
        '    <loc>' + esc_xml(url) + '</loc>',
        '    <lastmod>' + TODAY + '</lastmod>',
        '    <changefreq>weekly</changefreq>',
        '    <priority>0.6</priority>',
    ]

    # 책 표지 이미지
    binfo = book_celebs.get(title, {})
    cover = binfo.get('coverUrl', '')
    if cover and cover.startswith('http'):
        lines += [
            '    <image:image>',
            '      <image:loc>' + esc_xml(cover) + '</image:loc>',
            '      <image:title>' + esc_xml(title) + ' 표지</image:title>',
            '    </image:image>',
        ]

    lines.append('  </url>')

lines.append('</urlset>')

with open('sitemap.xml', 'w', encoding='utf-8') as f:
    f.write('\n'.join(lines) + '\n')

total_urls = 1 + 1 + len(celebs) + len(book_pages)
print(f"✅ sitemap.xml 생성: {total_urls}개 URL (이미지 사이트맵 포함)")

# ── 8. robots.txt 생성 (사이트맵 위치 명시) ─────────────────────────
#
# 구글이 사이트맵을 "가져올 수 없음" 에러의 가장 흔한 원인:
# robots.txt에 Sitemap 선언이 없거나, Disallow 규칙이 충돌하는 경우

robots_txt = (
    'User-agent: *\n'
    'Allow: /\n'
    '\n'
    'Sitemap: ' + BASE + 'sitemap.xml\n'
)

with open('robots.txt', 'w', encoding='utf-8') as f:
    f.write(robots_txt)
print("✅ robots.txt 생성 (사이트맵 위치 포함)")

# ── 9. feed.xml 자동 생성 ───────────────────────────────────────────

import email.utils, time

def rfc822(date_str):
    """YYYY-MM-DD → RFC 822 형식"""
    t = time.strptime(date_str, '%Y-%m-%d')
    return email.utils.formatdate(time.mktime(t), localtime=True)

pub_date = rfc822(TODAY)

feed_items = []

# 가장 많이 읽힌 책 TOP 5를 RSS 아이템으로
for title, binfo in top_books[:5]:
    fn = safe_book_filename(title)
    book_url = BASE + 'share/book/' + quote(fn, safe='') + '.html'
    feed_items.append(
        '    <item>\n'
        '      <title>' + esc_xml(title) + ' - ' + str(len(binfo['celebs'])) + '명의 셀럽이 읽은 책</title>\n'
        '      <link>' + book_url + '</link>\n'
        '      <description>' + esc_xml(', '.join(binfo['celebs'])) + '이(가) 읽은 책입니다.</description>\n'
        '      <pubDate>' + pub_date + '</pubDate>\n'
        '      <guid isPermaLink="true">' + book_url + '</guid>\n'
        '    </item>'
    )

# 가장 많은 책을 읽은 셀럽 TOP 3
top_celeb_list = sorted(celebs.items(), key=lambda x: len(x[1]['books']), reverse=True)[:3]
for name, info in top_celeb_list:
    fn = safe_filename(name)
    celeb_url = BASE + 'share/' + quote(fn, safe='') + '.html'
    feed_items.append(
        '    <item>\n'
        '      <title>' + esc_xml(name) + '의 독서 리스트 (' + str(len(info['books'])) + '권)</title>\n'
        '      <link>' + celeb_url + '</link>\n'
        '      <description>' + esc_xml(name) + '이(가) 읽거나 추천한 책 ' + str(len(info['books'])) + '권을 확인해 보세요.</description>\n'
        '      <pubDate>' + pub_date + '</pubDate>\n'
        '      <guid isPermaLink="true">' + celeb_url + '</guid>\n'
        '    </item>'
    )

feed_xml = (
    '<?xml version="1.0" encoding="UTF-8" ?>\n'
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">\n'
    '<channel>\n'
    '  <title>최애의 독서 | 당신이 좋아하는, 그들이 읽은 책</title>\n'
    '  <link>' + BASE + '</link>\n'
    '  <description>아이돌, 셀럽, 연예인 나의 최애가 읽은 책, 추천 책, 인생책을 한곳에 모은 아카이브입니다.</description>\n'
    '  <language>ko-kr</language>\n'
    '  <lastBuildDate>' + pub_date + '</lastBuildDate>\n'
    '  <atom:link href="' + BASE + 'feed.xml" rel="self" type="application/rss+xml" />\n'
    '\n' + '\n\n'.join(feed_items) + '\n'
    '</channel>\n'
    '</rss>\n'
)

with open('feed.xml', 'w', encoding='utf-8') as f:
    f.write(feed_xml)
print(f"✅ feed.xml 자동 생성: {len(feed_items)}개 아이템")

print("\n🎉 빌드 완료!")
