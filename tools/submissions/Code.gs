/**
 * Favorbook 제보 시트 기록기 — Google Apps Script 웹앱
 *
 * 편집기의 📮 제보 반영 창이 이 웹앱에 POST 하면, 제보 시트의 해당 행에
 *   - '반영' 칸 체크박스 (반영일 때만 체크)
 *   - '상태' 칸 (반영 / 보류 / 미반영)
 *   - '편집기 메모' 칸 (보류 이유 등)
 *   - '처리 시각' 칸
 * 을 적고, 행 전체 배경색을 바꾼다: 파랑 = 반영, 노랑 = 보류, 빨강 = 미반영.
 * 칸이 없으면 응답 칸 바로 오른쪽(E열부터)에 새로 만든다.
 *
 * 설치·배포는 tools/submissions/README.md 참고. 시트 소유자 계정으로 배포한다.
 */

const SHEETS = {
  en:   '1J4B0pa2Hv3l4nNfzMwghqWHdXT7cUbFZE3gPY1gCzvk',   // 영문 제보
  intl: '186gKVna6LANvKkdvqJF7V3MTSZdDgI3xksmOgY4WtGM',   // 해외 제보
};
const COLORS = { '반영': '#cfe2ff', '보류': '#fff2b3', '미반영': '#ffd0d0' };
const H = { check: '반영', state: '상태', note: '편집기 메모', at: '처리 시각' };

/* 처음 한 번 실행 — 편집기와 나눠 쓸 키를 만들고, 새 제보가 들어오면 빨간색(미반영)으로 칠하는 트리거를 건다. */
function setup() {
  const props = PropertiesService.getScriptProperties();
  let key = props.getProperty('EDITOR_KEY');
  if (!key) {
    key = Utilities.getUuid().replace(/-/g, '');
    props.setProperty('EDITOR_KEY', key);
  }
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'onFormSubmitMark')
    .forEach(t => ScriptApp.deleteTrigger(t));
  for (const id of Object.values(SHEETS)) {
    ScriptApp.newTrigger('onFormSubmitMark').forSpreadsheet(id).onFormSubmit().create();
    ensureCols_(sheetOf_(id));
  }
  Logger.log('EDITOR_KEY = ' + key + '  ← 편집기 📮 제보 반영 › ⚙️ 시트 연결에 넣으세요');
}

/* 새 제보 → 미반영(빨강) */
function onFormSubmitMark(e) {
  try {
    const sh = e.range.getSheet();
    const cols = ensureCols_(sh);
    mark_(sh, cols, e.range.getRow(), '미반영', null);
  } catch (err) {
    console.error(err);
  }
}

function doGet() {
  return json_({ ok: true, app: 'favorbook-submissions' });
}

function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'JSON 형식이 아니에요' }); }
  const key = PropertiesService.getScriptProperties().getProperty('EDITOR_KEY');
  if (!key || body.key !== key) return json_({ ok: false, error: '키가 맞지 않아요 (EDITOR_KEY)' });
  if (body.action === 'ping') return json_({ ok: true, sheets: Object.keys(SHEETS) });

  const id = SHEETS[body.sheet];
  if (!id) return json_({ ok: false, error: '알 수 없는 시트: ' + body.sheet });
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = sheetOf_(id);
    const cols = ensureCols_(sh);
    const last = sh.getLastRow();
    const ts = last > 1 ? sh.getRange(1, 1, last, 1).getDisplayValues().map(r => String(r[0]).trim()) : [];
    const results = [];
    (body.updates || []).forEach((u, req) => {
      const st = String(u.status || '');
      if (st && !(st in COLORS)) { results.push({ req, ok: false, error: '상태 값: ' + st }); return; }
      let row = Number(u.row);
      // 행이 밀렸으면 타임스탬프로 다시 찾는다
      if (u.ts && ts[row - 1] !== String(u.ts).trim()) {
        const i = ts.indexOf(String(u.ts).trim());
        if (i < 1) { results.push({ req, ok: false, error: '행을 못 찾음' }); return; }
        row = i + 1;
      }
      mark_(sh, cols, row, st, u.note);
      results.push({ req, ok: true, row });
    });
    SpreadsheetApp.flush();
    return json_({ ok: true, results });
  } finally {
    lock.releaseLock();
  }
}

function mark_(sh, cols, row, st, note) {
  const width = Math.max(sh.getLastColumn(), cols.at);
  const cb = sh.getRange(row, cols.check);
  if (!cb.getDataValidation()) cb.insertCheckboxes();
  cb.setValue(st === '반영');
  sh.getRange(row, cols.state).setValue(st);
  if (note != null) sh.getRange(row, cols.note).setValue(note);
  sh.getRange(row, cols.at).setValue(new Date());
  sh.getRange(row, 1, 1, width).setBackground(st ? COLORS[st] : null);
}

// 폼 응답 시트 (폼이 연결된 탭, 없으면 첫 탭)
function sheetOf_(id) {
  const ss = SpreadsheetApp.openById(id);
  return ss.getSheets().find(s => s.getFormUrl()) || ss.getSheets()[0];
}

function ensureCols_(sh) {
  const lastCol = sh.getLastColumn();
  const head = sh.getRange(1, 1, 1, lastCol).getDisplayValues()[0].map(h => String(h).trim());
  const cols = {};
  let next = lastCol + 1;
  for (const [k, name] of Object.entries(H)) {
    let i = head.indexOf(name);
    if (i < 0) {
      sh.getRange(1, next).setValue(name).setFontWeight('bold');
      i = next - 1;
      next++;
    }
    cols[k] = i + 1;
  }
  return cols;
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
