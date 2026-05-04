# Favorbook 시트 헬퍼

구글 시트 안에서 동작하는 데이터 입력/검사 도구입니다. Apps Script로 만들어졌어요.

## 기능

- **빈 칸 검사**: 컬럼별 채움 상태 + 필수 컬럼 누락 행 리스트
- **새 행 추가**: 자동완성 폼으로 빠르게 입력
  - 영문 컬럼은 lookup 시트의 ARRAYFORMULA가 자동 채움
  - 도서 정보/이미지는 알라딘 API(`GET_ALADIN_API_URL`/`GET_ALADIN_COVER`) 자동 호출
  - **1000행부터** 채움 (기존 데이터/수식과 분리)
- **통계 보기**: 셀럽/책/작가 unique 카운트 + 영문 진행률
- **Web App 독립 실행**: 시트 안 열어도 URL로 입력 가능 (모바일 홈 추가 가능)

## 셋업 (5분, 한 번만)

1. 데이터가 있는 [구글 시트](https://docs.google.com/spreadsheets/d/1k1Zoo15ulULZsJv8eGuD-PNrQg3ChTApAVCRcgjoUXI/edit) 열기

2. 메뉴 → **확장 프로그램 → Apps Script** 클릭

3. 새 Apps Script 프로젝트가 열리면, 좌측에 파일을 추가:
   - 기본으로 있는 `Code.gs` (덮어쓰기)
   - `+` → HTML → `MissingReport`
   - `+` → HTML → `Stats`
   - `+` → HTML → `AddRow`

4. 각 파일 내용을 이 폴더의 동명 파일에서 복사 → 붙여넣기.

5. **알라딘 함수도 같은 프로젝트에 있어야 자동 조회 작동** — `GET_ALADIN_API_URL`, `GET_ALADIN_COVER` 함수가 이미 다른 `.gs` 파일(예: `Aladin.gs`)에 있다면 그대로 두면 됩니다. 없다면 `+` → 스크립트 → `Aladin` 만들고 사용자가 갖고 있던 함수를 넣으세요.

6. **저장** (Ctrl/Cmd + S)

7. 시트로 돌아가서 **새로고침**. 메뉴 바에 **📚 Favorbook**이 추가됨

8. 처음 메뉴 항목 클릭하면 **권한 요청** → 승인

## Web App 독립 실행 (선택)

시트 안 열어도 입력 가능한 페이지를 만들고 싶다면:

1. Apps Script 편집기 우측 상단 **배포 → 새 배포**
2. **유형**: `웹 앱`
3. **다음 사용자 인증 정보로 실행**: `나` (계정)
4. **액세스 권한이 있는 사용자**: `본인 계정` (또는 링크가 있는 모든 사용자)
5. **배포** → 발급된 **웹 앱 URL** 복사
6. 모바일에서 그 URL 열고 → 브라우저 메뉴 → **홈 화면에 추가** → 앱처럼 사용

코드 수정 후엔 **새 버전 배포**를 다시 해야 반영됩니다 (또는 "테스트 배포"는 즉시 반영).

## 사용

시트 메뉴 → 📚 Favorbook → 원하는 항목 클릭

또는 Web App URL 직접 접속.

### ⚙️ 설정 변경 (`Code.gs` 상단)

```javascript
const MAIN_SHEET_NAME = '메인';   // 메인 시트 탭 이름
const START_ROW = 1000;          // 새 행 추가 시작 위치
const REQUIRED_COLS = [...];     // 필수 컬럼
const OPTIONAL_COLS = [...];     // 선택 컬럼
const EN_COLS = [...];           // 영문 컬럼 (lookup ARRAYFORMULA가 채움)
```

## 컬럼 가정

이 도구는 다음 컬럼이 헤더 행에 있다고 가정 (substring 매칭 가능):

| 종류 | 컬럼 |
|---|---|
| 필수 | 연예인, 도서명, 저자, 출판사, 출처 |
| 선택 | 도서 정보, 도서 이미지, 연예인 이미지, 코멘트 |
| 영문 (자동) | 연예인_en, 도서명_en, 저자_en |

영문 컬럼은 폼에서 입력받지 않습니다 — `Celebs_EN`, `Books_EN`, `Authors_EN` 시트에서 한 번씩 채우면 메인 시트에 자동 반영됩니다.

## 트러블슈팅

### 영문 데이터가 사라져요

행 추가 시 다른 행의 영문 컬럼 값들까지 사라지는 경우, **메인 시트 영문 컬럼의 ARRAYFORMULA가 깨졌습니다**. 원인은 다음 중 하나:

1. **이전 버그가 남긴 잔존값** — 예전 버전의 도구로 추가한 행에 빈 문자열(`''`)이 셀에 박혀있어 ARRAYFORMULA가 `#REF!`가 됨
   - 해결: 메인 시트 B/D/F (영문 3개) 컬럼을 **B2 셀(수식)만 남기고 전부 비우기**. ARRAYFORMULA가 다시 펼쳐짐
2. **ARRAYFORMULA 범위가 고정** — `E2:E1000` 같이 범위를 닫아둔 경우 1001행 이후는 안 채워짐
   - 해결: 범위를 `E2:E`로 열어두기 (예: `=ARRAYFORMULA(IF(E2:E="", "", IFERROR(VLOOKUP(E2:E, Authors_EN!A:B, 2, FALSE), "")))`)
3. **lookup 시트의 UNIQUE+SORT 정렬 변경** — `Authors_EN` 등에서 `SORT(UNIQUE(...))` 쓰면 새 항목 추가 시 정렬이 바뀌어 B열(영문) 매뉴얼 입력값과 어긋남
   - 해결: `Authors_EN` A/B 둘 다 수동 입력으로 두고 UNIQUE 안 쓰기. 또는 정렬 빼기

### 메뉴가 안 보임

시트 새로고침 (F5) 후 5~10초 대기. Apps Script 코드에 오류 있으면 안 뜸 → Apps Script 편집기에서 `onOpen` 함수를 한 번 수동 실행해보면 에러 확인 가능.

### 자동완성 안 뜸

시트가 비어있거나 헤더 매칭 실패. `Code.gs`의 `MAIN_SHEET_NAME` 확인.

### 알라딘 자동 조회 안 됨

`GET_ALADIN_API_URL` / `GET_ALADIN_COVER` 함수가 같은 Apps Script 프로젝트 안에 있어야 합니다. 다른 프로젝트나 다른 시트의 함수는 호출 못 합니다.

### Web App URL 변경됨

Apps Script에서 코드 수정 후 **새 배포**(New deployment)를 만들면 URL이 바뀝니다. URL을 고정하려면 **기존 배포 관리(Manage deployments) → 편집 → 버전: 새 버전**으로 업데이트하면 같은 URL 유지.
