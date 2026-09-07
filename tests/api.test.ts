import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../server/db';
import { createApp } from '../server/app';
import { parseVideoId } from '../server/youtube';

const cleanups: (() => void)[] = [];

afterEach(() => {
  cleanups
    .splice(0)
    .reverse()
    .forEach((fn) => fn());
});

function setup() {
  const connection = openDatabase(':memory:');
  cleanups.push(() => connection.sqlite.close());
  return createApp(connection.db);
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
    { title: ' ', url: 'https://youtu.be/dQw4w9WgXcQ' },
    { title: 'x', url: 'https://example.com' },
    { title: 'x'.repeat(201), url: 'https://youtu.be/dQw4w9WgXcQ' },
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
  await post(createApp(first.db), {
    title: 'persistent',
    url: 'https://youtu.be/dQw4w9WgXcQ',
  });
  first.sqlite.close();

  const second = openDatabase(path);
  cleanups.push(() => second.sqlite.close());
  expect(
    (await (await createApp(second.db).request('/api/videos')).json()).videos[0]
      .title,
  ).toBe('persistent');
});
