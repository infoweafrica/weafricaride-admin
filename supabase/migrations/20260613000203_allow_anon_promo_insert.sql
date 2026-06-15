drop policy if exists "Anon can insert promo codes" on public.promo_codes;
drop policy if exists "Anon can update promo codes" on public.promo_codes;

create policy "Anon can insert promo codes"
on public.promo_codes
for insert
to anon
with check (true);

create policy "Anon can update promo codes"
on public.promo_codes
for update
to anon
using (true)
with check (true);
