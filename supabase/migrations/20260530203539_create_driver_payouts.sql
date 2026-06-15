create table if not exists public.driver_payouts (
 id uuid primary key default gen_random_uuid(),
 driver_id uuid,
 amount numeric default 0,
 status text default 'pending',
 created_at timestamptz default now()
);
