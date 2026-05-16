import { estimateVideoCost, type CostLine } from '@/lib/pricing';
import { insertUsageEvents, summarizeCostLines } from '@/lib/usage/record';
import { requireAccountApi } from '@/lib/accounts';
import { enforceGenerationGuardrails } from '@/lib/safetyGuardrails';
import { enforcePaidPlan } from '@/lib/planGuardrails';
import type { VideoSettings } from '@/types';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const { projectId, script, settings, scriptGenerationCostLines } = (await req.json()) as {
    projectId?: string;
    script?: string;
    settings?: VideoSettings;
    scriptGenerationCostLines?: CostLine[];
  };

  if (!projectId || !script?.trim() || !settings) {
    return Response.json({ error: 'projectId, script and settings are required' }, { status: 400 });
  }

  const auth = await requireAccountApi();
  if (!auth.ok) return auth.response;
  const { supabase, user, account } = auth;

  const plan = enforcePaidPlan(account, 'videos/start');
  if (!plan.ok) return plan.response;

  const safety = await enforceGenerationGuardrails(supabase, 'videos/start');
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

  const safeScriptGenerationLines = (scriptGenerationCostLines ?? [])
    .filter((line) => line.step === 'script_generation')
    .slice(0, 1);
  const estimate = estimateVideoCost(script, settings, safeScriptGenerationLines);
  const title = script.replace(/\s+/g, ' ').trim().slice(0, 90) || 'Untitled video';

  const { data: video, error } = await supabase
    .from('videos')
    .insert({
      user_id: user.id,
      account_id: account.id,
      project_id: projectId,
      title,
      status: 'generating',
      current_step: 'script_saved',
      original_script: script,
      settings,
      estimated_cost_usd: estimate.totalUsd,
      estimated_usage: estimate.usage,
      cost_breakdown: { estimated: summarizeCostLines(estimate.lines) },
    })
    .select('id')
    .single();

  if (error || !video) {
    return Response.json({ error: error?.message ?? 'Could not create video' }, { status: 500 });
  }

  await insertUsageEvents({
    supabase,
    userId: user.id,
    accountId: account.id,
    projectId,
    videoId: video.id,
    lines: estimate.lines,
    estimated: true,
  });

  return Response.json({ videoId: video.id, estimate });
}
