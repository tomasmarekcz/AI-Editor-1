'use client';

import { useState } from 'react';

export type YouTubeConnectionView = {
  id: string;
  status: string;
  platform_channel_title: string | null;
  platform_channel_url: string | null;
  last_verified_at: string | null;
  disconnected_at: string | null;
};

async function readApiError(res: Response) {
  try {
    const data = await res.json() as { error?: string };
    return data.error ?? `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

export function YouTubeIntegrationPanel({
  isOwner,
  connection,
}: {
  isOwner: boolean;
  connection: YouTubeConnectionView | null;
}) {
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [message, setMessage] = useState('');
  const isConnected = connection?.status === 'connected';

  async function disconnect() {
    if (!isOwner || isDisconnecting) return;
    setIsDisconnecting(true);
    setMessage('');
    try {
      const res = await fetch('/api/integrations/youtube/disconnect', { method: 'POST' });
      if (!res.ok) throw new Error(await readApiError(res));
      window.location.reload();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setIsDisconnecting(false);
    }
  }

  return (
    <section className="mt-6 rounded-lg border border-gray-800 bg-gray-900/70 p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.22em] text-gray-400">Integrations</p>
          <h2 className="mt-2 text-xl font-black text-white">YouTube</h2>
          <p className="mt-2 text-sm leading-6 text-gray-400">
            {isConnected
              ? `Connected to ${connection?.platform_channel_title ?? 'YouTube channel'}.`
              : 'Connect YouTube to schedule Shorts from the publishing page.'}
          </p>
          {connection?.platform_channel_url && isConnected && (
            <a
              href={connection.platform_channel_url}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-block text-sm font-bold text-cyan-300 transition hover:text-cyan-100"
            >
              View channel
            </a>
          )}
          {!isOwner && (
            <p className="mt-3 text-xs text-gray-500">
              Only workspace owners can connect or disconnect YouTube.
            </p>
          )}
        </div>

        <div className="flex shrink-0 flex-col gap-2 sm:min-w-44">
          {isConnected ? (
            <button
              type="button"
              onClick={disconnect}
              disabled={!isOwner || isDisconnecting}
              className="rounded-lg border border-red-800 bg-red-500/10 px-4 py-2 text-sm font-black text-red-200 transition hover:border-red-500 hover:text-white disabled:cursor-not-allowed disabled:border-gray-800 disabled:text-gray-600"
            >
              {isDisconnecting ? 'Disconnecting...' : 'Disconnect'}
            </button>
          ) : (
            <a
              href={isOwner ? '/api/integrations/youtube/connect' : '#'}
              aria-disabled={!isOwner}
              className={`rounded-lg px-4 py-2 text-center text-sm font-black transition ${
                isOwner
                  ? 'bg-cyan-400 text-gray-950 hover:bg-cyan-300'
                  : 'pointer-events-none border border-gray-800 text-gray-600'
              }`}
            >
              Connect YouTube
            </a>
          )}
        </div>
      </div>
      {message && (
        <p className="mt-4 rounded-lg border border-red-800 bg-red-950/40 px-3 py-2 text-sm text-red-200">
          {message}
        </p>
      )}
    </section>
  );
}
