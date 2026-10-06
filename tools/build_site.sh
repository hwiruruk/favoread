#!/usr/bin/env bash
# 사이트 생성 — 워크플로(update-sitemap.yml)와 로컬에서 같이 쓴다.
#   1) generate.py        페이지·data.json 생성
#   2) cover_colors.py    책등 사진 없는 책의 표지 대표색 뽑기(data/cover_colors.json) — data.json을 읽는다
#   3) make_og.py         바뀐 셀럽의 공유 미리보기 카드(og/*.jpg) 그리기 — data.json을 읽는다
#   4) generate.py        색이나 카드가 새로 생겼으면 다시 생성
# 색 뽑기나 카드 그리기가 실패해도(표지 서버 장애 등) 사이트 갱신은 멈추지 않는다.
set -e
cd "$(dirname "$0")/.."
python3 generate.py
before=$(sha1sum data/og.json data/cover_colors.json 2>/dev/null || true)
python3 tools/cover_colors.py || echo "⚠️ 표지 대표색 뽑기 실패 — 있던 색으로 계속"
python3 tools/make_og.py || echo "⚠️ OG 카드 생성 실패 — 있던 카드로 계속"
after=$(sha1sum data/og.json data/cover_colors.json 2>/dev/null || true)
if [ "$before" != "$after" ]; then
  python3 generate.py
fi
