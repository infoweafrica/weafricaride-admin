-- driver_locations and drivers currently carry blanket USING(true) policies
-- (some granted TO anon) that let anyone holding the public anon key —
-- bundled into both the rider-app and driver-app binaries, and into the
-- admin dashboard's browser bundle, none of which are secrets — read or
-- write every driver's row. drivers in particular stores real PII:
-- national_id, national_id_url, license_front_url/license_back_url,
-- date_of_birth, next_of_kin_*, background_check_status, etc.
--
-- Both mobile apps authenticate with Firebase and forward the Firebase ID
-- token as the Supabase JWT (see rider-app/lib/services/supabase_auth_bridge.dart
-- and the equivalent in driver-app), landing as Postgres role `authenticated`
-- with firebase_uid in the JWT `sub` claim — `anon` access was never
-- actually required by either app.
--
-- The admin dashboard's browser client has no Supabase auth session at all
-- (admin login is custom, against admin_users, session kept in a signed
-- cookie — see src/lib/admin-session-token.ts) — every admin page that
-- needs drivers/driver_locations data now goes through a server-side
-- /api/drivers/* route using the service-role key (bypasses RLS) instead of
-- querying Supabase directly from the browser. See the sibling commit that
-- adds those routes; this migration assumes it has already shipped.

-- driver_locations: drop the two blanket policies, keep the existing
-- owner-row policy, add a narrow SELECT-only policy so any signed-in
-- rider/driver can see *online* drivers for the live map (matches what
-- rider_places_service.dart / rider_live_tracking_map.dart already query).
DROP POLICY IF EXISTS "Drivers can manage own location" ON public.driver_locations;
DROP POLICY IF EXISTS "anon_all_driver_locations" ON public.driver_locations;

CREATE POLICY "authenticated_read_online_driver_locations" ON public.driver_locations
FOR SELECT TO authenticated
USING (is_online = true);

-- drivers: drop the four blanket policies (including anon, and including
-- unrestricted UPDATE/DELETE for any authenticated caller), keep only an
-- owner-row policy plus an admin policy mirroring admin_all_driver_locations.
-- RLS is row-level, not column-level, so any policy that let other users
-- see "the driver" row would still expose national_id etc. Cross-user reads
-- (rider viewing their assigned driver's name/photo/rating/phone/vehicle)
-- instead go through the driver_public_profile view below, which only ever
-- selects the columns the rider app actually reads (see
-- rider_trip_service.dart:576,652 and rider_places_service.dart's
-- driver_locations embed).
DROP POLICY IF EXISTS "allow drivers all" ON public.drivers;
DROP POLICY IF EXISTS "drivers: allow insert" ON public.drivers;
DROP POLICY IF EXISTS "drivers: allow select" ON public.drivers;
DROP POLICY IF EXISTS "drivers: allow update" ON public.drivers;

CREATE POLICY "driver_own_row" ON public.drivers
FOR ALL TO authenticated
USING (firebase_uid = public.current_firebase_uid())
WITH CHECK (firebase_uid = public.current_firebase_uid());

CREATE POLICY "admin_all_drivers" ON public.drivers
FOR ALL TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.admin_users
  WHERE admin_users.user_id = public.current_uid_safe()
    AND admin_users.is_active = true
));

-- Safe, narrow public profile: no security_invoker, so it runs with the
-- view owner's privileges and isn't limited by driver_own_row's row filter
-- — that's the point, it's meant to expose any driver's public fields to
-- any authenticated caller, just never the sensitive columns.
-- vehicle color is flattened in directly (rather than left as a PostgREST
-- embed) because embeds resolve through FK metadata that views don't carry
-- — `vehicles!drivers_vehicle_id_fkey(color)`, which rider_trip_service.dart
-- used against the `drivers` table, has no equivalent against this view.
CREATE OR REPLACE VIEW public.driver_public_profile AS
SELECT
  d.id,
  d.full_name,
  d.profile_photo_url,
  d.rating,
  d.total_trips,
  d.phone,
  d.plate_number,
  d.vehicle_make,
  d.vehicle_model,
  d.vehicle_category,
  d.preferred_categories,
  v.color AS vehicle_color
FROM public.drivers d
LEFT JOIN public.vehicles v ON v.id = d.vehicle_id;

GRANT SELECT ON public.driver_public_profile TO authenticated;

-- rider_places_service.dart's fetchNearbyDrivers() queries driver_locations
-- with an embedded `drivers(vehicle_category, preferred_categories)` reached
-- via the driver_locations.driver_id -> drivers.id FK. PostgREST embeds
-- still enforce RLS on the embedded table, so once drivers is locked to
-- owner-row + admin, that embed would silently come back null for every
-- other driver — breaking the tier-eligibility filtering the rider map
-- relies on. A FK-based embed against driver_public_profile isn't a fix
-- either: views carry no FK metadata for PostgREST to detect the
-- relationship. Instead, flatten the join into one queryable view so the
-- rider app can drop the embed syntax entirely.
CREATE OR REPLACE VIEW public.driver_locations_public AS
SELECT
  dl.driver_id,
  dl.latitude,
  dl.longitude,
  dl.heading,
  dl.is_online,
  d.vehicle_category,
  d.preferred_categories
FROM public.driver_locations dl
JOIN public.drivers d ON d.id = dl.driver_id;

GRANT SELECT ON public.driver_locations_public TO authenticated;
