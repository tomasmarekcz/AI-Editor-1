create table if not exists public.agent_api_keys (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete restrict,
  name text not null,
  token_hash text not null unique,
  token_prefix text not null,
  status text not null default 'active'
    check (status in ('active', 'revoked')),
  scopes text[] not null default '{}'
    check (
      scopes <@ array[
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
        'logs:read'
      ]::text[]
    ),
  allowed_project_ids uuid[],
  expires_at timestamptz,
  last_used_at timestamptz,
  last_used_ip text,
  last_used_user_agent text,
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists agent_api_keys_account_idx
  on public.agent_api_keys (account_id, created_at desc);

create index if not exists agent_api_keys_token_hash_idx
  on public.agent_api_keys (token_hash)
  where status = 'active';

create index if not exists agent_api_keys_active_idx
  on public.agent_api_keys (account_id, status)
  where status = 'active';

create table if not exists public.agent_api_key_events (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  agent_api_key_id uuid references public.agent_api_keys(id) on delete set null,
  tool_name text not null,
  success boolean not null default false,
  error_message text,
  project_id uuid references public.projects(id) on delete set null,
  video_id uuid references public.videos(id) on delete set null,
  request_metadata jsonb not null default '{}'::jsonb,
  result_metadata jsonb not null default '{}'::jsonb,
  ip_address text,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists agent_api_key_events_account_created_idx
  on public.agent_api_key_events (account_id, created_at desc);

create index if not exists agent_api_key_events_key_created_idx
  on public.agent_api_key_events (agent_api_key_id, created_at desc);

create index if not exists agent_api_key_events_tool_created_idx
  on public.agent_api_key_events (tool_name, created_at desc);

alter table public.agent_api_keys enable row level security;
alter table public.agent_api_key_events enable row level security;

drop policy if exists "Owners can read agent api keys"
  on public.agent_api_keys;

create policy "Owners can read agent api keys"
  on public.agent_api_keys
  for select
  using (
    exists (
      select 1
      from public.account_members am
      where am.account_id = agent_api_keys.account_id
        and am.user_id = auth.uid()
        and am.role = 'owner'
    )
  );

drop policy if exists "Owners can create agent api keys"
  on public.agent_api_keys;

create policy "Owners can create agent api keys"
  on public.agent_api_keys
  for insert
  with check (
    created_by = auth.uid()
    and exists (
      select 1
      from public.account_members am
      where am.account_id = agent_api_keys.account_id
        and am.user_id = auth.uid()
        and am.role = 'owner'
    )
  );

drop policy if exists "Owners can update agent api keys"
  on public.agent_api_keys;

create policy "Owners can update agent api keys"
  on public.agent_api_keys
  for update
  using (
    exists (
      select 1
      from public.account_members am
      where am.account_id = agent_api_keys.account_id
        and am.user_id = auth.uid()
        and am.role = 'owner'
    )
  )
  with check (
    exists (
      select 1
      from public.account_members am
      where am.account_id = agent_api_keys.account_id
        and am.user_id = auth.uid()
        and am.role = 'owner'
    )
  );

drop policy if exists "Owners can read agent api key events"
  on public.agent_api_key_events;

create policy "Owners can read agent api key events"
  on public.agent_api_key_events
  for select
  using (
    exists (
      select 1
      from public.account_members am
      where am.account_id = agent_api_key_events.account_id
        and am.user_id = auth.uid()
        and am.role = 'owner'
    )
  );

create or replace function public.set_agent_api_keys_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_agent_api_keys_updated_at
  on public.agent_api_keys;

create trigger set_agent_api_keys_updated_at
before update on public.agent_api_keys
for each row
execute function public.set_agent_api_keys_updated_at();
