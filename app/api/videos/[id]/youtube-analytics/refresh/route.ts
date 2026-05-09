import { requireAccountApi } from '@/lib/accounts';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { decryptSecret } from '@/lib/integrations/tokenCrypto';
import {
  encryptedRefreshedAccessTokenRows,
  fetchYouTubeAnalyticsDailyViews,
  fetchYouTubeAnalyticsMetrics,
  fetchYouTubeVideoStats,
  refreshYouTubeAccessToken,
  YOUTUBE_ANALYTICS_SCOPE,
  youtubeAnalyticsDateRange,
} from '@/lib/integrations/youtube';

export const dynamic = 'force-dynamic';

type VideoRow = {
  id: string;
  account_id: string;
  project_id: string;
};

type PublishedYouTubePost = {
  id: string;
  account_id: string;
  project_id: string | null;
  video_id: string;
  connection_id: string;
  platform_post_id: string | null;
  platform_post_url: string | null;
};

type ConnectionRow = {
  id: string;
  account_id: string;
  project_id: string | null;
  status: string;
  scopes: string[] | null;
};

type TokenRow = {
  encrypted_refresh_token: string | null;
};

function readableAnalyticsPermissionMessage() {
  return 'Advanced YouTube analytics require reconnecting YouTube with the new analytics permission.';
}

function normalizedResponse({
  analytics,
  youtubeUrl,
  advancedAnalyticsError,
  needsReconnect,
}: {
  analytics: Record<string, unknown>;
  youtubeUrl: string | null;
  advancedAnalyticsError: string | null;
  needsReconnect: boolean;
}) {
  return {
    analytics,
    youtubeUrl,
    advancedAnalyticsError,
    needsReconnect,
  };
}

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  try {
    const auth = await requireAccountApi();
    if (!auth.ok) return auth.response;

    const { data: video, error: videoError } = await auth.supabase
      .from('videos')
      .select('id,account_id,project_id')
      .eq('id', params.id)
      .eq('account_id', auth.account.id)
      .maybeSingle<VideoRow>();

    if (videoError) return Response.json({ error: videoError.message }, { status: 500 });
    if (!video) return Response.json({ error: 'Video not found.' }, { status: 404 });

    const { data: post, error: postError } = await auth.supabase
      .from('scheduled_posts')
      .select('id,account_id,project_id,video_id,connection_id,platform_post_id,platform_post_url')
      .eq('account_id', auth.account.id)
      .eq('video_id', video.id)
      .eq('platform', 'youtube')
      .eq('status', 'published')
      .not('platform_post_id', 'is', null)
      .order('published_at', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle<PublishedYouTubePost>();

    if (postError) return Response.json({ error: postError.message }, { status: 500 });
    if (!post?.platform_post_id) {
      return Response.json({ error: 'This video has not been published to YouTube yet.' }, { status: 400 });
    }
    if (post.project_id !== video.project_id) {
      return Response.json({ error: 'Published YouTube post does not belong to this video project.' }, { status: 403 });
    }

    const admin = createSupabaseAdminClient();
    if (!admin) return Response.json({ error: 'Supabase service role is not configured.' }, { status: 500 });

    const [{ data: connection }, { data: tokenRow }] = await Promise.all([
      admin
        .from('social_connections')
        .select('id,account_id,project_id,status,scopes')
        .eq('id', post.connection_id)
        .eq('account_id', auth.account.id)
        .eq('project_id', video.project_id)
        .eq('platform', 'youtube')
        .maybeSingle<ConnectionRow>(),
      admin
        .from('social_connection_tokens')
        .select('encrypted_refresh_token')
        .eq('connection_id', post.connection_id)
        .maybeSingle<TokenRow>(),
    ]);

    if (!connection || connection.status !== 'connected') {
      return Response.json({ error: 'YouTube connection is not active for this project.' }, { status: 400 });
    }
    if (!tokenRow?.encrypted_refresh_token) {
      return Response.json({ error: 'YouTube refresh token is missing. Reconnect YouTube and try again.' }, { status: 400 });
    }

    const refreshToken = decryptSecret(tokenRow.encrypted_refresh_token);
    const refreshed = await refreshYouTubeAccessToken(refreshToken);
    const accessToken = refreshed.access_token ?? '';

    await admin
      .from('social_connection_tokens')
      .update(encryptedRefreshedAccessTokenRows(refreshed))
      .eq('connection_id', post.connection_id);

    const dataApiStats = await fetchYouTubeVideoStats(accessToken, post.platform_post_id);
    const hasAnalyticsScope = (connection.scopes ?? []).includes(YOUTUBE_ANALYTICS_SCOPE);
    let advancedAnalyticsError: string | null = null;
    let needsReconnect = false;
    let analyticsApiMetrics = null;
    let dailyViews = null;

    const { startDate, endDate } = youtubeAnalyticsDateRange(dataApiStats.publishedAt);
    try {
      const [metrics, trend] = await Promise.all([
        fetchYouTubeAnalyticsMetrics({
          accessToken,
          videoId: post.platform_post_id,
          startDate,
          endDate,
        }),
        fetchYouTubeAnalyticsDailyViews({
          accessToken,
          videoId: post.platform_post_id,
          startDate,
          endDate,
        }),
      ]);
      analyticsApiMetrics = metrics;
      dailyViews = trend;
    } catch (err) {
      advancedAnalyticsError = err instanceof Error ? err.message : String(err);
      needsReconnect = !hasAnalyticsScope || /permission|scope|forbidden|insufficient|unauthorized|access/i.test(advancedAnalyticsError);
    }

    if (needsReconnect && !advancedAnalyticsError) {
      advancedAnalyticsError = readableAnalyticsPermissionMessage();
    }

    const now = new Date().toISOString();
    const analyticsPayload = {
      account_id: auth.account.id,
      video_id: video.id,
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
        dailyViews: dailyViews?.points ?? [],
        dailyViewsRaw: dailyViews?.raw ?? {},
        dateRange: { startDate, endDate },
      } : {
        skipped: true,
        reason: advancedAnalyticsError,
        dailyViews: [],
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

    return Response.json(normalizedResponse({
      analytics: savedAnalytics ?? analyticsPayload,
      youtubeUrl: post.platform_post_url,
      advancedAnalyticsError,
      needsReconnect,
    }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[youtube-analytics/refresh]', message);
    return Response.json({ error: message }, { status: 500 });
  }
}
