#!/usr/bin/env python3
"""알라딘 저자 번호 구간을 훑어 '배우·가수 등 + 저자의 추천 도서가 있는' 사람을 모은다.
우리 리스트(data.csv)에 이미 있는 사람은 제외하고 data/aladin_recommend_new.csv 로 낸다.

  python3 tools/scan_aladin_recommend.py --start 120000 --end 300000 --threads 6

하루치씩 조금씩 훑기 (GitHub Actions 가 매일 돌린다 — .github/workflows/aladin-scan.yml):
  python3 tools/scan_aladin_recommend.py --daily 4000
  data/aladin_scan_state.json 의 queue(구간 목록) 앞에서부터 N개 번호를 보고 커서를 옮긴다.
  찾은 사람은 data/aladin_scan_hits.jsonl 에 덧붙이고 data/aladin_recommend_new.csv 를 다시 만든다.

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
    ap.add_argument("--start", type=int); ap.add_argument("--end", type=int)
    ap.add_argument("--threads", type=int, default=6)
    ap.add_argument("--out", default="data/aladin_recommend_new.csv")
    ap.add_argument("--daily", type=int, default=0, help="하루치: 상태 파일의 큐 앞에서 N개만")
    ap.add_argument("--state", default="data/aladin_scan_state.json")
    ap.add_argument("--hits", default="data/aladin_scan_hits.jsonl")
    a = ap.parse_args()
    if a.daily: return daily(a)
    if a.start is None or a.end is None: ap.error("--start/--end 또는 --daily 가 필요합니다")
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

def daily(a):
    st = json.load(open(a.state, encoding="utf-8"))
    q = st["queue"]
    ids = []
    while q and len(ids) < a.daily:
        lo, hi = q[0]
        take = min(a.daily - len(ids), hi - lo)
        ids += range(lo, lo + take)
        if lo + take >= hi: q.pop(0)
        else: q[0][0] = lo + take
    if not ids:
        print("훑을 번호가 없습니다 (큐가 비었어요)", file=sys.stderr); return
    n_hit = 0
    with ThreadPoolExecutor(min(a.threads, 4)) as ex, open(a.hits, "a", encoding="utf-8") as f:
        for r in ex.map(scan, ids):
            if r["name"] and r.get("items"):
                f.write(json.dumps(r, ensure_ascii=False) + "\n"); n_hit += 1
    st["scanned"] = st.get("scanned", 0) + len(ids)
    st["updated"] = time.strftime("%Y-%m-%d")
    json.dump(st, open(a.state, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"{ids[0]}~{ids[-1]} {len(ids)}개 확인, {n_hit}명 발견, 남은 구간 {q}", file=sys.stderr)
    write(a.out, a.hits)

def write(out, log=LOG):
    ours = set()
    root = os.path.join(os.path.dirname(__file__), "..", "data.csv")
    for r in csv.DictReader(open(root, encoding="utf-8")): ours.add(F.base_name(r["연예인"]))
    rows = []
    seen = set()
    for l in open(log, encoding="utf-8"):
        d = json.loads(l)
        if d.get("name") and d.get("items") and d["name"] not in ours and d["id"] not in seen:
            seen.add(d["id"]); rows.append(d)
    with open(out, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f); w.writerow(["이름", "알라딘번호", "직업", "도서명", "저자", "출판사", "추천사", "확인필요", "출처"])
        for d in sorted(rows, key=lambda x: x["name"]):
            c = {"job": d["job"], "동명후보": []}
            for it in d["items"]:
                w.writerow([d["name"], d["id"], d["job"], it["도서명"], it["저자"], it["출판사"], it["추천사"], F.flags(c, it), F.REC.format(i=d["id"])])
    print(f"{len(rows)}명 -> {out}", file=sys.stderr)

if __name__ == "__main__":
    main()
