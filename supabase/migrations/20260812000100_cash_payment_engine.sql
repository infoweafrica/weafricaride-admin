-- Cash Payment Engine — Module 1 of the full cash & settlement system.
--
-- Today a cash trip completes through the exact same complete_ride() ->
-- process_ride_payment() path as every other payment method: no amount is
-- ever entered, no confirmation step exists, and the wallet math (fixed
-- earlier) still assumes the driver received the full fare, never what
-- was actually handed over. This closes that gap end to end: driver
-- confirms an actual cash amount, the system computes change/shortfall,
-- optionally converts overpayment into rider credit, records a proper
-- payments-table ledger row (cash trips never got one before), and
-- immediately auto-settles as much of the resulting commission
-- obligation as the driver's own withdrawable balance covers.
--
-- Deliberately reuses existing infrastructure rather than adding new
-- tables: rides gets new columns instead of a shadow cash_payments
-- table; payments already models "payment_transactions"; wallets.
-- ride_credits (already separate from balance/promo_balance) is rider
-- credit, no new rider-wallet table; driver_transactions/
-- company_transactions are already the ledger process_ride_payment()
-- writes to.

ALTER TABLE public.rides
  ADD COLUMN IF NOT EXISTS cash_received numeric(10,2),
  ADD COLUMN IF NOT EXISTS change_amount numeric(10,2),
  ADD COLUMN IF NOT EXISTS rider_credit_amount numeric(10,2),
  ADD COLUMN IF NOT EXISTS cash_outstanding_amount numeric(10,2),
  ADD COLUMN IF NOT EXISTS cash_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS cash_confirmed_by uuid,
  ADD COLUMN IF NOT EXISTS settlement_status text DEFAULT 'not_required';

ALTER TABLE public.driver_wallets
  ADD COLUMN IF NOT EXISTS commission_owed numeric(12,2) DEFAULT 0;

-- complete_ride(): only call process_ride_payment() immediately for
-- non-cash trips. Cash trips wait for confirm_cash_payment() to actually
-- know how much was received before any wallet/commission math runs.
-- Every other line of this function (GPS fraud check, ride_events log,
-- queued-next-ride activation) is unchanged — only the payment-call
-- branch below is new.
CREATE OR REPLACE FUNCTION "public"."complete_ride"("p_ride_id" "uuid", "p_driver_lat" numeric DEFAULT NULL::numeric, "p_driver_lng" numeric DEFAULT NULL::numeric) RETURNS "public"."rides"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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
$$;

-- process_ride_payment(): cash_collected now reflects what was actually
-- received (rides.cash_received, set by confirm_cash_payment before this
-- runs) instead of assuming the full fare, and the same upsert now also
-- tracks commission_owed — the platform's claim on cash the driver is
-- already holding.
CREATE OR REPLACE FUNCTION "public"."process_ride_payment"("p_ride_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_ride public.rides;
    v_escrow public.platform_escrow;
    v_driver_id uuid;
    v_fare_amount numeric(10,2);
    v_booking_fee numeric(10,2);
    v_commission_rate numeric(5,2);
    v_commission_amount numeric(10,2);
    v_driver_net numeric(10,2);
    v_rider_total numeric(10,2);
    v_wallet_id uuid;
    v_balance_before numeric(12,2);
    v_balance_after numeric(12,2);
    v_payment_method text;
    v_is_cash boolean;
    v_wallet_delta numeric(10,2);
    v_cash_credited numeric(10,2);
BEGIN
    SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Ride not found');
    END IF;

    -- Check if already processed
    IF v_ride.payment_status = 'paid' AND v_ride.driver_earnings IS NOT NULL AND v_ride.driver_earnings > 0 THEN
        RETURN jsonb_build_object('success', true, 'ride_id', p_ride_id, 'note', 'Already processed');
    END IF;

    v_driver_id := v_ride.driver_id;
    v_fare_amount := COALESCE(NULLIF(v_ride.actual_fare, 0), NULLIF(v_ride.final_fare, 0), NULLIF(v_ride.fare, 0), v_ride.estimated_fare, 0);
    v_booking_fee := COALESCE(v_ride.booking_fee, 300);
    v_commission_rate := COALESCE(v_ride.commission_rate, 15);
    v_payment_method := COALESCE(v_ride.payment_method, 'cash');
    v_is_cash := (v_payment_method = 'cash');
    -- Actual cash handed over (set by confirm_cash_payment before this
    -- runs) — falls back to fare for any historical/non-cash-confirm-flow
    -- callers so this stays backward compatible.
    v_cash_credited := COALESCE(v_ride.cash_received, v_fare_amount);

    v_commission_amount := ROUND(v_fare_amount * (v_commission_rate / 100), 2);
    v_driver_net := ROUND(v_fare_amount - v_commission_amount, 2);
    v_rider_total := v_fare_amount + v_booking_fee;
    -- Actual withdrawable-wallet movement: zero for cash (driver already
    -- holds the money), the full net earning for wallet/card trips.
    v_wallet_delta := CASE WHEN v_is_cash THEN 0 ELSE v_driver_net END;

    -- Release escrow if exists (cash trips generally have none — this is a
    -- no-op for them since v_escrow won't be FOUND).
    SELECT * INTO v_escrow FROM public.platform_escrow WHERE ride_id = p_ride_id;
    IF FOUND AND v_escrow.escrow_status = 'held' THEN
        UPDATE public.platform_escrow
        SET escrow_status = 'released',
            released_to_driver = v_driver_net,
            released_to_company = v_commission_amount + v_booking_fee,
            commission_deducted = v_commission_amount,
            released_at = NOW(),
            notes = 'Funds released on trip completion',
            updated_at = NOW()
        WHERE id = v_escrow.id;
    END IF;

    -- Update ride with payment breakdown
    UPDATE public.rides
    SET
        actual_fare = v_fare_amount,
        final_fare = v_fare_amount,
        commission_amount = v_commission_amount,
        driver_earnings = v_driver_net,
        driver_net_earning = v_driver_net,
        rider_total_amount = v_rider_total,
        payment_status = 'paid',
        paid_at = NOW(),
        updated_at = NOW()
    WHERE id = p_ride_id;

    -- Update/create driver wallet. available_balance/available_for_withdrawal
    -- /balance only move for non-cash trips (v_wallet_delta); cash_collected
    -- tracks what was actually received for cash trips instead. earned_*/
    -- trips_* stats still include cash trips — they're "how much did I
    -- earn" figures, not withdrawable-balance figures. commission_owed
    -- tracks what the driver still needs to settle from cash already in
    -- hand (confirm_cash_payment attempts to auto-settle this immediately
    -- from available_balance right after this function returns).
    INSERT INTO public.driver_wallets (
        driver_id,
        available_balance,
        available_for_withdrawal,
        balance,
        total_earned,
        pending_balance,
        cash_collected,
        commission_owed,
        currency,
        created_at,
        updated_at
    )
    VALUES (
        v_driver_id, v_wallet_delta, v_wallet_delta,
        v_wallet_delta, v_driver_net, 0,
        CASE WHEN v_is_cash THEN v_cash_credited ELSE 0 END,
        CASE WHEN v_is_cash THEN v_commission_amount ELSE 0 END,
        'MWK', NOW(), NOW()
    )
    ON CONFLICT (driver_id) DO UPDATE
    SET
        available_balance = COALESCE(public.driver_wallets.available_balance, 0) + v_wallet_delta,
        available_for_withdrawal = COALESCE(public.driver_wallets.available_for_withdrawal, 0) + v_wallet_delta,
        balance = COALESCE(public.driver_wallets.balance, 0) + v_wallet_delta,
        cash_collected = COALESCE(public.driver_wallets.cash_collected, 0) + CASE WHEN v_is_cash THEN v_cash_credited ELSE 0 END,
        commission_owed = COALESCE(public.driver_wallets.commission_owed, 0) + CASE WHEN v_is_cash THEN v_commission_amount ELSE 0 END,
        total_earned = COALESCE(public.driver_wallets.total_earned, 0) + v_driver_net,
        trips_today = CASE
            WHEN public.driver_wallets.statement_updated_at >= CURRENT_DATE
            THEN COALESCE(public.driver_wallets.trips_today, 0) + 1
            ELSE 1
        END,
        earned_today = CASE
            WHEN public.driver_wallets.statement_updated_at >= CURRENT_DATE
            THEN COALESCE(public.driver_wallets.earned_today, 0) + v_driver_net
            ELSE v_driver_net
        END,
        trips_this_week = CASE
            WHEN public.driver_wallets.statement_updated_at >= DATE_TRUNC('week', CURRENT_DATE)
            THEN COALESCE(public.driver_wallets.trips_this_week, 0) + 1
            ELSE 1
        END,
        earned_this_week = CASE
            WHEN public.driver_wallets.statement_updated_at >= DATE_TRUNC('week', CURRENT_DATE)
            THEN COALESCE(public.driver_wallets.earned_this_week, 0) + v_driver_net
            ELSE v_driver_net
        END,
        trips_this_month = CASE
            WHEN public.driver_wallets.statement_updated_at >= DATE_TRUNC('month', CURRENT_DATE)
            THEN COALESCE(public.driver_wallets.trips_this_month, 0) + 1
            ELSE 1
        END,
        earned_this_month = CASE
            WHEN public.driver_wallets.statement_updated_at >= DATE_TRUNC('month', CURRENT_DATE)
            THEN COALESCE(public.driver_wallets.earned_this_month, 0) + v_driver_net
            ELSE v_driver_net
        END,
        statement_updated_at = NOW(),
        updated_at = NOW()
    RETURNING id, COALESCE(available_balance, 0), COALESCE(available_balance, 0)
    INTO v_wallet_id, v_balance_before, v_balance_after;

    v_balance_before := v_balance_after - v_wallet_delta;

    -- Track cash collected on the drivers row too (the driver-app's
    -- Earnings screen falls back to drivers.cash_collected when
    -- driver_wallets doesn't have it loaded yet).
    IF v_is_cash THEN
        UPDATE public.drivers
        SET cash_collected = COALESCE(cash_collected, 0) + v_cash_credited,
            updated_at = NOW()
        WHERE id = v_driver_id;
    END IF;

    -- Driver transaction ledger — still records the trip's earning for
    -- cash trips (so it counts toward "Today's Earnings"), but
    -- balance_before/after reflect that the withdrawable balance didn't
    -- actually move.
    INSERT INTO public.driver_transactions (
        driver_id, transaction_type, amount,
        balance_before, balance_after,
        reference_type, reference_id,
        description, status, created_at
    )
    VALUES (
        v_driver_id, 'ride_earning', v_driver_net,
        COALESCE(v_balance_before, 0), COALESCE(v_balance_after, v_wallet_delta),
        'ride', p_ride_id,
        'Trip fare MWK ' || v_fare_amount || ' - commission MWK ' || v_commission_amount ||
            CASE WHEN v_is_cash THEN ' (collected in cash)' ELSE '' END,
        'completed', NOW()
    );

    -- Trip earnings record — is_paid_to_wallet is false for cash (the
    -- driver was paid directly by the rider, not through the app wallet).
    INSERT INTO public.trip_earnings (
        ride_id, driver_id, gross_fare,
        commission_rate, commission_amount,
        tax_amount, net_earning,
        is_paid_to_wallet, paid_to_wallet_at, created_at
    )
    VALUES (
        p_ride_id, v_driver_id, v_fare_amount,
        v_commission_rate, v_commission_amount,
        0, v_driver_net,
        NOT v_is_cash, CASE WHEN v_is_cash THEN NULL ELSE NOW() END, NOW()
    )
    ON CONFLICT (ride_id) DO UPDATE
    SET
        gross_fare = EXCLUDED.gross_fare,
        commission_rate = EXCLUDED.commission_rate,
        commission_amount = EXCLUDED.commission_amount,
        net_earning = EXCLUDED.net_earning,
        is_paid_to_wallet = EXCLUDED.is_paid_to_wallet,
        paid_to_wallet_at = EXCLUDED.paid_to_wallet_at;

    -- Company transaction records — commission is still recognized as
    -- company revenue regardless of collection method; reconciling it
    -- against a driver's accumulated cash_collected/commission_owed is a
    -- separate, outside-the-app admin process.
    INSERT INTO public.company_transactions (transaction_type, amount, ride_id, description)
    VALUES
        ('commission_earning', v_commission_amount, p_ride_id,
         'Commission ' || v_commission_rate || '% on ride fare MWK ' || v_fare_amount),
        ('booking_fee', v_booking_fee, p_ride_id,
         'Rider booking fee MWK ' || v_booking_fee);

    -- Driver payout record — only owed for non-cash trips. A cash trip's
    -- net earning is already in the driver's hand; there's nothing left
    -- for the platform to pay out.
    IF NOT v_is_cash THEN
        INSERT INTO public.driver_payouts (
            driver_id, ride_id, amount, payout_method, payout_status,
            gross_fare, commission_amount, tax_amount, net_earning,
            notes
        ) VALUES (
            v_driver_id, p_ride_id, v_driver_net,
            v_payment_method, 'pending',
            v_fare_amount, v_commission_amount, 0, v_driver_net,
            'Auto-created from ride. Withdrawable to Airtel/Mpamba/Bank.'
        );
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'ride_id', p_ride_id,
        'fare_amount', v_fare_amount,
        'booking_fee', v_booking_fee,
        'rider_total', v_rider_total,
        'commission_rate', v_commission_rate,
        'commission_amount', v_commission_amount,
        'driver_net', v_driver_net,
        'payment_method', v_payment_method,
        'wallet_credited', v_wallet_delta,
        'cash_collected_delta', CASE WHEN v_is_cash THEN v_cash_credited ELSE 0 END,
        'escrow_status', COALESCE(v_escrow.escrow_status, 'no_escrow'),
        'company_revenue', v_commission_amount + v_booking_fee
    );
END;
$$;

-- The one entry point driver-app calls to confirm cash was actually
-- received. Handles: idempotent retry (network-safe), partial-payment
-- top-up (call again while outstanding > 0), overpayment -> return
-- change or convert to rider credit (wallets.ride_credits, same shape as
-- the existing rider_wallet_top_up()), driver earnings/commission
-- processed exactly once via process_ride_payment(), and immediate
-- auto-settlement of the resulting commission_owed from the driver's own
-- available_balance.
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
    v_rider_credit numeric(10,2) := 0;
    v_new_payment_status text;
    v_was_first_confirmation boolean;
    v_payment_result jsonb;
    v_rider_user_id uuid;
    v_wallet public.wallets;
    v_wallet_before numeric(12,2);
    v_driver_wallet public.driver_wallets;
    v_settle_amount numeric(12,2) := 0;
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
            'payment_status', v_ride.payment_status
        );
    END IF;

    v_fare := COALESCE(v_ride.final_fare, v_ride.actual_fare, v_ride.fare, v_ride.estimated_fare, 0);
    v_was_first_confirmation := (v_ride.payment_status = 'awaiting_cash' OR v_ride.payment_status IS NULL);
    v_prior_received := COALESCE(v_ride.cash_received, 0);
    v_new_total := v_prior_received + p_cash_received;

    IF v_new_total > v_fare AND p_credit_action = 'credit_rider' THEN
        v_rider_credit := v_new_total - v_fare;
        v_change := 0;
    ELSE
        v_change := GREATEST(v_new_total - v_fare, 0);
        v_rider_credit := 0;
    END IF;
    v_outstanding := GREATEST(v_fare - v_new_total, 0);
    v_new_payment_status := CASE WHEN v_outstanding > 0 THEN 'partially_paid' ELSE 'paid' END;

    UPDATE public.rides
    SET cash_received = v_new_total,
        change_amount = v_change,
        rider_credit_amount = COALESCE(v_ride.rider_credit_amount, 0) + v_rider_credit,
        cash_outstanding_amount = v_outstanding,
        cash_confirmed_at = now(),
        cash_confirmed_by = p_driver_id,
        payment_status = v_new_payment_status,
        updated_at = now()
    WHERE id = p_ride_id;

    -- Convert overpayment into rider credit — same wallets/
    -- wallet_transactions shape rider_wallet_top_up() already writes,
    -- crediting ride_credits (not balance, which is real money) and
    -- tagged to this ride for the ledger.
    IF v_rider_credit > 0 THEN
        SELECT user_id INTO v_rider_user_id FROM public.riders WHERE id = v_ride.rider_id;
        IF v_rider_user_id IS NOT NULL THEN
            v_wallet := public.ensure_rider_wallet(v_ride.rider_id);
            v_wallet_before := COALESCE(v_wallet.ride_credits, 0);
            UPDATE public.wallets
            SET ride_credits = v_wallet_before + v_rider_credit, updated_at = now()
            WHERE id = v_wallet.id;
            INSERT INTO public.wallet_transactions(
                wallet_id, transaction_type, amount, balance_before, balance_after,
                reference_type, reference_id, description, payment_method, status
            ) VALUES (
                v_wallet.id, 'cash_change_credit', v_rider_credit, v_wallet_before, v_wallet_before + v_rider_credit,
                'ride', p_ride_id, 'Cash overpayment converted to ride credit', 'cash', 'completed'
            );
        END IF;
    END IF;

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
            'rider_credit', v_rider_credit, 'outstanding', v_outstanding, 'payment_status', v_new_payment_status,
            'credit_action', p_credit_action
        ));

    RETURN jsonb_build_object(
        'success', true, 'ride_id', p_ride_id, 'fare', v_fare,
        'cash_received', v_new_total, 'change_amount', v_change, 'rider_credit_amount', v_rider_credit,
        'outstanding_amount', v_outstanding, 'payment_status', v_new_payment_status,
        'settlement_auto_paid', v_settle_amount
    );
END;
$$;

ALTER FUNCTION public.confirm_cash_payment(uuid, uuid, numeric, text) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.confirm_cash_payment(uuid, uuid, numeric, text) TO anon;
GRANT EXECUTE ON FUNCTION public.confirm_cash_payment(uuid, uuid, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_cash_payment(uuid, uuid, numeric, text) TO service_role;
