'use client';

import { useState } from 'react';

export type YouTubeConnectionView = {
  id: string;
  project_id: string | null;
  status: string;
  platform_channel_title: string | null;
  platform_channel_url: string | null;
  last_verified_at: string | null;
  disconnected_at: string | null;
  scopes: string[] | null;
};

export type IntegrationProjectView = {
  id: string;
  name: string;
};

async function readApiError(res: Response) {
  try {
    const data = await res.json() as { error?: string };
    return data.error ?? `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

const YOUTUBE_ANALYTICS_SCOPE = 'https://www.googleapis.com/auth/yt-analytics.readonly';

export function YouTubeIntegrationPanel({
  isOwner,
  projects,
  connections,
}: {
  isOwner: boolean;
  projects: IntegrationProjectView[];
  connections: YouTubeConnectionView[];
}) {
  const [selectedProjectId, setSelectedProjectId] = useState(projects[0]?.id ?? '');
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [message, setMessage] = useState('');
  const selectedProject = projects.find((project) => project.id === selectedProjectId) ?? null;
  const connection = connections.find((item) => item.project_id === selectedProjectId && item.status === 'connected') ?? null;
  const isConnected = connection?.status === 'connected';
  const needsAnalyticsReconnect = isConnected && !(connection.scopes ?? []).includes(YOUTUBE_ANALYTICS_SCOPE);

  async function disconnect() {
    if (!isOwner || isDisconnecting || !selectedProjectId) return;
    setIsDisconnecting(true);
    setMessage('');
    try {
      const res = await fetch('/api/integrations/youtube/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: selectedProjectId }),
      });
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
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.22em] text-gray-400">Project settings</p>
          <h2 className="mt-2 text-xl font-black text-white">Publishing integrations</h2>
          <p className="mt-2 text-sm leading-6 text-gray-400">
            Each project can use its own YouTube, Instagram, and TikTok account.
          </p>
        </div>
        <label className="block sm:min-w-64">
          <span className="text-xs font-bold uppercase tracking-[0.18em] text-gray-500">Project</span>
          <select
            value={selectedProjectId}
            onChange={(event) => {
              setSelectedProjectId(event.target.value);
              setMessage('');
            }}
            className="mt-2 w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm font-bold text-white outline-none transition focus:border-cyan-400"
          >
            {projects.map((project) => (
              <option key={project.id} value={project.id}>{project.name}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid gap-3">
        <div className="rounded-lg border border-gray-800 bg-gray-950 p-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h3 className="text-sm font-black text-white">YouTube Shorts</h3>
              <p className="mt-2 text-sm leading-6 text-gray-400">
                {isConnected
                  ? `Connected to ${connection?.platform_channel_title ?? 'YouTube channel'} for ${selectedProject?.name ?? 'this project'}.`
                  : `Connect a YouTube channel for ${selectedProject?.name ?? 'this project'}.`}
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
              {needsAnalyticsReconnect && (
                <p className="mt-3 rounded-lg border border-amber-700 bg-amber-500/10 px-3 py-2 text-sm leading-6 text-amber-100">
                  Advanced YouTube analytics need one new permission. Reconnect YouTube to enable watch time, average view duration, shares, and subscriber metrics.
                </p>
              )}
              {!isOwner && (
                <p className="mt-3 text-xs text-gray-500">
                  Only workspace owners can connect or disconnect project integrations.
                </p>
              )}
            </div>

            <div className="flex shrink-0 flex-col gap-2 sm:min-w-44">
              {isConnected ? (
                <>
                  {needsAnalyticsReconnect && (
                    <a
                      href={isOwner && selectedProjectId ? `/api/integrations/youtube/connect?projectId=${selectedProjectId}` : '#'}
                      aria-disabled={!isOwner || !selectedProjectId}
                      className={`rounded-lg px-4 py-2 text-center text-sm font-black transition ${
                        isOwner && selectedProjectId
                          ? 'bg-amber-300 text-gray-950 hover:bg-amber-200'
                          : 'pointer-events-none border border-gray-800 text-gray-600'
                      }`}
                    >
                      Reconnect YouTube
                    </a>
                  )}
                  <button
                    type="button"
                    onClick={disconnect}
                    disabled={!isOwner || isDisconnecting}
                    className="rounded-lg border border-red-800 bg-red-500/10 px-4 py-2 text-sm font-black text-red-200 transition hover:border-red-500 hover:text-white disabled:cursor-not-allowed disabled:border-gray-800 disabled:text-gray-600"
                  >
                    {isDisconnecting ? 'Disconnecting...' : 'Disconnect'}
                  </button>
                </>
              ) : (
                <a
                  href={isOwner && selectedProjectId ? `/api/integrations/youtube/connect?projectId=${selectedProjectId}` : '#'}
                  aria-disabled={!isOwner || !selectedProjectId}
                  className={`rounded-lg px-4 py-2 text-center text-sm font-black transition ${
                    isOwner && selectedProjectId
                      ? 'bg-cyan-400 text-gray-950 hover:bg-cyan-300'
                      : 'pointer-events-none border border-gray-800 text-gray-600'
                  }`}
                >
                  Connect YouTube
                </a>
              )}
            </div>
          </div>
        </div>

        {['Instagram Reels', 'TikTok'].map((label) => (
          <div key={label} className="flex items-center justify-between rounded-lg border border-gray-800 bg-gray-950 p-4 opacity-55">
            <div>
              <h3 className="text-sm font-black text-white">{label}</h3>
              <p className="mt-1 text-xs text-gray-500">Project-level integration placeholder.</p>
            </div>
            <span className="rounded border border-gray-800 px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-gray-500">
              Soon
            </span>
          </div>
        ))}
      </div>

      {message && (
        <p className="mt-4 rounded-lg border border-red-800 bg-red-950/40 px-3 py-2 text-sm text-red-200">
          {message}
        </p>
      )}
    </section>
  );
}
