// ===== 自動更新（毎日1回。アクセス制限を受けたときだけ自動で停止） =====
function startAutoUpdate() {
  stopAutoUpdate();
  ScriptApp.newTrigger('autoBuild').timeBased().everyDays(1).atHour(CONFIG.AUTO_HOUR).create();
  SpreadsheetApp.getActive().toast(
    `自動更新を開始しました（毎日${CONFIG.AUTO_HOUR}時台）`, '公売リスト', 10);
}

function stopAutoUpdate() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'autoBuild')
    .forEach(t => ScriptApp.deleteTrigger(t));
}

function autoBuild() {
  buildList();
}
