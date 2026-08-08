-- Bug: the immediate-dispatch path (idle drivers) correctly honors a
-- driver's explicit `preferred_categories` opt-out (e.g. a Go-tier driver
-- who unchecked "WeAfrica Go" in Ride Type Preferences is already excluded
-- from Go requests there). But the busy-driver queuing fallback added by
-- 20260802000100_second_trip_queue_wiring.sql — used when zero idle
-- drivers are found, to queue the ride for the nearest driver who's
-- currently on another trip — never selected `preferred_categories` for
-- busy candidates and fell straight to vehicle_class_eligible_tiers /
-- default_eligible_ride_tiers. A driver who turned Go off could still be
-- queued a Go ride for after they finish their current trip.
--
-- Fix: select and check `preferred_categories` for busy candidates too,
-- with the exact same COALESCE precedence already used for idle
-- candidates. Everything else in the function is unchanged.
--
-- Idempotent — safe to re-run via `psql -f`.

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
  v_queue_driver_id uuid;
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
  ELSE
    -- No idle drivers at all — fall back to queuing the nearest eligible
    -- busy driver (same eligibility rules as above, opposite direction:
    -- only drivers who ARE on an active trip and don't already hold a
    -- queued one). Simple proximity to the new pickup, not real
    -- route-overlap analysis.
    WITH busy_candidates AS (
      SELECT
        d.id, d.gender, d.rating, d.preferred_categories, dl.latitude, dl.longitude,
        v.vehicle_class_id,
        public.normalize_vehicle_tier(COALESCE(v.vehicle_category, v.vehicle_type)) AS tier
      FROM public.drivers d
      JOIN public.rides active ON active.driver_id = d.id AND active.status IN ('accepted', 'arrived', 'in_progress')
      LEFT JOIN public.driver_locations dl ON dl.driver_id = d.id
      LEFT JOIN public.vehicles v ON v.id = d.vehicle_id
      WHERE COALESCE(d.is_online, false) = true
        AND COALESCE(d.approval_status, 'approved') IN ('approved', 'active')
        AND NOT EXISTS (SELECT 1 FROM public.trip_queue tq WHERE tq.driver_id = d.id AND tq.status = 'queued')
    )
    SELECT bc.id INTO v_queue_driver_id
    FROM busy_candidates bc
    WHERE (
      v_ride.vehicle_class IS NULL
      OR (bc.tier IS NULL AND v_ride.vehicle_class IN ('go', 'x'))
      OR v_ride.vehicle_class = ANY(COALESCE(
          bc.preferred_categories,
          NULLIF(public.vehicle_class_eligible_tiers(bc.vehicle_class_id), ARRAY[]::text[]),
          public.default_eligible_ride_tiers(bc.tier)
        ))
      OR (v_ride.vehicle_class = 'women'
          AND lower(COALESCE(bc.gender, '')) = 'female'
          AND bc.tier IN ('go', 'x', 'xl', 'comfort'))
    )
    AND (
      v_ride.vehicle_class NOT IN ('comfort', 'black')
      OR COALESCE(bc.rating, 5.0) >= (CASE v_ride.vehicle_class WHEN 'comfort' THEN 4.5 WHEN 'black' THEN 4.7 ELSE 0 END)
    )
    ORDER BY
      CASE
        WHEN COALESCE(v_ride.pickup_lat, p_pickup_lat) IS NOT NULL
         AND COALESCE(v_ride.pickup_lng, p_pickup_lng) IS NOT NULL
         AND bc.latitude IS NOT NULL AND bc.longitude IS NOT NULL
        THEN ((bc.latitude - COALESCE(v_ride.pickup_lat, p_pickup_lat)) * (bc.latitude - COALESCE(v_ride.pickup_lat, p_pickup_lat)))
           + ((bc.longitude - COALESCE(v_ride.pickup_lng, p_pickup_lng)) * (bc.longitude - COALESCE(v_ride.pickup_lng, p_pickup_lng)))
        ELSE 999999
      END
    LIMIT 1;

    IF v_queue_driver_id IS NOT NULL THEN
      BEGIN
        PERFORM public.queue_next_ride_for_driver(v_queue_driver_id, p_ride_id);
      EXCEPTION WHEN OTHERS THEN
        -- Race condition (driver's active ride just ended, or got queued
        -- by a concurrent call) — not fatal to this rider's dispatch.
        v_queue_driver_id := NULL;
      END;
    END IF;
  END IF;

  INSERT INTO public.ride_events(ride_id, event_type, metadata)
  VALUES (p_ride_id, CASE WHEN v_inserted > 0 THEN 'dispatch_sent' ELSE 'dispatch_no_drivers' END,
          jsonb_build_object('driver_count', v_inserted, 'queued_to_driver_id', v_queue_driver_id));

  RETURN v_inserted;
END;
$function$;
