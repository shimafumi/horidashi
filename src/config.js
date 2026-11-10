// ===== 設定・定数 =====
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

const HEADERS = ['物件ID', 'URL', '物件名', 'カテゴリ', '執行機関', '見積価額等(円)', '入札開始', '入札終了',
                 '相場(手入力・円)', '相場比', 'メモ', '取得日時', '欠番'];
// 列番号（1始まり）
const COL = {
  ID: 1, NAME: 3, CATEGORY: 4, PRICE: 6, START: 7, END: 8, MARKET: 9, RATIO: 10,
  MEMO: 11, FETCHED: 12, MISSING: 13,
};const MISSING_MARK = '欠番';

// 連番取得の進捗（スクリプトプロパティに保存）
const PROP_NEXT_ID = 'NEXT_ID';           // 次に確認するID
const PROP_PENDING_FROM = 'PENDING_FROM'; // 末尾で続いている欠番の先頭ID（なければ未設定）
