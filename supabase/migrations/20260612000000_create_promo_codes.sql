create table if not exists public.promo_codes (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  discount_type text,
  discount_value numeric,
  status text default 'active',
  visible boolean default true,
  starts_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz default now()
);
