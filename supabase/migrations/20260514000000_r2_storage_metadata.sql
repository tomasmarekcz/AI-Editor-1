alter table public.video_assets
  add column if not exists storage_provider text not null default 'supabase',
  add column if not exists migrated_to_r2_at timestamptz,
  add column if not exists r2_etag text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'video_assets_storage_provider_check'
  ) then
    alter table public.video_assets
      add constraint video_assets_storage_provider_check
      check (storage_provider = any (array['supabase'::text, 'r2'::text]));
  end if;
end $$;

create index if not exists video_assets_storage_provider_idx
  on public.video_assets (storage_provider, migrated_to_r2_at);
