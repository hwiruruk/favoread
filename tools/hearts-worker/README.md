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
- 하트를 하나라도 누르면 화면 왼쪽 아래에 **♥ 내 하트** 버튼이 생깁니다. 누르면 서랍이 열려
  하트한 셀럽과 책을 셀럽별로 묶어 보여 줍니다(장바구니처럼). 책은 하트를 누를 때 보던 셀럽 아래에 들어가고,
  여러 셀럽이 읽은 책을 책 페이지에서 담으면 '여러 셀럽이 읽은 책'에 따로 모입니다.
  책을 누르면 그 셀럽 책장의 해당 책 칸으로 바로 갑니다. 책마다 ✕, 셀럽 묶음마다 '모두 빼기'로 지울 수 있고
  (하트가 빠지므로 서버의 하트 수도 줄어듭니다) 마지막으로 뺀 것은 잠깐 '되돌리기'가 됩니다.
  '목록 복사'는 셀럽별 책 목록 끝에 홈페이지 주소만 붙여 글로 꺼냅니다.
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
   (편집기 위쪽의 **❤️ 하트 통계** 버튼으로도 갈 수 있습니다)

전체 하트 수, 오늘·최근 7일 하트, 최근 30일 그래프, 셀럽·책 순위(각 100위), 최근 하트 100건을 보여 줍니다.
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

## 무료 한도

D1 무료 플랜은 하루 쓰기 10만 건, 읽기 500만 행입니다. 하트 한 번에 쓰기 2건이라
하루 수만 번 눌려도 충분합니다.
