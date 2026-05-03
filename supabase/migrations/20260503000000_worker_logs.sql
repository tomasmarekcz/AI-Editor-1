create table if not exists public.worker_logs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  video_id uuid references public.videos(id) on delete set null,
  account_id uuid references public.accounts(id) on delete set null,
  project_id uuid references public.projects(id) on delete set null,
  source text not null,
  event text not null,
  level text not null default 'info' check (level = any (array['debug','info','warn','error']::text[])),
  message text,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists worker_logs_video_created_idx
  on public.worker_logs (video_id, created_at desc);

create index if not exists worker_logs_account_created_idx
  on public.worker_logs (account_id, created_at desc);

create index if not exists worker_logs_event_created_idx
  on public.worker_logs (event, created_at desc);
