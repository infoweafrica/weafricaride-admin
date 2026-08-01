-- ============================================================
-- Consolidate trip status writes onto transition_trip_state()
--
-- transition_trip_state() (20260625000100) was meant to be the only
-- writer of rides.status, but accept_ride_request, driver_arrived,
-- start_ride_with_pin and dispatch_ride_to_nearby_drivers were still
-- writing rides.status directly, bypassing validation and the
-- trip_events audit log entirely. This migration:
--   1. Adds the transition rows these functions actually need (the
--      live app already skips the 'assigned'/'picked_up' waypoints —
--      this matches that behavior rather than introducing a new one).
--   2. Adds transitions for admin-initiated cancel/reassign so those
--      actions (next migration's target) become valid, auditable
--      transitions instead of unchecked writes.
--   3. Redefines the four functions to call transition_trip_state()
--      for the status change while preserving their existing
--      business logic (locking, PIN checks, ride_requests bookkeeping,
--      ride_events logging).
-- ============================================================

INSERT INTO allowed_trip_transitions (from_state, to_state, allowed_by_rider, allowed_by_driver, allowed_by_system) VALUES
-- accept_ride_request: driver accepts directly from requested/searching (no separate 'assigned' step in the live flow)
('requested', 'accepted', false, true, false),
('searching', 'accepted', false, true, false),
-- driver_arrived: real prior state is 'accepted', not 'driver_assigned'
('accepted', 'arrived', false, true, false),
-- start_ride_with_pin: real prior state is 'arrived', not 'picked_up'
('arrived', 'in_progress', false, true, false),

-- Admin (system actor) cancel from any active state
('requested', 'system_cancelled', false, false, true),
('searching', 'system_cancelled', false, false, true),
('assigned', 'system_cancelled', false, false, true),
('accepted', 'system_cancelled', false, false, true),
('en_route', 'system_cancelled', false, false, true),
('arrived', 'system_cancelled', false, false, true),
('picked_up', 'system_cancelled', false, false, true),
('in_progress', 'system_cancelled', false, false, true),
('system_cancelled', 'rated_done', true, true, true),

-- Admin (system actor) reassign back to searching
('assigned', 'searching', false, false, true),
('accepted', 'searching', false, false, true),
('en_route', 'searching', false, false, true)
ON CONFLICT (from_state, to_state) DO NOTHING;

-- ============================================================
-- accept_ride_request
-- ============================================================
CREATE OR REPLACE FUNCTION public.accept_ride_request(p_request_id uuid)
 RETURNS rides
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_request public.ride_requests;
  v_ride public.rides;
  v_active_count INTEGER;
  v_transition jsonb;
BEGIN
  SELECT * INTO v_request
  FROM public.ride_requests
  WHERE id = p_request_id
    AND status = 'pending'
    AND expires_at > now()
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ride request is no longer available';
  END IF;

  SELECT COUNT(*) INTO v_active_count
  FROM public.rides
  WHERE driver_id = v_request.driver_id
    AND status IN ('accepted', 'arrived', 'in_progress');

  IF v_active_count > 0 THEN
    RAISE EXCEPTION 'Driver already has an active ride';
  END IF;

  -- Lock the ride row for the duration of this transaction so a
  -- concurrent accept on the same ride blocks here, then loses the
  -- status IN (...) check below once it can proceed.
  SELECT * INTO v_ride
  FROM public.rides
  WHERE id = v_request.ride_id
    AND status IN ('requested', 'searching')
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ride already accepted or unavailable';
  END IF;

  UPDATE public.rides
  SET driver_id = v_request.driver_id,
      accepted_at = COALESCE(accepted_at, now())
  WHERE id = v_ride.id;

  v_transition := public.transition_trip_state(
    v_ride.id, 'accepted', v_request.driver_id, 'driver',
    jsonb_build_object('request_id', p_request_id)
  );

  IF NOT (v_transition->>'success')::boolean THEN
    RAISE EXCEPTION 'Could not accept ride: %', v_transition->>'error';
  END IF;

  SELECT * INTO v_ride FROM public.rides WHERE id = v_ride.id;

  UPDATE public.ride_requests
  SET status = CASE WHEN id = p_request_id THEN 'accepted' ELSE 'expired' END,
      responded_at = now()
  WHERE ride_id = v_request.ride_id
    AND status = 'pending';

  INSERT INTO public.ride_events(ride_id, actor_id, event_type, metadata)
  VALUES (
    v_ride.id,
    v_request.driver_id,
    'driver_accepted',
    jsonb_build_object('request_id', p_request_id)
  );

  RETURN v_ride;
END;
$function$;

-- ============================================================
-- driver_arrived
-- ============================================================
CREATE OR REPLACE FUNCTION public.driver_arrived(p_ride_id uuid)
 RETURNS rides
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ride public.rides;
  v_transition jsonb;
BEGIN
  SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ride not found';
  END IF;

  v_transition := public.transition_trip_state(p_ride_id, 'arrived', v_ride.driver_id, 'driver', '{}'::jsonb);

  IF NOT (v_transition->>'success')::boolean THEN
    RAISE EXCEPTION 'Ride cannot be marked as arrived: %', v_transition->>'error';
  END IF;

  UPDATE public.rides SET arrived_at = now() WHERE id = p_ride_id RETURNING * INTO v_ride;

  INSERT INTO public.ride_events(ride_id, actor_id, event_type)
  VALUES (p_ride_id, v_ride.driver_id, 'driver_arrived');

  RETURN v_ride;
END;
$function$;

-- ============================================================
-- start_ride_with_pin
-- ============================================================
CREATE OR REPLACE FUNCTION public.start_ride_with_pin(p_ride_id uuid, p_pin text)
 RETURNS rides
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ride public.rides;
  v_clean_pin text;
  v_transition jsonb;
BEGIN
  v_clean_pin := trim(COALESCE(p_pin, ''));

  SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ride not found';
  END IF;

  IF NOT (
    COALESCE(v_ride.rider_pin::text, '') = v_clean_pin
    OR COALESCE(v_ride.start_pin::text, '') = v_clean_pin
  ) THEN
    RAISE EXCEPTION 'Invalid ride PIN';
  END IF;

  v_transition := public.transition_trip_state(p_ride_id, 'in_progress', v_ride.driver_id, 'driver', '{}'::jsonb);

  IF NOT (v_transition->>'success')::boolean THEN
    RAISE EXCEPTION 'Ride cannot be started: %', v_transition->>'error';
  END IF;

  UPDATE public.rides SET started_at = now() WHERE id = p_ride_id RETURNING * INTO v_ride;

  INSERT INTO public.ride_events(ride_id, actor_id, event_type)
  VALUES (p_ride_id, v_ride.driver_id, 'trip_started');

  RETURN v_ride;
END;
$function$;

-- ============================================================
-- dispatch_ride_to_nearby_drivers
-- (also fixes a latent bug: the old version reset an already-
-- 'searching' ride back to 'requested' whenever a re-dispatch found
-- zero candidate drivers. Now it only advances to 'searching' when
-- drivers are actually found, and leaves the status alone otherwise.)
-- ============================================================
CREATE OR REPLACE FUNCTION public.dispatch_ride_to_nearby_drivers(p_ride_id uuid, p_pickup_lat double precision DEFAULT NULL::double precision, p_pickup_lng double precision DEFAULT NULL::double precision, p_max_drivers integer DEFAULT 5)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ride public.rides;
  v_inserted integer := 0;
  v_transition jsonb;
BEGIN
  SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ride not found';
  END IF;
  IF v_ride.status NOT IN ('requested', 'searching') THEN
    RETURN 0;
  END IF;

  WITH candidate_drivers AS (
    SELECT
      d.id, d.gender, d.rating, d.updated_at, d.preferred_categories,
      dl.latitude, dl.longitude,
      v.vehicle_class_id,
      public.normalize_vehicle_tier(COALESCE(v.vehicle_category, v.vehicle_type)) AS tier
    FROM public.drivers d
    LEFT JOIN public.driver_locations dl ON dl.driver_id = d.id
    LEFT JOIN public.vehicles v ON v.id = d.vehicle_id
    WHERE COALESCE(d.is_online, false) = true
      AND COALESCE(d.can_go_online, true) = true
      AND COALESCE(d.approval_status, 'approved') IN ('approved', 'active')
      AND NOT EXISTS (
        SELECT 1 FROM public.rides active
        WHERE active.driver_id = d.id AND active.status IN ('accepted', 'arrived', 'in_progress')
      )
  )
  INSERT INTO public.ride_requests (
    ride_id, driver_id, status, expires_at, pickup_address, pickup_lat, pickup_lng,
    destination_address, destination_lat, destination_lng, vehicle_class, estimated_fare, payment_method
  )
  SELECT
    v_ride.id, cd.id, 'pending', now() + interval '30 seconds',
    v_ride.pickup_address, COALESCE(v_ride.pickup_lat, p_pickup_lat), COALESCE(v_ride.pickup_lng, p_pickup_lng),
    v_ride.dropoff_address, v_ride.dropoff_lat, v_ride.dropoff_lng,
    COALESCE(v_ride.vehicle_class, v_ride.category_id::TEXT),
    COALESCE(v_ride.estimated_fare, v_ride.fare, 0),
    COALESCE(v_ride.payment_method, 'cash')
  FROM candidate_drivers cd
  WHERE (
    v_ride.vehicle_class IS NULL
    OR (cd.tier IS NULL AND v_ride.vehicle_class IN ('go', 'x'))
    OR v_ride.vehicle_class = ANY(COALESCE(
        cd.preferred_categories,
        NULLIF(public.vehicle_class_eligible_tiers(cd.vehicle_class_id), ARRAY[]::text[]),
        public.default_eligible_ride_tiers(cd.tier)
      ))
    OR (v_ride.vehicle_class = 'women'
        AND lower(COALESCE(cd.gender, '')) = 'female'
        AND cd.tier IN ('go', 'x', 'xl', 'comfort'))
  )
  AND (
    v_ride.vehicle_class NOT IN ('comfort', 'black')
    OR COALESCE(cd.rating, 5.0) >= (CASE v_ride.vehicle_class WHEN 'comfort' THEN 4.5 WHEN 'black' THEN 4.7 ELSE 0 END)
  )
  ORDER BY
    CASE
      WHEN COALESCE(v_ride.pickup_lat, p_pickup_lat) IS NOT NULL
       AND COALESCE(v_ride.pickup_lng, p_pickup_lng) IS NOT NULL
       AND cd.latitude IS NOT NULL AND cd.longitude IS NOT NULL
      THEN ((cd.latitude - COALESCE(v_ride.pickup_lat, p_pickup_lat)) * (cd.latitude - COALESCE(v_ride.pickup_lat, p_pickup_lat)))
         + ((cd.longitude - COALESCE(v_ride.pickup_lng, p_pickup_lng)) * (cd.longitude - COALESCE(v_ride.pickup_lng, p_pickup_lng)))
      ELSE 999999
    END,
    cd.updated_at DESC NULLS LAST
  LIMIT GREATEST(1, p_max_drivers)
  ON CONFLICT (ride_id, driver_id) DO UPDATE
    SET status = 'pending', expires_at = EXCLUDED.expires_at,
        pickup_address = EXCLUDED.pickup_address, pickup_lat = EXCLUDED.pickup_lat, pickup_lng = EXCLUDED.pickup_lng,
        destination_address = EXCLUDED.destination_address, destination_lat = EXCLUDED.destination_lat, destination_lng = EXCLUDED.destination_lng,
        vehicle_class = EXCLUDED.vehicle_class, estimated_fare = EXCLUDED.estimated_fare, payment_method = EXCLUDED.payment_method;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  IF v_inserted > 0 THEN
    v_transition := public.transition_trip_state(p_ride_id, 'searching', NULL, 'system', jsonb_build_object('driver_count', v_inserted));
    -- Not treated as fatal: idempotent no-op if already 'searching'.
  END IF;

  INSERT INTO public.ride_events(ride_id, event_type, metadata)
  VALUES (p_ride_id, CASE WHEN v_inserted > 0 THEN 'dispatch_sent' ELSE 'dispatch_no_drivers' END,
          jsonb_build_object('driver_count', v_inserted));

  RETURN v_inserted;
END;
$function$;
