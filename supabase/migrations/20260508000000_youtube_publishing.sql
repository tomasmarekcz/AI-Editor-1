create table if not exists public.social_connections (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  connected_by uuid not null references auth.users(id) on delete restrict,

  platform text not null check (platform in ('youtube')),
  status text not null default 'connected'
    check (status in ('connected', 'revoked', 'error')),

  platform_account_id text,
  platform_account_name text,
  platform_channel_id text,
  platform_channel_title text,
  platform_channel_url text,
  scopes text[] not null default '{}',

  last_verified_at timestamptz,
  disconnected_at timestamptz,
  error_message text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (account_id, platform)
);

create table if not exists public.social_connection_tokens (
  connection_id uuid primary key references public.social_connections(id) on delete cascade,

  encrypted_refresh_token text not null,
  encrypted_access_token text,
  access_token_expires_at timestamptz,
  token_type text,

  updated_at timestamptz not null default now()
);

create table if not exists public.scheduled_posts (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  video_id uuid not null references public.videos(id) on delete cascade,
  connection_id uuid not null references public.social_connections(id) on delete restrict,
  created_by uuid not null references auth.users(id) on delete restrict,

  platform text not null check (platform in ('youtube')),
  status text not null default 'scheduled'
    check (status in ('draft', 'scheduled', 'processing', 'published', 'failed', 'cancelled')),

  caption text not null default '',
  title text,
  description text,
  privacy_status text not null default 'public'
    check (privacy_status in ('private', 'unlisted', 'public')),

  scheduled_for timestamptz not null,
  timezone text,

  video_storage_path text not null,
  thumbnail_storage_path text,

  worker_id text,
  locked_at timestamptz,
  attempts integer not null default 0,
  last_attempt_at timestamptz,

  published_at timestamptz,
  platform_post_id text,
  platform_post_url text,

  error_message text,
  error_details jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists social_connections_account_platform_idx
  on public.social_connections (account_id, platform);

create index if not exists scheduled_posts_due_idx
  on public.scheduled_posts (status, scheduled_for)
  where status = 'scheduled';

create index if not exists scheduled_posts_account_created_idx
  on public.scheduled_posts (account_id, created_at desc);

create index if not exists scheduled_posts_video_created_idx
  on public.scheduled_posts (video_id, created_at desc);

alter table public.social_connections enable row level security;
alter table public.social_connection_tokens enable row level security;
alter table public.scheduled_posts enable row level security;

drop policy if exists "Account members can read social connections"
  on public.social_connections;

create policy "Account members can read social connections"
  on public.social_connections
  for select
  using (
    exists (
      select 1
      from public.account_members am
      where am.account_id = social_connections.account_id
        and am.user_id = auth.uid()
    )
  );

drop policy if exists "Account members can read scheduled posts"
  on public.scheduled_posts;

create policy "Account members can read scheduled posts"
  on public.scheduled_posts
  for select
  using (
    exists (
      select 1
      from public.account_members am
      where am.account_id = scheduled_posts.account_id
        and am.user_id = auth.uid()
    )
  );

drop policy if exists "Account members can create scheduled posts"
  on public.scheduled_posts;

create policy "Account members can create scheduled posts"
  on public.scheduled_posts
  for insert
  with check (
    created_by = auth.uid()
    and exists (
      select 1
      from public.account_members am
      where am.account_id = scheduled_posts.account_id
        and am.user_id = auth.uid()
        and am.role in ('owner', 'editor')
    )
    and exists (
      select 1
      from public.videos v
      where v.id = scheduled_posts.video_id
        and v.account_id = scheduled_posts.account_id
    )
    and exists (
      select 1
      from public.social_connections sc
      where sc.id = scheduled_posts.connection_id
        and sc.account_id = scheduled_posts.account_id
        and sc.platform = scheduled_posts.platform
        and sc.status = 'connected'
    )
  );

drop policy if exists "Account members can update scheduled posts"
  on public.scheduled_posts;

create policy "Account members can update scheduled posts"
  on public.scheduled_posts
  for update
  using (
    exists (
      select 1
      from public.account_members am
      where am.account_id = scheduled_posts.account_id
        and am.user_id = auth.uid()
        and am.role in ('owner', 'editor')
    )
  )
  with check (
    exists (
      select 1
      from public.account_members am
      where am.account_id = scheduled_posts.account_id
        and am.user_id = auth.uid()
        and am.role in ('owner', 'editor')
    )
  );
