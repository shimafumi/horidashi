// ===== シート操作 =====
// 見出し行を最新の HEADERS に揃える（列を追加したときの既存シート対応）
function ensureHeaders(sheet) {
  sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold');
  sheet.setFrozenRows(1);
}

function itemUrl(id) {
  return `${CONFIG.BASE_URL}/items/${id}/`;
}

function itemRow(id, item) {
  return [
    String(id), itemUrl(id), item.name || '', item.agency || '', item.price || '', item.period || '',
    '', '', item.price ? '' : '要確認：価格を取得できず', new Date(), '', item.category || '',
  ];
}

function missingRow(id) {
  return [String(id), itemUrl(id), '', '', '', '', '', '', '', new Date(), MISSING_MARK, ''];
}

function appendRows(sheet, rows) {
  if (!rows.length) return;
  const r0 = sheet.getLastRow() + 1;
  sheet.getRange(r0, 1, rows.length, HEADERS.length).setValues(rows);
  const formulas = rows.map((_, i) => {
    const r = r0 + i;
    return [`=IF(OR(E${r}="",G${r}=""),"",E${r}/G${r})`];
  });
  sheet.getRange(r0, 8, rows.length, 1).setFormulas(formulas).setNumberFormat('0%');
  sheet.getRange(r0, 5, rows.length, 1).setNumberFormat('#,##0');
  sheet.getRange(r0, 7, rows.length, 1).setNumberFormat('#,##0');
}
