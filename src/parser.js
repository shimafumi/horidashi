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
