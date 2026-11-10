/**
 * horidashi - 官公庁オークション 物件リスト作成スクリプト
 *
 * 使い方：
 *  1. スプレッドシートの「拡張機能 > Apps Script」にこのコードを反映（clasp push）
 *  2. シートを再読み込みすると「公売リスト」メニューが表示される
 *  3. 「① 初期設定」を実行
 *  4. 「URL」シートのA2から下に物件ページのURLを貼る
 *     （またはCONFIGの USE_SITEMAP を true にする）
 *  5. 「② 一覧を更新」または「自動更新を開始」を実行
 *  6. 「一覧」シートの「相場」列に落札相場を入れると相場比が出る
 */

// ===== 設定 =====
const CONFIG = {
  URL_SHEET: 'URL',
  LIST_SHEET: '一覧',
  BASE_URL: 'https://kankocho.jp',
  SLEEP_MS: 1000,               // 1件ごとの待ち時間（ミリ秒）。429/403が出たら増やす
  MAX_ITEMS_PER_RUN: 100,       // 1回の実行で取得する最大件数
  TIME_LIMIT_MS: 5 * 60 * 1000, // GASの6分制限の手前で止める
  USE_SITEMAP: false,           // true にするとサイトマップから物件URLを集める
  SITEMAP_DAYS: 3,              // サイトマップで直近何日以内に更新された物件を対象にするか（null で全件）
  MAX_SITEMAP_FILES: 20,        // 読み込むサイトマップファイル数の上限
  AUTO_INTERVAL_MIN: 10,        // 自動更新の間隔（分）。1, 5, 10, 15, 30 のいずれか
};

const HEADERS = ['物件ID', 'URL', '物件名', '執行機関', '見積価額等(円)', '入札期間',
                 '相場(手入力・円)', '相場比', 'メモ', '取得日時'];

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
    .addItem('サイトマップ上の物件数を数える', 'countSitemapItems')
    .addItem('HTML確認（うまく取れないとき）', 'debugFirstUrl')
    .addToUi();
}

function setupSheets() {
  const ss = SpreadsheetApp.getActive();
  if (!ss.getSheetByName(CONFIG.URL_SHEET)) {
    const s = ss.insertSheet(CONFIG.URL_SHEET);
    s.getRange('A1').setValue('物件ページのURL（A2から下に貼る）');
  }
  if (!ss.getSheetByName(CONFIG.LIST_SHEET)) {
    const s = ss.insertSheet(CONFIG.LIST_SHEET);
    s.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold');
    s.setFrozenRows(1);
  }
}

// ===== メイン処理 =====
/**
 * 戻り値：残り件数（0なら完了）、-1ならアクセス制限で中断、nullなら別の実行中
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
  const urlSheet = ss.getSheetByName(CONFIG.URL_SHEET);
  const listSheet = ss.getSheetByName(CONFIG.LIST_SHEET);
  if (!urlSheet || !listSheet) {
    notify('先に「① 初期設定」を実行してください');
    return -1;
  }

  // --- 物件IDを集める ---
  const sources = urlSheet.getRange('A2:A').getValues().flat()
    .map(v => String(v).trim()).filter(v => v.startsWith('http'));

  const ids = new Set();
  for (const url of sources) {
    const direct = url.match(/\/items\/(\d+)/);
    if (direct) { ids.add(direct[1]); continue; }
    const html = politeFetch(url); // robots.txt で禁止されたURLはここで弾かれる
    if (BLOCKED) break;
    if (!html) continue;
    [...html.matchAll(/\/items\/(\d+)\/?/g)].forEach(m => ids.add(m[1]));
    Utilities.sleep(CONFIG.SLEEP_MS);
  }
  if (CONFIG.USE_SITEMAP && !BLOCKED) {
    collectIdsFromSitemap(CONFIG.SITEMAP_DAYS).forEach(id => ids.add(id));
  }

  // --- 取得済みの物件はスキップ（手入力した相場を上書きしないため） ---
  const lastRow = listSheet.getLastRow();
  const existing = new Set(lastRow > 1
    ? listSheet.getRange(2, 1, lastRow - 1, 1).getValues().flat().map(String) : []);
  const targets = [...ids].filter(id => !existing.has(id));

  // --- 物件ページを取得 ---
  const rows = [];
  for (const id of targets) {
    if (BLOCKED) break;
    if (rows.length >= CONFIG.MAX_ITEMS_PER_RUN) break;
    if (Date.now() - start > CONFIG.TIME_LIMIT_MS) break;
    const url = `${CONFIG.BASE_URL}/items/${id}/`;
    const html = politeFetch(url);
    if (BLOCKED) break;
    const item = html ? parseItem(html) : {};
    rows.push([
      id, url, item.name || '', item.agency || '', item.price || '', item.period || '',
      '', '', item.price ? '' : '要確認：価格を取得できず', new Date(),
    ]);
    Utilities.sleep(CONFIG.SLEEP_MS);
  }

  // --- シートに書き込む ---
  if (rows.length) {
    const r0 = listSheet.getLastRow() + 1;
    listSheet.getRange(r0, 1, rows.length, HEADERS.length).setValues(rows);
    const formulas = rows.map((_, i) => {
      const r = r0 + i;
      return [`=IF(OR(E${r}="",G${r}=""),"",E${r}/G${r})`];
    });
    listSheet.getRange(r0, 8, rows.length, 1).setFormulas(formulas).setNumberFormat('0%');
    listSheet.getRange(r0, 5, rows.length, 1).setNumberFormat('#,##0');
    listSheet.getRange(r0, 7, rows.length, 1).setNumberFormat('#,##0');
  }

  if (BLOCKED) {
    stopAutoUpdate();
    ss.toast(`${rows.length}件追加。サイトからアクセス制限を受けたため中断し、自動更新を停止しました。` +
      '待ち時間（SLEEP_MS）を増やし、時間を空けてから再開してください。', '公売リスト', 30);
    return -1;
  }

  const remaining = targets.length - rows.length;
  ss.toast(`${rows.length}件追加。残り${remaining}件` +
    (remaining > 0 ? '（もう一度実行すると続きを取得します）' : ''), '公売リスト', 10);
  return remaining;
}

// ===== 自動実行（全件取り終わったら自動停止） =====
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
function fetchHtml(url) {
  try {
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
    const code = res.getResponseCode();
    if (code === 429 || code === 403) {
      BLOCKED = true;
      Logger.log(`HTTP ${code}（アクセス制限の可能性）: ${url}`);
      return null;
    }
    if (code !== 200) {
      Logger.log(`HTTP ${code}: ${url}`);
      return null;
    }
    return res.getContentText('UTF-8');
  } catch (e) {
    Logger.log(`取得失敗: ${url} ${e}`);
    return null;
  }
}

// robots.txt を守ってアクセスする
function politeFetch(url) {
  if (!isAllowedByRobots(url)) {
    Logger.log('robots.txt で禁止されている、または確認できないためスキップ: ' + url);
    return null;
  }
  return fetchHtml(url);
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

// ===== サイトマップ =====
/**
 * days に数値を渡すと直近その日数以内に更新された物件のみ、null なら全件
 */
function collectIdsFromSitemap(days) {
  const since = days ? Date.now() - days * 24 * 60 * 60 * 1000 : 0;
  const ids = new Set();
  const queue = [CONFIG.BASE_URL + '/sitemap.xml'];
  let fetched = 0;
  while (queue.length && fetched < CONFIG.MAX_SITEMAP_FILES && !BLOCKED) {
    const xml = politeFetch(queue.shift());
    fetched++;
    if (!xml) continue;
    for (const e of xml.matchAll(/<(url|sitemap)>([\s\S]*?)<\/\1>/g)) {
      const loc = ((e[2].match(/<loc>\s*([\s\S]*?)\s*<\/loc>/) || [])[1] || '').trim();
      const lastmod = (e[2].match(/<lastmod>\s*([\s\S]*?)\s*<\/lastmod>/) || [])[1];
      if (!loc) continue;
      if (since && lastmod && new Date(lastmod).getTime() < since) continue;
      if (e[1] === 'sitemap') { queue.push(loc); continue; }
      const m = loc.match(/\/items\/(\d+)/);
      if (m) ids.add(m[1]);
    }
    Utilities.sleep(CONFIG.SLEEP_MS);
  }
  Logger.log(`サイトマップから ${ids.size} 件の物件IDを取得（読み込みファイル数: ${fetched}）`);
  return ids;
}

// サイトマップ上の物件数を数えるだけ（物件ページにはアクセスしない）
function countSitemapItems() {
  const ids = collectIdsFromSitemap(null);
  SpreadsheetApp.getActive().toast(`サイトマップ上の物件数：${ids.size}件`, '公売リスト', 10);
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
// URLシートのA2のページを取得して中身を実行ログに出す
function debugFirstUrl() {
  const sheet = SpreadsheetApp.getActive().getSheetByName(CONFIG.URL_SHEET);
  if (!sheet) { notify('先に「① 初期設定」を実行してください'); return; }
  const url = String(sheet.getRange('A2').getValue()).trim();
  const html = politeFetch(url);
  if (!html) { notify('ページを取得できませんでした。実行ログを確認してください。'); return; }
  Logger.log('HTML文字数: ' + html.length);
  Logger.log('物件リンク数: ' + (html.match(/\/items\/\d+/g) || []).length);
  Logger.log('解析結果: ' + JSON.stringify(parseItem(html)));
  Logger.log(toText(html).slice(0, 3000));
}

// トリガー実行中は画面に出せないので、その場合はログに残す
function notify(msg) {
  try {
    SpreadsheetApp.getUi().alert(msg);
  } catch (e) {
    Logger.log(msg);
  }
}
