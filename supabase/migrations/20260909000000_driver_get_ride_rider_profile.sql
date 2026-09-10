-- ============================================================================
-- get_ride_rider_profile — the DRIVER-side mirror of get_driver_public_profile
-- (20260814120100_fix_driver_public_profile_exposure.sql).
--
-- `users` / `riders` RLS is locked down, so the driver app's
--     rider:riders(user:users(full_name))
-- embed comes back with `user: null` (verified against the live DB). Every
-- driver-side trip sheet / chat header / voice read-out then falls back to
-- the literal "Rider". This SECURITY DEFINER RPC returns the rider's display
-- name (+ rating / trip count) ONLY to the driver actually assigned to the
-- ride, or the driver it is queued to before acceptance.
--
-- Idempotent — CREATE OR REPLACE; safe to re-run via `psql -f`.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_ride_rider_profile(p_ride_id uuid)
RETURNS TABLE (
  name        text,
  rating      numeric,
  total_trips integer,
  is_account  boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ride     public.rides;
  v_caller   text;
  v_user_id  uuid;
  v_email    text;
  v_name     text;
  v_rating   numeric;
  v_trips    integer;
BEGIN
  SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id;
  IF NOT FOUND THEN
    RETURN;  -- empty set, not an error
  END IF;

  v_caller := current_firebase_uid();
  IF v_caller IS NULL OR v_caller = '' THEN
    RETURN;
  END IF;

  -- Caller must be the driver on this ride, or the driver it is queued to
  -- (busy-driver fallback in dispatch_ride_to_nearby_drivers — rides.driver_id
  -- is still NULL at that point).
  IF NOT (
    EXISTS (
      SELECT 1 FROM public.drivers d
      WHERE d.id = v_ride.driver_id
        AND d.firebase_uid = v_caller
    )
    OR EXISTS (
      SELECT 1
      FROM public.trip_queue tq
      JOIN public.drivers d ON d.id = tq.driver_id
      WHERE tq.ride_id = p_ride_id
        AND tq.status = 'queued'
        AND d.firebase_uid = v_caller
    )
  ) THEN
    RETURN;
  END IF;

  -- Rider with an account.
  IF v_ride.rider_id IS NOT NULL THEN
    SELECT r.user_id, u.email,
           NULLIF(btrim(u.full_name), ''),
           COALESCE(r.rating, u.rating, 5.0),
           COALESCE(r.total_rides, u.total_rides, 0)
      INTO v_user_id, v_email, v_name, v_rating, v_trips
    FROM public.riders r
    JOIN public.users u ON u.id = r.user_id
    WHERE r.id = v_ride.rider_id;

    -- The rider's own users row often has no real name — full_name blank,
    -- or set to the raw email (Firebase displayName was the email at
    -- signup). This email in particular has several duplicate `users`
    -- rows, only some of which carry the real name ("Joe Jojo"). If the
    -- rider's own row isn't a real name, borrow one from any sibling row
    -- sharing the email, preferring the most recently updated.
    IF v_name IS NULL OR v_name LIKE '%@%' THEN
      IF v_email IS NOT NULL AND v_email <> '' THEN
        SELECT NULLIF(btrim(u2.full_name), '')
          INTO v_name
        FROM public.users u2
        WHERE lower(u2.email) = lower(v_email)
          AND btrim(u2.full_name) <> ''
          AND btrim(u2.full_name) NOT LIKE '%@%'
        ORDER BY u2.updated_at DESC NULLS LAST, u2.created_at DESC NULLS LAST
        LIMIT 1;
      END IF;
    END IF;

    -- Still nothing usable → first/last, then the readable part of the
    -- email, then the operator-typed name, then "Rider".
    IF v_name IS NULL OR v_name LIKE '%@%' THEN
      SELECT COALESCE(
               NULLIF(btrim(concat_ws(' ', u3.first_name, u3.last_name)), ''),
               NULLIF(initcap(split_part(COALESCE(v_email, u3.email, ''), '@', 1)), '')
             )
        INTO v_name
      FROM public.users u3
      WHERE u3.id = v_user_id;
    END IF;

    RETURN QUERY SELECT
      COALESCE(v_name, NULLIF(btrim(v_ride.customer_name), ''), 'Rider'),
      COALESCE(v_rating, 5.0)::numeric,
      COALESCE(v_trips, 0)::integer,
      true;
    RETURN;
  END IF;

  -- Operator booking (phone / WhatsApp / walk-in) — no rider account, the
  -- operator's typed name lives on the ride itself.
  RETURN QUERY
  SELECT
    COALESCE(NULLIF(btrim(v_ride.customer_name), ''), 'Rider'),
    5.0::numeric,
    0::integer,
    false;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_ride_rider_profile(uuid)
  TO anon, authenticated, service_role;
