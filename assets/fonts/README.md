# KoPubWorld 웹폰트

사이트 한글 서체. **바탕(Batang)** = 세리프, **돋움(Dotum)** = 산세리프.

- 저작권: Korea Publisher Society (대한출판문화협회) · 디자인 FONTRIX Inc.
- 버전: 1.1.1 (원본 TTF `KOPUBWORLD_TTF_FONTS`)
- 배포처: https://www.kopus.org/biz-electronic-font2/

> 폰트 파일 안에 라이선스 필드(name ID 13/14)가 비어 있어, 원본 배포처의
> 이용 약관을 따른다. KoPubWorld는 무료 배포·상업적 이용이 가능하지만
> **판매와 폰트 자체의 변형은 금지**된다. 저장소가 공개라 파일이 그대로
> 내려받아지므로, 약관이 바뀌면 이 폴더를 먼저 확인할 것.

## 무엇을 바꿨나

원본 6개 TTF는 합쳐서 **50MB**다. 웹에 그대로 올릴 수 없어 서브셋했다.

| | 원본 TTF | 서브셋 woff2 |
|---|---|---|
| Batang Light / Medium / Bold | 12.0 / 11.9 / 11.9 MB | 409 / 355 / 399 KB |
| Dotum Light / Medium / Bold | 5.1 / 5.1 / 5.0 MB | 211 / 241 / 222 KB |
| **합계** | **50 MB** | **1.8 MB** |

남긴 글자:

- 현대 완성형 한글 11,172자 (`U+AC00–D7A3`) — 어떤 한국어 텍스트가 와도 안 깨진다
- 호환 자모 (`U+3130–318F`) — `ㅋㅋㅋ`, `ㅠㅠ` 같은 낱자
- 라틴·숫자·문장부호·화살표·도형·이모지 영역 일부

뺀 글자: **한자**와 **옛한글**. 용량의 대부분을 차지하는데 이 사이트 텍스트에는
쓰이지 않는다. (책 제목에 한자가 들어오면 그 글자만 시스템 폰트로 떨어진다.)

## 다시 만들려면

```bash
pip install fonttools brotli

python3 - <<'PY'
from fontTools import subset
BASE  = "U+0020-007E,U+00A0-00FF,U+2010-2027,U+2030-205E,U+20A9,U+20AC,U+2190-21BB,U+25A0-25FF,U+2600-27BF,U+3000-303F,U+FF01-FF60"
RANGES = f"{BASE},U+3130-318F,U+AC00-D7A3"
FILES = {
    'KoPubWorld Batang Light.ttf':  'kopubworld-batang-light.woff2',
    'KoPubWorld Batang Medium.ttf': 'kopubworld-batang-medium.woff2',
    'KoPubWorld Batang Bold.ttf':   'kopubworld-batang-bold.woff2',
    'KoPubWorld Dotum Light.ttf':   'kopubworld-dotum-light.woff2',
    'KoPubWorld Dotum Medium.ttf':  'kopubworld-dotum-medium.woff2',
    'KoPubWorld Dotum Bold.ttf':    'kopubworld-dotum-bold.woff2',
}
for src, out in FILES.items():
    o = subset.Options(); o.flavor='woff2'; o.layout_features=['*']; o.notdef_outline=True
    f = subset.load_font(src, o)
    s = subset.Subsetter(options=o); s.populate(unicodes=subset.parse_unicodes(RANGES)); s.subset(f)
    subset.save_font(f, out, o); f.close()
PY
```

## 굵기

KoPubWorld는 Light / Medium / Bold 셋뿐이다. `kopubworld.css`가 `font-weight`를
구간으로 받아서, 기존 CSS의 `font-weight: 200`이나 `900`을 고치지 않아도 된다.

| 지정한 weight | 실제 파일 |
|---|---|
| 100 ~ 300 | Light |
| 400 ~ 500 | Medium |
| 600 ~ 900 | Bold |

## 어디에 쓰이나

`assets/fonts/kopubworld.css`를 불러오는 곳:

- `index.html` — 메인 (Tailwind `font-serif` = 바탕, 한글 본문 = 돋움)
- `updates.html`, `en/index.html` — `generate.py`가 생성
- `cardnews/`, `together/` — 카드 만드는 도구 (UI와 카드 양쪽)

**바꾸지 않은 서체**: Black Han Sans · Jua · Gaegu(손글씨) · Space Grotesk ·
Cormorant Garamond. 카드 테마의 성격을 만드는 디스플레이 서체라 바탕/돋움으로
바꾸면 테마가 밋밋해진다. `share/*.html`(셀럽 페이지)은 원래 시스템 폰트를 써서
건드리지 않았다.
