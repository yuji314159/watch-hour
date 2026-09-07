import { test, expect } from '@playwright/test';

test('register, duplicate, reload and delete a video on mobile', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const total = page.getByRole('region', { name: '未視聴動画の合計時間' });
  await expect(total).toContainText('0時間0分0秒');
  await expect(page.getByText('最初の一本を保存しよう')).toBeVisible();

  await page.getByLabel('YouTube URL').fill('https://youtu.be/dQw4w9WgXcQ');
  await expect(page.getByLabel('タイトル', { exact: true })).toHaveValue(
    'お気に入りの動画',
  );
  await expect(page.getByText('再生時間: 3:33', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '＋ 動画を登録' }).click();
  await expect(
    page.getByRole('heading', { name: 'お気に入りの動画' }),
  ).toBeVisible();
  await expect(total).toContainText('0時間3分33秒');
  await page
    .getByLabel('YouTube URL')
    .fill('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  await expect(page.getByLabel('タイトル', { exact: true })).toHaveValue(
    'お気に入りの動画',
  );
  await page.getByRole('button', { name: '＋ 動画を登録' }).click();
  await expect(page.getByRole('alert')).toContainText('すでに登録');
  await expect(total).toContainText('0時間3分33秒');

  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'お気に入りの動画' }),
  ).toBeVisible();
  await expect(total).toContainText('0時間3分33秒');
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);

  await page.screenshot({
    path: 'test-results/library-mobile.png',
    fullPage: true,
  });

  const watched = page.getByRole('button', {
    name: 'お気に入りの動画を視聴済み',
    exact: true,
  });
  await watched.click();
  await expect(watched).toHaveAttribute('aria-pressed', 'true');
  await expect(total).toContainText('0時間0分0秒');
  await expect(total).toContainText('すべての動画を視聴済みです。');
  await page.reload();
  await expect(watched).toHaveAttribute('aria-pressed', 'true');
  await expect(total).toContainText('0時間0分0秒');
  await page.screenshot({
    path: 'test-results/watched-mobile.png',
    fullPage: true,
  });

  await page.route('**/api/videos/*', (route) =>
    route.fulfill({ status: 500, json: { error: '更新に失敗しました。' } }),
  );
  await watched.click();
  await expect(page.getByRole('alert')).toContainText('更新に失敗しました。');
  await expect(watched).toHaveAttribute('aria-pressed', 'true');
  await expect(total).toContainText('0時間0分0秒');
  await page.unroute('**/api/videos/*');
  await watched.click();
  await expect(watched).toHaveAttribute('aria-pressed', 'false');
  await expect(total).toContainText('0時間3分33秒');

  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('button', { name: 'お気に入りの動画を削除' }).click();
  await expect(
    page.getByRole('heading', { name: 'お気に入りの動画' }),
  ).toBeVisible();

  await expect(total).toContainText('0時間3分33秒');
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'お気に入りの動画を削除' }).click();
  await expect(page.getByText('最初の一本を保存しよう')).toBeVisible();

  await expect(total).toContainText('0時間0分0秒');

  await page.setViewportSize({ width: 1440, height: 1000 });

  await page.screenshot({
    path: 'test-results/library-desktop.png',
    fullPage: true,
  });
});

test('metadata errors can be retried and changing the URL clears the title', async ({
  page,
}) => {
  await page.goto('/');
  await page.route('**/api/videos/metadata?*', (route) =>
    route.fulfill({
      status: 502,
      json: { error: '動画情報を取得できませんでした。' },
    }),
  );
  await page.getByLabel('YouTube URL').fill('https://youtu.be/dQw4w9WgXcQ');
  await expect(page.getByRole('alert')).toContainText(
    '動画情報を取得できませんでした',
  );
  await expect(
    page.getByRole('button', { name: '＋ 動画を登録' }),
  ).toBeDisabled();
  await page.unroute('**/api/videos/metadata?*');
  await page.getByRole('button', { name: '再取得', exact: true }).click();
  await expect(page.getByLabel('タイトル', { exact: true })).toHaveValue(
    'お気に入りの動画',
  );
  await page.getByLabel('YouTube URL').fill('https://example.com');
  await expect(page.getByLabel('タイトル', { exact: true })).toHaveValue('');
  await expect(
    page.getByRole('button', { name: '＋ 動画を登録' }),
  ).toBeDisabled();
});

test('total carries seconds and minutes and excludes unknown durations', async ({
  page,
}) => {
  await page.route('**/api/videos', (route) =>
    route.fulfill({
      json: {
        videos: [
          {
            id: 1,
            videoId: 'dQw4w9WgXcQ',
            title: '長い動画',
            url: 'https://youtu.be/dQw4w9WgXcQ',
            durationSeconds: 89999,
            watched: false,
            createdAt: '2026-09-08T00:00:00Z',
          },
          {
            id: 2,
            videoId: 'abcdefghijk',
            title: '短い動画',
            url: 'https://youtu.be/abcdefghijk',
            durationSeconds: 62,
            watched: false,
            createdAt: '2026-09-08T00:00:00Z',
          },
          {
            id: 3,
            videoId: '12345678901',
            title: '以前の動画',
            url: 'https://youtu.be/12345678901',
            durationSeconds: null,
            watched: false,
            createdAt: '2026-09-08T00:00:00Z',
          },
          {
            id: 4,
            videoId: 'watched0001',
            title: '視聴済み動画',
            url: 'https://youtu.be/watched0001',
            durationSeconds: 3600,
            watched: true,
            createdAt: '2026-09-08T00:00:00Z',
          },
          {
            id: 5,
            videoId: 'watched0002',
            title: '時間不明の視聴済み動画',
            url: 'https://youtu.be/watched0002',
            durationSeconds: null,
            watched: true,
            createdAt: '2026-09-08T00:00:00Z',
          },
        ],
      },
    }),
  );
  await page.goto('/');
  const total = page.getByRole('region', { name: '未視聴動画の合計時間' });
  await expect(total).toContainText('25時間1分1秒');
  await expect(total).toContainText('再生時間未取得の1本は合計に含みません。');
  await page.screenshot({
    path: 'test-results/watch-time-desktop.png',
    fullPage: true,
  });
  await page.setViewportSize({ width: 320, height: 800 });
  await expect(total).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: 'test-results/watch-time-mobile.png',
    fullPage: true,
  });
});

test('loading, failure and unknown durations do not display a misleading zero', async ({
  page,
}) => {
  let respond!: () => void;
  const pending = new Promise<void>((resolve) => {
    respond = resolve;
  });
  await page.route('**/api/videos', async (route) => {
    await pending;
    await route.fulfill({
      status: 500,
      json: { error: '読み込みに失敗しました。' },
    });
  });
  await page.goto('/');
  const total = page.getByRole('region', { name: '未視聴動画の合計時間' });
  await expect(total).toContainText('合計時間を読み込み中…');
  await expect(total).not.toContainText('0時間');
  respond();
  await expect(total).toContainText('合計時間を取得できませんでした');
  await expect(total).not.toContainText('0時間');
  await page.unroute('**/api/videos');
  await page.route('**/api/videos', (route) =>
    route.fulfill({
      json: {
        videos: [
          {
            id: 1,
            videoId: 'dQw4w9WgXcQ',
            title: '以前の動画',
            url: 'https://youtu.be/dQw4w9WgXcQ',
            durationSeconds: null,
            watched: false,
            createdAt: '2026-09-08T00:00:00Z',
          },
        ],
      },
    }),
  );
  await page.getByRole('button', { name: '再読み込み', exact: true }).click();
  await expect(total).toContainText('再生時間が未取得です');
  await expect(total).not.toContainText('0時間');
});
