import { requireAccountApi, requireOwner } from '@/lib/accounts';
import {
  cleanAgentScopes,
  createAgentToken,
  DEFAULT_AGENT_SCOPES,
  publicAgentKey,
  type AgentApiKeyRow,
} from '@/lib/automation/agentKeys';

export const dynamic = 'force-dynamic';

function cleanName(value: unknown) {
  return typeof value === 'string' ? value.trim().slice(0, 80) : '';
}

function cleanProjectIds(value: unknown) {
  if (!Array.isArray(value)) return null;
  const ids = value.map(String).map((id) => id.trim()).filter(Boolean);
  return ids.length > 0 ? [...new Set(ids)] : null;
}

function cleanExpiresAt(value: unknown) {
  if (!value) return null;
  if (typeof value !== 'string') throw new Error('expiresAt must be an ISO date string.');
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('expiresAt must be a valid date.');
  if (date.getTime() <= Date.now()) throw new Error('expiresAt must be in the future.');
  return date.toISOString();
}

async function ensureProjectAccess(auth: Extract<Awaited<ReturnType<typeof requireAccountApi>>, { ok: true }>, projectIds: string[] | null) {
  if (!projectIds?.length) return;
  const { data, error } = await auth.supabase
    .from('projects')
    .select('id')
    .eq('account_id', auth.account.id)
    .in('id', projectIds);

  if (error) throw error;
  const found = new Set((data ?? []).map((project) => String(project.id)));
  const missing = projectIds.filter((id) => !found.has(id));
  if (missing.length > 0) {
    throw new Error('One or more selected projects do not belong to this workspace.');
  }
}

export async function GET() {
  const auth = await requireAccountApi();
  if (!auth.ok) return auth.response;
  const ownerError = requireOwner(auth.account);
  if (ownerError) return ownerError;

  const { data, error } = await auth.supabase
    .from('agent_api_keys')
    .select('*')
    .eq('account_id', auth.account.id)
    .order('created_at', { ascending: false })
    .returns<AgentApiKeyRow[]>();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ agentKeys: (data ?? []).map(publicAgentKey) });
}

export async function POST(req: Request) {
  const auth = await requireAccountApi();
  if (!auth.ok) return auth.response;
  const ownerError = requireOwner(auth.account);
  if (ownerError) return ownerError;

  try {
    const body = (await req.json().catch(() => ({}))) as {
      name?: string;
      scopes?: string[];
      allowedProjectIds?: string[];
      expiresAt?: string | null;
    };

    const name = cleanName(body.name);
    if (!name) return Response.json({ error: 'Agent name is required.' }, { status: 400 });

    const scopes = cleanAgentScopes(body.scopes);
    const finalScopes = scopes.length > 0 ? scopes : DEFAULT_AGENT_SCOPES;
    const allowedProjectIds = cleanProjectIds(body.allowedProjectIds);
    await ensureProjectAccess(auth, allowedProjectIds);
    const expiresAt = cleanExpiresAt(body.expiresAt);
    const token = createAgentToken();

    const { data, error } = await auth.supabase
      .from('agent_api_keys')
      .insert({
        account_id: auth.account.id,
        created_by: auth.user.id,
        name,
        token_hash: token.tokenHash,
        token_prefix: token.tokenPrefix,
        scopes: finalScopes,
        allowed_project_ids: allowedProjectIds,
        expires_at: expiresAt,
      })
      .select('*')
      .single<AgentApiKeyRow>();

    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({
      agentKey: publicAgentKey(data),
      token: token.token,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(req: Request) {
  const auth = await requireAccountApi();
  if (!auth.ok) return auth.response;
  const ownerError = requireOwner(auth.account);
  if (ownerError) return ownerError;

  const { agentKeyId } = (await req.json().catch(() => ({}))) as { agentKeyId?: string };
  if (!agentKeyId) return Response.json({ error: 'agentKeyId is required.' }, { status: 400 });

  const { data, error } = await auth.supabase
    .from('agent_api_keys')
    .update({
      status: 'revoked',
      revoked_at: new Date().toISOString(),
      revoked_by: auth.user.id,
    })
    .eq('id', agentKeyId)
    .eq('account_id', auth.account.id)
    .select('*')
    .maybeSingle<AgentApiKeyRow>();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!data) return Response.json({ error: 'Agent key not found.' }, { status: 404 });
  return Response.json({ agentKey: publicAgentKey(data) });
}

