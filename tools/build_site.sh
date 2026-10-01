#!/usr/bin/env bash
# 사이트 생성 — 워크플로(update-sitemap.yml)와 로컬에서 같이 쓴다.
#   1) generate.py      페이지·data.json 생성
#   2) make_og.py       바뀐 셀럽의 공유 미리보기 카드(og/*.jpg) 그리기 — data.json을 읽는다
#   3) generate.py      카드가 새로 생겼으면 og:image 주소를 넣어 다시 생성
# 카드 그리기가 실패해도(표지 서버 장애 등) 사이트 갱신은 멈추지 않는다.
set -e
cd "$(dirname "$0")/.."
python3 generate.py
before=$(sha1sum data/og.json 2>/dev/null || true)
python3 tools/make_og.py || echo "⚠️ OG 카드 생성 실패 — 있던 카드로 계속"
after=$(sha1sum data/og.json 2>/dev/null || true)
if [ "$before" != "$after" ]; then
  python3 generate.py
fi
