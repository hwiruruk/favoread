#!/usr/bin/env python3
"""출처 웹페이지를 PDF로 떠서 모아둔다.

data/detail/*.json 에 들어 있는 모든 출처(source) URL을 모은 뒤
  · 일반 웹페이지는 브라우저(Chromium)로 열어 PDF로 저장하고
  · 유튜브는 PDF로 뜰 게 없으니 따로 목록(youtube.csv)으로 모은다
    (영상 제목·채널은 oEmbed로 받아온다 — API 키 필요 없음)

결과 (기본 archive/ 아래, 저장소에는 커밋하지 않는다):
  archive/web/<도메인>/<해시>.pdf   출처 한 개당 PDF 한 개
  archive/web/<도메인>/<해시>.txt   같은 페이지의 본문 텍스트 (첫 줄은 URL)
  archive/web/index.csv             URL ↔ PDF 파일 ↔ 셀럽·책 대응표, 성공 여부
  archive/youtube/youtube.csv       유튜브 출처 목록 (셀럽·책·영상 제목·채널·시작 시각)

X·인스타그램·페이스북은 로그인 벽이 있어 대부분 로그인 화면이 찍힌다.
index.csv 의 note 칸에 login-wall 로 표시해 두니 따로 확인하면 된다.

사용:
  pip install playwright && playwright install chromium
  python3 tools/archive_sources.py --limit 10          # 시험
  python3 tools/archive_sources.py                     # 전부
  python3 tools/archive_sources.py --host cine21.com   # 특정 도메인만
"""
import argparse
import asyncio
import csv
import glob
import hashlib
import json
import os
import re
import urllib.request
from urllib.parse import parse_qs, urlparse

YOUTUBE_HOSTS = ('youtube.com', 'youtu.be')
LOGIN_WALL_HOSTS = ('x.com', 'twitter.com', 'instagram.com', 'facebook.com',
                    'threads.net', 'threads.com', 'tiktok.com')
UA = ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/128.0 Safari/537.36')


def host_of(url):
    return urlparse(url).netloc.lower()


def host_matches(url, hosts):
    h = host_of(url)
    return any(h == x or h.endswith('.' + x) for x in hosts)


def collect_sources(detail_dir):
    """URL → [(셀럽, 책), ...] (처음 나온 순서 유지)"""
    urls = {}
    for path in sorted(glob.glob(os.path.join(detail_dir, '*.json'))):
        celeb = os.path.basename(path)[:-5]
        with open(path, encoding='utf-8') as fp:
            books = json.load(fp)
        for book, info in books.items():
            for u in re.split(r'\s+', (info.get('source') or '').strip()):
                if u.startswith('http'):
                    urls.setdefault(u, []).append((celeb, book))
    return urls


def pdf_name(url):
    h = re.sub(r'[^a-z0-9.-]', '_', host_of(url)) or 'unknown'
    return os.path.join(h, hashlib.sha1(url.encode('utf-8')).hexdigest()[:12] + '.pdf')


def who(pairs):
    return ' / '.join(sorted({c for c, _ in pairs})), ' / '.join(b for _, b in pairs)


# ── 유튜브 ──────────────────────────────────────────────────────

def youtube_meta(url):
    try:
        q = 'https://www.youtube.com/oembed?format=json&url=' + urllib.request.quote(url, safe='')
        with urllib.request.urlopen(urllib.request.Request(q, headers={'User-Agent': UA}), timeout=15) as r:
            d = json.load(r)
        return d.get('title', ''), d.get('author_name', ''), 'ok'
    except Exception as e:  # 비공개·삭제된 영상이면 401/404
        return '', '', 'oembed-failed: %s' % e


def youtube_start(url):
    q = parse_qs(urlparse(url).query)
    t = (q.get('t') or q.get('start') or [''])[0]
    m = re.fullmatch(r'(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?', t or '')
    if not t or not m:
        return ''
    sec = int(m.group(1) or 0) * 3600 + int(m.group(2) or 0) * 60 + int(m.group(3) or 0)
    return '%d:%02d:%02d' % (sec // 3600, sec % 3600 // 60, sec % 60)


def write_youtube(items, out_dir, fetch_meta):
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, 'youtube.csv')
    with open(path, 'w', encoding='utf-8-sig', newline='') as fp:
        w = csv.writer(fp)
        w.writerow(['url', '셀럽', '책', '영상 제목', '채널', '시작 시각', 'note'])
        for i, (url, pairs) in enumerate(items, 1):
            title, channel, note = youtube_meta(url) if fetch_meta else ('', '', '')
            celebs, books = who(pairs)
            w.writerow([url, celebs, books, title, channel, youtube_start(url), note])
            if i % 20 == 0:
                print('  유튜브 %d/%d' % (i, len(items)))
    print('✅ 유튜브 %d개 → %s' % (len(items), path))


# ── 웹페이지 → PDF ──────────────────────────────────────────────

async def save_pdf(ctx, url, dest, timeout_ms):
    page = await ctx.new_page()
    try:
        resp = await page.goto(url, wait_until='domcontentloaded', timeout=timeout_ms)
        try:
            await page.wait_for_load_state('networkidle', timeout=8000)
        except Exception:
            pass  # 광고·트래커 때문에 끝까지 조용해지지 않는 페이지가 많다
        # 지연 로딩 이미지가 찍히도록 한 번 끝까지 내렸다 올린다
        await page.evaluate("""async () => {
            for (let y = 0; y < document.body.scrollHeight; y += 800) {
                window.scrollTo(0, y); await new Promise(r => setTimeout(r, 120));
            }
            window.scrollTo(0, 0);
        }""")
        await page.wait_for_timeout(800)
        await page.emulate_media(media='screen')
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        await page.pdf(path=dest, format='A4', print_background=True,
                       margin={'top': '10mm', 'bottom': '10mm', 'left': '8mm', 'right': '8mm'})
        # 코멘트 작업용 본문 텍스트. PDF는 한 개에 수 MB라 전부 받기 무겁다.
        text = await page.evaluate("() => document.body ? document.body.innerText : ''")
        with open(dest[:-4] + '.txt', 'w', encoding='utf-8') as fp:
            fp.write(url + '\n\n' + (text or ''))
        return (resp.status if resp else ''), (await page.title()), ''
    finally:
        await page.close()


async def archive_web(items, out_dir, workers, timeout_ms, skip_existing):
    from playwright.async_api import async_playwright

    rows = []
    queue = asyncio.Queue()
    for n, it in enumerate(items, 1):
        queue.put_nowait((n, it))

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH') or None)
        ctx = await browser.new_context(user_agent=UA, locale='ko-KR',
                                        viewport={'width': 1280, 'height': 900})

        async def worker():
            while not queue.empty():
                n, (url, pairs) = queue.get_nowait()
                rel = pdf_name(url)
                dest = os.path.join(out_dir, rel)
                celebs, books = who(pairs)
                note = 'login-wall' if host_matches(url, LOGIN_WALL_HOSTS) else ''
                if skip_existing and os.path.exists(dest):
                    rows.append([url, rel, celebs, books, 'skipped', '', '', note])
                    continue
                try:
                    status, title, _ = await save_pdf(ctx, url, dest, timeout_ms)
                    res = 'http-error' if isinstance(status, int) and status >= 400 else 'ok'
                    rows.append([url, rel, celebs, books, res, status, title, note])
                    print('  [%d/%d] %-4s %s' % (n, len(items), 'ok' if res == 'ok' else status, url))
                except Exception as e:
                    msg = str(e).splitlines()[0][:200]
                    rows.append([url, '', celebs, books, 'failed', '', '', (note + ' ' + msg).strip()])
                    print('  [%d/%d] FAIL %s — %s' % (n, len(items), url, msg))

        await asyncio.gather(*(worker() for _ in range(workers)))
        await browser.close()

    order = {u: i for i, (u, _) in enumerate(items)}
    rows.sort(key=lambda r: order[r[0]])
    with open(os.path.join(out_dir, 'index.csv'), 'w', encoding='utf-8-sig', newline='') as fp:
        w = csv.writer(fp)
        w.writerow(['url', 'pdf', '셀럽', '책', 'result', 'http', 'page title', 'note'])
        w.writerows(rows)
    ok = sum(1 for r in rows if r[4] in ('ok', 'skipped'))
    print('✅ 웹페이지 %d/%d개 PDF 저장 → %s' % (ok, len(rows), out_dir))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--detail-dir', default='data/detail')
    ap.add_argument('--out', default='archive')
    ap.add_argument('--limit', type=int, default=0, help='웹페이지 몇 개만 (0 = 전부)')
    ap.add_argument('--host', default='', help='이 도메인만 (예: cine21.com)')
    ap.add_argument('--workers', type=int, default=4)
    ap.add_argument('--timeout', type=int, default=45, help='페이지 하나 최대 대기 초')
    ap.add_argument('--skip-social', action='store_true', help='X·인스타·페이스북 등 로그인 벽 출처 건너뛰기')
    ap.add_argument('--no-youtube-meta', action='store_true', help='유튜브 제목·채널 조회 생략')
    ap.add_argument('--resume', action='store_true', help='이미 PDF가 있는 출처는 건너뛰기')
    a = ap.parse_args()

    urls = collect_sources(a.detail_dir)
    yt = [(u, p) for u, p in urls.items() if host_matches(u, YOUTUBE_HOSTS)]
    web = [(u, p) for u, p in urls.items() if not host_matches(u, YOUTUBE_HOSTS)]
    if a.host:
        yt = [x for x in yt if host_matches(x[0], (a.host,))]
        web = [x for x in web if host_matches(x[0], (a.host,))]
    if a.skip_social:
        web = [x for x in web if not host_matches(x[0], LOGIN_WALL_HOSTS)]
    if a.limit:
        web = web[:a.limit]
    print('출처 %d개 — 웹페이지 %d개, 유튜브 %d개' % (len(urls), len(web), len(yt)))

    write_youtube(yt, os.path.join(a.out, 'youtube'), not a.no_youtube_meta)
    if web:
        asyncio.run(archive_web(web, os.path.join(a.out, 'web'), a.workers, a.timeout * 1000, a.resume))


if __name__ == '__main__':
    main()
