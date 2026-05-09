create table if not exists public.social_post_analytics (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  video_id uuid not null references public.videos(id) on delete cascade,
  scheduled_post_id uuid not null references public.scheduled_posts(id) on delete cascade,
  platform text not null default 'youtube'
    check (platform in ('youtube')),

  platform_post_id text not null,

  views bigint not null default 0,
  likes bigint not null default 0,
  comments bigint not null default 0,
  shares bigint,
  watch_time_minutes numeric,
  average_view_duration_seconds numeric,
  average_view_percentage numeric,
  subscribers_gained bigint,
  subscribers_lost bigint,

  youtube_published_at timestamptz,
  youtube_title text,
  youtube_description text,
  youtube_thumbnail_url text,
  privacy_status text,

  raw_data_api_response jsonb not null default '{}'::jsonb,
  raw_analytics_api_response jsonb not null default '{}'::jsonb,

  synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (scheduled_post_id)
);

create index if not exists social_post_analytics_account_idx
  on public.social_post_analytics (account_id);

create index if not exists social_post_analytics_video_idx
  on public.social_post_analytics (video_id);

create index if not exists social_post_analytics_platform_post_idx
  on public.social_post_analytics (platform_post_id);

alter table public.social_post_analytics enable row level security;

drop policy if exists "Account members can read social post analytics"
  on public.social_post_analytics;

create policy "Account members can read social post analytics"
  on public.social_post_analytics
  for select
  using (
    exists (
      select 1
      from public.account_members am
      where am.account_id = social_post_analytics.account_id
        and am.user_id = auth.uid()
    )
  );

drop policy if exists "Account editors can insert social post analytics"
  on public.social_post_analytics;

create policy "Account editors can insert social post analytics"
  on public.social_post_analytics
  for insert
  with check (
    exists (
      select 1
      from public.account_members am
      where am.account_id = social_post_analytics.account_id
        and am.user_id = auth.uid()
        and am.role in ('owner', 'editor')
    )
  );

drop policy if exists "Account editors can update social post analytics"
  on public.social_post_analytics;

create policy "Account editors can update social post analytics"
  on public.social_post_analytics
  for update
  using (
    exists (
      select 1
      from public.account_members am
      where am.account_id = social_post_analytics.account_id
        and am.user_id = auth.uid()
        and am.role in ('owner', 'editor')
    )
  )
  with check (
    exists (
      select 1
      from public.account_members am
      where am.account_id = social_post_analytics.account_id
        and am.user_id = auth.uid()
        and am.role in ('owner', 'editor')
    )
  );
