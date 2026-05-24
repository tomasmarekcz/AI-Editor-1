'use client';

import { useMemo, useState } from 'react';
import {
  AGENT_SCOPE_LABELS,
  DEFAULT_AGENT_SCOPES,
  type AgentScope,
} from '@/lib/automation/agentScopes';
import type { AgentApiKeyPublic } from '@/lib/automation/agentKeys';

export type AgentProjectView = {
  id: string;
  name: string;
};

type Props = {
  isOwner: boolean;
  projects: AgentProjectView[];
  agentKeys: AgentApiKeyPublic[];
};

const SCOPE_GROUPS: Array<{ title: string; scopes: AgentScope[] }> = [
  { title: 'Projects', scopes: ['projects:read', 'projects:update'] },
  { title: 'Ideas & scripts', scopes: ['topics:brainstorm', 'scripts:generate'] },
  { title: 'Videos', scopes: ['videos:read', 'videos:create', 'videos:edit', 'videos:render', 'videos:delete'] },
  { title: 'Assets & captions', scopes: ['assets:read', 'captions:generate', 'logs:read'] },
  { title: 'Publishing', scopes: ['publishing:read', 'publishing:schedule', 'publishing:cancel'] },
];

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleDateString() : 'Never';
}

function statusClass(status: string) {
  return status === 'active'
    ? 'bg-emerald-500/15 text-emerald-300'
    : 'bg-gray-800 text-gray-400';
}

export function AgentKeysPanel({ isOwner, projects, agentKeys: initialAgentKeys }: Props) {
  const [agentKeys, setAgentKeys] = useState(initialAgentKeys);
  const [name, setName] = useState('Content Agent');
  const [scopes, setScopes] = useState<AgentScope[]>(DEFAULT_AGENT_SCOPES);
  const [allowedProjectIds, setAllowedProjectIds] = useState<string[]>([]);
  const [allProjects, setAllProjects] = useState(true);
  const [expiresAt, setExpiresAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [newToken, setNewToken] = useState('');

  const activeKeys = useMemo(() => agentKeys.filter((key) => key.status === 'active'), [agentKeys]);

  function toggleScope(scope: AgentScope) {
    setScopes((current) => (
      current.includes(scope)
        ? current.filter((item) => item !== scope)
        : [...current, scope]
    ));
  }

  function toggleProject(projectId: string) {
    setAllowedProjectIds((current) => (
      current.includes(projectId)
        ? current.filter((id) => id !== projectId)
        : [...current, projectId]
    ));
  }

  async function createKey(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    setMessage('');
    setError('');
    setNewToken('');

    try {
      const res = await fetch('/api/account/agent-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          scopes,
          allowedProjectIds: allProjects ? [] : allowedProjectIds,
          expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
        }),
      });
      const data = await res.json() as {
        error?: string;
        agentKey?: AgentApiKeyPublic;
        token?: string;
      };
      if (!res.ok || data.error || !data.agentKey || !data.token) {
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      setAgentKeys((current) => [data.agentKey!, ...current]);
      setNewToken(data.token);
      setMessage('AI agent key created. Copy it now; it will not be shown again.');
      setName('Content Agent');
      setScopes(DEFAULT_AGENT_SCOPES);
      setAllowedProjectIds([]);
      setAllProjects(true);
      setExpiresAt('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create agent key.');
    } finally {
      setBusy(false);
    }
  }

  async function revokeKey(agentKeyId: string) {
    setMessage('');
    setError('');
    try {
      const res = await fetch('/api/account/agent-keys', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentKeyId }),
      });
      const data = await res.json() as { error?: string; agentKey?: AgentApiKeyPublic };
      if (!res.ok || data.error || !data.agentKey) throw new Error(data.error ?? `HTTP ${res.status}`);
      setAgentKeys((current) => current.map((key) => key.id === agentKeyId ? data.agentKey! : key));
      setMessage('AI agent key revoked.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not revoke agent key.');
    }
  }

  async function copyToken() {
    if (!newToken) return;
    await navigator.clipboard.writeText(newToken);
    setMessage('Token copied.');
  }

  return (
    <section className="mt-6 rounded-lg border border-gray-800 bg-gray-900/70 p-5">
      <div>
        <p className="text-xs uppercase tracking-[0.18em] text-gray-500">AI Agents</p>
        <h2 className="mt-1 text-2xl font-black tracking-normal">Agent access keys</h2>
      </div>

      {!isOwner ? (
        <p className="mt-4 rounded-lg border border-gray-800 bg-gray-950 px-3 py-2 text-sm text-gray-400">
          Only owners can create and revoke AI agent keys.
        </p>
      ) : (
        <form onSubmit={createKey} className="mt-5 space-y-5">
          <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Agent name"
              className="rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-white outline-none transition focus:border-cyan-400"
            />
            <input
              type="date"
              value={expiresAt}
              onChange={(event) => setExpiresAt(event.target.value)}
              className="rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-white outline-none transition focus:border-cyan-400"
            />
          </div>

          <div className="rounded-lg border border-gray-800 bg-gray-950 p-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-gray-500">Project access</p>
              <label className="flex items-center gap-2 text-xs font-bold text-gray-300">
                <input
                  type="checkbox"
                  checked={allProjects}
                  onChange={(event) => setAllProjects(event.target.checked)}
                  className="accent-cyan-400"
                />
                All projects
              </label>
            </div>
            {!allProjects && (
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {projects.map((project) => (
                  <label key={project.id} className="flex items-center gap-2 rounded-lg border border-gray-800 px-3 py-2 text-xs font-bold text-gray-300">
                    <input
                      type="checkbox"
                      checked={allowedProjectIds.includes(project.id)}
                      onChange={() => toggleProject(project.id)}
                      className="accent-cyan-400"
                    />
                    {project.name}
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="grid gap-3">
            {SCOPE_GROUPS.map((group) => (
              <div key={group.title} className="rounded-lg border border-gray-800 bg-gray-950 p-3">
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-gray-500">{group.title}</p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {group.scopes.map((scope) => (
                    <label key={scope} className="flex items-center gap-2 text-xs font-bold text-gray-300">
                      <input
                        type="checkbox"
                        checked={scopes.includes(scope)}
                        onChange={() => toggleScope(scope)}
                        className="accent-cyan-400"
                      />
                      {AGENT_SCOPE_LABELS[scope]}
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <button
            disabled={busy || !name.trim() || scopes.length === 0 || (!allProjects && allowedProjectIds.length === 0)}
            className="rounded-lg bg-cyan-400 px-4 py-2 text-sm font-black text-gray-950 transition hover:bg-cyan-300 disabled:opacity-40"
          >
            {busy ? 'Creating...' : 'Add AI Agent'}
          </button>
        </form>
      )}

      {newToken && (
        <div className="mt-5 rounded-lg border border-emerald-800 bg-emerald-950/30 p-3">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-300">New API key</p>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <code className="min-w-0 flex-1 overflow-x-auto rounded-lg bg-gray-950 px-3 py-2 text-xs text-emerald-100">
              {newToken}
            </code>
            <button onClick={copyToken} className="rounded-lg border border-emerald-700 px-3 py-2 text-xs font-bold text-emerald-100 transition hover:border-emerald-300">
              Copy
            </button>
          </div>
        </div>
      )}

      {message && <p className="mt-4 text-sm font-bold text-emerald-300">{message}</p>}
      {error && <p className="mt-4 text-sm font-bold text-red-300">{error}</p>}

      <div className="mt-5 divide-y divide-gray-800 rounded-lg border border-gray-800">
        {agentKeys.length === 0 ? (
          <p className="p-3 text-sm text-gray-500">No AI agent keys yet.</p>
        ) : (
          agentKeys.map((key) => (
            <div key={key.id} className="flex flex-col gap-3 p-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-bold text-white">{key.name}</p>
                    <span className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase ${statusClass(key.status)}`}>
                      {key.status}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-gray-500">
                    {key.token_prefix}... · created {formatDate(key.created_at)} · last used {formatDate(key.last_used_at)}
                  </p>
                  <p className="mt-1 text-xs text-gray-500">
                    Projects: {key.allowed_project_ids?.length ? key.allowed_project_ids.length : 'all'} · scopes: {key.scopes.length}
                  </p>
                </div>
                {isOwner && key.status === 'active' && (
                  <button onClick={() => revokeKey(key.id)} className="rounded-lg border border-red-900 px-3 py-2 text-xs font-bold text-red-200 transition hover:border-red-500">
                    Revoke
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-1">
                {key.scopes.map((scope) => (
                  <span key={scope} className="rounded bg-gray-800 px-2 py-1 text-[10px] font-bold text-gray-300">
                    {scope}
                  </span>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
