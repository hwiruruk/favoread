import csv, datetime, os, json, re, html, subprocess, io
from urllib.parse import quote

BASE = "https://favorbook.co.kr/"

# ── Google Analytics 4 (gtag.js) ─────────────────────────────────
# 공개 페이지 <head> 최상단에 공통으로 삽입되는 측정 태그.
# 내부 관리 도구(editor/, cardnews/)는 noindex이며 통계를 왜곡하므로 제외한다.
GA_MEASUREMENT_ID = "G-42YXZRRS25"
GA_TAG = (
    '  <!-- Google tag (gtag.js) — Consent Mode: 동의 전에는 analytics_storage를 기본 거부 -->\n'
    '  <script>\n'
    '    window.dataLayer = window.dataLayer || [];\n'
    '    function gtag(){dataLayer.push(arguments);}\n'
    "    gtag('consent', 'default', {\n"
    "      'analytics_storage': 'denied',\n"
    "      'ad_storage': 'denied',\n"
    "      'ad_user_data': 'denied',\n"
    "      'ad_personalization': 'denied'\n"
    '    });\n'
    "    gtag('js', new Date());\n"
    "    gtag('config', '" + GA_MEASUREMENT_ID + "');\n"
    '    try {\n'
    "      if (localStorage.getItem('ga-consent') === 'granted') {\n"
    "        gtag('consent', 'update', { analytics_storage: 'granted' });\n"
    '      }\n'
    '    } catch (e) {}\n'
    '  </script>\n'
    '  <script async src="https://www.googletagmanager.com/gtag/js?id=' + GA_MEASUREMENT_ID + '"></script>\n'
)
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

# 편집기의 "직역*" 버튼이 기계 번역한 값에는 끝에 ` *` 를 붙인다
# (editor/app.js의 cased + ' *'). 공식 영문판 제목이나 표준 로마자 표기가
# 확인되지 않았다는 뜻이라, 영문 페이지에서는 이 표시가 뭔지 알려줘야 한다.

def is_auto_translated(value):
    return bool(re.search(r'\*\s*$', (value or '').strip()))


def has_auto_translated(*values):
    """값 중 하나라도 직역 표시가 붙어 있으면 True."""
    return any(is_auto_translated(v) for v in values)


def plain_en(value):
    """직역 표시(*)를 뗀 값.

    *는 사람에게 '이건 기계 번역'이라고 알려주는 표시라 본문 목록에만 쓴다.
    alt·aria-label·메타 설명·구조화 데이터처럼 기계가 읽고 검색 결과에
    그대로 나오는 자리에서는 오타처럼 보이므로 뗀다.
    """
    return re.sub(r'\s*\*\s*$', '', (value or '').strip())


# ── 영문 책 제목 검수 (data/titles_en.json) ─────────────────────────
# tools/fetch_titles_en.py 가 원제·위키백과에서 모은 후보를 편집기의
# '🔤 영문 제목 검수' 창에서 사람이 고른 결과. data.csv 의 도서명_en 보다 우선한다.
#   approved  공식 영문판 제목 → value 그대로
#   none      공식 영문판 없음 → value 에 직역 표시(*)를 붙여서, 비었으면 영문 페이지에서 뺌
#   pending   아직 안 봄 → data.csv 값을 그대로 쓴다

# 사이트에 나가면 안 되는 흔적. tools/fetch_titles_en.py 의 PROBLEM_RULES 와 같이 고친다.
EN_TITLE_PROBLEMS = [
    (re.compile(r'\(\s*or\b', re.I), '"(or ...)" 대안 문구'),
    (re.compile(r'\bor similar\b|\bno (?:widely )?confirmed\b|\bofficial english\b'
                r'|\bunofficial\b|\bnot (?:officially )?translated\b', re.I), 'AI 설명 문구'),
    (re.compile(r'[가-힣ㄱ-ㅎㅏ-ㅣ]'), '한글이 섞임'),
]


def en_title_problem(title_ko, value):
    """영문 제목에 AI 답변 문구나 후보 나열이 섞였는지. 문제 없으면 None."""
    v = (value or '').strip()
    if not v:
        return None
    for rx, why in EN_TITLE_PROBLEMS:
        if rx.search(v):
            return why
    if ' / ' in v and '/' not in (title_ko or ''):
        return '"A / B" 후보 나열'
    return None


# 영문 제목 표기 원칙: 단어 첫 글자만 대문자 (Title Case).
# tools/fetch_titles_en.py 의 en_title_case(), editor/app.js 의 enTitleCase() 와 같은 규칙.
#   · 전부 대문자로 온 제목(THE WHITE BOOK)은 풀어서 맞추고, iPhone·BTS·1Q84 같은 표기는 그대로
#   · a, the, of, and 같은 짧은 말은 첫 단어·끝 단어·콜론 뒤가 아니면 소문자
#   · 영어가 아닌 제목(La lenteur)은 그 언어 관례가 달라 손대지 않는다
EN_TITLE_SMALL = {'a', 'an', 'the', 'and', 'but', 'or', 'nor', 'for', 'so', 'yet', 'as', 'at',
                  'by', 'in', 'of', 'on', 'to', 'up', 'via', 'with', 'from', 'into', 'onto',
                  'over', 'per', 'than', 'vs'}
EN_ROMAN_RE = re.compile(r'^(?=[ivxlcdm]+$)m{0,3}(cm|cd|d?c{0,3})(xc|xl|l?x{0,3})(ix|iv|v?i{0,3})$', re.I)
EN_FOREIGN_RE = re.compile(
    r"[àâäçéèêëîïôöùûüÿñãõáíóúōūāēīåøæœß]"
    r"|\b(?:le|la|les|des|du|l'|d'|et|der|das|und|ein|eine|um|uma|os|il|della|och|jag|het|een)\b",
    re.I)


def en_title_case(value):
    v = (value or '').strip()
    star = ''
    m = re.search(r'\s*\*\s*$', v)
    if m:
        star, v = ' *', v[:m.start()]
    if not v or EN_FOREIGN_RE.search(v):
        return v + star
    letters = [c for c in v if c.isalpha()]
    shouting = len(letters) > 3 and sum(c.isupper() for c in letters) / len(letters) > 0.8
    tokens = re.split(r'(\s+)', v)
    words = [i for i, t in enumerate(tokens) if t.strip()]
    for n, i in enumerate(words):
        w = tokens[i]
        core = re.sub(r"^\W+|\W+$", '', w)
        if not core:
            continue
        edge = n == 0 or n == len(words) - 1 or re.search(r'[:.?!—–]$', tokens[words[n - 1]])
        low = core.lower()
        if EN_ROMAN_RE.match(core) and (shouting or core.isupper()):
            new = core.upper()
        elif shouting or core.islower():
            base = low if shouting else core
            new = base if (low in EN_TITLE_SMALL and not edge) else base[:1].upper() + base[1:]
        elif low in EN_TITLE_SMALL and not edge and core[:1].isupper() and core[1:].islower():
            new = low
        else:
            new = core
        tokens[i] = w.replace(core, new, 1)
    return ''.join(tokens) + star


def load_titles_en():
    path = os.path.join('data', 'titles_en.json')
    if not os.path.exists(path):
        return {}
    try:
        with open(path, encoding='utf-8') as fp:
            return (json.load(fp) or {}).get('titles') or {}
    except (json.JSONDecodeError, OSError) as e:
        print('⚠️ data/titles_en.json 읽기 실패 — data.csv 값만 씁니다: %s' % e)
        return {}


TITLES_EN = load_titles_en()
EN_TITLE_SKIPPED = {}   # 도서명 → 뺀 이유 (빌드 끝에 한 번에 알린다)


def resolve_title_en(title_ko, author_ko, csv_value):
    """검수 결과 > data.csv 순으로 영문 제목을 정하고, 문제 있는 값은 뺀다."""
    ent = TITLES_EN.get(title_ko + '|' + (author_ko or ''))
    value = csv_value
    if ent and ent.get('status') == 'approved' and (ent.get('value') or '').strip():
        value = ent['value'].strip()
    elif ent and ent.get('status') == 'none':
        v = re.sub(r'\s*\*\s*$', '', (ent.get('value') or '').strip())
        value = (v + ' *') if v else None
    why = en_title_problem(title_ko, value)
    if why:
        EN_TITLE_SKIPPED[title_ko] = '%s — %s' % (why, value)
        return None
    return en_title_case(value) if value else value


# 영문 셀럽/책 페이지(자체 <style> 사용)용 각주
EN_TR_NOTE_CSS = (
    '    .tr-note { margin: 24px 0 0; padding: 10px 12px; background: #fff8e7; '
    'border-left: 4px solid #000; font-size: 13px; line-height: 1.5; color: #444; }\n'
)
EN_TR_NOTE_TEXT = (
    'Book titles and author names marked with an asterisk (<strong>*</strong>) are '
    'machine-translated from Korean. No official English edition was confirmed for '
    'them, so read them as approximations of the Korean original shown next to them.'
)
EN_TR_NOTE_HTML = '  <p class="tr-note">' + EN_TR_NOTE_TEXT + '</p>\n'


# ── 책등(spine) ──────────────────────────────────────────────────────
# 예스24는 표지와 같은 상품 ID로 책등 이미지를 준다.
#   표지  https://image.yes24.com/goods/91901136/L
#   책등  https://image.yes24.com/goods/91901136/side
# 그래서 표지 URL만 있으면 책등 URL이 나온다. 다만 상품이 있다고 책등
# 사진까지 있는 건 아니다(아래 NO_SPINE). 없으면 spine_tint()로 만든
# 색 책등으로 대신한다.

YES24_ID_RE = re.compile(r'image\.yes24\.com/goods/(?:detail/)?(\d+)', re.I)


def yes24_goods_id(url):
    """예스24 이미지 URL에서 상품 ID를 뽑는다. 못 뽑으면 None."""
    m = YES24_ID_RE.search(url or '')
    return m.group(1) if m else None


def yes24_spine_url(cover_url):
    """표지 URL에서 예스24 책등 이미지 URL을 유도. 못 하면 None."""
    gid = yes24_goods_id(cover_url)
    return 'https://image.yes24.com/goods/' + gid + '/side' if gid else None


def normalize_spine_value(v):
    """spines.json 값을 책등 이미지 URL로 맞춘다.

    손으로 채워 넣기 쉽게 세 가지를 다 받는다.
      · 상품 번호만          "13137546"
      · 예스24 상품 페이지 URL "https://www.yes24.com/product/goods/13137546"
      · 책등 이미지 URL 그대로 "https://image.yes24.com/goods/13137546/side"
    """
    v = str(v or '').strip()
    if not v:
        return None
    if v.isdigit():
        return 'https://image.yes24.com/goods/' + v + '/side'
    m = re.search(r'yes24\.com/(?:product/)?goods/(?:detail/)?(\d+)', v, re.I)
    if m:
        return 'https://image.yes24.com/goods/' + m.group(1) + '/side'
    return v if v.startswith('http') else None


NO_SPINE_RE = re.compile(r'goods (\d+)')


def load_spines():
    """tools/fetch_spines.py 가 채운 두 표. 없으면 빈 표 둘.

    spines  제목 → 책등 URL
    misses  제목 → 넘긴 이유. 그중 '책등 이미지 없음 (goods N)'은 상품은
            찾았지만 책등 사진이 없더라는 기록이라, 제목 → 상품 ID로 읽어
            둔다. 표지에서 책등을 유도하지 않을 근거가 된다.
    """
    path = os.path.join('data', 'spines.json')
    if not os.path.exists(path):
        return {}, {}
    try:
        with open(path, encoding='utf-8') as fp:
            doc = json.load(fp) or {}
    except (json.JSONDecodeError, OSError) as e:
        print('⚠️ data/spines.json 읽기 실패 — 표지 URL에서만 유도합니다: %s' % e)
        return {}, {}
    out = {}
    for title, v in (doc.get('spines') or {}).items():
        u = normalize_spine_value(v)
        if u:
            out[str(title).strip()] = u
        else:
            print('⚠️ data/spines.json 의 %r 값을 알아볼 수 없어 건너뜁니다: %r' % (title, v))
    no_spine = {}
    for title, reason in (doc.get('misses') or {}).items():
        if '책등 이미지 없음' not in str(reason):
            continue
        m = NO_SPINE_RE.search(str(reason))
        if m:
            no_spine[str(title).strip()] = m.group(1)
    return out, no_spine


SPINES, NO_SPINE = load_spines()


def spine_image_url(title, cover_url):
    """배치가 찾아둔 책등이 우선. 없으면 표지 URL에서 유도.

    표지가 예스24라고 책등 사진까지 있는 건 아니다. 없는 자리에는 예스24가
    '이미지 준비중' 안내 그림을 404가 아니라 200으로 내려준다. 배치가
    확인해 둔 상품이면 아예 부르지 않는다 — 브라우저에서 비율로 걸러내기는
    하지만(SPINE_IMG_GUARD), 그 전에 잠깐 비치는 걸 막는다.
    """
    t = (title or '').strip()
    if t in SPINES:
        return SPINES[t]
    if t in NO_SPINE and NO_SPINE[t] == yes24_goods_id(cover_url):
        return None
    return yes24_spine_url(cover_url)


def spine_tint(title):
    """책등 이미지가 없을 때 쓸 색. 제목에서 만들어 항상 같은 색이 나온다."""
    h = 0
    for ch in (title or ''):
        h = (h * 31 + ord(ch)) & 0xFFFFFFFF
    hue = h % 360
    sat = 32 + (h >> 9) % 26          # 32~57%
    lig = 26 + (h >> 17) % 22         # 26~47% — 흰 글자가 읽히는 범위
    return 'hsl(' + str(hue) + ',' + str(sat) + '%,' + str(lig) + '%)'


# 미리 연결해 둘 이미지 호스트. 표지를 예스24로 옮긴 뒤로 알라딘 표지는
# 몇 권뿐이라, 모든 페이지에 알라딘을 걸어두면 쓰지도 않을 연결을 연다.
# 그래서 그 페이지가 실제로 부르는 호스트만 적는다.
IMAGE_HOSTS = ('image.yes24.com', 'image.aladin.co.kr')


def image_preconnect(*parts):
    """페이지 마크업에 실제로 나온 이미지 호스트만 preconnect로 적는다."""
    hay = ''.join(p or '' for p in parts)
    out = ''
    for host in IMAGE_HOSTS:
        if host in hay:
            out += ('  <link rel="preconnect" href="https://' + host + '">\n'
                    '  <link rel="dns-prefetch" href="https://' + host + '">\n')
    return out


SPINE_H = 270                        # 책등 높이는 모두 같게


def spine_width(title):
    """두께도 책마다 조금씩. 얇은 책 두꺼운 책이 섞여야 책장처럼 보인다.

    예스24 책등 사진이 붙는 책은 사진 비율대로 폭이 정해지고 대개 25~45px이다.
    사진이 없어 색 책등으로 그리는 책만 이 값을 쓰므로, 옆에 나란히 섰을 때
    혼자 뚱뚱해 보이지 않게 그 범위에 맞춘다.
    """
    h = 0
    for ch in (title or ''):
        h = (h * 13 + ord(ch)) & 0xFFFFFFFF
    return 30 + h % 15                # 30~44px


# 책등에 적는 제목 — 서점 목록 제목을 그대로 쓰면 부제까지 다 들어가
# "하버드 상위 1퍼센트의 비밀 (2021 리커버 에디션) - 신호를 차단하고…"가 된다.
# 실제 책등에는 본제목만 찍히므로 부제와 끝에 붙은 판형 표기를 뗀다.
# 링크와 툴팁에는 원래 제목을 그대로 남긴다.
SPINE_SUBTITLE_RE = re.compile(r'\s+[-–—]\s+')
SPINE_TRAILING_RE = re.compile(r'\s*[\(\[][^)\]]*[\)\]]\s*$')


def spine_title(title):
    t = (title or '').strip()
    t = SPINE_SUBTITLE_RE.split(t)[0]
    t = SPINE_TRAILING_RE.sub('', t).strip()
    return t or (title or '').strip()


# 색 책등 제목은 세로 한 줄이라 글자 수가 곧 길이다. 기본 크기로 넘치면
# 말줄임(…) 대신 글자를 줄여 끝까지 보이게 한다.
SPINE_FS = 15                        # 기본 글자 크기
SPINE_FS_MIN = 8                     # 이보다 작아지면 읽기 어려우니 여기서 멈춘다
SPINE_TEXT_PAD = 14                  # .sp-t 위아래 여백
# 세로쓰기에서 한 글자가 잡아먹는 높이(em). 브라우저에서 직접 재서 넣었다 —
# 한글은 글자 칸에 줄 간격이 더해져 1em보다 훨씬 크다.
SPINE_EM_KO = 1.56
SPINE_EM_ETC = 0.65


def spine_font_size(title):
    """책등 높이 안에 제목이 다 들어가는 글자 크기."""
    em = 0.0
    for ch in (title or ''):
        em += SPINE_EM_KO if ord(ch) > 0x2E7F else SPINE_EM_ETC
    if em <= 0:
        return SPINE_FS
    room = SPINE_H - SPINE_TEXT_PAD * 2
    return max(SPINE_FS_MIN, min(SPINE_FS, int(room / em)))


# 예스24가 책등 사진이 없는 책에 '이미지 준비중' 안내 그림을 대신 내려준다.
# 404가 아니라 200으로 오므로 onerror로는 못 거른다. 대신 비율을 본다 —
# 진짜 책등은 아주 홀쭉하고(가로/세로 0.1~0.3), 안내 그림은 표지처럼 네모나다(0.65쯤).
# 걸리면 이미지를 지워 색 책등 + 제목으로 떨어뜨린다.
SPINE_MAX_RATIO = 0.4
SPINE_IMG_GUARD = (
    ' onerror="this.parentNode.classList.add(\'sp-fail\');this.remove()"'
    ' onload="if(this.naturalWidth/this.naturalHeight>' + str(SPINE_MAX_RATIO) + ')'
    '{this.parentNode.classList.add(\'sp-fail\');this.remove()}"'
)


# 책장 이미지로 저장 — 한국어 share 페이지와 /en/ 페이지가 함께 쓴다.
#
# 책장(책등)과 그 아래 표지 목록을 함께 PNG로 내려받는다. NEW 표시와 함께 추천한
# 셀럽 목록은 빼고, 인물 사진도 넣지 않는다 — 독서 리스트만 오려 공유하는 용도다.
#
# html2canvas는 처음 누를 때만 받아 온다. 이 페이지는 평소엔 자바스크립트가
# 거의 없는 정적 페이지라 미리 받아 둘 이유가 없다.
#
# 섹션을 통째로 넘기면 html2canvas가 숨겨 둔 쪽(display:none)까지 그려 버려서,
# 책등을 보고 있는데 목록이 찍히는 일이 있었다. 그래서 '지금 보이는 상자'
# 하나만 넘기고, 제목과 출처 한 줄은 그린 뒤에 캔버스에 직접 얹는다.
#
# 외부 이미지(예스24·알라딘)는 CORS 헤더가 없어 캔버스를 오염시킨다.
# 그리는 동안만 이미지 프록시 주소로 바꿔 두고 끝나면 되돌린다.
SHELF_CAPTURE_JS_TEMPLATE = (
    '  <script>\n'
    '  (function () {\n'
    '    var btns = [document.getElementById("shelf-cap"), document.getElementById("shelf-cap-clear")]\n'
    '      .filter(Boolean);\n'
    '    if (!btns.length) return;\n'
    '    var H2C = "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js";\n'
    '    var PROXY = "https://images.weserv.nl/?url=";\n'
    '    var PAPER = "#fcfaf5";\n'
    '    var FONT = \'-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif\';\n'
    '    // 캔버스 한계. 넘기면 빈 그림이 나오거나 아예 실패한다. 사파리는 한 변보다\n'
    '    // 넓이를 먼저 막는다(약 1677만 픽셀). 제목·여백을 얹을 몫을 빼고 잡는다.\n'
    '    var MAX_SIDE = 32767, MAX_AREA = 14000000;\n'
    '\n'
    '    /* 어느 한 걸음이라도 영영 안 끝나면 버튼이 "저장 중…"에 갇힌다.\n'
    '       모든 걸음에 시간 제한을 걸어 둔다. */\n'
    '    function guard(p, ms, tag) {\n'
    '      return new Promise(function (ok, no) {\n'
    '        var t = setTimeout(function () { no(new Error("시간 초과: " + tag)); }, ms);\n'
    '        Promise.resolve(p).then(\n'
    '          function (v) { clearTimeout(t); ok(v); },\n'
    '          function (e) { clearTimeout(t); no(e); });\n'
    '      });\n'
    '    }\n'
    '\n'
    '    function loadH2C() {\n'
    '      if (window.html2canvas) return Promise.resolve();\n'
    '      return new Promise(function (ok, no) {\n'
    '        var s = document.createElement("script");\n'
    '        s.src = H2C; s.onload = ok; s.onerror = no;\n'
    '        document.head.appendChild(s);\n'
    '      });\n'
    '    }\n'
    '    function proxied(u) {\n'
    '      if (!u || u.indexOf("data:") === 0) return u;\n'
    '      return PROXY + encodeURIComponent(u.replace(/^https?:\\/\\//i, "")) + "&output=jpg&q=92";\n'
    '    }\n'
    '    /* 프록시 주소로 바꾼 뒤 다 받아질 때까지 기다린다. 못 받은 것은 감춰서\n'
    '       색 책등으로 떨어뜨린다 — 반쯤 그려진 그림이 남는 것보다 낫다.\n'
    '       화면 밖 표지는 loading="lazy"라 주소만 바꿔서는 받아 오지 않는다.\n'
    '       목록 보기에서 표지 수십 장이 시간 초과로 통째로 사라지던 원인이다.\n'
    '       건드린 것은 끝나고 모두 원래대로 되돌린다. */\n'
    '    function swapImages(root) {\n'
    '      var undo = [];\n'
    '      var jobs = [].slice.call(root.querySelectorAll("img")).map(function (img) {\n'
    '        var src = img.getAttribute("src"), lazy = img.getAttribute("loading");\n'
    '        var par = img.parentNode, hid = false;\n'
    '        undo.push(function () {\n'
    '          img.onload = img.onerror = null;\n'
    '          if (lazy != null) img.setAttribute("loading", lazy);\n'
    '          img.style.display = "";\n'
    '          if (hid && par) par.classList.remove("sp-fail");\n'
    '          if (src != null) img.setAttribute("src", src);\n'
    '        });\n'
    '        return new Promise(function (done) {\n'
    '          // 프록시가 느리거나 막혀도 버튼이 영영 멈추지 않게 제한을 둔다\n'
    '          var t = setTimeout(function () { fin(true); }, 8000);\n'
    '          function fin(drop) {\n'
    '            clearTimeout(t);\n'
    '            if (drop) {\n'
    '              // 주소까지 떼어 둔다. 남겨 두면 복사본 쪽에서 또 기다린다.\n'
    '              img.removeAttribute("src");\n'
    '              img.style.display = "none";\n'
    '              if (par && par.classList && par.classList.contains("sp")\n'
    '                  && !par.classList.contains("sp-fail")) {\n'
    '                par.classList.add("sp-fail"); hid = true;\n'
    '              }\n'
    '            }\n'
    '            done();\n'
    '          }\n'
    '          img.onload = function () { fin(false); };\n'
    '          img.onerror = function () { fin(true); };\n'
    '          img.removeAttribute("loading");\n'
    '          img.crossOrigin = "anonymous";\n'
    '          img.src = proxied(src);\n'
    '        });\n'
    '      });\n'
    '      return { ready: Promise.all(jobs), undo: undo };\n'
    '    }\n'
    '\n'
    '    /* 아이폰에서 버튼이 "저장 중…"에 멈춰 있던 진짜 이유.\n'
    '\n'
    '       html2canvas는 찍을 상자만 보는 게 아니라 문서를 통째로 복사한 뒤,\n'
    '       사파리에서는 그 복사본 안의 <img>가 하나도 빠짐없이 다 받아지기를\n'
    '       기다린다(시간 제한 없음). 그런데 지금 안 보고 있는 쪽 — 책등을 보는\n'
    '       중이면 목록의 표지 수십 장 — 은 hidden 안에 있고 loading="lazy"라\n'
    '       사파리에서는 영영 받아지지 않는다. 그래서 그 기다림이 끝나지 않는다.\n'
    '\n'
    '       찍는 동안만 그런 그림의 주소를 떼어 둔다. 주소가 없는 <img>는\n'
    '       기다릴 것이 없다고 보고 바로 넘어간다. 아직 안 받아진 것만 건드리니\n'
    '       화면에서 사라지는 그림은 없다. */\n'
    '    function muteUnloaded(view) {\n'
    '      var off = [];\n'
    '      [].slice.call(document.images).forEach(function (img) {\n'
    '        if (view.contains(img) || img.complete) return;\n'
    '        off.push([img, img.getAttribute("src")]);\n'
    '        img.removeAttribute("src");\n'
    '      });\n'
    '      return off;\n'
    '    }\n'
    '    function unmute(off) {\n'
    '      off.forEach(function (p) {\n'
    '        if (p[0].parentNode && p[1] != null) p[0].setAttribute("src", p[1]);\n'
    '      });\n'
    '    }\n'
    '\n'
    '    /* 긴 목록은 두 배로 찍으면 사파리 캔버스 한계를 넘는다. 넘칠 만큼만 줄인다. */\n'
    '    function fitScale(w, h) {\n'
    '      var s = Math.min(2, MAX_SIDE / w, MAX_SIDE / h, Math.sqrt(MAX_AREA / (w * h)));\n'
    '      return Math.max(0.5, s);\n'
    '    }\n'
    '\n'
    '    /* 찍은 그림 둘레에 여백을 두고 제목과 출처를 얹는다 */\n'
    '    function compose(inner, clear) {\n'
    '      var pad = Math.round(inner.width * 0.035) + 16;\n'
    '      var fs = Math.max(26, Math.round(inner.width / 24));\n'
    '      var head = Math.round(fs * 2.2), foot = Math.round(fs * 1.9);\n'
    '      var c = document.createElement("canvas");\n'
    '      c.width = inner.width + pad * 2;\n'
    '      c.height = inner.height + head + foot;\n'
    '      var g = c.getContext("2d");\n'
    '      // 투명 배경으로 받을 때는 종이색을 깔지 않는다\n'
    '      if (!clear) { g.fillStyle = PAPER; g.fillRect(0, 0, c.width, c.height); }\n'
    '      g.fillStyle = "#111";\n'
    '      g.font = "800 " + fs + "px " + FONT;\n'
    '      g.textBaseline = "middle"; g.textAlign = "left";\n'
    '      g.fillText(__TITLE__, pad, head / 2);\n'
    '      g.drawImage(inner, pad, head);\n'
    '      g.fillStyle = "#8a8578";\n'
    '      g.font = "600 " + Math.round(fs * 0.62) + "px " + FONT;\n'
    '      g.textAlign = "right"; g.textBaseline = "bottom";\n'
    '      g.fillText("favorbook.co.kr", c.width - pad, c.height - Math.round(foot * 0.35));\n'
    '      return c;\n'
    '    }\n'
    '\n'
    '    /* 사파리는 큰 캔버스에서 toBlob이 null을 주기도 한다. 그때는 주소로 받는다. */\n'
    '    function toBlob(c) {\n'
    '      return new Promise(function (ok, no) {\n'
    '        if (!c.toBlob) { no(new Error("toBlob 없음")); return; }\n'
    '        c.toBlob(function (b) { b ? ok(b) : no(new Error("toBlob null")); }, "image/png");\n'
    '      }).catch(function () {\n'
    '        var d = c.toDataURL("image/png");\n'
    '        var bin = atob(d.slice(d.indexOf(",") + 1));\n'
    '        var buf = new Uint8Array(bin.length);\n'
    '        for (var i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);\n'
    '        return new Blob([buf], { type: "image/png" });\n'
    '      });\n'
    '    }\n'
    '\n'
    '    function download(blob, clear) {\n'
    '      var url = URL.createObjectURL(blob);\n'
    '      var a = document.createElement("a");\n'
    '      a.href = url; a.rel = "noopener";\n'
    '      a.download = clear ? __FILE__.replace(/\\.png$/, __CLEAR__ + ".png") : __FILE__;\n'
    '      document.body.appendChild(a);\n'
    '      a.click();\n'
    '      a.remove();\n'
    '      setTimeout(function () { URL.revokeObjectURL(url); }, 6000);\n'
    '    }\n'
    '\n'
    '    function capture(btn) {\n'
    '      var clear = btn.id === "shelf-cap-clear";\n'
    '      // 책장과 표지 목록을 함께 담은 상자 하나만 넘긴다\n'
    '      var view = document.getElementById("shelf-area") || document.getElementById("shelf");\n'
    '      if (!view) return;\n'
    '      var was = btn.textContent;\n'
    '      btns.forEach(function (b) { b.disabled = true; });\n'
    '      btn.textContent = __BUSY__;\n'
    '      var swap = null, muted = null;\n'
    '      // 저장하는 그림에는 NEW 표시와 함께 추천한 셀럽 목록을 넣지 않는다.\n'
    '      // html2canvas가 문서를 복사할 때 이 클래스도 따라가서 복사본에서만 빠진 채 그려진다.\n'
    '      view.classList.add("is-capturing");\n'
    '      guard(loadH2C(), 15000, "html2canvas").then(function () {\n'
    '        swap = swapImages(view);\n'
    '        return swap.ready;\n'
    '      }).then(function () {\n'
    '        muted = muteUnloaded(view);\n'
    '        // 책등은 상자 왼쪽에만 서 있어서 그대로 찍으면 오른쪽이 휑하다.\n'
    '        // 내용이 실제로 차지한 폭까지만 자른다.\n'
    '        var left = view.getBoundingClientRect().left, right = 0;\n'
    '        [].forEach.call(view.children, function (ch) {\n'
    '          var b = ch.getBoundingClientRect();\n'
    '          if (b.right > right) right = b.right;\n'
    '        });\n'
    '        var w = right > left ? Math.ceil(right - left) + 4 : view.offsetWidth;\n'
    '        w = Math.min(w, view.offsetWidth);\n'
    '        return guard(html2canvas(view, {\n'
    '          backgroundColor: clear ? null : PAPER, scale: fitScale(w, view.offsetHeight),\n'
    '          useCORS: true, logging: false, imageTimeout: 8000,\n'
    '          width: w, windowWidth: document.documentElement.clientWidth,\n'
    '        }), 40000, "그리기");\n'
    '      }).then(function (inner) {\n'
    '        // data: 주소는 길어지면 브라우저가 파일 이름을 무시한다. Blob으로 넘긴다.\n'
    '        return guard(toBlob(compose(inner, clear)), 25000, "내보내기");\n'
    '      }).then(function (blob) {\n'
    '        download(blob, clear);\n'
    '      }).catch(function (e) {\n'
    '        console.error(e);\n'
    '        alert(__FAIL__);\n'
    '      }).then(function () {\n'
    '        if (swap) swap.undo.forEach(function (f) { f(); });\n'
    '        if (muted) unmute(muted);\n'
    '        view.classList.remove("is-capturing");\n'
    '        btns.forEach(function (b) { b.disabled = false; });\n'
    '        btn.textContent = was;\n'
    '      });\n'
    '    }\n'
    '    btns.forEach(function (b) {\n'
    '      b.addEventListener("click", function () { capture(b); });\n'
    '    });\n'
    '  })();\n'
    '  </script>\n'
)


def shelf_capture_js(busy, filename, fail, headline, clear_suffix='_투명'):
    """언어별 문구만 갈아 끼운다. clear_suffix 는 투명 배경 파일 이름 끝에 붙는다."""
    j = lambda v: json.dumps(v, ensure_ascii=False)
    return (SHELF_CAPTURE_JS_TEMPLATE
            .replace('__CLEAR__', j(clear_suffix))
            .replace('__BUSY__', j(busy))
            .replace('__FILE__', j(filename))
            .replace('__FAIL__', j(fail))
            .replace('__TITLE__', j(headline)))


# 책장 CSS — 한국어 share 페이지와 /en/ 페이지가 함께 쓴다.
# 책장(책등)은 독서 리스트 맨 위에 늘 보이고, 그 아래로 표지 목록이 이어진다.
SHELF_CSS = (
    '    .shelf-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; flex-wrap: wrap; }\n'
    '    .shelf-head h2 { margin-bottom: 0; border-bottom: none; padding-bottom: 0; }\n'
    '    .shelf-tabs { display: flex; gap: 6px; flex-wrap: wrap; }\n'
    '    .sh-cap { font: inherit; font-size: 12px; font-weight: 700; cursor: pointer; padding: 5px 12px;\n'
    '              background: #fff; color: #000; border: 2px solid #000; box-shadow: 2px 2px 0 0 #000; }\n'
    '    .sh-cap:hover { background: #fde047; }\n'
    '    .sh-cap[disabled] { opacity: .55; cursor: default; }\n'
    # 책장 — 책등을 같은 높이로 세워 바닥에 붙여 늘어놓는다.
    # 줄이 넘어가도 줄마다 선반 판이 받치도록, 선반 판을 줄 간격(--row)마다
    # 되풀이되는 배경으로 그린다. 판은 책등 바로 아래(--sh-h)에 온다.
    '    .shelf { --sh-h: ' + str(SPINE_H) + 'px; --plank: 7px; --row: calc(var(--sh-h) + 18px);\n'
    '             display: flex; flex-wrap: wrap; align-items: flex-end; gap: 11px 2px;\n'
    '             margin: 14px 0 22px; padding: 0 8px 7px;\n'
    '             background-image: linear-gradient(to bottom, transparent var(--sh-h), #000 var(--sh-h),\n'
    '               #000 calc(var(--sh-h) + var(--plank)), transparent calc(var(--sh-h) + var(--plank)));\n'
    '             background-size: 100% var(--row); background-repeat: repeat-y; }\n'
    # 최근 추가된 책 칸 — 본 목록 위에 따로 모은다
    '    .new-sec { margin: 16px 0 6px; padding: 12px 12px 2px; background: #fffbe6; border: 2px dashed #000; }\n'
    '    .new-sec-h { display: flex; align-items: center; gap: 8px; margin: 0 0 10px; font-size: 15px; font-weight: 800; }\n'
    '    .new-sec .reading-list { margin: 0; }\n'
    '    .rl-num.rl-num-new { font-size: 11px; letter-spacing: .04em; }\n'
    '    .rl-new-tag { font-size: 9px; font-weight: 800; letter-spacing: .06em; line-height: 1; padding: 3px 5px;\n'
    '                  background: #fde047; color: #000; border: 1.5px solid #000; }\n'
    '    .sp { position: relative; flex: none; width: auto; height: var(--sh-h);\n'
    '          background: var(--c, #555); border: 1px solid rgba(0,0,0,.45); border-radius: 2px 2px 0 0;\n'
    '          box-shadow: inset -3px 0 6px rgba(0,0,0,.28), inset 3px 0 5px rgba(255,255,255,.14);\n'
    '          overflow: hidden; text-decoration: none; transition: transform .12s; }\n'
    '    .sp:hover { transform: translateY(-7px); z-index: 2; text-decoration: none; }\n'
    # 색 책등의 제목 — 세로쓰기 한 줄. 길면 말줄임한다.
    # 실제 책등 이미지가 오면 그 위에 덮여 안 보인다.
    # align-items를 stretch로 둬야 안쪽 i의 높이가 확정된다. flex-start면 높이가
    # 내용 기준이 되고, 거기에 max-height:100%를 걸면 엉뚱한 값으로 풀려서
    # 제목이 중간에 잘린다.
    '    .sp-t { position: absolute; inset: 0; display: flex; align-items: stretch;\n'
    '            justify-content: center; padding: 14px 2px; overflow: hidden; }\n'
    # 책등 제목은 바탕(세리프)으로 — 시스템 고딕은 책등에 얹으면 안내문처럼 보인다.
    # 굵기 500이라 kopubworld.css의 medium 한 벌만 받는다(364KB, swap).
    '    .sp-t i { writing-mode: vertical-rl; text-orientation: mixed; font-style: normal;\n'
    '              white-space: nowrap; overflow: hidden; text-overflow: ellipsis;\n'
    '              font-family: "KoPubWorld Batang", "Noto Serif KR", Batang, serif;\n'
    '              font-size: var(--fs, 15px); font-weight: 500; letter-spacing: .01em; color: #fff;\n'
    '              text-shadow: 0 1px 2px rgba(0,0,0,.55); }\n'
    '    .sp-i { position: relative; z-index: 1; display: block;\n'
    '            height: 100%; width: auto; max-width: 80px; object-fit: fill; }\n'
    # 책등 이미지가 없거나 못 불러오면 색 책등 폭으로 돌아간다
    '    .sp.no-img, .sp.sp-fail { width: var(--w, 38px); }\n'
    # 최근 추가된 책 — 책등 위쪽을 띠로 두른다. 제목이 가리지 않게 여백을 준다.
    '    .sp-new { position: absolute; top: 0; left: 0; right: 0; z-index: 3; text-align: center;\n'
    '              font-size: 8px; line-height: 1; padding: 3px 0 2px;\n'
    '              border-bottom: 1px solid rgba(0,0,0,.55); }\n'
    '    .sp.is-new .sp-t { padding-top: 22px; }\n'
    # 이미지로 저장하는 동안에는 NEW 표시와 함께 추천한 셀럽 목록을 뺀다
    '    .is-capturing .sp-new, .is-capturing .rl-new, .is-capturing .rl-shared { display: none !important; }\n'
    '    .is-capturing .sp.is-new .sp-t { padding-top: 14px; }\n'
    # 좁은 화면에서는 한 줄에 너무 적게 들어가므로 조금 줄인다
    # 좁은 화면에서는 책등을 낮추므로 글자도 그 비율(205/270)만큼 줄인다
    '    @media (max-width: 480px) { .shelf { --sh-h: 205px; }\n'
    '                                 .sp.no-img, .sp.sp-fail { width: calc(var(--w, 38px) * .88); }\n'
    '                                 .sp-i { max-width: 61px; }\n'
    '                                 .sp-t i { font-size: calc(var(--fs, 15px) * .76); }\n'
    '                                 .sp-t { padding: 10px 2px; }\n'
    '                                 .sp.is-new .sp-t { padding-top: 18px; }\n'
    '                                 .is-capturing .sp.is-new .sp-t { padding-top: 10px; } }\n'
)

def make_en_celeb_url(name_en):
    return BASE + 'en/share/' + safe_en_filename(name_en) + '.html'

def make_en_book_url(title_en):
    return BASE + 'en/share/book/' + safe_en_filename(title_en) + '.html'

# ── '링크 복사' 버튼 ─────────────────────────────────────────────────
#
# 페이지에 직접 들어온 사람도 짧은 주소를 바로 가져갈 수 있게 한다.
# 한글 주소는 주소창에서 복사하면 퍼센트 인코딩돼 60~200자가 된다.

COPY_BTN_CSS = (
    '    .copy-btn { cursor: pointer; font-family: inherit; }\n'
    '    .copy-btn.done { background: #86efac; }\n'
)


def copy_btn_html(url, label='🔗 링크 복사', done='복사했어요!'):
    return ('    <button class="lang-btn copy-btn" type="button"'
            ' data-url="' + esc(url) + '" data-done="' + esc(done) + '">'
            + esc(label) + '</button>\n')


COPY_BTN_JS = (
    '  <script>\n'
    '  document.querySelectorAll(".copy-btn").forEach(function (b) {\n'
    '    b.addEventListener("click", function () {\n'
    '      var u = b.dataset.url, was = b.textContent;\n'
    '      function done() {\n'
    '        b.textContent = b.dataset.done; b.classList.add("done");\n'
    '        setTimeout(function () { b.textContent = was; b.classList.remove("done"); }, 1600);\n'
    '      }\n'
    '      function fallback() {\n'
    '        var ta = document.createElement("textarea");\n'
    '        ta.value = u; ta.style.cssText = "position:fixed;top:-9999px;left:-9999px";\n'
    '        document.body.appendChild(ta); ta.focus(); ta.select();\n'
    '        try { document.execCommand("copy"); done(); } catch (e) { prompt(was, u); }\n'
    '        document.body.removeChild(ta);\n'
    '      }\n'
    '      if (navigator.clipboard && navigator.clipboard.writeText) {\n'
    '        navigator.clipboard.writeText(u).then(done, fallback);\n'
    '      } else { fallback(); }\n'
    '    });\n'
    '  });\n'
    '  </script>\n'
)

# ── 업데이트 내역 (git log of data.csv) ─────────────────────────────

def _parse_csv_pairs(text):
    """data.csv 본문 → (celeb, title) 페어 집합. 비어있으면 빈 set."""
    pairs = set()
    if not text or not text.strip():
        return pairs
    rdr = csv.reader(io.StringIO(text))
    try:
        hdr = next(rdr)
    except StopIteration:
        return pairs
    def find(kws):
        for i, h in enumerate(hdr):
            hl = h.lower()
            if any(k in hl for k in kws) and '_en' not in hl and '이미지' not in hl:
                return i
        return -1
    ci_name = find(['연예인', '이름', '인물'])
    ci_title = find(['도서명', '제목', '책'])
    if ci_name < 0:
        return pairs
    for row in rdr:
        if len(row) <= ci_name:
            continue
        name = (row[ci_name] or '').strip()
        title = (row[ci_title] or '').strip() if 0 <= ci_title < len(row) else ''
        if not name:
            continue
        pairs.add((name, title))
    return pairs

def _git_blob_csv(commit_ish):
    """`git show <commit>:data.csv` 본문. 실패시 ''."""
    try:
        r = subprocess.run(
            ['git', 'show', f'{commit_ish}:data.csv'],
            capture_output=True, check=False, timeout=10,
        )
        if r.returncode != 0:
            return ''
        return r.stdout.decode('utf-8', errors='replace')
    except Exception:
        return ''

def build_updates_entries(limit=80):
    """data.csv를 건드린 커밋들을 최신순으로 훑어, 새로 추가된 (celeb, title)을 정리.
    반환: 최신순 dict 리스트."""
    try:
        r = subprocess.run(
            ['git', 'log', '--no-merges', f'-n{limit}',
             '--pretty=format:%H|%at|%s', '--', 'data.csv'],
            capture_output=True, check=False, timeout=20,
        )
        out = r.stdout.decode('utf-8', errors='replace').strip()
    except Exception:
        out = ''
    if not out:
        return []
    entries = []
    for line in out.split('\n'):
        try:
            sha, ts, msg = line.split('|', 2)
        except ValueError:
            continue
        cur_pairs = _parse_csv_pairs(_git_blob_csv(sha))
        par = subprocess.run(
            ['git', 'rev-parse', f'{sha}^'],
            capture_output=True, check=False, timeout=5,
        )
        if par.returncode == 0:
            prev_pairs = _parse_csv_pairs(_git_blob_csv(par.stdout.decode().strip()))
        else:
            prev_pairs = set()
        added = cur_pairs - prev_pairs
        if not added:
            continue
        by_celeb = {}
        for name, title in added:
            by_celeb.setdefault(name, []).append(title or '')
        try:
            date = datetime.datetime.fromtimestamp(int(ts))
        except Exception:
            continue
        new_celebs = sorted(c for c in by_celeb if c not in {n for n, _ in prev_pairs})
        new_books = sum(1 for v in by_celeb.values() for t in v if t.strip())
        entries.append({
            'sha': sha,
            'date_iso': date.strftime('%Y-%m-%d'),
            'date_short': date.strftime('%y-%m-%d'),
            'message': msg,
            'celebs': by_celeb,
            'celeb_count': len(by_celeb),
            'new_celebs': new_celebs,
            'new_celeb_count': len(new_celebs),
            'book_count': new_books,
        })
    return entries

def headline_for(entry):
    """'26-08-01 #카리나, #안효섭 등 N명 도서 추가 📕'."""
    celebs = sorted(entry['celebs'].keys())
    shown = celebs[:2]
    more = max(0, len(celebs) - len(shown))
    tags = ', '.join('#' + c for c in shown)
    if more:
        return f"{entry['date_short']} {tags} 등 {more}명 도서 추가 📕"
    return f"{entry['date_short']} {tags} 도서 추가 📕"


def clean_none(obj):
    """JSON-LD에서 None 값 재귀적으로 제거."""
    if isinstance(obj, dict):
        return {k: clean_none(v) for k, v in obj.items() if v is not None}
    if isinstance(obj, list):
        return [clean_none(i) for i in obj]
    return obj

# ── 셀럽 한 줄 소개(bio) 로더 ────────────────────────────────────────
# data/bios.json: { "bios": { "셀럽이름": {"ko": "...", "en": "..."} } }
# CSV의 '코멘트' 칸이 비어있지 않으면 그게 우선 (수동 override)

def load_bios():
    path = 'data/bios.json'
    if not os.path.exists(path):
        return {}
    try:
        with open(path, encoding='utf-8') as f:
            d = json.load(f)
        return d.get('bios', {})
    except Exception as e:
        print(f"⚠️ bios.json 로드 실패: {e}")
        return {}

BIOS = load_bios()

# 괄호/소속 표기 제거한 짧은 이름 — 본문 반복 노출 시 사용
# "윤덕원(브로콜리너마저)" → "윤덕원", "RM(BTS)" → "RM"
_SHORT_NAME_RE = re.compile(r'\s*\([^)]*\)\s*$')
def short_name(name):
    return _SHORT_NAME_RE.sub('', name).strip() or name

def get_bio(name, lang='ko'):
    """bios.json에서 한 줄 소개 가져오기. 없으면 빈 문자열."""
    entry = BIOS.get(name) or {}
    return (entry.get(lang) or '').strip()

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
        'name_en':   find_exact('연예인_en'),
        'title_en':  find_exact('도서명_en'),
        'author_en': find_exact('저자_en'),
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

        name_en   = clean_en(get(C['name_en']))   if C['name_en']   is not None else None
        title_en  = clean_en(get(C['title_en']))  if C['title_en']  is not None else None
        title_en  = resolve_title_en(title, get(C['author']), title_en)
        author_en = clean_en(get(C['author_en'])) if C['author_en'] is not None else None

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
            'author_en': author_en,
        })

print(f"CSV 파싱 완료: {len(celebs)}명")
if EN_TITLE_SKIPPED:
    print(f"⚠️ 영문 제목 {len(EN_TITLE_SKIPPED)}건은 AI 답변 문구·후보 나열이 섞여 영문 페이지에서 뺐습니다"
          " (편집기 '🔤 영문 제목 검수'에서 고치세요):")
    for _t, _why in list(EN_TITLE_SKIPPED.items())[:15]:
        print(f"   · {_t}: {_why}")
    if len(EN_TITLE_SKIPPED) > 15:
        print(f"   · … 외 {len(EN_TITLE_SKIPPED) - 15}건")

# ── 1.5. 짧은 공유 링크 (/s/) ────────────────────────────────────────
#
# 한글 주소는 브라우저 밖에서 퍼센트 인코딩되어 60~200자가 된다.
# 메신저에 붙여넣기 곤란하지만, 검색에는 문제가 없고 옮기면 4개월 쌓은
# 색인을 다시 평가받아야 한다(GitHub Pages라 진짜 301도 못 쓴다).
# 그래서 색인된 주소는 그대로 두고, 사람이 주고받을 짧은 주소를 따로 만들어
# 원래 페이지로 넘긴다. rel=canonical로 검색 신호는 원래 주소에 모인다.

SHORTLINK_FILE = 'data/shortlinks.json'

# 국어의 로마자 표기법(초성/중성/종성) — 영문명이 없는 이름의 대비책.
# 자음동화 같은 예외는 반영하지 않는다. 늘 같은 결과만 나오면 된다.
RR_CHO = ('g', 'kk', 'n', 'd', 'tt', 'r', 'm', 'b', 'pp', 's', 'ss', '',
          'j', 'jj', 'ch', 'k', 't', 'p', 'h')
RR_JUNG = ('a', 'ae', 'ya', 'yae', 'eo', 'e', 'yeo', 'ye', 'o', 'wa', 'wae',
           'oe', 'yo', 'u', 'wo', 'we', 'wi', 'yu', 'eu', 'ui', 'i')
RR_JONG = ('', 'k', 'k', 'k', 'n', 'n', 'n', 't', 'l', 'l', 'l', 'l', 'l',
           'l', 'l', 'l', 'm', 'p', 'p', 't', 't', 'ng', 't', 't', 'k', 't',
           'p', 't')


def romanize_ko(text):
    """한글 → 로마자. 한글이 아닌 글자는 그대로 둔다."""
    # 괄호 속 소속명은 이름과 붙어 있다 — 띄워 둬야 슬러그에서 단어가 갈린다
    text = re.sub(r"[()\[\]{}·,/]+", ' ', text or '')
    out = []
    for ch in text:
        code = ord(ch) - 0xAC00
        if 0 <= code < 11172:
            out.append(RR_CHO[code // 588] + RR_JUNG[(code % 588) // 28]
                       + RR_JONG[code % 28])
        else:
            out.append(ch)
    return re.sub(r'lr', 'll', ''.join(out))      # ㄹㄹ은 ll로 (신라 같은 예외는 생략)


def short_slug(ko, en, taken, cap=36):
    """짧은 주소 한 칸. 영문명이 있으면 그걸 쓰고, 없으면 로마자로 만든다."""
    base = safe_en_filename(en) if en else ''
    if not base or base == 'untitled':
        base = safe_en_filename(romanize_ko(ko))
    if len(base) > cap:                       # 긴 영문 제목은 단어 경계에서 자른다
        cut = base[:cap].rsplit('-', 1)[0].strip('-')
        base = (cut if len(cut) >= 4 else base[:cap]).strip('-')
    base = base or 'x'
    slug, i = base, 1
    while slug in taken:                      # 같은 이름이 겹치면 뒤에 번호
        i += 1
        slug = base + '-' + str(i)
    return slug


def load_shortlinks():
    """한번 정한 짧은 주소는 바꾸지 않는다 — 이미 퍼진 링크가 죽으면 안 된다."""
    try:
        with io.open(SHORTLINK_FILE, encoding='utf-8') as f:
            d = json.load(f)
    except Exception:
        d = {}
    return {'celeb': dict(d.get('celeb') or {}),
            'book':  dict(d.get('book') or {})}


SHORTLINKS = load_shortlinks()


def assign_shorts(kind, items, cap=36):
    """items: [(원래 이름, 영문 이름 or None)] → 새로 생긴 것만 주소를 붙인다."""
    m = SHORTLINKS[kind]
    taken = set(m.values())
    for ko, en in items:
        if ko in m:
            continue
        m[ko] = short_slug(ko, en, taken, cap)
        taken.add(m[ko])
    return m


assign_shorts('celeb', sorted(
    (n, (info.get('name_en') or '')) for n, info in celebs.items()), cap=28)


def make_celeb_short_url(name):
    s = SHORTLINKS['celeb'].get(name)
    return (BASE + 's/' + s + '.html') if s else make_celeb_url(name)


def make_book_short_url(title):
    s = SHORTLINKS['book'].get(title)
    return (BASE + 's/b/' + s + '.html') if s else make_book_url(title)


# ── 2. data.json 생성 ────────────────────────────────────────────────

for _info in celebs.values():
    for _b in _info['books']:
        _sp = spine_image_url(_b['title'], _b['coverUrl'])
        if _sp:
            _b['spineUrl'] = _sp

# comment/source/link은 직접 검증하고 고른 핵심 자료라 data.json 한 방에
# 통째로 내려주지 않는다. 검색/추천/랭킹 등 화면 대부분에 필요한 나머지
# 필드(제목/저자/출판사/표지)만 담아 가볍게 배포하고, 위 세 필드는 셀럽별로
# 쪼개 data/detail/*.json에 따로 두어 실제로 그 사람 모달을 열 때만
# 그때그때 받아가게 한다. share/*.html(SEO용 정적 페이지)은 그대로 전체
# 내용을 담아 생성하므로 검색 노출에는 영향이 없다.
DETAIL_DIR = 'data/detail'
os.makedirs(DETAIL_DIR, exist_ok=True)

LITE_BOOK_KEYS = ('title', 'author', 'publisher', 'coverUrl', 'spineUrl', 'title_en', 'author_en')

_kept_detail_files = set()
for name, info in celebs.items():
    detail = {}
    for b in info['books']:
        d = {k: b[k] for k in ('comment', 'source', 'link') if b.get(k)}
        if d:
            detail[b['title']] = d
    # share/*.html과 동일하게, 디스크에는 원문 그대로 저장하고 URL만
    # encodeURIComponent로 인코딩해서 받는다(클라이언트 fetch 쪽과 대응).
    fname = safe_filename(name) + '.json'
    _kept_detail_files.add(fname)
    fpath = os.path.join(DETAIL_DIR, fname)
    if detail:
        payload = json.dumps(detail, ensure_ascii=False, separators=(',', ':'))
        if not os.path.exists(fpath) or open(fpath, encoding='utf-8').read() != payload:
            with open(fpath, 'w', encoding='utf-8') as f:
                f.write(payload)
    elif os.path.exists(fpath):
        os.remove(fpath)

# 삭제되거나 이름이 바뀐 셀럽의 남은 detail 파일 정리
for _fn in os.listdir(DETAIL_DIR):
    if _fn.endswith('.json') and _fn not in _kept_detail_files:
        os.remove(os.path.join(DETAIL_DIR, _fn))

data_json = {
    'generated': TODAY,
    'source': 'favorbook.co.kr',
    'notice': '본 데이터는 favorbook.co.kr 운영자가 직접 수집·선별·정리한 자료입니다. 전체 또는 상당 부분의 무단 복제·재배포를 금지하며, 인용 시 출처(favorbook.co.kr)를 표기해 주시기 바랍니다.',
    'celebs': {
        name: {
            'imageUrl': info['img'],
            'shortUrl': make_celeb_short_url(name),
            'books':    [{k: b.get(k, '') for k in LITE_BOOK_KEYS} for b in info['books']],
        }
        for name, info in celebs.items()
    }
}

with open('data.json', 'w', encoding='utf-8') as f:
    json.dump(data_json, f, ensure_ascii=False, separators=(',', ':'))
print(f"✅ data.json 생성: {os.path.getsize('data.json') // 1024}KB (comment/source/link는 data/detail/*.json으로 분리)")

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

# ── 3.5. 업데이트 내역 페이지 + 배너 ────────────────────────────────

update_entries = build_updates_entries(limit=80)

# ── 최근 추가된 책 NEW 배지 ─────────────────────────────────────────
#
# 어떤 책이 새로 들어왔는지 페이지에서 알 길이 없었다. data.csv 커밋 이력에서
# (셀럽, 책) 짝이 처음 나타난 날을 꺼내, 최근 것에만 작은 스티커를 붙인다.
# 며칠까지를 '최근'으로 볼지는 아래 숫자 하나로 정한다.
# 이 기간 안에 들어온 책은 독서 리스트 위쪽 NEW 칸에 따로 모은다.
NEW_BADGE_DAYS = 10

_new_book_dates = {}
for _e in update_entries:          # 최신순이라 먼저 본 날짜가 가장 최근
    for _c, _ts in _e['celebs'].items():
        for _t in _ts:
            _k = (_c, (_t or '').strip())
            if _k and _k[1] and _k not in _new_book_dates:
                _new_book_dates[_k] = _e['date_iso']


def new_book_date(celeb, title):
    """최근 NEW_BADGE_DAYS일 안에 추가된 책이면 추가된 날짜, 아니면 ''."""
    d = _new_book_dates.get((celeb, (title or '').strip()))
    if not d:
        return ''
    try:
        added = datetime.date.fromisoformat(d)
    except ValueError:
        return ''
    return d if (datetime.date.today() - added).days <= NEW_BADGE_DAYS else ''


def title_sort_key(title):
    """가나다 순 정렬 키. 공백·대소문자 차이는 무시한다."""
    return re.sub(r'\s+', '', title or '').lower()


def new_block(items, lang='ko'):
    """최근 NEW_BADGE_DAYS일 안에 추가된 책을 본 목록과 따로 모아 보여 주는 칸.
    items: [(추가된 날짜, 목록 카드 html)]. 최신순으로 늘어놓는다.
    본 목록(가나다 순)에도 같은 책이 그대로 있다."""
    if not items:
        return ''
    items = sorted(items, key=lambda x: x[0], reverse=True)
    n = len(items)
    if lang == 'en':
        head = ('New in the last ' + str(NEW_BADGE_DAYS) + ' days (' + str(n)
                + (' book' if n == 1 else ' books') + ')')
    else:
        head = '최근 ' + str(NEW_BADGE_DAYS) + '일 새로 추가된 책 (' + str(n) + '권)'
    return ('    <div class="new-sec">\n'
            '      <h3 class="new-sec-h"><span class="rl-new-tag">NEW</span> ' + esc(head) + '</h3>\n'
            '      <ol class="reading-list">\n'
            + ''.join(card for _, card in items) +
            '      </ol>\n'
            '    </div>\n')


def new_card(card, num):
    """본 목록 카드를 NEW 칸용으로 — 번호 자리에 NEW를 단다."""
    return card.replace('<span class="rl-num">' + str(num) + '</span>',
                        '<span class="rl-num rl-num-new">NEW</span>', 1)


def spine_new_badge(added):
    """책등 위쪽에 걸치는 띠."""
    return ('<span class="sp-new" data-added="' + added + '">NEW</span>') if added else ''


def cover_new_badge(added):
    """표지 왼쪽 위 모서리 스티커."""
    return ('<span class="rl-new" data-added="' + added + '">NEW</span>') if added else ''


# 배지는 빌드 시점 기준이라 다음 빌드까지 남는다. 날짜를 달고 보내서
# 기한이 지난 배지는 페이지를 열 때 스스로 사라지게 한다.
NEW_BADGE_JS = (
    '<script>\n'
    '(function () {\n'
    '  var DAYS = ' + str(NEW_BADGE_DAYS) + ';\n'
    # 빌드 때와 같은 기준으로 세야 한다 — 시각이 아니라 날짜 단위로 뺀다.
    # 시각으로 재면 '7일 전 새벽에 추가'가 7.9일이 되어 하루 일찍 사라진다.
    '  var today = new Date(); today.setHours(0, 0, 0, 0);\n'
    '  document.querySelectorAll(".sp-new[data-added], .rl-new[data-added]").forEach(function (el) {\n'
    '    var t = Date.parse(el.getAttribute("data-added") + "T00:00:00");\n'
    '    if (isNaN(t)) return;\n'
    '    if (Math.round((today - t) / 86400000) <= DAYS) return;\n'
    '    var p = el.parentNode;\n'
    '    el.remove();\n'
    '    if (p && p.classList) p.classList.remove("is-new");\n'
    '  });\n'
    '})();\n'
    '</script>\n'
)

# 표지(목록 보기) 스티커 — 한국어·영문 페이지가 함께 쓴다
NEW_BADGE_CSS = (
    '    .rl-cover { position: relative; }\n'
    '    .rl-new, .sp-new { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;\n'
    '             font-weight: 800; letter-spacing: .06em; background: #fde047; color: #000;\n'
    '             pointer-events: none; }\n'
    '    .rl-new { position: absolute; top: 0; left: 0; z-index: 2; font-size: 9px; line-height: 1;\n'
    '             padding: 3px 5px; border-right: 1.5px solid #000; border-bottom: 1.5px solid #000; }\n'
)


def _write_updates_page(entries):
    """updates.html 생성."""
    if entries:
        items_html = []
        MAX_TAGS = 30
        for e in entries:
            celeb_names = sorted(e['celebs'].keys())
            shown_names = celeb_names[:MAX_TAGS]
            extra = len(celeb_names) - len(shown_names)
            tag_chips = [
                '<a href="share/' + quote(safe_filename(c), safe='') + '.html" '
                'class="inline-block px-2 py-0.5 mr-1 mb-1 border-2 border-ink bg-white '
                'hover:bg-neo-yellow shadow-neo-sm text-xs font-bold font-sans text-ink '
                'no-underline transition-all hover:-translate-y-0.5">#' + esc(c) + '</a>'
                for c in shown_names
            ]
            if extra > 0:
                tag_chips.append(
                    '<span class="inline-block px-2 py-0.5 mr-1 mb-1 text-xs font-bold '
                    'font-sans text-muted">외 ' + str(extra) + '명 더…</span>'
                )
            tags = '\n      '.join(tag_chips)
            new_label = (' · <span class="text-neo-pink-700">새 셀럽 '
                         + str(e['new_celeb_count']) + '명</span>'
                         if e['new_celeb_count'] else '')
            items_html.append(
                '  <li class="border-2 border-ink bg-white shadow-neo p-4 sm:p-5">\n'
                '    <div class="flex flex-wrap items-baseline justify-between gap-2 mb-3">\n'
                '      <time datetime="' + e['date_iso'] + '" '
                'class="font-sans font-bold text-sm sm:text-base tracking-widest">'
                + e['date_short'] + '</time>\n'
                '      <span class="font-sans text-xs sm:text-sm text-muted">총 '
                + str(e['celeb_count']) + '명 · '
                + str(e['book_count']) + '권 추가 📕' + new_label + '</span>\n'
                '    </div>\n'
                '    <div>\n      ' + tags + '\n    </div>\n'
                '  </li>'
            )
        list_html = '\n'.join(items_html)
    else:
        list_html = ('  <li class="border-2 border-ink bg-white shadow-neo p-6 '
                     'text-center font-sans font-bold text-muted">'
                     '아직 업데이트 내역이 없습니다.</li>')

    page = (
        '<!DOCTYPE html>\n'
        '<html lang="ko">\n'
        '<head>\n' + GA_TAG +
        '  <meta charset="utf-8">\n'
        '  <meta name="viewport" content="width=device-width, initial-scale=1">\n'
        '  <title>업데이트 내역 | 최애의 독서</title>\n'
        '  <meta name="description" content="최애의 독서 데이터 업데이트 로그 — '
        '새로 추가된 연예인과 추천 도서 내역.">\n'
        '  <meta name="robots" content="index, follow">\n'
        '  <link rel="canonical" href="' + BASE + 'updates.html">\n'
        '  <link rel="icon" href="' + BASE + 'favicon.svg" type="image/svg+xml">\n'
        '  <script src="https://cdn.tailwindcss.com"></script>\n'
        '  <link rel="stylesheet" href="' + BASE + 'assets/fonts/space-grotesk.css">\n'
        '  <link rel="stylesheet" href="' + BASE + 'assets/fonts/kopubworld.css">\n'
        '  <script>\n'
        '    tailwind.config = { theme: { extend: {\n'
        '      fontFamily: { serif: [\'"KoPubWorld Batang"\', \'serif\'], '
        'sans: [\'"Space Grotesk"\', \'"KoPubWorld Dotum"\', \'sans-serif\'] },\n'
        '      colors: { ink: "#000000", muted: "#666666", '
        '"neo-yellow": "#fde047", "neo-pink": "#fbcfe8" },\n'
        '      boxShadow: { neo: "4px 4px 0px 0px rgba(0,0,0,1)", '
        '"neo-sm": "2px 2px 0px 0px rgba(0,0,0,1)" }\n'
        '    } } };\n'
        '  </script>\n'
        '  <style>body{background:#fcfaf5;color:#000;-webkit-font-smoothing:antialiased;}</style>\n'
        '</head>\n'
        '<body class="font-serif">\n'
        '  <main class="max-w-3xl mx-auto px-4 sm:px-6 py-10 sm:py-16">\n'
        '    <header class="mb-10 text-center">\n'
        '      <a href="./" class="inline-block font-sans font-bold text-xs tracking-widest '
        'uppercase border-2 border-ink bg-white hover:bg-neo-yellow shadow-neo-sm px-4 py-2 '
        'no-underline text-ink transition-all hover:-translate-y-0.5 mb-6">← 메인으로</a>\n'
        '      <h1 class="text-3xl sm:text-5xl font-black tracking-tight mb-3">'
        '업데이트 내역 📕</h1>\n'
        '      <p class="font-sans font-bold text-sm text-muted">'
        '최애의 독서 데이터(<code class="bg-neo-yellow px-1">data.csv</code>) 변경 로그</p>\n'
        '    </header>\n'
        '    <ul class="flex flex-col gap-4">\n'
        + list_html + '\n'
        '    </ul>\n'
        '    <footer class="mt-12 text-center font-sans text-xs text-muted">'
        '최근 ' + str(len(entries)) + '개 커밋 기준</footer>\n'
        '  </main>\n'
        '</body>\n'
        '</html>\n'
    )
    write_if_changed('updates.html', page)

_write_updates_page(update_entries)

# index.html 배너 주입
def _inject_updates_banner(html_text, entries):
    if not entries:
        return html_text
    headline = headline_for(entries[0])
    banner = (
        '<!-- updates-banner:start -->\n'
        '  <a href="updates.html" aria-label="업데이트 내역"\n'
        '     class="max-w-xl mx-auto w-full flex items-center justify-between gap-3 '
        'border-2 border-ink bg-neo-yellow shadow-neo-sm hover:shadow-neo '
        'hover:-translate-y-0.5 transition-all px-4 py-3 font-sans font-bold '
        'text-ink no-underline">\n'
        '    <span class="text-[10px] sm:text-xs tracking-widest uppercase whitespace-nowrap">'
        '📕 NEW</span>\n'
        '    <span class="flex-1 text-xs sm:text-sm truncate">' + esc(headline) + '</span>\n'
        '    <span class="text-xs sm:text-sm">→</span>\n'
        '  </a>\n'
        '  <!-- updates-banner:end -->'
    )
    if '<!-- updates-banner:start -->' in html_text:
        return re.sub(
            r'<!-- updates-banner:start -->.*?<!-- updates-banner:end -->',
            lambda _m: banner,
            html_text, flags=re.DOTALL,
        )
    return html_text.replace(
        '<section id="search"',
        banner + '\n\n  <section id="search"',
        1,
    )

# ── 3.6. 메인 고정 "요즘 핫한 사람" 한 줄 ──────────────────────────
# data/featured.json 에 적어둔 인물을 메인 상단에 고정 노출한다.
# 실제 카드(사진 포함)는 index.html의 JS가 그리지만, 크롤러가 JS 없이도
# 링크를 볼 수 있도록 여기서 정적 마크업을 함께 넣어둔다.

FEATURED_PATH = os.path.join('data', 'featured.json')


def load_featured(known_names):
    """featured.json을 읽어 (title, subtitle, picks) 반환. 없으면 picks=[]"""
    if not os.path.exists(FEATURED_PATH):
        return '', '', []
    try:
        with open(FEATURED_PATH, encoding='utf-8') as fp:
            raw = json.load(fp)
    except (json.JSONDecodeError, OSError) as e:
        print(f"⚠️ {FEATURED_PATH} 읽기 실패 — 고정 섹션을 건너뜁니다: {e}")
        return '', '', []

    picks = []
    for item in (raw.get('picks') or []):
        if isinstance(item, str):
            item = {'name': item}
        if not isinstance(item, dict):
            continue
        name = (item.get('name') or '').strip()
        if not name:
            continue
        if name not in known_names:
            print(f"⚠️ 고정 목록의 '{name}' 은(는) 데이터에 없는 이름이라 건너뜁니다")
            continue
        if any(p['name'] == name for p in picks):
            print(f"⚠️ 고정 목록에 '{name}' 이(가) 중복되어 한 번만 노출합니다")
            continue
        picks.append({
            'name':  name,
            'badge': (item.get('badge') or '').strip(),
            'note':  (item.get('note') or '').strip(),
        })

    return (raw.get('title') or '').strip(), (raw.get('subtitle') or '').strip(), picks[:12]


def _inject_featured(html_text, title, subtitle, picks):
    if picks:
        cards = []
        for p in picks:
            n = p['name']
            href = 'share/' + quote(safe_filename(n), safe='') + '.html'
            badge = (' <span class="font-sans font-bold text-[9px] tracking-widest uppercase '
                     'border border-ink bg-neo-pink px-1 py-0.5">'
                     + esc(p['badge']) + '</span>') if p['badge'] else ''
            cards.append(
                '      <a href="' + href + '" class="flex flex-col justify-center border-2 border-ink '
                'bg-white shadow-neo px-3 py-4 text-center no-underline text-ink">\n'
                '        <span class="font-black text-sm">' + esc(n) + '</span>' + badge + '\n'
                '        <span class="text-[10px] text-muted mt-1">'
                + str(len(celebs[n]['books'])) + ' records</span>\n'
                '      </a>'
            )
        inner = '\n'.join(cards)
    else:
        inner = ''

    # 섹션 / 스크롤 탭 노출 여부
    sec_cls = 'w-full' if picks else 'w-full hidden'
    html_text = re.sub(
        r'<section id="featured" class="[^"]*">',
        '<section id="featured" class="' + sec_cls + '">',
        html_text,
        count=1,
    )
    tab_cls = 'spy-tab spy-tab-featured' if picks else 'spy-tab spy-tab-featured hidden'
    html_text = re.sub(
        r'(<a href="#featured" data-spy="featured" class=")[^"]*(">)',
        lambda m: m.group(1) + tab_cls + m.group(2),
        html_text,
    )

    if title:
        html_text = re.sub(
            r'(<h2 id="featured-title"[^>]*>).*?(</h2>)',
            lambda m: m.group(1) + esc(title) + m.group(2),
            html_text,
            count=1,
            flags=re.DOTALL,
        )
    html_text = re.sub(
        r'(<p id="featured-subtitle"[^>]*>).*?(</p>)',
        lambda m: m.group(1) + esc(subtitle) + m.group(2),
        html_text,
        count=1,
        flags=re.DOTALL,
    )
    return re.sub(
        r'(<div id="featured-container"[^>]*>).*?(</div>)',
        lambda m: m.group(1) + ('\n' + inner + '\n    ' if inner else '') + m.group(2),
        html_text,
        count=1,
        flags=re.DOTALL,
    )


featured_title, featured_subtitle, featured_picks = load_featured(celebs)
idx_html = _inject_featured(idx_html, featured_title, featured_subtitle, featured_picks)

idx_html = _inject_updates_banner(idx_html, update_entries)

write_if_changed('index.html', idx_html)
if featured_picks:
    print("✅ 메인 고정 인물 " + str(len(featured_picks)) + "명: "
          + ', '.join(p['name'] for p in featured_picks))
else:
    print("ℹ️ 메인 고정 인물 없음 (data/featured.json) — 섹션 숨김")
print(f"✅ index.html 정적 목록 갱신: {len(sorted_names)}명")
print(f"✅ updates.html 생성 ({len(update_entries)} 항목)")

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
# 책 제목 → 영문 작가 매핑
book_author_en = {}
for _name, _info in celebs.items():
    for _b in _info['books']:
        _t = _b['title'].strip()
        if _b.get('title_en') and _t not in book_title_en:
            book_title_en[_t] = _b['title_en']
        if _b.get('author_en') and _t not in book_author_en:
            book_author_en[_t] = _b['author_en']

# 짧은 공유 주소는 페이지 안의 '링크 복사' 버튼에서도 쓰므로 여기서 미리 배정한다
assign_shorts('book', sorted(
    (t, book_title_en.get(t) or '') for t in books_with_pages), cap=36)

# sitemap 이미지 정보 수집용
sitemap_images = {}  # { url: [image_url, ...] }

# 가나다 순 정렬된 셀럽 이름 (이전/다음 페이지네이션용)
sorted_celeb_names = sorted(celebs.keys())
celeb_index = {n: i for i, n in enumerate(sorted_celeb_names)}

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
    # description: "RM(BTS) 독서 기록 한눈에! RM(BTS)의 인생책과 추천 도서 9권 공개 — 공감의 배신, 데미안 등 RM(BTS) 책 추천·독서 리스트 전체."
    top3 = ', '.join(esc(b['title']) for b in books[:3])
    desc_text = (
        esc(name) + ' 독서 기록 한눈에! '
        + esc(name) + '의 인생책과 추천 도서 ' + str(n_books) + '권 공개 — '
        + top3 + (' 등 ' if n_books > 3 else ' ')
        + esc(name) + ' 책 추천·독서 리스트 전체.'
    )

    # 검색 키워드 변형: 셀럽별 정확 매칭 + 일반 검색어
    # 한국어 띄어쓰기 토크나이저 대응을 위해 띄어쓰기 / 붙여쓰기 양쪽 포함
    keyword_variants = ', '.join([
        # 셀럽별 — 띄어쓰기
        esc(name) + ' 읽은 책',
        esc(name) + ' 추천 책',
        esc(name) + ' 추천 도서',
        esc(name) + ' 인생책',
        esc(name) + ' 책',
        esc(name) + ' 책 추천',
        esc(name) + ' 도서',
        esc(name) + ' 독서',
        esc(name) + ' 독서 기록',
        esc(name) + ' 독서 리스트',
        esc(name) + ' 독서 취향',
        esc(name) + ' 책 리스트',
        # 셀럽별 — 붙여쓰기 변형
        esc(name) + ' 읽은책',
        esc(name) + ' 추천책',
        esc(name) + ' 추천도서',
        esc(name) + ' 책추천',
        esc(name) + ' 독서기록',
        esc(name) + ' 독서리스트',
        # 일반 검색어 — 띄어쓰기
        '연예인 읽은 책', '아이돌 읽은 책', '셀럽 읽은 책',
        '연예인 추천 책', '아이돌 추천 도서', '연예인 추천 도서',
        '연예인 인생책', '아이돌 인생책', '셀럽 인생책',
        '연예인 독서', '아이돌 독서', '셀럽 독서',
        '책 추천', '인생책', '추천 도서', '최애의 독서',
        # 일반 검색어 — 붙여쓰기 변형
        '연예인 읽은책', '아이돌 추천책', '연예인 추천도서',
        '셀럽독서', '아이돌독서', '연예인독서',
        '책추천', '추천책', '추천도서', '독서기록', '독서리스트', '최애의독서',
    ])

    page_title = esc(name) + ' 독서 기록 · 읽은 책·추천 책 ' + str(n_books) + '권 | 최애의 독서'
    h1_text    = esc(name) + ' 독서 기록 · 읽은 책 · 추천 책'

    json_ld = {
        '@context': 'https://schema.org',
        '@type': 'ProfilePage',
        'name': page_title,
        'url': page_url,
        'description': name + '의 인생책과 추천 도서 ' + str(n_books) + '권',
        'mainEntity': {
            '@type': 'Person',
            'name': name,
            'image': img,
            'description': name + '의 인생책과 추천 도서 ' + str(n_books) + '권 전체 목록',
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

    # 책 테이블 행 (표지·도서명은 알라딘 외부 링크, 출처는 별도 외부링크)
    book_cards_html = ''   # 카드 그리드 (표 대체)
    spine_html = ''        # 책등 보기
    shared_count = 0       # 다른 셀럽과 공유된 책 권수 (섹션 헤더용)
    # 책장·목록은 가나다 순. 최근 추가된 책은 위쪽 NEW 칸에 따로 모은다.
    list_books = sorted(books, key=lambda x: title_sort_key(x['title']))
    new_items = []
    for i, b in enumerate(list_books):
        has_book_page = b['title'] in books_with_pages

        # 알라딘 상품 URL (CSV의 '&amp;'는 디코드 후 esc로 재이스케이프)
        # 일부 행은 '도서 정보' 칸에 이미지 URL이 들어있으니 그런 경우는 링크로 쓰지 않음
        aladin_url = ''
        raw_link = b.get('link') or ''
        if raw_link.startswith('http') and not raw_link.lower().rstrip().endswith(
            ('.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp')
        ):
            aladin_url = esc(html.unescape(raw_link))

        # 최근에 들어온 책이면 표지·책등에 붙일 날짜
        _added = new_book_date(name, b['title'])

        # 표지
        if b['coverUrl'] and b['coverUrl'].startswith('http'):
            cover_inner = ('<img src="' + esc(b['coverUrl']) + '" alt="' + esc(b['title'])
                           + ' 표지" loading="lazy">')
        else:
            cover_inner = '<div class="rl-no-cover">📕</div>'
        _cover_badge = cover_new_badge(_added)
        if aladin_url:
            cover_html = ('<a class="rl-cover" href="' + aladin_url
                          + '" rel="nofollow noopener noreferrer" target="_blank" '
                          'aria-label="' + esc(b['title']) + ' 알라딘에서 보기">'
                          + _cover_badge + cover_inner + '</a>')
        else:
            cover_html = '<div class="rl-cover">' + _cover_badge + cover_inner + '</div>'

        # 제목
        if aladin_url:
            title_html = ('<a href="' + aladin_url
                          + '" rel="nofollow noopener noreferrer" target="_blank">'
                          + esc(b['title']) + '</a>')
        else:
            title_html = esc(b['title'])

        # 저자 · 출판사
        byline_parts = []
        if b['author']:    byline_parts.append(esc(b['author']))
        if b['publisher']: byline_parts.append(esc(b['publisher']))
        byline_html = ' · '.join(byline_parts)

        # 출처
        source_html = ''
        if b['source'] and b['source'].startswith('http'):
            source_html = ('<a class="rl-source" href="' + esc(b['source'])
                           + '" rel="nofollow noopener noreferrer" target="_blank">📺 출처 보기</a>')

        # 함께 추천한 다른 셀럽 (카드 안에 임베드)
        shared_html = ''
        if has_book_page:
            shared_count += 1
            other_celebs = [c for c in book_celebs[b['title']]['celebs'] if c != name]
            if other_celebs:
                chips = ''.join(
                    '<a class="rl-celeb-chip" href="' + esc(
                        BASE + 'share/' + quote(safe_filename(_oc), safe='') + '.html'
                    ) + '">' + esc(_oc) + '</a>'
                    for _oc in other_celebs
                )
                shared_html = (
                    '\n      <div class="rl-shared">'
                    '<span class="rl-shared-label">👥 함께 추천한 셀럽 '
                    + str(len(other_celebs)) + '명:</span> '
                    + chips +
                    '</div>'
                )

        # 책등 한 칸 — 예스24 책등이 있으면 그 이미지를, 없으면 색 책등을 쓴다.
        # 이미지를 색 책등 위에 덮어두고 못 불러오면 스스로 사라지게 해서,
        # 자바스크립트 없이도 자연스럽게 색 책등으로 떨어진다.
        _spine_url = spine_image_url(b['title'], b['coverUrl'])
        _spine_inner = (
            '<span class="sp-t"><i>' + esc(spine_title(b['title'])) + '</i></span>'
            + ('<img class="sp-i" src="' + esc(_spine_url) + '" alt="" loading="lazy" '
               'referrerpolicy="no-referrer"' + SPINE_IMG_GUARD + '>'
               if _spine_url else '')
            + spine_new_badge(_added)
        )
        _spine_style = ('--c:' + spine_tint(b['title'])
                        + ';--w:' + str(spine_width(b['title'])) + 'px'
                        + ';--fs:' + str(spine_font_size(spine_title(b['title']))) + 'px')
        _sp_cls = ('sp' if _spine_url else 'sp no-img') + (' is-new' if _added else '')
        if aladin_url:
            spine_html += ('    <a class="' + _sp_cls + '" style="' + _spine_style + '" href="' + aladin_url
                           + '" rel="nofollow noopener noreferrer" target="_blank" title="'
                           + esc(b['title']) + '">' + _spine_inner + '</a>\n')
        else:
            spine_html += ('    <span class="' + _sp_cls + '" style="' + _spine_style + '" title="'
                           + esc(b['title']) + '">' + _spine_inner + '</span>\n')

        _card = (
            '    <li class="rl-item">\n'
            '      <span class="rl-num">' + str(i+1) + '</span>\n'
            '      ' + cover_html + '\n'
            '      <div class="rl-meta">\n'
            '        <div class="rl-title">' + title_html + '</div>\n'
            + (('        <div class="rl-byline">' + byline_html + '</div>\n') if byline_html else '')
            + (('        ' + source_html + '\n') if source_html else '')
            + '      </div>'
            + shared_html
            + '\n    </li>\n'
        )
        book_cards_html += _card
        if _added:
            new_items.append((_added, new_card(_card, i + 1)))

    sname = short_name(name)  # 본문 반복용 짧은 이름

    # 인트로 단락: 풀네임은 1번만, 나머지는 생략
    intro_p = (
        esc(name) + '의 독서 기록을 한곳에 모았어요. '
        '유튜브·인터뷰·SNS 등 공개 출처에서 확인된 인생책·추천 도서 '
        '<strong>' + str(n_books) + '권</strong>을 한 페이지에 정리한 독서 리스트입니다. '
        '아래 목록에서 책 제목·저자·출처 링크를 한눈에 확인할 수 있어요.'
    )

    # 작가 빈도 요약 (간단한 unique 콘텐츠)
    author_counts = {}
    for b in books:
        a = b['author'].strip()
        if a:
            author_counts[a] = author_counts.get(a, 0) + 1
    top_authors = sorted(author_counts.items(), key=lambda x: x[1], reverse=True)[:3]
    if top_authors:
        author_summary = (
            '추천 도서에 가장 자주 등장한 작가는 '
            + ', '.join(esc(a) + (' (' + str(c) + '권)' if c > 1 else '') for a, c in top_authors)
            + ' 등이에요.'
        )
    else:
        author_summary = ''

    # 같은 책을 추천한 다른 셀럽 (자동 cross-link)
    related_celebs = {}  # other_name → [shared_book_titles]
    for b in books:
        t = b['title']
        for other in book_celebs.get(t, {}).get('celebs', []):
            if other == name:
                continue
            related_celebs.setdefault(other, []).append(t)
    # 공통 도서 수 내림차순, 동률이면 가나다순 — 최대 12명
    related_sorted = sorted(
        related_celebs.items(),
        key=lambda x: (-len(x[1]), x[0])
    )[:12]

    related_section = ''
    if related_sorted:
        chips = ''
        for other_name, shared_titles in related_sorted:
            other_url = BASE + 'share/' + quote(safe_filename(other_name), safe='') + '.html'
            shared_label = shared_titles[0] if len(shared_titles) == 1 \
                else f'{shared_titles[0]} 외 {len(shared_titles)-1}권'
            chips += (
                '      <a class="related-celeb" href="' + esc(other_url) + '" '
                'title="공통 도서: ' + esc(shared_label) + '">'
                + esc(other_name)
                + ' <span class="rc-count">' + str(len(shared_titles)) + '</span>'
                '</a>\n'
            )
        related_section = (
            '  <section class="related-celebs">\n'
            '    <h2>🤝 책 취향이 겹치는 셀럽</h2>\n'
            '    <p class="muted">같은 책을 함께 추천한 다른 셀럽이에요. 숫자는 공통 도서 권수.</p>\n'
            '    <div class="related-celeb-list">\n'
            + chips +
            '    </div>\n'
            '  </section>\n'
            '\n'
        )

    # 이전/다음 셀럽 페이지네이션 (가나다순)
    idx = celeb_index[name]
    prev_name = sorted_celeb_names[idx - 1] if idx > 0 else None
    next_name = sorted_celeb_names[idx + 1] if idx < len(sorted_celeb_names) - 1 else None
    pager_links = []
    if prev_name:
        prev_url = BASE + 'share/' + quote(safe_filename(prev_name), safe='') + '.html'
        pager_links.append(
            '      <a class="pager-link pager-prev" href="' + esc(prev_url) + '" rel="prev">'
            '<span class="pager-arrow">←</span> '
            '<span class="pager-label">' + esc(prev_name) + '의 독서 기록</span></a>'
        )
    if next_name:
        next_url = BASE + 'share/' + quote(safe_filename(next_name), safe='') + '.html'
        pager_links.append(
            '      <a class="pager-link pager-next" href="' + esc(next_url) + '" rel="next">'
            '<span class="pager-label">' + esc(next_name) + '의 독서 기록</span> '
            '<span class="pager-arrow">→</span></a>'
        )
    pager_section = ''
    if pager_links:
        pager_section = (
            '  <nav class="celeb-pager" aria-label="셀럽 페이지 이동">\n'
            + '\n'.join(pager_links) + '\n'
            '  </nav>\n'
            '\n'
        )

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
        '<head>\n' + GA_TAG +
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
        + image_preconnect(book_cards_html, spine_html, img) +
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
        # 책등 제목에 쓰는 바탕체. font-display:swap이라 글자는 바로 보이고
        # 실제로 쓰는 굵기 한 벌만 받는다.
        '  <link rel="stylesheet" href="' + BASE + 'assets/fonts/kopubworld.css">\n'
        '  <style>\n'
        '    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; max-width: 860px; margin: 0 auto; padding: 20px; color: #222; line-height: 1.6; background: #fcfaf5; }\n'
        '    .lang-toggle { position: absolute; top: 16px; right: 16px; display: flex; gap: 6px; }\n'
        + COPY_BTN_CSS +
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
        '    .muted { color: #666; font-size: 13px; margin: 4px 0 12px; }\n'
        '    .book-cards { list-style: none; padding: 0; margin: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 10px; }\n'
        '    .book-card-link { display: flex; gap: 10px; padding: 8px; background: #fff; border: 2px solid #000; box-shadow: 2px 2px 0 0 #000; text-decoration: none; color: #000; transition: transform .1s, box-shadow .1s; }\n'
        '    .book-card-link:hover { transform: translate(-1px,-1px); box-shadow: 4px 4px 0 0 #000; background: #fde047; text-decoration: none; }\n'
        '    .no-cover { width: 80px; height: 115px; background: #f4f4f0; border: 1px solid #ccc; display: flex; align-items: center; justify-content: center; font-size: 32px; flex-shrink: 0; }\n'
        '    .bc-meta { min-width: 0; flex: 1; }\n'
        '    .bc-title { font-weight: 700; font-size: 13px; line-height: 1.3; margin-bottom: 4px; }\n'
        '    .bc-author { font-size: 12px; color: #555; margin-bottom: 6px; }\n'
        '    .bc-badge { display: inline-block; font-size: 11px; background: #fde047; border: 1px solid #000; padding: 1px 6px; font-weight: 700; }\n'
        '    .celeb-bio { margin: 4px 0 8px; padding: 6px 10px; background: #fff8e7; border-left: 4px solid #000; font-size: 14px; line-height: 1.45; color: #222; }\n'
        + SHELF_CSS +
        '    .reading-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 14px; counter-reset: rl; }\n'
        '    .rl-item { position: relative; background: #fff; border: 2px solid #000; box-shadow: 4px 4px 0 0 #000; padding: 14px 14px 14px 52px; transition: transform .12s, box-shadow .12s; }\n'
        '    .rl-item:hover { transform: translate(-1px,-1px); box-shadow: 6px 6px 0 0 #000; }\n'
        '    .rl-num { position: absolute; left: -2px; top: -2px; width: 38px; height: 30px; display: flex; align-items: center; justify-content: center; background: #fde047; border: 2px solid #000; font-weight: 900; font-size: 14px; font-family: "Space Grotesk", sans-serif; }\n'
        '    .rl-item .rl-cover, .rl-item > .rl-cover { float: left; margin-right: 14px; width: 74px; height: 105px; display: block; flex-shrink: 0; border: 1.5px solid #000; box-shadow: 2px 2px 0 0 #000; background: #f4f4f0; overflow: hidden; }\n'
        '    .rl-cover img { width: 100%; height: 100%; object-fit: cover; display: block; }\n'
        + NEW_BADGE_CSS +
        '    .rl-no-cover { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; font-size: 32px; }\n'
        '    .rl-meta { overflow: hidden; min-height: 105px; }\n'
        '    .rl-title { font-weight: 800; font-size: 16px; line-height: 1.3; margin-bottom: 4px; }\n'
        '    .rl-title a { color: #000; }\n'
        '    .rl-title a:hover { color: #2563eb; }\n'
        '    .rl-byline { font-size: 13px; color: #555; margin-bottom: 8px; line-height: 1.4; }\n'
        '    .rl-source { display: inline-block; font-size: 12px; padding: 3px 8px; background: #fff; border: 1.5px solid #000; box-shadow: 1px 1px 0 0 #000; text-decoration: none; color: #000; transition: transform .1s, box-shadow .1s, background .1s; }\n'
        '    .rl-source:hover { transform: translate(-1px,-1px); box-shadow: 2px 2px 0 0 #000; background: #a7f3d0; text-decoration: none; }\n'
        '    .rl-shared { clear: both; margin-top: 12px; padding-top: 10px; border-top: 1.5px dashed #ccc; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }\n'
        '    .rl-shared-label { font-size: 12px; color: #666; font-weight: 700; }\n'
        '    .rl-celeb-chip { display: inline-block; padding: 3px 9px; background: #fff8e7; border: 1.5px solid #000; box-shadow: 1px 1px 0 0 #000; font-size: 12px; font-weight: 700; text-decoration: none; color: #000; transition: transform .1s, box-shadow .1s, background .1s; }\n'
        '    .rl-celeb-chip:hover { transform: translate(-1px,-1px); box-shadow: 2px 2px 0 0 #000; background: #fde047; text-decoration: none; }\n'
        '    @media (max-width: 480px) { .rl-item { padding: 14px 12px 14px 46px; } .rl-num { width: 32px; height: 26px; font-size: 12px; } .rl-item .rl-cover, .rl-item > .rl-cover { width: 60px; height: 88px; margin-right: 10px; } .rl-meta { min-height: 88px; } .rl-title { font-size: 15px; } }\n'
        '    .related-celebs { margin: 24px 0; }\n'
        '    .related-celeb-list { display: flex; flex-wrap: wrap; gap: 8px; }\n'
        '    .related-celeb { display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; background: #fff; border: 2px solid #000; box-shadow: 2px 2px 0 0 #000; font-size: 13px; font-weight: 700; text-decoration: none; color: #000; transition: transform .1s, box-shadow .1s; }\n'
        '    .related-celeb:hover { transform: translate(-1px,-1px); box-shadow: 3px 3px 0 0 #000; background: #a7f3d0; text-decoration: none; }\n'
        '    .rc-count { display: inline-block; min-width: 18px; padding: 0 5px; background: #fde047; border: 1px solid #000; border-radius: 10px; font-size: 11px; text-align: center; line-height: 16px; }\n'
        '    .celeb-pager { margin: 32px 0 16px; display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; }\n'
        '    .pager-link { flex: 1 1 220px; padding: 10px 14px; background: #fff; border: 2px solid #000; box-shadow: 3px 3px 0 0 #000; font-size: 13px; font-weight: 700; color: #000; text-decoration: none; display: inline-flex; align-items: center; gap: 8px; transition: transform .1s, box-shadow .1s; }\n'
        '    .pager-link:hover { transform: translate(-1px,-1px); box-shadow: 5px 5px 0 0 #000; background: #fde047; text-decoration: none; }\n'
        '    .pager-next { justify-content: flex-end; }\n'
        '    .pager-arrow { font-size: 18px; font-weight: 900; }\n'
        '    .together-cta { margin: 28px 0; padding: 18px 16px; background: #fbcfe8; border: 3px solid #000; box-shadow: 4px 4px 0 0 #000; }\n'
        '    .together-cta strong { display: block; font-size: 16px; margin-bottom: 6px; }\n'
        '    .together-cta p { margin: 0 0 12px; font-size: 13px; color: #333; }\n'
        '    .together-btn { display: inline-block; padding: 9px 16px; background: #fde047; border: 2px solid #000; box-shadow: 3px 3px 0 0 #000; font-size: 13px; font-weight: 700; color: #000; text-decoration: none; transition: transform .1s, box-shadow .1s; }\n'
        '    .together-btn:hover { transform: translate(-1px,-1px); box-shadow: 5px 5px 0 0 #000; background: #fff; text-decoration: none; }\n'
        '    footer { margin-top: 48px; padding-top: 16px; border-top: 2px solid #000; font-size: 13px; color: #666; }\n'
        '  </style>\n'
        '</head>\n'
        '<body>\n'
        + '  <div class="lang-toggle">\n'
        + copy_btn_html(make_celeb_short_url(name))
        + (('    <span class="lang-btn active">한국어</span>\n'
            '    <a class="lang-btn" href="' + esc(make_en_celeb_url(name_en)) + '" hreflang="en">EN</a>\n') if name_en else '')
        + '  </div>\n'
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
        + (('      <p class="celeb-bio">' + esc(get_bio(name, 'ko')) + '</p>\n')
           if get_bio(name, 'ko') else '')
        + '      <p style="margin:0;color:#666;font-size:14px">총 <strong>' + str(n_books) + '권</strong>의 도서</p>\n'
        '    </div>\n'
        '  </header>\n'
        '\n'
        '  <section class="intro">\n'
        '    <p style="margin:0">' + intro_p + '</p>\n'
        '  </section>\n'
        '\n'
        '  <section id="shelf-sec">\n'
        '    <div class="shelf-head">\n'
        '      <h2>📚 ' + esc(sname) + '의 독서 리스트 (' + str(n_books) + '권)</h2>\n'
        '      <div class="shelf-tabs">\n'
        '        <button type="button" class="sh-cap" id="shelf-cap" title="책장을 그림으로 내려받아요">⤓ 이미지 저장</button>\n'
        '        <button type="button" class="sh-cap" id="shelf-cap-clear" title="배경 없이 투명한 PNG로 내려받아요">⤓ 투명 배경</button>\n'
        '      </div>\n'
        '    </div>\n'
        + new_block(new_items)
        + (('    <p class="muted">' + str(shared_count) + '권은 다른 셀럽도 함께 추천한 책이에요. 아래 목록에서 함께 추천한 셀럽 이름을 볼 수 있어요.</p>\n')
           if shared_count else '')
        + '    <div id="shelf-area">\n'
        '    <div class="shelf" id="shelf">\n'
        + spine_html +
        '    </div>\n'
        '    <ol class="reading-list" id="rlist">\n'
        + book_cards_html +
        '    </ol>\n'
        '    </div>\n'
        '  </section>\n'
        + shelf_capture_js('저장 중…', '책장_' + safe_filename(sname) + '.png',
                           '이미지를 만들지 못했어요. 잠시 뒤 다시 눌러 주세요.',
                           sname + '의 독서 리스트 ' + str(n_books) + '권')
        +
        '\n'
        + (('  <section>\n'
            '    <h2>📝 ' + esc(sname) + '의 책 취향</h2>\n'
            '    <p>' + author_summary + '</p>\n'
            '  </section>\n'
            '\n') if author_summary else '')
        + related_section
        + '  <aside class="together-cta">\n'
        '    <strong>📸 ' + esc(sname) + '(이)가 읽은 책으로 카드 만들기</strong>\n'
        '    <p>' + esc(sname) + ' 사진을 배경으로, 읽은 책 표지를 붙여 인스타그램용 '
        '‘함께 읽기’ 카드를 만들 수 있어요.</p>\n'
        '    <a class="together-btn" href="' + BASE + 'together/?celeb='
        + quote(name, safe='') + '">함께 읽기 카드 만들기 →</a>\n'
        '  </aside>\n'
        '\n'
        + '  <aside class="related">\n'
        '    <strong>다른 셀럽들의 인생책</strong>이 궁금하다면? '
        '<a href="' + BASE + '">최애의 독서 홈</a>에서 ' + str(len(celebs))
        + '명의 셀럽·아이돌·배우가 읽은 책을 확인해 보세요.\n'
        '  </aside>\n'
        '\n'
        + pager_section
        + '  <footer>\n'
        '    <p>이 페이지의 독서 기록은 유튜브·인터뷰·SNS 등 공개된 출처를 기반으로 정리됐어요.</p>\n'
        '  </footer>\n'
        '\n'
        + NEW_BADGE_JS
        + COPY_BTN_JS +
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
        '<head>\n' + GA_TAG +
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
        + image_preconnect(cover_html) +
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
        + COPY_BTN_CSS +
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
        + '  <div class="lang-toggle">\n'
        + copy_btn_html(make_book_short_url(title))
        + (('    <span class="lang-btn active">한국어</span>\n'
            '    <a class="lang-btn" href="' + esc(make_en_book_url(title_en)) + '" hreflang="en">EN</a>\n') if title_en else '')
        + '  </div>\n'
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
        + COPY_BTN_JS +
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

EN_GROUP_ROLES = {
    'director', 'actor', 'actress', 'comedian', 'singer', 'producer',
    'writer', 'model', 'mc', 'rapper', 'dj', 'author', 'host',
}
EN_GROUP_RE = re.compile(r'\(([^)]+)\)\s*$')


def en_group_of(name_en):
    """영문명 끝 괄호에서 소속을 꺼낸다. 소속이 아니면 None."""
    m = EN_GROUP_RE.search(name_en or '')
    if not m:
        return None
    # 'Myeong JAEHYUN((BOYNEXTDOOR)' 처럼 괄호가 더 붙은 오타를 흡수한다
    g = m.group(1).strip().strip('()[]').strip()
    if not g or g.lower() in EN_GROUP_ROLES:
        return None
    return g


# 어떤 그룹이 '2명 이상 영문 페이지'를 갖게 되는지 미리 센다 —
# 멤버 페이지에서 그룹 페이지로 이어 주려면 페이지를 만들기 전에 알아야 한다.
_en_group_count = {}
for _n, _i in celebs.items():
    _ne = _i.get('name_en')
    if not _ne or not any(b.get('title_en') for b in _i['books']):
        continue
    _g = en_group_of(_ne)
    if _g:
        _en_group_count[_g] = _en_group_count.get(_g, 0) + 1
EN_GROUPS_WITH_PAGE = {g for g, c in _en_group_count.items() if c >= 2}


# ── 직업(역할) 분류 ─────────────────────────────────────────────────
#
# 영문 페이지가 전부 'kpop idol books' 한 덩어리로 묶여 있었다. 그래서 배우
# 이름으로 검색하면 K-pop 문맥만 남고 K-drama·K-movie 쪽 검색어와는 어디에서도
# 닿지 않았다. 사람마다 직업을 붙여 제목·설명·본문·키워드가 그 직업의 말을 쓰게
# 한다. 직업은 data/roles.json(수기) → 영문명 끝 괄호 표기 → 소속 그룹 →
# bio 문장 순으로 찾고, 끝내 못 찾으면 중립 문구로 돌아간다.

def load_roles():
    path = 'data/roles.json'
    if not os.path.exists(path):
        return {}
    try:
        with open(path, encoding='utf-8') as f:
            d = json.load(f)
        out = {}
        for k, v in (d.get('roles') or {}).items():
            if isinstance(v, str):
                v = [v]
            v = [str(r).strip().lower() for r in (v or []) if str(r).strip()]
            if v:
                out[k] = v
        return out
    except Exception as e:
        print(f"⚠️ roles.json 로드 실패: {e}")
        return {}


ROLES_MANUAL = load_roles()

# 역할별 표기와 검색어. hub가 있는 역할은 /en/category/ 모아보기를 만든다.
EN_ROLE_INFO = {
    'actor': {
        'label': 'Korean actor',
        'line': 'Korean actor — K-drama and K-movie',
        'hub': 'k-drama-actors',
        'hub_name': 'K-Drama & K-Movie Actors',
        'hub_lower': 'K-drama and K-movie actors',
        'kw': ['korean actor books', 'k-drama actor books', 'k-drama star reading list',
               'k-movie actor books', 'korean drama books', 'what korean actors read'],
    },
    'idol': {
        'label': 'K-pop idol',
        'line': 'K-pop idol — Korean music',
        'hub': 'kpop-idols',
        'hub_name': 'K-Pop Idols',
        'hub_lower': 'K-pop idols',
        'kw': ['kpop idol books', 'what kpop idols read', 'korean idol reading list',
               'kpop star books', 'kpop idol book recommendations'],
    },
    'musician': {
        'label': 'Korean musician',
        'line': 'Korean musician',
        'hub': 'korean-musicians',
        'hub_name': 'Korean Musicians',
        'hub_lower': 'Korean musicians',
        'kw': ['korean musician books', 'korean singer books', 'k-music reading list',
               'korean singer songwriter books'],
    },
    'rapper': {
        'label': 'Korean rapper',
        'line': 'Korean rapper — K-hip-hop',
        'hub': 'korean-rappers',
        'hub_name': 'Korean Rappers',
        'hub_lower': 'Korean rappers',
        'kw': ['korean rapper books', 'k-hip-hop reading list', 'korean hip hop books'],
    },
    'director': {
        'label': 'Korean film director',
        'line': 'Korean film director — K-movie',
        'hub': 'korean-directors',
        'hub_name': 'Korean Film Directors',
        'hub_lower': 'Korean film directors',
        'kw': ['korean director books', 'k-movie director reading list',
               'korean film director book recommendations', 'korean cinema books'],
    },
    'comedian': {
        'label': 'Korean comedian',
        'line': 'Korean comedian — variety and stand-up',
        'hub': '',
        'hub_name': 'Korean Comedians',
        'kw': ['korean comedian books', 'korean variety star books'],
    },
    'host': {
        'label': 'Korean TV host',
        'line': 'Korean TV host and announcer',
        'hub': '',
        'hub_name': 'Korean TV Hosts',
        'kw': ['korean tv host books', 'korean announcer books', 'korean broadcaster reading list'],
    },
    'model': {
        'label': 'Korean model',
        'line': 'Korean model',
        'hub': '',
        'hub_name': 'Korean Models',
        'kw': ['korean model books', 'korean fashion model reading list'],
    },
    'dancer': {
        'label': 'Korean dancer',
        'line': 'Korean dancer and choreographer',
        'hub': '',
        'hub_name': 'Korean Dancers',
        'kw': ['korean dancer books', 'k-pop choreographer reading list'],
    },
    'athlete': {
        'label': 'Korean athlete',
        'line': 'Korean athlete',
        'hub': '',
        'hub_name': 'Korean Athletes',
        'kw': ['korean athlete books', 'korean sports star reading list'],
    },
    'gamer': {
        'label': 'Korean pro gamer',
        'line': 'Korean pro gamer — esports',
        'hub': '',
        'hub_name': 'Korean Pro Gamers',
        'kw': ['korean pro gamer books', 'esports player reading list'],
    },
    'writer': {
        'label': 'Korean writer',
        'line': 'Korean writer',
        'hub': '',
        'hub_name': 'Korean Writers',
        'kw': ['korean writer books', 'korean lyricist reading list'],
    },
    'creator': {
        'label': 'Korean creator',
        'line': 'Korean YouTuber and creator',
        'hub': '',
        'hub_name': 'Korean Creators',
        'kw': ['korean youtuber books', 'korean creator reading list'],
    },
    'chef': {
        'label': 'Korean chef',
        'line': 'Korean chef',
        'hub': '',
        'hub_name': 'Korean Chefs',
        'kw': ['korean chef books', 'korean cook reading list'],
    },
}

# 영문명 끝 괄호가 소속이 아니라 직업일 때 ("Hong Sang-soo (director)")
EN_ROLE_ALIAS = {
    'actor': 'actor', 'actress': 'actor', 'director': 'director',
    'comedian': 'comedian', 'singer': 'musician', 'producer': 'musician',
    'dj': 'musician', 'rapper': 'rapper', 'writer': 'writer', 'author': 'writer',
    'model': 'model', 'mc': 'host', 'host': 'host',
}

# bio 문장에서 직업을 읽는다. 위에 있는 말이 먼저다 (배우 겸 가수면 배우).
EN_BIO_ROLE_HINTS = [
    ('배우', 'actor'), ('영화감독', 'director'), ('감독', 'director'),
    ('프로게이머', 'gamer'), ('코미디언', 'comedian'), ('개그맨', 'comedian'),
    ('개그우먼', 'comedian'), ('아나운서', 'host'), ('방송인', 'host'),
    ('모델', 'model'), ('무용가', 'dancer'), ('안무가', 'dancer'),
    ('소설가', 'writer'), ('작사가', 'writer'), ('작가', 'writer'),
    ('셰프', 'chef'), ('요리연구가', 'chef'),
    ('래퍼', 'rapper'), ('아이돌', 'idol'), ('그룹', 'idol'),
    ('싱어송라이터', 'musician'), ('가수', 'musician'), ('피아니스트', 'musician'),
    ('actress', 'actor'), ('actor', 'actor'), ('film director', 'director'),
    ('comedian', 'comedian'), ('announcer', 'host'), ('television host', 'host'),
    ('model', 'model'), ('novelist', 'writer'), ('lyricist', 'writer'),
    ('rapper', 'rapper'), ('idol group', 'idol'), ('girl group', 'idol'),
    ('boy group', 'idol'), ('singer', 'musician'), ('pianist', 'musician'),
]


def en_roles_of(name_ko, name_en):
    """['actor', 'idol'] 처럼 역할 목록을 돌려준다. 맨 앞이 대표 역할."""
    roles = []

    def add(r):
        if r and r in EN_ROLE_INFO and r not in roles:
            roles.append(r)

    for r in ROLES_MANUAL.get(name_ko, []):
        add(r)

    _ne = plain_en(name_en)
    m = EN_GROUP_RE.search(_ne)
    if m:
        add(EN_ROLE_ALIAS.get(m.group(1).strip().strip('()[]').strip().lower()))
    if en_group_of(_ne):
        add('idol')

    bio = (get_bio(name_ko, 'ko') + ' ' + get_bio(name_ko, 'en')).lower()
    if bio.strip():
        for kw, r in EN_BIO_ROLE_HINTS:
            if kw in bio:
                add(r)
    return roles


def en_role_label(roles):
    """대표 역할의 영문 표기. 못 찾으면 중립 문구."""
    return EN_ROLE_INFO[roles[0]]['label'] if roles else 'Korean celebrity'


# 이름 표기 흔들림 — 검색창에는 하이픈 없이 치는 사람이 더 많다.
# "Moon Chae-won" → "Moon Chae Won", "Moon Chaewon"

def en_name_variants(name_en):
    base = EN_GROUP_RE.sub('', plain_en(name_en)).strip()
    if '-' not in base:
        return []
    spaced = re.sub(r'-([A-Za-z])', lambda m: ' ' + m.group(1).upper(), base)
    joined = re.sub(r'-([A-Za-z])', lambda m: m.group(1).lower(), base)
    out = []
    for v in (spaced, joined):
        v = v.strip()
        if v and v != base and v not in out:
            out.append(v)
    return out


# 사람 페이지를 만들기 전에 모아 둔다 — 모아보기 페이지가 생길 역할을
# 미리 알아야 사람 페이지에서 그리로 이어 줄 수 있다.
EN_ROLES_BY_NAME = {}
_en_role_count = {}
for _n, _i in celebs.items():
    _ne = _i.get('name_en')
    if not _ne or not any(b.get('title_en') for b in _i['books']):
        continue
    _rs = en_roles_of(_n, _ne)
    EN_ROLES_BY_NAME[_n] = _rs
    if _rs:
        _en_role_count[_rs[0]] = _en_role_count.get(_rs[0], 0) + 1

# 5명은 모여야 모아보기 한 장이 된다
EN_ROLE_HUBS = {r for r, c in _en_role_count.items()
                if c >= 5 and EN_ROLE_INFO[r]['hub']}
print('✅ 직업 분류:', ', '.join(f'{r} {c}' for r, c in
                              sorted(_en_role_count.items(), key=lambda kv: -kv[1])),
      f"| 미분류 {sum(1 for v in EN_ROLES_BY_NAME.values() if not v)}명")

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

    # 책 제목·저자에 직역 표시(*)가 있으면 각주를 단다.
    # 인물 영문명의 *는 각주 대상이 아니다.
    en_show_tr_note = has_auto_translated(
        *[b.get('title_en') for b in en_books],
        *[b.get('author_en') for b in en_books],
    )

    # 2명 이상 영문 페이지가 있는 그룹이면 그룹 모아보기로 이어 준다
    _g = en_group_of(name_en)
    _en_group = _g if _g in EN_GROUPS_WITH_PAGE else None

    # 직업과 이름 표기 흔들림 — 이 페이지가 K-pop 말고 어떤 말로 검색되어야
    # 하는지를 정한다. 배우면 K-drama·K-movie 쪽 말을 쓴다.
    _roles     = EN_ROLES_BY_NAME.get(name) or en_roles_of(name, name_en)
    _role_lbl  = en_role_label(_roles)
    _role_hub  = next((r for r in _roles if r in EN_ROLE_HUBS), None)
    _name_pl   = plain_en(name_en)
    _variants  = en_name_variants(name_en)

    page_url = make_en_celeb_url(name_en)
    ko_url   = make_celeb_url(name)
    img      = info['img']
    n        = len(en_books)

    # 책 행 (영문 제목 + 한국어 원제 부기)
    rows = ''
    en_spine_html = ''
    # 영문 페이지는 영문 제목 알파벳 순
    en_list_books = sorted(en_books, key=lambda x: title_sort_key(plain_en(x['title_en'])))
    en_new_items = []
    for i, b in enumerate(en_list_books):
        # 알라딘 상품 URL (CSV의 &amp; 디코드)
        aladin_url = ''
        raw_link = b.get('link') or ''
        if raw_link.startswith('http') and not raw_link.lower().rstrip().endswith(
            ('.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp')
        ):
            aladin_url = esc(html.unescape(raw_link))

        _added = new_book_date(name, b['title'])

        # 검색 결과 요약에 그대로 실리는 자리라 직역 표시(*)는 떼고 저자까지 넣는다
        t_plain = plain_en(b['title_en'])
        a_plain = plain_en(b.get('author_en') or b['author'])
        alt_text = t_plain + (' by ' + a_plain if a_plain else '') + ' — book cover'
        if b['coverUrl'] and b['coverUrl'].startswith('http'):
            cover_inner = ('<img src="' + esc(b['coverUrl']) + '" alt="' + esc(alt_text)
                           + '" loading="lazy">')
        else:
            cover_inner = '<div class="rl-no-cover">📕</div>'
        _cover_badge = cover_new_badge(_added)
        if aladin_url:
            cover_html = ('<a class="rl-cover" href="' + aladin_url
                          + '" rel="nofollow noopener noreferrer" target="_blank" '
                          'aria-label="' + esc(t_plain) + ' — buy or read more">'
                          + _cover_badge + cover_inner + '</a>')
        else:
            cover_html = '<div class="rl-cover">' + _cover_badge + cover_inner + '</div>'

        if aladin_url:
            t_html = ('<a href="' + aladin_url
                      + '" rel="nofollow noopener noreferrer" target="_blank">'
                      + esc(b['title_en']) + '</a>')
        else:
            t_html = esc(b['title_en'])
        t_html += ' <span style="color:#888;font-size:12px;font-weight:400">(' + esc(b['title']) + ')</span>'

        a_en = b.get('author_en')
        author_text = esc(a_en) if a_en else esc(b['author'])

        src_html = ''
        if b['source'] and b['source'].startswith('http'):
            src_html = ('<a class="rl-source" href="' + esc(b['source'])
                        + '" rel="nofollow noopener noreferrer" target="_blank">📺 Source</a>')

        # 책등 한 칸 — 한국어 페이지와 같은 규칙. 예스24 책등이 있으면 그 이미지를,
        # 없으면 제목에서 만든 색 책등을 쓴다. 제목은 영문으로 적는다.
        _sp_url = spine_image_url(b['title'], b['coverUrl'])
        _sp_inner = (
            '<span class="sp-t"><i>' + esc(spine_title(t_plain)) + '</i></span>'
            + ('<img class="sp-i" src="' + esc(_sp_url) + '" alt="" loading="lazy" '
               'referrerpolicy="no-referrer"' + SPINE_IMG_GUARD + '>'
               if _sp_url else '')
            + spine_new_badge(_added)
        )
        _sp_style = ('--c:' + spine_tint(b['title'])
                     + ';--w:' + str(spine_width(b['title'])) + 'px'
                     + ';--fs:' + str(spine_font_size(spine_title(t_plain))) + 'px')
        _sp_cls = ('sp' if _sp_url else 'sp no-img') + (' is-new' if _added else '')
        if aladin_url:
            en_spine_html += ('    <a class="' + _sp_cls + '" style="' + _sp_style + '" href="' + aladin_url
                              + '" rel="nofollow noopener noreferrer" target="_blank" title="'
                              + esc(t_plain) + '">' + _sp_inner + '</a>\n')
        else:
            en_spine_html += ('    <span class="' + _sp_cls + '" style="' + _sp_style + '" title="'
                              + esc(t_plain) + '">' + _sp_inner + '</span>\n')

        _card = (
            '    <li class="rl-item">\n'
            '      <span class="rl-num">' + str(i+1) + '</span>\n'
            '      ' + cover_html + '\n'
            '      <div class="rl-meta">\n'
            '        <div class="rl-title">' + t_html + '</div>\n'
            + (('        <div class="rl-byline">' + author_text + '</div>\n') if author_text else '')
            + (('        ' + src_html + '\n') if src_html else '')
            + '      </div>\n'
            '    </li>\n'
        )
        rows += _card
        if _added:
            en_new_items.append((_added, new_card(_card, i + 1)))

    # 제목에 이름을 세 번 넣으면 구글이 키워드 반복으로 보고 제목을 갈아치운다.
    # 한 번만 쓰고, 검색어와 맞닿는 말(reading list · books)만 남긴다.
    title_text = _name_pl + ' Books — Full Reading List (' + str(n) + ')'

    # 설명도 이름 한 번. 대신 실제 책 제목 세 권을 넣는다 —
    # 구글이 meta description을 버리고 본문에서 목록을 긁어가던 자리를
    # 사람이 읽을 만한 문장으로 채운다.
    def _desc(k):
        picks = [plain_en(b['title_en']) for b in en_books[:k] if b.get('title_en')]
        picks = [t for t in picks if t]
        if len(picks) >= 2:
            txt = ', '.join(picks[:-1]) + ' and ' + picks[-1]
        else:
            txt = picks[0] if picks else ''
        return (_role_lbl + ' ' + _name_pl + ' has read ' + str(n) + ' book'
                + ('s' if n != 1 else '')
                + ((', including ' + txt) if txt else '')
                + '. Full reading list with the interview, YouTube or SNS source for each.')

    # 검색 결과에 잘리지 않게 165자 안쪽으로. 제목이 길면 권수를 줄인다.
    desc_text = _desc(3)
    for _k in (2, 1, 0):
        if len(desc_text) <= 165:
            break
        desc_text = _desc(_k)

    # 검색어 후보. 이름 표기 흔들림(하이픈 없는 표기)과 직업별 말을 함께 넣는다.
    en_kw = [
        _name_pl + ' books', _name_pl + ' reading list',
        _name_pl + ' book recommendations', 'what does ' + _name_pl + ' read',
        _name_pl + ' favorite books',
    ]
    for _v in _variants:
        en_kw += [_v + ' books', _v + ' reading list', _v + ' book recommendations']
    en_kw.append(name + ' 책')
    for _r in _roles:
        en_kw += EN_ROLE_INFO[_r]['kw']
    en_kw += ['korean celebrity books', 'korean celebrity reading list', 'books from korea']
    _seen_kw = set()
    en_kw = [k for k in en_kw if not (k.lower() in _seen_kw or _seen_kw.add(k.lower()))]

    _picks_all = [plain_en(b['title_en']) for b in en_books if b.get('title_en')]
    _picks_all = [t for t in _picks_all if t]
    _picks = _picks_all[:5]
    if len(_picks) >= 2:
        _picks_txt = ', '.join(_picks[:-1]) + ' and ' + _picks[-1]
    else:
        _picks_txt = _picks[0] if _picks else ''
    if len(_picks_all) > 5:
        _picks_txt += ', and ' + str(len(_picks_all) - 5) + ' more'

    en_faq_items = []
    if _picks_txt:
        en_faq_items.append((
            'What books does ' + _name_pl + ' recommend?',
            _name_pl + "'s book recommendations in this archive: " + _picks_txt
            + '. Every book on this page is linked to the interview, YouTube video or SNS post '
              'where ' + _name_pl + ' talked about it.'))
    en_faq_items.append((
        'How many books has ' + _name_pl + ' read?',
        _name_pl + ' has ' + str(n) + ' book' + ('s' if n != 1 else '')
        + ' recorded here so far, read or recommended in public Korean-language sources. '
          'The list grows whenever a new book mention turns up.'))
    en_faq_items.append((
        'Where do these ' + _name_pl + ' book recommendations come from?',
        'Public sources only — interviews, YouTube clips, variety shows, fan-cafe posts and SNS. '
        'A book is added to this reading list only when the mention can be linked, and the link '
        'stays on the entry so you can check it yourself.'))

    en_faq_html = ''.join(
        '    <div class="pfaq-q">\n'
        '      <h3>' + esc(q) + '</h3>\n'
        '      <p>' + esc(a) + '</p>\n'
        '    </div>\n'
        for q, a in en_faq_items)
    en_faq_ld = {
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        'mainEntity': [
            {'@type': 'Question', 'name': q,
             'acceptedAnswer': {'@type': 'Answer', 'text': a}}
            for q, a in en_faq_items
        ],
    }

    # 읽은 책을 Book 항목으로 함께 내보낸다. 인물과 책이 이어져 있다는 걸
    # 검색엔진이 본문 파싱에 기대지 않고 바로 알 수 있다.
    book_items = []
    for _i, _b in enumerate(en_books):
        _t = plain_en(_b['title_en'])
        if not _t:
            continue
        _a = plain_en(_b.get('author_en') or _b['author'])
        book_items.append({
            '@type': 'ListItem',
            'position': _i + 1,
            'item': clean_none({
                '@type': 'Book',
                'name': _t,
                'alternateName': _b['title'] or None,
                'author': ({'@type': 'Person', 'name': _a} if _a else None),
                'image': _b['coverUrl'] if (_b['coverUrl'] or '').startswith('http') else None,
                'publisher': ({'@type': 'Organization', 'name': _b['publisher']}
                              if _b.get('publisher') else None),
            }),
        })

    json_ld = clean_none({
        '@context': 'https://schema.org',
        '@type': 'ProfilePage',
        'name': title_text,
        'url': page_url,
        'inLanguage': 'en',
        'description': desc_text,
        'mainEntity': clean_none({
            '@type': 'Person',
            'name': _name_pl,
            # 하이픈 없는 표기까지 같은 사람이라고 알려 준다
            'alternateName': [name] + _variants,
            'jobTitle': (EN_ROLE_INFO[_roles[0]]['label'] if _roles else None),
            'nationality': {'@type': 'Country', 'name': 'South Korea'},
            'description': get_bio(name, 'en') or (
                (EN_ROLE_INFO[_roles[0]]['line'] + '. Reading list and book recommendations.')
                if _roles else None),
            'image': img if img.startswith('http') else None,
        }),
        'mainEntityOfPage': page_url,
        'hasPart': clean_none({
            '@type': 'ItemList',
            'name': 'Books read by ' + _name_pl,
            'numberOfItems': len(book_items),
            'itemListElement': book_items or None,
        }),
        'isPartOf': {'@type': 'WebSite', 'name': 'Favorbook', 'url': EN_BASE},
    })
    breadcrumb_ld = {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        'itemListElement': [
            {'@type': 'ListItem', 'position': 1, 'name': 'Home', 'item': EN_BASE},
            {'@type': 'ListItem', 'position': 2, 'name': _name_pl + "'s Reading List", 'item': page_url},
        ],
    }

    page = (
        '<!DOCTYPE html>\n'
        '<html lang="en">\n'
        '<head>\n' + GA_TAG +
        '  <meta charset="utf-8">\n'
        '  <meta name="viewport" content="width=device-width, initial-scale=1">\n'
        '  <title>' + esc(title_text) + ' | Favorbook</title>\n'
        '  <meta name="description" content="' + esc(desc_text) + '">\n'
        '  <meta name="keywords" content="' + esc(', '.join(en_kw)) + '">\n'
        '  <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1">\n'
        '  <meta property="og:title" content="' + esc(title_text) + '">\n'
        '  <meta property="og:description" content="' + esc(desc_text) + '">\n'
        '  <meta property="og:image" content="' + esc(img) + '">\n'
        '  <meta property="og:url" content="' + esc(page_url) + '">\n'
        '  <meta property="og:type" content="profile">\n'
        '  <meta property="og:locale" content="en_US">\n'
        '  <meta property="og:site_name" content="Favorbook">\n'
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
        '  <script type="application/ld+json">\n  '
        + json.dumps(en_faq_ld, ensure_ascii=False, indent=2) + '\n  </script>\n'
        # 책등 제목에 쓰는 바탕체. font-display:swap이라 글자는 바로 보이고
        # 실제로 쓰는 굵기 한 벌만 받는다.
        '  <link rel="stylesheet" href="' + BASE + 'assets/fonts/kopubworld.css">\n'
        '  <style>\n'
        '    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; max-width: 860px; margin: 0 auto; padding: 20px; color: #222; line-height: 1.6; background: #fcfaf5; }\n'
        '    .lang-toggle { position: absolute; top: 16px; right: 16px; display: flex; gap: 6px; }\n'
        + COPY_BTN_CSS +
        '    .lang-btn { padding: 6px 12px; border: 2px solid #000; background: #fff; box-shadow: 2px 2px 0 0 #000; font-size: 12px; font-weight: 700; text-decoration: none; color: #000; transition: transform .1s, box-shadow .1s; }\n'
        '    .lang-btn:hover { transform: translate(-1px,-1px); box-shadow: 3px 3px 0 0 #000; background: #fde047; text-decoration: none; }\n'
        '    .lang-btn.active { background: #000; color: #fff; }\n'
        '    nav { margin: 50px 0 16px; font-size: 13px; }\n'
        '    .celeb-header { display: flex; align-items: center; gap: 20px; margin-bottom: 16px; flex-wrap: wrap; }\n'
        '    .celeb-img { width: 120px; height: 120px; border-radius: 50%; object-fit: cover; border: 2px solid #000; }\n'
        '    h1 { font-size: 28px; margin: 0 0 8px; font-weight: 900; }\n'
        '    h2 { font-size: 19px; margin: 32px 0 12px; padding-bottom: 4px; border-bottom: 2px solid #000; font-weight: 800; }\n'
        '    .intro { background: #fff; border: 2px solid #000; box-shadow: 4px 4px 0 0 #000; padding: 14px 16px; margin: 16px 0 24px; font-size: 15px; }\n'
        '    .celeb-bio { margin: 4px 0 8px; padding: 6px 10px; background: #fff8e7; border-left: 4px solid #000; font-size: 14px; line-height: 1.45; color: #222; }\n'
        '    .celeb-alias { margin: 2px 0 0; font-size: 12px; color: #888; }\n'
        '    .pfaq { margin-top: 40px; }\n'
        '    .pfaq-q { background: #fff; border: 2px solid #000; box-shadow: 3px 3px 0 0 #000; padding: 12px 14px; margin-bottom: 12px; }\n'
        '    .pfaq-q h3 { font-size: 15px; font-weight: 800; margin: 0 0 6px; }\n'
        '    .pfaq-q p { font-size: 14px; margin: 0; color: #333; }\n'
        '    .grp-link { margin: 10px 0 0; padding: 8px 12px; background: #fff8e7; border: 2px solid #000; box-shadow: 3px 3px 0 0 #000; font-size: 14px; }\n'
        + SHELF_CSS +
        '    .reading-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 14px; }\n'
        '    .rl-item { position: relative; background: #fff; border: 2px solid #000; box-shadow: 4px 4px 0 0 #000; padding: 14px 14px 14px 52px; transition: transform .12s, box-shadow .12s; }\n'
        '    .rl-item:hover { transform: translate(-1px,-1px); box-shadow: 6px 6px 0 0 #000; }\n'
        '    .rl-num { position: absolute; left: -2px; top: -2px; width: 38px; height: 30px; display: flex; align-items: center; justify-content: center; background: #fde047; border: 2px solid #000; font-weight: 900; font-size: 14px; }\n'
        '    .rl-cover { float: left; margin-right: 14px; width: 74px; height: 105px; display: block; border: 1.5px solid #000; box-shadow: 2px 2px 0 0 #000; background: #f4f4f0; overflow: hidden; }\n'
        '    .rl-cover img { width: 100%; height: 100%; object-fit: cover; display: block; }\n'
        + NEW_BADGE_CSS +
        '    .rl-no-cover { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; font-size: 32px; }\n'
        '    .rl-meta { overflow: hidden; min-height: 105px; }\n'
        '    .rl-title { font-weight: 800; font-size: 16px; line-height: 1.3; margin-bottom: 4px; }\n'
        '    .rl-title a { color: #000; }\n'
        '    .rl-title a:hover { color: #2563eb; }\n'
        '    .rl-byline { font-size: 13px; color: #555; margin-bottom: 8px; line-height: 1.4; }\n'
        '    .rl-source { display: inline-block; font-size: 12px; padding: 3px 8px; background: #fff; border: 1.5px solid #000; box-shadow: 1px 1px 0 0 #000; text-decoration: none; color: #000; transition: transform .1s, box-shadow .1s, background .1s; }\n'
        '    .rl-source:hover { transform: translate(-1px,-1px); box-shadow: 2px 2px 0 0 #000; background: #a7f3d0; text-decoration: none; }\n'
        '    @media (max-width: 480px) { .rl-item { padding: 14px 12px 14px 46px; } .rl-num { width: 32px; height: 26px; font-size: 12px; } .rl-cover { width: 60px; height: 88px; margin-right: 10px; } .rl-meta { min-height: 88px; } .rl-title { font-size: 15px; } }\n'
        '    a { color: #2563eb; text-decoration: none; }\n'
        '    a:hover { text-decoration: underline; }\n'
        '    footer { margin-top: 48px; padding-top: 16px; border-top: 2px solid #000; font-size: 13px; color: #666; }\n'
        + (EN_TR_NOTE_CSS if en_show_tr_note else '')
        + '  </style>\n'
        '</head>\n'
        '<body>\n'
        '  <div class="lang-toggle">\n'
        + copy_btn_html(page_url, '🔗 Copy link', 'Copied!')
        + '    <a class="lang-btn" href="' + esc(ko_url) + '" hreflang="ko">한국어</a>\n'
        '    <span class="lang-btn active">EN</span>\n'
        '  </div>\n'
        '  <nav><a href="' + EN_BASE + '">← Favorbook Home</a></nav>\n'
        '  <header class="celeb-header">\n'
        '    <img class="celeb-img" src="' + esc(img) + '" alt="' + esc(_name_pl) + ' profile photo" width="120" height="120">\n'
        '    <div>\n'
        '      <h1>' + esc(name_en) + ' Books<span style="font-weight:400;color:#666;font-size:18px"> · '
        + esc(name) + ' 책</span></h1>\n'
        # 소개 한 줄이 없으면 직업이라도 적는다. 이 줄이 없으면 검색엔진이
        # 이 사람이 배우인지 아이돌인지 알 방법이 페이지 안에 하나도 없다.
        + (('      <p class="celeb-bio">' + esc(get_bio(name, 'en')) + '</p>\n')
           if get_bio(name, 'en') else
           (('      <p class="celeb-bio">' + esc(EN_ROLE_INFO[_roles[0]]['line'])
             + '</p>\n') if _roles else ''))
        # 검색창에는 하이픈 없이 치는 사람이 더 많다 ("Moon Chae Won book")
        + (('      <p class="celeb-alias">Also written ' + esc(' · '.join(_variants))
            + '</p>\n') if _variants else '')
        + '      <p style="margin:0;color:#666;font-size:14px">' + str(n) + ' book' + ('s' if n != 1 else '') + ' read &amp; recommended</p>\n'
        '    </div>\n'
        '  </header>\n'
        '  <section class="intro">\n'
        '    <p style="margin:0">' + str(n) + ' book' + ('s' if n != 1 else '')
        + ' read or recommended by <strong>' + esc(_name_pl) + '</strong> (' + esc(name) + ')'
        + ((', a ' + esc(_role_lbl)) if _roles else '')
        + ', gathered from interviews, YouTube, and SNS sources.</p>\n'
        '  </section>\n'
        + ((
            '  <p class="grp-link">Part of <strong>' + esc(_en_group) + '</strong> — '
            '<a href="' + EN_BASE + 'group/' + safe_en_filename(_en_group) + '.html">'
            'see what every ' + esc(_en_group) + ' member reads →</a></p>\n'
          ) if _en_group else '')
        + ((
            '  <p class="grp-link">More reading lists from '
            '<a href="' + EN_BASE + 'category/' + EN_ROLE_INFO[_role_hub]['hub'] + '.html">'
            + esc(EN_ROLE_INFO[_role_hub]['hub_name']) + ' →</a></p>\n'
          ) if _role_hub else '')
        + '  <section id="shelf-sec">\n'
        '    <div class="shelf-head">\n'
        '      <h2>Books ' + esc(_name_pl) + ' has read (' + str(n) + ')</h2>\n'
        '      <div class="shelf-tabs">\n'
        '        <button type="button" class="sh-cap" id="shelf-cap" title="Download the bookshelf as an image">\u2913 Save image</button>\n'
        '        <button type="button" class="sh-cap" id="shelf-cap-clear" title="Download as a PNG with a transparent background">\u2913 Transparent</button>\n'
        '      </div>\n'
        '    </div>\n'
        + new_block(en_new_items, 'en')
        + '    <div id="shelf-area">\n'
        '    <div class="shelf" id="shelf">\n' + en_spine_html +
        '    </div>\n'
        '    <ol class="reading-list" id="rlist">\n' + rows +
        '    </ol>\n'
        '    </div>\n'
        '  </section>\n'
        + shelf_capture_js('Saving…', 'bookshelf_' + slug + '.png',
                           'Could not create the image. Please try again.',
                           _name_pl + ' — ' + str(n) + ' books', '_transparent')
        + (EN_TR_NOTE_HTML if en_show_tr_note else '')
        + '  <section class="pfaq">\n'
        '    <h2>' + esc(_name_pl) + ' book recommendations — FAQ</h2>\n'
        + en_faq_html
        + '  </section>\n'
        + '  <footer>\n'
        '    <p>Curated from public Korean-language sources. Korean original page: <a href="'
        + esc(ko_url) + '" hreflang="ko">' + esc(name) + '</a>.</p>\n'
        '    <p><a href="' + EN_BASE + '">Browse more Korean celebrity book lists →</a></p>\n'
        '  </footer>\n'
        + NEW_BADGE_JS
        + COPY_BTN_JS +
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

    # SEO: 어떤 셀럽이 읽었는지 제목/설명에 노출 (영문명 우선 3명)
    celeb_names_en = []
    for c in sorted(binfo['celebs']):
        c_en = celebs[c].get('name_en')
        if c_en:
            celeb_names_en.append(c_en)
    if not celeb_names_en:
        # 영문명 없으면 한국어 그대로
        celeb_names_en = sorted(binfo['celebs'])
    top_celebs_str = ', '.join(celeb_names_en[:3])

    title_text = t_en + ' · Read by ' + top_celebs_str + (', and more' if n_celebs > 3 else '')
    desc_text  = (t_en + ' (Korean: ' + esc(title) + ') is a book read and recommended by '
                  + str(n_celebs) + ' K-pop idols and Korean celebrities including '
                  + top_celebs_str + '. See who, when, and why.')

    # 영문 작가 이름이 있으면 우선 사용
    author_en = book_author_en.get(title)
    author_display = author_en if author_en else binfo['author']

    # 책 제목·저자에만 해당. 함께 노출되는 인물 영문명의 *는 각주 대상이 아니다.
    en_show_tr_note = has_auto_translated(t_en, author_en)

    json_ld = clean_none({
        '@context': 'https://schema.org',
        '@type': 'Book',
        'name': t_en,
        'alternateName': title,
        'url': page_url,
        'inLanguage': 'en',
        'description': str(n_celebs) + ' Korean celebrities have read this book.',
        'author': {'@type': 'Person', 'name': author_display} if author_display.strip() else None,
        'publisher': {'@type': 'Organization', 'name': binfo['publisher']} if binfo['publisher'].strip() else None,
        'image': binfo['coverUrl'] if binfo['coverUrl'].startswith('http') else None,
    })

    page = (
        '<!DOCTYPE html>\n'
        '<html lang="en">\n'
        '<head>\n' + GA_TAG +
        '  <meta charset="utf-8">\n'
        '  <meta name="viewport" content="width=device-width, initial-scale=1">\n'
        '  <title>' + esc(title_text) + ' | Favorbook</title>\n'
        '  <meta name="description" content="' + esc(desc_text) + '">\n'
        '  <meta name="keywords" content="'
        + esc(t_en) + ', ' + esc(t_en) + ' kpop, ' + esc(t_en) + ' korean celebrity, '
        + 'books read by ' + esc(top_celebs_str) + ', '
        + ', '.join((esc(c) + ' books') for c in celeb_names_en[:3]) + ', '
        + 'kpop idol books, korean celebrity book recommendations, kpop reading list">\n'
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
        + COPY_BTN_CSS +
        '    .lang-btn { padding: 6px 12px; border: 2px solid #000; background: #fff; box-shadow: 2px 2px 0 0 #000; font-size: 12px; font-weight: 700; text-decoration: none; color: #000; transition: transform .1s, box-shadow .1s; }\n'
        '    .lang-btn:hover { transform: translate(-1px,-1px); box-shadow: 3px 3px 0 0 #000; background: #fde047; text-decoration: none; }\n'
        '    .lang-btn.active { background: #000; color: #fff; }\n'
        '    nav { margin: 50px 0 16px; font-size: 13px; }\n'
        '    h1 { font-size: 28px; margin: 0 0 6px; font-weight: 900; }\n'
        '    h2 { font-size: 19px; margin: 32px 0 12px; padding-bottom: 4px; border-bottom: 2px solid #000; font-weight: 800; }\n'
        '    .meta { color: #666; margin: 0 0 16px; }\n'
        + (EN_TR_NOTE_CSS if en_show_tr_note else '')
        + '    ul { line-height: 2; padding-left: 22px; }\n'
        '    a { color: #2563eb; text-decoration: none; }\n'
        '    a:hover { text-decoration: underline; }\n'
        '  </style>\n'
        '</head>\n'
        '<body>\n'
        '  <div class="lang-toggle">\n'
        + copy_btn_html(page_url, '🔗 Copy link', 'Copied!')
        + '    <a class="lang-btn" href="' + esc(ko_url) + '" hreflang="ko">한국어</a>\n'
        '    <span class="lang-btn active">EN</span>\n'
        '  </div>\n'
        '  <nav><a href="' + EN_BASE + '">← Favorbook Home</a></nav>\n'
        '  <h1>' + esc(t_en) + '</h1>\n'
        '  <p class="meta">Korean: <strong>' + esc(title) + '</strong>'
        + ((' · ' + esc(author_display)) if author_display.strip() else '')
        + ((' · ' + esc(binfo['publisher'])) if binfo['publisher'].strip() else '')
        + '</p>\n'
        + cover_html
        + '  <h2>Read by ' + str(n_celebs) + ' Korean celebrities</h2>\n'
        '  <ul>\n' + celeb_list + '\n  </ul>\n'
        + (EN_TR_NOTE_HTML if en_show_tr_note else '')
        + '  <p style="margin-top:32px"><a href="' + EN_BASE + '">← Back to Favorbook</a></p>\n'
        + COPY_BTN_JS +
        '</body>\n'
        '</html>'
    )
    write_if_changed('en/share/book/' + slug + '.html', page)
    en_book_pages.append((slug, t_en, title))

print(f"✅ /en/ 책 페이지: {len(en_book_pages)}개")

# ── /en/group/*.html — 그룹별 모아보기 ───────────────────────────────
#
# 해외에서는 "what do kpop idols read", "bts members books" 처럼 사람 이름이
# 아니라 그룹이나 주제로 찾는다. 사람 페이지만 있으면 그런 검색에 걸릴 페이지가
# 없다. 영문명 끝의 괄호(예: "Karina (aespa)")가 곧 소속이므로 그걸로 묶는다.

en_groups = {}
for _slug, _name_en, _name_ko in en_celeb_pages:
    _g = en_group_of(_name_en)
    if _g:
        en_groups.setdefault(_g, []).append((_slug, _name_en, _name_ko))

# 혼자인 소속은 그룹이라고 보기 어렵다 (배우 이름 뒤 괄호 등)
en_groups = {g: ms for g, ms in en_groups.items() if len(ms) >= 2}

os.makedirs('en/group', exist_ok=True)
en_group_pages = []          # [(slug, group, 멤버 수, 책 수)]

# 영문 책 페이지가 있는 책은 제목에서 그리로 이어 준다 (안쪽 연결)
en_book_slug_by_ko = {t_ko: bslug for bslug, _t_en, t_ko in en_book_pages}

for _group in sorted(en_groups, key=lambda g: g.lower()):
    members = sorted(en_groups[_group], key=lambda m: m[1].lower())
    gslug = safe_en_filename(_group)
    gurl = EN_BASE + 'group/' + gslug + '.html'

    # 그룹이 읽은 책을 모은다 — 여러 멤버가 읽은 책이 앞으로
    gbooks = {}
    for _slug, _name_en, _name_ko in members:
        for b in celebs[_name_ko]['books']:
            if not b.get('title_en'):
                continue
            t = plain_en(b['title_en'])
            if not t:
                continue
            hit = gbooks.setdefault(t, {'readers': [], 'ko': b['title'],
                                        'cover': b.get('coverUrl', ''),
                                        'author': plain_en(b.get('author_en') or b['author'])})
            if _name_en not in hit['readers']:
                hit['readers'].append(_name_en)
            if not hit['cover'] and b.get('coverUrl'):
                hit['cover'] = b['coverUrl']
    ranked = sorted(gbooks.items(), key=lambda kv: (-len(kv[1]['readers']), kv[0].lower()))
    shared = [x for x in ranked if len(x[1]['readers']) >= 2]

    _slug_by_en = {m[1]: m[0] for m in members}
    member_cards = ''
    for _slug, _name_en, _name_ko in members:
        n_b = sum(1 for b in celebs[_name_ko]['books'] if b.get('title_en'))
        img = celebs[_name_ko]['img']
        short = EN_GROUP_RE.sub('', _name_en).strip() or _name_en
        member_cards += (
            '    <li class="gm">\n'
            '      <a href="' + EN_BASE + 'share/' + _slug + '.html">\n'
            + (('        <img src="' + esc(img) + '" alt="' + esc(_name_en)
                + ' profile photo" loading="lazy" referrerpolicy="no-referrer">\n')
               if img.startswith('http') else '')
            + '        <span class="gm-n">' + esc(short) + '</span>\n'
            '        <span class="gm-c">' + str(n_b) + ' book' + ('s' if n_b != 1 else '') + '</span>\n'
            '      </a>\n'
            '    </li>\n'
        )

    book_rows = ''
    for t, info in ranked[:40]:
        who = ', '.join(
            '<a href="' + EN_BASE + 'share/' + _slug_by_en[r] + '.html">'
            + esc(EN_GROUP_RE.sub('', r).strip() or r) + '</a>'
            for r in info['readers'])
        _bslug = en_book_slug_by_ko.get(info['ko'])
        _t_html = (('<a href="' + EN_BASE + 'share/book/' + _bslug + '.html">' + esc(t) + '</a>')
                   if _bslug else esc(t))
        book_rows += (
            '    <li class="gb">\n'
            '      <span class="gb-t">' + _t_html + '</span>\n'
            + (('      <span class="gb-a">' + esc(info['author']) + '</span>\n') if info['author'] else '')
            + '      <span class="gb-w">' + who + '</span>\n'
            '    </li>\n'
        )

    n_members, n_books = len(members), len(gbooks)
    # 이름을 두 번 넣으면 길어지고 구글이 제목을 갈아치운다. 짧을 때만 꼬리를 붙인다.
    g_title = _group + ' Members’ Book Recommendations'
    _with_tail = g_title + ' — What ' + _group + ' Reads'
    if len(_with_tail) <= 62:
        g_title = _with_tail
    picks = [t for t, _ in ranked[:3]]
    g_desc = (_group + ' members have read ' + str(n_books) + ' books'
              + ((', including ' + ', '.join(picks[:-1]) + ' and ' + picks[-1])
                 if len(picks) >= 2 else (', including ' + picks[0] if picks else ''))
              + '. Reading lists for all ' + str(n_members)
              + ' members, with the source for each book.')
    if len(g_desc) > 165:
        g_desc = (_group + ' members have read ' + str(n_books) + ' books. Reading lists for all '
                  + str(n_members) + ' members, with the source for each book.')

    g_ld = clean_none({
        '@context': 'https://schema.org',
        '@type': 'CollectionPage',
        'name': g_title,
        'url': gurl,
        'inLanguage': 'en',
        'description': g_desc,
        'about': {'@type': 'MusicGroup', 'name': _group},
        'isPartOf': {'@type': 'WebSite', 'name': 'Favorbook', 'url': EN_BASE},
        'hasPart': {
            '@type': 'ItemList',
            'name': 'Members of ' + _group,
            'numberOfItems': n_members,
            'itemListElement': [
                {'@type': 'ListItem', 'position': i + 1,
                 'item': {'@type': 'Person', 'name': m[1],
                          'url': EN_BASE + 'share/' + m[0] + '.html'}}
                for i, m in enumerate(members)
            ],
        },
    })

    page = (
        '<!DOCTYPE html>\n'
        '<html lang="en">\n'
        '<head>\n' + GA_TAG +
        '  <meta charset="utf-8">\n'
        '  <meta name="viewport" content="width=device-width, initial-scale=1">\n'
        '  <title>' + esc(g_title) + ' | Favorbook</title>\n'
        '  <meta name="description" content="' + esc(g_desc) + '">\n'
        '  <meta name="robots" content="index, follow, max-image-preview:large">\n'
        '  <meta property="og:title" content="' + esc(g_title) + '">\n'
        '  <meta property="og:description" content="' + esc(g_desc) + '">\n'
        '  <meta property="og:url" content="' + esc(gurl) + '">\n'
        '  <meta property="og:type" content="website">\n'
        '  <meta property="og:locale" content="en_US">\n'
        '  <meta property="og:site_name" content="Favorbook">\n'
        '  <meta name="twitter:card" content="summary_large_image">\n'
        '  <link rel="canonical" href="' + esc(gurl) + '">\n'
        '  <link rel="icon" href="' + BASE + 'favicon.svg" type="image/svg+xml">\n'
        '  <script type="application/ld+json">\n  '
        + json.dumps(g_ld, ensure_ascii=False, indent=2) + '\n  </script>\n'
        '  <style>\n'
        '    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; max-width: 860px; margin: 0 auto; padding: 20px; color: #222; line-height: 1.6; background: #fcfaf5; }\n'
        '    a { color: #2563eb; text-decoration: none; }\n'
        '    a:hover { text-decoration: underline; }\n'
        '    nav { margin: 8px 0 16px; font-size: 13px; }\n'
        '    h1 { font-size: 27px; margin: 0 0 8px; font-weight: 900; line-height: 1.25; }\n'
        '    h2 { font-size: 19px; margin: 32px 0 12px; padding-bottom: 4px; border-bottom: 2px solid #000; font-weight: 800; }\n'
        '    .lead { background: #fff; border: 2px solid #000; box-shadow: 4px 4px 0 0 #000; padding: 14px 16px; margin: 14px 0 6px; font-size: 15px; }\n'
        '    .members { list-style: none; padding: 0; margin: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(116px, 1fr)); gap: 12px; }\n'
        '    .gm a { display: block; color: #000; text-align: center; }\n'
        '    .gm a:hover { text-decoration: none; }\n'
        '    .gm img { width: 100%; aspect-ratio: 1/1; object-fit: cover; border: 2px solid #000; box-shadow: 2px 2px 0 0 #000; display: block; background: #f4f4f0; }\n'
        '    .gm-n { display: block; font-weight: 800; font-size: 13px; margin-top: 6px; line-height: 1.25; }\n'
        '    .gm-c { display: block; font-size: 11px; color: #666; }\n'
        '    .gb { background: #fff; border: 2px solid #000; box-shadow: 3px 3px 0 0 #000; padding: 10px 12px; margin-bottom: 10px; list-style: none; }\n'
        '    .gb-t { display: block; font-weight: 800; font-size: 15px; line-height: 1.3; }\n'
        '    .gb-a { display: block; font-size: 12px; color: #555; }\n'
        '    .gb-w { display: block; font-size: 12px; color: #2563eb; margin-top: 3px; }\n'
        '    .books { padding: 0; margin: 0; }\n'
        '    footer { margin-top: 40px; padding-top: 16px; border-top: 2px solid #000; font-size: 12px; color: #666; }\n'
        '  </style>\n'
        '</head>\n'
        '<body>\n'
        '  <nav><a href="' + EN_BASE + '">← Favorbook</a></nav>\n'
        '  <h1>' + esc(_group) + ' Members’ Book Recommendations</h1>\n'
        '  <div class="lead">\n'
        '    <p style="margin:0">Every book we could verify that <strong>' + esc(_group)
        + '</strong> members have read or recommended — ' + str(n_books) + ' books across '
        + str(n_members) + ' members'
        + ((', ' + str(len(shared)) + ' of them read by more than one member') if shared else '')
        + '. Each entry links to the interview, YouTube video or SNS post it came from.</p>\n'
        '  </div>\n'
        '  <h2>Members</h2>\n'
        '  <ul class="members">\n' + member_cards +
        '  </ul>\n'
        '  <h2>Books ' + esc(_group) + ' has read</h2>\n'
        '  <ul class="books">\n' + book_rows +
        '  </ul>\n'
        + (('  <p>Showing the ' + str(min(40, len(ranked))) + ' most shared of '
            + str(n_books) + ' books. Open a member above for their full list.</p>\n')
           if len(ranked) > 40 else '')
        + '  <footer>\n'
        '    <p>Curated from public Korean-language sources. '
        '<a href="' + EN_BASE + '">Browse every K-pop idol and Korean celebrity →</a></p>\n'
        '  </footer>\n'
        '</body>\n'
        '</html>'
    )
    write_if_changed('en/group/' + gslug + '.html', page)
    en_group_pages.append((gslug, _group, n_members, n_books))

print(f"✅ /en/group/ 그룹 페이지: {len(en_group_pages)}개")


# ── /en/category/*.html — 직업별 모아보기 ───────────────────────────
#
# 그룹 페이지는 아이돌만 닿는다. "what do korean actors read", "k-drama star
# books" 처럼 직업으로 묻는 검색에는 답할 페이지가 없었다. 배우·가수·감독을
# 각각 한 장으로 묶어 그 말이 들어간 문서를 만들고, 사람 페이지에서 이리로
# 이어 준다.

os.makedirs('en/category', exist_ok=True)
en_category_pages = []       # [(slug, role, 인원, 책 수)]

en_role_members = {}
for _slug, _name_en, _name_ko in en_celeb_pages:
    _rs = EN_ROLES_BY_NAME.get(_name_ko) or []
    _r = next((r for r in _rs if r in EN_ROLE_HUBS), None)
    if _r:
        en_role_members.setdefault(_r, []).append((_slug, _name_en, _name_ko))

for _role in sorted(en_role_members, key=lambda r: -len(en_role_members[r])):
    info_r  = EN_ROLE_INFO[_role]
    members = sorted(en_role_members[_role], key=lambda m: m[1].lower())
    cslug   = info_r['hub']
    curl    = EN_BASE + 'category/' + cslug + '.html'
    hub_name  = info_r['hub_name']
    hub_lower = info_r.get('hub_lower') or hub_name.lower()

    cbooks = {}
    for _slug, _name_en, _name_ko in members:
        for b in celebs[_name_ko]['books']:
            if not b.get('title_en'):
                continue
            t = plain_en(b['title_en'])
            if not t:
                continue
            hit = cbooks.setdefault(t, {'readers': [], 'ko': b['title'],
                                        'author': plain_en(b.get('author_en') or b['author'])})
            if _name_en not in hit['readers']:
                hit['readers'].append(_name_en)
    ranked = sorted(cbooks.items(), key=lambda kv: (-len(kv[1]['readers']), kv[0].lower()))
    shared = [x for x in ranked if len(x[1]['readers']) >= 2]

    _slug_by_en = {m[1]: m[0] for m in members}
    person_cards = ''
    for _slug, _name_en, _name_ko in members:
        n_b = sum(1 for b in celebs[_name_ko]['books'] if b.get('title_en'))
        img = celebs[_name_ko]['img']
        person_cards += (
            '    <li class="gm">\n'
            '      <a href="' + EN_BASE + 'share/' + _slug + '.html">\n'
            + (('        <img src="' + esc(img) + '" alt="' + esc(plain_en(_name_en))
                + ' profile photo" loading="lazy" referrerpolicy="no-referrer">\n')
               if img.startswith('http') else '')
            + '        <span class="gm-n">' + esc(plain_en(_name_en)) + '</span>\n'
            '        <span class="gm-c">' + esc(_name_ko) + ' · ' + str(n_b)
            + ' book' + ('s' if n_b != 1 else '') + '</span>\n'
            '      </a>\n'
            '    </li>\n'
        )

    book_rows = ''
    for t, binfo_c in ranked[:40]:
        who = ', '.join(
            '<a href="' + EN_BASE + 'share/' + _slug_by_en[r] + '.html">'
            + esc(plain_en(EN_GROUP_RE.sub('', r).strip() or r)) + '</a>'
            for r in binfo_c['readers'][:8])
        if len(binfo_c['readers']) > 8:
            who += ' and ' + str(len(binfo_c['readers']) - 8) + ' more'
        _bslug = en_book_slug_by_ko.get(binfo_c['ko'])
        _t_html = (('<a href="' + EN_BASE + 'share/book/' + _bslug + '.html">' + esc(t) + '</a>')
                   if _bslug else esc(t))
        book_rows += (
            '    <li class="gb">\n'
            '      <span class="gb-t">' + _t_html + '</span>\n'
            + (('      <span class="gb-a">' + esc(binfo_c['author']) + '</span>\n')
               if binfo_c['author'] else '')
            + '      <span class="gb-w">' + who + '</span>\n'
            '    </li>\n'
        )

    # 다른 직업 모아보기로 가는 줄 — 아이돌만 보던 사람이 배우 쪽으로 넘어간다
    _sibling_links = ' · '.join(
        '<a href="' + EN_BASE + 'category/' + EN_ROLE_INFO[r]['hub'] + '.html">'
        + esc(EN_ROLE_INFO[r]['hub_name']) + '</a>'
        for r in sorted(EN_ROLE_HUBS, key=lambda x: -len(en_role_members.get(x, [])))
        if r != _role and en_role_members.get(r))

    n_people, n_books = len(members), len(cbooks)
    c_title = 'What ' + hub_name + ' Read — Books & Reading Lists'
    picks = [t for t, _ in ranked[:2]]
    c_desc = (str(n_people) + ' ' + hub_lower + ' and the ' + str(n_books)
              + ' books they have read or recommended'
              + ((', including ' + ' and '.join(picks)) if len(picks) == 2 else '')
              + '. Every entry keeps its source.')
    if len(c_desc) > 165:
        c_desc = (str(n_people) + ' ' + hub_lower + ' and the ' + str(n_books)
                  + ' books they have read or recommended, each traced to the interview, '
                  'video or post it came from.')

    c_ld = clean_none({
        '@context': 'https://schema.org',
        '@type': 'CollectionPage',
        'name': c_title,
        'url': curl,
        'inLanguage': 'en',
        'description': c_desc,
        'isPartOf': {'@type': 'WebSite', 'name': 'Favorbook', 'url': EN_BASE},
        'hasPart': {
            '@type': 'ItemList',
            'name': hub_name + ' in this archive',
            'numberOfItems': n_people,
            'itemListElement': [
                {'@type': 'ListItem', 'position': i + 1,
                 'item': {'@type': 'Person', 'name': plain_en(m[1]),
                          'jobTitle': info_r['label'],
                          'url': EN_BASE + 'share/' + m[0] + '.html'}}
                for i, m in enumerate(members)
            ],
        },
    })
    c_breadcrumb = {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        'itemListElement': [
            {'@type': 'ListItem', 'position': 1, 'name': 'Home', 'item': EN_BASE},
            {'@type': 'ListItem', 'position': 2, 'name': hub_name, 'item': curl},
        ],
    }

    page = (
        '<!DOCTYPE html>\n'
        '<html lang="en">\n'
        '<head>\n' + GA_TAG +
        '  <meta charset="utf-8">\n'
        '  <meta name="viewport" content="width=device-width, initial-scale=1">\n'
        '  <title>' + esc(c_title) + ' | Favorbook</title>\n'
        '  <meta name="description" content="' + esc(c_desc) + '">\n'
        '  <meta name="keywords" content="'
        + esc(', '.join(info_r['kw'] + ['korean celebrity books', 'books from korea',
                                        'what korean stars read'])) + '">\n'
        '  <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1">\n'
        '  <meta property="og:title" content="' + esc(c_title) + '">\n'
        '  <meta property="og:description" content="' + esc(c_desc) + '">\n'
        '  <meta property="og:url" content="' + esc(curl) + '">\n'
        '  <meta property="og:type" content="website">\n'
        '  <meta property="og:locale" content="en_US">\n'
        '  <meta property="og:site_name" content="Favorbook">\n'
        '  <meta property="og:image" content="' + BASE + 'og-image.jpg">\n'
        '  <meta name="twitter:card" content="summary_large_image">\n'
        '  <link rel="canonical" href="' + esc(curl) + '">\n'
        '  <link rel="icon" href="' + BASE + 'favicon.svg" type="image/svg+xml">\n'
        '  <script type="application/ld+json">\n  '
        + json.dumps(c_ld, ensure_ascii=False, indent=2) + '\n  </script>\n'
        '  <script type="application/ld+json">\n  '
        + json.dumps(c_breadcrumb, ensure_ascii=False, indent=2) + '\n  </script>\n'
        '  <style>\n'
        '    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; max-width: 860px; margin: 0 auto; padding: 20px; color: #222; line-height: 1.6; background: #fcfaf5; }\n'
        '    a { color: #2563eb; text-decoration: none; }\n'
        '    a:hover { text-decoration: underline; }\n'
        '    nav { margin: 8px 0 16px; font-size: 13px; }\n'
        '    h1 { font-size: 27px; margin: 0 0 8px; font-weight: 900; line-height: 1.25; }\n'
        '    h2 { font-size: 19px; margin: 32px 0 12px; padding-bottom: 4px; border-bottom: 2px solid #000; font-weight: 800; }\n'
        '    .lead { background: #fff; border: 2px solid #000; box-shadow: 4px 4px 0 0 #000; padding: 14px 16px; margin: 14px 0 6px; font-size: 15px; }\n'
        '    .lead p { margin: 0 0 8px; }\n'
        '    .lead p:last-child { margin-bottom: 0; }\n'
        '    .members { list-style: none; padding: 0; margin: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(116px, 1fr)); gap: 12px; }\n'
        '    .gm a { display: block; color: #000; text-align: center; }\n'
        '    .gm a:hover { text-decoration: none; }\n'
        '    .gm img { width: 100%; aspect-ratio: 1/1; object-fit: cover; border: 2px solid #000; box-shadow: 2px 2px 0 0 #000; display: block; background: #f4f4f0; }\n'
        '    .gm-n { display: block; font-weight: 800; font-size: 13px; margin-top: 6px; line-height: 1.25; }\n'
        '    .gm-c { display: block; font-size: 11px; color: #666; }\n'
        '    .gb { background: #fff; border: 2px solid #000; box-shadow: 3px 3px 0 0 #000; padding: 10px 12px; margin-bottom: 10px; list-style: none; }\n'
        '    .gb-t { display: block; font-weight: 800; font-size: 15px; line-height: 1.3; }\n'
        '    .gb-a { display: block; font-size: 12px; color: #555; }\n'
        '    .gb-w { display: block; font-size: 12px; color: #2563eb; margin-top: 3px; }\n'
        '    .books { padding: 0; margin: 0; }\n'
        '    .cat-links { font-size: 13px; margin-top: 18px; }\n'
        '    footer { margin-top: 40px; padding-top: 16px; border-top: 2px solid #000; font-size: 12px; color: #666; }\n'
        '  </style>\n'
        '</head>\n'
        '<body>\n'
        '  <nav><a href="' + EN_BASE + '">← Favorbook</a></nav>\n'
        '  <h1>What ' + esc(hub_name) + ' Read</h1>\n'
        '  <div class="lead">\n'
        '    <p>Book recommendations and full reading lists from <strong>' + str(n_people)
        + ' ' + esc(hub_lower) + '</strong> — ' + str(n_books)
        + ' books in all'
        + ((', ' + str(len(shared)) + ' of them read by more than one person') if shared else '')
        + '. Each entry links to the interview, YouTube video or SNS post it came from.</p>\n'
        + ('    <p>These are Korean stars, so most of the books are Korean editions. '
           'Where an official English translation exists it is shown; otherwise the Korean '
           'title is kept next to a working translation so you can search for it directly.</p>\n')
        + '  </div>\n'
        + (('  <p class="cat-links">Also in this archive: ' + _sibling_links + '</p>\n')
           if _sibling_links else '')
        + '  <h2>' + esc(hub_name) + ' in this archive (' + str(n_people) + ')</h2>\n'
        '  <ul class="members">\n' + person_cards +
        '  </ul>\n'
        '  <h2>Books ' + esc(hub_lower) + ' have read</h2>\n'
        '  <ul class="books">\n' + book_rows +
        '  </ul>\n'
        + (('  <p>Showing the ' + str(min(40, len(ranked))) + ' most shared of '
            + str(n_books) + ' books. Open a name above for a full reading list.</p>\n')
           if len(ranked) > 40 else '')
        + '  <footer>\n'
        '    <p>Curated from public Korean-language sources. '
        '<a href="' + EN_BASE + '">Browse every Korean celebrity in the archive →</a></p>\n'
        '  </footer>\n'
        '</body>\n'
        '</html>'
    )
    write_if_changed('en/category/' + cslug + '.html', page)
    en_category_pages.append((cslug, _role, n_people, n_books))

print(f"✅ /en/category/ 직업 페이지: {len(en_category_pages)}개")


# /en/index.html — 영문 랜딩 페이지 (메인 한국어 사이트와 동일한 Tailwind/Neo 디자인)
en_celeb_pages.sort(key=lambda x: x[1].lower())  # name_en 알파벳 정렬

# 셀럽 카드 (사진 + 이름 + 책 권수). 책 권수는 영문 책만 카운트.
en_celeb_cards = []
for slug, name_en, name_ko in en_celeb_pages:
    info = celebs[name_ko]
    en_book_count = sum(1 for b in info['books'] if b.get('title_en'))
    img = info['img']
    en_celeb_cards.append(
        '    <a href="share/' + slug + '.html" id="celeb-card-' + slug + '" data-celeb-card '
        'data-q="' + esc((name_en + ' ' + name_ko).lower()) + '" class="group flex flex-col">\n'
        '      <div class="aspect-square overflow-hidden border-2 border-ink shadow-neo-sm bg-white group-hover:shadow-neo group-hover:-translate-y-0.5 transition-all">\n'
        '        <img src="' + esc(img) + '" alt="' + esc(name_en) + ' profile" loading="lazy" '
        'class="w-full h-full object-cover" referrerpolicy="no-referrer">\n'
        '      </div>\n'
        '      <div class="mt-2">\n'
        '        <p class="font-black text-sm md:text-base leading-tight word-break-keep">' + esc(name_en) + '</p>\n'
        '        <p class="font-sans text-[10px] md:text-xs text-muted">' + esc(name_ko) + ' · '
        + str(en_book_count) + ' book' + ('s' if en_book_count != 1 else '') + '</p>\n'
        '      </div>\n'
        '    </a>'
    )
en_celeb_grid = '\n'.join(en_celeb_cards)

# 셀럽 검색용: 영문명 → (slug, 영문명) 매핑. 책 검색 결과에서 '누가 읽었는지' 보여줄 때 쓴다.
en_celeb_by_ko = {name_ko: (slug, name_en) for slug, name_en, name_ko in en_celeb_pages}

# 책 카드 (커버 + 제목 + 셀럽 수) + 책 검색용 데이터 (제목으로 검색하면 읽은 사람을 보여준다)
en_book_cards = []
en_search_books = []
for slug, t_en, t_ko in sorted(en_book_pages, key=lambda x: x[1].lower()):
    binfo = book_celebs[t_ko]
    cover = binfo.get('coverUrl', '')
    cover_img = ''
    if cover and cover.startswith('http'):
        cover_img = ('<img src="' + esc(cover) + '" alt="' + esc(t_en) + ' cover" loading="lazy" '
                     'class="w-full h-full object-cover">')
    n_celebs = len(binfo['celebs'])
    book_readers_en = [
        {'name': en_celeb_by_ko[c][1], 'slug': en_celeb_by_ko[c][0]}
        for c in binfo['celebs'] if c in en_celeb_by_ko
    ]
    en_search_books.append({
        'title': t_en, 'title_ko': t_ko, 'slug': slug,
        'cover': cover if cover.startswith('http') else '',
        'readers': book_readers_en,
    })
    en_book_cards.append(
        '    <a href="share/book/' + slug + '.html" data-q="'
        + esc((t_en + ' ' + t_ko).lower()) + '" class="group flex flex-col">\n'
        '      <div class="aspect-[3/4] overflow-hidden border-2 border-ink shadow-neo-sm bg-paper-dark group-hover:shadow-neo group-hover:-translate-y-0.5 transition-all">\n'
        '        ' + cover_img + '\n'
        '      </div>\n'
        '      <div class="mt-2">\n'
        '        <p class="font-black text-xs md:text-sm leading-tight word-break-keep">' + esc(t_en) + '</p>\n'
        '        <p class="font-sans text-[10px] text-muted">' + esc(t_ko) + ' · '
        + str(n_celebs) + ' celebs</p>\n'
        '      </div>\n'
        '    </a>'
    )
en_book_grid = '\n'.join(en_book_cards)


# /en/ 허브에 얹을 '그룹으로 찾기' 칸. 사람 이름을 모르는 해외 방문자는
# 그룹부터 찾으므로 목록으로 들어가는 문을 하나 더 둔다.
en_group_chips = '\n'.join(
    '    <a href="group/' + gslug + '.html" class="flex flex-col justify-between border-2 border-ink '
    'bg-white shadow-neo-sm hover:shadow-neo hover:-translate-y-0.5 transition-all px-3 py-2.5">\n'
    '      <span class="font-black text-sm md:text-base leading-tight word-break-keep">' + esc(group) + '</span>\n'
    '      <span class="font-sans text-[10px] md:text-xs text-muted">' + str(n_m) + ' members · '
    + str(n_b) + ' books</span>\n'
    '    </a>'
    for gslug, group, n_m, n_b in sorted(en_group_pages, key=lambda g: (-g[2], g[1].lower()))
)

# 직업으로 찾는 문 — "korean actors", "k-drama stars"로 들어온 사람이
# 아이돌 목록만 보고 되돌아가지 않게 한다.
en_category_chips = '\n'.join(
    '    <a href="category/' + cslug + '.html" class="flex flex-col justify-between border-2 border-ink '
    'bg-white shadow-neo-sm hover:shadow-neo hover:-translate-y-0.5 transition-all px-3 py-2.5">\n'
    '      <span class="font-black text-sm md:text-base leading-tight word-break-keep">'
    + esc(EN_ROLE_INFO[role]['hub_name']) + '</span>\n'
    '      <span class="font-sans text-[10px] md:text-xs text-muted">' + str(n_p) + ' people · '
    + str(n_b) + ' books</span>\n'
    '    </a>'
    for cslug, role, n_p, n_b in sorted(en_category_pages, key=lambda c: -c[2])
)

# 해외 방문자가 실제로 치는 문장들. 사람 이름을 모른 채 "what do kpop idols
# read" 처럼 물어보는 검색이 많은데, 그 말에 답하는 문장이 사이트에 한 줄도
# 없었다. 눈에 보이는 본문으로 넣고 FAQPage로도 표시해 둔다.
EN_FAQ = [
    ('What books do K-pop idols read?',
     'Across ' + str(len(en_celeb_pages)) + ' idols and actors in this archive, the books that come up '
     'most are Korean literary fiction and essays — Kim Ae-ran, Baek Se-hee, Kim Cho-yeop — '
     'alongside translated classics like Demian and The Unbearable Lightness of Being. '
     'Every reading list on this site is built from a source you can open and check yourself.'),
    ('What do K-drama and K-movie actors read?',
     'Korean actors turn up here as often as idols — '
     + str(sum(n_p for _c, r, n_p, _b in en_category_pages if r == 'actor'))
     + ' of them so far. Their picks lean towards Korean literary fiction, essays and '
     'scripts, and each one is linked to the interview or video where they talked about it. '
     'The K-Drama & K-Movie Actors page collects every one of those reading lists in one place.'),
    ('Where do these book recommendations come from?',
     'From public Korean-language sources only: interviews, YouTube and V Live clips, variety shows, '
     'fan-cafe posts and Instagram stories. A book is added only when the mention can be linked, '
     'and each entry keeps that link. Nothing is inferred from rumours or fan speculation.'),
    ('Can I see the books by group instead of by person?',
     'Yes. The Browse by Group section above opens a page per group — '
     + ', '.join(g for _, g, _, _ in sorted(en_group_pages, key=lambda g: -g[2])[:4])
     + ' and more — showing every member side by side and which books more than one member has read.'),
    ('Are the books available in English?',
     'Many are. Korean titles are shown with the published English title when one exists. '
     'Where no official English edition was confirmed, the title is machine-translated and marked '
     'with an asterisk, with the Korean original shown next to it so you can search for it directly.'),
    ('How often is the archive updated?',
     'New entries are added as idols mention books, usually a few times a month. '
     'The Korean site carries the full archive of ' + str(len(celebs)) + ' people; '
     'English pages are published for the ones whose names and book titles have been checked.'),
]

en_faq_html = '\n'.join(
    '      <details class="border-2 border-ink bg-white shadow-neo-sm px-4 py-3">\n'
    '        <summary class="font-black text-sm md:text-base cursor-pointer word-break-keep">'
    + esc(q) + '</summary>\n'
    '        <p class="text-sm font-bold leading-relaxed text-muted mt-2 word-break-keep">'
    + esc(a) + '</p>\n'
    '      </details>'
    for q, a in EN_FAQ
)

en_faq_jsonld = json.dumps({
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    'mainEntity': [
        {'@type': 'Question', 'name': q,
         'acceptedAnswer': {'@type': 'Answer', 'text': a}}
        for q, a in EN_FAQ
    ],
}, ensure_ascii=False, indent=2)

en_index_show_tr_note = has_auto_translated(
    *[title_en for _, title_en, _ in en_book_pages],
)

en_index_jsonld = json.dumps({
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    'name': 'Favorbook',
    'alternateName': ['Favorbook English', 'K-pop Idol Books', 'K-Drama Actor Books',
                      'Korean Celebrity Book Archive'],
    'url': EN_BASE,
    'description': 'What Korean stars are reading — K-pop idols (BTS, IVE, SEVENTEEN, NewJeans), K-drama and K-movie actors, directors and musicians, with the interview, YouTube or SNS source behind every book.',
    'image': BASE + 'og-image.jpg',
    'inLanguage': 'en-US',
}, ensure_ascii=False, indent=2)

en_index = (
    '<!DOCTYPE html>\n'
    '<html lang="en">\n'
    '<head>\n' + GA_TAG +
    '  <meta charset="UTF-8">\n'
    '  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n'
    '  <title>What K-pop Idols &amp; K-Drama Actors Read — Korean Star Book Archive | Favorbook</title>\n'
    '  <meta name="description" content="A searchable archive of what Korean stars read — K-pop idols (BTS, aespa, IVE, NewJeans), K-drama and K-movie actors, directors and musicians. Every book traced to its source.">\n'
    '  <meta name="keywords" content="korean celebrity books, korean actor books, k-drama actor books, k-movie actor books, what korean actors read, korean drama star reading list, kdrama books, korean actress books, korean film director books, korean star book recommendations, books from korea, kpop idol books, what bts reads, BTS reading list, RM book recommendations, IU books, what kpop idols read, kpop star reading, korean celebrity books, k-drama actor books, IVE books, NewJeans reading list, SEVENTEEN books, kpop idol favorite books, korean idol book recommendations, kpop reading list, books read by kpop idols, korean drama actor reading list, kdrama books, kpop fandom books, kpop star book archive, kpop star reading, kpop idol reading list, korean celebrity reading archive, what do kpop idols read">\n'
    '  <meta name="referrer" content="no-referrer">\n'
    '\n'
    '  <link rel="icon" href="' + BASE + 'favicon.svg" type="image/svg+xml">\n'
    '  <link rel="icon" href="' + BASE + 'favicon.png" type="image/png" sizes="192x192">\n'
    '  <link rel="apple-touch-icon" href="' + BASE + 'favicon.png">\n'
    '\n'
    '  <meta property="og:site_name" content="Favorbook">\n'
    '  <meta property="og:title" content="What K-pop Idols &amp; K-Drama Actors Read | Favorbook">\n'
    '  <meta property="og:description" content="A searchable archive of what Korean stars read — K-pop idols, K-drama and K-movie actors, directors and musicians, with a source for every book.">\n'
    '  <meta property="og:type" content="website">\n'
    '  <meta property="og:url" content="' + EN_BASE + '">\n'
    '  <meta property="og:image" content="' + BASE + 'og-image.jpg">\n'
    '  <meta property="og:image:width" content="1200">\n'
    '  <meta property="og:image:height" content="630">\n'
    '  <meta property="og:image:alt" content="Favorbook — what K-pop idols, K-drama actors and Korean celebrities are reading">\n'
    '  <meta property="og:locale" content="en_US">\n'
    '  <meta property="og:locale:alternate" content="ko_KR">\n'
    '\n'
    '  <meta name="twitter:card" content="summary_large_image">\n'
    '  <meta name="twitter:title" content="What K-pop Idols &amp; K-Drama Actors Read | Favorbook">\n'
    '  <meta name="twitter:description" content="The Korean star book archive — reading lists from K-pop idols, K-drama and K-movie actors, directors and musicians.">\n'
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
    '  <link rel="alternate" type="application/rss+xml" title="Favorbook RSS" href="' + BASE + 'feed.xml">\n'
    '\n'
    '\n'
    '  <script type="application/ld+json">\n  ' + en_index_jsonld + '\n  </script>\n'
    '  <script type="application/ld+json">\n  ' + en_faq_jsonld + '\n  </script>\n'
    '\n'
    '  <script src="https://cdn.tailwindcss.com"></script>\n'
    '  <link rel="stylesheet" href="' + BASE + 'assets/fonts/space-grotesk.css">\n'
    '  <link rel="stylesheet" href="' + BASE + 'assets/fonts/kopubworld.css">\n'
    '\n'
    '  <script>\n'
    '    tailwind.config = {\n'
    '      theme: {\n'
    '        extend: {\n'
    '          fontFamily: {\n'
    '            serif: [\'"KoPubWorld Batang"\', \'serif\'],\n'
    '            sans:  [\'"Space Grotesk"\', \'"KoPubWorld Dotum"\', \'sans-serif\'],\n'
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
    '\n'
    '    /* Scroll-spy tabs (Neo-brutalism) */\n'
    '    .spy-tab {\n'
    '      display: inline-block; padding: 6px 10px;\n'
    '      background: #fff; border: 2px solid #000;\n'
    '      box-shadow: 2px 2px 0 0 #000;\n'
    '      font-family: \'Space Grotesk\', sans-serif;\n'
    '      font-weight: 700; font-size: 11px; letter-spacing: .05em;\n'
    '      text-decoration: none; color: #000; white-space: nowrap;\n'
    '      transition: transform .1s, box-shadow .1s, background .1s;\n'
    '      flex-shrink: 0;\n'
    '    }\n'
    '    .spy-tab:hover { transform: translate(-1px,-1px); box-shadow: 3px 3px 0 0 #000; background: #fde047; }\n'
    '    .spy-tab.active { background: #000; color: #fff; }\n'
    '    @media (min-width: 768px) { #side-tabs .spy-tab { min-width: 64px; text-align: center; } }\n'
    '    .scrollbar-hide::-webkit-scrollbar { display: none; }\n'
    '    .scrollbar-hide { -ms-overflow-style: none; scrollbar-width: none; }\n'
    '    @media (max-width: 767px) {\n'
    '      #hero, #about, #celebs, #books { scroll-margin-top: 60px; }\n'
    '    }\n'
    '  </style>\n'
    '</head>\n'
    '<body class="font-serif relative selection:bg-neo-yellow selection:text-ink">\n'
    '\n'
    '<!-- Scroll-spy 사이드 탭 (데스크탑) -->\n'
    '<nav id="side-tabs" class="hidden md:flex fixed left-4 lg:left-6 top-1/2 -translate-y-1/2 z-30 flex-col gap-2 pointer-events-auto">\n'
    '  <a href="#hero" data-spy="hero" class="spy-tab active">Home</a>\n'
    '  <a href="#about" data-spy="about" class="spy-tab">About</a>\n'
    '  <a href="#search" data-spy="search" class="spy-tab">Search</a>\n'
    '  <a href="#celebs" data-spy="celebs" class="spy-tab">Celebs</a>\n'
    '  <a href="#books" data-spy="books" class="spy-tab">Books</a>\n'
    '</nav>\n'
    '\n'
    '<!-- Scroll-spy 가로 탭 (모바일) -->\n'
    '<nav id="top-tabs" class="md:hidden sticky top-0 z-30 bg-paper border-b-2 border-ink">\n'
    '  <div class="flex overflow-x-auto gap-2 px-3 py-2 scrollbar-hide">\n'
    '    <a href="#hero" data-spy="hero" class="spy-tab active">Home</a>\n'
    '    <a href="#about" data-spy="about" class="spy-tab">About</a>\n'
    '    <a href="#search" data-spy="search" class="spy-tab">Search</a>\n'
    '    <a href="#celebs" data-spy="celebs" class="spy-tab">Celebs</a>\n'
    '    <a href="#books" data-spy="books" class="spy-tab">Books</a>\n'
    '  </div>\n'
    '</nav>\n'
    '\n'
    '<main class="max-w-5xl mx-auto px-4 sm:px-6 py-12 md:py-24 flex flex-col gap-12 md:gap-16">\n'
    '\n'
    '  <header id="hero" class="flex flex-col items-center pt-6 md:pt-0 text-center">\n'
    '    <h1 class="text-4xl sm:text-5xl md:text-6xl font-black tracking-tight mb-3 text-ink">Favorbook</h1>\n'
    '    <p class="text-ink font-sans font-bold text-sm sm:text-base tracking-wide mb-3">What your fave K-pop idol or K-drama actor is reading📕</p>\n'
    '    <p class="text-muted text-xs sm:text-sm mb-6 max-w-xl mx-auto px-4 word-break-keep">Verified reading lists from Korean stars — K-pop idols (BTS, IVE, NewJeans, SEVENTEEN), K-drama and K-movie actors, film directors and musicians — sourced from interviews, YouTube, and SNS.</p>\n'
    '    <p class="text-ink font-sans font-bold text-xs sm:text-sm tracking-[.15em] mb-6 uppercase bg-neo-yellow border-2 border-ink px-4 py-1 shadow-neo-sm">Archive of their reads</p>\n'
    '    <div class="flex items-center gap-2 text-[10px] sm:text-xs font-sans font-bold tracking-wider text-ink border-2 border-ink bg-white px-3 py-1.5 shadow-neo-sm">\n'
    '      <span class="w-2 h-2 rounded-full bg-ink"></span>\n'
    '      <span>' + str(len(en_celeb_pages)) + ' RECORDS</span>\n'
    '    </div>\n'
    '    <div class="flex gap-2 mt-5">\n'
    '      <a href="' + BASE + '" hreflang="ko" class="px-4 py-1.5 bg-white border-2 border-ink shadow-neo-sm hover:bg-neo-yellow hover:-translate-y-0.5 transition-all font-sans font-bold text-xs tracking-widest text-ink">KOR</a>\n'
    '      <span class="px-4 py-1.5 bg-ink text-paper border-2 border-ink shadow-neo-sm font-sans font-bold text-xs tracking-widest">ENG</span>\n'
    '    </div>\n'
    '  </header>\n'
    '\n'
    '  <section id="about" class="text-center max-w-2xl mx-auto border-4 border-ink p-6 md:p-8 bg-white shadow-neo w-full">\n'
    '    <h2 class="text-xl md:text-2xl font-black mb-4 bg-neo-pink inline-block px-3 py-1 border-2 border-ink shadow-neo-sm">What is Favorbook?</h2>\n'
    '    <p class="text-sm md:text-base font-bold leading-relaxed text-ink word-break-keep mb-3">\n'
    '      Favorbook is a <strong>book archive for Korean stars</strong>. From K-pop idols like '
    '<strong>BTS, aespa, SEVENTEEN, IVE and NewJeans</strong> to <strong>K-drama and K-movie '
    'actors</strong>, film directors and musicians, it collects the books they have read, '
    'recommended, or called life-changing — and keeps the receipt for each one.\n'
    '    </p>\n'
    '    <p class="text-sm md:text-base font-bold leading-relaxed text-ink word-break-keep mb-3">\n'
    '      Korean idols and actors talk about books constantly — in live streams, in fan letters, '
    'in drama press conferences, in variety shows — but those mentions scatter across '
    'Korean-language clips and posts that never reach international fans. '
    'Every entry here is traced back to the interview, YouTube video or SNS post where the book came up, '
    'so you can read what they read instead of guessing.\n'
    '    </p>\n'
    '    <p class="text-sm md:text-base font-bold leading-relaxed text-ink word-break-keep">\n'
    '      Only entries with verified sources (YouTube, interviews, SNS) are listed.<br>\n'
    '      Names follow <a href="https://kpop.fandom.com/" target="_blank" rel="noopener" class="underline decoration-2">Kpop Wiki</a> / <a href="https://www.imdb.com/" target="_blank" rel="noopener" class="underline decoration-2">IMDb</a> conventions.\n'
    '    </p>\n'
    + ('    <p class="text-xs sm:text-sm font-bold leading-relaxed text-muted word-break-keep mt-4 pt-3 border-t-2 border-ink/20">\n'
       '      ' + EN_TR_NOTE_TEXT + '\n'
       '    </p>\n' if en_index_show_tr_note else '')
    + '  </section>\n'
    '\n'
    + '  <section id="search" class="max-w-xl mx-auto w-full flex flex-col gap-4">\n'
    '    <h2 class="text-2xl md:text-3xl font-black text-center word-break-keep">Search</h2>\n'
    '    <input id="en-search-input" type="text" autocomplete="off" placeholder="Search a name or book title…" '
    'class="w-full border-2 border-ink bg-white shadow-neo-sm px-4 py-3 font-bold text-sm md:text-base '
    'focus:outline-none focus:shadow-neo focus:-translate-y-0.5 transition-all">\n'
    '    <div id="en-search-bar" class="hidden flex items-center justify-center gap-3 flex-wrap">\n'
    '      <span id="en-search-summary" class="font-sans font-bold text-[11px] sm:text-xs tracking-wide text-muted"></span>\n'
    '      <button type="button" id="en-search-clear" class="font-sans font-bold text-[10px] sm:text-xs '
    'tracking-widest uppercase border-2 border-ink bg-white hover:bg-neo-pink shadow-neo-sm px-4 py-1.5 '
    'hover:-translate-y-0.5 transition-all">✕ Show all</button>\n'
    '    </div>\n'
    '    <div id="en-book-hits" class="hidden flex flex-col gap-3"></div>\n'
    '  </section>\n'
    '\n'
    '  <script type="application/json" id="en-search-books-data">' + json.dumps(en_search_books, ensure_ascii=False) + '</script>\n'
    '\n'
    + (('  <section id="categories" class="w-full">\n'
        '    <h2 class="text-2xl md:text-3xl font-black mb-2 word-break-keep">Browse by Type</h2>\n'
        '    <p class="text-sm md:text-base font-bold text-muted mb-8 word-break-keep">'
        'K-pop idols, K-drama and K-movie actors, musicians — each with their own reading lists.</p>\n'
        '    <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 md:gap-4">\n'
        + en_category_chips + '\n'
        '    </div>\n'
        '  </section>\n\n') if en_category_pages else '')
    + (('  <section id="groups" class="w-full">\n'
        '    <h2 class="text-2xl md:text-3xl font-black mb-2 word-break-keep">Browse by Group</h2>\n'
        '    <p class="text-sm md:text-base font-bold text-muted mb-8 word-break-keep">'
        'Reading lists for every member, side by side (' + str(len(en_group_pages)) + ' groups).</p>\n'
        '    <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 md:gap-4">\n'
        + en_group_chips + '\n'
        '    </div>\n'
        '  </section>\n\n') if en_group_pages else '')
    + ('  <section id="celebs" class="w-full">\n'
       '    <h2 class="text-2xl md:text-3xl font-black mb-2 word-break-keep">Browse Celebrities (' + str(len(en_celeb_pages)) + ')</h2>\n'
       '    <p class="text-sm md:text-base font-bold text-muted mb-8 word-break-keep">Click a card to see their full reading list.</p>\n'
       '    <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-4 sm:gap-x-6 gap-y-8 sm:gap-y-12">\n'
       + en_celeb_grid + '\n'
       '    </div>\n'
       '  </section>\n\n' if en_celeb_cards
       else '  <section class="border-t-4 border-ink pt-12 md:pt-16 text-center">\n'
       '    <p class="font-bold text-muted">No English profiles available yet. <a href="' + BASE + '" hreflang="ko" class="underline decoration-2 hover:text-ink">Browse the full Korean archive →</a></p>\n'
       '  </section>\n\n')
    + ('  <section id="books" class="border-t-4 border-ink pt-12 md:pt-16 w-full">\n'
       '    <h2 class="text-2xl md:text-3xl font-black mb-2 word-break-keep">Books Read by 2+ Celebrities</h2>\n'
       '    <p class="text-sm md:text-base font-bold text-muted mb-8 word-break-keep">Titles that appear across multiple reading lists (' + str(len(en_book_pages)) + ' books).</p>\n'
       '    <div class="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-4 md:gap-5">\n'
       + en_book_grid + '\n'
       '    </div>\n'
       '  </section>\n\n' if en_book_cards else '')
    + '  <section id="faq" class="border-t-4 border-ink pt-12 md:pt-16 w-full">\n'
    '    <h2 class="text-2xl md:text-3xl font-black mb-8 word-break-keep">Questions people ask</h2>\n'
    '    <div class="flex flex-col gap-3 max-w-3xl">\n'
    + en_faq_html + '\n'
    '    </div>\n'
    '  </section>\n\n'
    + '  <footer class="border-t-4 border-ink pt-8 text-center font-sans text-xs text-muted">\n'
    '    <p>An English gateway to <a href="' + BASE + '" hreflang="ko" class="underline decoration-2 hover:text-ink">최애의 독서</a> — full archive of <strong>' + str(len(celebs)) + ' Korean celebrities</strong> in Korean.</p>\n'
    '  </footer>\n'
    '\n'
    '</main>\n'
    '\n'
    '<script>\n'
    '(function() {\n'
    '  const searchInput = document.getElementById("en-search-input");\n'
    '  if (!searchInput) return;\n'
    '  const celebCards = Array.from(document.querySelectorAll("[data-celeb-card]"));\n'
    '  const searchBar = document.getElementById("en-search-bar");\n'
    '  const searchSummary = document.getElementById("en-search-summary");\n'
    '  const clearBtn = document.getElementById("en-search-clear");\n'
    '  const bookHits = document.getElementById("en-book-hits");\n'
    '  const celebSection = document.getElementById("celebs");\n'
    '  const booksData = JSON.parse(document.getElementById("en-search-books-data").textContent);\n'
    '\n'
    '  function renderBookHits(query) {\n'
    '    const matches = booksData.filter(b =>\n'
    '      (b.title + " " + b.title_ko).toLowerCase().includes(query)\n'
    '    );\n'
    '    if (!matches.length) { bookHits.classList.add("hidden"); bookHits.innerHTML = ""; return; }\n'
    '    bookHits.innerHTML = matches.map(b => {\n'
    '      const readers = b.readers.length\n'
    '        ? b.readers.map(r => `<a href="share/${r.slug}.html" class="underline decoration-2 hover:text-ink">${r.name}</a>`).join(", ")\n'
    '        : "";\n'
    '      const cover = b.cover ? `<img src="${b.cover}" alt="${b.title} cover" loading="lazy" class="w-12 h-16 object-cover border-2 border-ink flex-shrink-0">` : "";\n'
    '      const titleHtml = `<p class="font-black text-sm word-break-keep">${b.title}</p>`;\n'
    '      const readersHtml = readers ? `<p class="font-sans text-xs text-muted mt-1">Read by: ${readers}</p>` : "";\n'
    '      return `<div class="flex gap-3 items-start border-2 border-ink bg-white shadow-neo-sm p-3">${cover}<div>${titleHtml}${readersHtml}</div></div>`;\n'
    '    }).join("");\n'
    '    bookHits.classList.remove("hidden");\n'
    '  }\n'
    '\n'
    '  function filterCelebs(query) {\n'
    '    let shown = 0;\n'
    '    celebCards.forEach(card => {\n'
    '      const match = !query || card.dataset.q.includes(query);\n'
    '      card.classList.toggle("hidden", !match);\n'
    '      if (match) shown++;\n'
    '    });\n'
    '    return shown;\n'
    '  }\n'
    '\n'
    '  function onSearch() {\n'
    '    const query = searchInput.value.trim().toLowerCase();\n'
    '    if (!query) {\n'
    '      searchBar.classList.add("hidden");\n'
    '      bookHits.classList.add("hidden");\n'
    '      filterCelebs("");\n'
    '      return;\n'
    '    }\n'
    '    const shown = filterCelebs(query);\n'
    '    renderBookHits(query);\n'
    '    searchBar.classList.remove("hidden");\n'
    '    searchSummary.textContent = shown + " celeb" + (shown === 1 ? "" : "s") + " match";\n'
    '    celebSection.scrollIntoView({ behavior: "smooth", block: "start" });\n'
    '  }\n'
    '\n'
    '  searchInput.addEventListener("input", onSearch);\n'
    '  clearBtn.addEventListener("click", () => {\n'
    '    searchInput.value = "";\n'
    '    onSearch();\n'
    '  });\n'
    '})();\n'
    '</script>\n'
    '\n'
    '<script>\n'
    '(function() {\n'
    '  const ids = ["hero", "about", "search", "categories", "groups", "celebs", "books", "faq"];\n'
    '  const sections = ids.map(id => document.getElementById(id)).filter(Boolean);\n'
    '  const tabs = document.querySelectorAll(".spy-tab");\n'
    '  if (!sections.length || !tabs.length) return;\n'
    '  const setActive = (id) => tabs.forEach(t => t.classList.toggle("active", t.dataset.spy === id));\n'
    '  const observer = new IntersectionObserver((entries) => {\n'
    '    const visible = entries.filter(e => e.isIntersecting)\n'
    '      .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);\n'
    '    if (visible.length) setActive(visible[0].target.id);\n'
    '  }, { rootMargin: "-20% 0px -60% 0px", threshold: 0 });\n'
    '  sections.forEach(s => observer.observe(s));\n'
    '})();\n'
    '</script>\n'
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
    '<head>\n' + GA_TAG +
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
# 멤버가 빠져 1명이 된 그룹의 페이지도 같이 치운다
generated_en_group_paths = {'en/group/' + gslug + '.html' for gslug, _, _, _ in en_group_pages}
for f in os.listdir('en/group'):
    p = 'en/group/' + f
    if os.path.isfile(p) and f.endswith('.html') and p not in generated_en_group_paths:
        os.remove(p)
        removed += 1
generated_en_cat_paths = {'en/category/' + cslug + '.html' for cslug, _, _, _ in en_category_pages}
for f in os.listdir('en/category'):
    p = 'en/category/' + f
    if os.path.isfile(p) and f.endswith('.html') and p not in generated_en_cat_paths:
        os.remove(p)
        removed += 1
print(f"✅ 고아 share 파일 정리: {removed}개 삭제")

# ── 6.6. 짧은 공유 링크 파일 (/s/*.html, /s/b/*.html) ───────────────
#
# 원래 페이지의 <title>과 og:* 태그를 그대로 베껴 온다. 그래야 카카오톡·트위터
# 미리보기가 짧은 주소로 공유해도 똑같이 뜬다. og:url만 원래 주소로 덮어쓴다.
# noindex는 일부러 넣지 않는다 — canonical이 가리키는 쪽으로 noindex가 번질 수
# 있어서, 즉시 이동(meta refresh) + canonical 조합만 쓴다.

os.makedirs('s', exist_ok=True)
os.makedirs('s/b', exist_ok=True)

with io.open(SHORTLINK_FILE, 'w', encoding='utf-8') as f:
    json.dump(SHORTLINKS, f, ensure_ascii=False, indent=1, sort_keys=True)

_OG_RE = re.compile(r'<meta (?:property="og:|name="twitter:)[^"]+"[^>]*>')
_TITLE_RE = re.compile(r'<title>(.*?)</title>', re.S)
_OGURL_RE = re.compile(r'<meta property="og:url"[^>]*>')


def write_short_page(path, target, source_html):
    """원래 페이지로 곧장 넘기는 한 장짜리 파일."""
    m = _TITLE_RE.search(source_html)
    title = m.group(1) if m else '최애의 독서'
    # og:* 와 twitter:* 를 그대로 옮겨야 카카오톡·X 미리보기가 똑같이 뜬다
    og = [t for t in _OG_RE.findall(source_html) if not _OGURL_RE.match(t)]
    og.insert(0, '<meta property="og:url" content="' + esc(target) + '">')
    with io.open(path, 'w', encoding='utf-8') as f:
        f.write(
            '<!DOCTYPE html>\n<html lang="ko">\n<head>\n'
            '  <meta charset="UTF-8">\n'
            '  <title>' + title + '</title>\n'
            '  <link rel="canonical" href="' + esc(target) + '">\n'
            '  <meta http-equiv="refresh" content="0; url=' + esc(target) + '">\n'
            + ''.join('  ' + t + '\n' for t in og) +
            '  <script>location.replace(' + json.dumps(target) + ');</script>\n'
            '</head>\n<body>\n'
            '  <p><a href="' + esc(target) + '">' + title + '</a></p>\n'
            '</body>\n</html>\n')


short_written = 0
short_celeb_paths, short_book_paths = set(), set()

for _name in celebs.keys():
    _slug = SHORTLINKS['celeb'].get(_name)
    _src = 'share/' + safe_filename(_name) + '.html'
    if not _slug or not os.path.isfile(_src):
        continue
    with io.open(_src, encoding='utf-8') as f:
        _html = f.read()
    _p = 's/' + _slug + '.html'
    write_short_page(_p, make_celeb_url(_name), _html)
    short_celeb_paths.add(_p)
    short_written += 1

for _fn, _title in book_pages:
    _slug = SHORTLINKS['book'].get(_title)
    _src = 'share/book/' + _fn + '.html'
    if not _slug or not os.path.isfile(_src):
        continue
    with io.open(_src, encoding='utf-8') as f:
        _html = f.read()
    _p = 's/b/' + _slug + '.html'
    write_short_page(_p, make_book_url(_title), _html)
    short_book_paths.add(_p)
    short_written += 1

# 없어진 셀럽·책의 짧은 주소도 같이 치운다
_short_removed = 0
for _f in os.listdir('s'):
    _p = 's/' + _f
    if os.path.isfile(_p) and _f.endswith('.html') and _p not in short_celeb_paths:
        os.remove(_p)
        _short_removed += 1
for _f in os.listdir('s/b'):
    _p = 's/b/' + _f
    if os.path.isfile(_p) and _f.endswith('.html') and _p not in short_book_paths:
        os.remove(_p)
        _short_removed += 1

print(f"✅ 짧은 공유 링크: {short_written}개 생성"
      + (f", {_short_removed}개 삭제" if _short_removed else ""))


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
    '  <url>',
    '    <loc>' + BASE + 'together/</loc>',
    '    <lastmod>' + lastmod_for('together/index.html') + '</lastmod>',
    '    <changefreq>monthly</changefreq>',
    '    <priority>0.6</priority>',
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
    for cslug, _r, _np, _nb in en_category_pages:
        lines += [
            '  <url>',
            '    <loc>' + EN_BASE + 'category/' + cslug + '.html</loc>',
            '    <lastmod>' + lastmod_for('en/category/' + cslug + '.html') + '</lastmod>',
            '    <changefreq>weekly</changefreq>',
            '    <priority>0.7</priority>',
            '  </url>',
        ]
    for gslug, _g, _nm, _nb in en_group_pages:
        lines += [
            '  <url>',
            '    <loc>' + EN_BASE + 'group/' + gslug + '.html</loc>',
            '    <lastmod>' + lastmod_for('en/group/' + gslug + '.html') + '</lastmod>',
            '    <changefreq>weekly</changefreq>',
            '    <priority>0.6</priority>',
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
    # 원본 데이터 파일(data.json/data.csv)은 검색 노출용 콘텐츠가 아니라
    # 직접 수집·정리한 원자료이므로 대량 수집 방지 차원에서 색인/크롤링만 막는다.
    # 실제 콘텐츠 페이지(share/*.html 등)는 그대로 색인되므로 검색 결과에는 영향 없음.
    'Disallow: /data.json\n'
    'Disallow: /data.csv\n'
    'Disallow: /data/\n'
    'Disallow: /lookup_csv/\n'
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
        '      <description>' + esc_xml(', '.join(binfo['celebs'])) + '의 추천 도서입니다.</description>\n'
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
        '      <description>' + esc_xml(name) + '의 인생책·추천 도서 ' + str(len(info['books'])) + '권을 확인해 보세요.</description>\n'
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
