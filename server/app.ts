import { Hono } from 'hono';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { channels, channelImports, videos } from './schema';
import { parseVideoId, fetchVideoMetadata, MetadataError } from './youtube';
import type { openDatabase } from './db';

import { fetchChannel, fetchChannelVideos, parseChannelUrl } from './channels';

const inputSchema = z.object({
  url: z.string().trim().max(2048),
});

export function createApp(
  db: ReturnType<typeof openDatabase>['db'],
  getMetadata = fetchVideoMetadata,
  getChannel = fetchChannel,
  getChannelVideos = fetchChannelVideos,
) {
  const app = new Hono();

  app.onError((error, c) => {
    if (error instanceof MetadataError)
      return c.json({ error: error.message }, error.status);

    console.error(error);

    return c.json(
      { error: '処理に失敗しました。時間をおいて再度お試しください。' },
      500,
    );
  });

  app.get('/api/videos', (c) =>
    c.json({ videos: db.select().from(videos).orderBy(desc(videos.id)).all() }),
  );

  app.get('/api/videos/metadata', async (c) => {
    const videoId = parseVideoId(c.req.query('url') ?? '');
    if (!videoId)
      return c.json({ error: '有効なYouTube動画URLを入力してください。' }, 400);

    return c.json({ metadata: await getMetadata(videoId) });
  });

  app.post('/api/videos', async (c) => {
    const input = inputSchema.safeParse(await c.req.json().catch(() => null));
    if (!input.success)
      return c.json({ error: 'YouTube URLを入力してください。' }, 400);

    const videoId = parseVideoId(input.data.url);
    if (!videoId)
      return c.json({ error: '有効なYouTube動画URLを入力してください。' }, 400);

    if (db.select().from(videos).where(eq(videos.videoId, videoId)).get())
      return c.json({ error: 'この動画はすでに登録されています。' }, 409);

    const metadata = await getMetadata(videoId);

    const video = db
      .insert(videos)
      .values({
        videoId,
        ...metadata,
        url: `https://www.youtube.com/watch?v=${videoId}`,
        createdAt: new Date().toISOString(),
      })
      .onConflictDoNothing({ target: videos.videoId })
      .returning()
      .get();

    if (!video)
      return c.json({ error: 'この動画はすでに登録されています。' }, 409);

    return c.json({ video }, 201);
  });

  app.patch('/api/videos/:id', async (c) => {
    const raw = c.req.param('id');
    const id = Number(raw);
    if (!/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(id))
      return c.json({ error: '動画IDが不正です。' }, 400);

    const input = z
      .object({ watched: z.boolean() })
      .strict()
      .safeParse(await c.req.json().catch(() => null));
    if (!input.success)
      return c.json({ error: '視聴済み状態を指定してください。' }, 400);

    const video = db
      .update(videos)
      .set(input.data)
      .where(eq(videos.id, id))
      .returning()
      .get();

    return video
      ? c.json({ video })
      : c.json({ error: '動画が見つかりません。' }, 404);
  });

  app.delete('/api/videos/:id', (c) => {
    const raw = c.req.param('id');
    const id = Number(raw);
    if (!/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(id))
      return c.json({ error: '動画IDが不正です。' }, 400);

    const result = db.delete(videos).where(eq(videos.id, id)).run();

    return result.changes
      ? c.body(null, 204)
      : c.json({ error: '動画が見つかりません。' }, 404);
  });

  app.get('/api/channels', (c) =>
    c.json({
      channels: db.select().from(channels).orderBy(desc(channels.id)).all(),
    }),
  );

  app.post('/api/channels', async (c) => {
    const input = inputSchema.safeParse(await c.req.json().catch(() => null));
    const parsed = input.success ? parseChannelUrl(input.data.url) : null;
    if (!parsed)
      return c.json(
        {
          error:
            '有効なYouTubeチャンネルURL（@ハンドルまたは/channel/ID）を入力してください。',
        },
        400,
      );

    const metadata = await getChannel(parsed);
    const channel = db
      .insert(channels)
      .values({ ...metadata, createdAt: new Date().toISOString() })
      .onConflictDoNothing()
      .returning()
      .get();
    return channel
      ? c.json({ channel }, 201)
      : c.json({ error: 'このチャンネルはすでに登録されています。' }, 409);
  });

  app.use('/api/channels/:id/*', async (c, next) => {
    const raw = c.req.param('id') ?? '';
    if (!/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(Number(raw)))
      return c.json({ error: 'チャンネルIDが不正です。' }, 400);
    await next();
  });

  app.delete('/api/channels/:id', (c) => {
    const raw = c.req.param('id');
    const id = Number(raw);
    if (!/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(id))
      return c.json({ error: 'チャンネルIDが不正です。' }, 400);
    const removed = db.transaction((tx) => {
      tx.delete(channelImports).where(eq(channelImports.channelId, id)).run();
      return tx.delete(channels).where(eq(channels.id, id)).run().changes;
    });
    return removed
      ? c.body(null, 204)
      : c.json({ error: 'チャンネルが見つかりません。' }, 404);
  });

  const syncing = new Set<number>();
  app.post('/api/channels/:id/sync', async (c) => {
    const id = Number(c.req.param('id'));
    const channel = db.select().from(channels).where(eq(channels.id, id)).get();
    if (!channel) return c.json({ error: 'チャンネルが見つかりません。' }, 404);
    if (syncing.has(id))
      return c.json({ error: 'このチャンネルは取り込み中です。' }, 409);
    syncing.add(id);

    try {
      const ids = await getChannelVideos(
        channel.uploadsPlaylistId,
        channel.createdAt,
      );
      const seen = new Set(
        db
          .select()
          .from(channelImports)
          .where(eq(channelImports.channelId, id))
          .all()
          .map((row) => row.videoId),
      );
      const pending: {
        videoId: string;
        title: string;
        durationSeconds: number;
      }[] = [];
      let skipped = 0;

      for (const videoId of new Set(ids)) {
        if (seen.has(videoId)) continue;

        try {
          pending.push({ videoId, ...(await getMetadata(videoId)) });
        } catch (error) {
          if (
            error instanceof MetadataError &&
            [404, 422].includes(error.status)
          ) {
            skipped++;
            continue;
          }

          throw error;
        }
      }

      const result = db.transaction((tx) => {
        if (!tx.select().from(channels).where(eq(channels.id, id)).get())
          return null;

        let added = 0;
        for (const video of pending) {
          const imported = tx
            .insert(channelImports)
            .values({ channelId: id, videoId: video.videoId })
            .onConflictDoNothing()
            .run();
          if (!imported.changes) continue;
          added += tx
            .insert(videos)
            .values({
              ...video,
              url: `https://www.youtube.com/watch?v=${video.videoId}`,
              createdAt: new Date().toISOString(),
            })
            .onConflictDoNothing()
            .run().changes;
        }

        const updated = tx
          .update(channels)
          .set({ lastCheckedAt: new Date().toISOString() })
          .where(eq(channels.id, id))
          .returning()
          .get();

        return { added, skipped, channel: updated };
      });

      return result
        ? c.json(result)
        : c.json({ error: 'チャンネルが削除されました。' }, 404);
    } finally {
      syncing.delete(id);
    }
  });

  app.all('/api/*', (c) => c.json({ error: 'APIが見つかりません。' }, 404));

  return app;
}
