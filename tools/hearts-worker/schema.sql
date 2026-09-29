-- favorbook 하트 D1 스키마
-- Cloudflare 대시보드 → D1 → 데이터베이스 → Console 에서 아래 CREATE 문을 하나씩 실행한다.
-- (통째로 붙여 넣으면 줄바꿈이 사라져 -- 설명 줄이 뒤를 모두 가린다)

-- 누가 무엇에 하트를 눌렀는지. voter는 브라우저 id를, ip는 IP를 해시한 값이다.
CREATE TABLE IF NOT EXISTS hearts (item TEXT NOT NULL, voter TEXT NOT NULL, created INTEGER NOT NULL, ip TEXT, PRIMARY KEY (item, voter));

-- IP당 하루 제한을 빨리 세기 위한 색인
CREATE INDEX IF NOT EXISTS hearts_item_ip ON hearts (item, ip, created);

-- 항목별 하트 수. 페이지를 열 때마다 hearts를 세지 않도록 따로 들고 있는다.
CREATE TABLE IF NOT EXISTS counts (item TEXT PRIMARY KEY, n INTEGER NOT NULL DEFAULT 0);

CREATE INDEX IF NOT EXISTS counts_n ON counts (n DESC);

-- 2026-09 이전에 만든 데이터베이스는 아래 두 줄을 하나씩 실행해 ip 칸을 더한다.
-- ALTER TABLE hearts ADD COLUMN ip TEXT;
-- CREATE INDEX IF NOT EXISTS hearts_item_ip ON hearts (item, ip, created);
