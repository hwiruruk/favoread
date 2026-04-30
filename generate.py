import csv, datetime, os, json, re, html, subprocess
from urllib.parse import quote

BASE = "https://favorbook.co.kr/"
TODAY = datetime.date.today().isoformat()

# 변경된 파일 추적: path → True/False (이번 실행에서 내용이 바뀐 경우 True)
changed_files = {}

def write_if_changed(path, content):
    """기존 파일 내용과 동일하면 쓰지 않음. lastmod 정확도용."""
    try:
        with open(path, 'r', encoding='utf-8') as f:
            if f.read() == content:
                changed_files[path] = False
                return False
    except FileNotFoundError:
        pass
    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)
    changed_files[path] = True
    return True

def git_lastmod(path):
    """파일의 git 최종 커밋 날짜(YYYY-MM-DD). 미추적 파일은 TODAY."""
    try:
        r = subprocess.run(
            ['git', 'log', '-1', '--format=%cs', '--', path],
            capture_output=True, text=True, timeout=5, check=False
        )
        d = r.stdout.strip()
        return d if d else TODAY
    except Exception:
        return TODAY

def lastmod_for(path):
    """이번 실행에서 변경됐으면 TODAY, 아니면 git mtime."""
    if changed_files.get(path, False):
        return TODAY
    return git_lastmod(path)

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

# ── 영문 페이지용 헬퍼 ───────────────────────────────────────────────
import unicodedata

def safe_en_filename(text):
    """영문 텍스트를 ASCII 슬러그로. 'The Vegetarian' → 'the-vegetarian'."""
    text = (text or '').lstrip('?').strip()
    text = unicodedata.normalize('NFKD', text)
    text = text.encode('ascii', 'ignore').decode('ascii')
    text = re.sub(r"[^\w\s-]", '', text).strip().lower()
    text = re.sub(r"[\s_]+", '-', text)
    text = re.sub(r"-+", '-', text)
    return text or 'untitled'

def clean_en(value):
    """`?The Vegetarian` 같은 미검수 제안값은 None 반환. 검수 완료 값만 사용."""
    if not value:
        return None
    v = value.strip()
    if not v or v.startswith('?'):
        return None
    return v

def make_en_celeb_url(name_en):
    return BASE + 'en/share/' + safe_en_filename(name_en) + '.html'

def make_en_book_url(title_en):
    return BASE + 'en/share/book/' + safe_en_filename(title_en) + '.html'

def clean_none(obj):
    """JSON-LD에서 None 값 재귀적으로 제거."""
    if isinstance(obj, dict):
        return {k: clean_none(v) for k, v in obj.items() if v is not None}
    if isinstance(obj, list):
        return [clean_none(i) for i in obj]
    return obj

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

    def find_exact(col_name):
        return headers.index(col_name) if col_name in headers else None

    C = {
        'name':    find_col(['연예인', '이름', '인물'], 0),
        'title':   find_col(['도서명', '제목', '책'], 1),
        'author':  find_col(['저자', '작가'], 2),
        'pub':     find_col(['출판사'], 3),
        'src':     find_col(['출처', '근거'], 4),
        'link':    find_col(['도서 정보', '링크', 'url'], 5),
        'cover':   find_col(['도서 이미지', '표지'], 6),
        'img':     find_col(['연예인 이미지', '연예인이미지', 'photo', '이미지주소'], 7),
        'comment': find_col(['코멘트', '한마디'], 8),
        'name_en':  find_exact('연예인_en'),
        'title_en': find_exact('도서명_en'),
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

        name_en  = clean_en(get(C['name_en']))  if C['name_en']  is not None else None
        title_en = clean_en(get(C['title_en'])) if C['title_en'] is not None else None

        if name not in celebs:
            celebs[name] = {'img': img_url, 'books': [], 'name_en': name_en}
        # 같은 셀럽의 name_en이 행마다 다르면 첫 비어있지 않은 값 우선
        if name_en and not celebs[name].get('name_en'):
            celebs[name]['name_en'] = name_en

        celebs[name]['books'].append({
            'title':     title,
            'author':    get(C['author']),
            'publisher': get(C['pub']),
            'source':    get(C['src']),
            'link':      get(C['link']),
            'coverUrl':  get(C['cover']),
            'comment':   get(C['comment']),
            'title_en':  title_en,
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

write_if_changed('index.html', idx_html)
print(f"✅ index.html 정적 목록 갱신: {len(sorted_names)}명")

# ── 4. share 페이지 생성 (SEO 강화) ─────────────────────────────────

os.makedirs('share', exist_ok=True)
os.makedirs('share/book', exist_ok=True)

# 책 역방향 페이지 생성 데이터 사전 계산 (share 페이지에서 책 페이지로 내부링크 걸기 위함)
book_celebs = {}
for _name, _info in celebs.items():
    _seen = set()
    for _b in _info['books']:
        _t = _b['title'].strip()
        if _t in _seen:
            continue
        _seen.add(_t)
        if _t not in book_celebs:
            book_celebs[_t] = {
                'celebs': [], 'author': _b['author'],
                'publisher': _b['publisher'],
                'coverUrl': _b.get('coverUrl', '')
            }
        book_celebs[_t]['celebs'].append(_name)

# 2명 이상이 읽은 책만 책 페이지가 생성됨 → 그 책 제목 set
books_with_pages = {t for t, bi in book_celebs.items() if len(bi['celebs']) >= 2}

# 책 제목 → 영문 제목 매핑 (검수 완료된 첫 비어있지 않은 값)
book_title_en = {}
for _name, _info in celebs.items():
    for _b in _info['books']:
        _t = _b['title'].strip()
        if _b.get('title_en') and _t not in book_title_en:
            book_title_en[_t] = _b['title_en']

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

    n_books = len(books)
    # description: "RM(BTS)이 읽은 책과 추천 인생책 9권 공개! 공감의 배신, 데미안, 방구석 미술관 등 RM(BTS) 책 추천 리스트 전체 확인."
    top3 = ', '.join(esc(b['title']) for b in books[:3])
    desc_text = (
        esc(name) + '이(가) 읽은 책과 추천한 인생책 ' + str(n_books) + '권 공개! '
        + top3 + (' 등 ' if n_books > 3 else ' ')
        + esc(name) + ' 책 추천 리스트 전체 확인.'
    )

    # 검색 키워드 변형: 셀럽별 정확 매칭 + 일반 검색어(연예인/아이돌/셀럽 + 읽은 책/추천 책/추천 도서/인생책)
    keyword_variants = ', '.join([
        esc(name) + ' 읽은 책',
        esc(name) + ' 추천 책',
        esc(name) + ' 추천 도서',
        esc(name) + ' 인생책',
        esc(name) + ' 책',
        esc(name) + ' 책 추천',
        esc(name) + ' 도서',
        '연예인 읽은 책', '아이돌 읽은 책', '셀럽 읽은 책',
        '연예인 추천 책', '아이돌 추천 도서', '연예인 추천 도서',
        '연예인 인생책', '아이돌 인생책', '셀럽 인생책',
        '책 추천', '인생책', '추천 도서', '최애의 독서',
    ])

    page_title = esc(name) + ' 읽은 책·추천 책 ' + str(n_books) + '권 | 최애의 독서'
    h1_text    = esc(name) + ' 읽은 책 · 추천 책'

    json_ld = {
        '@context': 'https://schema.org',
        '@type': 'ProfilePage',
        'name': page_title,
        'url': page_url,
        'description': name + '이(가) 읽은 책과 추천한 인생책 ' + str(n_books) + '권',
        'mainEntity': {
            '@type': 'Person',
            'name': name,
            'image': img,
            'description': name + '이(가) 읽은 책과 추천 책 ' + str(n_books) + '권 전체 목록',
        },
        'isPartOf': {
            '@type': 'WebSite',
            'name': '최애의 독서',
            'url': BASE
        }
    }

    # ItemList는 별도 JSON-LD 블록으로 분리 (GSC가 mainEntityOfPage 안의 ItemList를 인식 못함)
    itemlist_ld = {
        '@context': 'https://schema.org',
        '@type': 'ItemList',
        'name': name + '이 읽은 책 ' + str(n_books) + '권',
        'numberOfItems': n_books,
        'itemListElement': [
            {
                '@type': 'ListItem',
                'position': i + 1,
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

    json_ld = clean_none(json_ld)
    itemlist_ld = clean_none(itemlist_ld)

    breadcrumb_ld = {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        'itemListElement': [
            {
                '@type': 'ListItem',
                'position': 1,
                'name': '홈',
                'item': BASE
            },
            {
                '@type': 'ListItem',
                'position': 2,
                'name': name + '의 독서 리스트',
                'item': page_url
            }
        ]
    }

    # 책 테이블 행 (이미지 + 책 페이지 내부링크 + 출처 외부링크)
    book_rows = ''
    for i, b in enumerate(books):
        cover_td = ''
        if b['coverUrl'] and b['coverUrl'].startswith('http'):
            cover_td = '<img src="' + esc(b['coverUrl']) + '" alt="' + esc(b['title']) + ' 표지" width="60" height="85" loading="lazy" style="object-fit:cover">'

        # 책 페이지가 존재하면(2명 이상이 읽음) 내부링크
        if b['title'] in books_with_pages:
            title_html = ('<a href="book/' + quote(safe_book_filename(b['title']), safe='')
                          + '.html">' + esc(b['title']) + '</a>')
        else:
            title_html = esc(b['title'])

        # 출처 (대부분 YouTube 등 URL) → 외부링크
        source_html = ''
        if b['source'] and b['source'].startswith('http'):
            source_html = ('<a href="' + esc(b['source'])
                           + '" rel="nofollow noopener noreferrer" target="_blank">출처 보기 →</a>')
        elif b['source']:
            source_html = esc(b['source'])

        book_rows += (
            '    <tr>'
            '<td>' + str(i+1) + '</td>'
            '<td>' + cover_td + '</td>'
            '<td>' + title_html + '</td>'
            '<td>' + esc(b['author']) + '</td>'
            '<td>' + esc(b['publisher']) + '</td>'
            '<td class="src">' + source_html + '</td>'
            '</tr>\n'
        )

    # 인트로 단락: 자연스럽게 키워드 변형 노출 (~150-220자)
    intro_p = (
        esc(name) + '이(가) 읽은 책과 추천한 인생책 <strong>' + str(n_books) + '권</strong>을 한곳에 모았습니다. '
        '유튜브·인터뷰·SNS 등 출처가 확인된 도서만 정리했어요. '
        + esc(name) + ' 책 추천이 궁금하다면 아래 전체 목록과 출처 링크에서 확인할 수 있습니다.'
    )

    # 작가/출판사 빈도 요약 (간단한 unique 콘텐츠)
    author_counts = {}
    for b in books:
        a = b['author'].strip()
        if a:
            author_counts[a] = author_counts.get(a, 0) + 1
    top_authors = sorted(author_counts.items(), key=lambda x: x[1], reverse=True)[:3]
    if top_authors:
        author_summary = (
            esc(name) + '이(가) 가장 많이 읽은 작가는 '
            + ', '.join(esc(a) + (' (' + str(c) + '권)' if c > 1 else '') for a, c in top_authors)
            + '입니다.'
        )
    else:
        author_summary = ''

    # 영문 페이지가 있으면 hreflang 링크 추가
    name_en = info.get('name_en')
    hreflang_block = ''
    if name_en:
        en_url = make_en_celeb_url(name_en)
        hreflang_block = (
            '  <link rel="alternate" hreflang="ko" href="' + esc(page_url) + '">\n'
            '  <link rel="alternate" hreflang="en" href="' + esc(en_url) + '">\n'
            '  <link rel="alternate" hreflang="x-default" href="' + esc(page_url) + '">\n'
        )

    page = (
        '<!DOCTYPE html>\n'
        '<html lang="ko">\n'
        '<head>\n'
        '  <meta charset="utf-8">\n'
        '  <meta name="viewport" content="width=device-width, initial-scale=1">\n'
        '  <title>' + page_title + '</title>\n'
        '  <meta name="description" content="' + desc_text + '">\n'
        '  <meta name="keywords" content="' + keyword_variants + '">\n'
        '  <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1">\n'
        '  <meta name="theme-color" content="#ffffff">\n'
        '\n'
        '  <!-- Open Graph -->\n'
        '  <meta property="og:title" content="' + page_title + '">\n'
        '  <meta property="og:description" content="' + desc_text + '">\n'
        '  <meta property="og:image" content="' + esc(img) + '">\n'
        '  <meta property="og:image:width" content="600">\n'
        '  <meta property="og:image:height" content="600">\n'
        '  <meta property="og:image:alt" content="' + esc(name) + ' 읽은 책 추천 책 리스트">\n'
        '  <meta property="og:url" content="' + esc(page_url) + '">\n'
        '  <meta property="og:type" content="profile">\n'
        '  <meta property="og:site_name" content="최애의 독서">\n'
        '  <meta property="og:locale" content="ko_KR">\n'
        '\n'
        '  <!-- Twitter Card -->\n'
        '  <meta name="twitter:card" content="summary_large_image">\n'
        '  <meta name="twitter:title" content="' + page_title + '">\n'
        '  <meta name="twitter:description" content="' + desc_text + '">\n'
        '  <meta name="twitter:image" content="' + esc(img) + '">\n'
        '  <meta name="twitter:image:alt" content="' + esc(name) + ' 읽은 책 추천 책 리스트">\n'
        '\n'
        '  <link rel="canonical" href="' + esc(page_url) + '">\n'
        + hreflang_block +
        '  <link rel="icon" href="' + BASE + 'favicon.svg" type="image/svg+xml">\n'
        '  <link rel="icon" href="' + BASE + 'favicon.png" type="image/png" sizes="192x192">\n'
        '  <link rel="apple-touch-icon" href="' + BASE + 'favicon.png">\n'
        '  <link rel="alternate" type="application/rss+xml" title="최애의 독서 RSS" href="' + BASE + 'feed.xml">\n'
        '\n'
        '  <link rel="preconnect" href="https://image.aladin.co.kr">\n'
        '  <link rel="dns-prefetch" href="https://image.aladin.co.kr">\n'
        '\n'
        '  <script type="application/ld+json">\n'
        '  ' + json.dumps(json_ld, ensure_ascii=False, indent=2) + '\n'
        '  </script>\n'
        '  <script type="application/ld+json">\n'
        '  ' + json.dumps(breadcrumb_ld, ensure_ascii=False, indent=2) + '\n'
        '  </script>\n'
        '  <script type="application/ld+json">\n'
        '  ' + json.dumps(itemlist_ld, ensure_ascii=False, indent=2) + '\n'
        '  </script>\n'
        '\n'
        '  <style>\n'
        '    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; max-width: 860px; margin: 0 auto; padding: 20px; color: #222; line-height: 1.6; background: #fcfaf5; }\n'
        '    .lang-toggle { position: absolute; top: 16px; right: 16px; display: flex; gap: 6px; }\n'
        '    .lang-btn { padding: 6px 12px; border: 2px solid #000; background: #fff; box-shadow: 2px 2px 0 0 #000; font-size: 12px; font-weight: 700; text-decoration: none; color: #000; transition: transform .1s, box-shadow .1s; }\n'
        '    .lang-btn:hover { transform: translate(-1px,-1px); box-shadow: 3px 3px 0 0 #000; background: #fde047; text-decoration: none; }\n'
        '    .lang-btn.active { background: #000; color: #fff; }\n'
        '    nav { margin: 50px 0 16px; font-size: 13px; }\n'
        '    .celeb-header { display: flex; align-items: center; gap: 20px; margin-bottom: 16px; flex-wrap: wrap; }\n'
        '    .celeb-photo-wrap { position: relative; flex-shrink: 0; }\n'
        '    .celeb-img { width: 120px; height: 120px; border-radius: 50%; object-fit: cover; display: block; border: 2px solid #000; }\n'
        '    .img-credit { position: absolute; bottom: 0; right: 0; font-size: 10px; line-height: 1; padding: 2px 4px; background: rgba(255,255,255,0.85); border: 1px solid #ccc; border-radius: 999px; text-decoration: none; color: #555; opacity: 0.55; transition: opacity .15s; }\n'
        '    .img-credit:hover { opacity: 1; }\n'
        '    h1 { font-size: 26px; margin: 0 0 8px; font-weight: 900; }\n'
        '    h2 { font-size: 19px; margin: 32px 0 12px; padding-bottom: 4px; border-bottom: 2px solid #000; font-weight: 800; }\n'
        '    .intro { background: #fff; border: 2px solid #000; box-shadow: 4px 4px 0 0 #000; padding: 14px 16px; margin: 16px 0 24px; font-size: 15px; }\n'
        '    table { width: 100%; border-collapse: collapse; font-size: 14px; background: #fff; border: 2px solid #000; }\n'
        '    th, td { border: 1px solid #000; padding: 8px 10px; text-align: left; vertical-align: middle; }\n'
        '    th { background: #fde047; font-size: 13px; font-weight: 800; }\n'
        '    td.src a { font-size: 12px; }\n'
        '    a { color: #2563eb; text-decoration: none; }\n'
        '    a:hover { text-decoration: underline; }\n'
        '    .related { margin-top: 24px; padding: 14px 16px; background: #fff8e7; border: 2px solid #000; box-shadow: 4px 4px 0 0 #000; font-size: 14px; }\n'
        '    footer { margin-top: 48px; padding-top: 16px; border-top: 2px solid #000; font-size: 13px; color: #666; }\n'
        '  </style>\n'
        '</head>\n'
        '<body>\n'
        + (('  <div class="lang-toggle">\n'
            '    <span class="lang-btn active">한국어</span>\n'
            '    <a class="lang-btn" href="' + esc(make_en_celeb_url(name_en)) + '" hreflang="en">EN</a>\n'
            '  </div>\n') if name_en else '')
        + '  <nav><a href="' + BASE + '">← 최애의 독서 홈</a> · <a href="' + BASE + 'share/ranking.html">셀럽 독서 랭킹</a></nav>\n'
        '\n'
        '  <header class="celeb-header">\n'
        '    <div class="celeb-photo-wrap">\n'
        '      <img class="celeb-img" src="' + esc(img) + '" alt="' + esc(name) + ' 프로필 사진" width="120" height="120">\n'
        + (('      <a class="img-credit" href="' + esc(img) + '" target="_blank" rel="nofollow noopener noreferrer" title="이미지 출처">📷</a>\n')
           if img and img.startswith('http') else '')
        + '    </div>\n'
        '    <div>\n'
        '      <h1>' + h1_text + '</h1>\n'
        '      <p style="margin:0;color:#666;font-size:14px">총 <strong>' + str(n_books) + '권</strong>의 도서</p>\n'
        '    </div>\n'
        '  </header>\n'
        '\n'
        '  <section class="intro">\n'
        '    <p style="margin:0">' + intro_p + '</p>\n'
        '  </section>\n'
        '\n'
        '  <section>\n'
        '    <h2>' + esc(name) + '이(가) 읽은 책 전체 목록 (' + str(n_books) + '권)</h2>\n'
        '    <table>\n'
        '      <thead><tr><th>#</th><th>표지</th><th>도서명</th><th>저자</th><th>출판사</th><th>출처</th></tr></thead>\n'
        '      <tbody>\n'
        + book_rows +
        '      </tbody>\n'
        '    </table>\n'
        '  </section>\n'
        '\n'
        + (('  <section>\n'
            '    <h2>' + esc(name) + ' 인생책 · 책 추천 키워드</h2>\n'
            '    <p>' + author_summary + ' '
            + esc(name) + '의 책 추천 리스트는 위 표에서 출처와 함께 확인할 수 있습니다.</p>\n'
            '  </section>\n'
            '\n') if author_summary else '')
        + '  <aside class="related">\n'
        '    <strong>다른 셀럽들의 인생책</strong>이 궁금하다면? '
        '<a href="' + BASE + '">최애의 독서 홈</a>에서 ' + str(len(celebs))
        + '명의 셀럽·아이돌·배우가 읽은 책을 확인해 보세요.\n'
        '  </aside>\n'
        '\n'
        '  <footer>\n'
        '    <p>' + esc(name) + ' 읽은 책 정보는 유튜브·인터뷰·SNS 등 공개된 출처를 기반으로 정리되었습니다.</p>\n'
        '  </footer>\n'
        '\n'
        '</body>\n'
        '</html>'
    )

    write_if_changed('share/' + fn + '.html', page)

print(f"✅ share 페이지 생성: {len(celebs)}개")

# ── 5. 책 역방향 페이지 (share/book/*.html) ──────────────────────────
# book_celebs는 섹션 4 시작 부분에서 사전 계산됨 (share 페이지 내부링크 위해)

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

    book_breadcrumb_ld = {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        'itemListElement': [
            {
                '@type': 'ListItem',
                'position': 1,
                'name': '홈',
                'item': BASE
            },
            {
                '@type': 'ListItem',
                'position': 2,
                'name': title,
                'item': page_url
            }
        ]
    }

    json_ld = {
        '@context': 'https://schema.org',
        '@type': 'Book',
        'name': title,
        'url': page_url,
        'description': str(celeb_count) + '명의 셀럽이 읽은 책',
    }
    if binfo['author'] and binfo['author'].strip():
        json_ld['author'] = {'@type': 'Person', 'name': binfo['author'].strip()}
    if binfo['publisher'] and binfo['publisher'].strip():
        json_ld['publisher'] = {'@type': 'Organization', 'name': binfo['publisher'].strip()}
    if binfo['coverUrl'] and binfo['coverUrl'].startswith('http'):
        json_ld['image'] = binfo['coverUrl']

    # 영문 책 페이지가 있으면 hreflang 추가
    title_en = book_title_en.get(title)
    book_hreflang = ''
    if title_en:
        en_book_url = make_en_book_url(title_en)
        book_hreflang = (
            '  <link rel="alternate" hreflang="ko" href="' + esc(page_url) + '">\n'
            '  <link rel="alternate" hreflang="en" href="' + esc(en_book_url) + '">\n'
            '  <link rel="alternate" hreflang="x-default" href="' + esc(page_url) + '">\n'
        )

    page = (
        '<!DOCTYPE html>\n'
        '<html lang="ko">\n'
        '<head>\n'
        '  <meta charset="utf-8">\n'
        '  <meta name="viewport" content="width=device-width, initial-scale=1">\n'
        '  <title>' + esc(title) + ' - ' + str(celeb_count) + '명의 셀럽이 읽은 책 | 최애의 독서</title>\n'
        '  <meta name="description" content="' + desc_text + '">\n'
        '  <meta name="keywords" content="' + esc(title) + ', ' + esc(binfo['author']) + ', 셀럽독서, 책추천, 최애의 독서">\n'
        '  <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1">\n'
        '  <meta name="theme-color" content="#ffffff">\n'
        '\n'
        '  <meta property="og:title" content="' + esc(title) + ' | ' + str(celeb_count) + '명의 셀럽이 읽은 책">\n'
        '  <meta property="og:description" content="' + celeb_names_str + ' 등 ' + str(celeb_count) + '명이 읽은 책">\n'
        '  <meta property="og:url" content="' + esc(page_url) + '">\n'
        '  <meta property="og:type" content="book">\n'
        '  <meta property="og:site_name" content="최애의 독서">\n'
        '  <meta property="og:locale" content="ko_KR">\n'
        + ('  <meta property="og:image" content="' + esc(binfo['coverUrl']) + '">\n'
           '  <meta property="og:image:alt" content="' + esc(title) + ' 표지">\n'
           if binfo['coverUrl'] and binfo['coverUrl'].startswith('http')
           else '  <meta property="og:image" content="' + BASE + 'og-image.jpg">\n')
        + '  <meta name="twitter:card" content="summary">\n'
        '  <meta name="twitter:title" content="' + esc(title) + ' | ' + str(celeb_count) + '명의 셀럽이 읽은 책">\n'
        '  <meta name="twitter:description" content="' + celeb_names_str + ' 등 ' + str(celeb_count) + '명이 읽은 책">\n'
        + ('  <meta name="twitter:image" content="' + esc(binfo['coverUrl']) + '">\n'
           if binfo['coverUrl'] and binfo['coverUrl'].startswith('http')
           else '  <meta name="twitter:image" content="' + BASE + 'og-image.jpg">\n')
        + '  <link rel="canonical" href="' + esc(page_url) + '">\n'
        + book_hreflang +
        '  <link rel="icon" href="' + BASE + 'favicon.svg" type="image/svg+xml">\n'
        '  <link rel="icon" href="' + BASE + 'favicon.png" type="image/png" sizes="192x192">\n'
        '  <link rel="apple-touch-icon" href="' + BASE + 'favicon.png">\n'
        '  <link rel="alternate" type="application/rss+xml" title="최애의 독서 RSS" href="' + BASE + 'feed.xml">\n'
        '\n'
        '  <link rel="preconnect" href="https://image.aladin.co.kr">\n'
        '  <link rel="dns-prefetch" href="https://image.aladin.co.kr">\n'
        '\n'
        '  <script type="application/ld+json">\n'
        '  ' + json.dumps(json_ld, ensure_ascii=False, indent=2) + '\n'
        '  </script>\n'
        '  <script type="application/ld+json">\n'
        '  ' + json.dumps(book_breadcrumb_ld, ensure_ascii=False, indent=2) + '\n'
        '  </script>\n'
        '\n'
        '  <style>\n'
        '    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; color: #222; background: #fcfaf5; line-height: 1.6; }\n'
        '    .lang-toggle { position: absolute; top: 16px; right: 16px; display: flex; gap: 6px; }\n'
        '    .lang-btn { padding: 6px 12px; border: 2px solid #000; background: #fff; box-shadow: 2px 2px 0 0 #000; font-size: 12px; font-weight: 700; text-decoration: none; color: #000; transition: transform .1s, box-shadow .1s; }\n'
        '    .lang-btn:hover { transform: translate(-1px,-1px); box-shadow: 3px 3px 0 0 #000; background: #fde047; text-decoration: none; }\n'
        '    .lang-btn.active { background: #000; color: #fff; }\n'
        '    nav { margin: 50px 0 16px; font-size: 13px; }\n'
        '    h1 { font-size: 28px; margin: 0 0 6px; font-weight: 900; }\n'
        '    h2 { font-size: 19px; margin: 32px 0 12px; padding-bottom: 4px; border-bottom: 2px solid #000; font-weight: 800; }\n'
        '    ul { line-height: 2; padding-left: 22px; }\n'
        '    a { color: #2563eb; text-decoration: none; }\n'
        '    a:hover { text-decoration: underline; }\n'
        '  </style>\n'
        '</head>\n'
        '<body>\n'
        + (('  <div class="lang-toggle">\n'
            '    <span class="lang-btn active">한국어</span>\n'
            '    <a class="lang-btn" href="' + esc(make_en_book_url(title_en)) + '" hreflang="en">EN</a>\n'
            '  </div>\n') if title_en else '')
        + '  <nav><a href="' + BASE + '">← 최애의 독서 홈</a></nav>\n'
        '\n'
        '  <h1>' + esc(title) + '</h1>\n'
        '  <p>' + esc(binfo['author']) + ((' · ' + esc(binfo['publisher'])) if binfo['publisher'] else '') + '</p>\n'
        + cover_html +
        '  <h2>이 책을 읽은 셀럽 (' + str(celeb_count) + '명)</h2>\n'
        '  <ul>\n' + celeb_rows + '\n  </ul>\n'
        '\n'
        '  <p><a href="' + BASE + '">최애의 독서 홈으로 →</a></p>\n'
        '\n'
        '</body>\n'
        '</html>'
    )

    write_if_changed('share/book/' + fn + '.html', page)
    book_pages.append((fn, title))

print(f"✅ 책 역방향 페이지 생성: {len(book_pages)}개")

# ── 5.5. /en/ 영문 페이지 생성 ──────────────────────────────────────
# 영문 메타데이터(검수 완료된 `연예인_en`, `도서명_en`)가 있는 행만 노출.
# 자동 제안값(`?` 접두사)은 clean_en()에서 None으로 처리되어 노출되지 않음.

os.makedirs('en', exist_ok=True)
os.makedirs('en/share', exist_ok=True)
os.makedirs('en/share/book', exist_ok=True)

EN_BASE = BASE + 'en/'

en_celeb_pages = []   # [(slug, name_en, name_ko)]
en_book_pages  = []   # [(slug, title_en, title_ko)]

# 영문 페이지가 노출될 책 제목 set (≥2 셀럽 + title_en 검수 완료)
en_books_with_pages = {t for t in book_title_en.keys() if t in books_with_pages}

for name, info in celebs.items():
    name_en = info.get('name_en')
    if not name_en:
        continue

    # 영문 제목이 있는 책만 노출
    en_books = [b for b in info['books'] if b.get('title_en')]
    if not en_books:
        continue

    slug = safe_en_filename(name_en)
    en_celeb_pages.append((slug, name_en, name))

    page_url = make_en_celeb_url(name_en)
    ko_url   = make_celeb_url(name)
    img      = info['img']
    n        = len(en_books)

    # 책 행 (영문 제목 + 한국어 원제 부기)
    rows = ''
    for i, b in enumerate(en_books):
        cover_td = ''
        if b['coverUrl'] and b['coverUrl'].startswith('http'):
            cover_td = ('<img src="' + esc(b['coverUrl']) + '" alt="' + esc(b['title_en'])
                        + ' cover" width="60" height="85" loading="lazy" style="object-fit:cover">')
        if b['title'] in en_books_with_pages:
            t_html = ('<a href="book/' + safe_en_filename(b['title_en']) + '.html">'
                      + esc(b['title_en']) + '</a>')
        else:
            t_html = esc(b['title_en'])
        t_html += ' <span style="color:#888;font-size:12px">(' + esc(b['title']) + ')</span>'
        src_html = ''
        if b['source'] and b['source'].startswith('http'):
            src_html = '<a href="' + esc(b['source']) + '" rel="nofollow noopener noreferrer" target="_blank">source →</a>'
        rows += ('    <tr><td>' + str(i+1) + '</td><td>' + cover_td + '</td><td>' + t_html
                 + '</td><td>' + esc(b['author']) + '</td><td class="src">' + src_html + '</td></tr>\n')

    title_text = name_en + ' — Books Read & Recommended (' + str(n) + ')'
    desc_text  = (name_en + ' (Korean: ' + esc(name) + ') has read and recommended '
                  + str(n) + ' books. See the full reading list with sources.')

    json_ld = clean_none({
        '@context': 'https://schema.org',
        '@type': 'ProfilePage',
        'name': title_text,
        'url': page_url,
        'inLanguage': 'en',
        'description': desc_text,
        'mainEntity': {
            '@type': 'Person',
            'name': name_en,
            'alternateName': name,
            'image': img if img.startswith('http') else None,
        },
        'isPartOf': {'@type': 'WebSite', 'name': 'Favoread', 'url': EN_BASE},
    })
    breadcrumb_ld = {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        'itemListElement': [
            {'@type': 'ListItem', 'position': 1, 'name': 'Home', 'item': EN_BASE},
            {'@type': 'ListItem', 'position': 2, 'name': name_en + "'s Reading List", 'item': page_url},
        ],
    }

    page = (
        '<!DOCTYPE html>\n'
        '<html lang="en">\n'
        '<head>\n'
        '  <meta charset="utf-8">\n'
        '  <meta name="viewport" content="width=device-width, initial-scale=1">\n'
        '  <title>' + esc(title_text) + ' | Favoread</title>\n'
        '  <meta name="description" content="' + esc(desc_text) + '">\n'
        '  <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1">\n'
        '  <meta property="og:title" content="' + esc(title_text) + '">\n'
        '  <meta property="og:description" content="' + esc(desc_text) + '">\n'
        '  <meta property="og:image" content="' + esc(img) + '">\n'
        '  <meta property="og:url" content="' + esc(page_url) + '">\n'
        '  <meta property="og:type" content="profile">\n'
        '  <meta property="og:locale" content="en_US">\n'
        '  <meta property="og:site_name" content="Favoread">\n'
        '  <meta name="twitter:card" content="summary_large_image">\n'
        '  <link rel="canonical" href="' + esc(page_url) + '">\n'
        '  <link rel="alternate" hreflang="en" href="' + esc(page_url) + '">\n'
        '  <link rel="alternate" hreflang="ko" href="' + esc(ko_url) + '">\n'
        '  <link rel="alternate" hreflang="x-default" href="' + esc(ko_url) + '">\n'
        '  <link rel="icon" href="' + BASE + 'favicon.svg" type="image/svg+xml">\n'
        '  <link rel="icon" href="' + BASE + 'favicon.png" type="image/png" sizes="192x192">\n'
        '  <script type="application/ld+json">\n  '
        + json.dumps(json_ld, ensure_ascii=False, indent=2) + '\n  </script>\n'
        '  <script type="application/ld+json">\n  '
        + json.dumps(breadcrumb_ld, ensure_ascii=False, indent=2) + '\n  </script>\n'
        '  <style>\n'
        '    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; max-width: 860px; margin: 0 auto; padding: 20px; color: #222; line-height: 1.6; background: #fcfaf5; }\n'
        '    .lang-toggle { position: absolute; top: 16px; right: 16px; display: flex; gap: 6px; }\n'
        '    .lang-btn { padding: 6px 12px; border: 2px solid #000; background: #fff; box-shadow: 2px 2px 0 0 #000; font-size: 12px; font-weight: 700; text-decoration: none; color: #000; transition: transform .1s, box-shadow .1s; }\n'
        '    .lang-btn:hover { transform: translate(-1px,-1px); box-shadow: 3px 3px 0 0 #000; background: #fde047; text-decoration: none; }\n'
        '    .lang-btn.active { background: #000; color: #fff; }\n'
        '    nav { margin: 50px 0 16px; font-size: 13px; }\n'
        '    .celeb-header { display: flex; align-items: center; gap: 20px; margin-bottom: 16px; flex-wrap: wrap; }\n'
        '    .celeb-img { width: 120px; height: 120px; border-radius: 50%; object-fit: cover; border: 2px solid #000; }\n'
        '    h1 { font-size: 28px; margin: 0 0 8px; font-weight: 900; }\n'
        '    h2 { font-size: 19px; margin: 32px 0 12px; padding-bottom: 4px; border-bottom: 2px solid #000; font-weight: 800; }\n'
        '    .intro { background: #fff; border: 2px solid #000; box-shadow: 4px 4px 0 0 #000; padding: 14px 16px; margin: 16px 0 24px; font-size: 15px; }\n'
        '    table { width: 100%; border-collapse: collapse; font-size: 14px; background: #fff; border: 2px solid #000; }\n'
        '    th, td { border: 1px solid #000; padding: 8px 10px; text-align: left; vertical-align: middle; }\n'
        '    th { background: #fde047; font-size: 13px; font-weight: 800; }\n'
        '    a { color: #2563eb; text-decoration: none; }\n'
        '    a:hover { text-decoration: underline; }\n'
        '    footer { margin-top: 48px; padding-top: 16px; border-top: 2px solid #000; font-size: 13px; color: #666; }\n'
        '  </style>\n'
        '</head>\n'
        '<body>\n'
        '  <div class="lang-toggle">\n'
        '    <a class="lang-btn" href="' + esc(ko_url) + '" hreflang="ko">한국어</a>\n'
        '    <span class="lang-btn active">EN</span>\n'
        '  </div>\n'
        '  <nav><a href="' + EN_BASE + '">← Favoread Home</a></nav>\n'
        '  <header class="celeb-header">\n'
        '    <img class="celeb-img" src="' + esc(img) + '" alt="' + esc(name_en) + ' profile photo" width="120" height="120">\n'
        '    <div>\n'
        '      <h1>' + esc(name_en) + ' <span style="font-weight:400;color:#666;font-size:18px">(' + esc(name) + ')</span></h1>\n'
        '      <p style="margin:0;color:#666;font-size:14px">' + str(n) + ' book' + ('s' if n != 1 else '') + ' read &amp; recommended</p>\n'
        '    </div>\n'
        '  </header>\n'
        '  <section class="intro">\n'
        '    <p style="margin:0">' + str(n) + ' book' + ('s' if n != 1 else '')
        + ' read or recommended by <strong>' + esc(name_en) + '</strong> (' + esc(name)
        + '), gathered from interviews, YouTube, and SNS sources.</p>\n'
        '  </section>\n'
        '  <section>\n'
        '    <h2>Reading list</h2>\n'
        '    <table>\n'
        '      <thead><tr><th>#</th><th>Cover</th><th>Title</th><th>Author</th><th>Source</th></tr></thead>\n'
        '      <tbody>\n' + rows +
        '      </tbody>\n'
        '    </table>\n'
        '  </section>\n'
        '  <footer>\n'
        '    <p>Curated from public Korean-language sources. Korean original page: <a href="'
        + esc(ko_url) + '" hreflang="ko">' + esc(name) + '</a>.</p>\n'
        '  </footer>\n'
        '</body>\n'
        '</html>'
    )
    write_if_changed('en/share/' + slug + '.html', page)

print(f"✅ /en/ 셀럽 페이지: {len(en_celeb_pages)}개")

# 영문 책 페이지 (≥2 셀럽 읽은 책 + title_en 검수 완료)
for title, t_en in book_title_en.items():
    if title not in books_with_pages:
        continue
    binfo = book_celebs[title]
    slug = safe_en_filename(t_en)
    page_url = make_en_book_url(t_en)
    ko_url   = make_book_url(title)
    n_celebs = len(binfo['celebs'])

    # 셀럽 목록: 모두 "EnglishName (Korean)" 형식으로 통일.
    # name_en 있으면 EN 셀럽 페이지로 링크, 없으면 KO 페이지로 링크.
    celeb_items = []
    for c in sorted(binfo['celebs']):
        c_en = celebs[c].get('name_en')
        if c_en:
            celeb_items.append(
                '    <li><a href="../' + safe_en_filename(c_en) + '.html">'
                + esc(c_en) + '</a> <span style="color:#888;font-size:13px">('
                + esc(c) + ')</span></li>'
            )
        else:
            # name_en 없으면 한국어 이름만 KO 페이지로. 향후 enrich으로 채워짐.
            celeb_items.append(
                '    <li><a href="' + esc(make_celeb_url(c)) + '" hreflang="ko">'
                + esc(c) + '</a> <span style="color:#888;font-size:12px">(English name pending)</span></li>'
            )
    celeb_list = '\n'.join(celeb_items)

    cover_html = ''
    if binfo['coverUrl'] and binfo['coverUrl'].startswith('http'):
        cover_html = ('  <img src="' + esc(binfo['coverUrl']) + '" alt="' + esc(t_en)
                      + ' cover" width="200" height="280" loading="lazy" '
                      'style="object-fit:cover; margin:16px 0; border:2px solid #000">\n')

    title_text = t_en + ' — Read by ' + str(n_celebs) + ' Korean Celebrities'
    desc_text  = (t_en + ' (Korean: ' + esc(title) + ') was read by ' + str(n_celebs)
                  + ' Korean celebrities, idols, and actors.')

    json_ld = clean_none({
        '@context': 'https://schema.org',
        '@type': 'Book',
        'name': t_en,
        'alternateName': title,
        'url': page_url,
        'inLanguage': 'en',
        'description': str(n_celebs) + ' Korean celebrities have read this book.',
        'author': {'@type': 'Person', 'name': binfo['author']} if binfo['author'].strip() else None,
        'publisher': {'@type': 'Organization', 'name': binfo['publisher']} if binfo['publisher'].strip() else None,
        'image': binfo['coverUrl'] if binfo['coverUrl'].startswith('http') else None,
    })

    page = (
        '<!DOCTYPE html>\n'
        '<html lang="en">\n'
        '<head>\n'
        '  <meta charset="utf-8">\n'
        '  <meta name="viewport" content="width=device-width, initial-scale=1">\n'
        '  <title>' + esc(title_text) + ' | Favoread</title>\n'
        '  <meta name="description" content="' + esc(desc_text) + '">\n'
        '  <meta name="robots" content="index, follow, max-image-preview:large">\n'
        '  <meta property="og:title" content="' + esc(title_text) + '">\n'
        '  <meta property="og:description" content="' + esc(desc_text) + '">\n'
        '  <meta property="og:url" content="' + esc(page_url) + '">\n'
        '  <meta property="og:type" content="book">\n'
        '  <meta property="og:locale" content="en_US">\n'
        + (('  <meta property="og:image" content="' + esc(binfo['coverUrl']) + '">\n')
           if binfo['coverUrl'].startswith('http') else '')
        + '  <link rel="canonical" href="' + esc(page_url) + '">\n'
        '  <link rel="alternate" hreflang="en" href="' + esc(page_url) + '">\n'
        '  <link rel="alternate" hreflang="ko" href="' + esc(ko_url) + '">\n'
        '  <link rel="alternate" hreflang="x-default" href="' + esc(ko_url) + '">\n'
        '  <link rel="icon" href="' + BASE + 'favicon.svg" type="image/svg+xml">\n'
        '  <script type="application/ld+json">\n  '
        + json.dumps(json_ld, ensure_ascii=False, indent=2) + '\n  </script>\n'
        '  <style>\n'
        '    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; color: #222; background: #fcfaf5; line-height: 1.6; }\n'
        '    .lang-toggle { position: absolute; top: 16px; right: 16px; display: flex; gap: 6px; }\n'
        '    .lang-btn { padding: 6px 12px; border: 2px solid #000; background: #fff; box-shadow: 2px 2px 0 0 #000; font-size: 12px; font-weight: 700; text-decoration: none; color: #000; transition: transform .1s, box-shadow .1s; }\n'
        '    .lang-btn:hover { transform: translate(-1px,-1px); box-shadow: 3px 3px 0 0 #000; background: #fde047; text-decoration: none; }\n'
        '    .lang-btn.active { background: #000; color: #fff; }\n'
        '    nav { margin: 50px 0 16px; font-size: 13px; }\n'
        '    h1 { font-size: 28px; margin: 0 0 6px; font-weight: 900; }\n'
        '    h2 { font-size: 19px; margin: 32px 0 12px; padding-bottom: 4px; border-bottom: 2px solid #000; font-weight: 800; }\n'
        '    .meta { color: #666; margin: 0 0 16px; }\n'
        '    ul { line-height: 2; padding-left: 22px; }\n'
        '    a { color: #2563eb; text-decoration: none; }\n'
        '    a:hover { text-decoration: underline; }\n'
        '  </style>\n'
        '</head>\n'
        '<body>\n'
        '  <div class="lang-toggle">\n'
        '    <a class="lang-btn" href="' + esc(ko_url) + '" hreflang="ko">한국어</a>\n'
        '    <span class="lang-btn active">EN</span>\n'
        '  </div>\n'
        '  <nav><a href="' + EN_BASE + '">← Favoread Home</a></nav>\n'
        '  <h1>' + esc(t_en) + '</h1>\n'
        '  <p class="meta">Korean: <strong>' + esc(title) + '</strong>'
        + ((' · ' + esc(binfo['author'])) if binfo['author'].strip() else '')
        + ((' · ' + esc(binfo['publisher'])) if binfo['publisher'].strip() else '')
        + '</p>\n'
        + cover_html
        + '  <h2>Read by ' + str(n_celebs) + ' Korean celebrities</h2>\n'
        '  <ul>\n' + celeb_list + '\n  </ul>\n'
        '  <p style="margin-top:32px"><a href="' + EN_BASE + '">← Back to Favoread</a></p>\n'
        '</body>\n'
        '</html>'
    )
    write_if_changed('en/share/book/' + slug + '.html', page)
    en_book_pages.append((slug, t_en, title))

print(f"✅ /en/ 책 페이지: {len(en_book_pages)}개")

# /en/index.html — 영문 랜딩 페이지 (메인 한국어 사이트와 동일한 Tailwind/Neo 디자인)
en_celeb_pages.sort(key=lambda x: x[1].lower())  # name_en 알파벳 정렬

EN_LINK_CLASS = 'inline-block px-3 py-1.5 border-2 border-ink rounded-none bg-white hover:bg-neo-yellow shadow-neo-sm hover:shadow-neo hover:-translate-y-0.5 transition-all text-[11px] sm:text-xs font-bold font-sans text-ink'

en_celeb_buttons = '\n'.join(
    '    <a href="share/' + slug + '.html" class="' + EN_LINK_CLASS + '">'
    + esc(name_en) + ' <span class="text-muted font-normal">(' + esc(name_ko) + ')</span></a>'
    for slug, name_en, name_ko in en_celeb_pages
)
en_book_buttons = '\n'.join(
    '    <a href="share/book/' + slug + '.html" class="' + EN_LINK_CLASS + '">'
    + esc(t_en) + ' <span class="text-muted font-normal">(' + esc(t_ko) + ')</span></a>'
    for slug, t_en, t_ko in sorted(en_book_pages, key=lambda x: x[1].lower())
)

en_index_jsonld = json.dumps({
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    'name': 'Favoread',
    'alternateName': ['최애의 독서', 'Favoread English'],
    'url': EN_BASE,
    'description': 'A curated archive of books read by Korean celebrities, K-pop idols, and actors.',
    'image': BASE + 'og-image.jpg',
    'inLanguage': 'en-US',
}, ensure_ascii=False, indent=2)

en_index = (
    '<!DOCTYPE html>\n'
    '<html lang="en">\n'
    '<head>\n'
    '  <meta charset="UTF-8">\n'
    '  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n'
    '  <title>Favoread | Books Read by Korean Celebrities, K-pop Idols & Actors</title>\n'
    '  <meta name="description" content="What are Korean celebrities, K-pop idols, and actors reading? A curated archive of reading lists from BTS RM, IU, and more — sourced from interviews, YouTube, and SNS.">\n'
    '  <meta name="keywords" content="kpop idol books, korean celebrity reading, korean actor books, BTS RM reading list, IU books, kpop star recommendations, korean celebrity book recommendations">\n'
    '  <meta name="referrer" content="no-referrer">\n'
    '\n'
    '  <link rel="icon" href="' + BASE + 'favicon.svg" type="image/svg+xml">\n'
    '  <link rel="icon" href="' + BASE + 'favicon.png" type="image/png" sizes="192x192">\n'
    '  <link rel="apple-touch-icon" href="' + BASE + 'favicon.png">\n'
    '\n'
    '  <meta property="og:site_name" content="Favoread">\n'
    '  <meta property="og:title" content="Favoread | Books Read by Korean Celebrities, K-pop Idols & Actors">\n'
    '  <meta property="og:description" content="What are Korean celebrities, K-pop idols, and actors reading? Curated reading lists from interviews, YouTube, and SNS.">\n'
    '  <meta property="og:type" content="website">\n'
    '  <meta property="og:url" content="' + EN_BASE + '">\n'
    '  <meta property="og:image" content="' + BASE + 'og-image.jpg">\n'
    '  <meta property="og:image:width" content="1200">\n'
    '  <meta property="og:image:height" content="630">\n'
    '  <meta property="og:image:alt" content="Favoread — books read by Korean celebrities">\n'
    '  <meta property="og:locale" content="en_US">\n'
    '  <meta property="og:locale:alternate" content="ko_KR">\n'
    '\n'
    '  <meta name="twitter:card" content="summary_large_image">\n'
    '  <meta name="twitter:title" content="Favoread | Books Read by Korean Celebrities">\n'
    '  <meta name="twitter:description" content="What are Korean celebrities, K-pop idols, and actors reading?">\n'
    '  <meta name="twitter:image" content="' + BASE + 'og-image.jpg">\n'
    '\n'
    '  <link rel="canonical" href="' + EN_BASE + '">\n'
    '  <link rel="alternate" hreflang="en" href="' + EN_BASE + '">\n'
    '  <link rel="alternate" hreflang="ko" href="' + BASE + '">\n'
    '  <link rel="alternate" hreflang="x-default" href="' + BASE + '">\n'
    '\n'
    '  <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1">\n'
    '  <meta name="theme-color" content="#ffffff">\n'
    '\n'
    '  <link rel="alternate" type="application/rss+xml" title="Favoread RSS" href="' + BASE + 'feed.xml">\n'
    '\n'
    '  <link rel="preconnect" href="https://fonts.googleapis.com">\n'
    '  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n'
    '\n'
    '  <script type="application/ld+json">\n  ' + en_index_jsonld + '\n  </script>\n'
    '\n'
    '  <script src="https://cdn.tailwindcss.com"></script>\n'
    '  <link href="https://fonts.googleapis.com/css2?family=Noto+Serif+KR:wght@200;400;600;900&family=Space+Grotesk:wght@400;700&display=swap" rel="stylesheet">\n'
    '\n'
    '  <script>\n'
    '    tailwind.config = {\n'
    '      theme: {\n'
    '        extend: {\n'
    '          fontFamily: {\n'
    '            serif: [\'"Noto Serif KR"\', \'serif\'],\n'
    '            sans:  [\'"Space Grotesk"\', \'sans-serif\'],\n'
    '          },\n'
    '          colors: {\n'
    '            ink:        \'#000000\',\n'
    '            paper:      \'#ffffff\',\n'
    '            \'paper-dark\': \'#f4f4f0\',\n'
    '            muted:      \'#666666\',\n'
    '            \'neo-mint\':   \'#a7f3d0\',\n'
    '            \'neo-pink\':   \'#fbcfe8\',\n'
    '            \'neo-yellow\': \'#fde047\',\n'
    '          },\n'
    '          boxShadow: {\n'
    '            neo:    \'4px 4px 0px 0px rgba(0,0,0,1)\',\n'
    '            \'neo-lg\': \'8px 8px 0px 0px rgba(0,0,0,1)\',\n'
    '            \'neo-sm\': \'2px 2px 0px 0px rgba(0,0,0,1)\',\n'
    '          },\n'
    '        }\n'
    '      }\n'
    '    }\n'
    '  </script>\n'
    '\n'
    '  <style>\n'
    '    html, body { min-height: 100%; }\n'
    '    body {\n'
    '      background-color: #fcfaf5;\n'
    '      color: #000;\n'
    '      -webkit-font-smoothing: antialiased;\n'
    '    }\n'
    '    ::selection { background: #fde047; color: #000; }\n'
    '    .word-break-keep { word-break: keep-all; }\n'
    '  </style>\n'
    '</head>\n'
    '<body class="font-serif relative selection:bg-neo-yellow selection:text-ink">\n'
    '\n'
    '<div class="absolute top-4 right-4 md:top-8 md:right-8 z-40 flex gap-2">\n'
    '  <a href="' + BASE + '" hreflang="ko" class="px-3 py-1.5 bg-white border-2 border-ink shadow-neo-sm hover:bg-neo-yellow hover:shadow-neo hover:-translate-y-0.5 transition-all font-sans font-bold text-xs text-ink">한국어</a>\n'
    '  <span class="px-3 py-1.5 bg-ink border-2 border-ink shadow-neo-sm font-sans font-bold text-xs text-paper">EN</span>\n'
    '</div>\n'
    '\n'
    '<main class="max-w-5xl mx-auto px-4 sm:px-6 py-12 md:py-24 flex flex-col gap-12 md:gap-16">\n'
    '\n'
    '  <header class="flex flex-col items-center pt-10 md:pt-0 text-center">\n'
    '    <p class="font-sans font-bold text-xs tracking-[0.2em] text-muted mb-4">FAVOREAD · ENGLISH</p>\n'
    '    <h1 class="text-4xl sm:text-5xl md:text-6xl font-black mb-4 word-break-keep">\n'
    '      Books Read by<br>\n'
    '      <span class="bg-neo-yellow border-2 border-ink shadow-neo-sm px-3 inline-block">Korean Celebrities</span>\n'
    '    </h1>\n'
    '    <p class="text-base md:text-lg font-bold text-muted max-w-xl mx-auto word-break-keep mt-4">\n'
    '      A curated archive of reading lists from K-pop idols, actors, and Korean celebrities. Sourced from interviews, YouTube, and SNS.\n'
    '    </p>\n'
    '    <p class="font-sans text-xs text-muted mt-3">\n'
    '      Names follow <a href="https://kpop.fandom.com/" target="_blank" rel="noopener" class="underline">Kpop Wiki</a> / <a href="https://www.imdb.com/" target="_blank" rel="noopener" class="underline">IMDb</a> conventions · Book titles use the official English edition where available\n'
    '    </p>\n'
    '  </header>\n'
    '\n'
    + ('  <section class="border-t-4 border-ink pt-12 md:pt-16">\n'
       '    <h2 class="text-2xl md:text-3xl font-black mb-2 word-break-keep">Celebrities (' + str(len(en_celeb_pages)) + ')</h2>\n'
       '    <p class="text-sm md:text-base font-bold text-muted mb-8 word-break-keep">Click a name to see their full reading list.</p>\n'
       '    <div class="flex flex-wrap gap-2 md:gap-3">\n'
       + en_celeb_buttons + '\n'
       '    </div>\n'
       '  </section>\n\n' if en_celeb_buttons
       else '  <section class="border-t-4 border-ink pt-12 md:pt-16 text-center">\n'
       '    <p class="font-bold text-muted">No English profiles available yet. <a href="' + BASE + '" hreflang="ko" class="underline decoration-2 hover:text-ink">Browse the full Korean archive →</a></p>\n'
       '  </section>\n\n')
    + ('  <section class="border-t-4 border-ink pt-12 md:pt-16">\n'
       '    <h2 class="text-2xl md:text-3xl font-black mb-2 word-break-keep">Books Read by 2+ Celebrities (' + str(len(en_book_pages)) + ')</h2>\n'
       '    <p class="text-sm md:text-base font-bold text-muted mb-8 word-break-keep">Books that show up across multiple celebrity reading lists.</p>\n'
       '    <div class="flex flex-wrap gap-2 md:gap-3">\n'
       + en_book_buttons + '\n'
       '    </div>\n'
       '  </section>\n\n' if en_book_buttons else '')
    + '  <footer class="border-t-4 border-ink pt-8 text-center font-sans text-xs text-muted">\n'
    '    <p>This is an English gateway to <a href="' + BASE + '" hreflang="ko" class="underline decoration-2 hover:text-ink">최애의 독서</a> — the full archive of <strong>' + str(len(celebs)) + ' Korean celebrities</strong> is available in Korean.</p>\n'
    '  </footer>\n'
    '\n'
    '</main>\n'
    '\n'
    '</body>\n'
    '</html>'
)
write_if_changed('en/index.html', en_index)
print(f"✅ /en/index.html 생성")

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

ranking_breadcrumb_ld = json.dumps({
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    'itemListElement': [
        {
            '@type': 'ListItem',
            'position': 1,
            'name': '홈',
            'item': BASE
        },
        {
            '@type': 'ListItem',
            'position': 2,
            'name': '셀럽 독서 랭킹',
            'item': ranking_url
        }
    ]
}, ensure_ascii=False, indent=2)

ranking_itemlist_ld = json.dumps({
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    'name': '셀럽이 가장 많이 읽은 책 TOP 30',
    'numberOfItems': len(top_books),
    'itemListElement': [
        {
            '@type': 'ListItem',
            'position': i + 1,
            'name': t,
            'url': make_book_url(t)
        }
        for i, (t, bi) in enumerate(top_books)
    ]
}, ensure_ascii=False, indent=2)

ranking_page = (
    '<!DOCTYPE html>\n'
    '<html lang="ko">\n'
    '<head>\n'
    '  <meta charset="utf-8">\n'
    '  <meta name="viewport" content="width=device-width, initial-scale=1">\n'
    '  <title>셀럽이 가장 많이 읽은 책·저자·출판사 랭킹 | 최애의 독서</title>\n'
    '  <meta name="description" content="셀럽이 가장 많이 읽은 책 TOP 30, 저자 TOP 20, 출판사 TOP 15를 확인해 보세요. 아이돌·배우·뮤지션의 독서 트렌드!">\n'
    '  <meta name="keywords" content="셀럽 독서 랭킹, 인기 책, 아이돌 추천 책, 셀럽 인생책, 최애의 독서">\n'
    '  <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1">\n'
    '  <meta name="theme-color" content="#ffffff">\n'
    '\n'
    '  <meta property="og:title" content="셀럽 독서 랭킹 | 최애의 독서">\n'
    '  <meta property="og:description" content="셀럽이 가장 많이 읽은 책·저자·출판사 랭킹">\n'
    '  <meta property="og:url" content="' + ranking_url + '">\n'
    '  <meta property="og:type" content="website">\n'
    '  <meta property="og:site_name" content="최애의 독서">\n'
    '  <meta property="og:locale" content="ko_KR">\n'
    '  <meta property="og:image" content="' + BASE + 'og-image.jpg">\n'
    '  <meta property="og:image:width" content="1200">\n'
    '  <meta property="og:image:height" content="630">\n'
    '  <meta property="og:image:alt" content="셀럽 독서 랭킹 - 최애의 독서">\n'
    '  <meta name="twitter:card" content="summary_large_image">\n'
    '  <meta name="twitter:title" content="셀럽 독서 랭킹 | 최애의 독서">\n'
    '  <meta name="twitter:description" content="셀럽이 가장 많이 읽은 책·저자·출판사 랭킹">\n'
    '  <meta name="twitter:image" content="' + BASE + 'og-image.jpg">\n'
    '  <meta name="twitter:image:alt" content="셀럽 독서 랭킹 - 최애의 독서">\n'
    '\n'
    '  <link rel="canonical" href="' + ranking_url + '">\n'
    '  <link rel="icon" href="' + BASE + 'favicon.svg" type="image/svg+xml">\n'
    '  <link rel="icon" href="' + BASE + 'favicon.png" type="image/png" sizes="192x192">\n'
    '  <link rel="apple-touch-icon" href="' + BASE + 'favicon.png">\n'
    '  <link rel="alternate" type="application/rss+xml" title="최애의 독서 RSS" href="' + BASE + 'feed.xml">\n'
    '\n'
    '  <script type="application/ld+json">\n'
    '  ' + ranking_breadcrumb_ld + '\n'
    '  </script>\n'
    '  <script type="application/ld+json">\n'
    '  ' + ranking_itemlist_ld + '\n'
    '  </script>\n'
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
    '</body>\n'
    '</html>'
)

write_if_changed('share/ranking.html', ranking_page)
print("✅ 랭킹 페이지 생성: share/ranking.html")

# ── 6.5. 고아(orphan) share 파일 정리 ────────────────────────────────
#
# data.csv에서 삭제된 셀럽/책의 HTML이 share/ 폴더에 남아있으면
# sitemap에서는 빠진 채로 검색엔진에는 노출되어 "발견됨 - 색인 미생성"이 됩니다.
# 이번 빌드에서 생성하지 않은 share 파일은 삭제합니다.

generated_celeb_paths = {'share/' + safe_filename(n) + '.html' for n in celebs.keys()}
generated_book_paths  = {'share/book/' + fn + '.html' for fn, _ in book_pages}
keep_top_level = generated_celeb_paths | {'share/ranking.html'}

removed = 0
for f in os.listdir('share'):
    p = 'share/' + f
    if os.path.isfile(p) and f.endswith('.html') and p not in keep_top_level:
        os.remove(p)
        removed += 1
for f in os.listdir('share/book'):
    p = 'share/book/' + f
    if os.path.isfile(p) and f.endswith('.html') and p not in generated_book_paths:
        os.remove(p)
        removed += 1

# /en/ 영문 페이지 고아 정리
generated_en_celeb_paths = {'en/share/' + slug + '.html' for slug, _, _ in en_celeb_pages}
generated_en_book_paths  = {'en/share/book/' + slug + '.html' for slug, _, _ in en_book_pages}
keep_en_top = generated_en_celeb_paths
for f in os.listdir('en/share'):
    p = 'en/share/' + f
    if os.path.isfile(p) and f.endswith('.html') and p not in keep_en_top:
        os.remove(p)
        removed += 1
for f in os.listdir('en/share/book'):
    p = 'en/share/book/' + f
    if os.path.isfile(p) and f.endswith('.html') and p not in generated_en_book_paths:
        os.remove(p)
        removed += 1
print(f"✅ 고아 share 파일 정리: {removed}개 삭제")

# ── 7. sitemap.xml 생성 (이미지 사이트맵 포함) ──────────────────────
#
# Google 이미지 사이트맵 네임스페이스를 추가하여
# 각 페이지에 연결된 이미지를 명시적으로 알려줍니다.
# 이렇게 하면 구글이 올바른 이미지를 연결합니다.

IMAGE_NS = 'xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"'

home_lastmod    = lastmod_for('index.html')
ranking_lastmod = lastmod_for('share/ranking.html')

lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" ' + IMAGE_NS + '>',
    '  <url>',
    '    <loc>' + BASE + '</loc>',
    '    <lastmod>' + home_lastmod + '</lastmod>',
    '    <changefreq>daily</changefreq>',
    '    <priority>1.0</priority>',
    '  </url>',
    '  <url>',
    '    <loc>' + ranking_url + '</loc>',
    '    <lastmod>' + ranking_lastmod + '</lastmod>',
    '    <changefreq>weekly</changefreq>',
    '    <priority>0.8</priority>',
    '  </url>',
]

# 셀럽 페이지 (이미지 포함)
for name in sorted(celebs.keys()):
    fn = safe_filename(name)
    url = BASE + 'share/' + quote(fn, safe='') + '.html'
    img_url = celebs[name]['img']
    page_lastmod = lastmod_for('share/' + fn + '.html')

    lines += [
        '  <url>',
        '    <loc>' + esc_xml(url) + '</loc>',
        '    <lastmod>' + page_lastmod + '</lastmod>',
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
    book_lastmod = lastmod_for('share/book/' + fn + '.html')
    lines += [
        '  <url>',
        '    <loc>' + esc_xml(url) + '</loc>',
        '    <lastmod>' + book_lastmod + '</lastmod>',
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

# /en/ 영문 페이지 (영문 데이터가 있을 때만)
if en_celeb_pages or en_book_pages:
    en_index_lastmod = lastmod_for('en/index.html')
    lines += [
        '  <url>',
        '    <loc>' + EN_BASE + '</loc>',
        '    <lastmod>' + en_index_lastmod + '</lastmod>',
        '    <changefreq>weekly</changefreq>',
        '    <priority>0.7</priority>',
        '  </url>',
    ]
    for slug, name_en, name_ko in en_celeb_pages:
        url = make_en_celeb_url(name_en)
        lines += [
            '  <url>',
            '    <loc>' + esc_xml(url) + '</loc>',
            '    <lastmod>' + lastmod_for('en/share/' + slug + '.html') + '</lastmod>',
            '    <changefreq>weekly</changefreq>',
            '    <priority>0.6</priority>',
            '  </url>',
        ]
    for slug, t_en, t_ko in en_book_pages:
        url = make_en_book_url(t_en)
        lines += [
            '  <url>',
            '    <loc>' + esc_xml(url) + '</loc>',
            '    <lastmod>' + lastmod_for('en/share/book/' + slug + '.html') + '</lastmod>',
            '    <changefreq>weekly</changefreq>',
            '    <priority>0.5</priority>',
            '  </url>',
        ]

lines.append('</urlset>')

write_if_changed('sitemap.xml', '\n'.join(lines) + '\n')

total_urls = (1 + 1 + len(celebs) + len(book_pages)
              + (1 + len(en_celeb_pages) + len(en_book_pages) if en_celeb_pages or en_book_pages else 0))
print(f"✅ sitemap.xml 생성: {total_urls}개 URL (이미지 사이트맵 포함)")

# ── 8. robots.txt 생성 (사이트맵 위치 명시) ─────────────────────────
#
# 구글이 사이트맵을 "가져올 수 없음" 에러의 가장 흔한 원인:
# robots.txt에 Sitemap 선언이 없거나, Disallow 규칙이 충돌하는 경우

# 주의: 과거 `Disallow: /*?celeb=`는 index.html이 ?celeb= 파라미터를 실제로
# 사용(셀럽 필터)하기 때문에 자기 사이트의 정상 트래픽을 차단하는 모순이었음.
# rel="nofollow" 처리되어 있고 정적 share/*.html이 정식 색인 대상이므로 제거.
robots_txt = (
    'User-agent: *\n'
    'Allow: /\n'
    '\n'
    'Sitemap: ' + BASE + 'sitemap.xml\n'
    'Sitemap: ' + BASE + 'feed.xml\n'
)

write_if_changed('robots.txt', robots_txt)
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

write_if_changed('feed.xml', feed_xml)
print(f"✅ feed.xml 자동 생성: {len(feed_items)}개 아이템")

print("\n🎉 빌드 완료!")
