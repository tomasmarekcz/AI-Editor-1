alter table public.social_connections
  add column if not exists project_id uuid references public.projects(id) on delete cascade;

alter table public.scheduled_posts
  add column if not exists project_id uuid references public.projects(id) on delete cascade;

alter table public.social_connections
  drop constraint if exists social_connections_platform_check;

alter table public.social_connections
  add constraint social_connections_platform_check
  check (platform in ('youtube', 'instagram', 'tiktok'));

alter table public.scheduled_posts
  drop constraint if exists scheduled_posts_platform_check;

alter table public.scheduled_posts
  add constraint scheduled_posts_platform_check
  check (platform in ('youtube', 'instagram', 'tiktok'));

drop index if exists social_connections_account_platform_idx;

alter table public.social_connections
  drop constraint if exists social_connections_account_id_platform_key;

alter table public.social_connections
  drop constraint if exists social_connections_account_project_platform_key;

alter table public.social_connections
  add constraint social_connections_account_project_platform_key
  unique (account_id, project_id, platform);

create index if not exists social_connections_account_project_platform_idx
  on public.social_connections (account_id, project_id, platform);

create index if not exists scheduled_posts_project_created_idx
  on public.scheduled_posts (project_id, created_at desc);

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
        and v.project_id = scheduled_posts.project_id
    )
    and exists (
      select 1
      from public.social_connections sc
      where sc.id = scheduled_posts.connection_id
        and sc.account_id = scheduled_posts.account_id
        and sc.project_id = scheduled_posts.project_id
        and sc.platform = scheduled_posts.platform
        and sc.status = 'connected'
    )
  );

create or replace function public.claim_next_scheduled_post(p_worker_id text)
returns table (
  id uuid,
  account_id uuid,
  project_id uuid,
  video_id uuid,
  connection_id uuid,
  platform text,
  caption text,
  title text,
  description text,
  privacy_status text,
  scheduled_for timestamptz,
  video_storage_path text,
  thumbnail_storage_path text,
  attempts integer
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with picked as (
    select sp.id
    from public.scheduled_posts sp
    where sp.platform = 'youtube'
      and (
        (sp.status = 'scheduled' and sp.scheduled_for <= now())
        or (sp.status = 'processing' and sp.locked_at < now() - interval '30 minutes')
      )
      and sp.attempts < 5
    order by sp.scheduled_for asc, sp.created_at asc
    for update skip locked
    limit 1
  )
  update public.scheduled_posts sp
  set
    status = 'processing',
    worker_id = p_worker_id,
    locked_at = now(),
    last_attempt_at = now(),
    attempts = sp.attempts + 1,
    updated_at = now(),
    error_message = null,
    error_details = '{}'::jsonb
  from picked
  where sp.id = picked.id
  returning
    sp.id,
    sp.account_id,
    sp.project_id,
    sp.video_id,
    sp.connection_id,
    sp.platform,
    sp.caption,
    sp.title,
    sp.description,
    sp.privacy_status,
    sp.scheduled_for,
    sp.video_storage_path,
    sp.thumbnail_storage_path,
    sp.attempts;
end;
$$;

revoke all on function public.claim_next_scheduled_post(text) from public;
grant execute on function public.claim_next_scheduled_post(text) to service_role;
