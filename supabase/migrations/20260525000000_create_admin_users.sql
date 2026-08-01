create table if not exists public.admin_users (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique not null,
  is_active boolean default true,
  role text default 'admin',
  created_at timestamptz default now()
);
