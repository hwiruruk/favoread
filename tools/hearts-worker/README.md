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
   - 만든 데이터베이스의 **Console** 탭에 [`schema.sql`](./schema.sql) 내용을 통째로 붙여 넣고 **Execute**
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

## 하트 순위 보기

`GET /top?type=c&limit=20` 은 하트가 많은 셀럽, `type=b` 는 책 순위를 돌려줍니다.
D1 Console에서 바로 보려면:

```sql
SELECT item, n FROM counts ORDER BY n DESC LIMIT 30;
```

## 무료 한도

D1 무료 플랜은 하루 쓰기 10만 건, 읽기 500만 행입니다. 하트 한 번에 쓰기 2건이라
하루 수만 번 눌려도 충분합니다.
