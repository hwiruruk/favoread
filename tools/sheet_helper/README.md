# Favorbook 시트 헬퍼

구글 시트 안에서 동작하는 데이터 입력/검사 도구입니다. Apps Script로 만들어졌어요.

## 기능

- **빈 칸 검사**: 컬럼별 채움 상태 + 필수 컬럼 누락 행 리스트
- **새 행 추가**: 자동완성 폼으로 빠르게 입력 (영문 컬럼은 lookup ARRAYFORMULA가 자동 채움)
- **통계 보기**: 셀럽/책/작가 unique 카운트 + 영문 진행률

## 셋업 (5분, 한 번만)

1. 데이터가 있는 [구글 시트](https://docs.google.com/spreadsheets/d/1k1Zoo15ulULZsJv8eGuD-PNrQg3ChTApAVCRcgjoUXI/edit) 열기

2. 메뉴 → **확장 프로그램 → Apps Script** 클릭

3. 새 Apps Script 프로젝트가 열리면, 좌측에 파일 4개를 만듭니다:
   - 기본으로 있는 `Code.gs`
   - 새로 추가: `+` 버튼 → HTML → 이름 `MissingReport`
   - 새로 추가: `+` 버튼 → HTML → 이름 `Stats`
   - 새로 추가: `+` 버튼 → HTML → 이름 `AddRow`

4. 각 파일 내용을 이 폴더의 동명 파일에서 복사 → 붙여넣기:
   - [`Code.gs`](./Code.gs) → Apps Script의 `Code.gs`
   - [`MissingReport.html`](./MissingReport.html) → Apps Script의 `MissingReport.html`
   - [`Stats.html`](./Stats.html) → Apps Script의 `Stats.html`
   - [`AddRow.html`](./AddRow.html) → Apps Script의 `AddRow.html`

5. **저장** (Ctrl/Cmd + S)

6. 시트로 돌아가서 **새로고침**. 메뉴 바에 **📚 Favorbook**이 추가됨 (없으면 잠시 기다린 후 다시 새로고침)

7. 처음 메뉴 항목을 클릭하면 **권한 요청**이 뜸 → 본인 계정으로 승인 (시트 읽기/쓰기 권한)

## 사용

시트 메뉴 → 📚 Favorbook → 원하는 항목 클릭

### ⚙️ 설정 변경

- **메인 시트 이름이 다르면**: `Code.gs` 상단의 `MAIN_SHEET_NAME = '메인'`을 본인 시트 탭 이름으로 변경
- **컬럼이 다르면**: `Code.gs`의 `REQUIRED_COLS`, `OPTIONAL_COLS`, `EN_COLS` 배열 수정

## 컬럼 가정

이 도구는 다음 컬럼이 헤더 행에 있다고 가정합니다 (이름이 정확하지 않아도 substring 매칭됨):

**필수**: 연예인, 도서명, 저자, 출판사, 출처
**선택**: 도서 이미지, 연예인 이미지, 코멘트
**영문 (자동)**: 연예인_en, 도서명_en, 저자_en (lookup 시트 ARRAYFORMULA로 자동 채움)

영문 컬럼은 폼에서 입력받지 않습니다 — `Celebs_EN`, `Books_EN`, `Authors_EN` 시트에서 한 번씩만 채우면 메인 시트에 자동 반영됩니다.

## 트러블슈팅

- **메뉴가 안 보임**: 시트 새로고침 (F5) 후 5~10초 대기. Apps Script 코드에 오류 있으면 안 뜸 → Apps Script 편집기에서 `onOpen` 함수를 한 번 수동 실행해보면 에러 확인 가능.
- **권한 에러**: Apps Script 편집기에서 임의의 함수 한 번 실행 → 권한 승인 → 다시 시도.
- **자동완성 안 뜸**: 시트가 비어있거나 헤더 매칭 실패. `Code.gs`의 `MAIN_SHEET_NAME` 확인.
