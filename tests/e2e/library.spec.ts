import { test, expect } from '@playwright/test';

test('register, duplicate, reload and delete a video on mobile', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
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
  await page
    .getByLabel('YouTube URL')
    .fill('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  await expect(page.getByLabel('タイトル', { exact: true })).toHaveValue(
    'お気に入りの動画',
  );
  await page.getByRole('button', { name: '＋ 動画を登録' }).click();
  await expect(page.getByRole('alert')).toContainText('すでに登録');

  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'お気に入りの動画' }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);

  await page.screenshot({
    path: 'test-results/library-mobile.png',
    fullPage: true,
  });

  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('button', { name: 'お気に入りの動画を削除' }).click();
  await expect(
    page.getByRole('heading', { name: 'お気に入りの動画' }),
  ).toBeVisible();

  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'お気に入りの動画を削除' }).click();
  await expect(page.getByText('最初の一本を保存しよう')).toBeVisible();

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
