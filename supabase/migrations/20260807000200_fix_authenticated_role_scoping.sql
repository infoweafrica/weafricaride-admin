-- Corrective follow-up to 20260807000100. That migration scoped its new
-- policies/grants TO authenticated, on the assumption (stated in its own
-- comment) that Firebase-JWT traffic resolves to Postgres role
-- `authenticated`. Live testing on a real device immediately after
-- shipping it disproved that: driver_public_profile / driver_locations_public
-- returned "permission denied" for an actively Firebase-authenticated rider
-- session, even though `SELECT ... FROM information_schema.role_table_grants`
-- confirmed the authenticated grant was genuinely present at the SQL level.
--
-- Every pre-existing driver-related policy in this codebase (driver_own_location,
-- "drivers: allow select", etc.) was already scoped TO public rather than TO
-- authenticated — almost certainly because whoever wrote those already hit
-- this same issue. Rather than keep guessing at PostgREST/third-party-auth
-- role-resolution internals, this matches that established, working
-- convention exactly.
DROP POLICY IF EXISTS "authenticated_read_online_driver_locations" ON public.driver_locations;
CREATE POLICY "authenticated_read_online_driver_locations" ON public.driver_locations
FOR SELECT TO public
USING (is_online = true);

DROP POLICY IF EXISTS "driver_own_row" ON public.drivers;
CREATE POLICY "driver_own_row" ON public.drivers
FOR ALL TO public
USING (firebase_uid = public.current_firebase_uid())
WITH CHECK (firebase_uid = public.current_firebase_uid());

DROP POLICY IF EXISTS "admin_all_drivers" ON public.drivers;
CREATE POLICY "admin_all_drivers" ON public.drivers
FOR ALL TO public
USING (EXISTS (
  SELECT 1 FROM public.admin_users
  WHERE admin_users.user_id = public.current_uid_safe()
    AND admin_users.is_active = true
));

-- TO public also covers service_role (PUBLIC means every role), fixing the
-- separate gap where service_role had no grant on these brand-new views
-- (new relations don't inherit a project's original service_role default
-- privileges unless ALTER DEFAULT PRIVILEGES was set up for the exact
-- creating role, which apparently wasn't the case here either).
REVOKE SELECT ON public.driver_public_profile FROM authenticated;
GRANT SELECT ON public.driver_public_profile TO public;

REVOKE SELECT ON public.driver_locations_public FROM authenticated;
GRANT SELECT ON public.driver_locations_public TO public;

NOTIFY pgrst, 'reload schema';
