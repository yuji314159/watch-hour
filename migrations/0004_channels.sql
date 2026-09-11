CREATE TABLE channels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  uploads_playlist_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_checked_at TEXT
);
CREATE TABLE channel_imports (
  channel_id INTEGER NOT NULL,
  video_id TEXT NOT NULL,
  PRIMARY KEY (channel_id, video_id)
);
