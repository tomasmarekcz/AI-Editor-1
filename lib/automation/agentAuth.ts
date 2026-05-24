import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import type { AutomationToolContext } from '@/lib/automation/videoTools';

export type AgentAuthResult =
  | { ok: true; ctx: AutomationToolContext }
  | { ok: false; response: Response };

function unauthorized(message = 'Unauthorized') {
  return Response.json({ error: message }, { status: 401 });
}

function unavailable(message: string) {
  return Response.json({ error: message }, { status: 503 });
}

function bearerToken(req: Request) {
  const header = req.headers.get('authorization') ?? '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? '';
}

export function requireAgentAutomationContext(req: Request): AgentAuthResult {
  const expectedToken = process.env.AGENT_API_TOKEN?.trim();
  if (!expectedToken) {
    return { ok: false, response: unavailable('AGENT_API_TOKEN is not configured.') };
  }

  const token = bearerToken(req);
  if (!token || token !== expectedToken) {
    return { ok: false, response: unauthorized() };
  }

  const accountId = process.env.AGENT_ACCOUNT_ID?.trim();
  const userId = process.env.AGENT_USER_ID?.trim();
  if (!accountId || !userId) {
    return {
      ok: false,
      response: unavailable('AGENT_ACCOUNT_ID and AGENT_USER_ID must be configured.'),
    };
  }

  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return {
      ok: false,
      response: unavailable('Supabase admin environment is not configured.'),
    };
  }

  return {
    ok: true,
    ctx: {
      supabase,
      accountId,
      userId,
    },
  };
}

