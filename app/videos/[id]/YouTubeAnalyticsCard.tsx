'use client';

import { useState } from 'react';

export type YouTubeAnalyticsView = {
  id?: string;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  watch_time_minutes: number | null;
  average_view_duration_seconds: number | null;
  average_view_percentage: number | null;
  subscribers_gained: number | null;
  subscribers_lost: number | null;
  youtube_published_at: string | null;
  youtube_title: string | null;
  youtube_thumbnail_url: string | null;
  privacy_status: string | null;
  synced_at: string | null;
};

export type PublishedYouTubePostView = {
  id: string;
  platform_post_url: string | null;
  platform_post_id: string | null;
};

type RefreshResponse = {
  analytics?: YouTubeAnalyticsView;
  youtubeUrl?: string | null;
  advancedAnalyticsError?: string | null;
  needsReconnect?: boolean;
  error?: string;
};

function formatNumber(value: number | null | undefined) {
  if (value == null) return '-';
  return new Intl.NumberFormat().format(value);
}

function formatDecimal(value: number | null | undefined, digits = 1) {
  if (value == null) return '-';
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: digits,
  }).format(value);
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

function Metric({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-950 px-3 py-3">
      <p className="text-[10px] font-black uppercase tracking-[0.16em] text-gray-500">{label}</p>
      <p className="mt-2 text-xl font-black text-white">{value}</p>
    </div>
  );
}

export function YouTubeAnalyticsCard({
  videoId,
  publishedPost,
  initialAnalytics,
}: {
  videoId: string;
  publishedPost: PublishedYouTubePostView;
  initialAnalytics: YouTubeAnalyticsView | null;
}) {
  const [analytics, setAnalytics] = useState<YouTubeAnalyticsView | null>(initialAnalytics);
  const [youtubeUrl, setYoutubeUrl] = useState(publishedPost.platform_post_url);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [advancedMessage, setAdvancedMessage] = useState('');
  const hasAnalytics = Boolean(analytics?.synced_at);
  const buttonLabel = hasAnalytics ? 'Refresh analytics' : 'See analytics';

  async function refreshAnalytics() {
    if (isRefreshing) return;
    setIsRefreshing(true);
    setError('');
    setAdvancedMessage('');
    try {
      const res = await fetch(`/api/videos/${videoId}/youtube-analytics/refresh`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error(await readApiError(res));
      const data = await res.json() as RefreshResponse;
      if (data.error) throw new Error(data.error);
      if (data.analytics) setAnalytics(data.analytics);
      if (data.youtubeUrl !== undefined) setYoutubeUrl(data.youtubeUrl);
      if (data.advancedAnalyticsError) setAdvancedMessage(data.advancedAnalyticsError);
      else if (data.needsReconnect) setAdvancedMessage('Advanced YouTube analytics require reconnecting YouTube.');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsRefreshing(false);
    }
  }

  return (
    <section className="mt-6 rounded-lg border border-gray-800 bg-gray-900/70 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-red-300">
            YouTube Analytics
          </p>
          <h2 className="mt-2 text-lg font-black text-white">
            {analytics?.youtube_title || 'Published YouTube video'}
          </h2>
          <p className="mt-2 text-sm text-gray-400">
            Last synced: {formatDateTime(analytics?.synced_at)}
          </p>
        </div>
        <button
          type="button"
          onClick={refreshAnalytics}
          disabled={isRefreshing}
          className="rounded-lg bg-red-400 px-4 py-2 text-sm font-black text-gray-950 transition hover:bg-red-300 disabled:cursor-not-allowed disabled:bg-gray-800 disabled:text-gray-600"
        >
          {isRefreshing ? 'Refreshing...' : buttonLabel}
        </button>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[0.75fr_1.25fr]">
        <div className="rounded-lg border border-gray-800 bg-gray-950 p-3">
          {analytics?.youtube_thumbnail_url ? (
            <img
              src={analytics.youtube_thumbnail_url}
              alt=""
              className="aspect-video w-full rounded object-cover"
            />
          ) : (
            <div className="flex aspect-video w-full items-center justify-center rounded border border-dashed border-gray-800 bg-gray-900 text-sm font-bold text-gray-600">
              Analytics preview
            </div>
          )}
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
            <div>
              <p className="font-black uppercase tracking-[0.14em] text-gray-500">Published</p>
              <p className="mt-1 text-gray-300">{formatDateTime(analytics?.youtube_published_at)}</p>
            </div>
            <div>
              <p className="font-black uppercase tracking-[0.14em] text-gray-500">Privacy</p>
              <p className="mt-1 capitalize text-gray-300">{analytics?.privacy_status ?? '-'}</p>
            </div>
          </div>
          {youtubeUrl && (
            <a
              href={youtubeUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-flex text-sm font-bold text-cyan-300 transition hover:text-cyan-100"
            >
              Open on YouTube
            </a>
          )}
        </div>

        <div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Metric label="Views" value={formatNumber(analytics?.views)} />
            <Metric label="Likes" value={formatNumber(analytics?.likes)} />
            <Metric label="Comments" value={formatNumber(analytics?.comments)} />
            <Metric label="Shares" value={formatNumber(analytics?.shares)} />
            <Metric label="Watch time" value={`${formatDecimal(analytics?.watch_time_minutes)} min`} />
            <Metric label="Avg duration" value={`${formatDecimal(analytics?.average_view_duration_seconds)} sec`} />
            <Metric label="Avg viewed" value={`${formatDecimal(analytics?.average_view_percentage)}%`} />
            <Metric label="Subs gained" value={formatNumber(analytics?.subscribers_gained)} />
            <Metric label="Subs lost" value={formatNumber(analytics?.subscribers_lost)} />
          </div>

          <div className="mt-4 rounded-lg border border-gray-800 bg-gray-950 p-3">
            <div className="flex h-16 items-end gap-2">
              {[analytics?.views, analytics?.likes, analytics?.comments, analytics?.shares].map((value, index) => {
                const numericValue = value ?? 0;
                const maxValue = Math.max(1, analytics?.views ?? 0);
                const height = Math.max(10, Math.round((numericValue / maxValue) * 64));
                return (
                  <div
                    key={index}
                    className="w-full rounded-t bg-red-400/80"
                    style={{ height }}
                  />
                );
              })}
            </div>
            <div className="mt-2 grid grid-cols-4 text-center text-[10px] font-black uppercase tracking-[0.12em] text-gray-500">
              <span>Views</span>
              <span>Likes</span>
              <span>Comments</span>
              <span>Shares</span>
            </div>
          </div>
        </div>
      </div>

      {advancedMessage && (
        <p className="mt-4 rounded-lg border border-amber-700 bg-amber-500/10 px-3 py-2 text-sm leading-6 text-amber-100">
          {advancedMessage}
        </p>
      )}
      {error && (
        <p className="mt-4 rounded-lg border border-red-800 bg-red-950/40 px-3 py-2 text-sm text-red-200">
          {error}
        </p>
      )}
    </section>
  );
}
