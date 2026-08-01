-- Closes the worst of the anon-key exposure on financial/admin tables.
-- Background: none of the three client apps (driver-app, rider-app,
-- admin-dashboard) authenticate via Supabase Auth — mobile apps use
-- Firebase, admin-dashboard uses a custom admin_users table + signed
-- session cookie (see /api/admin/login). So auth.uid()-scoped policies
-- never match anon requests, and the apps rely on the anon key for all
-- direct table reads. All money-moving writes already go through
-- SECURITY DEFINER RPCs (credit_wallet, debit_wallet,
-- driver_request_withdrawal, admin_process_refund, etc.), which run as
-- the table owner and are unaffected by RLS or the column-privilege
-- narrowing below. This migration removes the ability to write those
-- tables directly (bypassing the RPCs) while preserving every read/write
-- path the apps actually use today (verified against driver-app,
-- rider-app, and admin-dashboard source as of 2026-07-16).
--
-- Deliberately NOT touched here: "users" and "drivers" tables remain
-- broadly anon-writable ("allow users all" / "allow drivers all"). Both
-- apps update their own profile/location rows directly via the anon key
-- with no way to scope "own row" at the RLS layer absent a real
-- Supabase-Auth-backed session — fixing that requires an auth
-- architecture decision (bridging Firebase UID into auth.uid(), or moving
-- those writes behind server-side endpoints), not a table-level RLS tweak.

-- ── admin_users: no client ever needs direct access any more ──
-- (login is fully server-side via /api/admin/login using the service role)
DROP POLICY IF EXISTS "admin_users_anon_read" ON "public"."admin_users";

-- ── platform_escrow: confirmed zero references in any client app ──
DROP POLICY IF EXISTS "anon_escrow_all" ON "public"."platform_escrow";

-- ── payments: keep read + insert (both apps rely on these), drop the
--    catch-all that also grants anon UPDATE/DELETE on any payment row
--    (this was the hole behind arbitrary refund forgery) ──
DROP POLICY IF EXISTS "anon_payments_all" ON "public"."payments";
-- anon_insert_payments (INSERT) and anon_read_ownish_payments (SELECT)
-- are left in place — apps insert/read payment records directly today.

-- ── wallets (rider ledger): apps only ever SELECT this directly;
--    all writes go through credit_wallet/debit_wallet/settle_trip_payment ──
DROP POLICY IF EXISTS "anon_wallets_all" ON "public"."wallets";
CREATE POLICY "anon_read_wallets" ON "public"."wallets"
  FOR SELECT TO "authenticated", "anon" USING (true);

-- ── wallet_transactions: confirmed zero direct client writes; used for
--    read-only history/ledger display ──
DROP POLICY IF EXISTS "anon_wallet_transactions_all" ON "public"."wallet_transactions";
CREATE POLICY "anon_read_wallet_transactions" ON "public"."wallet_transactions"
  FOR SELECT TO "authenticated", "anon" USING (true);

-- ── driver_wallets: driver-app reads its own wallet, auto-creates the row
--    on first fetch (driver_id + firebase_uid only), and upserts payout
--    method details (mobile money/bank info) during onboarding. It never
--    needs to touch balance columns directly — those are RPC-only. Drop
--    the three overlapping fully-open policies and replace with a scoped
--    UPDATE/INSERT that's further restricted to non-balance columns via
--    column-level privileges. ──
DROP POLICY IF EXISTS "Allow driver wallets update" ON "public"."driver_wallets";
DROP POLICY IF EXISTS "allow driver wallets all" ON "public"."driver_wallets";
DROP POLICY IF EXISTS "anon_update_driver_wallets" ON "public"."driver_wallets";

CREATE POLICY "anon_update_driver_wallets_payout_fields" ON "public"."driver_wallets"
  FOR UPDATE TO "authenticated", "anon" USING (true) WITH CHECK (true);

-- Revoke the blanket table-level INSERT/UPDATE grant and re-grant it
-- scoped to payout-configuration columns only. Balance columns
-- (balance, available_balance, available_for_withdrawal, pending_balance,
-- total_earned, total_withdrawn, cash_collected, earned_*, trips_*) are
-- deliberately excluded — attempting to write them via direct table
-- access now fails with a permission error; only the SECURITY DEFINER
-- RPCs (which bypass column grants as the table owner) can change them.
REVOKE INSERT, UPDATE ON "public"."driver_wallets" FROM "anon", "authenticated";
GRANT INSERT (
  "driver_id", "firebase_uid", "driver_name", "driver_email",
  "payout_method", "payout_account", "default_payout_method",
  "payout_account_number", "payout_phone_number", "payout_provider",
  "is_payout_enabled", "tnm_mpamba_number", "airtel_money_number",
  "bank_account_number", "bank_name", "account_holder_name",
  "mobile_money_name", "currency"
) ON "public"."driver_wallets" TO "anon", "authenticated";
GRANT UPDATE (
  "firebase_uid", "driver_name", "driver_email",
  "payout_method", "payout_account", "default_payout_method",
  "payout_account_number", "payout_phone_number", "payout_provider",
  "is_payout_enabled", "tnm_mpamba_number", "airtel_money_number",
  "bank_account_number", "bank_name", "account_holder_name",
  "mobile_money_name", "currency", "updated_at"
) ON "public"."driver_wallets" TO "anon", "authenticated";
