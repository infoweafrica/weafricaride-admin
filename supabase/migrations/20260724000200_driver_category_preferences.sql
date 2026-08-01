-- Lets a driver opt into receiving ride requests for tiers other than their
-- vehicle's own tier (e.g. a Black-tier car opting in to also accept X/XL
-- requests). Backward-compatible: a driver with no preferences set keeps
-- today's exact-tier-only matching behavior.
--
-- Idempotent — safe to re-run via `psql -f`.

ALTER TABLE public.drivers
  ADD COLUMN IF NOT EXISTS preferred_categories text[];

CREATE OR REPLACE FUNCTION public.dispatch_ride_to_nearby_drivers(
  p_ride_id uuid,
  p_pickup_lat double precision DEFAULT NULL,
  p_pickup_lng double precision DEFAULT NULL,
  p_max_drivers integer DEFAULT 5
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_ride public.rides;
  v_inserted integer := 0;
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
    OR cd.tier = v_ride.vehicle_class
    OR v_ride.vehicle_class = ANY(COALESCE(cd.preferred_categories, ARRAY[]::text[]))
    OR (v_ride.vehicle_class = 'women' AND cd.tier IN ('go', 'x')
        AND lower(COALESCE(cd.gender, '')) = 'female')
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

  UPDATE public.rides
  SET status = CASE WHEN v_inserted > 0 THEN 'searching' ELSE 'requested' END, updated_at = now()
  WHERE id = p_ride_id;

  INSERT INTO public.ride_events(ride_id, event_type, metadata)
  VALUES (p_ride_id, CASE WHEN v_inserted > 0 THEN 'dispatch_sent' ELSE 'dispatch_no_drivers' END,
          jsonb_build_object('driver_count', v_inserted));

  RETURN v_inserted;
END;
$$;
