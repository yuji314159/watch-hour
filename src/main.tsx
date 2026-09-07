import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { parseVideoId } from '../server/youtube';
import type { VideoMetadata } from '../server/youtube';
import type { Video } from '../server/schema';
import styles from './App.module.css';

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, options);

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? '通信に失敗しました。再度お試しください。');
  }

  return response.status === 204 ? (undefined as T) : response.json();
}

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = String(seconds % 60).padStart(2, '0');
  return hours
    ? `${hours}:${String(minutes).padStart(2, '0')}:${remainder}`
    : `${minutes}:${remainder}`;
}

function App() {
  const [videos, setVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [url, setUrl] = useState('');
  const [metadata, setMetadata] = useState<
    (VideoMetadata & { url: string }) | null
  >(null);
  const [metadataError, setMetadataError] = useState('');
  const [metadataLoading, setMetadataLoading] = useState(false);
  const [retry, setRetry] = useState(0);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<number[]>([]);

  async function load() {
    setLoading(true);
    setLoadError('');

    try {
      setVideos((await api<{ videos: Video[] }>('/api/videos')).videos);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : '読み込みに失敗しました。');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    setMetadata(null);
    setMetadataError('');
    setMetadataLoading(false);
    if (!url.trim()) return;
    if (!parseVideoId(url.trim())) {
      setMetadataError('有効なYouTube動画URLを入力してください。');
      return;
    }

    const controller = new AbortController();
    setMetadataLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const result = await api<{ metadata: VideoMetadata }>(
          `/api/videos/metadata?url=${encodeURIComponent(url.trim())}`,
          { signal: controller.signal },
        );
        if (!controller.signal.aborted)
          setMetadata({ ...result.metadata, url });
      } catch (e) {
        if (!controller.signal.aborted)
          setMetadataError(
            e instanceof Error ? e.message : '動画情報を取得できませんでした。',
          );
      } finally {
        if (!controller.signal.aborted) setMetadataLoading(false);
      }
    }, 500);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [url, retry]);

  async function register(event: React.FormEvent) {
    event.preventDefault();
    if (!metadata || metadata.url !== url || metadataLoading) return;
    setSaving(true);
    setError('');
    setNotice('');

    try {
      const { video } = await api<{ video: Video }>('/api/videos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });

      setVideos((previous) => [video, ...previous]);
      setUrl('');
      setMetadata(null);
      setNotice('動画を登録しました。');
    } catch (e) {
      setError(e instanceof Error ? e.message : '登録に失敗しました。');
    } finally {
      setSaving(false);
    }
  }

  async function remove(video: Video) {
    if (!window.confirm(`「${video.title}」をライブラリから削除しますか？`))
      return;

    setDeleting((previous) => [...previous, video.id]);
    setError('');
    setNotice('');

    try {
      await api(`/api/videos/${video.id}`, { method: 'DELETE' });

      setVideos((previous) => previous.filter((v) => v.id !== video.id));
      setNotice('動画を削除しました。');
    } catch (e) {
      setError(e instanceof Error ? e.message : '削除に失敗しました。');
    } finally {
      setDeleting((previous) => previous.filter((id) => id !== video.id));
    }
  }

  const totalSeconds = videos.reduce(
    (total, video) => total + (video.durationSeconds ?? 0),
    0,
  );
  const unknownCount = videos.filter(
    (video) => video.durationSeconds == null,
  ).length;

  return (
    <div className={styles.app}>
      <header className={styles.header}>
        <a className={styles.brand} href="/">
          {' '}
          <span className={styles.logo}>▶</span> WATCH HOUR
        </a>
        <span className={styles.headerNote}>自分だけの動画ライブラリ</span>
      </header>

      <main>
        <div className={styles.hero}>
          <section className={styles.intro}>
            <p className={styles.eyebrow}>SAVE NOW. WATCH LATER.</p>
            <h1>
              観たい時間を、
              <br />
              ここに集めよう。
            </h1>
            <p>
              気になる動画も、何度も観たい一本も。
              <br />
              YouTubeのリンクを保存して、あなたのペースで。
            </p>
          </section>

          <section
            className={styles.watchTime}
            aria-labelledby="watch-time-title"
          >
            <p className={styles.eyebrow}>YOUR WATCH HOUR</p>
            <h2 id="watch-time-title">集めた動画の合計時間</h2>
            <div role="status" aria-live="polite" aria-atomic="true">
              {loading ? (
                <p className={styles.timeState}>合計時間を読み込み中…</p>
              ) : loadError ? (
                <p className={styles.timeState}>
                  合計時間を取得できませんでした
                </p>
              ) : (
                <>
                  {videos.length > 0 && unknownCount === videos.length ? (
                    <p className={styles.timeState}>再生時間が未取得です</p>
                  ) : (
                    <p className={styles.timeValue}>
                      <span className={styles.hours}>
                        <strong>
                          {Math.floor(totalSeconds / 3600).toLocaleString(
                            'ja-JP',
                          )}
                        </strong>
                        <span>時間</span>
                      </span>
                      <span className={styles.timePart}>
                        <strong>
                          {Math.floor((totalSeconds % 3600) / 60)}
                        </strong>
                        <span>分</span>
                      </span>
                      <span className={styles.timePart}>
                        <strong>{totalSeconds % 60}</strong>
                        <span>秒</span>
                      </span>
                    </p>
                  )}
                  <p className={styles.timeCaption}>
                    {videos.length === 0
                      ? '最初の一本から、あなたの時間がはじまる。'
                      : `${videos.length.toLocaleString('ja-JP')}本の動画が、あなたの楽しみに。`}
                  </p>
                  {unknownCount > 0 && (
                    <p className={styles.timeWarning}>
                      再生時間未取得の{unknownCount.toLocaleString('ja-JP')}
                      本は合計に含みません。
                    </p>
                  )}
                </>
              )}
            </div>
            <p className={styles.timeFootnote}>
              ライブラリに保存した動画の再生時間
            </p>
          </section>
        </div>

        <section className={styles.register} aria-labelledby="register-title">
          <div>
            <span className={styles.eyebrow}>ADD TO COLLECTION</span>
            <h2 id="register-title">動画を登録</h2>
          </div>
          <form onSubmit={register}>
            <label>
              YouTube URL
              <input
                type="url"
                required
                maxLength={2048}
                placeholder="https://www.youtube.com/watch?v=..."
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                disabled={saving}
              />
            </label>
            <label>
              タイトル
              <input
                readOnly
                placeholder="URLから自動取得"
                value={metadata?.url === url ? metadata.title : ''}
              />
            </label>
            {metadataLoading && <p role="status">動画情報を取得中…</p>}
            {metadata?.url === url && (
              <p>再生時間: {formatDuration(metadata.durationSeconds)}</p>
            )}
            {metadataError && (
              <div role="alert">
                <p>{metadataError}</p>
                <button
                  type="button"
                  onClick={() => setRetry((value) => value + 1)}
                >
                  再取得
                </button>
              </div>
            )}
            <button
              className={styles.primary}
              disabled={
                saving ||
                loading ||
                !!loadError ||
                metadataLoading ||
                !metadata ||
                metadata.url !== url
              }
            >
              {saving ? '登録中…' : '＋ 動画を登録'}
            </button>
          </form>
        </section>

        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        <p className={styles.notice} role="status">
          {notice}
        </p>

        <section aria-labelledby="library-title">
          <div className={styles.sectionHeading}>
            <h2 id="library-title">
              マイライブラリ <span>{videos.length}</span>
            </h2>
            <p>追加した順</p>
          </div>
          {loading ? (
            <p role="status" className={styles.empty}>
              ライブラリを読み込み中…
            </p>
          ) : loadError ? (
            <div className={styles.empty} role="alert">
              <p>{loadError}</p>
              <button onClick={load}>再読み込み</button>
            </div>
          ) : videos.length === 0 ? (
            <div className={styles.empty}>
              <span className={styles.emptyIcon}>▷</span>
              <h3>最初の一本を保存しよう</h3>
              <p>
                上のフォームにYouTubeのURLを入力すると、
                <br />
                ここにあなたのライブラリが広がります。
              </p>
            </div>
          ) : (
            <div className={styles.grid}>
              {videos.map((video) => (
                <article className={styles.card} key={video.id}>
                  <a
                    href={video.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={styles.thumbnail}
                    aria-label={`${video.title}をYouTubeで開く（新しいタブ）`}
                  >
                    <span className={styles.fallback}>▶</span>
                    <img
                      src={`https://i.ytimg.com/vi/${video.videoId}/hqdefault.jpg`}
                      alt=""
                      loading="lazy"
                      onError={(event) => {
                        event.currentTarget.style.display = 'none';
                      }}
                    />
                    <span className={styles.play}>▶</span>
                  </a>
                  <div className={styles.cardBody}>
                    <span className={styles.source}>
                      YOUTUBE ·{' '}
                      {video.durationSeconds == null
                        ? '再生時間未取得'
                        : formatDuration(video.durationSeconds)}
                    </span>
                    <h3>
                      <a
                        href={video.url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {video.title}
                      </a>
                    </h3>
                    <div className={styles.cardFooter}>
                      <time dateTime={video.createdAt}>
                        {new Date(video.createdAt).toLocaleDateString('ja-JP')}{' '}
                        追加
                      </time>
                      <button
                        aria-label={`${video.title}を削除`}
                        disabled={deleting.includes(video.id)}
                        onClick={() => remove(video)}
                      >
                        {deleting.includes(video.id) ? '削除中…' : '削除'}
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </main>

      <footer>
        WATCH HOUR <span>いい動画と、いい時間を。</span>
      </footer>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
