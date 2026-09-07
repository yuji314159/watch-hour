# Watch Hour 仕様

最終更新: 2026-09-08

## 目的・構成
個人利用のYouTube動画ライブラリSPA。認証は設けず、初期状態ではローカルホストのみで待ち受ける。
React + TypeScript + Vite、CSS Modules、Node.js + Hono、Zod、Drizzle ORM + better-sqlite3を使用する。
本番はNode.jsがビルド済みSPAと同一オリジンのAPIを配信する。SQLiteはDB_PATH（既定 data/watch-hour.sqlite）に永続化する。

## 機能
- YouTube URLとタイトル（必須、前後空白除去後1〜200文字）を入力して登録。
- https/httpのyoutube.com/watch?v=、youtu.be/、youtube.com/shorts/、youtube.com/embed/、youtube.com/live/形式に対応。www.youtube.comとm.youtube.comも許可する。
- 動画IDは英数字、ハイフン、アンダースコアの11文字。保存URLは https://www.youtube.com/watch?v=ID に正規化する。
- 動画IDを一意にし、重複登録時は409と日本語の説明を返す。
- 新しい登録からカードで一覧表示。タイトル、サムネイル、登録日を表示し、YouTubeを別タブで開く。
- 削除はブラウザの確認ダイアログで確認してから実行する。
- 空状態、読込中、通信失敗、登録中、削除中の状態を表示する。
- タイトルは手動入力。サムネイルは動画IDからYouTube画像URLを生成し、取得失敗時は代替表示する。動画の存在や公開状態の確認、自動メタデータ取得は行わない。
- レスポンシブな日本語UI。ログイン、タグ、検索、アプリ内再生は初期範囲外。

## データとAPI
videos: id（整数主キー）、videoId（一意）、title、url、createdAt（UTC ISO8601）。起動時にSQLマイグレーションを適用する。
- GET /api/videos → 200 { videos: Video[] }
- POST /api/videos { url, title } → 201 { video }。不正入力400、重複409。
- DELETE /api/videos/:id → 204。不正ID400、存在しないID404。
- 予期しないエラーは500。APIエラーは { error: string }。

## 開発・検証
npm run devでViteとAPIを起動。npm run buildで型検査とビルド、npm startで本番起動。
npm testで一時SQLiteを使ったAPI・URL検証・永続化テスト。npm run test:e2eでPlaywrightによる登録・重複・再読込・削除を検証する。
仕様の追加・変更時はこのファイルも更新する。
