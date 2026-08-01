-- ============================================================
-- DRIVER MATCHING ALGORITHM — Atomic, radius-expanding dispatch
-- ============================================================

-- 1. ADD PostGIS extension (if not already enabled)
CREATE EXTENSION IF NOT EXISTS postgis;

-- 2. ADD geography column for spatial indexing on drivers
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS geo_location GEOGRAPHY(POINT);

-- Update geo_location whenever lat/lng changes
CREATE OR REPLACE FUNCTION update_driver_geo_location()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.current_lat IS NOT NULL AND NEW.current_lng IS NOT NULL THEN
        NEW.geo_location := ST_SetSRID(
            ST_MakePoint(NEW.current_lng, NEW.current_lat), 4326
        )::GEOGRAPHY;
        NEW.last_location_update := NOW();
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_update_driver_geo ON drivers;
CREATE TRIGGER trg_update_driver_geo
    BEFORE INSERT OR UPDATE OF current_lat, current_lng ON drivers
    FOR EACH ROW
    EXECUTE FUNCTION update_driver_geo_location();

-- Spatial index for fast radius queries
CREATE INDEX IF NOT EXISTS idx_drivers_geo_location ON drivers USING GIST (geo_location);

-- ============================================================
-- 3. ATOMIC DRIVER MATCHING FUNCTION
--    Prevents double-booking by updating the ride atomically.
--    Uses expanding radius search with weighted scoring.
-- ============================================================
CREATE OR REPLACE FUNCTION find_nearest_drivers(
    p_pickup_lat DOUBLE PRECISION,
    p_pickup_lng DOUBLE PRECISION,
    p_vehicle_types TEXT[] DEFAULT ARRAY['car', 'suv', 'van', 'bus'],
    p_max_drivers INTEGER DEFAULT 5,
    p_max_radius_meters DOUBLE PRECISION DEFAULT 10000  -- 10 km max
)
RETURNS TABLE(
    driver_id UUID,
    user_id UUID,
    driver_name TEXT,
    distance_km DOUBLE PRECISION,
    rating NUMERIC,
    acceptance_rate NUMERIC,
    vehicle_make TEXT,
    vehicle_model TEXT,
    license_plate TEXT,
    score DOUBLE PRECISION
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_pickup GEOGRAPHY;
BEGIN
    v_pickup := ST_SetSRID(ST_MakePoint(p_pickup_lng, p_pickup_lat), 4326)::GEOGRAPHY;

    RETURN QUERY
    WITH ranked AS (
        SELECT
            d.id AS drv_id,
            d.user_id AS usr_id,
            COALESCE(u.name, u.phone) AS drv_name,
            ROUND((ST_Distance(d.geo_location, v_pickup) / 1000.0)::numeric, 2) AS dist_km,
            COALESCE(d.rating, 0) AS drv_rating,
            COALESCE(d.acceptance_rate, 0) AS acc_rate,
            v.make AS v_make,
            v.model AS v_model,
            v.license_plate AS v_plate,
            -- Weighted score: distance (40%) + rating (25%) + acceptance (20%) + earnings fairness (10%) + surge (5%)
            ROUND(
                (0.40 * (1.0 - LEAST(ST_Distance(d.geo_location, v_pickup) / p_max_radius_meters, 1.0))) +
                (0.25 * COALESCE(d.rating, 0) / 5.0) +
                (0.20 * COALESCE(d.acceptance_rate, 0)) +
                (0.10 * (1.0 - LEAST(COALESCE(d.daily_earnings, 0) / NULLIF(COALESCE(d.daily_goal, 500), 0), 1.0))) +
                (0.05 * 1.0)
            , 4)::DOUBLE PRECISION AS sc
        FROM drivers d
        JOIN users u ON u.id = d.user_id
        LEFT JOIN vehicles v ON v.driver_id = d.id AND v.verified = true
        WHERE d.status = 'online'
          AND d.is_suspended = false
          AND d.geo_location IS NOT NULL
          AND ST_DWithin(d.geo_location, v_pickup, p_max_radius_meters)
          AND EXISTS (
              SELECT 1 FROM vehicles veh
              WHERE veh.driver_id = d.id
                AND veh.vehicle_type = ANY(p_vehicle_types)
                AND veh.verified = true
          )
        ORDER BY sc DESC
        LIMIT p_max_drivers
    )
    SELECT * FROM ranked;
END;
$$;

-- ============================================================
-- 4. ATOMIC RIDE DISPATCH — multi-round expanding radius
--    Assigns driver atomically to prevent double-booking.
--    Called by the request_ride RPC.
-- ============================================================
CREATE OR REPLACE FUNCTION dispatch_ride_to_drivers(
    p_ride_id UUID,
    p_pickup_lat DOUBLE PRECISION,
    p_pickup_lng DOUBLE PRECISION,
    p_vehicle_type TEXT DEFAULT 'car',
    p_max_rounds INTEGER DEFAULT 5,
    p_round_delay_seconds INTEGER DEFAULT 15
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_round INTEGER := 0;
    v_radius DOUBLE PRECISION := 3000; -- Start at 3 km
    v_surge DOUBLE PRECISION := 1.0;
    v_driver RECORD;
    v_requests_sent INTEGER := 0;
    v_request_id UUID;
    v_ride_status TEXT;
BEGIN
    -- Verify ride exists and is in searching state
    SELECT status INTO v_ride_status FROM rides WHERE id = p_ride_id;
    IF v_ride_status != 'searching' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Ride is not in searching state', 'code', 'NOT_SEARCHING');
    END IF;

    -- Multi-round dispatch with expanding radius
    WHILE v_round < p_max_rounds LOOP
        v_round := v_round + 1;

        -- Find drivers in current radius
        FOR v_driver IN (
            SELECT * FROM find_nearest_drivers(
                p_pickup_lat,
                p_pickup_lng,
                ARRAY[p_vehicle_type],
                5,
                v_radius
            )
        ) LOOP
            -- Create ride request atomically
            INSERT INTO ride_requests (
                ride_id, driver_id, pickup_lat, pickup_lng,
                pickup_address, destination_lat, destination_lng,
                destination_address, vehicle_class,
                estimated_fare, status, expires_at
            )
            SELECT
                r.id, v_driver.driver_id, r.pickup_lat, r.pickup_lng,
                r.pickup_address, r.dropoff_lat, r.dropoff_lng,
                r.dropoff_address, r.ride_type,
                r.total_fare, 'pending',
                NOW() + INTERVAL '30 seconds'
            FROM rides r WHERE r.id = p_ride_id
            ON CONFLICT DO NOTHING
            RETURNING id INTO v_request_id;

            IF FOUND THEN
                v_requests_sent := v_requests_sent + 1;
            END IF;
        END LOOP;

        -- If we sent requests, stop expanding (let drivers accept/reject)
        IF v_requests_sent > 0 THEN
            RETURN jsonb_build_object(
                'success', true,
                'round', v_round,
                'radius_meters', v_radius,
                'requests_sent', v_requests_sent,
                'surge_multiplier', v_surge
            );
        END IF;

        -- Expand radius for next round
        v_radius := LEAST(v_radius + 2000, 10000.0); -- +2km each round, max 10km
        v_surge := 1.0 + (v_round * 0.1); -- +10% surge each round
    END LOOP;

    -- No drivers found after all rounds — auto-cancel the ride
    PERFORM transition_trip_state(
        p_ride_id,
        'no_driver_found',
        NULL,
        'system',
        jsonb_build_object(
            'rounds_attempted', v_round,
            'max_radius', v_radius
        )
    );

    RETURN jsonb_build_object(
        'success', false,
        'error', 'No drivers available after all rounds',
        'code', 'NO_DRIVERS',
        'rounds_attempted', v_round,
        'max_radius_meters', v_radius
    );
END;
$$;

-- ============================================================
-- 5. DRIVER ACCEPTANCE TIMEOUT — auto-expire stale requests
--    Runs as a scheduled job or trigger.
-- ============================================================
CREATE OR REPLACE FUNCTION expire_stale_ride_requests()
RETURNS TABLE(request_id UUID, ride_id UUID, was_reassigned BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_request RECORD;
    v_reassigned BOOLEAN;
BEGIN
    FOR v_request IN (
        SELECT rr.id AS req_id, rr.ride_id AS rd_id
        FROM ride_requests rr
        WHERE rr.status = 'pending'
          AND rr.expires_at < NOW()
    ) LOOP
        -- Mark this request as expired
        UPDATE ride_requests SET status = 'expired'
        WHERE id = v_request.req_id;

        -- If ride is still searching, try reassigning
        v_reassigned := false;

        IF EXISTS (SELECT 1 FROM rides WHERE id = v_request.rd_id AND status = 'searching') THEN
            -- Re-dispatch with expanded radius
            PERFORM dispatch_ride_to_drivers(v_request.rd_id, 0, 0);
            v_reassigned := true;
        END IF;

        request_id := v_request.req_id;
        ride_id := v_request.rd_id;
        was_reassigned := v_reassigned;
        RETURN NEXT;
    END LOOP;
END;
$$;

-- ============================================================
-- 6. PREVENT DOUBLE-BOOKING: a driver can only have one active ride
-- ============================================================
CREATE OR REPLACE FUNCTION check_driver_has_active_ride()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM rides
        WHERE driver_id = NEW.driver_id
          AND status IN ('assigned', 'accepted', 'en_route', 'arrived', 'picked_up', 'in_progress')
          AND id != COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::UUID)
    ) THEN
        RAISE EXCEPTION 'Driver already has an active ride' USING ERRCODE = '23000';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_double_booking ON rides;
CREATE CONSTRAINT TRIGGER trg_prevent_double_booking
    AFTER INSERT OR UPDATE OF driver_id, status ON rides
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW
    EXECUTE FUNCTION check_driver_has_active_ride();