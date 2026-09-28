#!/usr/bin/env python3
"""편집기에서 적은 '내 메모'(초안)를 근거로 코멘트 문장을 AI가 써 넣는다.

    1. 수집   출처에서 언급된 대목을 떠온다        ← fetch_comments.py
    2. 메모   출처를 보고 편한 말투로 적어둔다      ← 사람이 편집기에서 (= 초안)
    3. 작성   출처 PDF + 메모 → 한국어·영어 한 줄   ← Claude Code (구독 토큰, API 요금 없음)
    4. 승인   읽어보고 승인                         ← 사람이 편집기에서

이 스크립트는 AI를 부르지 않는다. 3단계의 앞뒤만 맡는다.

  prepare  memo 가 있는 미검수 항목을 골라 출처 링크를 PDF로 뜨고(본문 .txt 도 함께),
           작업 폴더에 tasks.json 과 INSTRUCTIONS.md 를 써 둔다.
           → Claude Code 가 INSTRUCTIONS.md 를 읽고 PDF를 보며 results.json 을 쓴다
  apply    results.json 을 검사해 data/comments.json 의 ko·en 에 채운다.
           status 는 pending 그대로 둔다 — 승인은 사람이 한다.

다시 쓰는 경우
  · ko 가 비어 있을 때
  · 메모를 고쳤을 때 (지난번 AI가 본 메모 = ai_memo 와 지금 memo 가 다를 때)
사람이 직접 쓴 ko(ai_memo 가 없는 항목)는 건드리지 않는다.

출처를 PDF로 못 뜨는 경우(유튜브·로그인 벽·오류)엔 본문 텍스트나 자막으로,
그것도 없으면 메모와 인용만으로 쓰고 ai_note 에 그 사실을 남긴다.

사용:
  pip install playwright && python3 -m playwright install chromium
  python3 tools/draft_comments.py prepare --list          # 대상만 보기
  python3 tools/draft_comments.py prepare --limit 5       # .draft-work/ 에 재료 준비
  (Claude Code 에서) ".draft-work/INSTRUCTIONS.md 를 읽고 그대로 해줘"
  python3 tools/draft_comments.py apply                   # 결과를 comments.json 에 반영
"""
import argparse
import asyncio
import datetime
import json
import os
import re
import shutil
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fetch_comments import BLOCKED_HOSTS, fetch_source, host_of  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
COMMENTS_PATH = os.path.join(ROOT, 'data', 'comments.json')
WORK_DIR = os.path.join(ROOT, '.draft-work')

MAX_TEXT_CHARS = 60000
UA = ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/128.0 Safari/537.36')

RULES = """# 코멘트 문장 쓰기

당신은 셀럽 추천 도서 사이트 favorbook 의 코멘트 에디터입니다.
책 옆에 붙는 "왜 이 사람이 이 책을 골랐는지" 한 줄을 한국어와 영어로 씁니다.
아래 항목마다 재료를 읽고 문장을 써서 `{results}` 파일 하나에 모아 저장하세요.
다른 파일은 만들거나 고치지 마세요.

## 재료

- 출처 PDF: 그 셀럽이 이 책을 언급한 원문을 브라우저로 뜬 것. 사실 확인의 기준입니다.
  Read 도구로 여세요. 쪽수가 많으면 pages 를 나눠 읽되, 그 책 이야기가 나오는 곳을 찾으면 충분합니다.
  같은 이름의 .txt 는 같은 페이지의 본문 텍스트입니다. 책 제목 위치를 찾을 때 먼저 보면 빠릅니다.
- 출처 텍스트(.txt 만 있는 경우): 유튜브 자막이나 본문 텍스트.
- 편집자 메모: 사람이 출처를 직접 읽고 편한 말투로 적은 초안. 무엇을 강조할지는 메모를 따릅니다.
- 인용: 수집기가 출처에서 떠온 대목. 어디를 볼지 짚어주는 힌트입니다.

## 규칙

- 출처와 메모에 있는 내용만 씁니다. 없는 이유·감상·사실을 지어내지 않습니다.
- 메모가 출처와 어긋나면 출처를 따르고, 어긋난 점을 note 에 적습니다.
- 출처가 없거나 못 읽었거나 출처에 그 책 이야기가 없으면 메모 범위 안에서만 쓰고 source_checked 를 false 로 둡니다.
- 한국어(ko): 1~2문장, '~했어요' 체. 주어(셀럽 이름)는 대개 생략합니다. 끝에 "(출처: 매체명)"을 붙입니다.
- 영어(en): ko 와 같은 내용을 자연스러운 영어로. 끝에 "(Source: 매체 영문명 또는 로마자 표기)"를 붙입니다.
  셀럽을 가리킬 땐 He/She 대신 이름이나 성별이 드러나지 않는 표현을 우선합니다.
- 책 제목은 되풀이하지 않아도 됩니다(책 카드 옆에 붙습니다).
- 직접 인용은 출처 원문 그대로일 때만 따옴표로 씁니다.
- grade: 출처 원문에 추천·선택 이유가 담겨 있으면 "A", 읽었다·소개했다 같은 관계만 확인되면 "B".
- note: 검수자가 알아야 할 점이 있을 때만 짧게 (없으면 빈 문자열).

## 결과 형식

`{results}` 에 JSON 하나. 키는 아래 항목의 "키" 그대로입니다.

```json
{{
  "연예인|도서명": {{"ko": "...", "en": "...", "grade": "A", "source_checked": true, "note": ""}}
}}
```
"""


# ── 대상 고르기 ─────────────────────────────────────────────────────

def needs_draft(v, force=False):
    memo = (v.get('memo') or '').strip()
    if not memo or (v.get('status') or 'pending') != 'pending':
        return False
    if force or not (v.get('ko') or '').strip():
        return True
    # AI가 쓴 문장인데 그 뒤로 메모가 바뀌었으면 다시 쓴다. 사람이 쓴 문장(ai_memo 없음)은 둔다.
    return 'ai_memo' in v and v['ai_memo'] != memo


def first_url(source):
    for u in re.split(r'\s+', (source or '').strip()):
        if u.startswith('http'):
            return u
    return ''


def style_examples(comments, n=6):
    """승인된 A등급 문장 몇 개 — 말투를 맞추는 예시."""
    out = []
    for k, v in comments.items():
        if v.get('status') == 'approved' and v.get('grade') == 'A' and v.get('ko') and v.get('en'):
            out.append((k, v['ko'], v['en']))
    # 파일 순서가 바뀌어도 같은 예시가 나오도록 키로 정렬한 뒤 고르게 뽑는다
    out.sort()
    step = max(1, len(out) // n)
    return out[::step][:n]


# ── 출처 → PDF / 텍스트 ─────────────────────────────────────────────

def is_youtube(url):
    h = host_of(url)
    return 'youtube.com' in h or 'youtu.be' in h


def is_blocked(url):
    h = host_of(url)
    return any(h == b or h.endswith('.' + b) for b in BLOCKED_HOSTS)


async def render_pdfs(urls, out_dir, timeout_ms=45000):
    """URL → (pdf 경로 | None, 실패 이유). 성공하면 같은 이름의 .txt 에 본문도 남긴다."""
    from playwright.async_api import async_playwright

    res = {}
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH') or None)
        ctx = await browser.new_context(user_agent=UA, locale='ko-KR',
                                        viewport={'width': 1280, 'height': 900})
        for i, url in enumerate(urls):
            dest = os.path.join(out_dir, 'src%03d.pdf' % i)
            page = await ctx.new_page()
            try:
                resp = await page.goto(url, wait_until='domcontentloaded', timeout=timeout_ms)
                if resp and resp.status >= 400:
                    res[url] = (None, 'http-%d' % resp.status)
                    continue
                try:
                    await page.wait_for_load_state('networkidle', timeout=8000)
                except Exception:
                    pass  # 광고·트래커 때문에 끝까지 조용해지지 않는 페이지가 많다
                # 지연 로딩 이미지가 찍히도록 끝까지 내렸다 올린다
                await page.evaluate("""async () => {
                    for (let y = 0; y < document.body.scrollHeight; y += 800) {
                        window.scrollTo(0, y); await new Promise(r => setTimeout(r, 120));
                    }
                    window.scrollTo(0, 0);
                }""")
                await page.wait_for_timeout(800)
                await page.emulate_media(media='screen')
                await page.pdf(path=dest, format='A4', print_background=True,
                               margin={'top': '10mm', 'bottom': '10mm', 'left': '8mm', 'right': '8mm'})
                text = await page.evaluate("() => document.body ? document.body.innerText : ''")
                with open(dest[:-4] + '.txt', 'w', encoding='utf-8') as fp:
                    fp.write(url + '\n\n' + (text or '')[:MAX_TEXT_CHARS])
                res[url] = (dest, '')
            except Exception as e:
                res[url] = (None, 'pdf-failed: %s' % str(e).splitlines()[0][:120])
            finally:
                await page.close()
        await browser.close()
    return res


def gather_material(urls, out_dir, use_pdf):
    """URL → ('pdf', 경로) | ('text', 경로) | (None, 이유)"""
    out = {}
    pdf_urls = [u for u in urls if use_pdf and not is_youtube(u) and not is_blocked(u)]
    pdfs = {}
    if pdf_urls:
        try:
            pdfs = asyncio.run(render_pdfs(pdf_urls, out_dir))
        except Exception as e:  # 브라우저가 아예 안 뜨면 전부 텍스트로
            print('⚠ 브라우저 실행 실패, 본문 텍스트로 대신합니다: %s' % e)
    for i, u in enumerate(urls):
        path, why = pdfs.get(u, (None, ''))
        if path:
            out[u] = ('pdf', path)
            continue
        text, err = fetch_source(u)
        if text:
            dest = os.path.join(out_dir, 'src%03d.txt' % i)
            with open(dest, 'w', encoding='utf-8') as fp:
                fp.write(u + '\n\n' + text[:MAX_TEXT_CHARS])
            out[u] = ('text', dest)
        else:
            out[u] = (None, why or err or 'unknown')
    return out


# ── prepare ────────────────────────────────────────────────────────

def rel(path):
    return os.path.relpath(path, ROOT)


def write_instructions(tasks, examples, work):
    results = rel(os.path.join(work, 'results.json'))
    lines = [RULES.format(results=results)]
    if examples:
        lines.append('## 말투 예시 (이미 승인된 문장)\n')
        for k, ko, en in examples:
            lines.append('- %s\n  - ko: %s\n  - en: %s' % (k, ko, en))
        lines.append('')
    lines.append('## 항목 (%d건)\n' % len(tasks))
    for n, t in enumerate(tasks, 1):
        lines.append('### %d. 키: `%s`\n' % (n, t['key']))
        lines.append('- 셀럽: %s / 책: %s' % (t['celeb'], t['title']))
        lines.append('- 매체: %s' % (t['outlet'] or '(미상 — 출처에서 확인)'))
        lines.append('- 출처 URL: %s' % (t['source'] or '(없음)'))
        if t['date']:
            lines.append('- %s: %s' % (t['date_type'] or '게재일', t['date']))
        if t['material'] == 'pdf':
            lines.append('- 출처 PDF: `%s` (본문 텍스트: `%s`)' % (t['file'], t['file'][:-4] + '.txt'))
        elif t['material'] == 'text':
            lines.append('- 출처 텍스트: `%s`' % t['file'])
        else:
            lines.append('- 출처: 읽어오지 못함 (%s) — 메모와 인용 범위 안에서만 쓰고 source_checked 는 false' % t['why'])
        lines.append('- 편집자 메모 (초안): %s' % t['memo'])
        if t['quote']:
            lines.append('- 인용: %s' % t['quote'])
        if t['context']:
            lines.append('- 앞뒤 문단: %s' % t['context'])
        if t['note']:
            lines.append('- 기존 검수 메모: %s' % t['note'])
        lines.append('')
    with open(os.path.join(work, 'INSTRUCTIONS.md'), 'w', encoding='utf-8') as fp:
        fp.write('\n'.join(lines))


def prepare(a):
    with open(COMMENTS_PATH, encoding='utf-8') as fp:
        comments = json.load(fp).get('comments', {})

    keys = [k for k, v in comments.items()
            if (not a.key or k in a.key) and needs_draft(v, a.force)]
    if a.limit:
        keys = keys[:a.limit]

    gh_out = os.environ.get('GITHUB_OUTPUT')
    if gh_out:
        with open(gh_out, 'a', encoding='utf-8') as fp:
            fp.write('targets=%d\n' % len(keys))

    print('AI 작성 대상 %d건' % len(keys))
    for k in keys:
        print('  · %s — 메모: %s' % (k, comments[k]['memo'].strip()[:60]))
    if a.list or not keys:
        return

    work = a.work
    shutil.rmtree(work, ignore_errors=True)
    os.makedirs(work)

    urls = sorted({first_url(comments[k].get('source')) for k in keys} - {''})
    print('\n출처 %d개 읽는 중…' % len(urls))
    material = gather_material(urls, work, not a.no_pdf)
    for u, (kind, x) in material.items():
        print('  %-4s %s%s' % (kind or 'FAIL', u, '' if kind else ' — ' + x))

    tasks = []
    for k in keys:
        v = comments[k]
        celeb, _, title = k.partition('|')
        url = first_url(v.get('source'))
        kind, x = material.get(url, (None, 'no-source'))
        tasks.append({
            'key': k, 'celeb': celeb, 'title': title,
            'outlet': v.get('outlet') or '', 'source': v.get('source') or '',
            'date': v.get('date') or '', 'date_type': v.get('date_type') or '',
            'memo': v['memo'].strip(), 'quote': v.get('quote') or '',
            'context': v.get('context') or '', 'note': v.get('note') or '',
            'material': kind, 'file': rel(x) if kind else '', 'why': '' if kind else x,
        })
    with open(os.path.join(work, 'tasks.json'), 'w', encoding='utf-8') as fp:
        json.dump(tasks, fp, ensure_ascii=False, indent=2)
    write_instructions(tasks, style_examples(comments), work)
    print('\n준비 완료 → %s/INSTRUCTIONS.md' % rel(work))


# ── apply ──────────────────────────────────────────────────────────

def apply(a):
    work = a.work
    with open(os.path.join(work, 'tasks.json'), encoding='utf-8') as fp:
        tasks = {t['key']: t for t in json.load(fp)}
    try:
        with open(os.path.join(work, 'results.json'), encoding='utf-8') as fp:
            results = json.load(fp)
    except (FileNotFoundError, json.JSONDecodeError) as e:
        sys.exit('results.json 을 읽지 못했습니다: %s' % e)

    with open(COMMENTS_PATH, encoding='utf-8') as fp:
        doc = json.load(fp)
    comments = doc.get('comments', {})

    done = skipped = 0
    for k, t in tasks.items():
        r = results.get(k)
        v = comments.get(k)
        ko = str((r or {}).get('ko') or '').strip()
        en = str((r or {}).get('en') or '').strip()
        if not r or not ko:
            skipped += 1
            print('✗ %s — 결과 없음' % k)
            continue
        # 준비한 뒤에 편집기에서 메모를 또 고쳤거나 승인·반려했으면 그 결과는 버린다
        if not v or (v.get('memo') or '').strip() != t['memo'] or not needs_draft(v, True):
            skipped += 1
            print('✗ %s — 그새 편집기에서 바뀜, 건너뜀' % k)
            continue
        grade = r.get('grade') if r.get('grade') in ('A', 'B') else ''
        checked = bool(r.get('source_checked'))
        note = str(r.get('note') or '').strip()
        print('✓ %s  [%s%s]\n  ko: %s\n  en: %s%s' % (
            k, grade or '-', '' if checked else ', 출처 미확인', ko, en, ('\n  note: ' + note) if note else ''))

        v['ko'], v['en'] = ko, en
        v['ai_memo'] = v['memo']
        v['evidence'] = 'ai-' + (t['material'] or 'memo')
        if not v.get('grade') and grade:
            v['grade'] = grade
        notes = [note] if note else []
        if not checked:
            notes.append('AI가 출처에서 확인 못 함' + (' (%s)' % t['why'] if t['why'] else '') + ' — 메모만 보고 씀')
        v['ai_note'] = ' / '.join(notes)
        done += 1

    print('\n반영 %d건 · 건너뜀 %d건%s' % (done, skipped, ' (연습 모드 — 파일 안 바꿈)' if a.dry_run else ''))
    if a.dry_run or not done:
        return
    doc['_updated'] = datetime.date.today().isoformat()
    with open(COMMENTS_PATH, 'w', encoding='utf-8') as fp:
        fp.write(json.dumps(doc, ensure_ascii=False, indent=2) + '\n')


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest='cmd', required=True)
    p = sub.add_parser('prepare', help='대상 고르고 출처 PDF·지시문 준비')
    p.add_argument('--limit', type=int, default=0, help='이번에 쓸 항목 수 (0 = 전부)')
    p.add_argument('--key', action='append', default=[], help='이 키만 ("연예인|도서명", 여러 번 가능)')
    p.add_argument('--force', action='store_true', help='메모가 그대로여도 다시 쓰기 (pending 만)')
    p.add_argument('--no-pdf', action='store_true', help='PDF 대신 본문 텍스트로만')
    p.add_argument('--list', action='store_true', help='대상만 찍고 끝')
    p.add_argument('--work', default=WORK_DIR)
    p = sub.add_parser('apply', help='results.json 을 comments.json 에 반영')
    p.add_argument('--dry-run', action='store_true', help='결과만 찍고 파일은 안 바꿈')
    p.add_argument('--work', default=WORK_DIR)
    a = ap.parse_args()
    prepare(a) if a.cmd == 'prepare' else apply(a)


if __name__ == '__main__':
    main()
