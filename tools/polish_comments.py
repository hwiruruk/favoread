#!/usr/bin/env python3
"""내 메모를 Claude 가 한국어·영어 한 줄로 다듬어 코멘트 검수 창에 올려두는 배치.

코멘트는 세 단계로 만든다 (tools/COMMENTS.md).

    1. 수집   출처에서 언급된 대목을 떠온다        ← tools/fetch_comments.py
    2. 메모   출처를 보고 편한 말투로 적어둔다     ← 사람이 편집기에서
    3. 작성   메모를 한국어·영어 한 줄로 다듬는다  ← 이 스크립트, 사람이 승인

다듬은 문장은 ko·en 칸에 들어가지만 status 는 pending 그대로다.
편집기의 "💬 코멘트 검수" 창에서 읽어보고 승인해야 사이트에 나간다.

무엇을 다듬나
    status 가 pending 이고 memo 가 있는 항목 중
      - ko 가 비어 있거나
      - 지난번 AI 가 쓴 ko 를 사람이 고치지 않았고, 그 뒤로 메모가 바뀐 것
    사람이 직접 고쳐 쓴 ko 는 덮어쓰지 않는다.

    무엇을 보고 언제 썼는지는 항목의 ai 칸에 남는다
      ai = {memo, ko, en, note, model, at}
    다음 실행 때 이걸 보고 메모가 바뀌었는지, 사람이 손댔는지 가린다.

실행
    ANTHROPIC_API_KEY=... python3 tools/polish_comments.py --dry-run
    ANTHROPIC_API_KEY=... python3 tools/polish_comments.py

옵션
    --limit N          이번에 다듬을 항목 수 (기본 50, 0=무제한)
    --dry-run          파일에 쓰지 않고 결과만 출력
    --only KEY         이 항목만 ("연예인|도서명", 쉼표로 여러 개)
    --save-results P   다듬은 결과를 P 에도 따로 저장 (워크플로가 push 충돌 때 다시 적용하는 용도)
    --apply P          API 를 부르지 않고 P 에 저장해 둔 결과만 지금 파일에 다시 적용
"""
import argparse
import json
import os
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PATH = os.path.join(ROOT, 'data', 'comments.json')

MODEL = 'claude-opus-5-5'

SYSTEM = """\
당신은 한국 셀럽의 추천 도서를 모아 보여주는 사이트 favorbook.co.kr 의 편집자입니다.
책마다 "이 사람이 왜 이 책을 추천했는지"를 한 줄로 붙입니다.

편집자가 출처를 직접 읽고 남긴 메모를 받아, 사이트에 실을 한국어·영어 문장으로 다듬어 주세요.

지킬 것
- 근거는 메모입니다. 인용·앞뒤 문단은 고유명사나 사실을 확인하는 데만 쓰고,
  메모에 없는 이유나 감상을 지어내지 마세요. 사이트는 "모든 내용은 확인 가능한 출처에서 왔다"고 약속합니다.
- 한국어(ko)는 1~2문장, 120자 안팎. 셀럽 이름으로 시작하지 말고, 전해 듣는 말투로 끝냅니다
  ("~했대요", "~했어요", "~래요"). 끝에 "(출처: 매체명)"을 붙입니다.
- 영어(en)는 ko 와 같은 내용을 자연스러운 영어 한 문장으로. 끝에 "(Source: 매체 영문명)"을 붙입니다.
  매체 영문명은 널리 쓰이는 표기로 (씨네21 → Cine21, 보그 → Vogue Korea, 네이버 블로그 → Naver Blog).
- 메모가 원문을 길게 붙여넣은 것이면 추천 이유가 담긴 핵심만 추립니다. 따옴표 인용을 그대로 옮기지 말고 풀어 씁니다.
- grade: 메모에 추천 이유·감상이 있으면 "A", 읽었다·언급했다 같은 관계만 있으면 "B".
  B 라면 지어내지 말고 관계만 담담히 적습니다 (예: "브이라이브에서 이 책을 읽고 있다고 소개했어요. (출처: 네이버 V LIVE)").
- note: 검수자가 알아야 할 점이 있으면 한 줄로 (메모가 다른 책 얘기 같다, 매체를 알 수 없다 등). 없으면 빈 문자열.

예시
  메모: 교보에서 별생각 없이 골랐는데 모순보다 재밌었다고. 건선으로 잠 못 자던 새벽마다 친구가 돼준 책
  매체: 보그
  → ko: 교보문고에서 별생각 없이 골랐는데 '모순'보다 훨씬 재미있게 읽었대요. 건선으로 잠 못 이루던 새벽마다 친구가 되어준 책이래요. (출처: 보그)
    en: Picked on a whim at Kyobo, she enjoyed it even more than Contradiction; it kept her company through sleepless nights with psoriasis. (Source: Vogue Korea)
    grade: A
"""

SCHEMA = {
    'type': 'object',
    'properties': {
        'ko': {'type': 'string'},
        'en': {'type': 'string'},
        'grade': {'type': 'string', 'enum': ['A', 'B']},
        'note': {'type': 'string'},
    },
    'required': ['ko', 'en', 'grade', 'note'],
    'additionalProperties': False,
}


def needs_polish(v):
    """다듬을 차례인 항목인가. 사람이 직접 쓴 ko 는 건드리지 않는다."""
    if (v.get('status') or 'pending') != 'pending':
        return False
    memo = (v.get('memo') or '').strip()
    if not memo:
        return False
    ko = (v.get('ko') or '').strip()
    if not ko:
        return True
    ai = v.get('ai') or {}
    # 지난번 AI 문장을 그대로 두고 메모만 고쳤으면 다시 다듬는다
    return bool(ai) and ko == (ai.get('ko') or '').strip() and memo != (ai.get('memo') or '').strip()


def user_prompt(key, v):
    celeb, _, title = key.partition('|')
    parts = [
        '연예인: ' + celeb,
        '도서명: ' + title,
        '매체: ' + (v.get('outlet') or '(알 수 없음)'),
        '출처: ' + (v.get('source') or '(없음)'),
        '',
        '편집자 메모 (근거):',
        (v.get('memo') or '').strip(),
    ]
    if v.get('quote'):
        parts += ['', '참고 — 수집기가 출처에서 떠온 인용 (사실 확인용):', v['quote']]
    if v.get('context'):
        parts += ['', '참고 — 앞뒤 문단 (사실 확인용):', v['context']]
    return '\n'.join(parts)


def polish(client, key, v):
    """한 항목을 다듬어 {ko, en, grade, note} 를 돌려준다. 실패하면 예외."""
    # 안전 분류기가 드물게 거절할 수 있다. fallbacks="default" 를 켜 두면
    # 같은 요청을 서버가 다른 모델로 다시 돌려준다.
    resp = client.beta.messages.create(
        model=MODEL,
        max_tokens=4000,
        betas=['server-side-fallback-2026-07-01'],
        fallbacks='default',
        system=SYSTEM,
        output_config={
            'effort': 'low',
            'format': {'type': 'json_schema', 'schema': SCHEMA},
        },
        messages=[{'role': 'user', 'content': user_prompt(key, v)}],
    )
    if resp.stop_reason == 'refusal':
        raise RuntimeError('모델이 거절함')
    if resp.stop_reason == 'max_tokens':
        raise RuntimeError('응답이 잘림')
    text = next((b.text for b in resp.content if b.type == 'text'), '')
    out = json.loads(text)
    if not out.get('ko', '').strip():
        raise RuntimeError('빈 문장')
    out['model'] = resp.model
    return out


def apply_result(comments, key, r):
    """다듬은 결과 하나를 항목에 넣는다. 그새 사람이 손댔으면 건너뛴다."""
    v = comments.get(key)
    if v is None or not needs_polish(v):
        return False
    if (v.get('memo') or '').strip() != r['memo']:
        return False               # 그새 메모가 또 바뀌었다 — 다음 실행 때 다시
    v['ko'] = r['ko'].strip()
    v['en'] = r['en'].strip()
    v['grade'] = r['grade']
    v['ai'] = {
        'memo': r['memo'],
        'ko': v['ko'],
        'en': v['en'],
        'note': r.get('note', '').strip(),
        'model': r.get('model', MODEL),
        'at': r['at'],
    }
    return True


def load():
    with open(PATH, encoding='utf-8') as f:
        return json.load(f)


def save(doc):
    doc['_updated'] = time.strftime('%Y-%m-%d')
    with open(PATH, 'w', encoding='utf-8') as f:
        json.dump(doc, f, ensure_ascii=False, indent=2)
        f.write('\n')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--limit', type=int, default=50)
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--only', default='')
    ap.add_argument('--save-results')
    ap.add_argument('--apply')
    args = ap.parse_args()

    doc = load()
    comments = doc.setdefault('comments', {})

    if args.apply:
        with open(args.apply, encoding='utf-8') as f:
            results = json.load(f)
        n = sum(apply_result(comments, k, r) for k, r in results.items())
        print('저장해 둔 결과 %d건 중 %d건 다시 적용' % (len(results), n))
        if n:
            save(doc)
        return 0

    only = {k.strip() for k in args.only.split(',') if k.strip()}
    todo = [k for k, v in comments.items()
            if (not only or k in only) and needs_polish(v)]
    if args.limit:
        todo = todo[:args.limit]
    print('다듬을 항목 %d건' % len(todo))
    if not todo:
        return 0

    if not os.environ.get('ANTHROPIC_API_KEY'):
        print('ANTHROPIC_API_KEY 가 없어 건너뜁니다. '
              '저장소 Settings → Secrets and variables → Actions 에 넣어 주세요.')
        return 0

    import anthropic
    client = anthropic.Anthropic()

    results, failed = {}, 0
    today = time.strftime('%Y-%m-%d')
    for i, k in enumerate(todo, 1):
        v = comments[k]
        try:
            r = polish(client, k, v)
        except (anthropic.APIError, RuntimeError, ValueError) as e:
            failed += 1
            print('  [%d/%d] %-36.36s  실패 (%s)' % (i, len(todo), k, e))
            continue
        r['memo'] = (v.get('memo') or '').strip()
        r['at'] = today
        results[k] = r
        print('  [%d/%d] %-36.36s  %s · %s' % (i, len(todo), k, r['grade'], r['ko']))
        if r.get('note'):
            print('         ⚠ ' + r['note'])

    print('\n다듬음 %d건 · 실패 %d건' % (len(results), failed))
    if failed and not results:
        return 1                   # 키가 틀렸거나 API 가 막힘 — 워크플로를 빨갛게 둔다
    if args.dry_run:
        print('연습 모드 — 파일은 그대로 둡니다.')
        return 0
    if args.save_results:
        with open(args.save_results, 'w', encoding='utf-8') as f:
            json.dump(results, f, ensure_ascii=False, indent=2)
    n = sum(apply_result(comments, k, r) for k, r in results.items())
    if n:
        save(doc)
        print('%s 에 썼습니다. 편집기의 💬 코멘트 검수 창에서 확인하고 승인하세요.' % PATH)
    return 0


if __name__ == '__main__':
    sys.exit(main())
