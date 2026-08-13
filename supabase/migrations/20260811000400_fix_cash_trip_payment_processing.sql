-- process_ride_payment() computed v_payment_method but never actually
-- branched on it — every ride, cash or not, credited the fare-minus-
-- commission straight into driver_wallets.available_balance (the
-- withdrawable app balance). For a cash trip the rider pays the driver
-- directly, so the driver already has that money in hand; crediting it
-- to available_balance too meant a driver could collect cash AND later
-- withdraw the same amount again through the app, and WeAfrica's
-- commission on cash trips was never recorded as owed anywhere.
--
-- The schema already had the right columns for this
-- (driver_wallets.cash_collected, drivers.cash_collected,
-- trip_earnings.is_paid_to_wallet) — they were just never written to.
-- This completes that wiring:
--   - Cash trips: available_balance/available_for_withdrawal/balance are
--     left untouched; cash_collected (both tables) is incremented by the
--     full fare instead, for admin visibility/reconciliation (matches the
--     admin dashboard's drivers/wallets page, which already displays
--     cash_collected as a plain column).
--   - Wallet/card trips: unchanged from the original behavior.
--   - driver_transactions still records a 'ride_earning' row for cash
--     trips too (so it keeps counting toward the driver-app's "Today's
--     Earnings", which is sourced from this table) — only the actual
--     wallet balance movement differs.
--   - trip_earnings.is_paid_to_wallet is now false (paid_to_wallet_at
--     null) for cash trips instead of always true.
--   - driver_payouts (money the platform owes to pay the driver) is only
--     created for non-cash trips — no payout is owed for cash already
--     collected directly by the driver.

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
    -- tracks the full fare for cash trips instead. earned_*/trips_* stats
    -- still include cash trips — they're "how much did I earn" figures, not
    -- withdrawable-balance figures.
    INSERT INTO public.driver_wallets (
        driver_id,
        available_balance,
        available_for_withdrawal,
        balance,
        total_earned,
        pending_balance,
        cash_collected,
        currency,
        created_at,
        updated_at
    )
    VALUES (
        v_driver_id, v_wallet_delta, v_wallet_delta,
        v_wallet_delta, v_driver_net, 0,
        CASE WHEN v_is_cash THEN v_fare_amount ELSE 0 END,
        'MWK', NOW(), NOW()
    )
    ON CONFLICT (driver_id) DO UPDATE
    SET
        available_balance = COALESCE(public.driver_wallets.available_balance, 0) + v_wallet_delta,
        available_for_withdrawal = COALESCE(public.driver_wallets.available_for_withdrawal, 0) + v_wallet_delta,
        balance = COALESCE(public.driver_wallets.balance, 0) + v_wallet_delta,
        cash_collected = COALESCE(public.driver_wallets.cash_collected, 0) + CASE WHEN v_is_cash THEN v_fare_amount ELSE 0 END,
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
        SET cash_collected = COALESCE(cash_collected, 0) + v_fare_amount,
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
    -- against a driver's accumulated cash_collected is a separate,
    -- outside-the-app admin process.
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
        'cash_collected_delta', CASE WHEN v_is_cash THEN v_fare_amount ELSE 0 END,
        'escrow_status', COALESCE(v_escrow.escrow_status, 'no_escrow'),
        'company_revenue', v_commission_amount + v_booking_fee
    );
END;
$$;
