# 하트 서버 (Cloudflare Worker + D1)

방문자가 셀럽과 책에 하트를 누르고, 모두가 같은 하트 수를 보게 해 주는 서버입니다.
페이지 쪽 동작은 [`assets/hearts.js`](../../assets/hearts.js)가 맡습니다.

`assets/hearts.js`의 `HEARTS_API`가 비어 있는 동안에는 하트 버튼이 보이지 않습니다.
아래 순서대로 한 번 배포하고 주소를 넣으면 사이트 전체에 하트가 나타납니다.

## 배포 (10분, 무료)

1. https://dash.cloudflare.com 에 로그인
2. D1 데이터베이스 만들기
   - 좌측 **Storage & Databases → D1 SQL Database → Create**
   - 이름: `favorbook-hearts`
   - 만든 데이터베이스의 **Console** 탭에서 [`schema.sql`](./schema.sql)의 `CREATE` 문 3개를 하나씩 붙여 넣고 각각 **Execute**
     (통째로 붙여 넣으면 줄바꿈이 사라져 `--` 설명 줄이 뒤를 모두 가려 "Requests without any query are not supported" 오류가 난다)
3. Worker 만들기
   - **Workers & Pages → Create → Create Worker**, 이름: `favorbook-hearts` → **Deploy**
   - **Edit code** → 기존 코드를 지우고 [`worker.js`](./worker.js) 내용을 붙여 넣기 → **Deploy**
4. Worker에 데이터베이스 연결
   - Worker의 **Settings → Bindings → Add → D1 database**
   - Variable name: `DB` (꼭 대문자 DB), Database: `favorbook-hearts`
5. (권장) 비밀 문자열 넣기
   - **Settings → Variables and Secrets → Add**, 종류 Secret
   - 이름 `SALT`, 값은 아무 긴 문자열 (한 번 정하면 바꾸지 마세요. 바꾸면 기존 하트를 다시 누를 수 있게 됩니다)
6. Worker 주소 확인
   - 예: `https://favorbook-hearts.<계정>.workers.dev`
   - 브라우저로 열어 `{"ok":true,"service":"favorbook-hearts"}`가 나오면 성공
7. [`assets/hearts.js`](../../assets/hearts.js) 위쪽의 `HEARTS_API = ''` 따옴표 안에 이 주소를 넣고 커밋

페이지를 다시 만들 필요는 없습니다. 모든 페이지가 같은 `assets/hearts.js`를 불러옵니다.

## 동작 방식

- 키: 셀럽은 `c:` + 한국어 이름, 책은 `b:` + 한국어 제목. 한국어·영문 페이지의 하트 수가 합쳐집니다.
- 하트를 누른 사람은 브라우저마다 만든 무작위 id로 구분합니다. 같은 브라우저에서는 한 번만 셀 수 있고,
  다시 누르면 하트가 빠집니다. 서버에는 이 id를 해시한 값만 남습니다.
- `data.json`에 있는 셀럽·책만 하트를 받습니다(1시간마다 다시 읽음).
- 하트를 넣고 빼는 요청은 `ALLOWED_ORIGIN`(기본 favorbook.co.kr)과 localhost에서만 받습니다.
- IP 하나당 1분에 40번까지로 연타를 막습니다.
- 같은 IP에서 같은 셀럽·책에 넣을 수 있는 하트는 하루 10개까지입니다(한국 시간 기준).
  시크릿 창이나 저장소 삭제로 몰아서 누르는 것을 막는 장치입니다. 이미 누른 하트를 빼는 것은 언제든 됩니다.
- 하트를 하나라도 누르면 화면 왼쪽 아래에 **♥ 내 책장** 버튼이 생깁니다. 누르면 서랍이 열려
  하트한 셀럽과 책을 셀럽별로 묶어 보여 줍니다(장바구니처럼). 책은 하트를 누를 때 보던 셀럽 아래에 들어가고,
  여러 셀럽이 읽은 책을 책 페이지에서 담으면 '여러 셀럽이 읽은 책'에 따로 모입니다.
  책을 누르면 그 셀럽 책장의 해당 책 칸으로 바로 갑니다. 책마다 ✕, 셀럽 묶음마다 '모두 빼기'로 지울 수 있고
  (하트가 빠지므로 서버의 하트 수도 줄어듭니다) 마지막으로 뺀 것은 잠깐 '되돌리기'가 됩니다.
  서랍 위의 버튼 세 개로 목록을 꺼냅니다.
  '이미지 저장'은 책등 사진을 세운 배경이 투명한 책장 모양 PNG(가로 1080)로 저장하고(휴대폰은 공유 창 → 사진에 저장),
  '텍스트 복사'는 번호를 붙인 일반 글로, '마크다운 복사'는 제목·목록·링크가 살아나는 마크다운으로 복사합니다.
  이미지는 편집기(`editor/shelf.js`)와 같은 방식으로 canvas에 직접 그리며, 책등 사진은 images.weserv.nl을 거쳐 불러오고
  못 불러온 책은 색 책등으로 대신합니다.
  서랍 내용은 서버가 아니라 그 브라우저(localStorage)에만 저장되며, 서랍은 `assets/hearts.js`가 그립니다.
- 메인 카드의 하트 숫자는 `GET /celebs` 한 번으로 받습니다. 결과를 1분 캐시하므로 방문자가 많아도 D1은 1분에 한 번 정도만 읽습니다.

### 2026-09 이전에 만든 데이터베이스 업데이트

IP당 하루 제한을 켜려면 D1 **Console**에서 아래 두 줄을 하나씩 실행한 뒤, 새 `worker.js`를 다시 배포합니다.
실행하지 않아도 하트는 예전처럼 작동하고 제한만 꺼져 있습니다.

```sql
ALTER TABLE hearts ADD COLUMN ip TEXT;
```

```sql
CREATE INDEX IF NOT EXISTS hearts_item_ip ON hearts (item, ip, created);
```

## 하트 통계 보기 (운영자 전용)

하트 순위와 기록은 운영자만 볼 수 있습니다.

1. Worker의 **Settings → Variables and Secrets → Add**, 종류 Secret
   - 이름 `ADMIN_KEY`, 값은 남이 짐작할 수 없는 긴 비밀번호 (20자 이상 권장)
2. 새 [`worker.js`](./worker.js)를 **Edit code**에 다시 붙여 넣고 **Deploy**
3. https://favorbook.co.kr/editor/hearts.html 을 열고 그 비밀번호를 넣기
   (편집기 위쪽의 **❤️ 하트·조회수 통계** 버튼으로도 갈 수 있습니다)

전체 하트 수, 오늘·최근 7일 하트, 최근 30일 그래프, 셀럽·책 순위(각 100위), 최근 하트 100건을 보여 줍니다.
아래쪽에는 자체 집계한 오늘·7일·30일 조회수, 30일 조회수 그래프, 인기 페이지 순위(조회수 탭)도 같이 나옵니다. 조회수 서버를 아직 배포하지 않았으면 그 부분만 안내 문구가 뜨고 하트 통계는 그대로 보입니다.
누가 눌렀는지는 서버에도 남지 않으므로 통계에도 나오지 않습니다.

`ADMIN_KEY`가 없으면 통계 주소(`/admin/stats`, `/top`)는 꺼져 있습니다.
API로 직접 부를 때는 `Authorization: Bearer <ADMIN_KEY>` 헤더를 붙입니다.

D1 Console에서 바로 보려면:

```sql
SELECT item, n FROM counts ORDER BY n DESC LIMIT 30;
```

## 하트 마중물 넣기

하트가 모두 0이면 처음 온 방문자가 누르기 망설이므로, 처음 숫자를 조금 넣어 둘 수 있습니다.
[`seed.sql`](./seed.sql)의 `INSERT` 문 한 줄을 D1 **Console**에 붙여 넣고 **Execute** 하면 됩니다(한 번만).

- 서치콘솔 인기 검색어에 나온 셀럽 8명(카리나, 코르티스 주훈·건호·마틴·성현, 박지훈, 한로로, 문가영)과
  그들이 읽은 책 14권에 3~17개씩, 모두 22곳에 들어갑니다.
- `counts`에만 더하므로 이미 있는 하트 수 위에 얹히고, 통계의 전체·오늘·7일 하트 수에는 섞이지 않습니다.
- 메인 카드 숫자는 1분 캐시라 넣고 1분쯤 뒤에 보입니다.
- 되돌릴 때는 같은 파일의 `UPDATE` 문을 실행하면 넣은 만큼만 빠집니다.

읽은 책이 많은 셀럽과 검색 인기 셀럽에 더 몰아서 넣고 싶으면 [`seed-500.sql`](./seed-500.sql)을 씁니다. `data.json`의 셀럽별 책 권수에 비례해 500개를 나누되, 서치콘솔 인기 검색어에 나온 8명은 3배 가중합니다(책이 적은 셀럽은 0~1개). 위 `seed.sql`과 따로 더해지며, 같은 방식으로 한 번만 실행하고 되돌릴 때는 파일 안의 `UPDATE` 문을 씁니다.

## 페이지 조회수 (GA를 거치지 않는 자체 집계)

모든 공개 페이지가 [`assets/views.js`](../../assets/views.js)를 불러와 열릴 때 Worker의 `POST /view`로 한 번 알립니다.
광고 차단기에 덜 가려지고, 서버에는 **페이지 주소·날짜별 횟수만** 남습니다(방문자 id·IP는 저장하지 않음).

1. D1 **Console**에서 [`schema.sql`](./schema.sql)의 `CREATE TABLE IF NOT EXISTS views ...` 문을 실행
2. 새 [`worker.js`](./worker.js)를 **Edit code**에 붙여 넣고 **Deploy** (바인딩·변수는 그대로)
3. 사이트를 다시 생성하면(update-sitemap 워크플로) 각 페이지 `<head>`에 `views.js`가 들어갑니다

세는 기준

- 같은 탭에서 같은 페이지를 새로고침하거나 다시 열어도 한 번만 셉니다(브라우저 sessionStorage).
- 서버는 User-Agent에 봇·크롤러·미리보기 표시가 있는 요청, 허용 출처(`ALLOWED_ORIGIN`)가 아닌 요청, IP당 1분 40회 초과를 세지 않습니다.
- 주소는 `/index.html`을 `/`로 합치고 `?검색어`·`#해시`는 버립니다. 날짜는 한국 시간 기준입니다.
- 한국어·영문 페이지는 주소가 다르므로 따로 셉니다.

보기 (운영자 전용, `ADMIN_KEY` 필요)

```bash
curl -H "Authorization: Bearer <ADMIN_KEY>" "https://favorbook-hearts.<계정>.workers.dev/admin/views?days=30"
```

최근 N일(최대 90) 일별 합계와 페이지 순위 100개가 나옵니다. D1 Console에서 바로 보려면:

```sql
SELECT path, SUM(n) AS n FROM views GROUP BY path ORDER BY n DESC LIMIT 30;
```

GA 수치와는 완전히 같지 않습니다. 이 집계는 차단기에 덜 가려지는 대신 JS가 꺼진 방문은 못 세고, 봇 판별 기준도 다릅니다.
한쪽을 기준으로 정해 추세를 보세요.

## 사이트 검색어 (검색창 기록)

사이트 검색창에서 입력한 검색어를 Worker의 `POST /search`로 보내 날짜별 횟수로 쌓습니다.
검색창이 두 종류라 기록하는 파일도 둘입니다.

- 메인 한국어·영문 페이지: 입력할 때마다 목록을 바로 걸러 주는 자체 검색창이라 [`assets/views.js`](../../assets/views.js)가 입력창(`#search-input`, `#en-search-input`)에 붙어 기록합니다.
  걸러진 결과 문구가 `결과 없음`·`No results`이면 결과 없는 검색으로 셉니다. 책 칩을 눌러 자동으로 채워지는 검색은 사람이 친 말이 아니므로 세지 않습니다.
- 그 밖의 페이지(셀럽·그룹·작가·영문 등 약 2,700개): [`assets/v2/search.js`](../../assets/v2/search.js)가 기록합니다.

메인 검색창의 HTML 구조(입력창·결과 문구 id)를 바꾸면 `views.js`의 `MAIN_SEARCH` 설정도 함께 고쳐야 합니다.
구글·네이버에서 들어온 검색어는 서치 콘솔·서치어드바이저에서 따로 보고, 여기서는 **우리 사이트 안에서 찾은 말**만 봅니다.

1. D1 **Console**에서 [`schema.sql`](./schema.sql)의 `CREATE TABLE IF NOT EXISTS searches ...` 문을 실행
2. 새 [`worker.js`](./worker.js)를 **Edit code**에 붙여 넣고 **Deploy**
3. 검색창 스크립트는 모든 페이지가 같은 파일을 불러오므로 병합만 하면 적용됩니다(페이지를 다시 만들 필요 없음).
   브라우저 캐시 때문에 방문자에게는 하루쯤 걸릴 수 있습니다.

세는 기준

- 글자를 칠 때마다가 아니라 입력을 1.2초 멈춘 뒤 한 번만 기록합니다. 같은 검색어를 이어서 다시 치면 세지 않습니다.
- 2글자 미만, 40자 초과, 주소·이메일처럼 보이는 입력은 저장하지 않습니다. 영문은 소문자로 합칩니다.
- 칸마다 검색 횟수, 추천 결과가 하나도 없었던 횟수, 추천 결과를 누른 횟수를 셉니다.
- 방문자 id·IP는 보내지도 저장하지도 않습니다. 봇·허용 출처가 아닌 요청은 세지 않습니다.

보기: 하트·조회수 통계 화면의 **인기 검색어**, **결과 없는 검색어** 탭. 결과 없는 검색어는 사람들이 찾는데 사이트에 없는 셀럽·책이라 추가할 후보를 고르는 데 씁니다.

```bash
curl -H "Authorization: Bearer <ADMIN_KEY>" "https://favorbook-hearts.<계정>.workers.dev/admin/searches?days=30"
```

```sql
SELECT q, SUM(n) AS n, SUM(zero) AS zero FROM searches GROUP BY q ORDER BY n DESC LIMIT 30;
```

## 무료 한도

D1 무료 플랜은 하루 쓰기 10만 건, 읽기 500만 행입니다. 하트 한 번에 쓰기 2건이라
하루 수만 번 눌려도 충분합니다. 조회수는 한 번에 쓰기 1건이라 하루 약 10만 페이지뷰까지 무료로 셉니다.
