import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { createApp } from '../../server/app';
import { openDatabase } from '../../server/db';

const { db } = openDatabase(':memory:');
const app = createApp(
  db,
  async () => ({
    title: 'お気に入りの動画',
    durationSeconds: 213,
  }),
  async () => ({
    channelId: `UC${'a'.repeat(22)}`,
    title: 'テストチャンネル',
    uploadsPlaylistId: 'UUtest',
  }),
  async () => ['channel0001'],
);
app.use('*', serveStatic({ root: './dist' }));
app.get('*', serveStatic({ path: './dist/index.html' }));
serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 4173 });
