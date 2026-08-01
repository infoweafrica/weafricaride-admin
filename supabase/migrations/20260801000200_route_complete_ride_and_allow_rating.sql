-- ============================================================
-- complete_ride() also wrote rides.status directly (found while
-- wiring up ratings, which route through transition_trip_state).
-- Route it through the guard, matching the P0 fix in
-- 20260801000100.
--
-- Also: process_ride_payment() (called synchronously inside
-- complete_ride) already settles the fare/commission/escrow
-- immediately on completion — there's no async wait for a real
-- "payment_pending" period in this system as actually built. But
-- allowed_trip_transitions only had payment_pending -> rated_done,
-- never completed -> rated_done, so rateDriver() (rider-app) could
-- never succeed on a normally-completed trip. Add the direct edge
-- rather than inventing a payment_pending promotion step that
-- doesn't reflect how the system actually processes payment.
-- ============================================================

INSERT INTO allowed_trip_transitions (from_state, to_state, allowed_by_rider, allowed_by_driver, allowed_by_system) VALUES
('completed', 'rated_done', true, true, true)
ON CONFLICT (from_state, to_state) DO NOTHING;

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

        IF v_distance_to_destination > 0.5 THEN  -- More than 500m from destination
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

    SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id;

    RETURN v_ride;
END;
$function$;
