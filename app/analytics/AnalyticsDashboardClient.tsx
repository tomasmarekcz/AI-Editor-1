'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';

export type AnalyticsProject = {
  id: string;
  name: string;
  youtubeConnected: boolean;
  channelTitle: string | null;
};

export type AnalyticsVideo = {
  scheduledPostId: string;
  videoId: string;
  platformPostId: string | null;
  youtubeUrl: string | null;
  title: string;
  thumbnailUrl: string | null;
  publishedAt: string | null;
  views: number;
  likes: number;
  comments: number;
  syncedAt: string | null;
};

export type AnalyticsDashboardData = {
  selectedProjectId: string;
  selectedProjectName: string | null;
  youtubeConnected: boolean;
  channelTitle: string | null;
  channelUrl: string | null;
  hasAnalyticsScope: boolean;
  subscriberCount: number | null;
  hiddenSubscriberCount: boolean;
  lastSynced: string | null;
  videos: AnalyticsVideo[];
};

type RefreshAnalyticsRow = {
  scheduled_post_id?: string;
  video_id?: string;
  platform_post_id?: string;
  views?: number | null;
  likes?: number | null;
  comments?: number | null;
  youtube_published_at?: string | null;
  youtube_title?: string | null;
  youtube_thumbnail_url?: string | null;
  synced_at?: string | null;
};

type RefreshResponse = {
  channel?: {
    title?: string | null;
    url?: string | null;
    subscriberCount?: number | null;
    hiddenSubscriberCount?: boolean;
    statisticsError?: string | null;
  };
  analytics?: RefreshAnalyticsRow[];
  refreshedAt?: string;
  advancedAnalyticsError?: string | null;
  needsReconnect?: boolean;
  error?: string;
};

function formatNumber(value: number | null | undefined) {
  if (value == null) return '-';
  return new Intl.NumberFormat().format(value);
}

function formatDate(value: string | null | undefined) {
  if (!value) return '-';
  return new Date(value).toLocaleDateString();
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return '-';
  return new Date(value).toLocaleString();
}

async function readApiError(res: Response) {
  try {
    const data = await res.json() as { error?: string };
    return data.error ?? `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

function MetricCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900/75 p-4">
      <p className="text-[11px] font-black uppercase tracking-[0.16em] text-gray-500">{label}</p>
      <p className="mt-3 text-2xl font-black text-white">{value}</p>
      {hint && <p className="mt-2 text-xs leading-5 text-gray-500">{hint}</p>}
    </div>
  );
}

export function AnalyticsDashboardClient({
  projects,
  initialDashboard,
}: {
  projects: AnalyticsProject[];
  initialDashboard: AnalyticsDashboardData;
}) {
  const [dashboard, setDashboard] = useState(initialDashboard);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const totals = useMemo(() => {
    return dashboard.videos.reduce((acc, video) => ({
      views: acc.views + video.views,
      likes: acc.likes + video.likes,
      comments: acc.comments + video.comments,
    }), { views: 0, likes: 0, comments: 0 });
  }, [dashboard.videos]);

  function changeProject(projectId: string) {
    const url = projectId ? `/analytics?project=${projectId}` : '/analytics';
    window.location.assign(url);
  }

  async function refreshAnalytics() {
    if (isRefreshing || !dashboard.selectedProjectId) return;
    setIsRefreshing(true);
    setError('');
    setMessage('');

    try {
      const res = await fetch('/api/analytics/youtube/project/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: dashboard.selectedProjectId }),
      });
      if (!res.ok) throw new Error(await readApiError(res));
      const data = await res.json() as RefreshResponse;
      if (data.error) throw new Error(data.error);

      const analyticsByPostId = new Map(
        (data.analytics ?? [])
          .filter((row) => row.scheduled_post_id)
          .map((row) => [String(row.scheduled_post_id), row]),
      );

      setDashboard((current) => {
        const videos = current.videos
          .map((video) => {
            const analytics = analyticsByPostId.get(video.scheduledPostId);
            if (!analytics) return video;
            return {
              ...video,
              platformPostId: analytics.platform_post_id ?? video.platformPostId,
              title: analytics.youtube_title || video.title,
              thumbnailUrl: analytics.youtube_thumbnail_url ?? video.thumbnailUrl,
              publishedAt: analytics.youtube_published_at ?? video.publishedAt,
              views: Number(analytics.views ?? 0),
              likes: Number(analytics.likes ?? 0),
              comments: Number(analytics.comments ?? 0),
              syncedAt: analytics.synced_at ?? data.refreshedAt ?? new Date().toISOString(),
            };
          })
          .sort((a, b) => b.views - a.views);

        return {
          ...current,
          channelTitle: data.channel?.title ?? current.channelTitle,
          channelUrl: data.channel?.url ?? current.channelUrl,
          subscriberCount: data.channel?.subscriberCount ?? current.subscriberCount,
          hiddenSubscriberCount: Boolean(data.channel?.hiddenSubscriberCount ?? current.hiddenSubscriberCount),
          lastSynced: data.refreshedAt ?? new Date().toISOString(),
          videos,
        };
      });

      const notices = [];
      if (data.channel?.statisticsError) notices.push(`Channel statistics: ${data.channel.statisticsError}`);
      if (data.advancedAnalyticsError) notices.push(data.advancedAnalyticsError);
      if (data.needsReconnect && !data.advancedAnalyticsError) notices.push('Reconnect YouTube to enable advanced 90-day analytics.');
      setMessage(notices.length ? notices.join(' ') : 'Analytics refreshed.');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsRefreshing(false);
    }
  }

  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.28em] text-cyan-300">
            Analytics
          </p>
          <h1 className="mt-2 text-3xl font-black tracking-normal text-white">
            YouTube channel dashboard
          </h1>
          <p className="mt-2 text-sm leading-6 text-gray-400">
            {dashboard.channelTitle || dashboard.selectedProjectName || 'Select a project'}
          </p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="block min-w-[260px]">
            <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-gray-500">
              Project
            </span>
            <select
              value={dashboard.selectedProjectId}
              onChange={(event) => changeProject(event.target.value)}
              className="mt-2 w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white outline-none transition focus:border-cyan-400"
            >
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}{project.channelTitle ? ` · ${project.channelTitle}` : ''}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={refreshAnalytics}
            disabled={isRefreshing || !dashboard.selectedProjectId || !dashboard.youtubeConnected}
            className="rounded-lg bg-cyan-400 px-4 py-2 text-sm font-black text-gray-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:bg-gray-800 disabled:text-gray-600"
          >
            {isRefreshing ? 'Refreshing...' : 'Refresh analytics'}
          </button>
        </div>
      </div>

      {!dashboard.youtubeConnected && (
        <p className="mb-5 rounded-lg border border-amber-700 bg-amber-500/10 px-4 py-3 text-sm leading-6 text-amber-100">
          YouTube is not connected for this project. Connect it in Settings before refreshing analytics.
        </p>
      )}

      {dashboard.youtubeConnected && !dashboard.hasAnalyticsScope && (
        <p className="mb-5 rounded-lg border border-amber-700 bg-amber-500/10 px-4 py-3 text-sm leading-6 text-amber-100">
          This channel can still load public video stats, but reconnect YouTube to enable precise last-90-days analytics.
        </p>
      )}

      {error && (
        <p className="mb-5 rounded-lg border border-red-800 bg-red-950/40 px-4 py-3 text-sm text-red-200">
          {error}
        </p>
      )}

      {message && (
        <p className="mb-5 rounded-lg border border-cyan-900 bg-cyan-950/30 px-4 py-3 text-sm text-cyan-100">
          {message}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <MetricCard label="Views" value={formatNumber(totals.views)} hint="Last synced 90-day values when available." />
        <MetricCard label="Likes" value={formatNumber(totals.likes)} hint="For selected project/channel." />
        <MetricCard label="Comments" value={formatNumber(totals.comments)} hint="For selected project/channel." />
        <MetricCard
          label="Subscribers"
          value={dashboard.hiddenSubscriberCount ? 'Hidden' : formatNumber(dashboard.subscriberCount)}
          hint="Fetched live on manual refresh."
        />
        <MetricCard label="Last synced" value={formatDateTime(dashboard.lastSynced)} />
      </div>

      <section className="mt-6 rounded-lg border border-gray-800 bg-gray-900/70">
        <div className="flex flex-col gap-2 border-b border-gray-800 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-black uppercase tracking-[0.18em] text-gray-300">
              Best performing videos
            </h2>
            <p className="mt-1 text-xs text-gray-500">
              Ordered by views, highest first.
            </p>
          </div>
          {dashboard.channelUrl && (
            <a
              href={dashboard.channelUrl}
              target="_blank"
              rel="noreferrer"
              className="text-sm font-bold text-cyan-300 transition hover:text-cyan-100"
            >
              Open channel
            </a>
          )}
        </div>

        {dashboard.videos.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <p className="text-sm font-bold text-gray-300">No published YouTube videos yet.</p>
            <p className="mt-2 text-sm text-gray-500">
              Once this project publishes videos to YouTube, they will appear here.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] text-left text-sm">
              <thead className="border-b border-gray-800 text-[11px] uppercase tracking-[0.16em] text-gray-500">
                <tr>
                  <th className="px-4 py-3">Video</th>
                  <th className="px-4 py-3">Published</th>
                  <th className="px-4 py-3 text-right">Views</th>
                  <th className="px-4 py-3 text-right">Likes</th>
                  <th className="px-4 py-3 text-right">Comments</th>
                  <th className="px-4 py-3">Links</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {dashboard.videos.map((video) => (
                  <tr key={video.scheduledPostId} className="align-middle">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        {video.thumbnailUrl ? (
                          <img
                            src={video.thumbnailUrl}
                            alt=""
                            className="h-14 w-24 rounded border border-gray-800 bg-gray-950 object-cover"
                          />
                        ) : (
                          <div className="flex h-14 w-24 items-center justify-center rounded border border-dashed border-gray-800 bg-gray-950 text-xs font-bold text-gray-600">
                            No image
                          </div>
                        )}
                        <div className="min-w-0">
                          <p className="line-clamp-2 font-bold text-gray-100">{video.title}</p>
                          <p className="mt-1 text-xs text-gray-500">Synced {formatDateTime(video.syncedAt)}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-300">{formatDate(video.publishedAt)}</td>
                    <td className="px-4 py-3 text-right font-black text-white">{formatNumber(video.views)}</td>
                    <td className="px-4 py-3 text-right text-gray-300">{formatNumber(video.likes)}</td>
                    <td className="px-4 py-3 text-right text-gray-300">{formatNumber(video.comments)}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        {video.youtubeUrl && (
                          <a
                            href={video.youtubeUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded border border-gray-700 px-2 py-1 text-xs font-bold text-cyan-300 transition hover:border-cyan-400 hover:text-cyan-100"
                          >
                            YouTube
                          </a>
                        )}
                        <Link
                          href={`/videos/${video.videoId}`}
                          className="rounded border border-gray-700 px-2 py-1 text-xs font-bold text-gray-300 transition hover:border-gray-500 hover:text-white"
                        >
                          Detail
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
