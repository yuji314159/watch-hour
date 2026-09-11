# Watch Hour 仕様

最終更新: 2026-09-11

## 目的・構成

個人利用のYouTube動画ライブラリSPA。認証は設けず、初期状態ではローカルホストのみで待ち受ける。
React + TypeScript + Vite、CSS Modules、Node.js + Hono、Zod、Drizzle ORM + better-sqlite3を使用する。
本番はNode.jsがビルド済みSPAと同一オリジンのAPIを配信する。SQLiteはDB_PATH（既定 data/watch-hour.sqlite）に永続化する。

## 機能

- YouTube URL入力の500ms後にタイトルと再生時間を自動取得して表示。タイトルは読み取り専用。取得中・失敗時は登録不可で、再取得ボタンから再試行できる。URL変更時は古い取得結果を破棄する。
- 登録時はサーバーが動画情報を再取得し、タイトルと再生時間（整数秒）を保存する。クライアント指定のタイトル・再生時間は採用しない。
- https/httpのyoutube.com/watch?v=、youtu.be/、youtube.com/shorts/、youtube.com/embed/、youtube.com/live/形式に対応。www.youtube.comとm.youtube.comも許可する。
- 動画IDは英数字、ハイフン、アンダースコアの11文字。保存URLは https://www.youtube.com/watch?v=ID に正規化する。
- 動画IDを一意にし、重複登録時は409と日本語の説明を返す。
- 新しい登録からカードで一覧表示。タイトル、再生時間（分:秒、1時間以上は時:分:秒）、サムネイル、登録日を表示し、YouTubeを別タブで開く。
- 各カードで視聴済み・未視聴を切り替える。視聴済み動画も一覧に残す。更新中は同じ動画の切替・削除を無効化し、失敗時は状態と合計を変更せずエラーを表示する。
- 削除はブラウザの確認ダイアログで確認してから実行する。
- 空状態、読込中、通信失敗、登録中、削除中の状態を表示する。
- YouTube Data API v3のvideos.list（snippet,contentDetails）をサーバーから呼び出す。タイムアウト10秒。APIキーは環境変数YOUTUBE_API_KEYで設定し、ブラウザに渡さない。サムネイルは動画IDから生成する。
- 非公開・削除済みなど取得できない動画は登録しない。配信中・配信予定および再生時間が0・不明の動画は422。
- レスポンシブな日本語UI。ログイン、タグ、検索、アプリ内再生は初期範囲外。

## 合計時間（WATCH HOUR）

- サービスの中心となる指標として、ページ上部に「YOUR WATCH HOUR / 未視聴動画の合計時間」を表示する。デスクトップでは導入文の横、モバイルでは導入文と登録フォームの間に配置する。
- GET /api/videosで取得した未視聴動画のみのdurationSecondsをクライアントで合算。時間を最も大きく強調し、分・秒も単位付きで表示する。秒単位で正確に集計し、24時間を超えても日数に変換せず累積時間を表示する。視聴済み動画を除外することを明記する。
- 登録・削除・視聴状態更新の成功時に一覧と同時に更新する。失敗・キャンセルでは変えない。再読込後も保存データから算出する。視聴状態はDBに永続化する。
- 全件視聴済みの場合は「0時間0分0秒」と「すべての動画を視聴済みです。」を表示する。
- 空のライブラリは「0時間0分0秒」と最初の登録を促す文章を表示する。読込中・取得失敗時は数値の代わりに状態を表示する。
- 再生時間がNULLの未視聴動画は集計対象外とし、その本数を明記する。未視聴動画が1本以上あり、すべて未取得なら合計値の代わりに「再生時間が未取得です」と表示する。
- 集計結果は支援技術にpoliteなライブ領域で通知する。大きい時間数は折り返し、狭い画面でも横スクロールを発生させない。

## データとAPI

videos: id（整数主キー）、videoId（一意）、title、url、durationSeconds（整数秒、既存レコードはNULL）、watched（boolean、SQLiteでは0/1、NOT NULL、既存・新規とも初期値false）、createdAt（UTC ISO8601）。起動時にSQLマイグレーションを適用する。

- GET /api/videos → 200 { videos: Video[] }
- GET /api/videos/metadata?url=… → 200 { metadata: { title, durationSeconds } }。DB保存なし。
- POST /api/videos { url } → 201 { video }。不正入力400、重複409。
- PATCH /api/videos/:id { watched: boolean } → 200 { video }。明示した状態に更新（同じ値で再送可能）。不正ID・JSON・boolean以外・未指定・余分なフィールドは400、存在しないIDは404。
- DELETE /api/videos/:id → 204。不正ID400、存在しないID404。
- メタデータ取得で動画なし404、再生時間未確定422、外部通信・応答異常502、APIキー未設定503。失敗時はDBに保存しない。既存動画の時間は自動補完せず「再生時間未取得」と表示する。
- 予期しないエラーは500。APIエラーは { error: string }。

## 開発・検証

npm run devでViteとAPIを起動。npm run buildで型検査とビルド、npm startで本番起動。
npm testで一時SQLiteを使ったAPI・URL検証・永続化テスト。npm run test:e2eでPlaywrightによる登録・重複・再読込・削除・視聴状態切替・未視聴時間集計を検証する。
仕様の追加・変更時はこのファイルも更新する。

## コードスタイル

Prettierでインデント2スペース、行幅80文字を目安に整形する。関数・APIルート・処理の段階ごとに空行を入れ、複数の処理を1行に詰め込まない。npm run formatで整形し、npm run format:checkで確認する。

## YouTube API設定

Google CloudでYouTube Data API v3を有効化してAPIキーを作成し、`export YOUTUBE_API_KEY=...` を実行してから開発・本番サーバーを起動する。`.env`の自動読込は行わない。取得は入力時と登録時に各1回でAPIの利用枠を消費する。APIテストとE2Eは取得処理をモックし、外部通信や実キーを必要としない。

参照: https://developers.google.com/youtube/v3/docs/videos/list

## Git運用

作業開始時はリモートの最新mainを取得し、そのmainから作業ブランチを作成する。作業完了後は必要な検証を実行し、変更をcommit・pushしてmain向けのPRを作成する。APIキーを含むローカル設定の `mise.toml` はGit管理対象外とする。

## チャンネル登録と手動取り込み

- チャンネル一覧をライブラリの上に表示。チャンネル名、YouTubeへのリンク、最終確認日時、登録フォーム、各チャンネルの「新着動画を取り込む」「チャンネルを削除」を提供する。
- 登録URLはHTTP/HTTPSのyoutube.com（www/mも可）の `/@ハンドル` と `/channel/UC…`。チャンネルIDはUC＋22文字。ハンドルは日本語などのURLエンコードにも対応する。動画URL、旧カスタムURL、認証情報・ポート付きURLは受け付けない。
- channels.list（snippet,contentDetails、id/forHandle）で正式なチャンネルID・名前・投稿動画プレイリストIDを取得。チャンネルIDで重複を防ぐ。登録時には動画を取り込まない。
- 手動実行時にplaylistItems.list（contentDetails、50件/ページ）の全ページを確認し、公開日時がチャンネル登録日時以降の動画だけを取り込む。過去動画の一括取り込みや定期実行は行わない。全ページの走査のため投稿数に応じたAPI利用枠と時間を消費する。
- videos.listでタイトル・確定した再生時間を取得して未視聴で保存。既存の動画は重複追加せず視聴状態を維持する。取り込み履歴を保持し、取り込み後にライブラリから削除した動画も再追加しない。
- 404/422の動画はスキップして件数を表示し、次回再確認する。通信・応答異常時はその実行の動画・履歴・最終確認日時を保存せずエラーを返す。保存はトランザクション。同じチャンネルの同時実行は409。取得中にチャンネルが削除された場合は404で保存しない。
- 成功時に追加件数を表示し、ライブラリと未視聴合計時間を再取得する。実行中はチャンネル操作を無効化。読込・空・失敗・再読込状態を表示する。
- チャンネル削除は確認ダイアログを表示。チャンネルと取り込み履歴のみを削除し、ライブラリの動画は残す。再登録時は新しい登録日時を基準とする。
- 既存のYOUTUBE_API_KEYを使用し、各外部リクエストのタイムアウトは10秒。キーはサーバーのみで使用する。

データ:

- channels: id（整数主キー）、channelId（一意）、title、uploadsPlaylistId、createdAt（UTC ISO8601）、lastCheckedAt（UTC ISO8601、未実行はNULL）。
- channel_imports: channelId（内部整数ID）、videoId。組で主キー。起動時マイグレーション0004で既存DBに追加する。

API:

- GET /api/channels → 200 { channels: Channel[] }（登録の新しい順）。
- POST /api/channels { url } → 201 { channel }。不正入力400、重複409、存在しないチャンネル404。
- DELETE /api/channels/:id → 204。不正ID400、存在しないID404。
- POST /api/channels/:id/sync → 200 { added, skipped, channel }。addedは追加本数、skippedは今回取得不可だった本数。不正ID400、存在しないID404、実行中409。外部通信・応答異常502、APIキー未設定503。

APIテストはURL検証・ページング・公開日時判定・重複・再試行・失敗時の原子性・視聴状態維持・削除を検証。E2Eはチャンネル登録・手動取り込み・再実行・再読込・削除確認と動画の保持を検証する。外部APIはモックする。

参照: https://developers.google.com/youtube/v3/docs/channels/list 、 https://developers.google.com/youtube/v3/docs/playlistItems/list
