// ===== 物件ページの解析 =====
function parseItem(html) {
  const rawTitle = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '';
  const title = decodeEntities(rawTitle).trim();
  // 例：「【東京局４２０３－１】シャワーヘッド：東京国税局のインターネット公売物件詳細 - KSI官公庁オークション」
  const m = title.match(/^(.*)：(.+?)の(インターネット公売|公有財産売却)/);
  const text = toText(html);
  const name = m ? m[1] : title.replace(/\s*-\s*KSI官公庁オークション.*$/, '');
  const period = parsePeriod(pickAfter(text, ['入札期間', '入札受付期間', '申込期間'], 80));
  return {
    name: name,
    agency: m ? m[2] : '',
    price: pickYen(text, ['見積価額', '予定価格', '最低売却価格', '売却価格']),
    start: period.start,
    end: period.end,
    category: pickCategory(html, name),
  };
}

// 「入札期間」の後ろの文字列から開始・終了の日時を取る
// 例：「開始： 2026年11月17日13時0分 〜 終了： 2026年11月19日13時0分 …」→ { start: Date, end: Date }
// 公開中止の物件（「中 止」）は start に「中止」を入れる。それ以外で読めなければ空
function parsePeriod(s) {
  const t = toHalfWidth(s);
  const start = pickDate(t, '開始');
  const end = pickDate(t, '終了');
  if (start || end) return { start: start || '', end: end || '' };
  return { start: /^中\s*止/.test(t.trim()) ? '中止' : '', end: '' };
}

// 「ラベル： 2026年11月17日13時0分」の日時。ラベルの直後になければ null（後ろの別項目の日時は拾わない）
function pickDate(t, label) {
  const m = t.match(new RegExp(label + '[:：]\\s*(\\d{4})年(\\d{1,2})月(\\d{1,2})日\\s*(\\d{1,2})時(\\d{1,2})分'));
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5])) : null;
}

// カテゴリ：パンくずリストから取り、「大分類 > 小分類」の形で返す
// 例：「不動産 > 不動産 > 土地 > 東北 > 物件詳細」→「不動産 > 土地 > 東北」
function pickCategory(html, name) {
  const crumbs = breadcrumbFromHtml(html) || [];
  return crumbs.filter((c, i) => c &&
    !/^(トップ|ホーム|TOP|HOME|物件詳細|詳細)$|官公庁オークション/i.test(c) &&
    c !== name && !c.startsWith('【') &&
    c !== crumbs[i - 1]) // 同じ名前が続く階層はまとめる
    .join(' > ');
}

function breadcrumbFromHtml(html) {
  const m = html.match(/<(nav|ol|ul|div)[^>]*(?:class="[^"]*breadcrumb[^"]*"|aria-label="[^"]*(?:breadcrumb|パンくず)[^"]*")[^>]*>([\s\S]*?)<\/\1>/i);
  if (!m) return null;
  const parts = m[2].match(/<li[^>]*>[\s\S]*?<\/li>/gi) || m[2].match(/<a[^>]*>[\s\S]*?<\/a>/gi) || [];
  const crumbs = parts.map(p => toText(p).replace(/[>＞›»]/g, '').trim()).filter(Boolean);
  return crumbs.length ? crumbs : null;
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
