import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { decryptSecret } from '@/lib/integrations/tokenCrypto';
import {
  encryptedRefreshedAccessTokenRows,
  refreshYouTubeAccessToken,
  uploadThumbnailToYouTube,
  uploadVideoToYouTube,
} from '@/lib/integrations/youtube';
import { downloadAssetBlob } from '@/lib/storage/videoAssets';
import { logWorkerEvent } from '@/lib/worker/log';

type ProcessScheduledPostResult =
  | { ok: true; postId: string; processed: true }
  | { ok: true; postId: ''; processed: false; reason: string }
  | { ok: false; postId?: string; error: string };

type ScheduledPostJob = {
  id: string;
  account_id: string;
  project_id: string;
  video_id: string;
  connection_id: string;
  platform: 'youtube';
  caption: string | null;
  title: string | null;
  description: string | null;
  privacy_status: 'private' | 'unlisted' | 'public';
  scheduled_for: string;
  video_storage_path: string;
  thumbnail_storage_path: string | null;
  attempts: number;
};

function workerId() {
  return process.env.WORKER_ID ?? `worker-${process.pid}`;
}

function getRpcRow(data: unknown): ScheduledPostJob | null {
  if (Array.isArray(data)) return (data[0] ?? null) as ScheduledPostJob | null;
  return (data ?? null) as ScheduledPostJob | null;
}

async function markPostFailed(
  supabase: NonNullable<ReturnType<typeof createSupabaseAdminClient>>,
  post: ScheduledPostJob,
  message: string,
  details?: Record<string, unknown>,
) {
  await supabase
    .from('scheduled_posts')
    .update({
      status: 'failed',
      locked_at: null,
      error_message: message,
      error_details: details ?? {},
      updated_at: new Date().toISOString(),
    })
    .eq('id', post.id);
}

async function markPostPublished(
  supabase: NonNullable<ReturnType<typeof createSupabaseAdminClient>>,
  post: ScheduledPostJob,
  result: { id: string; url: string },
  thumbnailError?: string,
) {
  await supabase
    .from('scheduled_posts')
    .update({
      status: 'published',
      locked_at: null,
      published_at: new Date().toISOString(),
      platform_post_id: result.id,
      platform_post_url: result.url,
      error_message: thumbnailError ? `Video published, but thumbnail upload failed: ${thumbnailError}` : null,
      error_details: thumbnailError ? { thumbnail: { status: 'failed', message: thumbnailError } } : {},
      updated_at: new Date().toISOString(),
    })
    .eq('id', post.id);
}

async function downloadStorageBlob(
  supabase: NonNullable<ReturnType<typeof createSupabaseAdminClient>>,
  storagePath: string,
) {
  const data = await downloadAssetBlob(supabase, storagePath);
  if (!data) throw new Error(`Storage asset not found: ${storagePath}`);
  return data;
}

function mimeTypeFromBlob(blob: Blob, fallback: string) {
  return blob.type || fallback;
}

async function claimNextScheduledPost() {
  const supabase = createSupabaseAdminClient();
  if (!supabase) throw new Error('SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');

  const { data, error } = await supabase.rpc('claim_next_scheduled_post', {
    p_worker_id: workerId(),
  });
  if (error) throw error;

  const post = getRpcRow(data);
  return post ? { supabase, post } : null;
}

export async function processNextScheduledPost(): Promise<ProcessScheduledPostResult> {
  const claimed = await claimNextScheduledPost();
  if (!claimed) return { ok: true, postId: '', processed: false, reason: 'No due scheduled post claimed.' };

  const { supabase, post } = claimed;

  try {
    await logWorkerEvent({
      supabase,
      videoId: post.video_id,
      accountId: post.account_id,
      projectId: post.project_id,
      source: 'youtube-publish',
      event: 'start',
      message: 'Starting scheduled YouTube upload.',
      metadata: {
        postId: post.id,
        scheduledFor: post.scheduled_for,
        attempts: post.attempts,
      },
    });

    const [{ data: account }, { data: connection }, { data: tokenRow }] = await Promise.all([
      supabase
        .from('accounts')
        .select('status')
        .eq('id', post.account_id)
        .maybeSingle<{ status: string }>(),
      supabase
        .from('social_connections')
        .select('id,status,platform_channel_id,platform_channel_title')
        .eq('id', post.connection_id)
        .eq('account_id', post.account_id)
        .eq('project_id', post.project_id)
        .eq('platform', 'youtube')
        .maybeSingle<{ id: string; status: string; platform_channel_id: string | null; platform_channel_title: string | null }>(),
      supabase
        .from('social_connection_tokens')
        .select('encrypted_refresh_token')
        .eq('connection_id', post.connection_id)
        .maybeSingle<{ encrypted_refresh_token: string }>(),
    ]);

    if (!account || account.status !== 'active') throw new Error('Workspace is not active.');
    if (!connection || connection.status !== 'connected') throw new Error('YouTube connection is not active.');
    if (!tokenRow?.encrypted_refresh_token) throw new Error('YouTube refresh token is missing.');

    const refreshToken = decryptSecret(tokenRow.encrypted_refresh_token);
    const refreshed = await refreshYouTubeAccessToken(refreshToken);
    const accessToken = refreshed.access_token ?? '';

    await supabase
      .from('social_connection_tokens')
      .update(encryptedRefreshedAccessTokenRows(refreshed))
      .eq('connection_id', post.connection_id);

    const videoBlob = await downloadStorageBlob(supabase, post.video_storage_path);
    const upload = await uploadVideoToYouTube({
      accessToken,
      video: videoBlob,
      mimeType: mimeTypeFromBlob(videoBlob, 'video/mp4'),
      title: post.title || 'Untitled video',
      description: post.description || post.caption || '',
      privacyStatus: post.privacy_status,
    });

    let thumbnailError: string | undefined;
    if (post.thumbnail_storage_path) {
      try {
        const thumbnailBlob = await downloadStorageBlob(supabase, post.thumbnail_storage_path);
        await uploadThumbnailToYouTube({
          accessToken,
          videoId: upload.id,
          image: thumbnailBlob,
          mimeType: mimeTypeFromBlob(thumbnailBlob, 'image/jpeg'),
        });
        await logWorkerEvent({
          supabase,
          videoId: post.video_id,
          accountId: post.account_id,
          projectId: post.project_id,
          source: 'youtube-publish',
          event: 'thumbnail_uploaded',
          message: 'YouTube thumbnail uploaded.',
          metadata: { postId: post.id, youtubeVideoId: upload.id, thumbnailStoragePath: post.thumbnail_storage_path },
        });
      } catch (thumbnailErr) {
        thumbnailError = thumbnailErr instanceof Error ? thumbnailErr.message : String(thumbnailErr);
        await logWorkerEvent({
          supabase,
          videoId: post.video_id,
          accountId: post.account_id,
          projectId: post.project_id,
          source: 'youtube-publish',
          event: 'thumbnail_failed',
          level: 'warn',
          message: thumbnailError,
          metadata: { postId: post.id, youtubeVideoId: upload.id, thumbnailStoragePath: post.thumbnail_storage_path },
        });
      }
    }

    await markPostPublished(supabase, post, upload, thumbnailError);
    await logWorkerEvent({
      supabase,
      videoId: post.video_id,
      accountId: post.account_id,
      projectId: post.project_id,
      source: 'youtube-publish',
      event: 'published',
      message: 'Scheduled YouTube upload finished.',
      metadata: {
        postId: post.id,
        youtubeVideoId: upload.id,
        url: upload.url,
      },
    });

    return { ok: true, postId: post.id, processed: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[youtube-publish] ${post.id} failed:`, message);
    await logWorkerEvent({
      supabase,
      videoId: post.video_id,
      accountId: post.account_id,
      projectId: post.project_id,
      source: 'youtube-publish',
      event: 'failed',
      level: 'error',
      message,
      metadata: { postId: post.id, err },
    });
    await markPostFailed(supabase, post, message, { error: message });
    return { ok: false, postId: post.id, error: message };
  }
}
