#!/usr/bin/env python3
"""
data/bios.json에 없는 셀럽에 대해 위키피디아 REST API로 한 줄 소개를 채워주는 스크립트.

사용법:
    python3 tools/fetch_bios.py                # 한국 위키만
    python3 tools/fetch_bios.py --en           # 영문 위키도 함께
    python3 tools/fetch_bios.py --overwrite    # 기존 항목도 덮어쓰기

GitHub Actions에서 돌리지 말고 로컬에서 가끔 실행하세요 (위키 rate limit).
"""

import argparse, csv, json, os, sys, time, re
import urllib.request, urllib.parse, urllib.error

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BIOS_PATH = os.path.join(ROOT, 'data', 'bios.json')
CSV_PATH  = os.path.join(ROOT, 'data.csv')

UA = 'favorbook-bio/1.0 (https://favorbook.co.kr; contact via instagram @favoritesbook)'

# 괄호/소속 표기 제거 — 위키 표제어와 매칭 가능성 ↑
PAREN_RE = re.compile(r'\s*\([^)]*\)\s*$')

def wiki_summary(name, lang='ko'):
    """{title, description, extract} or None"""
    title = PAREN_RE.sub('', name).strip()
    if not title:
        return None
    url = f'https://{lang}.wikipedia.org/api/rest_v1/page/summary/' + urllib.parse.quote(title)
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        print(f'  ! HTTP {e.code} for {title} ({lang})', file=sys.stderr)
        return None
    except Exception as e:
        print(f'  ! error for {title} ({lang}): {e}', file=sys.stderr)
        return None


def one_line(extract, max_len=160):
    """추출문에서 첫 문장 1~2개만 잘라 한 줄 소개로."""
    if not extract:
        return ''
    text = extract.strip().replace('\n', ' ')
    sents = re.split(r'(?<=[.!?。])\s+', text)
    out = sents[0] if sents else text
    if len(out) < 60 and len(sents) > 1:
        out += ' ' + sents[1]
    if len(out) > max_len:
        out = out[:max_len - 1].rstrip() + '…'
    return out.strip()


def load_bios():
    if os.path.exists(BIOS_PATH):
        with open(BIOS_PATH, encoding='utf-8') as f:
            return json.load(f)
    return {'_comment': '', '_updated': '', 'bios': {}}


def save_bios(d):
    with open(BIOS_PATH, 'w', encoding='utf-8') as f:
        json.dump(d, f, ensure_ascii=False, indent=2)
    print(f'✅ saved → {BIOS_PATH}')


def csv_celebs():
    celebs = []
    seen = set()
    with open(CSV_PATH, encoding='utf-8') as f:
        r = csv.reader(f)
        next(r)
        for row in r:
            if not row or not row[0].strip(): continue
            name = row[0].strip()
            if name in seen: continue
            seen.add(name)
            name_en = row[1].strip() if len(row) > 1 else ''
            celebs.append((name, name_en))
    return celebs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--en', action='store_true', help='영문 위키도 함께 갱신')
    ap.add_argument('--overwrite', action='store_true', help='기존 항목 덮어쓰기')
    ap.add_argument('--limit', type=int, default=0, help='최대 N명만 처리(0=전체)')
    ap.add_argument('--sleep', type=float, default=0.5, help='요청 간 sleep 초')
    args = ap.parse_args()

    data = load_bios()
    bios = data.setdefault('bios', {})

    targets = csv_celebs()
    if args.limit:
        targets = targets[:args.limit]

    new_ko = new_en = 0
    for i, (name, name_en) in enumerate(targets):
        entry = bios.setdefault(name, {'ko': '', 'en': ''})
        need_ko = args.overwrite or not entry.get('ko')
        need_en = args.en and (args.overwrite or not entry.get('en'))
        if not need_ko and not need_en:
            continue
        print(f'[{i+1}/{len(targets)}] {name}', end=' ', flush=True)

        if need_ko:
            s = wiki_summary(name, 'ko')
            if s and s.get('type') == 'standard':
                line = one_line(s.get('extract') or s.get('description') or '')
                if line:
                    entry['ko'] = line
                    new_ko += 1
                    print('[ko✓]', end=' ')
            time.sleep(args.sleep)

        if need_en and name_en:
            s = wiki_summary(name_en, 'en')
            if s and s.get('type') == 'standard':
                line = one_line(s.get('extract') or s.get('description') or '')
                if line:
                    entry['en'] = line
                    new_en += 1
                    print('[en✓]', end=' ')
            time.sleep(args.sleep)

        print()

    import datetime
    data['_updated'] = datetime.date.today().isoformat()
    save_bios(data)
    print(f'📊 새로 채운 항목: ko {new_ko}, en {new_en}')


if __name__ == '__main__':
    main()
