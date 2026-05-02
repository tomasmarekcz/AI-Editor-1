create table if not exists public.allowed_users (
  email text primary key,
  role text not null default 'beta',
  created_at timestamptz not null default now(),
  constraint allowed_users_email_lowercase check (email = lower(email))
);

alter table public.allowed_users enable row level security;

drop policy if exists "Users can read their own beta access" on public.allowed_users;
create policy "Users can read their own beta access"
on public.allowed_users
for select
to authenticated
using (email = lower(auth.jwt() ->> 'email'));

-- Add beta users manually from the Supabase SQL editor, for example:
-- insert into public.allowed_users (email, role)
-- values ('your-email@example.com', 'admin')
-- on conflict (email) do update set role = excluded.role;
