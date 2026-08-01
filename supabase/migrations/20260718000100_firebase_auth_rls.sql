-- Completes the auth-architecture fix that 20260716000200_tighten_anon_financial_rls.sql
-- deliberately deferred. Supabase's project (petoepgxeycfdkzvoexu) is now
-- configured with Firebase as a native third-party auth provider (verifies
-- Firebase ID tokens directly against Firebase's own JWKS — see the
-- Authentication > Sign In / Providers > Third Party Auth config, added
-- 2026-07-18), and both driver-app and rider-app forward the Firebase ID
-- token via supabase_flutter's `accessToken` callback.
--
-- IMPORTANT: this project's auth.uid() is defined as
--   coalesce(current_setting('request.jwt.claim.sub', true), ...)::uuid
-- i.e. a hard cast to uuid. Firebase UIDs are NOT valid UUIDs, so calling
-- auth.uid() against a Firebase-issued token throws a Postgres error
-- (invalid input syntax for type uuid) — not a graceful NULL/deny. Every
-- policy in this migration therefore uses auth.jwt() ->> 'sub' (text,
-- never throws) compared against firebase_uid columns instead. This also
-- required fixing five ALREADY-LIVE policies that called auth.uid()
-- directly (driver_own_wallet, rider_own_wallet, admin_all_wallets,
-- driver_own_driver_wallets, admin_all_driver_wallets) — harmless today
-- only because nothing has sent a real Firebase JWT yet; they would have
-- broken every authenticated request the moment the apps shipped.
--
-- Known gap: 2 rows in `users` and 1 in `riders` have no firebase_uid on
-- file (confirmed via direct query, 2026-07-18) — those specific accounts
-- lose self-service RLS access until backfilled (recoverable via the
-- service-role-backed admin dashboard). drivers/driver_wallets are fully
-- populated.
--
-- IMPORTANT (found 2026-07-24, testing device_sessions live): PostgREST
-- only assigns the `authenticated` SQL role when the JWT carries an
-- explicit "role" claim. Firebase ID tokens never have one, so even a
-- successfully-verified third-party Firebase token resolves to `anon` —
-- confirmed empirically (42501 permission denied against a policy scoped
-- `TO authenticated`, with a real, valid, verified Firebase JWT attached).
-- Every policy below is therefore scoped `TO anon, authenticated`, not
-- `authenticated` alone. This is safe: the actual authorization is the
-- row condition (firebase_uid = current_firebase_uid()), not the SQL
-- role — a request with no real Firebase JWT gets NULL from
-- current_firebase_uid() and matches nothing regardless of role. Without
-- this, applying this migration would have locked out all real app
-- traffic entirely (every request runs as anon), not just tightened it.
--
-- Do not apply until driver-app and rider-app builds with the
-- accessToken bridge have actually reached users — applying this against
-- old app builds (no bridge) would lock them out of their own data.

CREATE OR REPLACE FUNCTION public.current_firebase_uid()
RETURNS text
LANGUAGE sql STABLE
AS $$
  SELECT auth.jwt() ->> 'sub'
$$;

-- ── users ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "allow users all" ON "public"."users";
DROP POLICY IF EXISTS "users: allow insert" ON "public"."users";
DROP POLICY IF EXISTS "users: allow select" ON "public"."users";
DROP POLICY IF EXISTS "users: allow update" ON "public"."users";

CREATE POLICY "users_own_row_select" ON "public"."users"
  FOR SELECT TO "anon", "authenticated"
  USING (firebase_uid = public.current_firebase_uid());
CREATE POLICY "users_own_row_update" ON "public"."users"
  FOR UPDATE TO "anon", "authenticated"
  USING (firebase_uid = public.current_firebase_uid())
  WITH CHECK (firebase_uid = public.current_firebase_uid());
-- Client creates its own profile row on first sign-in (existing app
-- behavior) — safe because the row can only claim the caller's own
-- verified firebase_uid, never someone else's.
CREATE POLICY "users_insert_own" ON "public"."users"
  FOR INSERT TO "anon", "authenticated"
  WITH CHECK (firebase_uid = public.current_firebase_uid());
CREATE POLICY "admin_all_users" ON "public"."users"
  FOR ALL TO "anon", "authenticated"
  USING (
    EXISTS (
      SELECT 1 FROM "public"."admin_users"
      WHERE admin_users.firebase_uid = public.current_firebase_uid()
        AND admin_users.is_active = true
    )
  );

-- ── drivers ────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "allow drivers all" ON "public"."drivers";
DROP POLICY IF EXISTS "drivers: allow insert" ON "public"."drivers";
DROP POLICY IF EXISTS "drivers: allow select" ON "public"."drivers";
DROP POLICY IF EXISTS "drivers: allow update" ON "public"."drivers";

CREATE POLICY "drivers_own_row_select" ON "public"."drivers"
  FOR SELECT TO "anon", "authenticated"
  USING (firebase_uid = public.current_firebase_uid());
CREATE POLICY "drivers_own_row_update" ON "public"."drivers"
  FOR UPDATE TO "anon", "authenticated"
  USING (firebase_uid = public.current_firebase_uid())
  WITH CHECK (firebase_uid = public.current_firebase_uid());
CREATE POLICY "drivers_insert_own" ON "public"."drivers"
  FOR INSERT TO "anon", "authenticated"
  WITH CHECK (firebase_uid = public.current_firebase_uid());
CREATE POLICY "admin_all_drivers" ON "public"."drivers"
  FOR ALL TO "anon", "authenticated"
  USING (
    EXISTS (
      SELECT 1 FROM "public"."admin_users"
      WHERE admin_users.firebase_uid = public.current_firebase_uid()
        AND admin_users.is_active = true
    )
  );

-- ── wallets (rider ledger) ─────────────────────────────────────────
-- No firebase_uid column here — join through users. Fix the two
-- already-live auth.uid()-based policies and drop the open-read stopgap.
DROP POLICY IF EXISTS "anon_read_wallets" ON "public"."wallets";
DROP POLICY IF EXISTS "driver_own_wallet" ON "public"."wallets";
DROP POLICY IF EXISTS "rider_own_wallet" ON "public"."wallets";
DROP POLICY IF EXISTS "admin_all_wallets" ON "public"."wallets";

CREATE POLICY "wallet_own_row" ON "public"."wallets"
  FOR SELECT TO "anon", "authenticated"
  USING (
    EXISTS (
      SELECT 1 FROM "public"."users" u
      WHERE u.id = wallets.user_id AND u.firebase_uid = public.current_firebase_uid()
    )
  );
CREATE POLICY "admin_all_wallets" ON "public"."wallets"
  FOR ALL TO "anon", "authenticated"
  USING (
    EXISTS (
      SELECT 1 FROM "public"."admin_users"
      WHERE admin_users.firebase_uid = public.current_firebase_uid()
        AND admin_users.is_active = true
    )
  );

-- ── driver_wallets ─────────────────────────────────────────────────
-- Has its own firebase_uid column (kept in sync by the app on insert) —
-- compare directly, no join needed.
DROP POLICY IF EXISTS "Allow driver wallets insert" ON "public"."driver_wallets";
DROP POLICY IF EXISTS "Allow driver wallets select" ON "public"."driver_wallets";
DROP POLICY IF EXISTS "public_read_driver_wallets" ON "public"."driver_wallets";
DROP POLICY IF EXISTS "anon_update_driver_wallets_payout_fields" ON "public"."driver_wallets";
DROP POLICY IF EXISTS "driver_own_wallets" ON "public"."driver_wallets";
DROP POLICY IF EXISTS "driver_own_driver_wallets" ON "public"."driver_wallets";
DROP POLICY IF EXISTS "admin_all_driver_wallets" ON "public"."driver_wallets";

CREATE POLICY "driver_wallet_own_row_select" ON "public"."driver_wallets"
  FOR SELECT TO "anon", "authenticated"
  USING (firebase_uid = public.current_firebase_uid());
-- Column-level GRANT restriction from the prior migration (balance
-- columns excluded from anon/authenticated UPDATE) is untouched — this
-- just scopes WHICH rows an authenticated driver can target at all.
CREATE POLICY "driver_wallet_update_own_row" ON "public"."driver_wallets"
  FOR UPDATE TO "anon", "authenticated"
  USING (firebase_uid = public.current_firebase_uid())
  WITH CHECK (firebase_uid = public.current_firebase_uid());
CREATE POLICY "driver_wallet_insert_own_row" ON "public"."driver_wallets"
  FOR INSERT TO "anon", "authenticated"
  WITH CHECK (firebase_uid = public.current_firebase_uid());
CREATE POLICY "admin_all_driver_wallets" ON "public"."driver_wallets"
  FOR ALL TO "anon", "authenticated"
  USING (
    EXISTS (
      SELECT 1 FROM "public"."admin_users"
      WHERE admin_users.firebase_uid = public.current_firebase_uid()
        AND admin_users.is_active = true
    )
  );
