/**
 * Favorbook 시트 헬퍼 — Google Apps Script
 *
 * 메뉴: 📚 Favorbook
 *  · 빈 칸 검사  → 컬럼별 채움 상태, 누락된 critical 필드 행 리스트
 *  · 새 행 추가  → 자동완성 폼 (영문 컬럼은 lookup ARRAYFORMULA가 자동 채움)
 *  · 통계        → 셀럽/책/작가 unique 카운트 + 영문 진행률
 *
 * Web App으로도 배포 가능 — README 참고.
 *
 * 셋업 안내는 같은 폴더의 README.md 참고.
 */

// 메인 데이터 시트 이름. 시트명이 다르면 여기 바꿔주세요.
const MAIN_SHEET_NAME = '메인';

// 새 행 추가 시작 위치 (1000행부터 채움 — 기존 데이터/수식과 분리)
const START_ROW = 1000;

// 채워져 있어야 하는 critical 컬럼 (없으면 데이터로서 부적합)
const REQUIRED_COLS = ['연예인', '도서명', '저자', '출판사', '출처'];

// 있으면 좋은 optional 컬럼
const OPTIONAL_COLS = ['도서 정보', '도서 이미지', '연예인 이미지', '코멘트'];

// 영문 메타 (lookup 시트에서 ARRAYFORMULA로 자동 채워짐)
const EN_COLS = ['연예인_en', '도서명_en', '저자_en'];


function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('📚 Favorbook')
    .addItem('빈 칸 검사', 'showMissingReport')
    .addItem('새 행 추가', 'showAddDialog')
    .addItem('통계 보기', 'showStats')
    .addToUi();
}


// ── 메인 시트 가져오기 ──────────────────────────────────────
function getMainSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(MAIN_SHEET_NAME) || ss.getActiveSheet();
}

// 헤더 → 컬럼 인덱스 매핑 (substring 매칭)
function buildColIndex(headers) {
  const idx = {};
  headers.forEach((h, i) => {
    const s = String(h || '').trim();
    idx[s] = i;
  });
  // substring fallback
  function find(name) {
    if (idx[name] !== undefined) return idx[name];
    for (let i = 0; i < headers.length; i++) {
      if (String(headers[i] || '').includes(name)) return i;
    }
    return -1;
  }
  return { exact: idx, find: find };
}

function isBlank(v) {
  return v === null || v === undefined || String(v).trim() === '';
}

function startsWithQ(v) {
  return String(v || '').trim().startsWith('?');
}


// ── 빈 칸 검사 ──────────────────────────────────────────────
function showMissingReport() {
  const data = analyzeMissing();
  const html = HtmlService.createTemplateFromFile('MissingReport');
  html.data = data;
  const out = html.evaluate().setWidth(900).setHeight(700);
  SpreadsheetApp.getUi().showModalDialog(out, '📚 빈 칸 검사');
}

function analyzeMissing() {
  const sheet = getMainSheet();
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) {
    return { error: '데이터 행이 없습니다.', sheetName: sheet.getName() };
  }
  const headers = values[0];
  const rows = values.slice(1);
  const ci = buildColIndex(headers);

  // 컬럼별 채움 통계
  const stats = [];
  const allCols = REQUIRED_COLS.concat(OPTIONAL_COLS).concat(EN_COLS);
  allCols.forEach(col => {
    const i = ci.find(col);
    if (i < 0) return;
    let filled = 0;
    let pending = 0;  // ? 접두사 (검수 대기)
    rows.forEach(r => {
      if (!isBlank(r[i])) {
        if (startsWithQ(r[i])) pending++;
        else filled++;
      }
    });
    const total = rows.length;
    stats.push({
      col: col,
      filled: filled,
      pending: pending,
      empty: total - filled - pending,
      total: total,
      pct: Math.round(filled / total * 100),
      required: REQUIRED_COLS.indexOf(col) >= 0,
    });
  });

  // Critical missing rows (REQUIRED_COLS 중 비어있는 행)
  const criticalRows = [];
  rows.forEach((r, idx) => {
    const missing = [];
    REQUIRED_COLS.forEach(col => {
      const i = ci.find(col);
      if (i >= 0 && isBlank(r[i])) missing.push(col);
    });
    if (missing.length) {
      const ni = ci.find('연예인');
      const ti = ci.find('도서명');
      criticalRows.push({
        rowNum: idx + 2,  // 1-indexed + header
        celeb: ni >= 0 ? r[ni] : '',
        book:  ti >= 0 ? r[ti] : '',
        missing: missing.join(', '),
      });
    }
  });

  return {
    sheetName: sheet.getName(),
    totalRows: rows.length,
    stats: stats,
    criticalRows: criticalRows,
    criticalCount: criticalRows.length,
  };
}


// ── 통계 ────────────────────────────────────────────────────
function showStats() {
  const data = computeStats();
  const html = HtmlService.createTemplateFromFile('Stats');
  html.data = data;
  const out = html.evaluate().setWidth(700).setHeight(550);
  SpreadsheetApp.getUi().showModalDialog(out, '📊 통계');
}

function computeStats() {
  const sheet = getMainSheet();
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return { error: '데이터 행이 없습니다.' };
  const headers = values[0];
  const rows = values.slice(1);
  const ci = buildColIndex(headers);

  function uniques(colName) {
    const i = ci.find(colName);
    if (i < 0) return new Set();
    const s = new Set();
    rows.forEach(r => {
      const v = String(r[i] || '').trim();
      if (v) s.add(v);
    });
    return s;
  }

  const celebs = uniques('연예인');
  const books = uniques('도서명');
  const authors = uniques('저자');

  function enFillRate(koCol, enCol) {
    const ki = ci.find(koCol);
    const ei = ci.find(enCol);
    if (ki < 0 || ei < 0) return null;
    // unique한 한국어 값 기준으로 영문이 채워진 비율
    const uniq = new Map();  // ko → has en
    rows.forEach(r => {
      const ko = String(r[ki] || '').trim();
      if (!ko) return;
      const en = String(r[ei] || '').trim();
      const hasEn = en && !en.startsWith('?');
      if (!uniq.has(ko) || hasEn) uniq.set(ko, hasEn);
    });
    let filled = 0;
    uniq.forEach(v => { if (v) filled++; });
    return { total: uniq.size, filled: filled, pct: Math.round(filled / uniq.size * 100) };
  }

  return {
    totalRows: rows.length,
    uniqueCelebs: celebs.size,
    uniqueBooks: books.size,
    uniqueAuthors: authors.size,
    celebsEn: enFillRate('연예인', '연예인_en'),
    booksEn: enFillRate('도서명', '도서명_en'),
    authorsEn: enFillRate('저자', '저자_en'),
  };
}


// ── 새 행 추가 다이얼로그 ───────────────────────────────────
function showAddDialog() {
  const html = HtmlService.createTemplateFromFile('AddRow');
  html.suggestions = getSuggestions();
  const out = html.evaluate().setWidth(600).setHeight(700);
  SpreadsheetApp.getUi().showModalDialog(out, '✍️ 새 행 추가');
}

// 자동완성용 기존 unique 값들
function getSuggestions() {
  const sheet = getMainSheet();
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return { celebs: [], books: [], authors: [], publishers: [] };
  const headers = values[0];
  const rows = values.slice(1);
  const ci = buildColIndex(headers);

  function unique(colName) {
    const i = ci.find(colName);
    if (i < 0) return [];
    const s = new Set();
    rows.forEach(r => {
      const v = String(r[i] || '').trim();
      if (v) s.add(v);
    });
    return Array.from(s).sort();
  }

  return {
    celebs: unique('연예인'),
    books: unique('도서명'),
    authors: unique('저자'),
    publishers: unique('출판사'),
  };
}

// 폼 제출 처리 — 시트에 새 행 append.
//
// 동작:
// - START_ROW(1000) 또는 마지막 행 다음 행 중 더 큰 쪽에 새 데이터 입력
// - 사용자가 채운 값만 setValue()로 직접 쓰고, 빈 셀(영문/자동수식 등)은
//   손대지 않아 ARRAYFORMULA가 자연스럽게 채우게 함
// - 도서 정보/이미지가 비어있으면 GET_ALADIN_API_URL / GET_ALADIN_COVER
//   커스텀 함수가 같은 Apps Script 프로젝트에 있을 경우 자동 호출
function appendRow(payload) {
  const sheet = getMainSheet();
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const ci = buildColIndex(headers);

  // 1000행부터 채움 (기존 ARRAYFORMULA 범위와 분리)
  const targetRow = Math.max(sheet.getLastRow() + 1, START_ROW);

  // ── 알라딘 자동 조회 (사용자 미입력 시) ──
  let bookInfo = (payload.bookInfo || '').trim();
  let bookImage = (payload.bookImage || '').trim();

  const query = [payload.book, payload.author, payload.publisher]
    .map(s => (s || '').trim()).filter(Boolean).join(' ');

  function looksOk(v) {
    const s = String(v || '');
    return s && !s.startsWith('에러') && s !== '검색 결과 없음' && s !== '이미지 없음';
  }

  if (query && !bookInfo && typeof GET_ALADIN_API_URL === 'function') {
    try {
      const r = GET_ALADIN_API_URL(query);
      if (looksOk(r)) bookInfo = r;
    } catch (e) { /* 함수 없거나 에러 → 무시 */ }
  }
  if (query && !bookImage && typeof GET_ALADIN_COVER === 'function') {
    try {
      const r = GET_ALADIN_COVER(query);
      if (looksOk(r)) bookImage = r;
    } catch (e) {}
  }

  const map = {
    '연예인':       payload.celeb,
    '도서명':       payload.book,
    '저자':         payload.author,
    '출판사':       payload.publisher,
    '출처':         payload.source,
    '도서 정보':    bookInfo,
    '도서 이미지':  bookImage,
    '연예인 이미지': payload.celebImage,
    '코멘트':       payload.comment,
  };

  const written = [];
  Object.keys(map).forEach(col => {
    const v = map[col];
    if (!v || String(v).trim() === '') return;
    const i = ci.find(col);
    if (i >= 0) {
      sheet.getRange(targetRow, i + 1).setValue(v);
      written.push(col);
    }
  });

  return {
    ok: true,
    rowNum: targetRow,
    written: written,
    bookInfoAuto: !payload.bookInfo && bookInfo ? bookInfo : null,
    bookImageAuto: !payload.bookImage && bookImage ? bookImage : null,
  };
}


// ── Web App 독립 실행 ───────────────────────────────────────
// Apps Script 편집기에서 [Deploy → New deployment → Web app]으로 배포.
// 발급된 URL을 모바일 홈 화면에 추가하면 시트 안 열어도 입력 가능.
function doGet(e) {
  const html = HtmlService.createTemplateFromFile('AddRow');
  html.suggestions = getSuggestions();
  html.standalone = true;  // 독립 실행 모드 (취소 버튼 숨김 등)
  return html.evaluate()
    .setTitle('📚 Favorbook 입력')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setSandboxMode(HtmlService.SandboxMode.IFRAME);
}
