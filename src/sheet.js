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

// 物件名〜入札終了（COL.NAME から6列）の値
function itemValues(item) {
  return [item.name || '', item.category || '', item.agency || '', item.price || '',
          item.start || '', item.end || ''];
}

function itemRow(id, item) {
  return [
    String(id), itemUrl(id), ...itemValues(item), new Date(), '', '',
  ];
}

function missingRow(id) {
  return [String(id), itemUrl(id), '', '', '', '', '', '', new Date(), MISSING_MARK, 1];
}

function appendRows(sheet, rows) {
  if (!rows.length) return;
  const r0 = sheet.getLastRow() + 1;
  sheet.getRange(r0, 1, rows.length, HEADERS.length).setValues(rows);
  sheet.getRange(r0, COL.PRICE, rows.length, 1).setNumberFormat('#,##0');
  sheet.getRange(r0, COL.START, rows.length, 2).setNumberFormat(DATE_FORMAT);
}
