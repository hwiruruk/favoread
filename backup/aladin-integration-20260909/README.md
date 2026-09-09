# 알라딘 API 연동 백업 (2026-09-09, 예스24 이전 작업 전)

알라딘 오픈API 종료에 대응해 예스24 API로 옮기는 작업을 시작하기 전,
현재 정상 동작 중인 알라딘 연동 코드를 그대로 복사해 둔 스냅샷입니다.
마이그레이션 중 문제가 생기면 이 폴더의 파일들을 원래 위치로 되돌리면
알라딘 연동 상태로 즉시 복구됩니다.

## 복구 방법

```
cp backup/aladin-integration-20260909/app.js editor/app.js
cp backup/aladin-integration-20260909/editor-cloudflare-worker.js editor/cloudflare-worker.js
cp backup/aladin-integration-20260909/tools-aladin-proxy-worker.js tools/aladin-proxy/worker.js
cp backup/aladin-integration-20260909/tools-aladin-proxy-README.md tools/aladin-proxy/README.md
```

(참고: git 히스토리에도 당연히 남아있으므로 `git log`로 이 시점의 커밋을 찾아
`git checkout <커밋> -- editor/app.js` 등으로 되돌리는 것도 가능합니다. 이 폴더는
git 조작 없이도 파일 탐색기에서 바로 눈으로 확인·복구할 수 있도록 남겨둔 여분입니다.)

## 원본 위치

| 백업 파일 | 원본 경로 | 역할 |
|---|---|---|
| `app.js` | `editor/app.js` | 편집기 전체 로직. `Aladin` 객체(약 358~526번째 줄)가 알라딘 ItemSearch/ItemLookUp 호출, JSONP·CORS 프록시 폴백 처리 |
| `editor-cloudflare-worker.js` | `editor/cloudflare-worker.js` | 편집기용 알라딘 CORS 프록시 Cloudflare Worker |
| `tools-aladin-proxy-worker.js` | `tools/aladin-proxy/worker.js` | 별도 버전의 알라딘 프록시 Worker (Referer 위장 방식, 환경변수로 등록 URL 관리) |
| `tools-aladin-proxy-README.md` | `tools/aladin-proxy/README.md` | 위 프록시 배포 안내서 |

## 현재 알라딘 연동 구조 요약

- 알라딘 API는 **편집기(editor/)에서만** 사용됩니다. 공개 사이트(index.html, data.json)는
  정적 데이터이고, 알라딘 API를 실시간 호출하지 않습니다.
- 편집기에서 책 검색/조회 시 `Aladin.search()` / `Aladin.lookup()`이
  `https://www.aladin.co.kr/ttb/api/ItemSearch.aspx`, `ItemLookUp.aspx`를 호출합니다.
- 인증은 URL 쿼리 파라미터 `ttbkey`로 전달 (헤더 아님).
- 호출 순서: ① `<script>` 태그 JSONP(`&Callback=`) 우선 시도 → 실패 시
  ② 사용자가 설정한 CORS 프록시 → ③ 내장된 공개 프록시 목록(allorigins 등) 순차 시도.
- TTBKey는 저장소 코드에 하드코딩되어 있지 않고, 사용자가 편집기 설정 화면에서
  입력해 브라우저 `localStorage`에만 저장됩니다(`Config.ttb`).

## 마이그레이션 시 확인 필요 사항 (예스24 API 검토 결과, 별도 보고 참고)

- 예스24 API 인증 방식이 **HTTP 헤더**(`X-Api-Key` 등)라면, 알라딘처럼 `<script>` 태그
  JSONP 방식이 원천적으로 불가능합니다(스크립트 태그는 커스텀 헤더를 못 보냄).
  → 이 경우 반드시 서버(Cloudflare Worker 등)가 헤더를 붙여 대신 호출해주는
  구조로 바뀌어야 하고, API 키도 Worker의 환경변수(secret)로 보관해야 합니다.
- 예스24 개발자 문서(developers.yes24.com)는 이 작업 환경의 네트워크 정책상
  접근이 차단되어 있어, 정확한 엔드포인트·인증 방식·응답 스키마를 아직 직접
  확인하지 못했습니다. 사용자가 문서 내용을 직접 붙여넣어 주시면 이어서
  진행 가능합니다.
