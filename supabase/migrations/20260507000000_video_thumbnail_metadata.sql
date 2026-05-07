alter table public.videos
  add column if not exists thumbnail_prompt text,
  add column if not exists thumbnail_source text not null default 'default',
  add column if not exists thumbnail_updated_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'videos_thumbnail_source_check'
  ) then
    alter table public.videos
      add constraint videos_thumbnail_source_check
      check (thumbnail_source = any (array['default'::text, 'ai'::text, 'uploaded'::text]));
  end if;
end $$;
