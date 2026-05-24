import { requireAgentAutomationContext } from '@/lib/automation/agentAuth';
import { listMcpAutomationTools } from '@/lib/automation/mcpAdapter';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const auth = requireAgentAutomationContext(req);
  if (!auth.ok) return auth.response;

  return Response.json({
    tools: listMcpAutomationTools(),
  });
}

