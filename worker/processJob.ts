import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { FREE_PLAN_GENERATION_MESSAGE } from '@/lib/planGuardrails';
import { runVideoPipeline } from '@/lib/generation/runVideoPipeline';
import type { SegmentData, VideoSettings } from '@/types';

type ProcessJobResult =
  | { ok: true; videoId: string; processed: true }
  | { ok: true; videoId: string; processed: false; reason: string }
  | { ok: false; videoId?: string; error: string };

function workerId() {
  return process.env.WORKER_ID ?? `worker-${process.pid}`;
}

function normalizeVideo(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    accountId: String(row.account_id),
    projectId: String(row.project_id),
    originalScript: String(row.original_script ?? ''),
    settings: row.settings as VideoSettings,
    segments: (Array.isArray(row.segments) ? row.segments : []) as SegmentData[],
  };
}

export async function claimVideoJob(videoId: string) {
  const supabase = createSupabaseAdminClient();
  if (!supabase) throw new Error('SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');

  const { data, error } = await supabase.rpc('claim_video_job', {
    p_video_id: videoId,
    p_worker_id: workerId(),
  });

  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : null;
  return row ? { supabase, video: normalizeVideo(row as Record<string, unknown>) } : null;
}

export async function claimNextVideoJob() {
  const supabase = createSupabaseAdminClient();
  if (!supabase) throw new Error('SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');

  const { data, error } = await supabase.rpc('claim_next_video_job', {
    p_worker_id: workerId(),
  });

  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : null;
  return row ? { supabase, video: normalizeVideo(row as Record<string, unknown>) } : null;
}

async function ensureAccountCanRun(supabase: NonNullable<ReturnType<typeof createSupabaseAdminClient>>, video: { id: string; accountId: string }) {
  const { data: account, error } = await supabase
    .from('accounts')
    .select('plan,status')
    .eq('id', video.accountId)
    .maybeSingle<{ plan: string; status: string }>();

  if (error) throw error;
  if (!account || account.status !== 'active') {
    throw new Error('Workspace is not active.');
  }
  if (String(account.plan ?? 'free').toLowerCase() === 'free') {
    throw new Error(FREE_PLAN_GENERATION_MESSAGE);
  }
}

async function markJobFailed(
  supabase: NonNullable<ReturnType<typeof createSupabaseAdminClient>>,
  videoId: string,
  message: string,
) {
  await supabase
    .from('videos')
    .update({
      status: 'failed',
      current_step: 'failed',
      error_message: message,
      last_worker_error: message,
      locked_at: null,
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', videoId);
}

export async function processClaimedJob(
  claimed: Awaited<ReturnType<typeof claimVideoJob>> | Awaited<ReturnType<typeof claimNextVideoJob>>,
): Promise<ProcessJobResult> {
  if (!claimed) {
    return { ok: true, videoId: '', processed: false, reason: 'No queued job claimed.' };
  }

  const { supabase, video } = claimed;

  try {
    await ensureAccountCanRun(supabase, video);
    await runVideoPipeline({
      supabase,
      userId: video.userId,
      accountId: video.accountId,
      projectId: video.projectId,
      videoId: video.id,
      segments: video.segments,
      settings: video.settings,
      originalScript: video.originalScript,
      onEvent: (event) => {
        if (event.type === 'step') console.log(`[worker] ${video.id}: ${event.step}`);
        if (event.type === 'render_progress') console.log(`[worker] ${video.id}: render ${event.progress}%`);
      },
    });

    return { ok: true, videoId: video.id, processed: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[worker] ${video.id} failed:`, message);
    await markJobFailed(supabase, video.id, message);
    return { ok: false, videoId: video.id, error: message };
  }
}

export async function processVideoJob(videoId: string) {
  return processClaimedJob(await claimVideoJob(videoId));
}

export async function processNextQueuedJob() {
  return processClaimedJob(await claimNextVideoJob());
}
