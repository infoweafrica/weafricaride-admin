-- ============================================================
-- CHAOS TEST HARNESS — Load simulator, failure injection,
-- full lifecycle validator, and observability foundation
-- ============================================================

-- ============================================================
-- 1. OBSERVABILITY: Trip transition metrics view
-- ============================================================
CREATE OR REPLACE VIEW trip_transition_metrics AS
SELECT
    te.previous_state || ' → ' || te.new_state AS transition,
    te.actor_type,
    COUNT(*) AS count,
    COUNT(*) FILTER (WHERE te.created_at > NOW() - INTERVAL '1 hour') AS last_hour,
    COUNT(*) FILTER (WHERE te.created_at > NOW() - INTERVAL '24 hours') AS last_24h,
    ROUND(
        AVG(EXTRACT(EPOCH FROM (
            LEAD(te.created_at) OVER (PARTITION BY te.trip_id ORDER BY te.event_version) - te.created_at
        )))::numeric, 1
    ) AS avg_seconds_to_next_state
FROM trip_events te
GROUP BY te.previous_state, te.new_state, te.actor_type
ORDER BY count DESC;

-- ============================================================
-- 2. OBSERVABILITY: Dispatch success rate per radius
-- ============================================================
CREATE OR REPLACE VIEW dispatch_metrics AS
SELECT
    COALESCE(
        (r.metadata->>'radius_meters')::INTEGER,
        3000
    ) AS radius_meters,
    (r.metadata->>'round')::INTEGER AS dispatch_round,
    COUNT(*) AS total_dispatches,
    COUNT(*) FILTER (WHERE r.new_state = 'assigned') AS successful,
    COUNT(*) FILTER (WHERE r.new_state = 'no_driver_found') AS failed,
    ROUND(
        COUNT(*) FILTER (WHERE r.new_state = 'assigned')::DECIMAL / NULLIF(COUNT(*), 0) * 100, 1
    ) AS success_rate_pct
FROM trip_events r
WHERE r.event_type = 'state_transition'
  AND r.previous_state = 'searching'
  AND r.new_state IN ('assigned', 'no_driver_found', 'expired')
GROUP BY 1, 2
ORDER BY radius_meters, dispatch_round;

-- ============================================================
-- 3. OBSERVABILITY: Wallet health — balance distribution
-- ============================================================
CREATE OR REPLACE VIEW wallet_health AS
SELECT
    COUNT(*) AS total_wallets,
    COUNT(*) FILTER (WHERE balance < 0) AS negative_balances,
    COUNT(*) FILTER (WHERE balance = 0) AS zero_balances,
    COUNT(*) FILTER (WHERE balance > 0) AS positive_balances,
    ROUND(AVG(balance)::numeric, 2) AS avg_balance,
    ROUND(SUM(balance)::numeric, 2) AS total_balance,
    ROUND(SUM(total_earned)::numeric, 2) AS total_earned_all
FROM wallets;

-- ============================================================
-- 4. OBSERVABILITY: Fraud detection signals
-- ============================================================
CREATE OR REPLACE VIEW fraud_signals AS
SELECT
    'Rider: >5 cancels in 1h' AS signal_type,
    u.id AS user_id,
    u.phone,
    COUNT(*) AS count
FROM users u
JOIN ride_events re ON re.actor_id = u.id
WHERE re.event_type = 'state_transition'
  AND re.new_state = 'rider_cancelled'
  AND re.created_at > NOW() - INTERVAL '1 hour'
GROUP BY u.id, u.phone
HAVING COUNT(*) > 5

UNION ALL

SELECT
    'Driver: >30 trips in 6h',
    u.id,
    u.phone,
    COUNT(*) AS count
FROM users u
JOIN ride_events re ON re.actor_id = u.id
WHERE re.event_type = 'state_transition'
  AND re.new_state = 'completed'
  AND re.created_at > NOW() - INTERVAL '6 hours'
GROUP BY u.id, u.phone
HAVING COUNT(*) > 30

UNION ALL

SELECT
    'Driver: no GPS update in 2min',
    d.user_id,
    u.phone,
    EXTRACT(EPOCH FROM (NOW() - d.last_location_update))::INTEGER AS count
FROM drivers d
JOIN users u ON u.id = d.user_id
WHERE d.status = 'online'
  AND d.last_location_update < NOW() - INTERVAL '2 minutes';

-- ============================================================
-- 5. CHAOS TEST: Seed simulation data
--    Creates synthetic riders + drivers for load testing
-- ============================================================
CREATE OR REPLACE FUNCTION seed_simulation_data(
    p_rider_count INTEGER DEFAULT 100,
    p_driver_count INTEGER DEFAULT 50,
    p_city_lat DOUBLE PRECISION DEFAULT -15.7865,  -- Blantyre
    p_city_lng DOUBLE PRECISION DEFAULT 35.0054,
    p_spread_km DOUBLE PRECISION DEFAULT 10.0     -- 10 km spread
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    i INTEGER;
    v_user_id UUID;
    v_driver_id UUID;
    v_lat DOUBLE PRECISION;
    v_lng DOUBLE PRECISION;
    riders_created INTEGER := 0;
    drivers_created INTEGER := 0;
    vehicles_created INTEGER := 0;
BEGIN
    -- Create synthetic riders
    FOR i IN 1..p_rider_count LOOP
        v_user_id := gen_random_uuid();

        INSERT INTO users (id, phone, name, role, verified, created_at)
        VALUES (
            v_user_id,
            '+265888' || LPAD(FLOOR(RANDOM() * 1000000)::TEXT, 6, '0'),
            'Test Rider ' || i,
            'rider',
            true,
            NOW() - (RANDOM() * INTERVAL '365 days')
        )
        ON CONFLICT (phone) DO NOTHING;
        -- Wallet auto-created by trigger
        riders_created := riders_created + 1;
    END LOOP;

    -- Create synthetic drivers
    FOR i IN 1..p_driver_count LOOP
        v_user_id := gen_random_uuid();
        v_driver_id := gen_random_uuid();

        -- Random location within city spread
        v_lat := p_city_lat + (RANDOM() - 0.5) * (p_spread_km / 111.32);
        v_lng := p_city_lng + (RANDOM() - 0.5) * (p_spread_km / (111.32 * COS(RADIANS(p_city_lat))));

        INSERT INTO users (id, phone, name, role, verified, created_at)
        VALUES (
            v_user_id,
            '+265999' || LPAD(FLOOR(RANDOM() * 1000000)::TEXT, 6, '0'),
            'Test Driver ' || i,
            'driver',
            true,
            NOW() - (RANDOM() * INTERVAL '365 days')
        )
        ON CONFLICT (phone) DO NOTHING;

        INSERT INTO drivers (
            id, user_id, status, rating, trips_completed,
            acceptance_rate, cancellation_rate,
            account_verified, vehicle_verified, insurance_verified,
            current_lat, current_lng, daily_goal,
            daily_earnings, weekly_earnings
        ) VALUES (
            v_driver_id, v_user_id, 'online',
            ROUND((3.5 + RANDOM() * 1.5)::numeric, 2),
            FLOOR(RANDOM() * 500)::INTEGER,
            ROUND((0.5 + RANDOM() * 0.5)::numeric, 2),
            ROUND((RANDOM() * 0.15)::numeric, 2),
            true, true, true,
            v_lat, v_lng, 500,
            ROUND((RANDOM() * 300)::numeric, 2),
            ROUND((RANDOM() * 3000)::numeric, 2)
        )
        ON CONFLICT DO NOTHING;

        -- Create vehicle for each driver
        INSERT INTO vehicles (driver_id, make, model, year, license_plate, color, vehicle_type, verified)
        VALUES (
            v_driver_id,
            (ARRAY['Toyota', 'Honda', 'Nissan', 'Hyundai', 'Suzuki'])[FLOOR(1 + RANDOM() * 5)],
            (ARRAY['Corolla', 'Civic', 'Almera', 'i10', 'Swift'])[FLOOR(1 + RANDOM() * 5)],
            2018 + FLOOR(RANDOM() * 6)::INTEGER,
            'MN ' || LPAD(FLOOR(RANDOM() * 9999)::TEXT, 4, '0'),
            (ARRAY['White', 'Silver', 'Black', 'Blue', 'Red'])[FLOOR(1 + RANDOM() * 5)],
            (ARRAY['car', 'suv', 'car', 'car', 'car'])[FLOOR(1 + RANDOM() * 5)],
            true
        )
        ON CONFLICT (license_plate) DO NOTHING;

        drivers_created := drivers_created + 1;
        vehicles_created := vehicles_created + 1;
    END LOOP;

    RETURN jsonb_build_object(
        'success', true,
        'riders_created', riders_created,
        'drivers_created', drivers_created,
        'vehicles_created', vehicles_created
    );
END;
$$;

-- ============================================================
-- 6. CHAOS TEST: Full lifecycle simulator
--    Takes a rider through every state and validates
-- ============================================================
CREATE OR REPLACE FUNCTION simulate_full_ride_lifecycle(
    p_rider_id UUID,
    p_pickup_lat DOUBLE PRECISION DEFAULT -15.7865,
    p_pickup_lng DOUBLE PRECISION DEFAULT 35.0054,
    p_dropoff_lat DOUBLE PRECISION DEFAULT -15.7000,
    p_dropoff_lng DOUBLE PRECISION DEFAULT 35.0300,
    p_ride_type TEXT DEFAULT 'go',
    p_payment_method TEXT DEFAULT 'cash',
    p_inject_cancellation TEXT DEFAULT NULL,  -- 'rider_en_route', 'driver_accepted', etc
    p_inject_network_delay_ms INTEGER DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_ride_id UUID;
    v_driver_id UUID;
    v_result JSONB;
    v_state_log JSONB[] := ARRAY[]::JSONB[];
    v_step_start TIMESTAMP;
BEGIN
    v_step_start := clock_timestamp();

    -- Step 1: Create ride (requested → searching)
    INSERT INTO rides (
        rider_id, status, ride_type,
        pickup_lat, pickup_lng, pickup_address,
        dropoff_lat, dropoff_lng, dropoff_address,
        total_fare, payment_method
    ) VALUES (
        p_rider_id, 'requested', p_ride_type,
        p_pickup_lat, p_pickup_lng, 'Simulation Pickup',
        p_dropoff_lat, p_dropoff_lng, 'Simulation Dropoff',
        4400.00, p_payment_method
    ) RETURNING id INTO v_ride_id;

    v_state_log := ARRAY_APPEND(v_state_log, jsonb_build_object(
        'step', 'create', 'status', 'requested', 'ride_id', v_ride_id,
        'elapsed_ms', EXTRACT(MILLISECOND FROM clock_timestamp() - v_step_start)
    ));

    -- Step 2: Transition to searching (system)
    v_result := transition_trip_state(v_ride_id, 'searching', NULL, 'system',
        jsonb_build_object('simulation', true));
    v_state_log := ARRAY_APPEND(v_state_log, jsonb_build_object(
        'step', 'start_searching', 'result', v_result,
        'elapsed_ms', EXTRACT(MILLISECOND FROM clock_timestamp() - v_step_start)
    ));
    IF v_result->>'success' != 'true' THEN RETURN v_result; END IF;

    -- Step 3: Find a driver (dispatch)
    FOR v_driver_id IN (
        SELECT d.id FROM drivers d
        WHERE d.status = 'online' AND d.is_suspended = false
          AND d.account_verified = true
        LIMIT 1
    ) LOOP
        -- Assign driver
        UPDATE rides SET driver_id = v_driver_id WHERE id = v_ride_id;
    END LOOP;

    IF v_driver_id IS NULL THEN
        v_result := transition_trip_state(v_ride_id, 'no_driver_found', NULL, 'system');
        RETURN jsonb_build_object(
            'success', false, 'error', 'No drivers available',
            'state_log', v_state_log
        );
    END IF;

    -- Step 4: Assigned → Accepted
    v_result := transition_trip_state(v_ride_id, 'accepted', v_driver_id, 'driver',
        jsonb_build_object('simulation', true));
    v_state_log := ARRAY_APPEND(v_state_log, jsonb_build_object(
        'step', 'driver_accept', 'result', v_result,
        'elapsed_ms', EXTRACT(MILLISECOND FROM clock_timestamp() - v_step_start)
    ));
    IF v_result->>'success' != 'true' THEN RETURN v_result; END IF;

    -- Optional: inject rider cancellation during en_route
    IF p_inject_cancellation = 'rider_en_route' THEN
        v_result := transition_trip_state(v_ride_id, 'rider_cancelled', p_rider_id, 'rider',
            jsonb_build_object('reason', 'simulated_cancel', 'simulation', true));
        v_state_log := ARRAY_APPEND(v_state_log, jsonb_build_object(
            'step', 'injected_cancel', 'result', v_result,
            'elapsed_ms', EXTRACT(MILLISECOND FROM clock_timestamp() - v_step_start)
        ));
        RETURN jsonb_build_object('success', true, 'cancelled_at', 'rider_en_route', 'state_log', v_state_log);
    END IF;

    -- Step 5: En Route → Arrived
    v_result := transition_trip_state(v_ride_id, 'en_route', v_driver_id, 'driver');
    v_result := transition_trip_state(v_ride_id, 'arrived', v_driver_id, 'driver');
    v_state_log := ARRAY_APPEND(v_state_log, jsonb_build_object(
        'step', 'driver_arrived', 'result', v_result,
        'elapsed_ms', EXTRACT(MILLISECOND FROM clock_timestamp() - v_step_start)
    ));

    -- Step 6: Picked up → In Progress
    v_result := transition_trip_state(v_ride_id, 'picked_up', v_driver_id, 'driver');
    v_result := transition_trip_state(v_ride_id, 'in_progress', v_driver_id, 'driver');
    v_state_log := ARRAY_APPEND(v_state_log, jsonb_build_object(
        'step', 'trip_in_progress', 'result', v_result,
        'elapsed_ms', EXTRACT(MILLISECOND FROM clock_timestamp() - v_step_start)
    ));

    -- Optional: inject driver cancellation
    IF p_inject_cancellation = 'driver_in_progress' THEN
        v_result := transition_trip_state(v_ride_id, 'driver_cancelled', v_driver_id, 'driver',
            jsonb_build_object('reason', 'simulated_driver_cancel', 'simulation', true));
        v_state_log := ARRAY_APPEND(v_state_log, jsonb_build_object(
            'step', 'injected_driver_cancel', 'result', v_result,
            'elapsed_ms', EXTRACT(MILLISECOND FROM clock_timestamp() - v_step_start)
        ));
        RETURN jsonb_build_object('success', true, 'cancelled_at', 'driver_in_progress', 'state_log', v_state_log);
    END IF;

    -- Step 7: Completed
    v_result := transition_trip_state(v_ride_id, 'completed', v_driver_id, 'driver');
    v_state_log := ARRAY_APPEND(v_state_log, jsonb_build_object(
        'step', 'trip_completed', 'result', v_result,
        'elapsed_ms', EXTRACT(MILLISECOND FROM clock_timestamp() - v_step_start)
    ));

    -- Step 8: Payment settlement
    UPDATE rides SET total_fare = 4400.00 WHERE id = v_ride_id;
    v_result := settle_trip_payment(v_ride_id, p_payment_method);
    v_state_log := ARRAY_APPEND(v_state_log, jsonb_build_object(
        'step', 'payment_settled', 'result', v_result,
        'elapsed_ms', EXTRACT(MILLISECOND FROM clock_timestamp() - v_step_start)
    ));

    -- Step 9: Rating
    v_result := transition_trip_state(v_ride_id, 'rated_done', p_rider_id, 'rider',
        jsonb_build_object('rating', 5, 'simulation', true));
    v_state_log := ARRAY_APPEND(v_state_log, jsonb_build_object(
        'step', 'rated', 'result', v_result,
        'elapsed_ms', EXTRACT(MILLISECOND FROM clock_timestamp() - v_step_start)
    ));

    -- Validate: count events
    RETURN jsonb_build_object(
        'success', true,
        'ride_id', v_ride_id,
        'driver_id', v_driver_id,
        'total_steps', array_length(v_state_log, 1),
        'state_log', v_state_log,
        'event_count', (SELECT COUNT(*) FROM trip_events WHERE trip_id = v_ride_id),
        'total_elapsed_ms', EXTRACT(MILLISECOND FROM clock_timestamp() - v_step_start)
    );
END;
$$;

-- ============================================================
-- 7. BULK SIMULATION: Run N concurrent ride lifecycles
-- ============================================================
CREATE OR REPLACE FUNCTION run_bulk_simulation(
    p_ride_count INTEGER DEFAULT 50,
    p_inject_failures_pct DOUBLE PRECISION DEFAULT 10.0  -- % of rides to randomly cancel
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    i INTEGER;
    v_rider_id UUID;
    v_result JSONB;
    successes INTEGER := 0;
    failures INTEGER := 0;
    cancellations INTEGER := 0;
    total_ms DOUBLE PRECISION := 0;
    v_start TIMESTAMP;
    v_cancel_type TEXT;
BEGIN
    v_start := clock_timestamp();

    FOR i IN 1..p_ride_count LOOP
        -- Pick random rider
        SELECT id INTO v_rider_id FROM users WHERE role = 'rider' ORDER BY RANDOM() LIMIT 1;

        IF v_rider_id IS NULL THEN
            failures := failures + 1;
            CONTINUE;
        END IF;

        -- Randomly decide if this ride should be cancelled (simulate chaos)
        IF RANDOM() * 100 < p_inject_failures_pct THEN
            v_cancel_type := CASE
                WHEN RANDOM() < 0.5 THEN 'rider_en_route'
                ELSE 'driver_in_progress'
            END;
        ELSE
            v_cancel_type := NULL;
        END IF;

        -- Random pickup/dropoff around Blantyre
        v_result := simulate_full_ride_lifecycle(
            v_rider_id,
            -15.7865 + (RANDOM() - 0.5) * 0.1,
            35.0054 + (RANDOM() - 0.5) * 0.1,
            -15.7000 + (RANDOM() - 0.5) * 0.1,
            35.0300 + (RANDOM() - 0.5) * 0.1,
            (ARRAY['go', 'excel', 'women', 'xl'])[FLOOR(1 + RANDOM() * 4)],
            (ARRAY['cash', 'wallet'])[FLOOR(1 + RANDOM() * 2)],
            v_cancel_type
        );

        IF v_result->>'success' = 'true' THEN
            IF v_result->>'cancelled_at' IS NOT NULL THEN
                cancellations := cancellations + 1;
            ELSE
                successes := successes + 1;
            END IF;
        ELSE
            failures := failures + 1;
        END IF;
    END LOOP;

    RETURN jsonb_build_object(
        'success', true,
        'rides_attempted', p_ride_count,
        'successful', successes,
        'cancelled', cancellations,
        'failed', failures,
        'success_rate', ROUND(successes::DECIMAL / NULLIF(p_ride_count, 0) * 100, 1),
        'total_elapsed_ms', EXTRACT(MILLISECOND FROM clock_timestamp() - v_start),
        'transitions_total', (SELECT COUNT(*) FROM trip_events WHERE created_at > v_start),
        'wallets_affected', (
            SELECT COUNT(DISTINCT wallet_id) FROM transactions WHERE created_at > v_start
        )
    );
END;
$$;

-- ============================================================
-- 8. STATE MACHINE HEALTH CHECK — validates invariants
-- ============================================================
CREATE OR REPLACE FUNCTION validate_state_machine_health()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    violations JSONB[] := ARRAY[]::JSONB[];
    v_count INTEGER;
BEGIN
    -- Check 1: No trip in terminal state should have active ride_requests
    SELECT COUNT(*) INTO v_count
    FROM rides r
    JOIN ride_requests rr ON rr.ride_id = r.id AND rr.status = 'pending'
    WHERE r.status IN ('completed', 'rider_cancelled', 'driver_cancelled', 'no_driver_found', 'rated_done');
    IF v_count > 0 THEN
        violations := ARRAY_APPEND(violations, jsonb_build_object(
            'check', 'stale_ride_requests', 'count', v_count
        ));
    END IF;

    -- Check 2: Each completed trip should have settlement
    SELECT COUNT(*) INTO v_count
    FROM rides r
    LEFT JOIN trip_events te ON te.trip_id = r.id AND te.new_state = 'payment_pending'
    WHERE r.status IN ('completed', 'rated_done')
      AND r.payment_status = 'pending'
      AND te.id IS NULL;
    IF v_count > 0 THEN
        violations := ARRAY_APPEND(violations, jsonb_build_object(
            'check', 'unsettled_completed_trips', 'count', v_count
        ));
    END IF;

    -- Check 3: No driver with two active rides
    SELECT COUNT(*) INTO v_count
    FROM (
        SELECT driver_id, COUNT(*) AS active_count
        FROM rides
        WHERE status IN ('assigned', 'accepted', 'en_route', 'arrived', 'picked_up', 'in_progress')
        GROUP BY driver_id
        HAVING COUNT(*) > 1
    ) sub;
    IF v_count > 0 THEN
        violations := ARRAY_APPEND(violations, jsonb_build_object(
            'check', 'double_booked_drivers', 'count', v_count
        ));
    END IF;

    -- Check 4: Wallet balance should match sum of transactions
    SELECT COUNT(*) INTO v_count
    FROM wallets w
    WHERE w.balance != COALESCE(
        (SELECT SUM(amount) FROM transactions t WHERE t.wallet_id = w.id), 0
    );
    IF v_count > 0 THEN
        violations := ARRAY_APPEND(violations, jsonb_build_object(
            'check', 'wallet_balance_mismatch', 'count', v_count
        ));
    END IF;

    -- Check 5: No transaction should have been deleted (immutable ledger check)
    SELECT COUNT(*) INTO v_count
    FROM wallets w
    WHERE w.total_earned < 0 OR w.total_withdrawn < 0;
    IF v_count > 0 THEN
        violations := ARRAY_APPEND(violations, jsonb_build_object(
            'check', 'negative_wallet_values', 'count', v_count
        ));
    END IF;

    RETURN jsonb_build_object(
        'healthy', array_length(violations, 1) IS NULL OR array_length(violations, 1) = 0,
        'violations', violations,
        'checked_at', NOW()
    );
END;
$$;