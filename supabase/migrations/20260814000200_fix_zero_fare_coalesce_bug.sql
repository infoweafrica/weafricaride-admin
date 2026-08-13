-- Fix a zero-fare bug in complete_ride()/confirm_cash_payment(), found by
-- staging-testing the cash engine before any production deploy.
--
-- rides.actual_fare (and .fare/.estimated_fare) default to 0, not NULL.
-- complete_ride()'s fare-freezing UPDATE does
-- `final_fare = COALESCE(final_fare, actual_fare, estimated_fare)` — since
-- actual_fare is 0 (not NULL) at that point for every ride, COALESCE picks
-- that meaningless 0 instead of ever falling through to estimated_fare.
-- process_ride_payment() already guards against exactly this with
-- NULLIF(x, 0); complete_ride() and confirm_cash_payment()'s own early
-- fare read did not.
--
-- Impact confirmed against a staging replica: for a cash trip, rides.final_fare
-- sits at 0 for the entire window between complete_ride() and
-- confirm_cash_payment() — which is precisely when the driver-app's
-- "Collect Cash" screen reads final_fare to show "Passenger owes MK X".
-- Every cash trip would show MK 0 there instead of the real fare, with an
-- empty (not pre-filled) amount field. Settlement math itself was
-- unaffected — process_ride_payment()'s own NULLIF-guarded calculation
-- inside confirm_cash_payment() already computed the correct commission —
-- this only corrupted the number shown to the driver before they confirm,
-- and the 'fare' key in confirm_cash_payment()'s JSON response.

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
        final_fare = COALESCE(NULLIF(final_fare, 0), NULLIF(actual_fare, 0), NULLIF(estimated_fare, 0), NULLIF(fare, 0), 0),
        actual_fare = COALESCE(NULLIF(actual_fare, 0), NULLIF(final_fare, 0), NULLIF(estimated_fare, 0), NULLIF(fare, 0), 0),
        driver_completion_lat = COALESCE(p_driver_lat, driver_completion_lat),
        driver_completion_lng = COALESCE(p_driver_lng, driver_completion_lng),
        payment_status = CASE WHEN payment_method = 'cash' THEN 'awaiting_cash' ELSE payment_status END,
        settlement_status = CASE WHEN payment_method = 'cash' THEN 'pending' ELSE settlement_status END
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

    IF v_ride.payment_method != 'cash' THEN
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
    END IF;

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

-- Same fix for confirm_cash_payment()'s own early fare read (used both for
-- change/shortfall math and the 'fare' key in its JSON response) — bring
-- it in line with process_ride_payment()'s NULLIF-guarded formula.
CREATE OR REPLACE FUNCTION public.confirm_cash_payment(
    p_ride_id uuid,
    p_driver_id uuid,
    p_cash_received numeric,
    p_credit_action text DEFAULT 'return_change'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_ride public.rides;
    v_fare numeric(10,2);
    v_prior_received numeric(10,2);
    v_new_total numeric(10,2);
    v_change numeric(10,2);
    v_outstanding numeric(10,2);
    v_pending_credit numeric(10,2) := 0;
    v_new_payment_status text;
    v_was_first_confirmation boolean;
    v_payment_result jsonb;
    v_rider_user_id uuid;
    v_driver_wallet public.driver_wallets;
    v_settle_amount numeric(12,2) := 0;
    v_result_ride public.rides;
BEGIN
    IF p_cash_received IS NULL OR p_cash_received <= 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Cash received must be greater than zero', 'code', 'INVALID_AMOUNT');
    END IF;
    IF p_credit_action NOT IN ('return_change', 'credit_rider') THEN
        RETURN jsonb_build_object('success', false, 'error', 'Invalid credit action', 'code', 'INVALID_CREDIT_ACTION');
    END IF;

    SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Ride not found', 'code', 'TRIP_NOT_FOUND');
    END IF;
    IF v_ride.driver_id IS DISTINCT FROM p_driver_id THEN
        RETURN jsonb_build_object('success', false, 'error', 'You are not the driver on this ride', 'code', 'NOT_YOUR_RIDE');
    END IF;
    IF COALESCE(v_ride.payment_method, 'cash') != 'cash' THEN
        RETURN jsonb_build_object('success', false, 'error', 'This ride is not a cash payment', 'code', 'NOT_CASH_RIDE');
    END IF;
    IF v_ride.status != 'completed' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Ride is not completed yet', 'code', 'NOT_COMPLETED');
    END IF;

    -- Idempotent: fully paid already, nothing left to do — safe to retry
    -- on network failure without double-crediting anything.
    IF v_ride.payment_status = 'paid' THEN
        RETURN jsonb_build_object(
            'success', true, 'ride_id', p_ride_id, 'already_paid', true,
            'fare', COALESCE(v_ride.final_fare, v_ride.actual_fare, v_ride.fare, v_ride.estimated_fare, 0),
            'cash_received', v_ride.cash_received, 'change_amount', v_ride.change_amount,
            'rider_credit_amount', v_ride.rider_credit_amount, 'outstanding_amount', v_ride.cash_outstanding_amount,
            'payment_status', v_ride.payment_status,
            'pending_rider_credit_amount', v_ride.pending_rider_credit_amount,
            'credit_confirmation_status', v_ride.credit_confirmation_status
        );
    END IF;

    v_fare := COALESCE(NULLIF(v_ride.final_fare, 0), NULLIF(v_ride.actual_fare, 0), NULLIF(v_ride.fare, 0), v_ride.estimated_fare, 0);
    v_was_first_confirmation := (v_ride.payment_status = 'awaiting_cash' OR v_ride.payment_status IS NULL);
    v_prior_received := COALESCE(v_ride.cash_received, 0);
    v_new_total := v_prior_received + p_cash_received;

    -- Fare itself is fully collected the moment cash-in-hand covers it,
    -- regardless of how any excess gets resolved — that resolution
    -- (change handed back vs. ride credit) is a separate concern the
    -- rider must confirm before any wallet balance actually moves.
    IF v_new_total > v_fare AND p_credit_action = 'credit_rider' THEN
        v_pending_credit := v_new_total - v_fare;
        v_change := 0;
    ELSE
        v_change := GREATEST(v_new_total - v_fare, 0);
    END IF;
    v_outstanding := GREATEST(v_fare - v_new_total, 0);
    v_new_payment_status := CASE WHEN v_outstanding > 0 THEN 'partially_paid' ELSE 'paid' END;

    UPDATE public.rides
    SET cash_received = v_new_total,
        change_amount = v_change,
        cash_outstanding_amount = v_outstanding,
        cash_confirmed_at = now(),
        cash_confirmed_by = p_driver_id,
        payment_status = v_new_payment_status,
        pending_rider_credit_amount = CASE WHEN v_pending_credit > 0 THEN v_pending_credit ELSE pending_rider_credit_amount END,
        credit_confirmation_status = CASE WHEN v_pending_credit > 0 THEN 'pending' ELSE credit_confirmation_status END,
        updated_at = now()
    WHERE id = p_ride_id;

    -- Process driver earnings/commission exactly once per ride, on first
    -- confirmation regardless of whether it's full or partial.
    IF v_was_first_confirmation THEN
        BEGIN
            SELECT public.process_ride_payment(p_ride_id) INTO v_payment_result;
        EXCEPTION WHEN OTHERS THEN
            INSERT INTO public.ride_events(ride_id, actor_id, event_type, metadata)
            VALUES (p_ride_id, p_driver_id, 'payment_processing_failed', jsonb_build_object('error', SQLERRM));
        END;

        -- Auto-settlement: immediately pay down whatever commission this
        -- trip just added to commission_owed from the driver's own
        -- withdrawable balance, capped at what's actually available.
        SELECT * INTO v_driver_wallet FROM public.driver_wallets WHERE driver_id = p_driver_id;
        IF FOUND AND COALESCE(v_driver_wallet.commission_owed, 0) > 0 AND COALESCE(v_driver_wallet.available_balance, 0) > 0 THEN
            v_settle_amount := LEAST(v_driver_wallet.commission_owed, v_driver_wallet.available_balance);
            UPDATE public.driver_wallets
            SET available_balance = available_balance - v_settle_amount,
                available_for_withdrawal = available_for_withdrawal - v_settle_amount,
                commission_owed = commission_owed - v_settle_amount,
                updated_at = now()
            WHERE driver_id = p_driver_id;

            INSERT INTO public.driver_transactions(
                driver_id, transaction_type, amount, balance_before, balance_after,
                reference_type, reference_id, description, status
            ) VALUES (
                p_driver_id, 'auto_settlement', -v_settle_amount,
                v_driver_wallet.available_balance, v_driver_wallet.available_balance - v_settle_amount,
                'ride', p_ride_id, 'Auto-settled commission from wallet balance', 'completed'
            );
        END IF;

        UPDATE public.rides
        SET settlement_status = CASE
            WHEN COALESCE((SELECT commission_owed FROM public.driver_wallets WHERE driver_id = p_driver_id), 0) <= 0 THEN 'settled'
            WHEN v_settle_amount > 0 THEN 'partially_settled'
            ELSE 'pending'
        END
        WHERE id = p_ride_id;
    END IF;

    -- Ledger row for the admin Payments tab — cash trips never got one
    -- before this migration.
    SELECT user_id INTO v_rider_user_id FROM public.riders WHERE id = v_ride.rider_id;
    INSERT INTO public.payments(
        ride_id, amount, payment_method, payment_status, paid_by, paid_at, user_type, type, reference, currency
    ) VALUES (
        p_ride_id, p_cash_received, 'cash', v_new_payment_status, v_rider_user_id, now(), 'rider', 'ride_payment',
        'cash_' || p_ride_id::text || '_' || extract(epoch from clock_timestamp())::bigint, 'MWK'
    );

    INSERT INTO public.ride_events(ride_id, actor_id, event_type, metadata)
    VALUES (p_ride_id, p_driver_id, 'cash_payment_confirmed',
        jsonb_build_object(
            'cash_received', p_cash_received, 'total_received', v_new_total, 'change', v_change,
            'pending_rider_credit', v_pending_credit, 'outstanding', v_outstanding, 'payment_status', v_new_payment_status,
            'credit_action', p_credit_action
        ));

    -- Re-read so the response always reflects the row's true current
    -- state, including any pending/resolved credit from an earlier call
    -- on this same ride (a driver can call this again for a top-up).
    SELECT * INTO v_result_ride FROM public.rides WHERE id = p_ride_id;

    RETURN jsonb_build_object(
        'success', true, 'ride_id', p_ride_id, 'fare', v_fare,
        'cash_received', v_new_total, 'change_amount', v_result_ride.change_amount,
        'rider_credit_amount', v_result_ride.rider_credit_amount,
        'outstanding_amount', v_outstanding, 'payment_status', v_new_payment_status,
        'pending_rider_credit_amount', v_result_ride.pending_rider_credit_amount,
        'credit_confirmation_status', v_result_ride.credit_confirmation_status,
        'settlement_auto_paid', v_settle_amount
    );
END;
$$;
