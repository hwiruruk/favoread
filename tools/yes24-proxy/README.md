# 예스24 Open API 프록시 — Cloudflare Worker

예스24 Open API는 발급받은 API Key를 `X-Api-Key` 요청 헤더에 담아 인증합니다.
브라우저에서 커스텀 헤더를 직접 실어 보내려면 CORS 사전 요청(preflight)이 필요하고,
무엇보다 예스24 공식 문서가 **"API Key를 클라이언트 사이드 코드에 직접 포함하지
마세요"**라고 못박고 있습니다. 그래서 이 Worker가 API Key를 서버(Worker)에만
보관하고, 편집기는 Worker를 통해서만 예스24 API를 호출합니다.

알라딘 프록시(`tools/aladin-proxy/`)와의 차이: 알라딘 프록시는 Referer만
바꿔주고 TTBKey는 여전히 편집기(브라우저)가 들고 있었지만, 이 Worker는 API Key
자체를 편집기에 전혀 노출하지 않습니다 — 더 안전한 구조입니다.

## 배포 (10분, 한 번만)

1. https://dash.cloudflare.com → **Workers & Pages** → **Create** → **Create Worker**
2. Worker 이름은 자유 (예: `yes24-proxy`)
3. **Edit code** → 좌측 내용을 [`worker.js`](./worker.js)로 통째로 교체
4. **Save and Deploy**
5. **Settings → Variables and Secrets**:
   - `YES24_API_KEY` = 예스24 개발자센터(developers.yes24.com)에서 발급받은 API Key
     — 반드시 **Secret**으로 추가하세요(Encrypt 옵션 체크). 절대 평문 Variable로
     저장하지 마세요.
   - `ALLOWED_ORIGIN` = `https://favorbook.co.kr,http://localhost:8765`
     (콤마 구분, 편집기를 띄울 모든 출처를 적습니다)
6. (선택) **Custom Domains**에 서브경로로 묶기. 안 묶어도 `*.workers.dev` 도메인으로
   바로 사용 가능

## 편집기 연결

편집기 ⚙️ 설정 → **예스24 프록시 Worker URL**:

```
https://<your-worker>.<your-account>.workers.dev
```

(끝에 슬래시나 경로를 붙이지 않습니다. 편집기가 `/goods/itemList` 등을 알아서 붙입니다.)

저장 → 책 다이얼로그에서 예스24 검색 → 결과가 떠야 정상.

## 동작

- 편집기는 이 Worker에 커스텀 헤더 없이 평범한 GET 요청만 보냅니다
  (예: `<worker>/goods/itemList?query=클린코드&pageSize=5`).
- Worker는 요청 경로가 `/goods/itemList` 또는 `/goods/itemDetail`일 때만
  통과시키고, `https://apis.yes24.com/v1<경로>`로 그대로 전달하면서
  `X-Api-Key` 헤더를 자기 환경변수 값으로 채워 넣습니다.
- `ALLOWED_ORIGIN`에 없는 출처에서 호출하면 CORS 헤더가 안 나가서 브라우저가
  거부합니다.
- API Key는 Worker 환경변수에만 있고 편집기 코드·localStorage 어디에도
  저장되지 않습니다 — Worker URL이 노출돼도 키는 새지 않습니다.

## 비용 / 한도

- Cloudflare Workers 무료 플랜: 일 100,000 요청.
- 예스24 쪽 한도는 API Key 등급별로 다름 (기본키 기준 일 20,000회, 초당 10회
  버스트). 초과 시 HTTP 429가 그대로 편집기까지 전달됩니다. 등급/사용량은
  developers.yes24.com의 "API 이용 현황"에서 확인하세요.

## 트러블슈팅

| 증상 | 원인 / 해결 |
|------|-------------|
| `허용되지 않은 경로입니다` (404) | 편집기가 잘못된 경로로 호출 중이거나 Worker 코드가 최신이 아님 |
| `Worker에 YES24_API_KEY가 설정되지 않았습니다` (500) | Settings → Variables and Secrets에 `YES24_API_KEY`를 추가했는지 확인 |
| `유효하지 않은 API Key입니다` (AUTH_002) | 발급받은 Key 값이 정확한지, 폐기되지 않았는지 확인 |
| 편집기가 Worker를 호출조차 못 함 (CORS 에러) | `ALLOWED_ORIGIN`에 현재 편집기 도메인이 빠짐 |
| `예스24 서버 호출 실패` (502) | 예스24 서버 일시 장애. 잠시 후 재시도 |
| `429` 응답 | 초당/일일 호출 한도 초과. 잠시 후 재시도하거나 상위 등급 키로 교체 |
