#!/usr/bin/env python3
"""알라딘 저자 번호 구간을 훑어 '배우·가수 등 + 저자의 추천 도서가 있는' 사람을 모은다.
우리 리스트(data.csv)에 이미 있는 사람은 제외하고 data/aladin_recommend_new.csv 로 낸다.

  python3 tools/scan_aladin_recommend.py --start 120000 --end 300000 --threads 6

- 중간에 끊겨도 tools/.aladin_scan.jsonl 에 쌓아 두어 이어서 돈다(이미 본 번호는 건너뜀).
- 직업에 배우·가수 등이 들어간 사람만 남긴다(JOBS). 직업이 비어 있는 사람은 제외한다.
- 알라딘 서버에 무리가 가지 않게 스레드는 6개 이하로, 요청마다 짧게 쉰다.
"""
import argparse, csv, json, os, re, sys, threading, time
from concurrent.futures import ThreadPoolExecutor
sys.path.insert(0, os.path.dirname(__file__))
import fetch_aladin_recommend as F

JOBS = re.compile(r"배우|가수|탤런트|아이돌|뮤지컬|모델|개그|코미디|방송|예능|MC|성우|싱어송|래퍼|연기|감독|뮤지션")
LOG = os.path.join(os.path.dirname(__file__), ".aladin_scan.jsonl")
lock = threading.Lock()

def scan(i):
    time.sleep(0.15)
    page = F.get(F.REC.format(i=i))
    m = re.search(r"<title>(.*?)의 추천 작품", page)
    if not m: return {"id": i, "name": None}
    name = m.group(1).strip()
    r = F.parse(page, name)
    if not r: return {"id": i, "name": None}
    nat = re.search(r"국적:\s*\n(.*?)\n(.*?)\n", F.text(page))
    if nat and "대한민국" not in nat.group(1) + nat.group(2):  # 한국 연예인만
        return {"id": i, "name": name, "job": r["job"], "items": []}
    return {"id": i, "name": name, "job": r["job"], "items": r["items"] if JOBS.search(r["job"]) else []}

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--start", type=int, required=True); ap.add_argument("--end", type=int, required=True)
    ap.add_argument("--threads", type=int, default=6)
    ap.add_argument("--out", default="data/aladin_recommend_new.csv")
    a = ap.parse_args()
    done = set()
    if os.path.exists(LOG):
        for l in open(LOG, encoding="utf-8"):
            try: done.add(json.loads(l)["id"])
            except Exception: pass
    todo = [i for i in range(a.start, a.end) if i not in done]
    print(f"할 일 {len(todo)}개 (이미 본 {len(done)}개)", file=sys.stderr)
    f = open(LOG, "a", encoding="utf-8")
    n = 0
    with ThreadPoolExecutor(min(a.threads, 6)) as ex:
        for r in ex.map(scan, todo):
            with lock:
                if r["name"] and r.get("items"):
                    f.write(json.dumps(r, ensure_ascii=False) + "\n")
                else:
                    f.write(json.dumps({"id": r["id"], "name": None}) + "\n")
                f.flush()
            n += 1
            if r["name"] and r.get("items"): print(r["id"], r["name"], r["job"], len(r["items"]), file=sys.stderr, flush=True)
            if n % 2000 == 0: print(f"진행 {n}/{len(todo)}", file=sys.stderr, flush=True)
    write(a.out)

def write(out):
    ours = set()
    root = os.path.join(os.path.dirname(__file__), "..", "data.csv")
    for r in csv.DictReader(open(root, encoding="utf-8")): ours.add(F.base_name(r["연예인"]))
    rows = []
    for l in open(LOG, encoding="utf-8"):
        d = json.loads(l)
        if d.get("name") and d.get("items") and d["name"] not in ours:
            rows.append(d)
    with open(out, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f); w.writerow(["이름", "알라딘번호", "직업", "도서명", "저자", "출판사", "추천사", "확인필요", "출처"])
        for d in sorted(rows, key=lambda x: x["name"]):
            c = {"job": d["job"], "동명후보": []}
            for it in d["items"]:
                w.writerow([d["name"], d["id"], d["job"], it["도서명"], it["저자"], it["출판사"], it["추천사"], F.flags(c, it), F.REC.format(i=d["id"])])
    print(f"{len(rows)}명 -> {out}", file=sys.stderr)

if __name__ == "__main__":
    main()
