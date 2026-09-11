import { MetadataError } from './youtube';

export function parseChannelUrl(
  value: string,
): { id: string } | { forHandle: string } | null {
  try {
    const url = new URL(value);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.port ||
      !['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(
        url.hostname,
      )
    )
      return null;
    const path = decodeURIComponent(url.pathname);
    const id = /^\/channel\/(UC[\w-]{22})\/?$/.exec(path)?.[1];
    if (id) return { id };
    const handle = /^\/(@[^/\s?#]+)\/?$/.exec(path)?.[1];
    return handle ? { forHandle: handle } : null;
  } catch {
    return null;
  }
}

async function request(resource: string, params: Record<string, string>) {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key)
    throw new MetadataError(
      'チャンネル情報の取得にはサーバーのYOUTUBE_API_KEY設定が必要です。',
      503,
    );
  try {
    const url = new URL(`https://www.googleapis.com/youtube/v3/${resource}`);
    url.search = new URLSearchParams({ ...params, key }).toString();
    const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!response.ok)
      throw new MetadataError(
        'YouTubeからチャンネル情報を取得できませんでした。',
      );
    const body = await response.json();
    if (!Array.isArray(body.items))
      throw new MetadataError('YouTubeの応答が不正です。');
    return body;
  } catch (error) {
    if (error instanceof MetadataError) throw error;
    throw new MetadataError(
      'YouTubeとの通信に失敗しました。再度お試しください。',
    );
  }
}

export async function fetchChannel(
  input: NonNullable<ReturnType<typeof parseChannelUrl>>,
) {
  const body = await request('channels', {
    part: 'snippet,contentDetails',
    ...input,
  });
  const item = body.items[0];
  if (!item) throw new MetadataError('チャンネルが見つかりません。', 404);
  const title = item.snippet?.title;
  const uploadsPlaylistId = item.contentDetails?.relatedPlaylists?.uploads;
  if (
    !/^UC[\w-]{22}$/.test(item.id) ||
    typeof title !== 'string' ||
    !title.trim() ||
    typeof uploadsPlaylistId !== 'string' ||
    !uploadsPlaylistId
  )
    throw new MetadataError('チャンネル情報が不正です。');
  return {
    channelId: item.id as string,
    title: title.trim(),
    uploadsPlaylistId,
  };
}

export async function fetchChannelVideos(
  playlistId: string,
  since: string,
): Promise<string[]> {
  const ids = new Set<string>();
  const tokens = new Set<string>();
  let pageToken = '';
  do {
    const body = await request('playlistItems', {
      part: 'contentDetails',
      playlistId,
      maxResults: '50',
      ...(pageToken ? { pageToken } : {}),
    });
    for (const item of body.items) {
      const details = item.contentDetails;
      if (
        !details ||
        !/^[\w-]{11}$/.test(details.videoId) ||
        !Number.isFinite(Date.parse(details.videoPublishedAt))
      )
        throw new MetadataError('動画一覧の応答が不正です。');
      if (Date.parse(details.videoPublishedAt) >= Date.parse(since))
        ids.add(details.videoId);
    }
    pageToken = body.nextPageToken ?? '';
    if (typeof pageToken !== 'string' || (pageToken && tokens.has(pageToken)))
      throw new MetadataError('動画一覧のページ情報が不正です。');
    tokens.add(pageToken);
  } while (pageToken);
  return [...ids];
}
