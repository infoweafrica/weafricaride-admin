-- Relaunches ride categories as WeAfrica Go/X/XL/Comfort/Black/Women.
-- Consolidates five previously-disconnected vocabularies (ride_categories,
-- pricing_config, hardcoded admin-dashboard strings, hardcoded rider-app
-- strings, and unconstrained vehicles.vehicle_type/vehicle_category text)
-- onto one canonical slug set: go/x/xl/comfort/black/women.
--
-- Idempotent — every statement uses CREATE OR REPLACE / DROP IF EXISTS /
-- ON CONFLICT / delete-then-insert, safe to re-run via `psql -f`.

-- ── 1. ride_categories: retire stray rows, upsert the 6 canonical ones ──
UPDATE public.ride_categories
SET is_active = false
WHERE slug NOT IN ('go', 'x', 'xl', 'comfort', 'black', 'women');

INSERT INTO public.ride_categories (name, slug, description, icon, sort_order, is_active)
VALUES
  ('WeAfrica Go',      'go',      'Affordable everyday rides in economy hatchbacks',          'go',      1, true),
  ('WeAfrica X',       'x',       'Standard sedans — our most popular ride',                  'x',       2, true),
  ('WeAfrica XL',      'xl',      'SUVs and vans with room for 6-7',                          'xl',      3, true),
  ('WeAfrica Comfort', 'comfort', 'Newer, roomier cars with our highest-rated drivers',       'comfort', 4, true),
  ('WeAfrica Black',   'black',   'Premium executive rides with our top-rated drivers',       'black',   5, true),
  ('WeAfrica Women',   'women',   'Women riders matched with women drivers, where available', 'women',   6, true)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  icon = EXCLUDED.icon,
  sort_order = EXCLUDED.sort_order,
  is_active = EXCLUDED.is_active;

-- ── 2. pricing_config: retire stale per-city car-tier rows that predate ──
-- the relaunch and collide with the new national rows below (same
-- vehicle_type, no deterministic tiebreak in compute_fare_estimate's
-- query between a city-specific row and a city IS NULL row). boda/delivery
-- are a different vertical entirely — left untouched.
UPDATE public.pricing_config
SET is_active = false
WHERE city IS NOT NULL
  AND vehicle_type IN ('economy', 'comfort', 'xl', 'luxury');

-- ── 3. pricing_config: seed MW/national rates for the 6 categories + fallback ──
DELETE FROM public.pricing_config
WHERE country_code = 'MW' AND city IS NULL
  AND vehicle_type IN ('go', 'x', 'xl', 'comfort', 'black', 'women', 'all');

INSERT INTO public.pricing_config
  (country_code, city, vehicle_type, base_fare, minimum_fare, per_km, per_min, commission_percent, currency, is_active)
VALUES
  ('MW', NULL, 'go',      1000, 1500, 350, 40, 20.00, 'MWK', true),
  ('MW', NULL, 'x',       1200, 1800, 400, 45, 20.00, 'MWK', true),
  ('MW', NULL, 'xl',      1500, 2200, 480, 55, 20.00, 'MWK', true),
  ('MW', NULL, 'comfort', 1800, 2600, 550, 60, 20.00, 'MWK', true),
  ('MW', NULL, 'black',   2500, 3500, 650, 70, 20.00, 'MWK', true),
  ('MW', NULL, 'women',   1200, 1800, 400, 45, 20.00, 'MWK', true),
  ('MW', NULL, 'all',     1200, 1800, 400, 45, 20.00, 'MWK', true);

-- ── 4. Vehicle-tier normalizer — maps every legacy/new value onto the 6 slugs ──
CREATE OR REPLACE FUNCTION public.normalize_vehicle_tier(p_raw text)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE lower(coalesce(p_raw, ''))
    WHEN 'go' THEN 'go'
    WHEN 'economy' THEN 'go'
    WHEN 'x' THEN 'x'
    WHEN 'weafrica_x' THEN 'x'
    WHEN 'sedan' THEN 'x'
    WHEN 'xl' THEN 'xl'
    WHEN 'weafrica_xl' THEN 'xl'
    WHEN 'suv' THEN 'xl'
    WHEN 'van' THEN 'xl'
    WHEN 'weafrica_van' THEN 'xl'
    WHEN 'shuttle' THEN 'xl'
    WHEN 'weafrica_shuttle' THEN 'xl'
    WHEN 'comfort' THEN 'comfort'
    WHEN 'black' THEN 'black'
    WHEN 'luxury' THEN 'black'
    WHEN 'weafrica_black' THEN 'black'
    WHEN 'women' THEN 'women'
    WHEN 'weafrica_women' THEN 'women'
    WHEN 'women_only' THEN 'women'
    ELSE NULL
  END;
$$;

GRANT EXECUTE ON FUNCTION public.normalize_vehicle_tier(text) TO anon, authenticated, service_role;

-- ── 5. One-time backfill: canonicalize vehicles.vehicle_category ──
UPDATE public.vehicles
SET vehicle_category = public.normalize_vehicle_tier(COALESCE(vehicle_category, vehicle_type))
WHERE public.normalize_vehicle_tier(COALESCE(vehicle_category, vehicle_type)) IS NOT NULL
  AND vehicle_category IS DISTINCT FROM public.normalize_vehicle_tier(COALESCE(vehicle_category, vehicle_type));

-- ── 6. Fix book_rider_trip's ambiguous-overload landmine ──
-- Two CREATE FUNCTION definitions existed, differing only by p_duration_min
-- being `integer` (real, working) vs `numeric` (stub, `RETURN NULL`).
-- Drop the broken stub outright.
DROP FUNCTION IF EXISTS public.book_rider_trip(
  uuid, uuid, text, text, double precision, double precision, text,
  double precision, double precision, text, numeric, numeric, numeric, text
);

-- Re-affirm the real one, updating only the terminal fallback slug.
CREATE OR REPLACE FUNCTION public.book_rider_trip(
  p_rider_id uuid,
  p_category_id uuid DEFAULT NULL,
  p_vehicle_class text DEFAULT NULL,
  p_pickup_address text DEFAULT 'Current Location',
  p_pickup_lat double precision DEFAULT NULL,
  p_pickup_lng double precision DEFAULT NULL,
  p_dropoff_address text DEFAULT '',
  p_dropoff_lat double precision DEFAULT NULL,
  p_dropoff_lng double precision DEFAULT NULL,
  p_payment_method text DEFAULT 'cash',
  p_estimated_fare numeric DEFAULT 0,
  p_distance_km numeric DEFAULT NULL,
  p_duration_min integer DEFAULT NULL,
  p_promo_code text DEFAULT NULL
) RETURNS public.rides
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_ride public.rides;
  v_vehicle_class TEXT;
  v_rider_user_id UUID;
BEGIN
  IF p_rider_id IS NULL THEN
    RAISE EXCEPTION 'Rider profile is required';
  END IF;

  SELECT user_id INTO v_rider_user_id
  FROM public.riders
  WHERE id = p_rider_id;

  IF v_rider_user_id IS NULL THEN
    RAISE EXCEPTION 'Rider profile not found';
  END IF;

  SELECT COALESCE(p_vehicle_class, rc.slug, rc.name, 'x')
  INTO v_vehicle_class
  FROM public.ride_categories rc
  WHERE rc.id = p_category_id;

  v_vehicle_class := COALESCE(v_vehicle_class, p_vehicle_class, 'x');

  INSERT INTO public.rides (
    rider_id,
    category_id,
    vehicle_class,
    status,
    payment_method,
    payment_status,
    estimated_fare,
    fare,
    pickup_address,
    pickup_lat,
    pickup_lng,
    dropoff_address,
    dropoff_lat,
    dropoff_lng,
    destination_address,
    destination_lat,
    destination_lng,
    estimated_distance_km,
    distance_km,
    estimated_duration_minutes,
    duration_min,
    promo_code,
    requested_at,
    updated_at
  ) VALUES (
    p_rider_id,
    p_category_id,
    v_vehicle_class,
    'requested',
    COALESCE(NULLIF(p_payment_method, ''), 'cash'),
    'pending',
    COALESCE(p_estimated_fare, 0),
    COALESCE(p_estimated_fare, 0),
    COALESCE(NULLIF(p_pickup_address, ''), 'Current Location'),
    p_pickup_lat,
    p_pickup_lng,
    COALESCE(p_dropoff_address, ''),
    p_dropoff_lat,
    p_dropoff_lng,
    COALESCE(p_dropoff_address, ''),
    p_dropoff_lat,
    p_dropoff_lng,
    p_distance_km,
    p_distance_km,
    p_duration_min,
    p_duration_min,
    NULLIF(p_promo_code, ''),
    now(),
    now()
  )
  RETURNING * INTO v_ride;

  INSERT INTO public.ride_events(ride_id, actor_id, event_type, metadata)
  VALUES (
    v_ride.id,
    v_rider_user_id,
    'rider_requested',
    jsonb_build_object(
      'source', 'rider_app',
      'payment_method', COALESCE(NULLIF(p_payment_method, ''), 'cash'),
      'estimated_fare', COALESCE(p_estimated_fare, 0)
    )
  );

  BEGIN
    PERFORM public.dispatch_ride_to_nearby_drivers(
      v_ride.id,
      p_pickup_lat,
      p_pickup_lng,
      5
    );

    SELECT * INTO v_ride FROM public.rides WHERE id = v_ride.id;
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.ride_events(ride_id, actor_id, event_type, metadata)
    VALUES (
      v_ride.id,
      v_rider_user_id,
      'dispatch_error',
      jsonb_build_object('message', SQLERRM)
    );
  END;

  RETURN v_ride;
END;
$$;

-- ── 7. New estimate_fare RPC — the function rider-app already calls but ──
-- didn't exist. Delegates to the existing, fully-built compute_fare_estimate.
CREATE OR REPLACE FUNCTION public.estimate_fare(
  p_pickup_lat double precision,
  p_pickup_lng double precision,
  p_dropoff_lat double precision,
  p_dropoff_lng double precision,
  p_ride_type text DEFAULT 'go'
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_city text;
  v_distance_km double precision;
  v_duration_min integer;
  v_result jsonb;
BEGIN
  v_distance_km := 6371 * 2 * asin(sqrt(
    power(sin(radians(p_dropoff_lat - p_pickup_lat) / 2), 2) +
    cos(radians(p_pickup_lat)) * cos(radians(p_dropoff_lat)) *
    power(sin(radians(p_dropoff_lng - p_pickup_lng) / 2), 2)
  ));
  v_duration_min := GREATEST(5, (v_distance_km / 28.0 * 60)::integer);
  v_city := public.find_nearest_city(p_pickup_lat, p_pickup_lng);

  v_result := public.compute_fare_estimate(
    'MW',
    v_city,
    COALESCE(NULLIF(public.normalize_vehicle_tier(p_ride_type), ''), 'go'),
    v_distance_km::numeric,
    v_duration_min,
    (CURRENT_TIME >= TIME '22:00' OR CURRENT_TIME < TIME '05:00')
  );

  RETURN v_result || jsonb_build_object(
    'fare', v_result->>'total',
    'estimated_fare', v_result->>'total',
    'distance_km', v_distance_km,
    'duration_min', v_duration_min,
    'city', v_city
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.estimate_fare(double precision, double precision, double precision, double precision, text)
  TO anon, authenticated, service_role;

-- ── 8. dispatch_ride_to_nearby_drivers — add vehicle-tier/gender/rating gating ──
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
      d.id, d.gender, d.rating, d.updated_at,
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
