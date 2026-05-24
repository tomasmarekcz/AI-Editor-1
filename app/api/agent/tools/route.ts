import { requireAgentAutomationContext } from '@/lib/automation/agentAuth';
import { listMcpAutomationToolsForScopes } from '@/lib/automation/mcpAdapter';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const auth = await requireAgentAutomationContext(req);
  if (!auth.ok) return auth.response;

  return Response.json({
    tools: listMcpAutomationToolsForScopes(auth.ctx.agentScopes),
    agent: {
      id: auth.ctx.agentApiKeyId,
      name: auth.ctx.agentName,
      scopes: auth.ctx.agentScopes,
      allowedProjectIds: auth.ctx.allowedProjectIds,
    },
  });
}
