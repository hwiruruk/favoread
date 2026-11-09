"""책 취향 매칭 페이지(editor/match.html)용 분야 색인 — editor/match-books.json.

{ "도서명": "분야" } 만 담는다. 분야는 tools/taste.py 와 같은 규칙(편집기 분야 검수 data/genres.json 우선,
없으면 예스24 카테고리)으로 정한다. 모르는 책은 담지 않고, 페이지는 '기타'로 묶는다.
네트워크를 쓰지 않는다. tools/build_site.sh 가 사이트 생성 때 함께 돌린다.
"""
import json, os, sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
sys.path.insert(0, os.path.join(ROOT, 'tools'))
import taste


def load(path, key):
    try:
        with open(os.path.join(ROOT, path), encoding='utf-8') as f:
            return json.load(f).get(key) or {}
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def main():
    subjects = load('data/categories.json', 'books')
    for t, g in load('data/genres.json', 'genres').items():
        if (g or {}).get('genre'):
            subjects[t] = dict(subjects.get(t) or {}, genre_override=g['genre'])
    out = {}
    for t in subjects:
        g = taste._genre_of(subjects, t)
        if g:
            out[t] = g[0]
    path = os.path.join(ROOT, 'editor', 'match-books.json')
    body = json.dumps({'genres': out}, ensure_ascii=False, sort_keys=True, separators=(',', ':')) + '\n'
    try:
        if open(path, encoding='utf-8').read() == body:
            return
    except FileNotFoundError:
        pass
    with open(path, 'w', encoding='utf-8') as f:
        f.write(body)
    print(f'editor/match-books.json {len(out)}권')


if __name__ == '__main__':
    main()
