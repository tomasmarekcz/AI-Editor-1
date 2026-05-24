import { hashAgentToken, type AgentApiKeyRow } from '@/lib/automation/agentKeys';
import { requiredScopesForMcpAutomationTool } from '@/lib/automation/mcpAdapter';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import type { AutomationToolContext } from '@/lib/automation/videoTools';

export type AgentAuthContext = AutomationToolContext & {
  agentApiKeyId: string;
  agentName: string;
  agentScopes: string[];
  allowedProjectIds: string[] | null;
};

export type AgentAuthResult =
  | { ok: true; ctx: AgentAuthContext }
  | { ok: false; response: Response };

function unauthorized(message = 'Unauthorized') {
  return Response.json({ error: message }, { status: 401 });
}

function forbidden(message = 'Forbidden') {
  return Response.json({ error: message }, { status: 403 });
}

function unavailable(message: string) {
  return Response.json({ error: message }, { status: 503 });
}

function bearerToken(req: Request) {
  const header = req.headers.get('authorization') ?? '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? '';
}

export function requestIp(req: Request) {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || req.headers.get('x-real-ip')
    || null
  );
}

export function requestUserAgent(req: Request) {
  return req.headers.get('user-agent');
}

function normalizeAllowedProjects(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  return value.map(String).filter(Boolean);
}

export async function requireAgentAutomationContext(req: Request): Promise<AgentAuthResult> {
  const token = bearerToken(req);
  if (!token) return { ok: false, response: unauthorized() };

  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return {
      ok: false,
      response: unavailable('Supabase admin environment is not configured.'),
    };
  }

  const tokenHash = hashAgentToken(token);
  const { data: key, error } = await supabase
    .from('agent_api_keys')
    .select('*')
    .eq('token_hash', tokenHash)
    .eq('status', 'active')
    .maybeSingle<AgentApiKeyRow>();

  if (error) {
    console.error('[agent-auth] key lookup failed:', error.message);
    return { ok: false, response: unavailable('Agent key lookup failed.') };
  }
  if (!key) return { ok: false, response: unauthorized() };
  if (key.expires_at && new Date(key.expires_at).getTime() <= Date.now()) {
    return { ok: false, response: unauthorized('Agent key has expired.') };
  }

  const { data: account } = await supabase
    .from('accounts')
    .select('id,status')
    .eq('id', key.account_id)
    .maybeSingle<{ id: string; status: string }>();
  if (!account || account.status !== 'active') {
    return { ok: false, response: forbidden('Workspace is not active.') };
  }

  const lastUsed = {
    last_used_at: new Date().toISOString(),
    last_used_ip: requestIp(req),
    last_used_user_agent: requestUserAgent(req),
  };
  await supabase.from('agent_api_keys').update(lastUsed).eq('id', key.id);

  return {
    ok: true,
    ctx: {
      supabase,
      accountId: key.account_id,
      userId: key.created_by,
      agentApiKeyId: key.id,
      agentName: key.name,
      agentScopes: key.scopes ?? [],
      allowedProjectIds: normalizeAllowedProjects(key.allowed_project_ids),
    },
  };
}

function hasProjectAccess(ctx: AgentAuthContext, projectId: string | null) {
  if (!projectId) return true;
  if (!ctx.allowedProjectIds || ctx.allowedProjectIds.length === 0) return true;
  return ctx.allowedProjectIds.includes(projectId);
}

function stringArg(args: Record<string, unknown>, key: string) {
  const value = args[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

async function projectIdForVideo(ctx: AgentAuthContext, videoId: string) {
  const { data } = await ctx.supabase
    .from('videos')
    .select('project_id')
    .eq('id', videoId)
    .eq('account_id', ctx.accountId)
    .maybeSingle<{ project_id: string }>();
  return data?.project_id ?? null;
}

async function projectIdForScheduledPost(ctx: AgentAuthContext, scheduledPostId: string) {
  const { data } = await ctx.supabase
    .from('scheduled_posts')
    .select('project_id,video_id')
    .eq('id', scheduledPostId)
    .eq('account_id', ctx.accountId)
    .maybeSingle<{ project_id: string | null; video_id: string }>();
  return data?.project_id ?? (data?.video_id ? await projectIdForVideo(ctx, data.video_id) : null);
}

export async function assertAgentCanCallTool(
  ctx: AgentAuthContext,
  toolName: string,
  args: Record<string, unknown>,
) {
  const ownedScopes = new Set(ctx.agentScopes);
  const missingScopes = requiredScopesForMcpAutomationTool(toolName)
    .filter((scope) => !ownedScopes.has(scope));
  if (missingScopes.length > 0) {
    return {
      ok: false as const,
      response: forbidden(`Agent key is missing required scope(s): ${missingScopes.join(', ')}`),
    };
  }

  const directProjectId = stringArg(args, 'projectId');
  const videoId = stringArg(args, 'videoId');
  const scheduledPostId = stringArg(args, 'scheduledPostId');
  const resolvedProjectId = directProjectId
    ?? (videoId ? await projectIdForVideo(ctx, videoId) : null)
    ?? (scheduledPostId ? await projectIdForScheduledPost(ctx, scheduledPostId) : null);

  if (!hasProjectAccess(ctx, resolvedProjectId)) {
    return {
      ok: false as const,
      response: forbidden('Agent key does not have access to this project.'),
    };
  }

  return { ok: true as const, projectId: resolvedProjectId, videoId };
}

export async function logAgentToolEvent({
  ctx,
  toolName,
  success,
  errorMessage,
  projectId,
  videoId,
  requestMetadata,
  resultMetadata,
  req,
}: {
  ctx: AgentAuthContext;
  toolName: string;
  success: boolean;
  errorMessage?: string;
  projectId?: string | null;
  videoId?: string | null;
  requestMetadata?: Record<string, unknown>;
  resultMetadata?: Record<string, unknown>;
  req: Request;
}) {
  await ctx.supabase.from('agent_api_key_events').insert({
    account_id: ctx.accountId,
    agent_api_key_id: ctx.agentApiKeyId,
    tool_name: toolName,
    success,
    error_message: errorMessage ?? null,
    project_id: projectId ?? null,
    video_id: videoId ?? null,
    request_metadata: requestMetadata ?? {},
    result_metadata: resultMetadata ?? {},
    ip_address: requestIp(req),
    user_agent: requestUserAgent(req),
  });
}
