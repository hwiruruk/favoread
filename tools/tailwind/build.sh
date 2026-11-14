#!/usr/bin/env bash
# Tailwind CSS를 미리 만들어 assets/v2/tailwind.css로 저장한다.
# 홈·영문 홈·업데이트·데이터 안내 페이지가 이 파일을 쓴다. 새 Tailwind 클래스를 쓰면 다시 실행.
set -e
cd "$(dirname "$0")/../.."
npx --yes tailwindcss@3.4.17 -c tools/tailwind/tailwind.config.js -i tools/tailwind/input.css -o assets/v2/tailwind.css --minify
