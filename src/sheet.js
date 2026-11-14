// ===== シート操作 =====
// 見出し行を書き込む（列構成を変えたときは、一覧シートを作り直して取り直す）
function ensureHeaders(sheet) {
  sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold');
  sheet.setFrozenRows(1);
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.getRange(2, COL.FETCHED, lastRow - 1, 1).setNumberFormat(DATE_FORMAT);
  }
}

function itemUrl(id) {
  return `${CONFIG.BASE_URL}/items/${id}/`;
}

// 物件名〜入札終了（COL.NAME から順に並ぶ列）の値
function itemValues(item) {
  const cat = item.category || {};
  return [item.name || '', cat.large || '', cat.middle || '', cat.small || '',
          item.agency || '', item.price || '', item.start || '', item.end || ''];
}

// 物件ID・URL・取得日時だけを入れた行
function baseRow(id) {
  const row = new Array(HEADERS.length).fill('');
  row[COL.ID - 1] = String(id);
  row[COL.URL - 1] = itemUrl(id);
  row[COL.FETCHED - 1] = new Date();
  return row;
}

function itemRow(id, item) {
  const row = baseRow(id);
  const values = itemValues(item);
  row.splice(COL.NAME - 1, values.length, ...values);
  return row;
}

function missingRow(id) {
  const row = baseRow(id);
  row[COL.MISSING - 1] = MISSING_MARK;
  row[COL.MISSING_COUNT - 1] = 1;
  return row;
}

function appendRows(sheet, rows) {
  if (!rows.length) return;
  const r0 = sheet.getLastRow() + 1;
  sheet.getRange(r0, 1, rows.length, HEADERS.length).setValues(rows);
  sheet.getRange(r0, COL.PRICE, rows.length, 1).setNumberFormat('#,##0');
  sheet.getRange(r0, COL.START, rows.length, 2).setNumberFormat(DATE_FORMAT);
  sheet.getRange(r0, COL.FETCHED, rows.length, 1).setNumberFormat(DATE_FORMAT);
}
