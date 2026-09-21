# Favorbook 데이터 편집기

브라우저에서 `data.csv`를 직접 편집하고 GitHub에 commit/push까지 처리하는
정적 웹앱입니다. 알라딘 TTB API를 통해 책 정보(제목/저자/출판사/표지)를
한 번에 채워 넣을 수 있습니다.

## 어디서 열까

**1) GitHub Pages 사이트로 사용 (권장)**

저장소가 GitHub Pages로 호스팅되고 있으므로 (`https://favorbook.co.kr`),
브랜치가 main에 머지된 후에는 다음 주소로 접속하면 됩니다:

```
https://favorbook.co.kr/editor/
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

### 저자명 정리
서점 API가 주는 저자 문자열에는 역할 표기가 붙어 옵니다.
알라딘은 `신영복 (지은이), 김세현 (그림)`, 예스24는 `요아힘 마이어호프 저/박종대 역` 같은 식이에요.
편집기는 **알라딘·예스24·구글북스 결과를 적용할 때, 그리고 저자 칸에 직접 붙여넣고 빠져나올 때**
이걸 지은이만 남기고 정리합니다(`cleanAuthorName`).

- `저 · 저자 · 지음 · 지은이 · 공저 · 글 · 글그림 · 쓴이 · 원작` — 꼬리표만 떼고 이름은 남김
- `역 · 역자 · 옮김 · 옮긴이 · 번역 · 편집 · 엮음 · 편저 · 감수 · 사진 · 그림 · 삽화 · 해설` — 그 사람은 아예 뺌
- `,` `/` `;` 로 나뉜 여러 명을 각각 판단하고 `, ` 로 다시 이어 붙임
- 역할 꼬리표 앞에 공백이나 여는 괄호가 있을 때만 떼어냅니다 — `이역` 같은 이름의 끝 글자를
  역할로 잘못 읽지 않기 위해서예요
- **역할이 안 적힌 이름은 뒤에 오는 역할을 따릅니다.** 서점이 같은 역할의 사람을 쉼표로 묶고
  마지막에만 역할을 적기 때문이에요. `패트릭 브링리 (지은이), 김희정, 조현주 (옮긴이)` 에서
  김희정도 옮긴이로 보고 뺍니다
- 역할이 아닌 괄호는 건드리지 않습니다 — `설레다(최민정)` 는 그대로 둡니다
- **불러올 때도 같은 규칙으로 정리합니다.** 예전에 저장된 값에 역할 표기가 남아 있어도
  편집기에는 저자 이름만 보입니다
- 역자만 적혀 있어 남는 이름이 없으면 저자 칸을 덮어쓰지 않고 원문을 그대로 둡니다
   - 검색 결과 클릭 → 우측 폼이 **자동으로 채워짐 + 표지 미리보기**
   - 출처 URL과 코멘트만 추가 입력
5. **💾 GitHub에 저장**
   - 미저장 변경이 있으면 버튼 활성화 + `미저장 변경` 배지
   - 클릭 → 커밋 메시지 입력 → API로 곧장 commit & push (PR 아님, 브랜치에 직접)
   - 저장 후에는 새 sha가 표시됨

## 메인에 고정할 "요즘 핫한 사람" (🔥 핫한 사람)

메인 첫 화면 상단(검색창 바로 아래)에 직접 고른 인물을 한 줄로 고정 노출합니다.

1. 상단 **🔥 핫한 사람** 버튼 → 현재 고정 목록이 뜹니다
2. 아래 검색창에서 이름을 찾아 클릭하면 목록에 추가됩니다
3. 각 줄에서
   - **뱃지** 칸: 사진 위에 붙일 짧은 말머리 (예: `HOT`, `NEW`, `컴백`). 비우면 안 붙습니다
   - **↑ / ↓**: 노출 순서 변경
   - **삭제**: 목록에서 제외 (인물 데이터 자체는 그대로)
4. **💾 GitHub에 저장** — 이 창의 저장 버튼은 `data.csv`와 무관하게
   `data/featured.json` 파일만 따로 커밋합니다

### 몇 명까지 넣나

데스크톱에서 한 줄은 **6명**입니다. 그보다 많이 넣으면 줄이 넘어가고,
**최대 12명(2줄)** 까지만 저장됩니다. 모바일은 2칸, 태블릿은 3칸으로 접힙니다.

### 비워두면

`picks`가 비어 있거나 넣은 이름이 전부 데이터에 없으면
메인에서 이 섹션과 스크롤 탭의 `핫` 버튼이 통째로 사라집니다. 따로 끄는 스위치는 없습니다.

### 파일 형식

편집기 없이 `data/featured.json`을 직접 고쳐도 됩니다.

```json
{
  "title": "🔥 요즘 핫한 사람",
  "subtitle": "지금 가장 화제인 인물을 직접 골라 고정해 뒀어요.",
  "picks": [
    { "name": "카리나(에스파)", "badge": "HOT", "note": "" },
    { "name": "송강", "badge": "NEW", "note": "컴백 기념" }
  ]
}
```

- `name` — `data.csv`의 연예인 이름과 **정확히** 같아야 합니다. 없는 이름은
  빌드할 때 경고를 남기고 조용히 빠집니다
- `badge` — 사진 위 말머리 (선택)
- `note` — 이름 아래 한 줄 설명 (선택). 비우면 그 사람의 책 2권이 자동으로 들어갑니다
- `title` / `subtitle` — 섹션 제목과 설명

사진·권수 카드는 메인의 JS가 `data.json`을 보고 그리고,
`generate.py`가 같은 목록을 크롤러용 정적 링크로도 넣어둡니다.
JSON만 바꾸면 사이트에 바로 반영되고, `generate.py`는 정적 마크업을
맞춰 넣기 위해 돌려주면 됩니다.

## 코멘트 검수 (💬 코멘트 검수)

각 출처를 읽고 자동으로 뽑아낸 "왜 이 책을 추천했는지" 초안을 한 건씩 넘겨보며
승인하거나 반려하는 창입니다. **승인한 항목만** 사이트에 나갑니다.

1. 상단 **💬 코멘트 검수** 버튼 → `data/comments.json`을 읽어 목록을 띄웁니다
2. 카드마다
   - 등급 **A**: 출처 원문에 추천 이유가 적혀 있음
   - 등급 **B**: 관계만 확인되고 이유는 원문에 없음 (예: "스타의 책 코너에서 고름")
   - **출처 열기 ↗**: 원문을 새 탭에서 열어 문장과 대조
   - 한국어 / English 칸: 그대로 두거나 직접 고침
   - **승인 / 보류 / 반려** — 한국어 칸이 비어 있으면 승인되지 않습니다
   - `Ctrl+Enter` (맥은 `Cmd+Enter`): 그 카드를 바로 승인
3. 필터를 `미검수`로 두면 승인·반려한 카드가 목록에서 빠져서
   위에서부터 계속 처리하면 됩니다
4. **💾 GitHub에 저장** — 이 창의 저장 버튼은 `data.csv`와 무관하게
   `data/comments.json` 파일만 따로 커밋합니다

연예인 상세 화면의 책 카드에도 검수 상태가 뱃지로 붙습니다
(`💬 코멘트 검수 대기` / `💬 코멘트 승인` / `💬 코멘트 반려`).
검수 창을 한 번 연 뒤부터 표시됩니다.

### 왜 data.csv에 넣지 않나

- 코멘트 칸은 **사람이 직접 쓰는 자리**로 남겨둡니다. 사람이 쓴 값이 늘 우선입니다
- 한/영 두 벌에 등급·근거·검수 상태까지 열로 붙이면 시트가 감당을 못 합니다
- `featured.json`처럼 파일 하나만 따로 커밋하므로 CSV 저장 충돌과 무관합니다

### 파일 형식

```json
{
  "_comment": "…이 파일이 뭔지 설명…",
  "_updated": "2026-09-21",
  "comments": {
    "황소윤(새소년)|거꾸로 사는 재미": {
      "ko": "헌책방에서 우연히 집어 든 책이라고 했어요. …",
      "en": "She said she found it by chance at a used bookstore. …",
      "source": "https://ch.yes24.com/article/details/45760",
      "grade": "A",
      "evidence": "websearch",
      "note": "",
      "status": "pending"
    }
  }
}
```

- 키는 `"<연예인>|<도서명>"`이고 **둘 다 `data.csv`와 정확히 같아야** 합니다.
  맞는 책이 없으면 검수 창에 `데이터에 없는 항목` 뱃지가 붙습니다
  (책 제목을 고쳤을 때 주로 생깁니다)
- `status` — `pending` / `approved` / `rejected`. 반려한 항목은 지우지 않고
  남겨둬서 다음 수집 때 같은 문장을 다시 올리지 않게 합니다
- `note` — 검수할 때 특별히 봐야 할 점. 예를 들어 근거가 기록된 출처가 아니라
  다른 기사에서 나온 경우 여기에 적힙니다
- `evidence` — 그 초안을 무엇으로 뽑았는지 (`websearch` 등)

### 현재 수집 범위

지금 `data/comments.json`에 들어 있는 항목은 출처가 1~3권만 다루는 기사·블로그·커뮤니티
글에서 뽑은 것입니다. 출처 한 건이 10권 넘게 담고 있는 팬 정리 목록(전체의 약 3분의 1)은
원문에 추천 이유가 없어 항목을 만들지 않습니다. 없는 이유를 지어내면 "출처를 직접 열어
확인할 수 있다"는 사이트의 약속이 깨지기 때문입니다.

### 아직 남은 것

승인된 코멘트를 실제 페이지에 내보내려면 `generate.py`가 이 파일을 읽어야 합니다.
현재 `generate.py`는 `data.csv`의 코멘트 칸만 봅니다. 메인의 책 슬라이드는
`data.json`의 `comment`를 이미 노란 인용 박스로 그리고 있고(`index.html`),
셀럽별 페이지(`/share/`, `/s/`)와 영문 페이지(`/en/`)에는 코멘트를 그리는
자리가 아직 없습니다.

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

## GitHub 저장 방식 (1MB 한도)

`data.csv`는 **Git Data API**로 저장합니다. blob → tree → commit → ref 순으로 올리고,
결과는 커밋 하나로 떨어져 예전과 같습니다.

예전에는 Contents API(`PUT /contents/{path}`)를 썼는데, 이 API는 본문을 base64로 싣고
**1MB 한도**가 있습니다. data.csv가 799KB를 넘기면서 base64가 1.02MB가 되어 한도를 넘었고,
GitHub이 크기와 무관해 보이는 메시지로 거절했습니다.

```
GitHub 저장 실패 (503): { "message": "Could not create file. Please try again later." }
```

Git Data API의 blob은 100MB까지 받으므로 한동안 여유가 있습니다.

불러오기도 같은 이유로 대비해 뒀습니다. Contents API는 1MB가 넘는 파일의 `content`를
비워서 주는데, 그때는 `GET /git/blobs/{sha}`로 다시 받아옵니다.

충돌 감지는 그대로입니다. 불러올 때의 blob sha를 기억했다가 저장 직전 브랜치 끝에서
같은 파일의 sha와 비교하고, 다르면 저장을 멈춥니다. 커밋을 붙인 뒤 ref는
`force: false`로 옮기므로, 그새 브랜치가 움직였으면 GitHub이 거절합니다.

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
