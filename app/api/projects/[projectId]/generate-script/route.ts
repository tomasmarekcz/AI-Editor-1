import { generateVideoScriptFromPrompt } from '@/lib/generateVideoScript';
import { requireAccountApi } from '@/lib/accounts';
import { enforceCostGuardrails } from '@/lib/safetyGuardrails';
import { enforcePaidPlan } from '@/lib/planGuardrails';
import type { Project } from '@/lib/projects/types';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: { projectId: string } }) {
  try {
    const { description, preferredLengthSeconds } = (await req.json()) as {
      description?: string;
      preferredLengthSeconds?: number;
    };

    const cleanDescription = description?.trim() ?? '';
    const length = Math.max(20, Math.min(60, Math.round(Number(preferredLengthSeconds) || 30)));

    if (!cleanDescription) {
      return Response.json({ error: 'description is required' }, { status: 400 });
    }

    const auth = await requireAccountApi();
    if (!auth.ok) return auth.response;
    const { supabase, account } = auth;

    const plan = enforcePaidPlan(account, 'projects/generate-script');
    if (!plan.ok) return plan.response;

    const safety = await enforceCostGuardrails(supabase, 'projects/generate-script');
    if (!safety.ok) return safety.response!;

    const { data: project } = await supabase
      .from('projects')
      .select('*')
      .eq('id', params.projectId)
      .eq('account_id', account.id)
      .maybeSingle<Project>();

    if (!project) {
      return Response.json({ error: 'Project not found' }, { status: 404 });
    }

    const result = await generateVideoScriptFromPrompt({
      description: cleanDescription,
      preferredLengthSeconds: length,
      project: {
        name: project.name,
        niche: project.niche,
        language: project.language,
        voiceStyle: project.voice_style,
        defaultProjectPrompt: project.default_project_prompt,
        defaultVisualPrompt: project.default_visual_prompt,
      },
    });

    return Response.json({
      script: result.script,
      costLine: result.costLine,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[projects/generate-script]', message);
    return Response.json({ error: message }, { status: 500 });
  }
}
