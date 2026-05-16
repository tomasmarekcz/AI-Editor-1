import { segmentScript } from '@/lib/segmentScript';
import { costOpenAIText } from '@/lib/pricing';
import { insertUsageEvents } from '@/lib/usage/record';
import { requireAccountApi } from '@/lib/accounts';
import { enforceCostGuardrails } from '@/lib/safetyGuardrails';
import { enforcePaidPlan } from '@/lib/planGuardrails';
import type { VideoSettings } from '@/types';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const { script, settings, chunkSize, segmentDuration, projectId, videoId } = (await req.json()) as {
      script: string;
      settings?: VideoSettings;
      chunkSize?: number;
      segmentDuration?: 'auto' | number;
      projectId?: string;
      videoId?: string;
    };
    if (!script?.trim()) {
      return Response.json({ error: 'Script is required' }, { status: 400 });
    }
    const auth = await requireAccountApi();
    if (!auth.ok) return auth.response;
    const { supabase, user, account } = auth;

    const plan = enforcePaidPlan(account, 'segment');
    if (!plan.ok) return plan.response;

    const safety = await enforceCostGuardrails(supabase, 'segment');
    if (!safety.ok) return safety.response!;

    const segments = await segmentScript(script, chunkSize ?? 3, segmentDuration ?? 'auto');
    if (projectId && videoId) {
      const { data: video } = await supabase
        .from('videos')
        .select('id')
        .eq('id', videoId)
        .eq('project_id', projectId)
        .eq('account_id', account.id)
        .maybeSingle();
      if (video) {
        const inputTokens = Math.ceil(script.length / 4) + 900;
        const outputTokens = Math.ceil(JSON.stringify(segments).length / 4);
        await insertUsageEvents({
          supabase,
          userId: user.id,
          accountId: account.id,
          projectId,
          videoId,
          estimated: false,
          lines: [{
            provider: 'openai',
            model: 'gpt-4o-mini',
            step: 'script_segmentation',
            usage: { estimatedInputTokens: inputTokens, estimatedOutputTokens: outputTokens, segments: segments.length },
            costUsd: costOpenAIText(inputTokens, outputTokens),
          }],
        });
        await supabase
          .from('videos')
          .update({
            original_script: script,
            settings: settings ?? undefined,
            segments,
            status: 'processing_images',
            current_step: 'script_segmented',
            updated_at: new Date().toISOString(),
          })
          .eq('id', videoId)
          .eq('account_id', account.id);
      } else {
        return Response.json({ error: 'Video not found' }, { status: 404 });
      }
    }
    return Response.json({ segments });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
