#!/usr/bin/env python3
"""내용이 바뀐 셀럽·책 페이지를 IndexNow로 검색엔진에 알린다.

IndexNow는 "이 주소가 바뀌었으니 다시 가져가 달라"고 알리는 공개 규약이다.
한 곳(api.indexnow.org)에 보내면 참여 검색엔진(빙, 네이버 등)이 나눠 받는다.
구글은 참여하지 않는다.

무엇이 바뀌었는지는 generate.py가 적는 data/page_lastmod.json의 지문(fp)을
두 커밋 사이에서 비교해 고른다. 디자인만 바뀐 페이지는 지문이 같아 빠진다.

  python3 tools/indexnow_ping.py HEAD^ HEAD           # 알림 보내기
  python3 tools/indexnow_ping.py HEAD^ HEAD --dry-run # 보낼 주소만 출력

키는 사이트 루트의 <키>.txt 파일(내용 = 키)이다. 공개돼도 되는 값이다.
알림이 실패해도 사이트 생성에는 영향이 없도록 항상 0으로 끝낸다.
"""
import glob, json, os, re, subprocess, sys, urllib.request
from urllib.parse import quote

HOST = 'favorbook.co.kr'
BASE = 'https://' + HOST + '/'
ENDPOINT = 'https://api.indexnow.org/indexnow'
LASTMOD_FILE = 'data/page_lastmod.json'
MAX_URLS = 10000   # IndexNow 한 번에 보낼 수 있는 최대 개수


def find_key():
    for p in glob.glob('*.txt'):
        name = os.path.basename(p)[:-4]
        if re.fullmatch(r'[0-9a-f]{32}', name):
            with open(p, encoding='utf-8') as f:
                if f.read().strip() == name:
                    return name
    return ''


def lastmod_at(rev):
    r = subprocess.run(['git', 'show', rev + ':' + LASTMOD_FILE],
                       capture_output=True, check=False)
    if r.returncode != 0:
        return {}
    try:
        return json.loads(r.stdout.decode('utf-8'))
    except json.JSONDecodeError:
        return {}


def changed_urls(old, new):
    urls = []
    for path, v in sorted(new.items()):
        if (old.get(path) or {}).get('fp') != v.get('fp'):
            urls.append(BASE + quote(path, safe='/'))
    return urls


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    dry = '--dry-run' in sys.argv
    if len(args) != 2:
        print(__doc__)
        return
    old = lastmod_at(args[0])
    new = lastmod_at(args[1])
    if not old:
        # 처음 기록이 생긴 커밋이면 전부 '바뀐 것'이 되어 버린다 — 보내지 않는다
        print('IndexNow: 이전 기록이 없어 건너뜀')
        return
    urls = changed_urls(old, new)[:MAX_URLS]
    print(f'IndexNow: 내용이 바뀐 페이지 {len(urls)}개')
    for u in urls[:20]:
        print('  ' + u)
    if not urls or dry:
        return
    key = find_key()
    if not key:
        print('IndexNow: 키 파일(<키>.txt)이 없어 건너뜀')
        return
    body = json.dumps({'host': HOST, 'key': key,
                       'keyLocation': BASE + key + '.txt',
                       'urlList': urls}).encode('utf-8')
    req = urllib.request.Request(ENDPOINT, data=body, method='POST',
                                 headers={'Content-Type': 'application/json; charset=utf-8'})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            print(f'IndexNow: 응답 {r.status}')
    except Exception as e:   # 202(접수)·200 말고는 여기로 온다
        print(f'IndexNow: 보내기 실패 — {e}')


if __name__ == '__main__':
    main()
