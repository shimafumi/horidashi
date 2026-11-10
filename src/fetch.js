// ===== 通信 =====
let BLOCKED = false;  // サイトからアクセス制限を受けたら true

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
  return !item.agency && !item.price && !item.start;
}
