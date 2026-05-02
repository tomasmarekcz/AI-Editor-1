import { estimateVideoCost, type CostLine } from '@/lib/pricing';
import { insertUsageEvents, summarizeCostLines } from '@/lib/usage/record';
import { requireAccountApi } from '@/lib/accounts';
import { enforceGenerationGuardrails } from '@/lib/safetyGuardrails';
import { enforcePaidPlan } from '@/lib/planGuardrails';
import type { SegmentData, VideoSettings } from '@/types';

export const dynamic = 'force-dynamic';

type RenderQueueRequest = {
  segments: SegmentData[];
  settings: VideoSettings;
  projectId?: string;
  originalScript?: string;
  videoId?: string;
  scriptGenerationCostLines?: CostLine[];
};

async function triggerWorker(videoId: string) {
  const workerUrl = process.env.WORKER_URL?.replace(/\/+$/, '');
  const workerSecret = process.env.WORKER_SECRET;

  if (!workerUrl || !workerSecret) {
    return {
      ok: false,
      skipped: true,
      message: 'WORKER_URL or WORKER_SECRET is not configured. Worker polling fallback will pick up the job.',
    };
  }

  try {
    const res = await fetch(`${workerUrl}/process-job`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${workerSecret}`,
      },
      body: JSON.stringify({ videoId }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return {
        ok: false,
        skipped: false,
        message: `Worker trigger failed with HTTP ${res.status}${body ? `: ${body.slice(0, 200)}` : ''}`,
      };
    }

    return { ok: true, skipped: false, message: null };
  } catch (err) {
    return {
      ok: false,
      skipped: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function POST(req: Request) {
  const { segments, settings, projectId, originalScript, videoId, scriptGenerationCostLines } =
    (await req.json()) as RenderQueueRequest;

  if (!segments?.length) {
    return Response.json({ error: 'segments required' }, { status: 400 });
  }

  if (!projectId) {
    return Response.json({ error: 'projectId required' }, { status: 400 });
  }

  const auth = await requireAccountApi();
  if (!auth.ok) return auth.response;
  const { supabase, user, account } = auth;

  const plan = enforcePaidPlan(account, 'render');
  if (!plan.ok) return plan.response;

  const safety = await enforceGenerationGuardrails(supabase, 'render', videoId);
  if (!safety.ok) return safety.response!;

  const { data: project } = await supabase
    .from('projects')
    .select('id,account_id')
    .eq('id', projectId)
    .eq('account_id', account.id)
    .maybeSingle();

  if (!project) {
    return Response.json({ error: 'Project not found' }, { status: 404 });
  }

  const script = originalScript ?? segments.map((segment) => segment.text).join('\n\n');
  const videoTitle = (script || segments[0]?.text || 'Untitled video')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 90) || 'Untitled video';

  let activeVideoId = videoId;
  let createdNewVideo = false;
  if (activeVideoId) {
    const { data: existing } = await supabase
      .from('videos')
      .select('id')
      .eq('id', activeVideoId)
      .eq('account_id', account.id)
      .eq('project_id', projectId)
      .maybeSingle();
    if (!existing) activeVideoId = undefined;
  }

  const safeScriptGenerationLines = (scriptGenerationCostLines ?? [])
    .filter((line) => line.step === 'script_generation')
    .slice(0, 1);
  const estimate = estimateVideoCost(script, settings, safeScriptGenerationLines);
  const queuedAt = new Date().toISOString();

  if (!activeVideoId) {
    const { data: video, error: videoError } = await supabase
      .from('videos')
      .insert({
        user_id: user.id,
        account_id: account.id,
        project_id: projectId,
        title: videoTitle,
        status: 'queued',
        current_step: 'queued',
        queued_at: queuedAt,
        original_script: script,
        settings,
        segments,
        render_progress: 0,
        estimated_cost_usd: estimate.totalUsd,
        estimated_usage: estimate.usage,
        cost_breakdown: { estimated: summarizeCostLines(estimate.lines) },
      })
      .select('id')
      .single();

    if (videoError || !video) {
      return Response.json({ error: videoError?.message ?? 'Could not create video record' }, { status: 500 });
    }
    activeVideoId = video.id;
    createdNewVideo = true;
  } else {
    await supabase
      .from('videos')
      .update({
        title: videoTitle,
        status: 'queued',
        current_step: 'queued',
        queued_at: queuedAt,
        processing_started_at: null,
        locked_at: null,
        worker_id: null,
        last_worker_error: null,
        original_script: script,
        settings,
        segments,
        render_progress: 0,
        error_message: null,
        estimated_cost_usd: estimate.totalUsd,
        estimated_usage: estimate.usage,
        cost_breakdown: { estimated: summarizeCostLines(estimate.lines) },
        updated_at: queuedAt,
      })
      .eq('id', activeVideoId)
      .eq('account_id', account.id);
  }

  const queuedVideoId = activeVideoId;
  if (!queuedVideoId) {
    return Response.json({ error: 'Could not resolve queued video id' }, { status: 500 });
  }

  if (createdNewVideo) {
    await insertUsageEvents({
      supabase,
      userId: user.id,
      accountId: account.id,
      projectId,
      videoId: queuedVideoId,
      lines: estimate.lines,
      estimated: true,
    });
  }

  const worker = await triggerWorker(queuedVideoId);

  return Response.json({
    videoId: queuedVideoId,
    status: 'queued',
    workerTriggered: worker.ok,
    workerTriggerSkipped: worker.skipped,
    message: worker.ok
      ? 'Job queued and worker triggered.'
      : 'Job queued. Worker will pick it up shortly.',
    workerMessage: worker.message,
    estimate,
  });
}
