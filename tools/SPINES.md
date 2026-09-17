# 책등 이미지 채우기 (`tools/fetch_spines.py`)

셀럽 책장·카드뉴스·함께 읽기 카드의 **책등 보기**에 쓸 이미지 URL을 모읍니다.

## 왜 필요한가

예스24는 표지와 **같은 상품 ID**로 책등 이미지를 줍니다.

```
표지  https://image.yes24.com/goods/91901136/L
책등  https://image.yes24.com/goods/91901136/side
```

그래서 표지를 예스24에서 가져온 책은 API를 부르지 않고 URL만 바꾸면 됩니다.
문제는 **표지가 알라딘인 책** — 예스24 상품 ID를 모릅니다. 이 배치가 그걸 찾습니다.

현재 상황 (고유 도서 1,174권 기준):

| | 권수 | 처리 |
|---|---|---|
| 표지가 예스24 | 204 | URL 유도 — 조회 불필요 |
| 알라딘 ItemId 있음 | 942 | **이 배치가 조회** |
| 단서 없음 | 28 | 색 책등으로 남음 |

## 어떻게 찾나

```
알라딘 ItemId ──(알라딘 ItemLookUp)──▶ ISBN13
ISBN13 ──(예스24 itemDetail)──▶ 예스24 표지 URL ──▶ 상품 ID ──▶ 책등 URL
```

ISBN으로 못 찾으면 **제목+저자로 검색**하고, 제목이 충분히 일치할 때만 받아들입니다
(괄호 안 부제와 문장부호를 턴 뒤 비교). 마지막으로 **책등 이미지가 진짜 있는지
`HEAD`로 확인**하고 기록합니다 — 예스24에 상품은 있어도 책등이 없는 책이 있습니다.

## 실행

```bash
export ALADIN_TTB_KEY=ttb...                      # 알라딘 TTB 키
export YES24_PROXY=https://<worker>.workers.dev   # 예스24 프록시 Worker
# 또는 키를 직접:  export YES24_API_KEY=...

python3 tools/fetch_spines.py --limit 30 --dry-run   # 먼저 30권만 확인
python3 tools/fetch_spines.py                        # 전체
```

| 옵션 | 뜻 |
|---|---|
| `--limit N` | 이번 실행에서 새로 조회할 책 수 (0=무제한) |
| `--dry-run` | 파일에 쓰지 않고 결과만 출력 |
| `--refresh` | 실패로 기록된 책도 다시 조회 |
| `--recheck` | 이미 찾은 책등이 아직 살아있는지 다시 확인 |
| `--sleep SEC` | 호출 간 대기 (기본 0.34초 — 예스24 초당 한도 여유) |

한 번에 다 돌릴 필요 없습니다. 실패한 책은 `misses`에 이유와 함께 남아서
다음 실행 때 건너뜁니다. `--refresh` 로 다시 시도할 수 있어요.

예스24 프록시 Worker 준비는 [`tools/yes24-proxy/README.md`](./yes24-proxy/README.md) 참고.

## 결과 — `data/spines.json`

```json
{
  "generated": "2026-09-17",
  "spines": { "소년이 온다": "https://image.yes24.com/goods/13137546/side" },
  "misses": { "어떤 책": "예스24에 책등 이미지 없음 (goods 12345)" }
}
```

**`data.csv` 는 건드리지 않습니다.** 편집기가 CSV를 자기 모델대로 다시 쓰기 때문에,
배치 결과를 CSV에 넣으면 다음 저장 때 날아갈 수 있습니다. 그래서 별도 파일로 뒀어요.
손으로 고쳐도 되고, 잘못 찾은 책은 `spines`에서 지우면 색 책등으로 돌아갑니다.

## 반영

`generate.py` 가 `data/spines.json` 을 읽어서

- 셀럽 책장 페이지(`share/*.html`)에 책등 이미지를 직접 박고
- `data.json` 의 각 책에 `spineUrl` 을 실어 보냅니다 →
  `together/`·`cardnews/` 가 그대로 씁니다

그러니 배치를 돌린 뒤에는 **`python3 generate.py` 를 한 번 돌려야** 사이트에 반영됩니다.

책등 이미지를 못 찾은 책은 제목에서 만든 **색 책등**으로 그려집니다. 화면이 비지 않아요.
