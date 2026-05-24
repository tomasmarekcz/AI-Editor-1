create unique index if not exists video_assets_video_kind_storage_path_key
  on public.video_assets (video_id, kind, storage_path);
