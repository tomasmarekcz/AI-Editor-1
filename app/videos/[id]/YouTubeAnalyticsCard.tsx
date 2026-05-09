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
  raw_analytics_api_response?: {
    skipped?: boolean;
    reason?: string | null;
    dailyViews?: { date: string; views: number }[];
    dateRange?: { startDate?: string; endDate?: string };
  } | null;
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

function getDailyViews(analytics: YouTubeAnalyticsView | null) {
  return analytics?.raw_analytics_api_response?.dailyViews ?? [];
}

function getPersistedAdvancedMessage(analytics: YouTubeAnalyticsView | null) {
  if (!analytics?.raw_analytics_api_response?.skipped) return '';
  return analytics.raw_analytics_api_response.reason || 'Advanced YouTube analytics are not available yet.';
}

function ViewsTrendChart({ points }: { points: { date: string; views: number }[] }) {
  const maxViews = Math.max(1, ...points.map((point) => point.views));
  const polyline = points.length > 0
    ? points.map((point, index) => {
        const x = points.length === 1 ? 50 : (index / (points.length - 1)) * 100;
        const y = 92 - (point.views / maxViews) * 78;
        return `${x},${y}`;
      }).join(' ')
    : '';

  return (
    <div className="mt-4 rounded-lg border border-gray-800 bg-gray-950 p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[10px] font-black uppercase tracking-[0.16em] text-gray-500">
          Views trend
        </p>
        <p className="text-xs font-bold text-gray-500">
          {points.length > 0 ? `${points[0].date} - ${points[points.length - 1].date}` : 'Daily data'}
        </p>
      </div>
      <div className="mt-3 h-36">
        {points.length > 0 ? (
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full overflow-visible">
            <line x1="0" y1="92" x2="100" y2="92" stroke="rgb(31 41 55)" strokeWidth="1" />
            <line x1="0" y1="53" x2="100" y2="53" stroke="rgb(31 41 55)" strokeWidth="0.7" />
            <line x1="0" y1="14" x2="100" y2="14" stroke="rgb(31 41 55)" strokeWidth="0.7" />
            <polyline
              points={polyline}
              fill="none"
              stroke="rgb(248 113 113)"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
            {points.map((point, index) => {
              const x = points.length === 1 ? 50 : (index / (points.length - 1)) * 100;
              const y = 92 - (point.views / maxViews) * 78;
              return (
                <circle
                  key={`${point.date}-${index}`}
                  cx={x}
                  cy={y}
                  r="1.8"
                  fill="rgb(254 202 202)"
                  vectorEffect="non-scaling-stroke"
                />
              );
            })}
          </svg>
        ) : (
          <div className="flex h-full items-center justify-center rounded border border-dashed border-gray-800 bg-gray-900 text-sm font-bold text-gray-600">
            Refresh analytics to load the daily views trend.
          </div>
        )}
      </div>
      {points.length > 0 && (
        <div className="mt-3 flex items-center justify-between text-xs text-gray-500">
          <span>{points[0].date}</span>
          <span className="font-bold text-gray-300">Peak {formatNumber(maxViews)} views/day</span>
          <span>{points[points.length - 1].date}</span>
        </div>
      )}
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
  const [advancedMessage, setAdvancedMessage] = useState(() => getPersistedAdvancedMessage(initialAnalytics));
  const hasAnalytics = Boolean(analytics?.synced_at);
  const buttonLabel = hasAnalytics ? 'Refresh analytics' : 'See analytics';
  const dailyViews = getDailyViews(analytics);

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

          <ViewsTrendChart points={dailyViews} />
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
