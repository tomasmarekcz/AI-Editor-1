import crypto from 'crypto';
import { encryptSecret } from '@/lib/integrations/tokenCrypto';

export const YOUTUBE_SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/yt-analytics.readonly',
];

export const YOUTUBE_ANALYTICS_SCOPE = 'https://www.googleapis.com/auth/yt-analytics.readonly';

type OAuthState = {
  accountId: string;
  userId: string;
  projectId: string;
  nonce: string;
  createdAt: number;
};

type GoogleTokenResponse = {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
};

type YouTubeChannelsResponse = {
  items?: {
    id?: string;
    snippet?: {
      title?: string;
      customUrl?: string;
      thumbnails?: Record<string, { url?: string }>;
    };
  }[];
  error?: {
    message?: string;
  };
};

type RefreshedTokenResponse = {
  access_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
};

type YouTubeVideoUploadResponse = {
  id?: string;
  error?: {
    message?: string;
    errors?: unknown[];
  };
};

type YouTubeVideoListResponse = {
  items?: {
    id?: string;
    snippet?: {
      publishedAt?: string;
      title?: string;
      description?: string;
      thumbnails?: Record<string, { url?: string; width?: number; height?: number }>;
    };
    statistics?: {
      viewCount?: string;
      likeCount?: string;
      commentCount?: string;
    };
    status?: {
      privacyStatus?: string;
    };
  }[];
  error?: {
    message?: string;
  };
};

export type YouTubeDataApiVideoStats = {
  raw: YouTubeVideoListResponse;
  publishedAt: string | null;
  title: string | null;
  description: string | null;
  thumbnailUrl: string | null;
  privacyStatus: string | null;
  views: number;
  likes: number;
  comments: number;
};

type YouTubeAnalyticsResponse = {
  columnHeaders?: {
    name?: string;
    columnType?: string;
    dataType?: string;
  }[];
  rows?: unknown[][];
  error?: {
    message?: string;
  };
};

export type YouTubeAnalyticsMetrics = {
  raw: YouTubeAnalyticsResponse;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  estimatedMinutesWatched: number | null;
  averageViewDuration: number | null;
  averageViewPercentage: number | null;
  subscribersGained: number | null;
  subscribersLost: number | null;
};

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set.`);
  return value;
}

function stateSecret() {
  return requiredEnv('GOOGLE_OAUTH_STATE_SECRET');
}

function signState(payload: string) {
  return crypto.createHmac('sha256', stateSecret()).update(payload).digest('base64url');
}

export function createYouTubeOAuthState(accountId: string, userId: string, projectId: string) {
  const state: OAuthState = {
    accountId,
    userId,
    projectId,
    nonce: crypto.randomBytes(16).toString('base64url'),
    createdAt: Date.now(),
  };
  const payload = Buffer.from(JSON.stringify(state), 'utf8').toString('base64url');
  return `${payload}.${signState(payload)}`;
}

export function verifyYouTubeOAuthState(rawState: string) {
  const [payload, signature] = rawState.split('.');
  if (!payload || !signature) throw new Error('Invalid OAuth state.');

  const expected = signState(payload);
  if (signature.length !== expected.length) throw new Error('Invalid OAuth state signature.');
  if (
    !crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expected),
    )
  ) {
    throw new Error('Invalid OAuth state signature.');
  }

  const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as OAuthState;
  if (!decoded.accountId || !decoded.userId || !decoded.projectId || !decoded.createdAt) throw new Error('Invalid OAuth state payload.');
  if (Date.now() - decoded.createdAt > 15 * 60 * 1000) throw new Error('OAuth state has expired.');
  return decoded;
}

export function getYouTubeRedirectUri() {
  return requiredEnv('YOUTUBE_REDIRECT_URI');
}

export function createYouTubeAuthorizationUrl(state: string) {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', requiredEnv('GOOGLE_CLIENT_ID'));
  url.searchParams.set('redirect_uri', getYouTubeRedirectUri());
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('include_granted_scopes', 'true');
  url.searchParams.set('scope', YOUTUBE_SCOPES.join(' '));
  url.searchParams.set('state', state);
  return url.toString();
}

export async function exchangeYouTubeCode(code: string) {
  const body = new URLSearchParams({
    code,
    client_id: requiredEnv('GOOGLE_CLIENT_ID'),
    client_secret: requiredEnv('GOOGLE_CLIENT_SECRET'),
    redirect_uri: getYouTubeRedirectUri(),
    grant_type: 'authorization_code',
  });

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = await res.json() as GoogleTokenResponse;
  if (!res.ok || data.error) {
    throw new Error(data.error_description ?? data.error ?? `Google token exchange failed with HTTP ${res.status}.`);
  }
  if (!data.access_token) throw new Error('Google did not return an access token.');
  if (!data.refresh_token) throw new Error('Google did not return a refresh token. Reconnect with consent to enable scheduled publishing.');
  return data;
}

export async function fetchYouTubeChannel(accessToken: string) {
  const url = new URL('https://www.googleapis.com/youtube/v3/channels');
  url.searchParams.set('part', 'snippet');
  url.searchParams.set('mine', 'true');

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json() as YouTubeChannelsResponse;
  if (!res.ok || data.error) {
    throw new Error(data.error?.message ?? `YouTube channel lookup failed with HTTP ${res.status}.`);
  }

  const channel = data.items?.[0];
  if (!channel?.id) throw new Error('No YouTube channel was found for this Google account.');
  const title = channel.snippet?.title ?? 'YouTube channel';
  return {
    id: channel.id,
    title,
    url: `https://www.youtube.com/channel/${channel.id}`,
  };
}

export function encryptedTokenRows(tokens: GoogleTokenResponse) {
  return {
    encrypted_refresh_token: encryptSecret(tokens.refresh_token ?? ''),
    encrypted_access_token: tokens.access_token ? encryptSecret(tokens.access_token) : null,
    access_token_expires_at: tokens.expires_in
      ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
      : null,
    token_type: tokens.token_type ?? null,
    updated_at: new Date().toISOString(),
  };
}

export async function refreshYouTubeAccessToken(refreshToken: string) {
  const body = new URLSearchParams({
    client_id: requiredEnv('GOOGLE_CLIENT_ID'),
    client_secret: requiredEnv('GOOGLE_CLIENT_SECRET'),
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = await res.json() as RefreshedTokenResponse;
  if (!res.ok || data.error) {
    throw new Error(data.error_description ?? data.error ?? `Google token refresh failed with HTTP ${res.status}.`);
  }
  if (!data.access_token) throw new Error('Google did not return a refreshed access token.');
  return data;
}

export function encryptedRefreshedAccessTokenRows(tokens: RefreshedTokenResponse) {
  return {
    encrypted_access_token: tokens.access_token ? encryptSecret(tokens.access_token) : null,
    access_token_expires_at: tokens.expires_in
      ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
      : null,
    token_type: tokens.token_type ?? null,
    updated_at: new Date().toISOString(),
  };
}

export async function uploadVideoToYouTube({
  accessToken,
  video,
  mimeType,
  title,
  description,
  privacyStatus,
}: {
  accessToken: string;
  video: Blob;
  mimeType: string;
  title: string;
  description: string;
  privacyStatus: 'private' | 'unlisted' | 'public';
}) {
  const metadata = {
    snippet: {
      title: title.slice(0, 100) || 'Untitled video',
      description,
      categoryId: '22',
    },
    status: {
      privacyStatus,
      selfDeclaredMadeForKids: false,
    },
  };

  const startUrl = new URL('https://www.googleapis.com/upload/youtube/v3/videos');
  startUrl.searchParams.set('uploadType', 'resumable');
  startUrl.searchParams.set('part', 'snippet,status');
  startUrl.searchParams.set('notifySubscribers', 'false');

  const startRes = await fetch(startUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': mimeType,
      'X-Upload-Content-Length': String(video.size),
    },
    body: JSON.stringify(metadata),
  });

  const uploadUrl = startRes.headers.get('location');
  if (!startRes.ok || !uploadUrl) {
    const body = await startRes.text();
    throw new Error(`YouTube upload session failed with HTTP ${startRes.status}: ${body.slice(0, 500)}`);
  }

  const uploadRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': mimeType,
      'Content-Length': String(video.size),
    },
    body: video,
  });
  const data = await uploadRes.json().catch(() => ({})) as YouTubeVideoUploadResponse;
  if (!uploadRes.ok || data.error) {
    throw new Error(data.error?.message ?? `YouTube video upload failed with HTTP ${uploadRes.status}.`);
  }
  if (!data.id) throw new Error('YouTube upload completed without a video id.');

  return {
    id: data.id,
    url: `https://www.youtube.com/watch?v=${data.id}`,
  };
}

export async function uploadThumbnailToYouTube({
  accessToken,
  videoId,
  image,
  mimeType,
}: {
  accessToken: string;
  videoId: string;
  image: Blob;
  mimeType: string;
}) {
  const url = new URL('https://www.googleapis.com/upload/youtube/v3/thumbnails/set');
  url.searchParams.set('uploadType', 'media');
  url.searchParams.set('videoId', videoId);

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': mimeType,
      'Content-Length': String(image.size),
    },
    body: image,
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`YouTube thumbnail upload failed with HTTP ${res.status}: ${body.slice(0, 500)}`);
  }
}

function numberFromUnknown(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function nullableNumberFromUnknown(value: unknown) {
  if (value == null) return null;
  const parsed = numberFromUnknown(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function bestThumbnailUrl(thumbnails?: Record<string, { url?: string; width?: number; height?: number }>) {
  if (!thumbnails) return null;
  const ranked = ['maxres', 'standard', 'high', 'medium', 'default'];
  for (const key of ranked) {
    const url = thumbnails[key]?.url;
    if (url) return url;
  }
  return Object.values(thumbnails).find((thumbnail) => thumbnail.url)?.url ?? null;
}

export async function fetchYouTubeVideoStats(accessToken: string, videoId: string): Promise<YouTubeDataApiVideoStats> {
  const url = new URL('https://www.googleapis.com/youtube/v3/videos');
  url.searchParams.set('part', 'statistics,snippet,status');
  url.searchParams.set('id', videoId);

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json() as YouTubeVideoListResponse;
  if (!res.ok || data.error) {
    throw new Error(data.error?.message ?? `YouTube video statistics lookup failed with HTTP ${res.status}.`);
  }

  const item = data.items?.[0];
  if (!item?.id) throw new Error('YouTube video was not found for analytics refresh.');

  return {
    raw: data,
    publishedAt: item.snippet?.publishedAt ?? null,
    title: item.snippet?.title ?? null,
    description: item.snippet?.description ?? null,
    thumbnailUrl: bestThumbnailUrl(item.snippet?.thumbnails),
    privacyStatus: item.status?.privacyStatus ?? null,
    views: numberFromUnknown(item.statistics?.viewCount),
    likes: numberFromUnknown(item.statistics?.likeCount),
    comments: numberFromUnknown(item.statistics?.commentCount),
  };
}

function dateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

export function youtubeAnalyticsDateRange(publishedAt?: string | null) {
  const end = new Date();
  const fallbackStart = new Date(end);
  fallbackStart.setUTCDate(fallbackStart.getUTCDate() - 28);

  const publishedDate = publishedAt ? new Date(publishedAt) : null;
  const start = publishedDate && !Number.isNaN(publishedDate.getTime()) && publishedDate < end
    ? publishedDate
    : fallbackStart;

  return {
    startDate: dateOnly(start),
    endDate: dateOnly(end),
  };
}

export async function fetchYouTubeAnalyticsMetrics({
  accessToken,
  videoId,
  startDate,
  endDate,
}: {
  accessToken: string;
  videoId: string;
  startDate: string;
  endDate: string;
}): Promise<YouTubeAnalyticsMetrics> {
  const metricNames = [
    'views',
    'likes',
    'comments',
    'shares',
    'estimatedMinutesWatched',
    'averageViewDuration',
    'averageViewPercentage',
    'subscribersGained',
    'subscribersLost',
  ];
  const url = new URL('https://youtubeanalytics.googleapis.com/v2/reports');
  url.searchParams.set('ids', 'channel==MINE');
  url.searchParams.set('startDate', startDate);
  url.searchParams.set('endDate', endDate);
  url.searchParams.set('metrics', metricNames.join(','));
  url.searchParams.set('filters', `video==${videoId}`);

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json() as YouTubeAnalyticsResponse;
  if (!res.ok || data.error) {
    throw new Error(data.error?.message ?? `YouTube Analytics lookup failed with HTTP ${res.status}.`);
  }

  const firstRow = data.rows?.[0] ?? [];
  const values = new Map<string, unknown>();
  data.columnHeaders?.forEach((header, index) => {
    if (header.name) values.set(header.name, firstRow[index]);
  });

  return {
    raw: data,
    views: nullableNumberFromUnknown(values.get('views')),
    likes: nullableNumberFromUnknown(values.get('likes')),
    comments: nullableNumberFromUnknown(values.get('comments')),
    shares: nullableNumberFromUnknown(values.get('shares')),
    estimatedMinutesWatched: nullableNumberFromUnknown(values.get('estimatedMinutesWatched')),
    averageViewDuration: nullableNumberFromUnknown(values.get('averageViewDuration')),
    averageViewPercentage: nullableNumberFromUnknown(values.get('averageViewPercentage')),
    subscribersGained: nullableNumberFromUnknown(values.get('subscribersGained')),
    subscribersLost: nullableNumberFromUnknown(values.get('subscribersLost')),
  };
}
