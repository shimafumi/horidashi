/**
 * horidashi - 官公庁オークション 物件リスト作成スクリプト
 * 物件IDは連番なので、CONFIG.START_ID から順に物件ページを取得していく。
 * 使い方・仕様は README.md を参照。
 */

// ===== メイン処理 =====
function buildList() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) {
    Logger.log('別の実行が進行中のためスキップしました');
    return;
  }
  try {
    buildListCore();
  } finally {
    lock.releaseLock();
  }
}

function buildListCore() {
  const start = Date.now();
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName(CONFIG.LIST_SHEET);
  if (!sheet) {
    notify('先に「① 初期設定」を実行してください');
    return;
  }

  const lastRow = sheet.getLastRow();
  const data = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, HEADERS.length).getValues() : [];
  const known = new Set(data.map(r => String(r[COL.ID - 1])));

  let fetches = 0;
  const access = {
    canFetch: () => !BLOCKED && fetches < CONFIG.MAX_ITEMS_PER_RUN &&
                    Date.now() - start < CONFIG.TIME_LIMIT_MS,
    fetch: id => {
      fetches++;
      const page = fetchPage(itemUrl(id));
      Utilities.sleep(CONFIG.SLEEP_MS);
      return page;
    },
  };

  // 1. 新しいIDを順に取得
  const scan = scanForward(known, access);
  appendRows(sheet, scan.rows);

  // 2. 欠番の再確認（新規取得で余った分の枠を使う）
  const recheck = recheckMissing(sheet, data, access);

  const added = scan.rows.filter(r => r[COL.MISSING - 1] !== MISSING_MARK).length;
  const missing = scan.rows.length - added;
  const summary = `${added}件追加、欠番${missing}件` +
    (recheck.checked ? `、欠番の再確認${recheck.checked}件（うち${recheck.found}件公開）` : '');

  if (BLOCKED) {
    stopAutoUpdate();
    ss.toast(`${summary}。サイトからアクセス制限を受けたため中断し、自動更新を停止しました。` +
      '待ち時間（SLEEP_MS）を増やし、時間を空けてから再開してください。', '公売リスト', 30);
    return;
  }
  if (scan.error || recheck.error) {
    ss.toast(`${summary}。取得エラーのため中断しました（実行ログを確認してください）。`, '公売リスト', 30);
    return;
  }

  const done = scan.reachedEnd && recheck.remaining === 0;
  ss.toast(`${summary}。次はID ${scan.nextId} から` +
    (done ? '（最新まで取得済み）' : '（もう一度実行すると続きを取得します）'), '公売リスト', 10);
}

/**
 * 保存済みの位置から連番で物件ページを取得する。
 * 欠番が出たら、その先（1〜PROBE_RANGE 先のランダムな位置）を PROBE_COUNT 回チェックし、
 * すべて欠番なら最新まで取得済みとみなして止める。
 * 欠番は後ろに物件が見つかった時点で一覧に書き込み、末尾の欠番は書き込まない
 * （まだ採番されていないだけの可能性が高いため）。
 */
function scanForward(known, access) {
  const props = PropertiesService.getScriptProperties();
  let id = Number(props.getProperty(PROP_NEXT_ID)) || CONFIG.START_ID;
  const pendingFrom = Number(props.getProperty(PROP_PENDING_FROM));
  const pending = []; // 確定待ちの欠番ID
  if (pendingFrom) for (let p = pendingFrom; p < id; p++) pending.push(p);

  const rows = [];
  const flush = () => { pending.forEach(p => rows.push(missingRow(p))); pending.length = 0; };
  const cache = new Map(); // 先のチェックで見つけた物件ページ（同じページを2回取りにいかないため）
  let aliveUntil = 0;      // このIDに物件があると分かっている（ここまでは先のチェック不要）
  let reachedEnd = false;
  let error = false;

  while (true) {
    if (known.has(String(id))) { flush(); id++; continue; } // 取得済み
    let page = cache.get(id);
    if (!page) {
      if (!access.canFetch()) break;
      page = access.fetch(id);
    }
    if (page.status === 'error') { error = !BLOCKED; break; }
    if (page.status === 'ok') {
      flush();
      rows.push(itemRow(id, page.item));
      id++;
      continue;
    }
    // 欠番：先に物件があるか分かっていなければチェックする
    if (id >= aliveUntil) {
      const probe = probeAhead(id, known, access, cache);
      if (probe.error) { error = !BLOCKED; break; }
      if (probe.aborted) break; // 今回の取得枠を使い切った。次回このIDから再開
      if (!probe.found) { reachedEnd = true; break; }
      aliveUntil = probe.found;
    }
    pending.push(id);
    id++;
  }

  if (reachedEnd) {
    // 最新まで到達。次回は最初の欠番から確認し直す
    if (pending.length) id = pending[0];
    pending.length = 0;
    props.setProperty(PROP_NEXT_ID, String(id));
    props.deleteProperty(PROP_PENDING_FROM);
  } else {
    props.setProperty(PROP_NEXT_ID, String(id));
    if (pending.length) props.setProperty(PROP_PENDING_FROM, String(pending[0]));
    else props.deleteProperty(PROP_PENDING_FROM);
  }
  return { rows, reachedEnd, error, nextId: id };
}

/**
 * 欠番 id の先に物件があるかを、1〜PROBE_RANGE 先のランダムな位置で PROBE_COUNT 回チェックする。
 * 戻り値：{ found: 見つかったID（0なら全て欠番） } / { aborted: true }（取得枠切れ）/ { error: true }
 */
function probeAhead(id, known, access, cache) {
  const count = Math.min(CONFIG.PROBE_COUNT, CONFIG.PROBE_RANGE);
  const targets = new Set();
  while (targets.size < count) targets.add(id + 1 + Math.floor(Math.random() * CONFIG.PROBE_RANGE));

  for (const t of targets) {
    if (known.has(String(t))) return { found: t };
    if (!access.canFetch()) return { aborted: true };
    const page = access.fetch(t);
    if (page.status === 'error') return { error: true };
    if (page.status === 'ok') {
      cache.set(t, page);
      return { found: t };
    }
    Logger.log(`ID ${id} の先のチェック：ID ${t} も欠番`);
  }
  return { found: 0 };
}

// 欠番の行のうち、前回確認から RECHECK_HOURS 以上たったものを再確認する
// 欠番と判定した回数が MISSING_CHECK_LIMIT に達した行は対象にしない
function recheckMissing(sheet, data, access) {
  const threshold = Date.now() - CONFIG.RECHECK_HOURS * 60 * 60 * 1000;
  const due = [];
  data.forEach((r, i) => {
    if (r[COL.MISSING - 1] !== MISSING_MARK) return;
    const count = Number(r[COL.MISSING_COUNT - 1]) || 0;
    if (count >= CONFIG.MISSING_CHECK_LIMIT) return;
    const fetched = r[COL.FETCHED - 1];
    if (!(fetched instanceof Date) || fetched.getTime() < threshold) {
      due.push({ row: i + 2, id: String(r[COL.ID - 1]), count });
    }
  });

  let checked = 0;
  let found = 0;
  let error = false;
  for (const d of due) {
    if (!access.canFetch()) break;
    const page = access.fetch(d.id);
    if (page.status === 'error') { error = !BLOCKED; break; }
    if (page.status === 'ok') {
      const values = itemValues(page.item);
      sheet.getRange(d.row, COL.NAME, 1, values.length).setValues([values]);
      sheet.getRange(d.row, COL.START, 1, 2).setNumberFormat(DATE_FORMAT);
      sheet.getRange(d.row, COL.FETCHED, 1, 3).setValues([[new Date(), '', '']]);
      found++;
    } else {
      sheet.getRange(d.row, COL.FETCHED, 1, 3).setValues([[new Date(), MISSING_MARK, d.count + 1]]);
    }
    checked++;
  }
  return { checked, found, error, remaining: due.length - checked };
}

// 次回の連番取得を CONFIG.START_ID からやり直す（取得済みのIDはスキップされる）
function resetCursor() {
  const props = PropertiesService.getScriptProperties();
  props.deleteProperty(PROP_NEXT_ID);
  props.deleteProperty(PROP_PENDING_FROM);
  SpreadsheetApp.getActive().toast(
    `次回はID ${CONFIG.START_ID} から取得します`, '公売リスト', 10);
}
