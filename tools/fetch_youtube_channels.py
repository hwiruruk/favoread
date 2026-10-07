"""유튜브 출처의 채널명을 모아 data/youtube_channels.json에 캐시한다.

도움 주신 곳(generate.py thanks_html)이 'YouTube' 대신 채널명을 보여 주려고 쓴다.
이미 받은 영상은 다시 묻지 않는다. 비공개·삭제된 영상은 빈 값으로 남긴다.
실행: python3 tools/fetch_youtube_channels.py
"""
import glob
import json
import os
import re
import time
import urllib.request
from urllib.parse import parse_qs, quote, urlparse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'data', 'youtube_channels.json')
UA = 'Mozilla/5.0 (favoread channel fetch)'


def video_id(url):
    p = urlparse(url)
    if 'youtu.be' in p.netloc:
        return p.path.strip('/')
    return (parse_qs(p.query).get('v') or [''])[0]


def main():
    cache = json.load(open(OUT, encoding='utf-8')) if os.path.exists(OUT) else {}
    urls = {}
    for f in glob.glob(os.path.join(ROOT, 'data', 'detail', '*.json')):
        for b in json.load(open(f, encoding='utf-8')).values():
            s = b.get('source', '')
            if re.search(r'youtube\.com|youtu\.be', s) and video_id(s):
                urls.setdefault(video_id(s), s)
    todo = [v for v in urls if v not in cache]
    print('영상 %d개 중 새로 %d개' % (len(urls), len(todo)))
    for v in todo:
        q = 'https://www.youtube.com/oembed?format=json&url=' + quote('https://www.youtube.com/watch?v=' + v, safe='')
        try:
            with urllib.request.urlopen(urllib.request.Request(q, headers={'User-Agent': UA}), timeout=15) as r:
                d = json.load(r)
            cache[v] = {'name': d.get('author_name', ''), 'url': d.get('author_url', '')}
        except Exception as e:
            print('  실패', v, e)
            cache[v] = {'name': '', 'url': ''}
        time.sleep(0.3)
    with open(OUT, 'w', encoding='utf-8') as fh:
        json.dump(cache, fh, ensure_ascii=False, indent=0, sort_keys=True)
        fh.write('\n')


if __name__ == '__main__':
    main()
