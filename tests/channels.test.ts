import { afterEach, expect, it, vi } from 'vitest';
import { openDatabase } from '../server/db';
import { createApp } from '../server/app';
import {
  fetchChannel,
  fetchChannelVideos,
  parseChannelUrl,
} from '../server/channels';
import { MetadataError } from '../server/youtube';

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
  const list = vi.fn(async () => ['abcdefghijk']);
  return {
    app: createApp(connection.db, metadata, async () => channel, list),
    metadata,
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
  expect(await (await sync()).json()).toMatchObject({ added: 1, skipped: 0 });
  expect(list).toHaveBeenCalledWith('UUtest', saved.createdAt);
  const { videos } = await (await app.request('/api/videos')).json();
  await app.request(`/api/videos/${videos[0].id}`, {
    method: 'PATCH',
    body: JSON.stringify({ watched: true }),
  });
  expect(await (await sync()).json()).toMatchObject({ added: 0 });
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
  const { app, metadata, list } = setup();
  const { channel: saved } = await (await register(app)).json();
  list.mockResolvedValue(['abcdefghijk', '12345678901']);
  metadata
    .mockResolvedValueOnce({ title: 'ok', durationSeconds: 60 })
    .mockRejectedValueOnce(new MetadataError('failed'));
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
  metadata.mockRejectedValueOnce(new MetadataError('live', 422));
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
  expect(await fetchChannelVideos('UUtest', '2026-09-11T00:00:00Z')).toEqual([
    'abcdefghijk',
  ]);
  expect(new URL(fetcher.mock.calls[1][0]).searchParams.get('pageToken')).toBe(
    'next',
  );
  fetcher.mockResolvedValue(new Response('', { status: 403 }));
  await expect(
    fetchChannelVideos('UUtest', '2026-09-11T00:00:00Z'),
  ).rejects.toMatchObject({ status: 502 });
});

it('rejects concurrent syncs and does not save after channel deletion', async () => {
  const { app, list } = setup();
  const { channel: saved } = await (await register(app)).json();
  let finish!: (ids: string[]) => void;
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  list.mockImplementationOnce(() => {
    started();
    return new Promise<string[]>((resolve) => {
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
  finish(['abcdefghijk']);
  expect((await pending).status).toBe(404);
  expect((await (await app.request('/api/videos')).json()).videos).toHaveLength(
    0,
  );
});
