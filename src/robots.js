// ===== robots.txt =====
let ROBOTS_RULES;     // robots.txt のルール（未読込なら undefined）

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
