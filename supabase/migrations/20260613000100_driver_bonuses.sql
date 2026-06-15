create table if not exists public.driver_bonuses (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  bonus_type text not null default 'trip_target',
  reward_amount numeric not null default 0,
  currency text not null default 'MWK',
  target_trips integer,
  target_online_minutes integer,
  city text,
  zone_name text,
  start_at timestamptz,
  end_at timestamptz,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.driver_bonus_progress (
  id uuid primary key default gen_random_uuid(),
  bonus_id uuid not null references public.driver_bonuses(id) on delete cascade,
  driver_id uuid not null,
  completed_trips integer not null default 0,
  online_minutes integer not null default 0,
  completed boolean not null default false,
  reward_paid boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(bonus_id, driver_id)
);

alter table public.driver_bonuses enable row level security;
alter table public.driver_bonus_progress enable row level security;
