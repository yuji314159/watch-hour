# Watch Hour

YouTube動画を登録・一覧表示する個人用SPA。仕様は [docs/spec.md](docs/spec.md) を参照。

## 起動

Node.js 24 LTSを推奨。

```sh
npm ci
npm run dev
```

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
