-- favorbook 하트 D1 스키마
-- Cloudflare 대시보드 → D1 → 데이터베이스 → Console 에 통째로 붙여 넣고 실행한다.

-- 누가 무엇에 하트를 눌렀는지. voter는 브라우저 id를 해시한 값이다.
CREATE TABLE IF NOT EXISTS hearts (
  item    TEXT    NOT NULL,
  voter   TEXT    NOT NULL,
  created INTEGER NOT NULL,
  PRIMARY KEY (item, voter)
);

-- 항목별 하트 수. 페이지를 열 때마다 hearts를 세지 않도록 따로 들고 있는다.
CREATE TABLE IF NOT EXISTS counts (
  item TEXT    PRIMARY KEY,
  n    INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS counts_n ON counts (n DESC);
