// ===== シート操作 =====
const DATE_FORMAT = 'yyyy/mm/dd hh:mm';

// 見出し行を書き込む（列構成を変えたときは、一覧シートを作り直して取り直す）
function ensureHeaders(sheet) {
  sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold');
  sheet.setFrozenRows(1);
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
