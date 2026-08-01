-- ============================================================
-- 1. TRIP EVENTS AUDIT LOG
-- ============================================================
CREATE TABLE IF NOT EXISTS trip_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trip_id UUID NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
    event_type VARCHAR(30) NOT NULL,
    previous_state VARCHAR(30),
    new_state VARCHAR(30) NOT NULL,
    actor_id UUID REFERENCES users(id),
    actor_type VARCHAR(20), -- 'rider', 'driver', 'system'
    metadata JSONB DEFAULT '{}',
    event_version INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_trip_events_trip ON trip_events(trip_id, event_version);
CREATE INDEX idx_trip_events_created ON trip_events(created_at DESC);

-- Enable real-time on trip_events for live audit dashboards
ALTER PUBLICATION supabase_realtime ADD TABLE trip_events;

-- ============================================================
-- 2. ALLOWED STATE TRANSITION MAP
-- ============================================================
-- Encoded as a validation table to keep the DB authoritative.
CREATE TABLE IF NOT EXISTS allowed_trip_transitions (
    from_state VARCHAR(30) NOT NULL,
    to_state VARCHAR(30) NOT NULL,
    allowed_by_rider BOOLEAN DEFAULT TRUE,
    allowed_by_driver BOOLEAN DEFAULT TRUE,
    allowed_by_system BOOLEAN DEFAULT TRUE,
    PRIMARY KEY (from_state, to_state)
);

-- Seed all valid transitions from the WeAfrica state machine
INSERT INTO allowed_trip_transitions (from_state, to_state, allowed_by_rider, allowed_by_driver, allowed_by_system) VALUES
-- Happy path
('requested', 'searching', true, false, true),
('searching', 'assigned', false, true, true),
('assigned', 'accepted', false, true, false),
('accepted', 'en_route', false, true, false),
('en_route', 'arrived', false, true, false),
('arrived', 'picked_up', false, true, false),
('picked_up', 'in_progress', false, true, false),
('in_progress', 'completed', false, true, false),
('completed', 'payment_pending', false, false, true),
('payment_pending', 'rated_done', true, true, true),

-- Rider cancels
('requested', 'rider_cancelled', true, false, true),
('searching', 'rider_cancelled', true, false, true),
('assigned', 'rider_cancelled', true, false, true),
('accepted', 'rider_cancelled', true, false, true),
('en_route', 'rider_cancelled', true, false, true),
('arrived', 'rider_cancelled', true, false, true),
('picked_up', 'rider_cancelled', true, false, true),
('in_progress', 'rider_cancelled', true, false, true),

-- Driver cancels
('assigned', 'driver_cancelled', false, true, false),
('accepted', 'driver_cancelled', false, true, false),
('en_route', 'driver_cancelled', false, true, false),
('arrived', 'driver_cancelled', false, true, false),

-- System cancels
('searching', 'no_driver_found', false, false, true),
('searching', 'expired', false, false, true),
('assigned', 'expired', false, false, true),

-- Fallback
('searching', 'reassigning', false, false, true),
('reassigning', 'searching', false, false, true),
('assigned', 'reassigning', false, false, true),
('reassigning', 'assigned', false, true, true),

-- Re-usable completion flow
('rider_cancelled', 'rated_done', true, true, true),
('driver_cancelled', 'rated_done', true, true, true),
('no_driver_found', 'rated_done', false, false, true),
('completed', 'dispute', true, true, true),
('dispute', 'rated_done', false, true, true)
ON CONFLICT (from_state, to_state) DO NOTHING;

-- ============================================================
-- 3. SERVER-AUTHORITATIVE STATE TRANSITION FUNCTION
--    The ONLY way to change trip status. Guards against:
--    - Invalid transitions (race conditions)
--    - Duplicate transitions
--    - Out-of-order events (event_version check)
-- ============================================================
CREATE OR REPLACE FUNCTION transition_trip_state(
    p_trip_id UUID,
    p_new_state VARCHAR(30),
    p_actor_id UUID DEFAULT NULL,
    p_actor_type VARCHAR(20) DEFAULT 'system',
    p_metadata JSONB DEFAULT '{}',
    p_event_version INTEGER DEFAULT NULL  -- optional: client-side monotonic counter
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_current_state VARCHAR(30);
    v_current_version INTEGER;
    v_allowed BOOLEAN;
    v_new_version INTEGER;
    v_event_id UUID;
BEGIN
    -- 1. Get current trip state and latest event version
    SELECT status INTO v_current_state
    FROM rides WHERE id = p_trip_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Trip not found',
            'code', 'TRIP_NOT_FOUND'
        );
    END IF;

    -- 2. Idempotency: if already in target state, return success (no-op)
    IF v_current_state = p_new_state THEN
        RETURN jsonb_build_object(
            'success', true,
            'message', 'Already in target state',
            'current_state', v_current_state,
            'new_state', p_new_state,
            'event_version', (SELECT COALESCE(MAX(event_version), 0) FROM trip_events WHERE trip_id = p_trip_id)
        );
    END IF;

    -- 3. Validate transition is allowed
    SELECT EXISTS(
        SELECT 1 FROM allowed_trip_transitions
        WHERE from_state = v_current_state
          AND to_state = p_new_state
          AND (
            (p_actor_type = 'rider' AND allowed_by_rider = true) OR
            (p_actor_type = 'driver' AND allowed_by_driver = true) OR
            (p_actor_type = 'system' AND allowed_by_system = true)
          )
    ) INTO v_allowed;

    IF NOT v_allowed THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', format('Invalid transition: %s → %s by %s', v_current_state, p_new_state, p_actor_type),
            'code', 'INVALID_TRANSITION',
            'current_state', v_current_state,
            'requested_state', p_new_state
        );
    END IF;

    -- 4. Get current event version and enforce monotonic ordering
    SELECT COALESCE(MAX(event_version), 0) INTO v_current_version
    FROM trip_events WHERE trip_id = p_trip_id;

    IF p_event_version IS NOT NULL AND p_event_version <= v_current_version THEN
        -- This event arrived out of order or is a duplicate
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Stale event version',
            'code', 'STALE_EVENT_VERSION',
            'current_version', v_current_version,
            'provided_version', p_event_version
        );
    END IF;

    v_new_version := v_current_version + 1;

    -- 5. Atomically: update trip status + insert event log
    BEGIN
        UPDATE rides
        SET status = p_new_state,
            updated_at = NOW()
        WHERE id = p_trip_id;

        INSERT INTO trip_events (
            trip_id, event_type, previous_state, new_state,
            actor_id, actor_type, metadata, event_version
        ) VALUES (
            p_trip_id, 'state_transition', v_current_state, p_new_state,
            p_actor_id, p_actor_type, p_metadata, v_new_version
        )
        RETURNING id INTO v_event_id;

        RETURN jsonb_build_object(
            'success', true,
            'message', 'Transition complete',
            'previous_state', v_current_state,
            'new_state', p_new_state,
            'event_version', v_new_version,
            'event_id', v_event_id
        );
    EXCEPTION WHEN OTHERS THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', SQLERRM,
            'code', 'DB_ERROR'
        );
    END;
END;
$$;

-- ============================================================
-- 4. RLS: trip_events are read-only for authenticated users,
--    written only via the transition_trip_state function
-- ============================================================
ALTER TABLE trip_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their trip events"
    ON trip_events FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM rides
            WHERE rides.id = trip_events.trip_id
              AND (rides.rider_id = auth.uid() OR rides.driver_id = auth.uid())
        )
    );

-- Admin full access (handled via service role in dashboard)