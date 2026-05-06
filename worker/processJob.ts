import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { FREE_PLAN_GENERATION_MESSAGE } from '@/lib/planGuardrails';
import { runVideoPipeline } from '@/lib/generation/runVideoPipeline';
import { logWorkerEvent } from '@/lib/worker/log';
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

function getRpcRow(data: unknown): Record<string, unknown> | null {
  if (Array.isArray(data)) {
    const first = data[0];
    return first && typeof first === 'object' ? first as Record<string, unknown> : null;
  }

  return data && typeof data === 'object' ? data as Record<string, unknown> : null;
}

async function fetchVideoSnapshot(
  supabase: NonNullable<ReturnType<typeof createSupabaseAdminClient>>,
  videoId: string,
) {
  const { data, error } = await supabase
    .from('videos')
    .select('id,status,current_step,queued_at,processing_started_at,worker_id,worker_attempts,last_worker_error,segments,settings,final_video_path')
    .eq('id', videoId)
    .maybeSingle();

  if (error) return { error: error.message };
  if (!data) return { missing: true };

  const row = data as Record<string, unknown>;
  return {
    id: row.id,
    status: row.status,
    current_step: row.current_step,
    queued_at: row.queued_at,
    processing_started_at: row.processing_started_at,
    worker_id: row.worker_id,
    worker_attempts: row.worker_attempts,
    last_worker_error: row.last_worker_error,
    segmentsCount: Array.isArray(row.segments) ? row.segments.length : null,
    hasSettings: Boolean(row.settings),
    final_video_path: row.final_video_path,
  };
}

export async function claimVideoJob(videoId: string) {
  const supabase = createSupabaseAdminClient();
  if (!supabase) throw new Error('SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');

  await logWorkerEvent({
    supabase,
    videoId,
    source: 'worker-claim',
    event: 'claim_attempt',
    message: 'Attempting to claim video job by id.',
    metadata: { workerId: workerId() },
  });

  const { data, error } = await supabase.rpc('claim_video_job', {
    p_video_id: videoId,
    p_worker_id: workerId(),
  });

  if (error) {
    await logWorkerEvent({
      supabase,
      videoId,
      source: 'worker-claim',
      event: 'claim_error',
      level: 'error',
      message: error.message,
      metadata: { error },
    });
    throw error;
  }
  const row = getRpcRow(data);
  const snapshot = row ? null : await fetchVideoSnapshot(supabase, videoId);
  await logWorkerEvent({
    supabase,
    videoId,
    accountId: row?.account_id ? String(row.account_id) : null,
    projectId: row?.project_id ? String(row.project_id) : null,
    source: 'worker-claim',
    event: row ? 'claimed' : 'not_claimed',
    level: row ? 'info' : 'warn',
    message: row ? 'Video job claimed.' : 'No queued video row was returned. Status is likely no longer queued.',
    metadata: {
      workerId: workerId(),
      rpcDataShape: Array.isArray(data) ? 'array' : typeof data,
      rpcRows: Array.isArray(data) ? data.length : data ? 1 : 0,
      snapshot,
    },
  });
  return row ? { supabase, video: normalizeVideo(row as Record<string, unknown>) } : null;
}

export async function claimNextVideoJob() {
  const supabase = createSupabaseAdminClient();
  if (!supabase) throw new Error('SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');

  await logWorkerEvent({
    supabase,
    source: 'worker-claim',
    event: 'claim_next_attempt',
    message: 'Attempting to claim next queued video job.',
    metadata: { workerId: workerId() },
  });

  const { data, error } = await supabase.rpc('claim_next_video_job', {
    p_worker_id: workerId(),
  });

  if (error) {
    await logWorkerEvent({
      supabase,
      source: 'worker-claim',
      event: 'claim_next_error',
      level: 'error',
      message: error.message,
      metadata: { error },
    });
    throw error;
  }
  const row = getRpcRow(data);
  await logWorkerEvent({
    supabase,
    videoId: row?.id ? String(row.id) : null,
    accountId: row?.account_id ? String(row.account_id) : null,
    projectId: row?.project_id ? String(row.project_id) : null,
    source: 'worker-claim',
    event: row ? 'claim_next_claimed' : 'claim_next_empty',
    message: row ? 'Next queued job claimed.' : 'No queued jobs available.',
    metadata: {
      workerId: workerId(),
      rpcDataShape: Array.isArray(data) ? 'array' : typeof data,
      rpcRows: Array.isArray(data) ? data.length : data ? 1 : 0,
    },
  });
  return row ? { supabase, video: normalizeVideo(row as Record<string, unknown>) } : null;
}

async function markJobNotClaimed(videoId: string, reason: string) {
  const supabase = createSupabaseAdminClient();
  if (!supabase) return;

  const snapshot = await fetchVideoSnapshot(supabase, videoId);
  await logWorkerEvent({
    supabase,
    videoId,
    source: 'worker-process',
    event: 'not_claimed_direct',
    level: 'warn',
    message: reason,
    metadata: { snapshot },
  });

  await supabase
    .from('videos')
    .update({
      last_worker_error: reason,
      updated_at: new Date().toISOString(),
    })
    .eq('id', videoId)
    .eq('status', 'queued');
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
    await logWorkerEvent({
      supabase,
      videoId: video.id,
      accountId: video.accountId,
      projectId: video.projectId,
      source: 'worker-process',
      event: 'start',
      message: 'Starting claimed video job.',
      metadata: {
        segments: video.segments.length,
        settingsKeys: Object.keys(video.settings ?? {}),
        settings: {
          ttsProvider: video.settings?.ttsProvider,
          voice: video.settings?.voice,
          voicePreset: video.settings?.voicePreset,
          speed: video.settings?.speed,
          hdQuality: video.settings?.hdQuality,
          geminiVoice: video.settings?.geminiVoice,
          geminiPreset: video.settings?.geminiPreset,
          orientation: video.settings?.orientation,
          imageSource: video.settings?.imageSource,
          enableEffects: video.settings?.enableEffects,
          subtitle: video.settings?.subtitle,
          segmentDuration: video.settings?.segmentDuration,
        },
      },
    });
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
        void logWorkerEvent({
          supabase,
          videoId: video.id,
          accountId: video.accountId,
          projectId: video.projectId,
          source: 'pipeline-event',
          event: event.type,
          message: event.type === 'step' ? event.message : undefined,
          metadata: event,
        });
      },
    });

    await logWorkerEvent({
      supabase,
      videoId: video.id,
      accountId: video.accountId,
      projectId: video.projectId,
      source: 'worker-process',
      event: 'done',
      message: 'Video job finished successfully.',
    });

    return { ok: true, videoId: video.id, processed: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[worker] ${video.id} failed:`, message);
    await logWorkerEvent({
      supabase,
      videoId: video.id,
      accountId: video.accountId,
      projectId: video.projectId,
      source: 'worker-process',
      event: 'failed',
      level: 'error',
      message,
      metadata: { err },
    });
    await markJobFailed(supabase, video.id, message);
    return { ok: false, videoId: video.id, error: message };
  }
}

export async function processVideoJob(videoId: string) {
  const claimed = await claimVideoJob(videoId);
  if (!claimed) {
    const reason = 'Worker could not claim this video. Check video status, claim_video_job RPC, and worker Supabase env.';
    await markJobNotClaimed(videoId, reason);
    return { ok: false, videoId, error: reason } satisfies ProcessJobResult;
  }
  return processClaimedJob(claimed);
}

export async function processNextQueuedJob() {
  return processClaimedJob(await claimNextVideoJob());
}
