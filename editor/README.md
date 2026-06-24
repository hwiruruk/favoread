# Favoread 데이터 편집기

브라우저에서 `data.csv`를 직접 편집하고 GitHub에 commit/push까지 처리하는
정적 웹앱입니다. 알라딘 TTB API를 통해 책 정보(제목/저자/출판사/표지)를
한 번에 채워 넣을 수 있습니다.

## 어디서 열까

**1) GitHub Pages 사이트로 사용 (권장)**

저장소가 GitHub Pages로 호스팅되고 있으므로 (`https://favoread.com`),
브랜치가 main에 머지된 후에는 다음 주소로 접속하면 됩니다:

```
https://favoread.com/editor/
```

머지 전 브랜치에서 미리 보고 싶으면 raw 사이트는 별도 빌드가 필요하므로
아래 로컬 방식을 사용하세요.

**2) 로컬에서 바로 열기**

```bash
cd editor
python3 -m http.server 8765
# 브라우저에서 http://localhost:8765 열기
```

(`file://`로 직접 열어도 동작은 하지만 일부 브라우저가 fetch를 막을 수
있어 정적 서버 사용을 권장합니다.)

## 첫 사용 — 설정

처음 열면 ⚙️ 설정 모달이 자동으로 뜹니다. 다음을 입력하세요:

| 항목 | 값 |
|------|-----|
| GitHub Repo | `hwiruruk/favoread` |
| Branch | `claude/data-management-ui-6tlb0` (또는 `main`) |
| CSV 경로 | `data.csv` |
| GitHub Personal Access Token | fine-grained PAT, 이 저장소에 **Contents: Read and write** 권한 |
| 알라딘 TTBKey | `https://www.aladin.co.kr/ttb/wblog_manage.aspx` 에서 발급한 키 |
| 커밋 작성자 | `홍길동 <me@example.com>` (선택) |

> 모든 값은 **이 브라우저의 localStorage**에만 저장됩니다. 공용 컴퓨터에서는
> 사용 후 비워두세요. (브라우저 외부로 절대 전송되지 않으며, GitHub/알라딘
> API에 인증 헤더로만 사용됩니다.)

### GitHub PAT 발급법 (간단)

1. GitHub → Settings → Developer settings → Personal access tokens → **Fine-grained tokens**
2. **Generate new token**
3. Repository access → **Only select repositories** → `hwiruruk/favoread` 선택
4. Permissions → Repository permissions → **Contents: Read and write**
5. 생성된 `github_pat_…` 토큰을 설정 모달에 붙여넣기

## 사용 흐름

1. **↻ 불러오기** — GitHub의 최신 `data.csv`를 가져옴 (sha도 함께)
2. 좌측 사이드바
   - 🔍 검색: 한글/영문/책 제목/저자 모두 매칭
   - 필터: `영문명 누락 / 표지 누락 / 연예인 이미지 누락` 빠른 점프
   - **+ 연예인** 버튼으로 새 인물 추가
3. 연예인 클릭 → 상세 패널
   - 한글/영문/이미지 URL 편집 — 같은 인물이 여러 행에 있으면 저장 시 **모든 행에 일괄 반영**
   - 책 카드: 편집 / 알라딘 링크 열기 / 삭제
   - **+ 책 추가** 또는 카드의 **편집** → 책 다이얼로그
4. 책 다이얼로그
   - 좌측: 알라딘 검색 (제목/저자/ISBN 키워드) 또는 ItemId 직접 조회
   - 검색 결과 클릭 → 우측 폼이 **자동으로 채워짐 + 표지 미리보기**
   - 출처 URL과 코멘트만 추가 입력
5. **💾 GitHub에 저장**
   - 미저장 변경이 있으면 버튼 활성화 + `미저장 변경` 배지
   - 클릭 → 커밋 메시지 입력 → API로 곧장 commit & push (PR 아님, 브랜치에 직접)
   - 저장 후에는 새 sha가 표시됨

## 이미지 미리보기

- 연예인 이미지: 상세 패널 좌측 (140×180)
- 책 표지: 책 카드 / 책 다이얼로그 / 알라딘 검색 결과 모두에서 노출
- `referrerpolicy="no-referrer"`로 알라딘/MBC 등의 핫링크 차단을 회피합니다.

## 데이터 모델 / generate.py 호환성

- 편집기는 CSV 헤더 텍스트를 **원본 그대로 보존**합니다 (시트 함수가 박힌
  복잡한 헤더 포함). 컬럼은 `generate.py`의 substring 매칭과 동일한 규칙으로
  찾아냅니다.
- 한 연예인은 메모리상 1개의 객체로 관리되며, 저장할 때 책 수만큼 행으로
  펼칩니다. 책이 0권인 연예인도 한 행으로 보존됩니다.
- 출력은 `Papa.unparse` (Python `csv` 모듈과 같은 quote-when-needed 정책).

## 충돌 해결

저장 시 GitHub가 sha 불일치(`409`/`422`)를 반환하면 다른 곳에서 먼저
커밋된 것입니다. **↻ 불러오기 → 다시 편집 → 저장** 순서로 동기화하세요.
편집기는 미저장 상태에서 페이지를 떠날 때 경고를 표시합니다.

## 알라딘 API에 대해

알라딘 TTB OpenAPI는 발급 시 등록된 URL과 호출 측 Referer가 일치할 때만
응답합니다. 정적 사이트(favorbook.co.kr)에서 직접 호출하면 거의 항상
`403 "Host not in allowlist"`로 막혀요. 이 편집기는 자매 프로젝트인
BookStack에서 검증된 패턴을 그대로 사용합니다 — `api.allorigins.win/get`을
프록시로 거치면 응답이 `{contents, status}`로 한 번 감싸져 돌아오고,
Aladin은 Referer 검사를 우회한 형태로 처리합니다.

- **기본 폴백 프록시 7종** (별도 설정 불필요, 순차 시도):
  allorigins-get → corsproxy.io → cors.lol → corsproxy.org → codetabs →
  allorigins-raw → thingproxy
- 공개 프록시는 자주 죽으므로, **모두 실패하면 자체 Cloudflare Worker** 사용 권장
  (10분 무료 셋업) — 자세한 안내: [`cloudflare-worker.js`](./cloudflare-worker.js)
- 다른 프록시를 쓰려면 ⚙️ 설정의 "알라딘 호출 프록시"에 입력. 끝이 `?url=`로
  끝나야 하며, **응답을 그대로(raw) 반환하는 프록시**라면 동작은 다음과 같이
  처리됩니다: 응답이 `{contents, status}` 모양이면 contents 안의 본문을
  파싱하고, 아니면 본문 자체를 JSON으로 본다.
- ItemId만 알면 (예: `https://www.aladin.co.kr/...&ItemId=673870`) URL을 그대로
  붙여 넣어도 ID를 추출해 조회합니다.

### 알라딘 디버깅

검색이 안 되면 브라우저 **개발자 도구 → Console**을 여세요. 호출 URL이
`[Aladin] →` 로 찍힙니다.

| 증상 | 원인 | 해결 |
|------|------|------|
| `프록시 HTTP 4xx/5xx` | 공개 프록시 일시 장애 | 잠시 후 재시도. 자주 발생하면 Cloudflare Worker 권장 (`cloudflare-worker.js`) |
| `모든 프록시 실패` | 공개 프록시 전체 다운/API 변경 | Cloudflare Worker 셋업 (`cloudflare-worker.js` 참고, 10분) |
| `알라딘 응답 파싱 실패` | Aladin이 HTML(로그인 안내/오류 페이지)을 돌려줌 | TTBKey 확인 |
| `errorCode 8` 등 | TTBKey 만료/오타 | 알라딘 OpenAPI 관리 페이지에서 확인 |

## GitHub PAT 문제 해결

`Resource not accessible by personal access token` (403):

이 메시지는 **PAT 자체에 권한이 없다**는 뜻입니다. 브랜치 보호 규칙과는 다른
종류의 오류입니다. Fine-grained PAT를 다시 발급하면서:

1. **Repository access** → **Only select repositories** → 대상 저장소를 반드시 체크
2. **Permissions → Repository permissions** → **Contents: Read and write**
3. (조직 저장소라면 조직 관리자가 fine-grained PAT를 허용했는지도 확인)

`main` 브랜치에 직접 푸시가 막혀있다면 (브랜치 보호) 메시지가 다르게 나옵니다.
그 경우는 설정에서 Branch를 다른 작업 브랜치로 바꾸고 GitHub에서 PR로
머지하세요.

## 한계 / TODO

- 이미지 자체 업로드는 안 함 (URL만 다룹니다)
- 행 단위의 자유로운 reorder 미지원 (등록 순서 유지)
- 로컬 캐시는 sha와 함께 저장하지 않음 — 새로고침 시 GitHub에서 재로드
