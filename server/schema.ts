import {
  integer,
  primaryKey,
  sqliteTable,
  text,
} from 'drizzle-orm/sqlite-core';

export const videos = sqliteTable('videos', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  videoId: text('video_id').notNull().unique(),
  title: text('title').notNull(),
  url: text('url').notNull(),
  durationSeconds: integer('duration_seconds'),
  watched: integer('watched', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
});

export type Video = typeof videos.$inferSelect;

export const channels = sqliteTable('channels', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  channelId: text('channel_id').notNull().unique(),
  title: text('title').notNull(),
  uploadsPlaylistId: text('uploads_playlist_id').notNull(),
  createdAt: text('created_at').notNull(),
  lastCheckedAt: text('last_checked_at'),
});

export const channelImports = sqliteTable(
  'channel_imports',
  {
    channelId: integer('channel_id').notNull(),
    videoId: text('video_id').notNull(),
  },
  (table) => [primaryKey({ columns: [table.channelId, table.videoId] })],
);

export type Channel = typeof channels.$inferSelect;
