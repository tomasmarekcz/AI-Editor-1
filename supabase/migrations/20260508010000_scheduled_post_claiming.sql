create or replace function public.claim_next_scheduled_post(p_worker_id text)
returns table (
  id uuid,
  account_id uuid,
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
