import crypto from 'crypto';
import { AGENT_SCOPES, type AgentScope } from '@/lib/automation/agentScopes';
export { AGENT_SCOPE_LABELS, AGENT_SCOPES, DEFAULT_AGENT_SCOPES, type AgentScope } from '@/lib/automation/agentScopes';

export const AGENT_KEY_PREFIX = 'ai_live';

export type AgentApiKeyRow = {
  id: string;
  account_id: string;
  created_by: string;
  name: string;
  token_hash: string;
  token_prefix: string;
  status: 'active' | 'revoked';
  scopes: AgentScope[];
  allowed_project_ids: string[] | null;
  expires_at: string | null;
  last_used_at: string | null;
  last_used_ip: string | null;
  last_used_user_agent: string | null;
  revoked_at: string | null;
  revoked_by: string | null;
  created_at: string;
  updated_at: string;
};

export type AgentApiKeyPublic = Omit<AgentApiKeyRow, 'token_hash'>;

export function hashAgentToken(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function createAgentToken() {
  const secret = crypto.randomBytes(32).toString('base64url');
  const token = `${AGENT_KEY_PREFIX}_${secret}`;
  return {
    token,
    tokenHash: hashAgentToken(token),
    tokenPrefix: token.slice(0, 18),
  };
}

export function cleanAgentScopes(raw: unknown): AgentScope[] {
  const allowed = new Set<string>(AGENT_SCOPES);
  const values = Array.isArray(raw) ? raw : [];
  const scopes = values.map(String).filter((scope): scope is AgentScope => allowed.has(scope));
  return [...new Set(scopes)];
}

export function publicAgentKey(row: AgentApiKeyRow): AgentApiKeyPublic {
  const { token_hash: _tokenHash, ...publicRow } = row;
  void _tokenHash;
  return publicRow;
}
