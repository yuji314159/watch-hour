import { afterEach, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../server/db';
import { createApp } from '../server/app';
import {
  fetchChannel,
  fetchChannelVideos,
  parseChannelUrl,
} from '../server/channels';
import { fetchVideoMetadataBatch, MetadataError } from '../server/youtube';

const connections: ReturnType<typeof openDatabase>[] = [];
afterEach(() => {
  connections.splice(0).forEach((connection) => connection.sqlite.close());
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
const channel = {
  channelId: `UC${'a'.repeat(22)}`,
  title: 'テストチャンネル',
  uploadsPlaylistId: 'UUtest',
};
function setup() {
  const connection = openDatabase(':memory:');
  connections.push(connection);
  const metadata = vi.fn(async () => ({
    title: '新着動画',
    durationSeconds: 60,
  }));
  const batch = vi.fn(
    async (ids: string[]) =>
      new Map(
        ids.map((id) => [id, { title: '新着動画', durationSeconds: 60 }]),
      ),
  );
  const list = vi.fn(async () => ({
    ids: ['abcdefghijk'],
    latestVideoId: 'abcdefghijk',
  }));
  return {
    app: createApp(connection.db, metadata, async () => channel, list, batch),
    batch,
    list,
  };
}
async function register(app: ReturnType<typeof createApp>) {
  return app.request('/api/channels', {
    method: 'POST',
    body: JSON.stringify({ url: 'https://www.youtube.com/@test' }),
    headers: { 'Content-Type': 'application/json' },
  });
}

it('registers, deduplicates, imports, retains watched state and does not restore deleted imports', async () => {
  const { app, list } = setup();
  const response = await register(app);
  expect(response.status).toBe(201);
  const { channel: saved } = await response.json();
  expect((await register(app)).status).toBe(409);
  expect(
    (await (await app.request('/api/channels')).json()).channels,
  ).toHaveLength(1);
  const sync = () =>
    app.request(`/api/channels/${saved.id}/sync`, { method: 'POST' });
  expect(await (await sync()).json()).toMatchObject({
    added: 1,
    skipped: 0,
    channel: { latestVideoId: 'abcdefghijk' },
  });
  expect(list).toHaveBeenCalledWith('UUtest', saved.createdAt, null);
  const { videos } = await (await app.request('/api/videos')).json();
  await app.request(`/api/videos/${videos[0].id}`, {
    method: 'PATCH',
    body: JSON.stringify({ watched: true }),
  });
  expect(await (await sync()).json()).toMatchObject({ added: 0 });
  expect(list).toHaveBeenLastCalledWith(
    'UUtest',
    saved.createdAt,
    'abcdefghijk',
  );
  expect(
    (await (await app.request('/api/videos')).json()).videos[0].watched,
  ).toBe(true);
  await app.request(`/api/videos/${videos[0].id}`, { method: 'DELETE' });
  expect(await (await sync()).json()).toMatchObject({ added: 0 });
  expect((await (await app.request('/api/videos')).json()).videos).toHaveLength(
    0,
  );
});

it('does not partially save failures; retries unavailable videos; channel deletion retains library', async () => {
  const { app, batch, list } = setup();
  const { channel: saved } = await (await register(app)).json();
  list.mockResolvedValue({
    ids: ['abcdefghijk', '12345678901'],
    latestVideoId: 'abcdefghijk',
  });
  batch.mockRejectedValueOnce(new MetadataError('failed'));
  const sync = () =>
    app.request(`/api/channels/${saved.id}/sync`, { method: 'POST' });
  expect((await sync()).status).toBe(502);
  expect((await (await app.request('/api/videos')).json()).videos).toHaveLength(
    0,
  );
  expect(
    (await (await app.request('/api/channels')).json()).channels[0]
      .lastCheckedAt,
  ).toBeNull();
  expect(
    (await (await app.request('/api/channels')).json()).channels[0]
      .latestVideoId,
  ).toBeNull();
  batch.mockResolvedValueOnce(
    new Map([['abcdefghijk', { title: 'ok', durationSeconds: 60 }]]),
  );
  expect(await (await sync()).json()).toMatchObject({ added: 1, skipped: 1 });
  expect(await (await sync()).json()).toMatchObject({ added: 1, skipped: 0 });
  expect(
    (await app.request(`/api/channels/${saved.id}`, { method: 'DELETE' }))
      .status,
  ).toBe(204);
  expect((await (await app.request('/api/videos')).json()).videos).toHaveLength(
    2,
  );
  expect((await sync()).status).toBe(404);
  expect(
    (await app.request('/api/channels/0/sync', { method: 'POST' })).status,
  ).toBe(400);
  expect(
    (await app.request('/api/channels/1x', { method: 'DELETE' })).status,
  ).toBe(400);
});

it('requests unseen video metadata in batches of at most 50', async () => {
  const { app, batch, list } = setup();
  const { channel: saved } = await (await register(app)).json();
  const ids = Array.from({ length: 51 }, (_, index) =>
    String(index).padStart(11, '0'),
  );
  list.mockResolvedValue({ ids, latestVideoId: ids[0] });

  const sync = () =>
    app.request(`/api/channels/${saved.id}/sync`, { method: 'POST' });
  expect(await (await sync()).json()).toMatchObject({ added: 51, skipped: 0 });
  expect(batch).toHaveBeenCalledTimes(2);
  expect(batch.mock.calls[0][0]).toEqual(ids.slice(0, 50));
  expect(batch.mock.calls[1][0]).toEqual(ids.slice(50));

  expect(await (await sync()).json()).toMatchObject({ added: 0, skipped: 0 });
  expect(batch).toHaveBeenCalledTimes(2);
});

it('skips missing and live videos in one batch, then retries them', async () => {
  vi.stubEnv('YOUTUBE_API_KEY', 'test');
  const response = (items: unknown[]) => Response.json({ items });
  const video = (
    id: string,
    liveBroadcastContent: string,
    duration: string,
  ) => ({
    id,
    snippet: { title: id, liveBroadcastContent },
    contentDetails: { duration },
  });
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      response([
        video('abcdefghijk', 'none', 'PT1M'),
        video('12345678901', 'live', 'PT1M'),
      ]),
    );
  vi.stubGlobal('fetch', fetcher);
  const ids = ['abcdefghijk', '12345678901', 'missing0001'];
  const first = await fetchVideoMetadataBatch(ids);
  expect(first).toEqual(
    new Map([['abcdefghijk', { title: 'abcdefghijk', durationSeconds: 60 }]]),
  );
  expect(new URL(fetcher.mock.calls[0][0]).searchParams.get('id')).toBe(
    ids.join(','),
  );
  fetcher.mockResolvedValueOnce(
    response([
      video('12345678901', 'none', 'PT2M'),
      video('missing0001', 'none', 'PT3M'),
    ]),
  );
  expect(await fetchVideoMetadataBatch(ids.slice(1))).toEqual(
    new Map([
      ['12345678901', { title: '12345678901', durationSeconds: 120 }],
      ['missing0001', { title: 'missing0001', durationSeconds: 180 }],
    ]),
  );
  expect((await fetchVideoMetadataBatch([])).size).toBe(0);
});

it('fails a batch on upstream errors or malformed metadata', async () => {
  vi.stubEnv('YOUTUBE_API_KEY', 'test');
  const fetcher = vi.fn().mockResolvedValue(new Response('', { status: 403 }));
  vi.stubGlobal('fetch', fetcher);
  await expect(fetchVideoMetadataBatch(['abcdefghijk'])).rejects.toMatchObject({
    status: 502,
  });

  fetcher.mockResolvedValue(
    Response.json({
      items: [{ id: 'abcdefghijk', snippet: { title: '' } }],
    }),
  );
  await expect(fetchVideoMetadataBatch(['abcdefghijk'])).rejects.toMatchObject({
    status: 502,
  });

  vi.stubEnv('YOUTUBE_API_KEY', '');
  await expect(fetchVideoMetadataBatch(['abcdefghijk'])).rejects.toMatchObject({
    status: 503,
  });
});

it('does not save the first batch when a later batch fails', async () => {
  const { app, batch, list } = setup();
  const { channel: saved } = await (await register(app)).json();
  const ids = Array.from({ length: 51 }, (_, index) =>
    String(index).padStart(11, '0'),
  );
  list.mockResolvedValue({ ids, latestVideoId: ids[0] });
  batch.mockImplementationOnce(
    async (ids) =>
      new Map(
        ids.map((id) => [id, { title: '新着動画', durationSeconds: 60 }]),
      ),
  );
  batch.mockRejectedValueOnce(new MetadataError('failed'));

  const response = await app.request(`/api/channels/${saved.id}/sync`, {
    method: 'POST',
  });
  expect(response.status).toBe(502);
  expect(batch).toHaveBeenCalledTimes(2);
  expect((await (await app.request('/api/videos')).json()).videos).toHaveLength(
    0,
  );
});

it('validates channel URLs and resolves handles', async () => {
  expect(
    parseChannelUrl(`https://youtube.com/channel/${channel.channelId}`),
  ).toEqual({ id: channel.channelId });
  expect(parseChannelUrl('https://youtube.com/@%E6%97%A5%E6%9C%AC')).toEqual({
    forHandle: '@日本',
  });
  for (const url of [
    'https://evil.com/@test',
    'https://youtube.com/watch?v=abcdefghijk',
    'https://youtube.com:444/@test',
    'https://user@youtube.com/@test',
  ])
    expect(parseChannelUrl(url)).toBeNull();
  vi.stubEnv('YOUTUBE_API_KEY', 'test');
  const fetcher = vi.fn().mockResolvedValue(
    Response.json({
      items: [
        {
          id: channel.channelId,
          snippet: { title: channel.title },
          contentDetails: { relatedPlaylists: { uploads: 'UUtest' } },
        },
      ],
    }),
  );
  vi.stubGlobal('fetch', fetcher);
  expect(await fetchChannel({ forHandle: '@test' })).toEqual(channel);
  expect(new URL(fetcher.mock.calls[0][0]).searchParams.get('forHandle')).toBe(
    '@test',
  );
});

it('paginates and filters by publication date, propagating upstream failures', async () => {
  vi.stubEnv('YOUTUBE_API_KEY', 'test');
  const item = (videoId: string, videoPublishedAt: string) => ({
    contentDetails: { videoId, videoPublishedAt },
  });
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({
        items: [item('abcdefghijk', '2026-09-12T00:00:00Z')],
        nextPageToken: 'next',
      }),
    )
    .mockResolvedValueOnce(
      Response.json({
        items: [
          item('12345678901', '2026-01-01T00:00:00Z'),
          item('abcdefghijk', '2026-09-12T00:00:00Z'),
        ],
      }),
    );
  vi.stubGlobal('fetch', fetcher);
  expect(
    await fetchChannelVideos('UUtest', '2026-09-11T00:00:00Z', null),
  ).toEqual({ ids: ['abcdefghijk'], latestVideoId: 'abcdefghijk' });
  expect(new URL(fetcher.mock.calls[1][0]).searchParams.get('pageToken')).toBe(
    'next',
  );
  fetcher.mockResolvedValue(new Response('', { status: 403 }));
  await expect(
    fetchChannelVideos('UUtest', '2026-09-11T00:00:00Z', null),
  ).rejects.toMatchObject({ status: 502 });
});

it('stops after the saved video plus ten older entries, even across pages', async () => {
  vi.stubEnv('YOUTUBE_API_KEY', 'test');
  const videoIds = Array.from({ length: 120 }, (_, index) =>
    String(index).padStart(11, '0'),
  );
  const fetcher = vi.fn(async (value: URL) => {
    const url = new URL(value);
    const offset = Number(url.searchParams.get('pageToken') ?? 0);
    return Response.json({
      items: videoIds.slice(offset, offset + 50).map((videoId) => ({
        contentDetails: {
          videoId,
          videoPublishedAt: '2026-09-12T00:00:00Z',
        },
      })),
      ...(offset + 50 < videoIds.length
        ? { nextPageToken: String(offset + 50) }
        : {}),
    });
  });
  vi.stubGlobal('fetch', fetcher);

  const since = '2026-09-11T00:00:00Z';
  expect(await fetchChannelVideos('UUtest', since, videoIds[45])).toEqual({
    ids: videoIds.slice(0, 56),
    latestVideoId: videoIds[0],
  });
  expect(fetcher).toHaveBeenCalledTimes(2);

  fetcher.mockClear();
  expect(await fetchChannelVideos('UUtest', since, videoIds[0])).toEqual({
    ids: videoIds.slice(0, 11),
    latestVideoId: videoIds[0],
  });
  expect(fetcher).toHaveBeenCalledTimes(1);

  fetcher.mockClear();
  expect(await fetchChannelVideos('UUtest', since, 'not-found')).toEqual({
    ids: videoIds,
    latestVideoId: videoIds[0],
  });
  expect(fetcher).toHaveBeenCalledTimes(3);

  fetcher.mockClear();
  expect(await fetchChannelVideos('UUtest', since, null)).toEqual({
    ids: videoIds,
    latestVideoId: videoIds[0],
  });
  expect(fetcher).toHaveBeenCalledTimes(3);
});

it('migrates an existing channel and persists its boundary after a successful sync', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'watch-hour-boundary-'));
  const path = join(directory, 'db.sqlite');
  let connection: ReturnType<typeof openDatabase> | undefined;
  let reopened: ReturnType<typeof openDatabase> | undefined;

  try {
    const legacy = new Database(path);
    legacy.exec('CREATE TABLE migrations (name TEXT PRIMARY KEY)');
    for (const name of [
      '0001_videos.sql',
      '0002_video_duration.sql',
      '0003_video_watched.sql',
      '0004_channels.sql',
    ]) {
      legacy.exec(readFileSync(`migrations/${name}`, 'utf8'));
      legacy.prepare('INSERT INTO migrations (name) VALUES (?)').run(name);
    }
    legacy
      .prepare(
        'INSERT INTO channels (channel_id, title, uploads_playlist_id, created_at) VALUES (?, ?, ?, ?)',
      )
      .run(channel.channelId, channel.title, 'UUtest', '2026-09-11T00:00:00Z');
    legacy.close();

    connection = openDatabase(path);
    const list = vi.fn(async () => ({
      ids: ['abcdefghijk'],
      latestVideoId: 'abcdefghijk',
    }));
    const app = createApp(
      connection.db,
      async () => ({ title: '動画', durationSeconds: 60 }),
      async () => channel,
      list,
      async () =>
        new Map([['abcdefghijk', { title: '動画', durationSeconds: 60 }]]),
    );
    expect(
      (await (await app.request('/api/channels')).json()).channels[0],
    ).toMatchObject({ latestVideoId: null });

    const sync = () => app.request('/api/channels/1/sync', { method: 'POST' });
    expect(await (await sync()).json()).toMatchObject({
      channel: { latestVideoId: 'abcdefghijk' },
    });
    connection.sqlite.close();
    connection = undefined;

    reopened = openDatabase(path);
    const response = await createApp(reopened.db).request('/api/channels');
    const { channels } = await response.json();
    expect(channels[0].latestVideoId).toBe('abcdefghijk');
  } finally {
    connection?.sqlite.close();
    reopened?.sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

it('keeps the previous boundary when a later sync fails', async () => {
  const { app, batch, list } = setup();
  const { channel: saved } = await (await register(app)).json();
  const sync = () =>
    app.request(`/api/channels/${saved.id}/sync`, { method: 'POST' });
  expect((await sync()).status).toBe(200);

  list.mockResolvedValue({
    ids: ['newest00001', 'abcdefghijk'],
    latestVideoId: 'newest00001',
  });
  batch.mockRejectedValueOnce(new MetadataError('failed'));
  expect((await sync()).status).toBe(502);
  expect(
    (await (await app.request('/api/channels')).json()).channels[0],
  ).toMatchObject({ latestVideoId: 'abcdefghijk' });

  expect((await sync()).status).toBe(200);
  expect(list).toHaveBeenLastCalledWith(
    'UUtest',
    saved.createdAt,
    'abcdefghijk',
  );
  expect(
    (await (await app.request('/api/channels')).json()).channels[0],
  ).toMatchObject({ latestVideoId: 'newest00001' });
});

it('rejects concurrent syncs and does not save after channel deletion', async () => {
  const { app, list } = setup();
  const { channel: saved } = await (await register(app)).json();
  let finish!: (result: { ids: string[]; latestVideoId: string }) => void;
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  list.mockImplementationOnce(() => {
    started();
    return new Promise<{ ids: string[]; latestVideoId: string }>((resolve) => {
      finish = resolve;
    });
  });
  const sync = () =>
    app.request(`/api/channels/${saved.id}/sync`, { method: 'POST' });
  const pending = sync();
  await ready;
  expect((await sync()).status).toBe(409);
  expect(
    (await app.request(`/api/channels/${saved.id}`, { method: 'DELETE' }))
      .status,
  ).toBe(204);
  finish({ ids: ['abcdefghijk'], latestVideoId: 'abcdefghijk' });
  expect((await pending).status).toBe(404);
  expect((await (await app.request('/api/videos')).json()).videos).toHaveLength(
    0,
  );
});
