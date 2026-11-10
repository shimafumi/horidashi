/**
 * horidashi - 官公庁オークション 物件リスト作成スクリプト
 *
 * 物件IDは連番なので、CONFIG.START_ID から順に物件ページを取得していく。
 *
 * 使い方：
 *  1. スプレッドシートの「拡張機能 > Apps Script」にこのコードを反映（clasp push）
 *  2. シートを再読み込みすると「公売リスト」メニューが表示される
 *  3. 「① 初期設定」を実行
 *  4. 「② 一覧を更新」または「自動更新を開始」を実行
 *  5. 「一覧」シートの「相場」列に落札相場を入れると相場比が出る
 *
 * 欠番（ページが空・存在しないID）も一覧に「欠番」として残し、
 * 後から公開される場合に備えて RECHECK_HOURS ごとに再確認する。
 */

// ===== 設定 =====
const CONFIG = {
  LIST_SHEET: '一覧',
  BASE_URL: 'https://kankocho.jp',
  START_ID: 72984,              // 連番取得を始める物件ID（初回、またはリセット後に使用）
  SLEEP_MS: 1000,               // 1件ごとの待ち時間（ミリ秒）。429/403が出たら増やす
  MAX_ITEMS_PER_RUN: 100,       // 1回の実行で物件ページにアクセスする最大回数
  PROBE_COUNT: 3,               // 欠番が出たとき、先の物件を何回チェックするか（すべて欠番なら最新まで取得済みとみなす）
  PROBE_RANGE: 100,             // チェックする物件の位置（欠番から 1〜この数 先をランダムに選ぶ）
  RECHECK_HOURS: 24,            // 欠番を再確認する間隔（時間）
  TIME_LIMIT_MS: 5 * 60 * 1000, // GASの6分制限の手前で止める
  AUTO_INTERVAL_MIN: 10,        // 自動更新の間隔（分）。1, 5, 10, 15, 30 のいずれか
};

const HEADERS = ['物件ID', 'URL', '物件名', '執行機関', '見積価額等(円)', '入札期間',
                 '相場(手入力・円)', '相場比', 'メモ', '取得日時', '欠番'];
const COL = { ID: 1, NAME: 3, MEMO: 9, FETCHED: 10, MISSING: 11 }; // 列番号（1始まり）
const MISSING_MARK = '欠番';

// 連番取得の進捗（スクリプトプロパティに保存）
const PROP_NEXT_ID = 'NEXT_ID';           // 次に確認するID
const PROP_PENDING_FROM = 'PENDING_FROM'; // 末尾で続いている欠番の先頭ID（なければ未設定）

let ROBOTS_RULES;     // robots.txt のルール（未読込なら undefined）
let BLOCKED = false;  // サイトからアクセス制限を受けたら true

// ===== メニュー =====
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('公売リスト')
    .addItem('① 初期設定', 'setupSheets')
    .addItem('② 一覧を更新', 'buildList')
    .addSeparator()
    .addItem('自動更新を開始', 'startAutoUpdate')
    .addItem('自動更新を停止', 'stopAutoUpdate')
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

// 見出し行を最新の HEADERS に揃える（列を追加したときの既存シート対応）
function ensureHeaders(sheet) {
  sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold');
  sheet.setFrozenRows(1);
}

// ===== メイン処理 =====
/**
 * 戻り値：0なら完了（最新まで取得済みで再確認待ちの欠番もなし）、
 *         正の数なら続きあり、-1ならエラー・アクセス制限で中断、nullなら別の実行中
 */
function buildList() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) {
    Logger.log('別の実行が進行中のためスキップしました');
    return null;
  }
  try {
    return buildListCore();
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
    return -1;
  }
  ensureHeaders(sheet);

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
    return -1;
  }
  if (scan.error) {
    ss.toast(`${summary}。取得エラーのため中断しました（実行ログを確認してください）。`, '公売リスト', 30);
    return -1;
  }

  const done = scan.reachedEnd && recheck.remaining === 0;
  ss.toast(`${summary}。次はID ${scan.nextId} から` +
    (done ? '（最新まで取得済み）' : '（もう一度実行すると続きを取得します）'), '公売リスト', 10);
  return done ? 0 : 1;
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
    if (known.has(String(id))) { flush(); id++; continue; } // 取得済み（手入力した相場を上書きしない）
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
function recheckMissing(sheet, data, access) {
  const threshold = Date.now() - CONFIG.RECHECK_HOURS * 60 * 60 * 1000;
  const due = [];
  data.forEach((r, i) => {
    if (r[COL.MISSING - 1] !== MISSING_MARK) return;
    const fetched = r[COL.FETCHED - 1];
    if (!(fetched instanceof Date) || fetched.getTime() < threshold) {
      due.push({ row: i + 2, id: String(r[COL.ID - 1]) });
    }
  });

  let checked = 0;
  let found = 0;
  for (const d of due) {
    if (!access.canFetch()) break;
    const page = access.fetch(d.id);
    if (page.status === 'error') break;
    if (page.status === 'ok') {
      const item = page.item;
      sheet.getRange(d.row, COL.NAME, 1, 4)
        .setValues([[item.name || '', item.agency || '', item.price || '', item.period || '']]);
      if (!item.price) sheet.getRange(d.row, COL.MEMO).setValue('要確認：価格を取得できず');
      sheet.getRange(d.row, COL.FETCHED, 1, 2).setValues([[new Date(), '']]);
      found++;
    } else {
      sheet.getRange(d.row, COL.FETCHED).setValue(new Date());
    }
    checked++;
  }
  return { checked, found, remaining: due.length - checked };
}

function itemUrl(id) {
  return `${CONFIG.BASE_URL}/items/${id}/`;
}

function itemRow(id, item) {
  return [
    String(id), itemUrl(id), item.name || '', item.agency || '', item.price || '', item.period || '',
    '', '', item.price ? '' : '要確認：価格を取得できず', new Date(), '',
  ];
}

function missingRow(id) {
  return [String(id), itemUrl(id), '', '', '', '', '', '', '', new Date(), MISSING_MARK];
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

// 次回の連番取得を CONFIG.START_ID からやり直す（取得済みのIDはスキップされる）
function resetCursor() {
  const props = PropertiesService.getScriptProperties();
  props.deleteProperty(PROP_NEXT_ID);
  props.deleteProperty(PROP_PENDING_FROM);
  SpreadsheetApp.getActive().toast(
    `次回はID ${CONFIG.START_ID} から取得します`, '公売リスト', 10);
}

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

// ===== 通信 =====
// 戻り値：{ code, text }。通信失敗・アクセス制限のときは null
function fetchResponse(url) {
  try {
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
    const code = res.getResponseCode();
    if (code === 429 || code === 403) {
      BLOCKED = true;
      Logger.log(`HTTP ${code}（アクセス制限の可能性）: ${url}`);
      return null;
    }
    return { code, text: res.getContentText('UTF-8') };
  } catch (e) {
    Logger.log(`取得失敗: ${url} ${e}`);
    return null;
  }
}

function fetchHtml(url) {
  const res = fetchResponse(url);
  if (!res) return null;
  if (res.code !== 200) {
    Logger.log(`HTTP ${res.code}: ${url}`);
    return null;
  }
  return res.text;
}

/**
 * 物件ページを robots.txt を守って取得し、状態を判定する。
 * status: 'ok'（物件あり）/ 'missing'（欠番）/ 'error'（取得できず。欠番とは扱わない）
 */
function fetchPage(url) {
  if (!isAllowedByRobots(url)) {
    Logger.log('robots.txt で禁止されている、または確認できないためスキップ: ' + url);
    return { status: 'error' };
  }
  const res = fetchResponse(url);
  if (!res) return { status: 'error' };
  const page = judgePage(res);
  if (page.status === 'error') Logger.log(`HTTP ${res.code}: ${url}`);
  return page;
}

function judgePage(res) {
  if (res.code === 404 || res.code === 410) return { status: 'missing' };
  if (res.code !== 200) return { status: 'error' };
  const item = parseItem(res.text);
  return isEmptyItem(item) ? { status: 'missing' } : { status: 'ok', item };
}

// 空ページ（欠番）の判定：執行機関・価格・入札期間のどれも取れなければ欠番とみなす
function isEmptyItem(item) {
  return !item.agency && !item.price && !item.period;
}

// ===== robots.txt =====
function loadRobotsRules() {
  if (ROBOTS_RULES !== undefined) return ROBOTS_RULES;
  const txt = fetchHtml(CONFIG.BASE_URL + '/robots.txt');
  if (txt === null) {
    Logger.log('robots.txt を読み込めませんでした。安全のためアクセスを行いません。');
    ROBOTS_RULES = null;
    return null;
  }
  const rules = [];
  let inStarGroup = false;
  let lastWasUA = false;
  txt.split(/\r?\n/).forEach(line => {
    const m = line.replace(/#.*$/, '').trim().match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) return;
    const key = m[1].toLowerCase();
    const val = m[2].trim();
    if (key === 'user-agent') {
      inStarGroup = lastWasUA ? (inStarGroup || val === '*') : (val === '*');
      lastWasUA = true;
      return;
    }
    lastWasUA = false;
    if (inStarGroup && (key === 'allow' || key === 'disallow') && val) {
      rules.push({ allow: key === 'allow', pattern: val });
    }
  });
  ROBOTS_RULES = rules;
  return rules;
}

function isAllowedByRobots(url) {
  const rules = loadRobotsRules();
  if (!rules) return false;
  const path = url.replace(/^https?:\/\/[^/]+/, '') || '/';
  let best = null;
  for (const r of rules) {
    if (!robotsMatch(r.pattern, path)) continue;
    // 最も長く一致したルールを優先、同じ長さなら Allow を優先
    if (!best || r.pattern.length > best.pattern.length ||
        (r.pattern.length === best.pattern.length && r.allow)) {
      best = r;
    }
  }
  return best ? best.allow : true;
}

function robotsMatch(pattern, path) {
  const anchored = pattern.endsWith('$');
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const re = body.split('*')
    .map(s => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp('^' + re + (anchored ? '$' : '')).test(path);
}

// ===== 物件ページの解析 =====
function parseItem(html) {
  const rawTitle = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '';
  const title = decodeEntities(rawTitle).trim();
  // 例：「【東京局４２０３－１】シャワーヘッド：東京国税局のインターネット公売物件詳細 - KSI官公庁オークション」
  const m = title.match(/^(.*)：(.+?)の(インターネット公売|公有財産売却)/);
  const text = toText(html);
  return {
    name: m ? m[1] : title.replace(/\s*-\s*KSI官公庁オークション.*$/, ''),
    agency: m ? m[2] : '',
    price: pickYen(text, ['見積価額', '予定価格', '最低売却価格', '売却価格']),
    period: pickAfter(text, ['入札期間', '入札受付期間', '申込期間'], 50),
  };
}

function toText(html) {
  return decodeEntities(
    html.replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
  ).replace(/\s+/g, ' ');
}

function decodeEntities(s) {
  return s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>').replace(/&quot;/g, '"')
          .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function toHalfWidth(s) {
  return s.replace(/[０-９，]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
}

function pickYen(text, labels) {
  const t = toHalfWidth(text);
  for (const label of labels) {
    const m = t.match(new RegExp(label + '[^0-9]{0,30}?([0-9][0-9,]*)\\s*円'));
    if (m) return Number(m[1].replace(/,/g, ''));
  }
  return '';
}

function pickAfter(text, labels, len) {
  for (const label of labels) {
    const i = text.indexOf(label);
    if (i >= 0) return text.substr(i + label.length, len).trim();
  }
  return '';
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
  Logger.log('解析結果: ' + JSON.stringify(parseItem(r.text)));
  Logger.log(toText(r.text).slice(0, 3000));
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
