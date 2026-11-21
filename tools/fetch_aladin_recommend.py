#!/usr/bin/env python3
"""셀럽 이름 -> 알라딘 저자번호 자동 탐색 -> '저자의 추천' 도서·추천사 수집.

사용: python3 tools/fetch_aladin_recommend.py [--names 조인성,송강호] [--limit N] [--out 파일.csv]
      (--names 없으면 data.csv 의 '연예인' 열 전체. 이미 처리한 이름은 캐시로 건너뜀)
원리: 알라딘 DVD 검색 결과에서 AuthorSearch=@번호 후보를 얻고,
      각 후보의 wauthor_recommend 페이지 제목이 '<이름>의 추천 작품'인지 확인한다.
"""
import argparse, csv, html, json, os, re, sys, time, urllib.parse, urllib.request

UA = {"User-Agent": "Mozilla/5.0"}
SEARCH = "https://www.aladin.co.kr/search/wsearchresult.aspx?SearchTarget={t}&KeyWord={k}"
REC = "https://www.aladin.co.kr/author/wauthor_recommend.aspx?AuthorSearch=@{i}"
CACHE = os.path.join(os.path.dirname(__file__), ".aladin_cache.json")

def get(url):
    for _ in range(3):
        try:
            return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30).read().decode("utf-8", "ignore")
        except Exception:
            time.sleep(2)
    return ""

def base_name(n):  # 'RM(BTS)' -> 'RM', '상원(알파드라이브원)' -> '상원'
    return re.sub(r"\(.*", "", n).strip()

def candidates(name, full=None):
    ids = []
    qs = [name]
    if full and full != name:  # 'RM(BTS)' -> 'RM BTS' 도 검색
        qs.append(re.sub(r"[()]+", " ", full).strip())
    for q in qs:
        for t in ("DVD", "Music"):
            for i in re.findall(r"AuthorSearch=@(\d+)", get(SEARCH.format(t=t, k=urllib.parse.quote(q)))):
                if i not in ids: ids.append(i)
            time.sleep(0.4)
    return ids[:8]

def text(s):
    s = re.sub(r"<script.*?</script>|<style.*?</style>", "", s, flags=re.S)
    return html.unescape(re.sub(r"\n\s*\n+", "\n", re.sub(r"<[^>]+>", "\n", s)))

def parse(page, name):
    m = re.search(r"<title>(.*?)의 추천 작품", page)
    if not m or m.group(1).strip() != name:
        return None
    job = re.search(r"직업:\s*\n(.*?)\n", text(page))
    body = text(page[page.find("저자의추천"):])
    items = []
    for m in re.finditer(r"\n(\d+)\.\n(.*?)(?=\n\d+\.\n|\n전체선택|\Z)", body, flags=re.S):
        lines = [l.strip() for l in m.group(2).split("\n") if l.strip()]
        # 광고성 줄 제거: '사은품명' + '(…분야 N만원 이상)' 쌍
        drop = set()
        for j, l in enumerate(lines):
            if re.match(r"^\(.*(분야|이상).*\)$", l):
                drop.update({j, j - 1})
        lines = [l for j, l in enumerate(lines) if j not in drop and l not in ("미리보기", "크게보기", "Choice")]
        title = lines[0] if lines else ""
        di = next((j for j, l in enumerate(lines) if re.match(r"^\|?\s*\d{4}년", l)), len(lines))
        pub = lines[di - 1] if di >= 2 else ""
        mid = [l for l in lines[1:max(di - 1, 1)] if not l.startswith("- ")]
        author = " ".join(
            x for x in (re.sub(r"\s*\|\s*$", "", l).strip(" ,") for l in mid)
            if x and not re.match(r"^\((지은이|엮은이|옮긴이|그림|극본|감독|글|사진|편저|저자|역)", x)
        )
        pub = pub.strip("| ").strip()
        k = max((j for j, l in enumerate(lines) if l == "마이리스트"), default=-1)
        comment = " ".join(lines[k + 1:]) if k >= 0 else ""
        items.append({"도서명": title, "저자": author, "출판사": pub, "추천사": comment})
    return {"job": job.group(1).strip() if job else "", "items": items}

def flags(c, it):
    f = []
    if c.get("동명후보"): f.append("동명후보 " + "/".join(c["동명후보"]))
    if not c.get("job"): f.append("직업 미기재")
    if re.search(r"사은품|도서전|\[나도서점주인\]|\[세트\]|이벤트", it["도서명"]): f.append("도서명 판촉문구")
    if re.search(r"(^|\s)중에서\s*$", it["추천사"]) or it["추천사"].startswith("“") and it["추천사"].endswith("”"): f.append("인용 가능성")
    return "; ".join(f)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--names"); ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--out", default="aladin_recommend.csv")
    a = ap.parse_args()
    if a.names:
        names = a.names.split(",")
    else:
        root = os.path.join(os.path.dirname(__file__), "..", "data.csv")
        names = sorted({r["연예인"] for r in csv.DictReader(open(root, encoding="utf-8"))})
    if a.limit: names = names[:a.limit]
    cache = json.load(open(CACHE)) if os.path.exists(CACHE) else {}
    for n in names:
        if n in cache: continue
        q = base_name(n); hits = []
        for i in candidates(q, n):
            r = parse(get(REC.format(i=i)), q)
            time.sleep(0.4)
            if r and r["items"]:
                hits.append({"id": i, **r})
        found = hits[0] if hits else None
        if found: found["동명후보"] = [h["id"] for h in hits[1:]]
        cache[n] = found or {"id": None, "items": []}
        print(n, "->", cache[n]["id"], len(cache[n]["items"]), file=sys.stderr)
        json.dump(cache, open(CACHE, "w"), ensure_ascii=False)
    with open(a.out, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f); w.writerow(["연예인", "알라딘번호", "직업", "도서명", "저자", "출판사", "추천사", "확인필요", "출처"])
        for n in names:
            c = cache.get(n)
            if c and c["id"]:
                for it in c["items"]:
                    w.writerow([n, c["id"], c.get("job", ""), it["도서명"], it["저자"], it["출판사"], it["추천사"], flags(c, it), REC.format(i=c["id"])])
if __name__ == "__main__":
    main()
