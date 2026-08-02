-- ============================================================
-- Minimal wiring for the second/queued-trip feature.
--
-- Found while building the rider-facing UI for this: nothing anywhere
-- called queue_next_ride_for_driver() (dispatch never queues a busy
-- driver), and accepting a queued ride didn't actually activate it
-- (trip_queue.status flips to 'accepted' but rides.driver_id/status
-- never follow — acceptQueuedRide()'s own code comment claims a
-- "ride channel listener" handles it; no such trigger existed). The
-- whole feature was dormant end-to-end, not just non-route-aware.
--
-- This wires the minimum needed for it to actually function, using
-- the same non-route-aware proximity heuristic already used for
-- normal dispatch (not new route-overlap matching, which is a
-- separate, bigger project):
--   1. dispatch_ride_to_nearby_drivers: when zero idle drivers are
--      found, fall back to queuing the nearest eligible BUSY driver
--      (accepted/arrived/in_progress, not already holding a queued
--      ride) instead of just giving up.
--   2. complete_ride: after a driver completes their current trip,
--      check whether they're holding an 'accepted' queued ride and,
--      if so, activate it (assign driver_id, transition through the
--      guard) — mirrors accept_ride_request's own locking/validation.
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
        d.id, d.gender, d.rating, dl.latitude, dl.longitude,
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

-- ============================================================
-- Activate a queued ride when the driver completes their current one
-- ============================================================
CREATE OR REPLACE FUNCTION public.complete_ride(p_ride_id uuid, p_driver_lat numeric DEFAULT NULL::numeric, p_driver_lng numeric DEFAULT NULL::numeric)
 RETURNS rides
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_ride public.rides;
    v_payment_result jsonb;
    v_distance_to_destination DECIMAL(8,2);
    v_destination_lat DECIMAL(10,7);
    v_destination_lng DECIMAL(10,7);
    v_completion_ok BOOLEAN := true;
    v_transition jsonb;
    v_queued RECORD;
BEGIN
    SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id AND status = 'in_progress' FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Ride cannot be completed';
    END IF;

    v_transition := public.transition_trip_state(p_ride_id, 'completed', v_ride.driver_id, 'driver', '{}'::jsonb);

    IF NOT (v_transition->>'success')::boolean THEN
        RAISE EXCEPTION 'Ride cannot be completed: %', v_transition->>'error';
    END IF;

    UPDATE public.rides
    SET completed_at = now(),
        final_fare = COALESCE(final_fare, actual_fare, estimated_fare),
        actual_fare = COALESCE(actual_fare, final_fare, estimated_fare),
        driver_completion_lat = COALESCE(p_driver_lat, driver_completion_lat),
        driver_completion_lng = COALESCE(p_driver_lng, driver_completion_lng)
    WHERE id = p_ride_id
    RETURNING * INTO v_ride;

    -- Verify driver is near destination (fraud protection)
    v_destination_lat := COALESCE(p_driver_lat, v_ride.driver_completion_lat);
    v_destination_lng := COALESCE(p_driver_lng, v_ride.driver_completion_lng);

    IF v_destination_lat IS NOT NULL AND v_destination_lng IS NOT NULL
       AND v_ride.dropoff_lat IS NOT NULL AND v_ride.dropoff_lng IS NOT NULL THEN
        SELECT
            6371 * 2 * ASIN(SQRT(
                POWER(SIN(RADIANS(v_destination_lat - v_ride.dropoff_lat) / 2), 2) +
                COS(RADIANS(v_ride.dropoff_lat)) * COS(RADIANS(v_destination_lat)) *
                POWER(SIN(RADIANS(v_destination_lng - v_ride.dropoff_lng) / 2), 2)
            )) INTO v_distance_to_destination;

        IF v_distance_to_destination > 0.5 THEN
            v_completion_ok := false;
            INSERT INTO public.fraud_flags (ride_id, flag_type, severity, description)
            VALUES (
                p_ride_id, 'completion_far_from_destination', 'medium',
                'Driver was ' || ROUND(v_distance_to_destination, 2) || ' km from destination at completion time'
            );
        END IF;
    END IF;

    UPDATE public.rides SET completion_verified = v_completion_ok
    WHERE id = p_ride_id;

    INSERT INTO public.ride_events(ride_id, actor_id, event_type, metadata)
    VALUES (p_ride_id, v_ride.driver_id, 'trip_completed',
        jsonb_build_object(
            'verified', v_completion_ok,
            'distance_to_destination_km', v_distance_to_destination
        ));

    BEGIN
        SELECT public.process_ride_payment(p_ride_id) INTO v_payment_result;
    EXCEPTION WHEN OTHERS THEN
        INSERT INTO public.ride_events(ride_id, actor_id, event_type, metadata)
        VALUES (
            p_ride_id,
            v_ride.driver_id,
            'payment_processing_failed',
            jsonb_build_object('error', SQLERRM)
        );
    END;

    BEGIN
        PERFORM public.generate_ride_invoice(p_ride_id);
    EXCEPTION WHEN OTHERS THEN
        NULL;
    END;

    -- Activate a queued next ride, if this driver has one confirmed.
    BEGIN
        SELECT * INTO v_queued FROM public.trip_queue
        WHERE driver_id = v_ride.driver_id AND status = 'accepted'
        ORDER BY queued_at ASC LIMIT 1;

        IF FOUND THEN
            UPDATE public.rides
            SET driver_id = v_ride.driver_id,
                accepted_at = COALESCE(accepted_at, now())
            WHERE id = v_queued.ride_id
              AND status IN ('requested', 'searching')
              AND driver_id IS NULL;

            IF FOUND THEN
                v_transition := public.transition_trip_state(v_queued.ride_id, 'accepted', v_ride.driver_id, 'driver', jsonb_build_object('activated_from_queue', true));
                IF (v_transition->>'success')::boolean THEN
                    UPDATE public.trip_queue SET status = 'activated' WHERE id = v_queued.id;
                ELSE
                    UPDATE public.rides SET driver_id = NULL WHERE id = v_queued.ride_id AND driver_id = v_ride.driver_id;
                    UPDATE public.trip_queue SET status = 'expired' WHERE id = v_queued.id;
                END IF;
            ELSE
                -- Rider's ride moved on (cancelled etc.) while queued.
                UPDATE public.trip_queue SET status = 'expired' WHERE id = v_queued.id;
            END IF;
        END IF;
    EXCEPTION WHEN OTHERS THEN
        NULL;
    END;

    SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id;

    RETURN v_ride;
END;
$function$;
