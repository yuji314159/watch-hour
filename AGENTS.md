# Project instructions

- 決定した仕様は常に docs/spec.md に記載する。機能・API・データ構造・運用方法を変更した場合は、同じ作業で仕様書も更新する。
- TypeScript、React + Vite、Hono、Drizzle ORM + SQLite、CSS Modulesの構成を使用する。
- 変更に応じて npm run build、npm test を実行する。画面操作を変更した場合は npm run test:e2e も実行する。
- 可読性を優先し、処理のまとまりごとに空行を入れる。コード整形は npm run format、確認は npm run format:check を使用する。

- 作業開始時はリモートの最新mainを取得し、そのmainから作業ブランチを作成して作業する。
- 作業完了時は必要な検証を実行し、変更をcommit・pushしてmain向けのPRを作成する。
