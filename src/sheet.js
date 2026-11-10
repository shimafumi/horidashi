// ===== シート操作 =====
const DATE_FORMAT = 'yyyy/mm/dd hh:mm';

// 見出し行を最新の HEADERS に揃える（列を追加したときの既存シート対応）
function ensureHeaders(sheet) {
  migratePeriodColumn(sheet);
  sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold');
  sheet.setFrozenRows(1);
}

// 旧レイアウト（「入札期間」1列）なら「入札終了」列を挿入し、既存の値を開始・終了に分ける。
// 列の挿入なので、右側の手入力の相場や相場比の数式もそのまま1列右にずれる
function migratePeriodColumn(sheet) {
  if (sheet.getRange(1, COL.START).getValue() !== OLD_PERIOD_HEADER) return;
  sheet.insertColumnAfter(COL.START);
  const n = sheet.getLastRow() - 1;
  if (n <= 0) return;
  const rows = sheet.getRange(2, COL.START, n, 1).getValues().map(([v]) => {
    if (v === '') return ['', ''];
    const p = parsePeriod(String(v));
    return [p.start, p.end];
  });
  sheet.getRange(2, COL.START, n, 2).setValues(rows).setNumberFormat(DATE_FORMAT);
}

function itemUrl(id) {
  return `${CONFIG.BASE_URL}/items/${id}/`;
}

function colLetter(n) {
  return String.fromCharCode(64 + n); // 26列（Z）まで
}

// 物件名〜入札終了（COL.NAME から5列）の値
function itemValues(item) {
  return [item.name || '', item.agency || '', item.price || '', item.start || '', item.end || ''];
}

function itemRow(id, item) {
  return [
    String(id), itemUrl(id), ...itemValues(item),
    '', '', item.price ? '' : '要確認：価格を取得できず', new Date(), '', item.category || '',
  ];
}

function missingRow(id) {
  return [String(id), itemUrl(id), '', '', '', '', '', '', '', '', new Date(), MISSING_MARK, ''];
}

function appendRows(sheet, rows) {
  if (!rows.length) return;
  const r0 = sheet.getLastRow() + 1;
  sheet.getRange(r0, 1, rows.length, HEADERS.length).setValues(rows);
  const p = colLetter(COL.PRICE);
  const mk = colLetter(COL.MARKET);
  const formulas = rows.map((_, i) => {
    const r = r0 + i;
    return [`=IF(OR(${p}${r}="",${mk}${r}=""),"",${p}${r}/${mk}${r})`];
  });
  sheet.getRange(r0, COL.RATIO, rows.length, 1).setFormulas(formulas).setNumberFormat('0%');
  sheet.getRange(r0, COL.PRICE, rows.length, 1).setNumberFormat('#,##0');
  sheet.getRange(r0, COL.MARKET, rows.length, 1).setNumberFormat('#,##0');
  sheet.getRange(r0, COL.START, rows.length, 2).setNumberFormat(DATE_FORMAT);
}
