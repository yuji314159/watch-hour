import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const videos = sqliteTable('videos', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  videoId: text('video_id').notNull().unique(),
  title: text('title').notNull(),
  url: text('url').notNull(),
  durationSeconds: integer('duration_seconds'),
  createdAt: text('created_at').notNull(),
});

export type Video = typeof videos.$inferSelect;
