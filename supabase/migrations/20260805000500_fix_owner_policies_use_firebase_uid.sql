-- Corrects the previous migration's mistake. 20260805000400 swapped
-- auth.uid() for public.current_uid_safe() everywhere to stop it from
-- throwing on Firebase-bridged requests — that part was right. But
-- current_uid_safe() does `(sub)::uuid` in a try/catch and returns NULL
-- on failure, and a Firebase UID *never* parses as a UUID, so it returns
-- NULL for every mobile request, always. Any policy comparing an id/uuid
-- column to current_uid_safe() (e.g. `riders.id = current_uid_safe()`,
-- `user_id = current_uid_safe()`) can therefore never match a real
-- Firebase-authenticated rider or driver — it silently denies instead of
-- throwing, which is why this looked like progress (no more crash) while
-- still being broken (found via trip_events: cancel still failed, log
-- showed "Stale event version" — the read that should have found the
-- existing row was returning zero rows).
--
-- The fix is public.current_firebase_uid() (already existed, used
-- elsewhere in the project) — `auth.jwt() ->> 'sub'`, plain text, no
-- cast, so it round-trips the Firebase UID correctly. Policies that own
-- their row via a denormalized `firebase_uid` text column compare to it
-- directly; policies that only have a `user_id`/`rider_id`/`driver_id`
-- uuid FK join through riders/drivers/users to reach firebase_uid first.
--
-- Scope: only the owner-scoped policies that were comparing an
-- id/uuid column to current_uid_safe(). The admin_all_*/Admins-can-manage
-- policies that compare admin_users.user_id = current_uid_safe() are
-- untouched — those genuinely run under real Supabase-Auth admin
-- sessions (Google OAuth via GoTrue, whose sub *is* a UUID), so
-- current_uid_safe() is correct there: NULL for a Firebase-bridged
-- mobile request just means "not an admin," which is the right answer.

BEGIN;

-- driver_achievement_unlocks
DROP POLICY IF EXISTS "driver_own_achievement_unlocks" ON public.driver_achievement_unlocks;
CREATE POLICY "driver_own_achievement_unlocks" ON public.driver_achievement_unlocks
FOR SELECT TO public
USING (EXISTS (SELECT 1 FROM drivers d WHERE d.id = driver_achievement_unlocks.driver_id AND d.firebase_uid = public.current_firebase_uid()));

-- driver_locations
DROP POLICY IF EXISTS "driver_own_location" ON public.driver_locations;
CREATE POLICY "driver_own_location" ON public.driver_locations
FOR ALL TO public
USING (firebase_uid = public.current_firebase_uid());

-- driver_performance
DROP POLICY IF EXISTS "driver_own_performance" ON public.driver_performance;
CREATE POLICY "driver_own_performance" ON public.driver_performance
FOR SELECT TO public
USING (EXISTS (SELECT 1 FROM drivers d WHERE d.id = driver_performance.driver_id AND d.firebase_uid = public.current_firebase_uid()));

-- driver_safety_contacts
DROP POLICY IF EXISTS "driver_own_safety_contacts" ON public.driver_safety_contacts;
CREATE POLICY "driver_own_safety_contacts" ON public.driver_safety_contacts
FOR ALL TO public
USING (EXISTS (SELECT 1 FROM drivers d WHERE d.id = driver_safety_contacts.driver_id AND d.firebase_uid = public.current_firebase_uid()));

-- driver_settings
DROP POLICY IF EXISTS "driver_own_settings" ON public.driver_settings;
CREATE POLICY "driver_own_settings" ON public.driver_settings
FOR ALL TO public
USING (EXISTS (SELECT 1 FROM drivers d WHERE d.id = driver_settings.driver_id AND d.firebase_uid = public.current_firebase_uid()));

-- driver_transactions
DROP POLICY IF EXISTS "driver_own_transactions" ON public.driver_transactions;
CREATE POLICY "driver_own_transactions" ON public.driver_transactions
FOR SELECT TO public
USING (EXISTS (SELECT 1 FROM drivers d WHERE d.id = driver_transactions.driver_id AND d.firebase_uid = public.current_firebase_uid()));

-- driver_wallet_transactions (pre-existing: not correlated to the outer
-- row by driver_id, only by the fact *some* driver matches this user —
-- left structurally as-is since public_read_driver_wallet_transactions
-- already grants broad SELECT; only the auth comparison is corrected)
DROP POLICY IF EXISTS "driver_own_driver_wallet_transactions" ON public.driver_wallet_transactions;
CREATE POLICY "driver_own_driver_wallet_transactions" ON public.driver_wallet_transactions
FOR SELECT TO public
USING (EXISTS (SELECT 1 FROM drivers d WHERE d.user_id = (SELECT id FROM users WHERE firebase_uid = public.current_firebase_uid())));

-- driver_wallets
DROP POLICY IF EXISTS "driver_own_driver_wallets" ON public.driver_wallets;
CREATE POLICY "driver_own_driver_wallets" ON public.driver_wallets
FOR SELECT TO public
USING (EXISTS (SELECT 1 FROM drivers d WHERE d.user_id = (SELECT id FROM users WHERE firebase_uid = public.current_firebase_uid())));

DROP POLICY IF EXISTS "driver_own_wallets" ON public.driver_wallets;
CREATE POLICY "driver_own_wallets" ON public.driver_wallets
FOR ALL TO public
USING (firebase_uid = public.current_firebase_uid());

-- notifications
DROP POLICY IF EXISTS "Users can read own notifications" ON public.notifications;
CREATE POLICY "Users can read own notifications" ON public.notifications
FOR SELECT TO authenticated
USING (user_id = (SELECT id FROM users WHERE firebase_uid = public.current_firebase_uid()));

DROP POLICY IF EXISTS "Users can update own notifications" ON public.notifications;
CREATE POLICY "Users can update own notifications" ON public.notifications
FOR UPDATE TO authenticated
USING (user_id = (SELECT id FROM users WHERE firebase_uid = public.current_firebase_uid()))
WITH CHECK (user_id = (SELECT id FROM users WHERE firebase_uid = public.current_firebase_uid()));

-- rider_settings
DROP POLICY IF EXISTS "rider_settings_insert_own" ON public.rider_settings;
CREATE POLICY "rider_settings_insert_own" ON public.rider_settings
FOR INSERT TO authenticated
WITH CHECK (rider_id IN (SELECT riders.id FROM riders WHERE riders.firebase_uid = public.current_firebase_uid()));

DROP POLICY IF EXISTS "rider_settings_read_own" ON public.rider_settings;
CREATE POLICY "rider_settings_read_own" ON public.rider_settings
FOR SELECT TO authenticated
USING (rider_id IN (SELECT riders.id FROM riders WHERE riders.firebase_uid = public.current_firebase_uid()));

DROP POLICY IF EXISTS "rider_settings_update_own" ON public.rider_settings;
CREATE POLICY "rider_settings_update_own" ON public.rider_settings
FOR UPDATE TO authenticated
USING (rider_id IN (SELECT riders.id FROM riders WHERE riders.firebase_uid = public.current_firebase_uid()))
WITH CHECK (rider_id IN (SELECT riders.id FROM riders WHERE riders.firebase_uid = public.current_firebase_uid()));

-- riders (riders.id was being compared directly to current_uid_safe(),
-- a leftover from before the Firebase bridge existed; riders.firebase_uid
-- is the correct owner column)
DROP POLICY IF EXISTS "Riders can create own profile" ON public.riders;
CREATE POLICY "Riders can create own profile" ON public.riders
FOR INSERT TO authenticated
WITH CHECK (firebase_uid = public.current_firebase_uid());

DROP POLICY IF EXISTS "Riders can update own profile" ON public.riders;
CREATE POLICY "Riders can update own profile" ON public.riders
FOR UPDATE TO authenticated
USING (firebase_uid = public.current_firebase_uid())
WITH CHECK (firebase_uid = public.current_firebase_uid());

DROP POLICY IF EXISTS "Riders can view own profile" ON public.riders;
CREATE POLICY "Riders can view own profile" ON public.riders
FOR SELECT TO authenticated
USING (firebase_uid = public.current_firebase_uid());

-- wallets
DROP POLICY IF EXISTS "driver_own_wallet" ON public.wallets;
CREATE POLICY "driver_own_wallet" ON public.wallets
FOR SELECT TO public
USING (user_id = (SELECT id FROM users WHERE firebase_uid = public.current_firebase_uid()));

DROP POLICY IF EXISTS "rider_own_wallet" ON public.wallets;
CREATE POLICY "rider_own_wallet" ON public.wallets
FOR SELECT TO public
USING (user_id = (SELECT id FROM users WHERE firebase_uid = public.current_firebase_uid()));

COMMIT;
