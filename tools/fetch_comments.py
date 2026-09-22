#!/usr/bin/env python3
"""출처를 읽고 책이 언급된 대목을 그대로 떠오는 배치. 모델도 API 키도 쓰지 않는다.

코멘트를 만드는 일은 두 단계다.

    1. 수집 — 출처에서 그 책 이야기가 나온 대목을 찾아 원문 그대로 옮긴다  ← 이 스크립트
    2. 작성 — 그 대목을 읽고 한국어·영어 한 줄로 옮긴다                   ← 사람 또는 Claude

기계가 잘하는 건 1번이다. 수백 개 출처를 열어 제목이 나오는 자리를 찾고
따옴표 안의 말을 끌어내는 일. 2번은 문장을 쓰는 일이라 사람 손이 낫고,
편집기에서 몇십 건씩 모아 처리하면 된다.

둘을 나누면 좋은 점이 하나 더 있다. quote 칸에 원문이 남으니, 검수할 때
출처를 일일이 열지 않아도 "이게 진짜 추천 이유인가"를 바로 판단할 수 있다.

    출처 URL ──(HTML 본문 / 유튜브 자막)──▶ 책 제목이 나온 문단
             ──▶ 그 안의 따옴표 발언 ──▶ data/comments.json 의 quote·context

만들어진 항목은 ko·en 이 비어 있고 status="pending" 이다. 문장을 채우고
승인해야 사이트에 나간다.

실행
    python3 tools/fetch_comments.py --limit 5 --dry-run
    python3 tools/fetch_comments.py

옵션
    --limit N        이번에 읽을 출처 수 (0=무제한)
    --dry-run        파일에 쓰지 않고 결과만 출력
    --refresh        지난번에 실패로 기록된 출처도 다시 조회
    --max-books N    한 출처가 N권 넘게 담고 있으면 건너뜀 (기본 3).
                     팬이 정리한 수십 권짜리 목록에는 애초에 이유가 없다
    --sleep SEC      출처 사이 대기 (기본 1.0)
"""
import argparse
import html
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_JSON = os.path.join(ROOT, 'data.json')
OUT_PATH = os.path.join(ROOT, 'data', 'comments.json')

UA = {'User-Agent': 'Mozilla/5.0 (compatible; favorbook-comments/1.0; +https://favorbook.co.kr)'}

# 로그인 벽이 있어 공개 크롤링이 막힌 곳. 넣어봐야 로그인 페이지만 받아온다.
BLOCKED_HOSTS = ('x.com', 'twitter.com', 'instagram.com', 'tiktok.com',
                 'facebook.com', 'weverse.io')


# ── 출처 받아오기 ────────────────────────────────────────────────────

def host_of(url):
    h = urllib.parse.urlparse(url).netloc.lower()
    for p in ('www.', 'm.'):
        if h.startswith(p):
            h = h[len(p):]
    return h


def http_get(url, timeout=20):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        raw = r.read()
    # 한국 매체는 EUC-KR이 아직 남아 있다. 헤더를 믿고, 없으면 utf-8 → cp949 순으로.
    charset = None
    m = re.search(rb'charset=["\']?([\w-]+)', raw[:4000], re.I)
    if m:
        charset = m.group(1).decode('ascii', 'ignore')
    for enc in (charset, 'utf-8', 'cp949'):
        if not enc:
            continue
        try:
            return raw.decode(enc)
        except (UnicodeDecodeError, LookupError):
            continue
    return raw.decode('utf-8', 'replace')


_TAG_RE = re.compile(r'<[^>]+>')
_DROP_RE = re.compile(r'<(script|style|noscript|svg)\b.*?</\1>', re.I | re.S)


def html_to_text(doc):
    doc = _DROP_RE.sub(' ', doc)
    doc = re.sub(r'<br\s*/?>|</(p|div|li|h\d|tr)>', '\n', doc, flags=re.I)
    text = html.unescape(_TAG_RE.sub(' ', doc))
    text = re.sub(r'[ \t ]+', ' ', text)
    return re.sub(r'\n\s*\n\s*\n+', '\n\n', text).strip()


_YT_ID_RE = re.compile(r'(?:v=|youtu\.be/|/shorts/|/embed/)([\w-]{11})')
_CAPTION_RE = re.compile(r'"captionTracks":(\[.*?\])')


def youtube_text(url):
    """영상 제목 + 설명 + 자막. 자막이 없으면 제목·설명만 돌려준다."""
    m = _YT_ID_RE.search(url)
    if not m:
        return None
    vid = m.group(1)
    page = http_get('https://www.youtube.com/watch?v=' + vid)

    parts = []
    t = re.search(r'<title>(.*?)</title>', page, re.S)
    if t:
        parts.append('[영상 제목] ' + html.unescape(t.group(1)).strip())
    d = re.search(r'"shortDescription":"(.*?)","', page, re.S)
    if d:
        parts.append('[영상 설명] ' + d.group(1).encode().decode('unicode_escape', 'ignore'))

    cm = _CAPTION_RE.search(page)
    if cm:
        try:
            tracks = json.loads(cm.group(1).encode().decode('unicode_escape'))
        except (ValueError, UnicodeDecodeError):
            tracks = []
        # 한국어 자막을 먼저, 없으면 아무거나.
        tracks.sort(key=lambda x: 0 if (x.get('languageCode') or '').startswith('ko') else 1)
        for tr in tracks[:1]:
            base = tr.get('baseUrl')
            if not base:
                continue
            try:
                xml = http_get(base)
            except (urllib.error.URLError, OSError):
                continue
            lines = [html.unescape(x) for x in re.findall(r'<text[^>]*>(.*?)</text>', xml, re.S)]
            if lines:
                # 자막은 문장 부호가 없어 통짜로 붙는다. 마침표 대신 줄로 끊어 읽히게 둔다.
                parts.append('[자막] ' + ' '.join(_TAG_RE.sub('', l).strip() for l in lines))
    return '\n\n'.join(parts) if parts else None


def fetch_source(url):
    """출처 한 건의 본문 텍스트. 못 받아오면 (None, 이유)."""
    h = host_of(url)
    if any(h == b or h.endswith('.' + b) for b in BLOCKED_HOSTS):
        return None, 'login-wall'
    try:
        if 'youtube.com' in h or 'youtu.be' in h:
            text = youtube_text(url)
            if not text:
                return None, 'no-captions'
            return text, None
        text = html_to_text(http_get(url))
        if len(text) < 200:
            return None, 'too-short'
        return text, None
    except urllib.error.HTTPError as e:
        return None, 'http-%d' % e.code
    except (urllib.error.URLError, OSError, ValueError) as e:
        return None, 'fetch-error: %s' % (e,)


# ── 언급된 대목 떠오기 ──────────────────────────────────────────────

# 추천 이유가 담긴 문장에 자주 붙는 말들. 점수가 높을수록 읽어볼 값어치가 있다.
CUES = ('인생책', '인생 책', '좋아', '좋았', '인상', '감명', '위로', '울림', '계기',
        '덕분', '추천', '꼽았', '꼽은', '꼽는', '읽고', '읽으며', '읽었', '다시 읽',
        '여러 번', '배웠', '생각하게', '공감', '영향', '와닿', '빠져', '아끼는',
        '눈물', '마음', '힘을', '힘이', '처음', '선물')

# 따옴표 안의 말. 한국 기사는 큰따옴표와 홑낫표를 섞어 쓴다.
_QUOTE_RE = re.compile(r'[“"]([^”"]{10,300})[”"]|[‘\']([^’\']{10,300})[’\']')

# 문장 끊기. 한국어 종결어미 뒤 마침표와 줄바꿈을 함께 본다.
_SENT_RE = re.compile(r'(?<=[.!?。…])\s+|\n+')


def split_sentences(text):
    return [s.strip() for s in _SENT_RE.split(text) if s.strip()]


def title_variants(title):
    """기사는 제목을 그대로 쓰지 않는다. 부제를 떼거나 띄어쓰기를 달리한다."""
    out = [title]
    base = re.split(r'\s*[:：(（]', title)[0].strip()
    if base and base != title and len(base) >= 3:
        out.append(base)
    return out


def find_evidence(text, title, window=2):
    """책 제목이 나온 문장과 그 앞뒤를 떠온다. 없으면 None.

    한국 기사는 발언을 '"…"며' / '"…"고 말했다' 로 끊어 여러 줄에 흘린다.
    앞뒤 두 문장씩 붙여야 발언 한 덩어리가 온전히 들어온다.

    돌려주는 것
        quote   근거가 될 만한 한 대목 — 따옴표 안의 말이 있으면 그것, 없으면 제목이 든 문장
        context 그 앞뒤까지 붙인 문단 (검수 창에서 읽는 용도)
        score   추천 이유가 담겼을 법한 정도 (CUES 개수 + 따옴표 여부)
    """
    sents = split_sentences(text)
    variants = title_variants(title)
    hits = [i for i, s in enumerate(sents) if any(v in s for v in variants)]
    if not hits:
        return None

    best = None
    for i in hits:
        lo, hi = max(0, i - window), min(len(sents), i + window + 1)
        chunk = ' '.join(sents[lo:hi])
        quotes = [(a or b).strip() for a, b in _QUOTE_RE.findall(chunk)]
        # 책 제목 자체가 따옴표에 싸인 경우는 발언이 아니다
        quotes = [q for q in quotes if not any(v in q and len(q) < len(v) + 12 for v in variants)]
        score = sum(1 for c in CUES if c in chunk) + (2 if quotes else 0)
        cand = {
            'quote': (quotes[0] if quotes else sents[i]).strip(),
            'context': chunk.strip(),
            'score': score,
        }
        if best is None or cand['score'] > best['score']:
            best = cand
    return best


def trim(s, cap=400):
    s = re.sub(r'\s+', ' ', s).strip()
    return s if len(s) <= cap else s[:cap].rstrip() + '…'


# ── 본체 ────────────────────────────────────────────────────────────

OUTLET = {
    'ch.yes24.com': '채널예스', 'cine21.com': '씨네21', 'wkorea.com': '더블유 코리아',
    'gqkorea.co.kr': 'GQ 코리아', 'elle.co.kr': '엘르 코리아', 'allurekorea.com': '얼루어 코리아',
    'marieclairekorea.com': '마리끌레르 코리아', 'esquirekorea.co.kr': '에스콰이어 코리아',
    'vogue.co.kr': '보그 코리아', 'sedaily.com': '서울경제', 'dailian.co.kr': '데일리안',
    'hankyung.com': '한국경제', 'millie.co.kr': '밀리의서재', 'theqoo.net': '더쿠',
    'blog.naver.com': '네이버 블로그', 'youtube.com': '유튜브', 'youtu.be': '유튜브',
}


def load_tasks(max_books):
    """출처 URL 하나에 책 여러 권이 묶인 작업 목록."""
    celebs = json.load(open(DATA_JSON, encoding='utf-8'))['celebs']
    by_source = {}
    for name, v in celebs.items():
        for b in v.get('books', []):
            src = (b.get('source') or '').strip()
            if src.startswith('http'):
                by_source.setdefault((name, src), []).append(b['title'])
    return [{'celeb': c, 'source': s, 'titles': t}
            for (c, s), t in by_source.items() if len(t) <= max_books]


def load_out():
    if os.path.exists(OUT_PATH):
        return json.load(open(OUT_PATH, encoding='utf-8'))
    return {'_comment': '', '_updated': '', 'comments': {}, 'misses': {}}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--limit', type=int, default=0)
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--refresh', action='store_true')
    ap.add_argument('--max-books', type=int, default=3)
    ap.add_argument('--sleep', type=float, default=1.0)
    args = ap.parse_args()

    out = load_out()
    comments = out.setdefault('comments', {})
    misses = out.setdefault('misses', {})

    tasks = load_tasks(args.max_books)
    todo = []
    for t in tasks:
        keys = ['%s|%s' % (t['celeb'], x) for x in t['titles']]
        if all(k in comments for k in keys):
            continue                      # 이미 항목이 있는 출처는 건드리지 않는다
        if not args.refresh and t['source'] in misses:
            continue
        t['titles'] = [x for x, k in zip(t['titles'], keys) if k not in comments]
        todo.append(t)
    if args.limit:
        todo = todo[:args.limit]

    print('출처 %d건 읽기 (전체 후보 %d건)' % (len(todo), len(tasks)))
    added = failed = empty = 0

    for i, t in enumerate(todo, 1):
        label = '%s / %s' % (t['celeb'], ', '.join(t['titles']))
        text, why = fetch_source(t['source'])
        if not text:
            misses[t['source']] = why
            failed += 1
            print('  [%d/%d] %-40.40s  건너뜀 (%s)' % (i, len(todo), label, why))
            continue

        outlet = OUTLET.get(host_of(t['source']), host_of(t['source']))
        hits = 0
        for title in t['titles']:
            ev = find_evidence(text, title)
            if not ev:
                continue
            comments['%s|%s' % (t['celeb'], title)] = {
                'ko': '',                 # 2단계에서 채운다
                'en': '',
                'quote': trim(ev['quote']),
                'context': trim(ev['context'], 700),
                'source': t['source'],
                'outlet': outlet,
                'grade': '',              # 문장을 쓰면서 정한다
                'score': ev['score'],
                'evidence': 'fetch',
                'note': '',
                'status': 'pending',
            }
            hits += 1
            added += 1
        if not hits:
            misses[t['source']] = 'no-mention'
            empty += 1
        print('  [%d/%d] %-40.40s  %d건' % (i, len(todo), label, hits))
        if args.sleep:
            time.sleep(args.sleep)

    print('\n새 항목 %d건 · 못 읽음 %d건 · 언급 없음 %d건' % (added, failed, empty))

    if args.dry_run:
        print('연습 모드 — 파일은 그대로 둡니다.')
        return 0
    # 언급이 없던 출처도 misses 에 남겨야 다음 실행 때 또 읽지 않는다
    if not added and not failed and not empty:
        return 0
    out['_updated'] = time.strftime('%Y-%m-%d')
    with open(OUT_PATH, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
        f.write('\n')
    print('%s 에 썼습니다. ko·en 이 비어 있으니 편집기에서 문장을 채우세요.' % OUT_PATH)
    return 0


if __name__ == '__main__':
    sys.exit(main())
