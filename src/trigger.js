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

function autoBuild() {
  const remaining = buildList();
  if (remaining !== null && remaining <= 0) stopAutoUpdate();
}
