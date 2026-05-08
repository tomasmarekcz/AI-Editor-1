import { requireAccountApi, requireOwner } from '@/lib/accounts';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const auth = await requireAccountApi();
    if (!auth.ok) return auth.response;
    const ownerError = requireOwner(auth.account);
    if (ownerError) return ownerError;

    const admin = createSupabaseAdminClient();
    if (!admin) return Response.json({ error: 'Supabase service role is not configured.' }, { status: 500 });

    const body = await req.json().catch(() => ({})) as { projectId?: string };
    const projectId = typeof body.projectId === 'string' ? body.projectId : '';
    if (!projectId) return Response.json({ error: 'projectId is required.' }, { status: 400 });

    const { data: project, error: projectError } = await auth.supabase
      .from('projects')
      .select('id')
      .eq('id', projectId)
      .eq('account_id', auth.account.id)
      .maybeSingle<{ id: string }>();
    if (projectError) return Response.json({ error: projectError.message }, { status: 500 });
    if (!project) return Response.json({ error: 'Project not found.' }, { status: 404 });

    const { data: connection } = await admin
      .from('social_connections')
      .select('id')
      .eq('account_id', auth.account.id)
      .eq('project_id', project.id)
      .eq('platform', 'youtube')
      .maybeSingle<{ id: string }>();

    if (connection?.id) {
      await admin.from('social_connection_tokens').delete().eq('connection_id', connection.id);
    }

    const { error } = await admin
      .from('social_connections')
      .update({
        status: 'revoked',
        disconnected_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('account_id', auth.account.id)
      .eq('project_id', project.id)
      .eq('platform', 'youtube');

    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[youtube/disconnect]', message);
    return Response.json({ error: message }, { status: 500 });
  }
}
