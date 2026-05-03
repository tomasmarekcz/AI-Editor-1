import { requireAccountApi } from '@/lib/accounts';
import { enforcePaidPlan } from '@/lib/planGuardrails';
import { enforceGenerationGuardrails } from '@/lib/safetyGuardrails';
import { triggerWorkerJob } from '@/lib/worker/trigger';
import { logWorkerEvent } from '@/lib/worker/log';

export const dynamic = 'force-dynamic';

const RETRYABLE_STATUSES = ['queued', 'failed'] as const;

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const auth = await requireAccountApi();
  if (!auth.ok) return auth.response;
  const { supabase, account } = auth;

  const plan = enforcePaidPlan(account, 'videos/retry-render');
  if (!plan.ok) return plan.response;

  const { data: video } = await supabase
    .from('videos')
    .select('id,status,project_id')
    .eq('id', params.id)
    .eq('account_id', account.id)
    .maybeSingle<{ id: string; status: string; project_id: string }>();

  if (!video) {
    return Response.json({ error: 'Video not found' }, { status: 404 });
  }

  if (!RETRYABLE_STATUSES.includes(video.status as (typeof RETRYABLE_STATUSES)[number])) {
    return Response.json({ error: `Video status "${video.status}" cannot be retried yet.` }, { status: 409 });
  }

  const safety = await enforceGenerationGuardrails(supabase, 'videos/retry-render', video.id);
  if (!safety.ok) return safety.response!;

  const queuedAt = new Date().toISOString();
  const { error } = await supabase
    .from('videos')
    .update({
      status: 'queued',
      current_step: 'queued',
      queued_at: queuedAt,
      processing_started_at: null,
      locked_at: null,
      worker_id: null,
      last_worker_error: null,
      error_message: null,
      completed_at: null,
      render_progress: 0,
      updated_at: queuedAt,
    })
    .eq('id', video.id)
    .eq('account_id', account.id);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  await logWorkerEvent({
    supabase,
    videoId: video.id,
    accountId: account.id,
    projectId: video.project_id,
    source: 'api-retry-render',
    event: 'queued',
    message: `Video render retry queued from status ${video.status}.`,
    metadata: { previousStatus: video.status },
  });

  const worker = await triggerWorkerJob(video.id);
  if (!worker.ok) {
    await supabase
      .from('videos')
      .update({
        last_worker_error: worker.message,
        updated_at: new Date().toISOString(),
      })
      .eq('id', video.id)
      .eq('account_id', account.id);
  }

  return Response.json({
    videoId: video.id,
    status: 'queued',
    workerTriggered: worker.ok,
    workerTriggerSkipped: worker.skipped,
    message: worker.ok
      ? 'Render retry queued and worker triggered.'
      : 'Render retry queued. Worker will pick it up shortly.',
    workerMessage: worker.message,
  });
}
