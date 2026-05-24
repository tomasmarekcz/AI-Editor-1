import {
  assertAgentCanCallTool,
  logAgentToolEvent,
  requireAgentAutomationContext,
} from '@/lib/automation/agentAuth';
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
  const auth = await requireAgentAutomationContext(req);
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

  const args = body?.arguments ?? {};
  const authorization = await assertAgentCanCallTool(auth.ctx, name, args);
  if (!authorization.ok) return authorization.response;

  try {
    const result = await callMcpAutomationTool(auth.ctx, {
      name,
      arguments: args,
    });

    await logAgentToolEvent({
      ctx: auth.ctx,
      toolName: name,
      success: true,
      projectId: authorization.projectId,
      videoId: authorization.videoId,
      requestMetadata: { arguments: args },
      resultMetadata: { resultType: typeof result },
      req,
    }).catch((logErr) => console.warn('[api/agent/call] event log failed:', logErr));

    return Response.json({
      tool: name,
      result,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[api/agent/call] ${name} failed:`, message);
    await logAgentToolEvent({
      ctx: auth.ctx,
      toolName: name,
      success: false,
      errorMessage: message,
      projectId: authorization.projectId,
      videoId: authorization.videoId,
      requestMetadata: { arguments: args },
      req,
    }).catch((logErr) => console.warn('[api/agent/call] event log failed:', logErr));
    return errorResponse(message, 500, { tool: name });
  }
}
