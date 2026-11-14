// ===== メニュー =====
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('公売リスト')
    .addItem('① 初期設定', 'setupSheets')
    .addItem('② 一覧を更新', 'buildList')
    .addSeparator()
    .addItem('自動更新を開始', 'startAutoUpdate')
    .addItem('自動更新を停止', 'stopAutoUpdate')
    .addItem('自動更新状況を確認', 'showAutoUpdateStatus')
    .addSeparator()
    .addItem('連番取得の位置をリセット', 'resetCursor')
    .addItem('HTML確認（物件IDを指定）', 'debugItem')
    .addToUi();
}

function setupSheets() {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName(CONFIG.LIST_SHEET) || ss.insertSheet(CONFIG.LIST_SHEET);
  ensureHeaders(sheet);
}

// ===== デバッグ =====
// 指定した物件IDのページを取得し、判定結果と中身を実行ログに出す
function debugItem() {
  const ui = SpreadsheetApp.getUi();
  const res = ui.prompt('HTML確認', '物件IDを入力してください', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  const id = res.getResponseText().trim();
  if (!/^\d+$/.test(id)) { notify('物件IDは数字で入力してください'); return; }

  const url = itemUrl(id);
  if (!isAllowedByRobots(url)) { notify('robots.txt で禁止されている、または確認できません'); return; }
  const r = fetchResponse(url);
  if (!r) { notify('ページを取得できませんでした。実行ログを確認してください。'); return; }
  const label = { ok: '物件あり', missing: '欠番', error: 'エラー' }[judgePage(r).status];
  Logger.log(`HTTP ${r.code} / HTML文字数: ${r.text.length} / 判定: ${label}`);
  Logger.log('解析結果: ' + JSON.stringify(parseItem(r.text)));  Logger.log(toText(r.text).slice(0, 3000));
  notify(`ID ${id}：HTTP ${r.code}、判定「${label}」（詳細は実行ログ）`);
}

// トリガー実行中は画面に出せないので、その場合はログに残す
function notify(msg) {
  try {
    SpreadsheetApp.getUi().alert(msg);
  } catch (e) {
    Logger.log(msg);
  }
}
