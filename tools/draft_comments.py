#!/usr/bin/env python3
"""편집기에서 적은 '내 메모'(초안)를 근거로 코멘트 문장을 AI가 써 넣는다.

    1. 수집   출처에서 언급된 대목을 떠온다        ← fetch_comments.py
    2. 메모   출처를 보고 편한 말투로 적어둔다      ← 사람이 편집기에서 (= 초안)
    3. 작성   출처 PDF + 메모 → 한국어·영어 한 줄   ← 이 스크립트 (Claude)
    4. 승인   읽어보고 승인                         ← 사람이 편집기에서

data/comments.json 에서 memo 가 있고 아직 승인·반려 전(pending)인 항목을 골라
  · 출처 링크를 브라우저(Chromium)로 열어 PDF로 뜨고
  · 그 PDF와 메모·인용을 Claude 에 넘겨
  · ko / en 문장을 받아 채운다. status 는 pending 그대로 둔다 — 승인은 사람이 한다.

다시 쓰는 경우
  · ko 가 비어 있을 때
  · 메모를 고쳤을 때 (지난번 AI가 본 메모 = ai_memo 와 지금 memo 가 다를 때)
사람이 직접 쓴 ko(ai_memo 가 없는 항목)는 건드리지 않는다.

출처를 PDF로 못 뜨는 경우(유튜브·로그인 벽·너무 큰 페이지·오류)엔 본문 텍스트나
자막으로, 그것도 없으면 메모와 인용만으로 쓰고 note 에 그 사실을 남긴다.

사용:
  export ANTHROPIC_API_KEY=...
  pip install anthropic playwright && playwright install chromium
  python3 tools/draft_comments.py --list               # 대상만 보기 (API 호출 없음)
  python3 tools/draft_comments.py --limit 5 --dry-run  # 결과만 찍기
  python3 tools/draft_comments.py                      # 채워 넣기
  python3 tools/draft_comments.py --key "박보영|소년이 온다" --force
"""
import argparse
import asyncio
import base64
import datetime
import json
import os
import re
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fetch_comments import BLOCKED_HOSTS, fetch_source, host_of  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
COMMENTS_PATH = os.path.join(ROOT, 'data', 'comments.json')

MODEL = os.environ.get('COMMENT_MODEL') or 'claude-opus-5'
# 요청 한도 32MB. base64 로 1.33배 불어나니 PDF는 20MB 까지만 싣는다.
MAX_PDF_BYTES = 20 * 1024 * 1024
MAX_TEXT_CHARS = 60000
UA = ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/128.0 Safari/537.36')

SYSTEM = """당신은 셀럽 추천 도서 사이트 favorbook 의 코멘트 에디터입니다.
책 옆에 붙는 "왜 이 사람이 이 책을 골랐는지" 한 줄을 한국어와 영어로 씁니다.

재료
- 출처: 그 셀럽이 이 책을 언급한 원문(PDF 또는 본문 텍스트). 사실 확인의 기준입니다.
- 편집자 메모: 사람이 출처를 직접 읽고 편한 말투로 적은 초안. 무엇을 강조할지는 메모를 따릅니다.
- 인용: 수집기가 출처에서 떠온 대목. 어디를 볼지 짚어주는 힌트입니다.

규칙
- 출처와 메모에 있는 내용만 씁니다. 없는 이유·감상·사실을 지어내지 않습니다.
- 메모가 출처와 어긋나면 출처를 따르고, 어긋난 점을 note 에 적습니다.
- 출처를 못 읽었거나 출처에 그 책 이야기가 없으면 메모 범위 안에서만 쓰고 source_checked 를 false 로 둡니다.
- 한국어(ko): 1~2문장, '~했어요' 체. 주어(셀럽 이름)는 대개 생략합니다. 끝에 "(출처: 매체명)"을 붙입니다.
- 영어(en): ko 와 같은 내용을 자연스러운 영어로. 끝에 "(Source: 매체 영문명 또는 로마자 표기)"를 붙입니다.
  셀럽을 가리킬 땐 He/She 대신 이름이나 성별이 드러나지 않는 표현을 우선합니다.
- 책 제목은 되풀이하지 않아도 됩니다(책 카드 옆에 붙습니다).
- 직접 인용은 출처 원문 그대로일 때만 따옴표로 씁니다.
- grade: 출처 원문에 추천·선택 이유가 담겨 있으면 "A", 읽었다·소개했다 같은 관계만 확인되면 "B".
- note: 검수자가 알아야 할 점이 있을 때만 짧게 (없으면 빈 문자열).
"""

SCHEMA = {
    'type': 'object',
    'properties': {
        'ko': {'type': 'string'},
        'en': {'type': 'string'},
        'grade': {'type': 'string', 'enum': ['A', 'B']},
        'source_checked': {'type': 'boolean'},
        'note': {'type': 'string'},
    },
    'required': ['ko', 'en', 'grade', 'source_checked', 'note'],
    'additionalProperties': False,
}


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
    """URL → (pdf 경로 | None, 실패 이유)"""
    from playwright.async_api import async_playwright

    res = {}
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH') or None)
        ctx = await browser.new_context(user_agent=UA, locale='ko-KR',
                                        viewport={'width': 1280, 'height': 900})
        for i, url in enumerate(urls):
            dest = os.path.join(out_dir, '%03d.pdf' % i)
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
                if os.path.getsize(dest) > MAX_PDF_BYTES:
                    res[url] = (None, 'pdf-too-large')
                else:
                    res[url] = (dest, '')
            except Exception as e:
                res[url] = (None, 'pdf-failed: %s' % str(e).splitlines()[0][:120])
            finally:
                await page.close()
        await browser.close()
    return res


def gather_material(urls, use_pdf):
    """URL → ('pdf', 경로) | ('text', 본문) | (None, 이유)"""
    out = {}
    pdf_urls = [u for u in urls if use_pdf and not is_youtube(u) and not is_blocked(u)]
    pdfs = {}
    if pdf_urls:
        tmp = tempfile.mkdtemp(prefix='cmt-pdf-')
        try:
            pdfs = asyncio.run(render_pdfs(pdf_urls, tmp))
        except Exception as e:  # 브라우저가 아예 안 뜨면 전부 텍스트로
            print('⚠ 브라우저 실행 실패, 본문 텍스트로 대신합니다: %s' % e)
    for u in urls:
        path, why = pdfs.get(u, (None, ''))
        if path:
            out[u] = ('pdf', path)
            continue
        text, err = fetch_source(u)
        if text:
            out[u] = ('text', text[:MAX_TEXT_CHARS])
        else:
            out[u] = (None, why or err or 'unknown')
    return out


# ── Claude ─────────────────────────────────────────────────────────

def build_prompt(key, v, examples, material_kind):
    celeb, _, title = key.partition('|')
    lines = [
        '셀럽: %s' % celeb,
        '책: %s' % title,
        '매체: %s' % (v.get('outlet') or '(미상 — 출처에서 확인)'),
        '출처 URL: %s' % (v.get('source') or ''),
    ]
    if v.get('date'):
        lines.append('%s: %s' % (v.get('date_type') or '게재일', v['date']))
    lines.append('')
    lines.append('편집자 메모 (초안):\n%s' % v['memo'].strip())
    if v.get('quote'):
        lines.append('\n인용 (수집기가 떠온 대목):\n%s' % v['quote'])
    if v.get('context'):
        lines.append('\n앞뒤 문단:\n%s' % v['context'])
    if v.get('note'):
        lines.append('\n기존 검수 메모: %s' % v['note'])
    if material_kind is None:
        lines.append('\n※ 출처를 읽어오지 못했습니다. 메모와 인용 범위 안에서만 쓰고 source_checked 는 false 로 두세요.')
    if examples:
        lines.append('\n말투 예시 (이미 승인된 문장):')
        for k, ko, en in examples:
            lines.append('- %s\n  ko: %s\n  en: %s' % (k, ko, en))
    lines.append('\n위 규칙대로 ko·en·grade·source_checked·note 를 JSON 으로 주세요.')
    return '\n'.join(lines)


def ask_claude(client, key, v, material, examples):
    content = []
    kind = material[0] if material else None
    if kind == 'pdf':
        with open(material[1], 'rb') as fp:
            data = base64.standard_b64encode(fp.read()).decode('ascii')
        content.append({'type': 'document',
                        'source': {'type': 'base64', 'media_type': 'application/pdf', 'data': data},
                        'title': '출처: ' + (v.get('source') or '')})
    elif kind == 'text':
        content.append({'type': 'document',
                        'source': {'type': 'text', 'media_type': 'text/plain', 'data': material[1]},
                        'title': '출처 본문: ' + (v.get('source') or '')})
    content.append({'type': 'text', 'text': build_prompt(key, v, examples, kind)})

    with client.beta.messages.stream(
        model=MODEL,
        max_tokens=16000,
        betas=['server-side-fallback-2026-07-01'],
        fallbacks='default',
        system=SYSTEM,
        output_config={'effort': 'medium',
                       'format': {'type': 'json_schema', 'schema': SCHEMA}},
        messages=[{'role': 'user', 'content': content}],
    ) as stream:
        msg = stream.get_final_message()
    if msg.stop_reason == 'refusal':
        raise RuntimeError('refusal')
    if msg.stop_reason == 'max_tokens':
        raise RuntimeError('max_tokens')
    text = next(b.text for b in msg.content if b.type == 'text')
    return json.loads(text)


# ── 실행 ───────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--limit', type=int, default=0, help='이번에 쓸 항목 수 (0 = 전부)')
    ap.add_argument('--key', action='append', default=[], help='이 키만 ("연예인|도서명", 여러 번 가능)')
    ap.add_argument('--force', action='store_true', help='메모가 그대로여도 다시 쓰기 (pending 만)')
    ap.add_argument('--no-pdf', action='store_true', help='PDF 대신 본문 텍스트로만')
    ap.add_argument('--dry-run', action='store_true', help='결과만 찍고 파일은 안 바꿈')
    ap.add_argument('--list', action='store_true', help='대상만 찍고 끝 (API 호출 없음)')
    a = ap.parse_args()

    with open(COMMENTS_PATH, encoding='utf-8') as fp:
        doc = json.load(fp)
    comments = doc.get('comments', {})

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

    if not os.environ.get('ANTHROPIC_API_KEY'):
        sys.exit('ANTHROPIC_API_KEY 가 없습니다. 저장소 Settings → Secrets → Actions 에 넣어주세요.')

    import anthropic
    client = anthropic.Anthropic()
    examples = style_examples(comments)

    urls = sorted({first_url(comments[k].get('source')) for k in keys} - {''})
    print('\n출처 %d개 읽는 중…' % len(urls))
    material = gather_material(urls, not a.no_pdf)
    for u, (kind, x) in material.items():
        print('  %-4s %s%s' % (kind or 'FAIL', u, '' if kind else ' — ' + x))

    done = failed = 0
    for k in keys:
        v = comments[k]
        url = first_url(v.get('source'))
        mat = material.get(url)
        if mat and mat[0] is None:
            mat = None
        try:
            r = ask_claude(client, k, v, mat, examples)
        except (anthropic.APIError, RuntimeError, ValueError, StopIteration) as e:
            failed += 1
            print('✗ %s — %s' % (k, e))
            continue

        ko, en = r['ko'].strip(), r['en'].strip()
        if not ko:
            failed += 1
            print('✗ %s — 빈 문장' % k)
            continue
        print('\n✓ %s  [%s%s]\n  ko: %s\n  en: %s%s' % (
            k, r['grade'], '' if r['source_checked'] else ', 출처 미확인', ko, en,
            ('\n  note: ' + r['note']) if r['note'] else ''))
        done += 1
        if a.dry_run:
            continue

        v['ko'], v['en'] = ko, en
        v['ai_memo'] = v['memo']
        v['evidence'] = 'ai-' + (mat[0] if mat else 'memo')
        if not v.get('grade'):
            v['grade'] = r['grade']
        notes = [r['note'].strip()] if r['note'].strip() else []
        if not r['source_checked']:
            why = material.get(url, (None, 'no-source'))[1] if not mat else ''
            notes.append('AI가 출처에서 확인 못 함' + (' (%s)' % why if why else '') + ' — 메모만 보고 씀')
        v['ai_note'] = ' / '.join(notes)

    print('\n작성 %d건 · 실패 %d건%s' % (done, failed, ' (연습 모드 — 파일 안 바꿈)' if a.dry_run else ''))
    if a.dry_run or not done:
        return
    doc['_updated'] = datetime.date.today().isoformat()
    with open(COMMENTS_PATH, 'w', encoding='utf-8') as fp:
        fp.write(json.dumps(doc, ensure_ascii=False, indent=2) + '\n')


if __name__ == '__main__':
    main()
