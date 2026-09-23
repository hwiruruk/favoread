# 영문 책 제목 — 원제를 찾아 오고, 사람이 고른다

영문 페이지(/en/)에 나가는 책 제목을 정하는 방식입니다.

```
1. 후보 찾기   예스24 원서명 · 위키백과 영어 문서 · 알라딘 원제   ← Actions 가 한다
2. 확인       Open Library 에 그 제목·저자의 영어판이 실제 있는지 ← Actions 가 한다
3. 고르기     후보를 보고 승인 / 공식판 없음 / 숨김                ← 사람이 편집기에서
```

## 왜 바꿨나

예전에는 한국어 제목을 번역하거나(편집기 '직역*' 버튼), 한국어 제목으로 영어 책을
검색했습니다(enrich_en.py). 영문판에는 한국어 제목이 없으니 검색은 거의 걸리지 않았고,
빈자리를 직역과 AI 추측이 채웠습니다.

| 한국어 제목 | 들어가 있던 값 | 공식 영문판 |
|---|---|---|
| 소년이 온다 | The Boy Is Coming * | Human Acts |
| 데미안 | Damian * | Demian |
| 공중그네 | The Public Toilet (or Air Swing / Public Phone Booth) | — |

새 방식은 번역하지 않습니다. 번역서라면 예스24 상품 페이지에 원서명이 적혀 있고,
한국 문학·고전은 한국어 위키백과 문서에 영어 문서 링크가 걸려 있습니다.
이미 누가 적어 둔 영어 제목을 가져오는 것이라 틀릴 일이 훨씬 적습니다.

## 출처와 첫 실행 결과 (2026-09-23, 30권)

| 출처 | 무엇을 가져오나 | 첫 실행 |
|---|---|---|
| 알라딘 API | 번역서의 원제 (`ALADIN_TTB_KEY` 필요) | 5건, 모두 정확 |
| 한국어 위키백과 | 책 문서의 영어 문서 링크 | 6건 중 1건 오탐('모순' → 개념 문서 Contradiction). 이제 문서 첫 문단에 저자 이름이 있어야 받는다 |
| 예스24 상품 페이지 | 품목정보의 원서명 | 0건. 제목 아래 칸은 원제가 아니라 부제였다. 원서명 표만 본다 |
| Open Library | 한국어판이 속한 작품(work)의 대표 제목 | 두 번째 실행 0건. 한국어판 등록이 드물다. 한 글자 제목은 422 → title= 로 조회 |
| 위키데이터 | 작품의 영어 이름표 (저자 한국어 이름이 맞을 때만) | 세 번째에 추가. 위키백과 문서가 없는 한국 문학용 (흰 → The White Book) |
| Open Library (확인) | 후보 제목·저자로 영어판이 실제 있는지 확인. 무료, 키 없음 | Google Books 대신. 키 없는 Google Books 는 Actions 에서 매번 429 였다. `GOOGLE_BOOKS_API_KEY` 가 있으면 보조로만 쓴다 |

### 전체 실행 결과 (2026-09-23, 1,456권)

- 후보를 찾은 책 520권 (확실 344 · 후보 176), 나머지 약 930권은 후보 없음 — 대부분 영문판이 없는 국내 도서
- 자동 승인 246권 (data.csv 값이 근거 있는 후보와 같은 경우)
- 출처별: 알라딘 444 · 위키데이터 250 · 위키백과 188 · Open Library 2
- 한국 문학도 잡힘: 흰 → The White Book, 위저드 베이커리 → Wizard Bakery, 달러구트 꿈 백화점 → The Dallergut Dream Department Store
- 영어가 아닌 원제(La lenteur, Onze Minutos 일부, Kūchū Buranko 등)는 후보에서 뺀다. 영어 위키백과 문서 이름이 원제 그대로인 책(Les Fleurs du mal)만 남긴다

### 한국문학번역원 디지털 도서관 (4번째 출처)

[library.ltikorea.or.kr](https://library.ltikorea.or.kr/) 원작 상세 페이지의 `English Title(Printed)` 는
실제로 출간된 영어 번역서 제목이다. 그래서 이 출처 하나만으로도 '확실'로 본다.
검색은 CSRF 토큰이 든 POST 폼이라 세션을 유지하며 부른다. 한국어 제목이 같고 저자 한국어 이름이
목록에 있을 때만 상세 페이지를 연다. 알라딘이 영어 원제를 준 책(외국 책의 번역서)은 부르지 않는다.
괄호 없는 `영문 제목`(한국어 화면)·`English Title` 칸은 번역원이 붙인 영어 제목이라
출간 여부를 모른다. 후보로는 넣되 출처를 "한국문학번역원 영문 제목"으로 따로 표시하고 '확실'로 치지 않는다
(불편한 편의점 → The Inconvenient Convenience Store).
검색은 GET(`/originalworks?search_word=`)을 먼저 해 보고 결과 링크가 없으면 CSRF POST 로 한다.
첫 실행(버전 4)은 거의 한 권도 못 잡아서, 이유를 notes 와 로그에 남기게 했다
('번역원: 검색 결과 N건 중 제목 일치 없음', '저자가 다름', '영어 제목 칸이 비어 있음').

## 영문 제목 표기 원칙 — 단어 첫 글자만 대문자

출처마다 표기가 다르다(번역원 THE DALLERGUT DREAM DEPARTMENT STORE, 위키데이터 The black deer).
사이트에는 영어 제목 관례(Title Case)로 통일해서 내보낸다.

- 단어 첫 글자는 대문자: The Dallergut Dream Department Store
- a, an, the, and, but, or, for, of, in, on, at, to, by, with, from 같은 짧은 말은 소문자.
  단 첫 단어·끝 단어·콜론 뒤에서는 대문자: The Vegetarian: A Novel
- 원래 섞여 있는 표기는 그대로: iPhone, BTS, 1Q84, McDonald
- 로마 숫자는 대문자: King Henry VIII
- 영어가 아닌 제목(La lenteur)은 그 언어의 관례가 달라서 손대지 않는다

같은 규칙이 세 곳에 있다. 후보를 모을 때(`tools/fetch_titles_en.py`), 편집기에서 승인할 때
(`editor/app.js` 의 `enTitleCase`), 사이트를 만들 때(`generate.py` 의 `en_title_case`).
data.csv 에 이미 있는 값도 사이트에 나갈 때 이 규칙으로 맞춰진다. 고칠 때는 세 곳을 같이 고친다.

### Goodreads 는?

Goodreads 도 Open Library 처럼 한국어판과 영어판을 한 작품으로 묶어 두어서 가장 풍부합니다.
다만 공개 API가 2020년에 닫혔고 이용약관이 자동 수집을 금지해서 워크플로에서는 쓰지 않습니다.
대신 검수 카드의 "Goodreads (한국어판)" 링크가 한국어 제목으로 검색해 주니,
한국어판 페이지의 다른 판(Other editions)에서 영어판 제목을 확인하면 됩니다.

## 1단계 — 후보 찾기

GitHub 웹에서 Actions → Fetch English Titles → Run workflow.

| 입력 | 뜻 |
|------|-----|
| `limit` | 이번에 조회할 책 수. 처음엔 30으로 결과를 먼저 보세요. 0이면 전부 |
| `dry_run` | 켜면 결과만 찍고 파일은 안 바꿉니다 |
| `refresh` | 이미 조회했지만 아직 미검수인 책도 다시 조회 |
| `only` | 이 책만 다시 조회 (한국어 제목, 쉼표로 여러 개) |

data.csv 가 main 에 올라오면 새 책만 자동으로 조회합니다.
결과는 `data/titles_en.json` 에 바로 커밋됩니다. 승인 전에는 사이트에 영향이 없어서 PR을 거치지 않습니다.

Secret `ALADIN_TTB_KEY` 가 있으면 알라딘에서 원제를 찾고, `GOOGLE_BOOKS_API_KEY` 는 없어도 됩니다(확인은 무료인 Open Library 로 합니다). 둘 다 없어도 돕니다.

조회 방식이 바뀌면(스크립트의 `LOOKUP_VERSION`) 예전 방식으로 조회한 미검수 책은 다음 실행 때 저절로 다시 조회합니다.

로컬에서 (표준 라이브러리만 씁니다):

```bash
python3 tools/fetch_titles_en.py --limit 20 --dry-run
python3 tools/fetch_titles_en.py --only "소년이 온다,데미안"
```

data.csv 값이 근거 있는 후보와 같으면 자동 승인해 둡니다(카드에 "(자동)" 표시).
나중에 data.csv 값이 바뀌면 자동 승인은 풀리고 다시 미검수로 돌아갑니다.

## 2단계 — 편집기에서 고르기

편집기(/editor/)의 🔤 영문 제목 검수 창을 엽니다.

기본 필터 "우선 검수"는 후보가 있는 미검수 책만 보여 주고, 확실한 것부터 올라옵니다.

- 확실 — Open Library 에 같은 제목·저자의 영어판이 있거나, 두 곳 이상에서 같은 제목이 나옴
- 후보 — 한 곳에서만 나옴. 일본어 원서명을 로마자로 적은 경우도 있으니 근거 링크를 확인하세요

카드의 후보를 누르면 입력칸에 들어갑니다. 그다음:

| 버튼 | 결과 |
|------|-----|
| 승인 | 공식 영문판 제목으로 나감 |
| 공식판 없음 (직역*) | 입력칸의 직역 끝에 * 을 붙여 나감 (영문 페이지 하단에 기계 번역이라는 설명이 붙음) |
| 영문 숨김 | 이 책을 영문 페이지에서 뺌 |
| 보류 | 미검수로 되돌림 — data.csv 값이 그대로 나감 |

저장 버튼을 누르면 `data/titles_en.json` 만 커밋되고, 사이트는 몇 분 뒤 자동으로 다시 빌드됩니다.
워크플로가 그사이 후보를 갱신했어도 최신 파일 위에 내가 정한 칸만 덮어서 저장하므로 충돌이 나지 않습니다.

## 빌드 안전장치

generate.py 는 영문 제목에 다음이 섞여 있으면 영문 페이지에서 빼고 빌드 로그에 경고를 남깁니다.

- `(or ...)` 같은 대안 문구
- "or similar", "no confirmed", "official English" 같은 AI 설명 문구
- 한글
- 한국어 제목에는 없는 `A / B` 식 후보 나열

같은 규칙이 편집기에도 있어서 이런 값은 승인 버튼이 막습니다.
규칙을 고칠 때는 `generate.py` 의 `EN_TITLE_PROBLEMS`, `tools/fetch_titles_en.py` 의 `PROBLEM_RULES`,
`editor/app.js` 의 `ttlProblem()` 세 곳을 같이 고칩니다.

## 우선순위

영문 제목은 이 순서로 정해집니다.

1. `data/titles_en.json` 에서 승인(approved)된 값
2. 공식판 없음(none) — 값이 있으면 직역 * , 없으면 영문 페이지에서 뺌
3. 미검수(pending)면 data.csv 의 `도서명_en`
4. 위 값이 빌드 안전장치에 걸리면 뺌
