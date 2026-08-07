-- ============================================================
-- NOT DEPLOYED YET — written and SQL-tested (rollback-wrapped) but
-- deliberately not applied to the live DB. See commit message / the
-- checklist for why: this closes a real gap (transition_trip_state has
-- no check that a caller claiming actor_type='driver'/'rider' actually
-- IS that driver/rider — any authenticated request could pass any
-- actor_id), but verifying it needs a real device test against the
-- actual Flutter apps' JWT propagation, not just a synthetic psql
-- session with a manually-set request.jwt.claims GUC. Apply this
-- manually (`psql -f` or `supabase db query -f`) once that's been
-- tried against a real build — do not push it blind.
--
-- What it adds: before writing the trip_events row, verify that
-- current_firebase_uid() (the calling request's actual JWT `sub`)
-- maps to a users row linked to the drivers/riders row identified by
-- p_actor_id, for actor_type 'driver'/'rider'. 'system' actor is left
-- unrestricted — it's used internally by trusted SECURITY DEFINER
-- functions (e.g. book_rider_trip -> dispatch_ride_to_nearby_drivers)
-- called under a rider's own JWT context, not service_role, so gating
-- it the same way would break that real, working path. The state
-- machine's allowed_trip_transitions table already constrains what a
-- 'system' actor can reach.
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
    v_caller_firebase_uid TEXT;
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

    -- 1b. Verify the caller actually IS the actor they claim to be, for
    -- driver/rider actors (system is internally trusted — see header).
    IF p_actor_type IN ('driver', 'rider') AND p_actor_id IS NOT NULL THEN
        v_caller_firebase_uid := current_firebase_uid();

        IF p_actor_type = 'driver' THEN
            IF NOT EXISTS (
                SELECT 1 FROM drivers d
                JOIN users u ON u.id = d.user_id
                WHERE d.id = p_actor_id AND u.firebase_uid = v_caller_firebase_uid
            ) THEN
                RETURN jsonb_build_object(
                    'success', false,
                    'error', 'Caller is not the specified driver',
                    'code', 'FORBIDDEN'
                );
            END IF;
        ELSIF p_actor_type = 'rider' THEN
            IF NOT EXISTS (
                SELECT 1 FROM riders r
                JOIN users u ON u.id = r.user_id
                WHERE r.id = p_actor_id AND u.firebase_uid = v_caller_firebase_uid
            ) THEN
                RETURN jsonb_build_object(
                    'success', false,
                    'error', 'Caller is not the specified rider',
                    'code', 'FORBIDDEN'
                );
            END IF;
        END IF;
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
    -- block the transition itself (see 20260802000200).
    v_resolved_actor_id := NULL;
    IF p_actor_id IS NOT NULL THEN
        IF p_actor_type = 'driver' THEN
            SELECT user_id INTO v_resolved_actor_id FROM drivers WHERE id = p_actor_id;
        ELSIF p_actor_type = 'rider' THEN
            SELECT user_id INTO v_resolved_actor_id FROM riders WHERE id = p_actor_id;
        ELSE
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
