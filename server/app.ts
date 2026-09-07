import { Hono } from 'hono';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { videos } from './schema';
import { parseVideoId } from './youtube';
import type { openDatabase } from './db';
const inputSchema = z.object({ title: z.string().trim().min(1).max(200), url: z.string().trim().max(2048) });
export function createApp(db: ReturnType<typeof openDatabase>['db']) {
  const app = new Hono();
  app.onError((error, c) => { console.error(error); return c.json({ error: '処理に失敗しました。時間をおいて再度お試しください。' }, 500); });
  app.get('/api/videos', c => c.json({ videos: db.select().from(videos).orderBy(desc(videos.id)).all() }));
  app.post('/api/videos', async c => {
    const input = inputSchema.safeParse(await c.req.json().catch(() => null));
    if (!input.success) return c.json({ error: 'URLと1〜200文字のタイトルを入力してください。' }, 400);
    const videoId = parseVideoId(input.data.url);
    if (!videoId) return c.json({ error: '有効なYouTube動画URLを入力してください。' }, 400);
    const video = db.insert(videos).values({ videoId, title: input.data.title, url: `https://www.youtube.com/watch?v=${videoId}`, createdAt: new Date().toISOString() }).onConflictDoNothing({ target: videos.videoId }).returning().get();
    if (!video) return c.json({ error: 'この動画はすでに登録されています。' }, 409);
    return c.json({ video }, 201);
  });
  app.delete('/api/videos/:id', c => {
    const raw = c.req.param('id');
    const id = Number(raw);
    if (!/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(id)) return c.json({ error: '動画IDが不正です。' }, 400);
    const result = db.delete(videos).where(eq(videos.id, id)).run();
    return result.changes ? c.body(null, 204) : c.json({ error: '動画が見つかりません。' }, 404);
  });
  app.all('/api/*', c => c.json({ error: 'APIが見つかりません。' }, 404));
  return app;
}
