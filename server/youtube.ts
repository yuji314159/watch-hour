export function parseVideoId(value: string): string | null {
  try {
    const url = new URL(value);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.port
    )
      return null;

    let id: string | null = null;
    if (url.hostname === 'youtu.be')
      id = /^\/([\w-]+)\/?$/.exec(url.pathname)?.[1] ?? null;
    else if (
      ['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(url.hostname)
    ) {
      if (url.pathname === '/watch') id = url.searchParams.get('v');
      else
        id =
          /^\/(?:shorts|embed|live)\/([\w-]+)\/?$/.exec(url.pathname)?.[1] ??
          null;
    }

    return id && /^[\w-]{11}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

export type VideoMetadata = { title: string; durationSeconds: number };

export class MetadataError extends Error {
  constructor(
    message: string,
    public status: 404 | 422 | 502 | 503 = 502,
  ) {
    super(message);
  }
}

export function parseDuration(value: string): number | null {
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(
    value,
  );
  if (!match || !match.slice(1).some(Boolean)) return null;

  const seconds =
    Number(match[1] ?? 0) * 86400 +
    Number(match[2] ?? 0) * 3600 +
    Number(match[3] ?? 0) * 60 +
    Number(match[4] ?? 0);
  return Number.isSafeInteger(seconds) && seconds > 0 ? seconds : null;
}

export async function fetchVideoMetadata(
  videoId: string,
): Promise<VideoMetadata> {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key)
    throw new MetadataError(
      '動画情報の取得にはサーバーのYOUTUBE_API_KEY設定が必要です。',
      503,
    );

  try {
    const endpoint = new URL('https://www.googleapis.com/youtube/v3/videos');
    endpoint.search = new URLSearchParams({
      part: 'snippet,contentDetails',
      id: videoId,
      key,
    }).toString();
    const response = await fetch(endpoint, {
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok)
      throw new MetadataError(
        'YouTubeから動画情報を取得できませんでした。時間をおいて再度お試しください。',
      );

    const body = await response.json();
    if (!Array.isArray(body.items))
      throw new MetadataError('YouTubeの応答が不正です。再度お試しください。');
    const item = body.items[0];
    if (!item)
      throw new MetadataError(
        '動画が見つかりません。URLや公開状態を確認してください。',
        404,
      );

    const title = item.snippet?.title;
    const durationSeconds = parseDuration(item.contentDetails?.duration ?? '');
    if (typeof title !== 'string' || !title.trim())
      throw new MetadataError('動画のタイトルを取得できませんでした。');
    if (
      item.snippet?.liveBroadcastContent === 'live' ||
      item.snippet?.liveBroadcastContent === 'upcoming' ||
      durationSeconds === null
    ) {
      throw new MetadataError(
        '再生時間が確定した動画のみ登録できます。ライブ配信中や配信予定の動画は終了後にお試しください。',
        422,
      );
    }

    return { title: title.trim(), durationSeconds };
  } catch (error) {
    if (error instanceof MetadataError) throw error;
    throw new MetadataError(
      'YouTubeとの通信に失敗しました。再度お試しください。',
    );
  }
}
