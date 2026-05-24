import { requireAgentAutomationContext } from '@/lib/automation/agentAuth';
import { callMcpAutomationTool, getMcpAutomationTool } from '@/lib/automation/mcpAdapter';

export const dynamic = 'force-dynamic';
export const maxDuration = 600;

type AgentCallRequest = {
  name?: string;
  arguments?: Record<string, unknown>;
};

function errorResponse(message: string, status = 400, details?: Record<string, unknown>) {
  return Response.json({ error: message, ...(details ? { details } : {}) }, { status });
}

export async function POST(req: Request) {
  const auth = requireAgentAutomationContext(req);
  if (!auth.ok) return auth.response;

  const body = (await req.json().catch(() => null)) as AgentCallRequest | null;
  const name = body?.name?.trim() ?? '';
  if (!name) {
    return errorResponse('Tool name is required.');
  }

  const tool = getMcpAutomationTool(name);
  if (!tool) {
    return errorResponse(`Unknown automation tool: ${name}`, 404);
  }

  try {
    const result = await callMcpAutomationTool(auth.ctx, {
      name,
      arguments: body?.arguments ?? {},
    });

    return Response.json({
      tool: name,
      result,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[api/agent/call] ${name} failed:`, message);
    return errorResponse(message, 500, { tool: name });
  }
}

