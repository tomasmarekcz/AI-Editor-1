import { brainstormVideoTopics } from '@/lib/brainstormVideoTopics';
import { requireAccountApi } from '@/lib/accounts';
import { enforceCostGuardrails } from '@/lib/safetyGuardrails';
import { enforcePaidPlan } from '@/lib/planGuardrails';
import type { Project } from '@/lib/projects/types';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: { projectId: string } }) {
  try {
    const { rejectedTopics } = (await req.json()) as {
      rejectedTopics?: string[];
    };

    const auth = await requireAccountApi();
    if (!auth.ok) return auth.response;
    const { supabase, account } = auth;

    const plan = enforcePaidPlan(account, 'projects/brainstorm-topics');
    if (!plan.ok) return plan.response;

    const safety = await enforceCostGuardrails(supabase, 'projects/brainstorm-topics');
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

    const since = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
    const { data: recentVideos } = await supabase
      .from('videos')
      .select('original_script,created_at')
      .eq('project_id', project.id)
      .eq('account_id', account.id)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(50);

    const topics = await brainstormVideoTopics({
      projectName: project.name,
      projectNiche: project.niche,
      projectLanguage: project.language,
      defaultProjectPrompt: project.default_project_prompt,
      recentScripts: (recentVideos ?? [])
        .map((video) => String(video.original_script ?? '').trim())
        .filter(Boolean),
      rejectedTopics: (rejectedTopics ?? []).map(String).filter(Boolean),
    });

    return Response.json({ topics });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[projects/brainstorm-topics]', message);
    return Response.json({ error: message }, { status: 500 });
  }
}
