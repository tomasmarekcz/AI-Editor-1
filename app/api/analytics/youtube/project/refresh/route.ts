import { requireAccountApi } from '@/lib/accounts';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { decryptSecret } from '@/lib/integrations/tokenCrypto';
import {
  encryptedRefreshedAccessTokenRows,
  fetchYouTubeAnalyticsMetrics,
  fetchYouTubeChannelStatistics,
  fetchYouTubeVideoStats,
  refreshYouTubeAccessToken,
  YOUTUBE_ANALYTICS_SCOPE,
} from '@/lib/integrations/youtube';

export const dynamic = 'force-dynamic';

type RefreshRequest = {
  projectId?: string;
};

type PublishedPostRow = {
  id: string;
  account_id: string;
  project_id: string;
  video_id: string;
  connection_id: string;
  platform_post_id: string | null;
  platform_post_url: string | null;
  published_at: string | null;
  title: string | null;
};

type ConnectionRow = {
  id: string;
  status: string;
  scopes: string[] | null;
  platform_channel_title: string | null;
  platform_channel_url: string | null;
};

type TokenRow = {
  encrypted_refresh_token: string | null;
};

function dateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

function last90DaysRange() {
  const end = new Date();
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 90);
  return {
    startDate: dateOnly(start),
    endDate: dateOnly(end),
  };
}

function needsReconnectFromMessage(message: string) {
  return /permission|scope|forbidden|insufficient|unauthorized|access/i.test(message);
}

export async function POST(req: Request) {
  try {
    const auth = await requireAccountApi();
    if (!auth.ok) return auth.response;

    const body = await req.json().catch(() => ({})) as RefreshRequest;
    const projectId = body.projectId?.trim();
    if (!projectId) return Response.json({ error: 'projectId is required.' }, { status: 400 });

    const { data: project, error: projectError } = await auth.supabase
      .from('projects')
      .select('id,name')
      .eq('id', projectId)
      .eq('account_id', auth.account.id)
      .maybeSingle<{ id: string; name: string }>();

    if (projectError) return Response.json({ error: projectError.message }, { status: 500 });
    if (!project) return Response.json({ error: 'Project not found.' }, { status: 404 });

    const admin = createSupabaseAdminClient();
    if (!admin) return Response.json({ error: 'Supabase service role is not configured.' }, { status: 500 });

    const [{ data: connection }, { data: posts, error: postsError }] = await Promise.all([
      admin
        .from('social_connections')
        .select('id,status,scopes,platform_channel_title,platform_channel_url')
        .eq('account_id', auth.account.id)
        .eq('project_id', project.id)
        .eq('platform', 'youtube')
        .maybeSingle<ConnectionRow>(),
      admin
        .from('scheduled_posts')
        .select('id,account_id,project_id,video_id,connection_id,platform_post_id,platform_post_url,published_at,title')
        .eq('account_id', auth.account.id)
        .eq('project_id', project.id)
        .eq('platform', 'youtube')
        .eq('status', 'published')
        .not('platform_post_id', 'is', null)
        .order('published_at', { ascending: false, nullsFirst: false })
        .returns<PublishedPostRow[]>(),
    ]);

    if (postsError) return Response.json({ error: postsError.message }, { status: 500 });
    if (!connection || connection.status !== 'connected') {
      return Response.json({ error: 'YouTube is not connected for this project.' }, { status: 400 });
    }

    const { data: tokenRow } = await admin
      .from('social_connection_tokens')
      .select('encrypted_refresh_token')
      .eq('connection_id', connection.id)
      .maybeSingle<TokenRow>();

    if (!tokenRow?.encrypted_refresh_token) {
      return Response.json({ error: 'YouTube refresh token is missing. Reconnect YouTube and try again.' }, { status: 400 });
    }

    const refreshToken = decryptSecret(tokenRow.encrypted_refresh_token);
    const refreshed = await refreshYouTubeAccessToken(refreshToken);
    const accessToken = refreshed.access_token ?? '';

    await admin
      .from('social_connection_tokens')
      .update(encryptedRefreshedAccessTokenRows(refreshed))
      .eq('connection_id', connection.id);

    const { startDate, endDate } = last90DaysRange();
    const hasAnalyticsScope = (connection.scopes ?? []).includes(YOUTUBE_ANALYTICS_SCOPE);
    let advancedAnalyticsError: string | null = hasAnalyticsScope
      ? null
      : 'Advanced YouTube analytics require reconnecting YouTube with the analytics permission.';
    let needsReconnect = !hasAnalyticsScope;

    let channelStatistics = null;
    let channelStatisticsError: string | null = null;
    try {
      channelStatistics = await fetchYouTubeChannelStatistics(accessToken);
    } catch (err) {
      channelStatisticsError = err instanceof Error ? err.message : String(err);
    }

    const savedRows = [];
    for (const post of posts ?? []) {
      if (!post.platform_post_id) continue;

      const dataApiStats = await fetchYouTubeVideoStats(accessToken, post.platform_post_id);
      let analyticsApiMetrics = null;

      if (hasAnalyticsScope) {
        try {
          analyticsApiMetrics = await fetchYouTubeAnalyticsMetrics({
            accessToken,
            videoId: post.platform_post_id,
            startDate,
            endDate,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          advancedAnalyticsError ??= message;
          needsReconnect = needsReconnect || needsReconnectFromMessage(message);
        }
      }

      const now = new Date().toISOString();
      const analyticsPayload = {
        account_id: auth.account.id,
        video_id: post.video_id,
        scheduled_post_id: post.id,
        platform: 'youtube',
        platform_post_id: post.platform_post_id,
        views: Math.round(analyticsApiMetrics?.views ?? dataApiStats.views),
        likes: Math.round(analyticsApiMetrics?.likes ?? dataApiStats.likes),
        comments: Math.round(analyticsApiMetrics?.comments ?? dataApiStats.comments),
        shares: analyticsApiMetrics?.shares == null ? null : Math.round(analyticsApiMetrics.shares),
        watch_time_minutes: analyticsApiMetrics?.estimatedMinutesWatched ?? null,
        average_view_duration_seconds: analyticsApiMetrics?.averageViewDuration ?? null,
        average_view_percentage: analyticsApiMetrics?.averageViewPercentage ?? null,
        subscribers_gained: analyticsApiMetrics?.subscribersGained == null ? null : Math.round(analyticsApiMetrics.subscribersGained),
        subscribers_lost: analyticsApiMetrics?.subscribersLost == null ? null : Math.round(analyticsApiMetrics.subscribersLost),
        youtube_published_at: dataApiStats.publishedAt,
        youtube_title: dataApiStats.title,
        youtube_description: dataApiStats.description,
        youtube_thumbnail_url: dataApiStats.thumbnailUrl,
        privacy_status: dataApiStats.privacyStatus,
        raw_data_api_response: dataApiStats.raw,
        raw_analytics_api_response: analyticsApiMetrics?.raw ? {
          totals: analyticsApiMetrics.raw,
          dateRange: { startDate, endDate },
        } : {
          skipped: true,
          reason: advancedAnalyticsError,
          dateRange: { startDate, endDate },
        },
        synced_at: now,
        updated_at: now,
      };

      const { data: savedAnalytics, error: saveError } = await admin
        .from('social_post_analytics')
        .upsert(analyticsPayload, { onConflict: 'scheduled_post_id' })
        .select('*')
        .single<Record<string, unknown>>();

      if (saveError) return Response.json({ error: saveError.message }, { status: 500 });
      savedRows.push(savedAnalytics ?? analyticsPayload);
    }

    return Response.json({
      project: { id: project.id, name: project.name },
      channel: {
        title: connection.platform_channel_title,
        url: connection.platform_channel_url,
        subscriberCount: channelStatistics?.subscriberCount ?? null,
        hiddenSubscriberCount: channelStatistics?.hiddenSubscriberCount ?? false,
        statisticsError: channelStatisticsError,
      },
      analytics: savedRows,
      dateRange: { startDate, endDate },
      advancedAnalyticsError,
      needsReconnect,
      refreshedAt: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[analytics/youtube/project/refresh]', message);
    return Response.json({ error: message }, { status: 500 });
  }
}
