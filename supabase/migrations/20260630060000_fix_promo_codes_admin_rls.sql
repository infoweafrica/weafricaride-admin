alter table public.promo_codes enable row level security;

drop policy if exists "Admins can manage promo codes" on public.promo_codes;
drop policy if exists "Authenticated users can read active promo codes" on public.promo_codes;

create policy "Admins can manage promo codes"
on public.promo_codes
for all
to authenticated
using (
  exists (
    select 1
    from public.admin_users au
    where au.auth_user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.admin_users au
    where au.auth_user_id = auth.uid()
  )
);

create policy "Authenticated users can read active promo codes"
on public.promo_codes
for select
to authenticated
using (status = 'active');
