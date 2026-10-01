#!/usr/bin/env python3
"""책 분야(KDC)와 키워드를 국립중앙도서관·도서관 정보나루에서 받아 data/subjects.json 에 채우는 배치.

'책 취향' 통계(tools/taste.py)의 재료다. 예스24에는 책별 분야가 없어서 공공 도서관 데이터를 쓴다.

    예스24 상품 번호 ──(itemDetail)──▶ ISBN13
    ISBN13 ──(국립중앙도서관 ISBN 서지정보)──▶ KDC 분류번호 · 부가기호
    ISBN13 ──(도서관 정보나루 도서 상세)──▶ KDC 분류번호 · 분류 이름
    ISBN13 ──(도서관 정보나루 키워드)──▶ 책 키워드 (단어 · 가중치)

두 기관을 같이 쓰는 이유: 국립중앙도서관은 출판사가 등록한 서지라 신간까지 빠짐없이 있고,
정보나루는 공공도서관이 실제로 정리한 분류와 책 키워드가 있다. 분류는 정보나루를 먼저 쓰고,
없으면 국립중앙도서관 KDC, 그것도 없으면 부가기호 끝 세 자리(내용 분류)를 쓴다.
키 하나만 있어도 돈다 (그 기관 정보만 채운다).

ISBN은 예스24에서 받는다. 책 정보(data/bookinfo.json)에 있는 예스24 상품 번호로 조회하니
제목 검색처럼 엉뚱한 책이 붙을 일이 없다.

네트워크 오류는 기록하지 않는다 — 잠깐 흔들린 책이 영영 건너뛰어지면 안 되니까.
키가 틀렸거나 하루 호출 한도를 넘으면 거기서 멈추고, 그때까지 받은 것만 저장한다.

실행
    export NL_API_KEY=...          # 국립중앙도서관 ISBN 서지정보 Open API 인증키
    export LIBRARY_API_KEY=...     # 도서관 정보나루(data4library.kr) 인증키
    export YES24_PROXY=https://<worker>.workers.dev     # 또는 YES24_API_KEY
    python3 tools/fetch_subjects.py --count
    python3 tools/fetch_subjects.py --limit 20 --dry-run
    python3 tools/fetch_subjects.py

옵션
    --count       조회 대상 권수만 출력하고 끝
    --limit N     이번에 조회할 책 수 (0=무제한). 정보나루는 하루 호출 한도가 있어 워크플로는 200권씩 돈다
    --dry-run     파일에 쓰지 않고 결과만 출력
    --refresh     못 찾은 책도 다시 조회
    --sleep SEC   호출 간 대기 (기본 0.3초)

data/subjects.json 은 손으로 고쳐도 된다. 이미 있는 책은 다시 조회하지 않는다.
분류를 고치려면 그 책의 kdc 를 바꾸면 된다 (taste.py 가 kdc 만 보고 분야를 정한다).
"""
import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fetch_bookinfo as fb  # noqa: E402  예스24 호출을 그대로 쓴다

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BOOKINFO = os.path.join(ROOT, 'data', 'bookinfo.json')
OUT_PATH = os.path.join(ROOT, 'data', 'subjects.json')
UA = {'User-Agent': 'favorbook-subjects/1.0'}
NL_URL = 'https://www.nl.go.kr/seoji/SearchApi.do'
D4L_URL = 'http://data4library.kr/api/'
MAX_KEYWORDS = 15
ISBN_RE = re.compile(r'97[89]\d{10}')
KDC_RE = re.compile(r'\d{3}(\.\d+)?')


def http_json(url, timeout=20):
    req = urllib.request.Request(url, headers=UA)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode('utf-8', 'replace'))
    except urllib.error.HTTPError as e:
        if e.code in (401, 403):
            raise fb.Fatal('%s 인증 실패 (HTTP %d)' % (url.split('?')[0], e.code))
        raise fb.Transient('HTTP %d' % e.code)
    except json.JSONDecodeError:
        raise fb.Transient('JSON 아님')
    except Exception as e:
        raise fb.Transient(str(e))


RETRY_WAITS = (3, 10)    # 연결이 끊기면 이만큼(초) 쉬고 다시 묻는다


def retry(label, fn, *args):
    """일시적 오류(연결 거부·타임아웃)는 잠깐 쉬고 다시 부른다. 첫 실행에서 다섯 권에 한 번꼴
    'Connection refused' 가 나서 200권 중 40권을 놓쳤다."""
    for wait in RETRY_WAITS + (None,):
        try:
            return fn(*args)
        except fb.Transient as e:
            if wait is None:
                raise fb.Transient('%s: %s' % (label, e))
            time.sleep(wait)


# ── ISBN (예스24) ───────────────────────────────────────────────────
def find_isbn(it):
    """예스24 응답에서 ISBN13 을 찾는다. 필드 이름이 문서에 확실치 않아 'isbn' 이 든 키를 다 본다."""
    found = []

    def walk(x):
        if isinstance(x, dict):
            for k, v in x.items():
                if 'isbn' in k.lower() and isinstance(v, (str, int)):
                    s = re.sub(r'[^0-9]', '', str(v))
                    if ISBN_RE.fullmatch(s):
                        found.append((0 if '13' in k else 1, 'set' in k.lower(), s))
                elif isinstance(v, (dict, list)):
                    walk(v)
        elif isinstance(x, list):
            for v in x:
                walk(v)
    walk(it)
    found.sort()   # isbn13 이름 우선, 세트 ISBN 은 뒤로
    return found[0][2] if found else ''


# ── 국립중앙도서관 ───────────────────────────────────────────────────
def nl_lookup(isbn, key):
    qs = urllib.parse.urlencode({'cert_key': key, 'result_style': 'json',
                                 'page_no': 1, 'page_size': 10, 'isbn': isbn})
    d = http_json(NL_URL + '?' + qs)
    docs = d.get('docs')
    if docs is None:
        msg = d.get('ERR_MESSAGE') or d.get('RESULT') or d.get('message') or str(d)[:120]
        if re.search(r'인증|cert|key|KEY|활성|한도|초과', str(msg)):
            raise SourceOff('국립중앙도서관: %s' % msg)
        raise fb.Transient('국립중앙도서관: %s' % msg)
    if not docs:
        return None
    doc = next((x for x in docs if re.sub(r'\D', '', x.get('EA_ISBN') or '') == isbn), docs[0])
    kdc = (doc.get('KDC') or '').strip()
    return {
        'kdc': kdc if KDC_RE.match(kdc) else '',
        'add_code': (doc.get('EA_ADD_CODE') or doc.get('SET_ADD_CODE') or '').strip(),
        'subject': (doc.get('SUBJECT') or '').strip(),
    }


class SourceOff(Exception):
    """한 기관만 못 쓰게 됐다 (키가 아직 활성화 전·하루 한도 초과 등). 그 기관만 끄고 나머지로 계속한다."""


# ── 도서관 정보나루 ──────────────────────────────────────────────────
def d4l_call(path, params, key):
    qs = urllib.parse.urlencode({'authKey': key, 'format': 'json', **params})
    d = http_json(D4L_URL + path + '?' + qs)
    res = d.get('response') or {}
    err = res.get('error')
    if err:
        # 키 활성화 전·키 오류·하루 한도 초과 — 이번 실행에서는 정보나루를 끈다
        raise SourceOff('도서관 정보나루: %s' % err)
    return res


def d4l_detail(isbn, key):
    res = d4l_call('srchDtlList', {'isbn13': isbn, 'loaninfoYN': 'N'}, key)
    det = res.get('detail') or []
    if not det:
        return None
    book = (det[0] or {}).get('book') or {}
    kdc = (book.get('class_no') or '').strip()
    return {
        'kdc': kdc if KDC_RE.match(kdc) else '',
        'class_nm': (book.get('class_nm') or '').strip(),
        'add_code': (book.get('addition_symbol') or '').strip(),
    }


def d4l_keywords(isbn, key):
    res = d4l_call('keywordList', {'isbn13': isbn, 'additionalYN': 'N'}, key)
    out = []
    for x in res.get('items') or []:
        it = (x or {}).get('item') or x or {}
        w = (it.get('word') or '').strip()
        try:
            wt = round(float(it.get('weight') or 0), 2)
        except ValueError:
            wt = 0
        if w:
            out.append([w, wt])
    out.sort(key=lambda p: -p[1])
    return out[:MAX_KEYWORDS]


def best_kdc(nl, d4):
    """정보나루 → 국립중앙도서관 → 부가기호 끝 세 자리 순서로 고른다."""
    if d4 and d4.get('kdc'):
        return d4['kdc'], 'd4l'
    if nl and nl.get('kdc'):
        return nl['kdc'], 'nl'
    for src in (nl, d4):
        code = re.sub(r'\D', '', (src or {}).get('add_code') or '')
        if len(code) == 5:
            return code[2:], 'add_code'
    return '', ''


# ── 실행 ────────────────────────────────────────────────────────────
def load_json(path):
    try:
        with open(path, encoding='utf-8') as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--count', action='store_true')
    ap.add_argument('--limit', type=int, default=0)
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--refresh', action='store_true')
    ap.add_argument('--sleep', type=float, default=0.3)
    args = ap.parse_args()

    nl_key = os.environ.get('NL_API_KEY', '').strip()
    d4_key = os.environ.get('LIBRARY_API_KEY', '').strip()
    want = [s for s, k in (('nl', nl_key), ('d4l', d4_key)) if k]

    bookinfo = load_json(BOOKINFO).get('books') or {}
    prev = load_json(OUT_PATH)
    have, misses = prev.get('books') or {}, prev.get('misses') or {}

    def needs(t):
        if t in have:   # 나중에 키를 하나 더 넣었으면 그 기관 것만 마저 받는다
            return any(s not in (have[t].get('tried') or []) for s in want)
        return args.refresh or t not in misses
    todo = sorted(t for t, v in bookinfo.items() if v.get('itemId') and needs(t))

    if args.count:
        print(len(todo))
        return

    proxy = os.environ.get('YES24_PROXY', '').strip()
    y24_key = os.environ.get('YES24_API_KEY', '').strip()
    if not nl_key and not d4_key:
        sys.exit('NL_API_KEY 나 LIBRARY_API_KEY 중 하나는 있어야 합니다. (tools/TASTE.md 참고)')
    if not proxy and not y24_key:
        sys.exit('ISBN을 받으려면 YES24_PROXY 또는 YES24_API_KEY 가 필요합니다.')
    if args.limit:
        todo = todo[:args.limit]
    print('책 정보 %d권 · 분야 확인 %d · 실패 기록 %d · 이번에 조회 %d (국립중앙도서관 %s · 정보나루 %s)'
          % (len(bookinfo), len(have), len(misses), len(todo),
             '켬' if nl_key else '끔', '켬' if d4_key else '끔'))

    on = {'nl': bool(nl_key), 'd4l': bool(d4_key)}
    ok = fail = net = streak = 0
    for i, t in enumerate(todo, 1):
        try:
            isbn = (have.get(t) or {}).get('isbn') or find_isbn(
                retry('예스24', fb.item_detail, bookinfo[t]['itemId'], proxy, y24_key))
            time.sleep(args.sleep)
            if not isbn:
                misses[t] = '예스24 응답에 ISBN 없음 (goods %s)' % bookinfo[t]['itemId']
                fail += 1
                print('  [%d/%d] ✗ %s — %s' % (i, len(todo), t, misses[t]))
                continue
            old = have.get(t) or {}
            tried = set(old.get('tried') or [])
            nl = d4 = None
            kw = old.get('keywords') or []
            if on['nl'] and 'nl' not in tried:
                try:
                    nl = retry('국립중앙도서관', nl_lookup, isbn, nl_key) or {}
                    tried.add('nl')
                except SourceOff as e:
                    on['nl'] = False
                    print('\n%s\n→ 이번 실행에서는 국립중앙도서관을 빼고 계속합니다.\n' % e)
                time.sleep(args.sleep)
            if nl is None and (old.get('nl_kdc') or old.get('add_code')):
                nl = {'kdc': old.get('nl_kdc', ''), 'add_code': old.get('add_code', '')}
            if on['d4l'] and 'd4l' not in tried:
                try:
                    d4 = retry('정보나루', d4l_detail, isbn, d4_key) or {}
                    time.sleep(args.sleep)
                    kw = retry('정보나루', d4l_keywords, isbn, d4_key)
                    tried.add('d4l')
                except SourceOff as e:
                    on['d4l'] = False
                    d4 = None
                    kw = old.get('keywords') or []
                    print('\n%s\n→ 이번 실행에서는 정보나루를 빼고 계속합니다 (키워드는 나중에 다시 돌리면 채워집니다).\n' % e)
                time.sleep(args.sleep)
            if d4 is None and (old.get('class_nm') or old.get('kdc_from') == 'd4l'):
                d4 = {'kdc': old.get('kdc', '') if old.get('kdc_from') == 'd4l' else '',
                      'class_nm': old.get('class_nm', '')}
            if not (tried - set(old.get('tried') or [])):
                # 이 책은 어느 기관에도 새로 묻지 못했다 — 둘 다 꺼졌으면 멈춘다
                if not on['nl'] and not on['d4l']:
                    print('조회할 수 있는 기관이 없어 멈춥니다. 여기까지 받은 것만 저장합니다.')
                    break
                continue
            kdc, src = best_kdc(nl, d4)
            if not kdc and not kw:
                misses[t] = '도서관 데이터에 분류·키워드 없음 (ISBN %s)' % isbn
                fail += 1
                print('  [%d/%d] ✗ %s — %s' % (i, len(todo), t, misses[t]))
                continue
            have[t] = {
                'isbn': isbn,
                'kdc': kdc,
                'kdc_from': src,
                'class_nm': (d4 or {}).get('class_nm', ''),
                'nl_kdc': (nl or {}).get('kdc', ''),
                'add_code': (nl or {}).get('add_code') or (d4 or {}).get('add_code', ''),
                'keywords': kw,
                'tried': sorted(tried),
            }
            misses.pop(t, None)
            ok += 1
            streak = 0
            print('  [%d/%d] ✓ %s — KDC %s%s · 키워드 %d개'
                  % (i, len(todo), t, kdc or '-', ' (%s)' % have[t]['class_nm'] if have[t]['class_nm'] else '', len(kw)))
        except fb.Missing as e:
            misses[t] = '예스24에 없음 (%s, goods %s)' % (e, bookinfo[t]['itemId'])
            fail += 1
            streak = 0
            print('  [%d/%d] ✗ %s — %s' % (i, len(todo), t, misses[t]))
        except fb.Transient as e:
            streak += 1
            net += 1
            print('  [%d/%d] ⚠ %s — %s (기록 안 함)' % (i, len(todo), t, e))
            if streak >= 8:
                print('\n일시적 오류가 %d번 연달아 났습니다. 키·네트워크를 확인하고 나중에 다시 돌려 주세요.' % streak)
                break
        except fb.Fatal as e:
            print('\n' + str(e) + '\n여기까지 받은 것만 저장합니다.')
            break

    print('\n찾음 %d · 없음 %d · 일시적 오류 %d · 합계 분야 확인 %d / %d권'
          % (ok, fail, net, len(have), len(bookinfo)))
    if args.dry_run:
        print('--dry-run 이라 파일에 쓰지 않았습니다.')
        return
    if not ok and not fail:
        print('새로 받은 게 없어 파일을 그대로 둡니다.')
        return
    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, 'w', encoding='utf-8') as f:
        json.dump({
            'generated': time.strftime('%Y-%m-%d'),
            'note': '책 분야(KDC)·키워드 (국립중앙도서관·도서관 정보나루). tools/fetch_subjects.py 가 채운다. '
                    '손으로 고쳐도 된다(이미 있는 책은 다시 조회하지 않는다).',
            'books': dict(sorted(have.items())),
            'misses': dict(sorted(misses.items())),
        }, f, ensure_ascii=False, indent=1)
        f.write('\n')


if __name__ == '__main__':
    main()
