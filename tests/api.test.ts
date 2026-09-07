import { afterEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../server/db';
import { createApp } from '../server/app';
import {
  parseVideoId,
  fetchVideoMetadata,
  MetadataError,
  parseDuration,
} from '../server/youtube';

const cleanups: (() => void)[] = [];

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  cleanups
    .splice(0)
    .reverse()
    .forEach((fn) => fn());
});

const metadata = async (id: string) => ({
  title: id === 'abcdefghijk' ? 'second' : 'first',
  durationSeconds: 213,
});

function setup(getMetadata = metadata) {
  const connection = openDatabase(':memory:');
  cleanups.push(() => connection.sqlite.close());
  return createApp(connection.db, getMetadata);
}

const post = (app: ReturnType<typeof setup>, data: unknown) =>
  app.request('/api/videos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });

describe('YouTube URLs', () => {
  it('accepts supported variants', () => {
    for (const url of [
      'https://youtube.com/watch?v=dQw4w9WgXcQ&t=10',
      'https://youtu.be/dQw4w9WgXcQ',
      'https://www.youtube.com/shorts/dQw4w9WgXcQ',
      'https://m.youtube.com/embed/dQw4w9WgXcQ',
      'https://youtube.com/live/dQw4w9WgXcQ',
    ])
      expect(parseVideoId(url)).toBe('dQw4w9WgXcQ');
  });

  it('rejects impostor hosts and malformed IDs', () => {
    for (const url of [
      'https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ',
      'https://evil.test',
      'javascript:alert(1)',
      'https://youtube.com/watch?v=short',
      'https://youtu.be/dQw4w9WgXcQ/extra',
      'https://user@youtube.com/watch?v=dQw4w9WgXcQ',
    ])
      expect(parseVideoId(url)).toBeNull();
  });
});

it('registers, lists newest first, prevents duplicates and deletes', async () => {
  const app = setup();
  expect(await (await app.request('/api/videos')).json()).toEqual({
    videos: [],
  });

  const result = await post(app, {
    title: ' first ',
    url: 'https://youtu.be/dQw4w9WgXcQ',
  });
  expect(result.status).toBe(201);

  const { video } = await result.json();
  expect(video.title).toBe('first');
  expect(video.durationSeconds).toBe(213);
  expect(video.url).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');

  expect((await post(app, { title: 'duplicate', url: video.url })).status).toBe(
    409,
  );

  await post(app, { title: 'second', url: 'https://youtu.be/abcdefghijk' });
  expect(
    (await (await app.request('/api/videos')).json()).videos.map(
      (v: { title: string }) => v.title,
    ),
  ).toEqual(['second', 'first']);

  expect(
    (await app.request(`/api/videos/${video.id}`, { method: 'DELETE' })).status,
  ).toBe(204);
  expect(
    (await app.request(`/api/videos/${video.id}`, { method: 'DELETE' })).status,
  ).toBe(404);
});

it('rejects invalid inputs and malformed JSON', async () => {
  const app = setup();
  for (const data of [
    { url: '' },
    { title: 'x', url: 'https://example.com' },
    { url: 123 },
  ])
    expect((await post(app, data)).status).toBe(400);
  expect(
    (await app.request('/api/videos', { method: 'POST', body: '{' })).status,
  ).toBe(400);
  expect(
    (await app.request('/api/videos/1x', { method: 'DELETE' })).status,
  ).toBe(400);
  expect((await app.request('/api/missing')).status).toBe(404);
});

it('persists videos after reopening SQLite and reapplies migrations safely', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'watch-hour-'));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));

  const path = join(dir, 'db.sqlite');
  const first = openDatabase(path);
  await post(createApp(first.db, metadata), {
    title: 'persistent',
    url: 'https://youtu.be/dQw4w9WgXcQ',
  });
  first.sqlite.close();

  const second = openDatabase(path);
  cleanups.push(() => second.sqlite.close());
  expect(
    (await (await createApp(second.db).request('/api/videos')).json()).videos[0]
      .title,
  ).toBe('first');
  expect(
    (await (await createApp(second.db).request('/api/videos')).json()).videos[0]
      .durationSeconds,
  ).toBe(213);
});

it('previews without saving and refuses to save when metadata fails', async () => {
  const app = setup();
  const result = await app.request(
    '/api/videos/metadata?url=https://youtu.be/dQw4w9WgXcQ',
  );
  expect(await result.json()).toEqual({
    metadata: { title: 'first', durationSeconds: 213 },
  });
  expect(await (await app.request('/api/videos')).json()).toEqual({
    videos: [],
  });
  const failed = setup(async () => {
    throw new MetadataError('取得失敗');
  });
  expect(
    (await post(failed, { url: 'https://youtu.be/dQw4w9WgXcQ' })).status,
  ).toBe(502);
  expect(await (await failed.request('/api/videos')).json()).toEqual({
    videos: [],
  });
});

it('parses YouTube durations', () => {
  expect(parseDuration('PT3M33S')).toBe(213);
  expect(parseDuration('P1DT2H3M4S')).toBe(93784);
  for (const value of ['', 'P', 'PT', 'PT0S', 'invalid', 'PT-1S'])
    expect(parseDuration(value)).toBeNull();
});

it('fetches title and duration from the official API and handles upstream failures', async () => {
  vi.stubEnv('YOUTUBE_API_KEY', 'test-key');
  const upstream = vi.fn().mockResolvedValue(
    Response.json({
      items: [
        {
          snippet: { title: '動画', liveBroadcastContent: 'none' },
          contentDetails: { duration: 'PT1H2M3S' },
        },
      ],
    }),
  );
  vi.stubGlobal('fetch', upstream);
  await expect(fetchVideoMetadata('dQw4w9WgXcQ')).resolves.toEqual({
    title: '動画',
    durationSeconds: 3723,
  });
  expect(new URL(upstream.mock.calls[0][0]).searchParams.get('part')).toBe(
    'snippet,contentDetails',
  );
  upstream.mockResolvedValue(Response.json({ items: [] }));
  await expect(fetchVideoMetadata('dQw4w9WgXcQ')).rejects.toMatchObject({
    status: 404,
  });
  upstream.mockResolvedValue(new Response('', { status: 403 }));
  await expect(fetchVideoMetadata('dQw4w9WgXcQ')).rejects.toMatchObject({
    status: 502,
  });
  upstream.mockRejectedValue(new Error('timeout'));
  await expect(fetchVideoMetadata('dQw4w9WgXcQ')).rejects.toMatchObject({
    status: 502,
  });
  vi.stubEnv('YOUTUBE_API_KEY', '');
  await expect(fetchVideoMetadata('dQw4w9WgXcQ')).rejects.toMatchObject({
    status: 503,
  });
});

const patch = (
  app: ReturnType<typeof setup>,
  id: string | number,
  data: unknown,
) =>
  app.request(`/api/videos/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });

it('updates watched state idempotently and validates patches', async () => {
  const app = setup();
  const { video } = await (
    await post(app, { url: 'https://youtu.be/dQw4w9WgXcQ' })
  ).json();
  expect(video.watched).toBe(false);
  for (const watched of [true, true, false]) {
    const response = await patch(app, video.id, { watched });
    expect(response.status).toBe(200);
    expect((await response.json()).video).toEqual({ ...video, watched });
    expect(
      (await (await app.request('/api/videos')).json()).videos[0].watched,
    ).toBe(watched);
  }
  for (const data of [
    {},
    { watched: 'true' },
    { watched: 1 },
    { watched: null },
    { watched: true, title: 'changed' },
  ])
    expect((await patch(app, video.id, data)).status).toBe(400);
  for (const id of ['0', '-1', '1x', '9007199254740992'])
    expect((await patch(app, id, { watched: true })).status).toBe(400);
  expect((await patch(app, 999, { watched: true })).status).toBe(404);
  expect(
    (
      await app.request(`/api/videos/${video.id}`, {
        method: 'PATCH',
        body: '{',
      })
    ).status,
  ).toBe(400);
});

it('migrates existing videos as unwatched and persists watched state on reopen', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'watch-hour-watched-'));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'db.sqlite');
  const legacy = new Database(path);
  legacy.exec('CREATE TABLE migrations (name TEXT PRIMARY KEY)');
  for (const name of ['0001_videos.sql', '0002_video_duration.sql']) {
    legacy.exec(readFileSync(`migrations/${name}`, 'utf8'));
    legacy.prepare('INSERT INTO migrations (name) VALUES (?)').run(name);
  }
  legacy.exec(
    "INSERT INTO videos (video_id, title, url, created_at) VALUES ('dQw4w9WgXcQ', 'legacy', 'https://youtu.be/dQw4w9WgXcQ', '2026-09-08T00:00:00Z')",
  );
  legacy.close();

  const first = openDatabase(path);
  try {
    const app = createApp(first.db);
    const { videos } = await (await app.request('/api/videos')).json();
    expect(videos[0]).toMatchObject({ watched: false, durationSeconds: null });
    expect((await patch(app, videos[0].id, { watched: true })).status).toBe(
      200,
    );
  } finally {
    first.sqlite.close();
  }
  const second = openDatabase(path);
  cleanups.push(() => second.sqlite.close());
  expect(
    (await (await createApp(second.db).request('/api/videos')).json()).videos[0]
      .watched,
  ).toBe(true);
});
