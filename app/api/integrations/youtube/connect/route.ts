import { NextResponse } from 'next/server';
import { requireAccountApi, requireOwner } from '@/lib/accounts';
import { createYouTubeAuthorizationUrl, createYouTubeOAuthState } from '@/lib/integrations/youtube';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const auth = await requireAccountApi();
    if (!auth.ok) return auth.response;
    const ownerError = requireOwner(auth.account);
    if (ownerError) return ownerError;

    const projectId = new URL(req.url).searchParams.get('projectId') ?? '';
    if (!projectId) return Response.json({ error: 'projectId is required.' }, { status: 400 });

    const { data: project, error } = await auth.supabase
      .from('projects')
      .select('id')
      .eq('id', projectId)
      .eq('account_id', auth.account.id)
      .maybeSingle<{ id: string }>();

    if (error) return Response.json({ error: error.message }, { status: 500 });
    if (!project) return Response.json({ error: 'Project not found.' }, { status: 404 });

    const state = createYouTubeOAuthState(auth.account.id, auth.user.id, project.id);
    return NextResponse.redirect(createYouTubeAuthorizationUrl(state));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[youtube/connect]', message);
    return Response.json({ error: message }, { status: 500 });
  }
}
