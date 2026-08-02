-- ============================================================
-- CRITICAL FIX: transition_trip_state() actor_id FK violation
--
-- Found 2026-08-02 while testing the second-trip queue wiring.
-- trip_events.actor_id has FK -> users(id), but every caller of
-- transition_trip_state() that passes a real actor (accept_ride_request,
-- driver_arrived, start_ride_with_pin, complete_ride — all pass
-- drivers.id; rider-app passes riders.id-ish values for rider actions)
-- passes drivers.id/riders.id, NOT users.id. drivers.id != drivers.user_id
-- (confirmed live: not the same UUID). Every one of those calls with a
-- real actor has been failing with a DB_ERROR ("violates foreign key
-- constraint trip_events_actor_id_fkey") since the P0 migration wired
-- them through this guard on 2026-08-01 — meaning real drivers could not
-- accept, mark arrived, start, or complete a ride at all in that window.
-- Confirmed via a rollback-wrapped test with a real driver.id before
-- writing this fix.
--
-- Fix: resolve p_actor_id to the correct users.id based on p_actor_type
-- before inserting into trip_events. If it can't be resolved (unknown
-- id, or actor_type doesn't map to a users-linked table), fall back to
-- NULL rather than blocking the transition — this column is an audit
-- trail, not something that should ever be able to block a trip
-- actually moving forward.
-- ============================================================

CREATE OR REPLACE FUNCTION transition_trip_state(
    p_trip_id UUID,
    p_new_state VARCHAR(30),
    p_actor_id UUID DEFAULT NULL,
    p_actor_type VARCHAR(20) DEFAULT 'system',
    p_metadata JSONB DEFAULT '{}',
    p_event_version INTEGER DEFAULT NULL
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
    v_resolved_actor_id UUID;
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
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Stale event version',
            'code', 'STALE_EVENT_VERSION',
            'current_version', v_current_version,
            'provided_version', p_event_version
        );
    END IF;

    v_new_version := v_current_version + 1;

    -- 4b. Resolve actor_id to a valid users.id (trip_events.actor_id FKs
    -- to users, but callers pass drivers.id/riders.id) — never let this
    -- block the transition itself.
    v_resolved_actor_id := NULL;
    IF p_actor_id IS NOT NULL THEN
        IF p_actor_type = 'driver' THEN
            SELECT user_id INTO v_resolved_actor_id FROM drivers WHERE id = p_actor_id;
        ELSIF p_actor_type = 'rider' THEN
            SELECT user_id INTO v_resolved_actor_id FROM riders WHERE id = p_actor_id;
        ELSE
            -- system actor (or already a users.id) — use as-is if it
            -- actually resolves, else drop it.
            SELECT id INTO v_resolved_actor_id FROM users WHERE id = p_actor_id;
        END IF;
    END IF;

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
            v_resolved_actor_id, p_actor_type, p_metadata, v_new_version
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
