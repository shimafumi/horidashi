// ===== 設定・定数 =====
const CONFIG = {
  LIST_SHEET: '一覧',
  BASE_URL: 'https://kankocho.jp',
  START_ID: 72984,              // 連番取得を始める物件ID（初回、またはリセット後に使用）
  SLEEP_MS: 1000,               // 1件ごとの待ち時間（ミリ秒）。429/403が出たら増やす
  MAX_ITEMS_PER_RUN: 100,       // 1回の実行で物件ページにアクセスする最大回数
  PROBE_COUNT: 3,               // 欠番が出たとき、先の物件を何回チェックするか（すべて欠番なら最新まで取得済みとみなす）
  PROBE_RANGE: 100,             // チェックする物件の位置（欠番から 1〜この数 先をランダムに選ぶ）
  RECHECK_HOURS: 20,            // 欠番を再確認する間隔（時間）。毎日の自動更新で毎回対象になるよう24より短め
  MISSING_CHECK_LIMIT: 7,       // 欠番と判定した回数（初回の判定を含む）がこの数に達したら、再確認の対象から外す
  TIME_LIMIT_MS: 5 * 60 * 1000, // GASの6分制限の手前で止める
  AUTO_HOUR: 6,                 // 自動更新（毎日1回）を実行する時間帯（0〜23時）
};

const HEADERS = ['物件ID', 'URL', '物件名', 'カテゴリ', '執行機関', '見積価額等(円)', '入札開始', '入札終了',
                 '取得日時', '欠番', '欠番確認回数'];
// 列番号（1始まり）
const COL = {
  ID: 1, URL: 2, NAME: 3, CATEGORY: 4, PRICE: 6, START: 7, END: 8,
  FETCHED: 9, MISSING: 10, MISSING_COUNT: 11,
};
const MISSING_MARK = '欠番';
const DATE_FORMAT = 'yyyy/mm/dd hh:mm';

// 連番取得の進捗（スクリプトプロパティに保存）
const PROP_NEXT_ID = 'NEXT_ID';           // 次に確認するID
const PROP_PENDING_FROM = 'PENDING_FROM'; // 末尾で続いている欠番の先頭ID（なければ未設定）
