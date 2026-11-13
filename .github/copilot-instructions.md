# Copilot instructions for horidashi

## 1. 開発・検証コマンド

このリポジトリは Google Apps Script (GAS) プロジェクトで、Node.js の package scripts はデプロイ用に限定されています。

- `npm install`：依存関係の取得
- `clasp login`：Apps Script への認証。初回のみ必要
- `cp .clasp.json.example .clasp.json`：スクリプトIDを設定してデプロイ設定を作成
- `npm run push`：ローカルの `src/` コードを Apps Script に反映
- `npm run pull`：Apps Script 側の変更をローカルに取り込む
- `npm run watch`：保存時に自動で `clasp push --watch` を実行

### テスト / lint

- `package.json` には `test` / `lint` / `build` スクリプトは定義されていません。
- 実際の検証は、Apps Script へ `push` したうえでスプレッドシート上のメニュー操作や `HTML確認（物件IDを指定）` で 1 件ずつ確認するのが中心です。
- 1 件単位のフォーカス確認の例：スプレッドシートで「HTML確認（物件IDを指定）」を実行し、指定 ID のページが `物件あり` / `欠番` / `エラー` として判定されることを確認する。
- 変更が取得ロジックや解析ロジックに関わる場合は、`DEBUG` 的な 1 件確認を行い、`robots.txt` 違反や 429/403 の挙動を確認する。

## 2. 高レベルなアーキテクチャ

このプロジェクトは「特定の官公庁オークションサイトを順番に巡回して、物件情報を Google スプレッドシートへ一覧化する」GASアプリです。

- `src/config.js`：`CONFIG`、`HEADERS`、`COL`、`MISSING_MARK` などの定数と Script Properties のキーを定義
- `src/main.js`：取得の本体。連番で ID を辿り、欠番検出と再確認を行う
- `src/fetch.js`：HTTP 通信、`robots.txt` 参照、HTTP 429/403 の検出、ページ判定
- `src/parser.js`：HTML から物件名・執行機関・価格・入札期間・カテゴリを抽出
- `src/sheet.js`：一覧シートの列作成と値書き込み
- `src/trigger.js`：最新まで取り終わるまで一定間隔で再実行し、完了後に自動停止するトリガー制御
- `src/menu.js`：スプレッドシートメニュー定義とデバッグ用の UI
- `src/robots.js`：`robots.txt` のルール解析とアクセス許可判定

### 重要な設計上の前提

- GAS では `src/*.js` が同じグローバルスコープで動くため、`import` / `export` を使わず、関数と定数が共有される前提で書く。
- 物件 ID は連番であり、取得位置は `PropertiesService.getScriptProperties()` で保持する。`NEXT_ID` と `PENDING_FROM` を見直すと、どこから続きが取得されるかが分かる。
- アクセス制限（HTTP 429/403）を受けると `BLOCKED` が立ち、`buildList` は途中で止まって自動更新を停止する。待ち時間や取得枚数の調整が重要。
- `robots.txt` を読めない／禁止されている場合は安全側に倒してアクセスをしない。
- 変化の多いロジックは、`fetchPage()` / `judgePage()` / `parseItem()` の流れで、通信 → 判定 → 解析という順に保つ。

## 3. リポジトリ固有の慣習と注意点

### Apps Script / スプレッドシート特有

- スプレッドシートのシート名 `一覧` と `CONFIG.LIST_SHEET` が密接に結びついている。`setupSheets()` でヘッダーを作る。
- 列構成を変えるときは、`HEADERS`、`COL`、`ensureHeaders()`、`itemValues()` の整合性を一緒に保つ。既存の一覧は自動で書き換わらないため、列を変えた場合は「一覧シートを作り直して取り直す」運用が前提。
- `MENU` から呼ばれる関数名と `onOpen()` のメニュー項目名は一致させる。メニュー項目名は日本語なので、UI トリガーの関数名とデバッグ用途の値に注意する。

### 取得ロジックの前提

- 物件を順番にたどる実装が中心。欠番が見つかると、`PROBE_COUNT` と `PROBE_RANGE` を使って先の ID をランダムに確認し、全部欠番なら「最新まで取得済み」とみなす。
- 一覧に残す欠番と、最終的に未採番として扱う欠番の境界がある。`pending` / `recheckMissing()` の実装では、最新の未採番候補を後続の実行に引き継ぐ設計になっている。
- `recheckMissing()` で `MISSING_CHECK_LIMIT` に達した欠番は再確認対象から外す。数値や時間のしきい値を変えると挙動が変わるため、設定変更を伴う場合は README の仕様と整合させる。

### 解析ロジックの前提

- HTML 解析は正規表現中心。`parseItem()` は `title` から `name` と `agency` を取り、`text` から `price` と `period` を拾う。
- `pickCategory()` はパンくずリストから `large` / `middle` / `small` を作る。カテゴリ名の扱いは、`一般 > スポーツ、レジャー > 船、ボート > パーツ` のような文脈に合わせる。
- `judgePage()` は「空ページなら欠番」「404/410 なら欠番」「不正な HTTP コードなら error」という判定を行う。`isEmptyItem()` の判定に依存しているため、ページの “空” 判定は簡潔に保つ。

### ドキュメントと運用

- README の「初期セットアップ」「使い方」「注意」を優先する。プロジェクトの仕様は README にまとまっており、実装と齟齬が出やすいのがこのリポジトリの特徴。
- セットアップ時は `clasp login` と `.clasp.json` の作成が必須。`README.md` にある手順を守る。
- 自動更新や取得の調整は `CONFIG` の値を変更して行う。サイトの規約・アクセス制限の影響を受けやすいので、値の変更は慎重に。

## 4. 変更時の確認ポイント

- 変更したロジックが `robots.txt` のチェックや 429/403 の扱いに影響しないか確認する
- `HEADERS` / `COL` / `itemValues()` の整合が崩れていないか確認する
- `buildList()` や `scanForward()` が「終了条件・再開位置」を正しく持っているか確認する
- 1 件ずつの HTML 確認で、変化が `物件あり` / `欠番` 判定に正しく反映されるかチェックする

## 5. 重要な参照先

- `README.md`：初期セットアップ、使い方、各メニューの意味、取得ロジックの説明
- `src/config.js`：各定数と Script Properties の定義
- `src/main.js`：連番取得と欠番再確認の制御
- `src/fetch.js` と `src/parser.js`：通信と HTML 解析の中心
