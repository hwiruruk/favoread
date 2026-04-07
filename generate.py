import csv, datetime, os, json, re
from urllib.parse import quote

BASE  = "https://hwiruruk.github.io/favoread/"
TODAY = datetime.date.today().isoformat()
LINK_CLASS = (
    'inline-block px-3 py-1.5 border-2 border-ink rounded-none '
    'bg-white hover:bg-neo-yellow shadow-neo-sm hover:shadow-neo '
    'hover:-translate-y-0.5 transition-all text-[11px] sm:text-xs '
    'font-bold font-sans text-ink'
)

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
        'title':   find_col(['도서명', '제목', '책'],   1),
        'author':  find_col(['저자', '작가'],            2),
        'pub':     find_col(['출판사'],                  3),
        'src':     find_col(['출처', '근거'],            4),
        'link':    find_col(['도서 정보', '링크', 'url'], 5),
        'cover':   find_col(['도서 이미지', '표지'],     6),
        'img':     find_col(['연예인이미지', 'photo', '이미지주소'], 7),
        'comment': find_col(['코멘트', '한마디'],        8),
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
            img_url = BASE + 'favicon.png'

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
    '      <a href="?celeb=' + quote(n, safe='()') + '" class="' + LINK_CLASS + '">' + n + '</a>'
    for n in sorted_names
)

with open('index.html', 'r', encoding='utf-8') as f:
    html = f.read()

html = re.sub(
    r'등록된 셀럽 · 아이돌 · 배우 전체 목록 \d+명',
    '등록된 셀럽 · 아이돌 · 배우 전체 목록 ' + str(len(celebs)) + '명',
    html
)
html = re.sub(
    r'(<div id="all-celebs-container"[^>]*>).*?(</div>\s*</section>\s*</main>)',
    lambda m: m.group(1) + '\n' + new_links + '\n    ' + m.group(2),
    html,
    flags=re.DOTALL
)

with open('index.html', 'w', encoding='utf-8') as f:
    f.write(html)
print(f"✅ index.html 정적 목록 갱신: {len(sorted_names)}명")

# ── 4. share 페이지 생성 ─────────────────────────────────────────────
os.makedirs('share', exist_ok=True)

for name, info in celebs.items():
    img       = info['img']
    books     = info['books']
    safe      = quote(name, safe='()')
    file_name = name.replace('/', '_').replace('\\', '_')
    page_url  = BASE + 'share/' + quote(file_name, safe='()') + '.html'

    json_ld = {
        '@context': 'https://schema.org',
        '@type': 'ProfilePage',
        'name': name + '의 독서 리스트 | 최애의 독서',
        'url': page_url,
        'mainEntity': {
            '@type': 'Person',
            'name': name,
            'image': img,
            'description': name + '이(가) 읽거나 추천한 책 ' + str(len(books)) + '권',
            'knowsAbout': {
                '@type': 'ItemList',
                'numberOfItems': len(books),
                'itemListElement': [
                    {'@type': 'ListItem', 'position': i + 1, 'name': b['title']}
                    for i, b in enumerate(books)
                ]
            }
        }
    }

    book_rows = '\n'.join(
        '      <tr><td>' + str(i+1) + '</td><td>' + b['title'] + '</td>'
        '<td>' + b['author'] + '</td><td>' + b['publisher'] + '</td></tr>'
        for i, b in enumerate(books)
    )

    redirect_url = BASE + '?celeb=' + safe

    page = (
        '<!DOCTYPE html>\n'
        '<html lang="ko">\n'
        '<head>\n'
        '  <meta charset="utf-8">\n'
        '  <title>' + name + '의 독서 리스트 | 최애의 독서</title>\n'
        '  <meta name="description" content="' + name + '이(가) 읽거나 추천한 책 ' + str(len(books)) + '권을 확인해보세요.">\n'
        '  <meta property="og:title" content="' + name + ' | 최애의 독서">\n'
        '  <meta property="og:description" content="' + name + '의 독서 기록과 추천 책 ' + str(len(books)) + '권을 확인해보세요!">\n'
        '  <meta property="og:image" content="' + img + '">\n'
        '  <meta property="og:url" content="' + page_url + '">\n'
        '  <meta property="og:type" content="profile">\n'
        '  <meta name="twitter:card" content="summary_large_image">\n'
        '  <link rel="canonical" href="' + page_url + '">\n'
        '  <script type="application/ld+json">\n'
        '  ' + json.dumps(json_ld, ensure_ascii=False, indent=2) + '\n'
        '  </script>\n'
        '</head>\n'
        '<body>\n'
        '  <h1>' + name + '의 독서 리스트</h1>\n'
        '  <p>' + name + '이(가) 읽거나 추천한 책 ' + str(len(books)) + '권입니다.</p>\n'
        '  <table>\n'
        '    <thead><tr><th>#</th><th>도서명</th><th>저자</th><th>출판사</th></tr></thead>\n'
        '    <tbody>\n'
        + book_rows + '\n'
        '    </tbody>\n'
        '  </table>\n'
        '  <p><a href="' + redirect_url + '">최애의 독서에서 ' + name + ' 전체 목록 보기</a></p>\n'
        '  <script>\n'
        '    if (!/bot|crawl|spider/i.test(navigator.userAgent)) {\n'
        '      window.location.replace("' + redirect_url + '");\n'
        '    }\n'
        '  </script>\n'
        '</body>\n'
        '</html>'
    )

    with open('share/' + file_name + '.html', 'w', encoding='utf-8') as f:
        f.write(page)

print(f"✅ share 페이지 생성: {len(celebs)}개")

# ── 5. sitemap.xml 생성 ──────────────────────────────────────────────
lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    '  <url>',
    '    <loc>https://hwiruruk.github.io/readinglab/</loc>',
    '    <lastmod>' + TODAY + '</lastmod>',
    '    <priority>0.8</priority>',
    '  </url>',
    '  <url>',
    '    <loc>' + BASE + '</loc>',
    '    <lastmod>' + TODAY + '</lastmod>',
    '    <priority>1.0</priority>',
    '  </url>',
]
for name in celebs:
    fn = name.replace('/', '_').replace('\\', '_')
    lines += [
        '  <url>',
        '    <loc>' + BASE + 'share/' + quote(fn, safe='()') + '.html</loc>',
        '    <lastmod>' + TODAY + '</lastmod>',
        '    <priority>0.7</priority>',
        '  </url>',
    ]
lines.append('</urlset>')

with open('sitemap.xml', 'w', encoding='utf-8') as f:
    f.write('\n'.join(lines) + '\n')
print(f"✅ sitemap.xml 생성: {len(celebs) + 2}개 URL")
