// ===== 自動実行（最新まで取り終わったら自動停止） =====
function startAutoUpdate() {
  stopAutoUpdate();
  ScriptApp.newTrigger('autoBuild').timeBased().everyMinutes(CONFIG.AUTO_INTERVAL_MIN).create();
  SpreadsheetApp.getActive().toast(
    `自動更新を開始しました（${CONFIG.AUTO_INTERVAL_MIN}分ごと）`, '公売リスト', 10);
}

function stopAutoUpdate() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'autoBuild')
    .forEach(t => ScriptApp.deleteTrigger(t));
}

function showAutoUpdateStatus() {
  const triggerCount = ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'autoBuild')
    .length;
  const status = triggerCount === 0
    ? '自動更新は停止中です。'
    : `自動更新は有効です（トリガー ${triggerCount} 件）。\n現在の設定値: ${CONFIG.AUTO_INTERVAL_MIN} 分ごと`;
  notify(status);
}

function autoBuild() {
  const remaining = buildList();
  if (remaining !== null && remaining <= 0) stopAutoUpdate();
}
