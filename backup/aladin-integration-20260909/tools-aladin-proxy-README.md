# 알라딘 OpenAPI Cloudflare Worker 프록시

알라딘 TTB API는 발급 시 등록한 블로그/사이트 URL과 호출자의 **Referer**가
일치하지 않으면 `403 "Host not in allowlist"`로 막습니다.

편집기가 `https://favorbook.co.kr/editor/` 또는 `http://localhost:8765/`에서
돌면 Referer가 등록 URL과 달라 차단되므로, Cloudflare Worker가 가운데에서
요청을 가로채 **등록 URL을 Referer로 위장**해 알라딘에 보내고 응답을 CORS로
열어줍니다.

## 배포 (5분, 한 번만)

1. https://dash.cloudflare.com → **Workers & Pages** → **Create** → **Worker**
2. Worker 이름은 자유 (예: `aladin-proxy`)
3. **Edit code** → 좌측 `worker.js` 내용을 [`worker.js`](./worker.js)로 통째로 교체
4. **Save and Deploy**
5. **Settings → Variables**:
   - `ALADIN_REFERER` = TTBKey 발급 시 등록한 URL
     - 네이버 블로그라면 `https://blog.naver.com/<id>` (키 이름에 들어있는 식별자)
     - 티스토리라면 `https://<id>.tistory.com`
   - `ALLOWED_ORIGIN` = `https://favorbook.co.kr,http://localhost:8765`
     (콤마 구분, 편집기를 띄울 모든 출처를 적습니다)
6. (선택) **Custom Domains**에 favorbook.co.kr 의 서브경로 묶기. 안 묶어도
   `*.workers.dev` 도메인으로 바로 사용 가능

## 편집기 연결

편집기 ⚙️ 설정 → **CORS 프록시**:

```
https://<your-worker>.your-account.workers.dev/?url=
```

(끝의 `?url=`는 필수. 편집기가 알라딘 URL을 그 뒤에 인코딩해서 붙여 보냅니다.)

저장 → 책 다이얼로그에서 알라딘 검색 → 결과가 떠야 정상.

## 동작

- 편집기가 우선 직접 JSONP를 시도하다 실패하면 자동으로 이 Worker로 폴백
- Worker는 `?url=`로 받은 URL이 `https://www.aladin.co.kr/ttb/api/`로 시작하는
  경우에만 통과 (오픈 프록시 남용 차단)
- `ALLOWED_ORIGIN`에 없는 출처에서 호출하면 CORS 헤더가 안 나가서 브라우저가
  거부 (Worker가 응답은 줘도 편집기는 못 읽음)
- TTBKey는 편집기 localStorage에만 있고 Worker에는 안 들어감 — Worker가 노출돼도
  키가 새지 않음

## 비용

Cloudflare Workers 무료 플랜: 일 100,000 호출. 개인 데이터 입력 용도로는
사실상 무한.

## 트러블슈팅

| 증상 | 원인 / 해결 |
|------|-------------|
| 여전히 403 "Host not in allowlist" | `ALADIN_REFERER` 환경변수가 등록 URL과 한 글자라도 다름. 알라딘 OpenAPI 관리 페이지에서 등록된 URL 정확히 복사 |
| 편집기가 Worker를 호출조차 못 함 | `ALLOWED_ORIGIN`에 현재 편집기 도메인이 빠짐 |
| `502 upstream fetch failed` | 알라딘 서버 일시 장애. 잠시 후 재시도 |
| `400 only www.aladin.co.kr/ttb/api/* allowed` | URL 인코딩이 망가짐 — 편집기 ⚙️ 프록시 값 끝이 `?url=`인지 확인 |
