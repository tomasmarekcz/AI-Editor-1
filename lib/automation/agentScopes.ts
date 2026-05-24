export const AGENT_SCOPES = [
  'projects:read',
  'projects:update',
  'topics:brainstorm',
  'scripts:generate',
  'videos:read',
  'videos:create',
  'videos:edit',
  'videos:render',
  'videos:delete',
  'assets:read',
  'captions:generate',
  'publishing:read',
  'publishing:schedule',
  'publishing:cancel',
  'logs:read',
] as const;

export type AgentScope = (typeof AGENT_SCOPES)[number];

export const AGENT_SCOPE_LABELS: Record<AgentScope, string> = {
  'projects:read': 'Read projects',
  'projects:update': 'Update project defaults',
  'topics:brainstorm': 'Brainstorm topics',
  'scripts:generate': 'Generate scripts',
  'videos:read': 'Read videos',
  'videos:create': 'Create videos',
  'videos:edit': 'Edit videos',
  'videos:render': 'Queue renders',
  'videos:delete': 'Delete videos',
  'assets:read': 'Read assets',
  'captions:generate': 'Generate captions',
  'publishing:read': 'Read publishing',
  'publishing:schedule': 'Schedule publishing',
  'publishing:cancel': 'Cancel publishing',
  'logs:read': 'Read logs',
};

export const DEFAULT_AGENT_SCOPES: AgentScope[] = [
  'projects:read',
  'topics:brainstorm',
  'scripts:generate',
  'videos:read',
  'videos:create',
  'videos:edit',
  'videos:render',
  'assets:read',
  'captions:generate',
  'publishing:read',
  'publishing:schedule',
  'logs:read',
];

