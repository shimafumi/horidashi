# horidashi

官公庁オークションの出品物件をスプレッドシートに一覧化する Google Apps Script です。
robots.txt を守り、1件ごとに待ち時間を入れてアクセスします。

## 初回セットアップ

1. https://script.google.com/home/usersettings で「Google Apps Script API」をオンにする
2. VS Code でこのフォルダを開き、「Reopen in Container」を選ぶ
3. コンテナ内のターミナルで `clasp login` を実行し、表示されたURLをブラウザで開いて承認する
4. スプレッドシートを新規作成し、「拡張機能 > Apps Script」を開く
5. Apps Script の「プロジェクトの設定」からスクリプトIDをコピーする
6. `cp .clasp.json.example .clasp.json` を実行し、スクリプトIDを書き込む
7. `npm run push` でコードを反映する
8. スプレッドシートを再読み込みすると「公売リスト」メニューが表示される

### `clasp login` で詰まった場合

ログイン後にブラウザで「このサイトにアクセスできません」と表示された場合は、
アドレスバーのURL（`http://localhost:...?code=...` の形）を丸ごとコピーし、
`clasp login` を実行したまま、コンテナ内の別のターミナルで次を実行してください。

```bash
curl "コピーしたURL"
```

ログイン情報はボリュームに保存されるので、コンテナを作り直しても再ログインは不要です。

## 開発

- `npm run push`：ローカルのコードを Apps Script に反映
- `npm run pull`：Apps Script 側の変更をローカルに取り込む
- `npm run watch`：保存するたびに自動で反映

## 使い方

1. 「公売リスト > ① 初期設定」を実行
2. 「URL」シートのA2から下に物件ページのURLを貼る（または `CONFIG.USE_SITEMAP` を `true` にする）
3. 「② 一覧を更新」または「自動更新を開始」を実行
4. 「一覧」シートの「相場」列に落札相場を入れると相場比が出る

## 注意

- 自動取得の前に、対象サイトの利用規約を確認してください。
- HTTP 429 / 403 が返った場合は自動で停止します。待ち時間（`SLEEP_MS`）を増やしてから再開してください。
