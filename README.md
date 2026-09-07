# Watch Hour

YouTube動画を登録・一覧表示する個人用SPA。仕様は [docs/spec.md](docs/spec.md) を参照。

## 起動

Node.js 24 LTSを推奨。

```sh
npm ci
export YOUTUBE_API_KEY=your_api_key
npm run dev
```

Google CloudでYouTube Data API v3を有効化してAPIキーを作成し、環境変数 `YOUTUBE_API_KEY` に設定する（本番起動時も必要）。`.env` は自動読込しない。URL入力でタイトルと再生時間を自動取得し、登録時に保存する。

http://127.0.0.1:5173 を開く。APIは127.0.0.1:3001。

## 本番

```sh
npm run build
npm start
```

http://127.0.0.1:3001 を開く。プロジェクトルートから実行する。
`DB_PATH`でSQLite保存先、`PORT`でポート、`HOST`で待受アドレスを変更可能。
デプロイ時は `dist/`、`dist-server/`、`migrations/`、package.json、package-lock.json と本番依存を配置し、DB_PATHに永続ディスクを指定する。
認証なしの個人利用向け。既定ではローカルホストのみで待ち受ける。

## 検証

```sh
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

APIテストは一時DB、E2Eテストは専用サーバーのメモリDBを使うため、通常の保存データを変更しない。
仕様変更時は docs/spec.md も更新する。

## コード整形

`npm run format` で整形し、`npm run format:check` で形式を確認する。処理のまとまりごとに空行を入れて読みやすさを保つ。
