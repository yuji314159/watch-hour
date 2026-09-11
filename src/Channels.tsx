import { useEffect, useState } from 'react';
import type { Channel } from '../server/schema';
import styles from './App.module.css';

async function request(path: string, options?: RequestInit) {
  const response = await fetch(`/api/channels${path}`, options);
  if (response.status === 204) return;
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? '通信に失敗しました。');
  return body;
}

export function Channels({ onImport }: { onImport: () => Promise<void> }) {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      setChannels((await request('')).channels);
    } catch (e) {
      setError(e instanceof Error ? e.message : '読み込みに失敗しました。');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);

  async function act(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : '処理に失敗しました。');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className={`${styles.register} ${styles.channels}`}
      aria-labelledby="channels-title"
    >
      <h2 id="channels-title">登録チャンネル</h2>
      <p>登録後に公開された動画を、チャンネルごとに手動で取り込めます。</p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void act(async () => {
            const { channel } = await request('', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ url }),
            });
            setChannels((previous) => [channel, ...previous]);
            setUrl('');
            setNotice('チャンネルを登録しました。');
          });
        }}
      >
        <label>
          チャンネルURL
          <input
            type="url"
            required
            maxLength={2048}
            placeholder="https://www.youtube.com/@handle"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={busy}
          />
        </label>
        <button className={styles.primary} disabled={busy || loading}>
          チャンネルを登録
        </button>
      </form>
      {error && (
        <div role="alert" className={styles.error}>
          {error}{' '}
          <button disabled={busy || loading} onClick={load}>
            チャンネル一覧を再読み込み
          </button>
        </div>
      )}
      <p role="status" className={styles.notice}>
        {busy ? '処理中…' : notice}
      </p>
      {loading ? (
        <p role="status">チャンネルを読み込み中…</p>
      ) : channels.length === 0 ? (
        <p>登録チャンネルはありません。</p>
      ) : (
        <ul className={styles.channelList}>
          {channels.map((channel) => (
            <li key={channel.id}>
              <div>
                <a
                  href={`https://www.youtube.com/channel/${channel.channelId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {channel.title} ↗
                </a>
                <p>
                  最終確認:{' '}
                  {channel.lastCheckedAt
                    ? new Date(channel.lastCheckedAt).toLocaleString('ja-JP')
                    : '未実行'}
                </p>
              </div>
              <button
                className={styles.primary}
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    const result = await request(`/${channel.id}/sync`, {
                      method: 'POST',
                    });
                    setChannels((previous) =>
                      previous.map((item) =>
                        item.id === channel.id ? result.channel : item,
                      ),
                    );
                    await onImport();
                    setNotice(
                      `${result.added}本の動画を追加しました。${result.skipped ? `取得不可・配信中などの${result.skipped}本は次回再確認します。` : ''}`,
                    );
                  })
                }
              >
                新着動画を取り込む
              </button>
              <button
                disabled={busy}
                onClick={() => {
                  if (
                    !window.confirm(
                      `「${channel.title}」の登録を削除しますか？ライブラリの動画は残ります。`,
                    )
                  )
                    return;
                  void act(async () => {
                    await request(`/${channel.id}`, { method: 'DELETE' });
                    setChannels((previous) =>
                      previous.filter((item) => item.id !== channel.id),
                    );
                    setNotice('チャンネルを削除しました。');
                  });
                }}
              >
                チャンネルを削除
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
