-- Cash overpayment: require rider confirmation before crediting —
-- closes a gap in the Module 1 cash payment engine
-- (20260812000100_cash_payment_engine.sql). confirm_cash_payment() let
-- the driver alone choose 'credit_rider' and credited wallets.ride_credits
-- immediately on their say-so, with no opportunity for the rider to
-- dispute an overstated cash amount before real money moved. This defers
-- the actual credit to a new rider-only RPC, confirm_rider_credit(),
-- while still marking the ride 'paid' the instant cash-in-hand covers the
-- fare (the fare itself isn't in question — only how the excess over it
-- gets resolved).

ALTER TABLE public.rides
  ADD COLUMN IF NOT EXISTS pending_rider_credit_amount numeric(10,2),
  ADD COLUMN IF NOT EXISTS credit_confirmation_status text;

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

    v_fare := COALESCE(v_ride.final_fare, v_ride.actual_fare, v_ride.fare, v_ride.estimated_fare, 0);
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

ALTER FUNCTION public.confirm_cash_payment(uuid, uuid, numeric, text) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.confirm_cash_payment(uuid, uuid, numeric, text) TO anon;
GRANT EXECUTE ON FUNCTION public.confirm_cash_payment(uuid, uuid, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_cash_payment(uuid, uuid, numeric, text) TO service_role;

-- The rider-only counterpart: the one place a cash-overpayment credit
-- actually reaches wallets.ride_credits. Idempotent — a second call once
-- resolved just returns the resolved state rather than erroring, safe for
-- a flaky-network retry from the rider app.
CREATE OR REPLACE FUNCTION public.confirm_rider_credit(
    p_ride_id uuid,
    p_rider_id uuid,
    p_accept boolean
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_ride public.rides;
    v_rider_user_id uuid;
    v_wallet public.wallets;
    v_wallet_before numeric(12,2);
    v_credit numeric(10,2);
BEGIN
    SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Ride not found', 'code', 'TRIP_NOT_FOUND');
    END IF;
    IF v_ride.rider_id IS DISTINCT FROM p_rider_id THEN
        RETURN jsonb_build_object('success', false, 'error', 'You are not the rider on this ride', 'code', 'NOT_YOUR_RIDE');
    END IF;

    IF v_ride.credit_confirmation_status IS DISTINCT FROM 'pending' THEN
        RETURN jsonb_build_object(
            'success', true, 'ride_id', p_ride_id, 'already_resolved', true,
            'credit_confirmation_status', v_ride.credit_confirmation_status,
            'rider_credit_amount', v_ride.rider_credit_amount,
            'change_amount', v_ride.change_amount
        );
    END IF;

    v_credit := COALESCE(v_ride.pending_rider_credit_amount, 0);

    IF p_accept THEN
        SELECT user_id INTO v_rider_user_id FROM public.riders WHERE id = v_ride.rider_id;
        IF v_rider_user_id IS NOT NULL AND v_credit > 0 THEN
            v_wallet := public.ensure_rider_wallet(v_ride.rider_id);
            v_wallet_before := COALESCE(v_wallet.ride_credits, 0);
            UPDATE public.wallets
            SET ride_credits = v_wallet_before + v_credit, updated_at = now()
            WHERE id = v_wallet.id;
            INSERT INTO public.wallet_transactions(
                wallet_id, transaction_type, amount, balance_before, balance_after,
                reference_type, reference_id, description, payment_method, status
            ) VALUES (
                v_wallet.id, 'cash_change_credit', v_credit, v_wallet_before, v_wallet_before + v_credit,
                'ride', p_ride_id, 'Cash overpayment converted to ride credit (rider-confirmed)', 'cash', 'completed'
            );
        END IF;
        UPDATE public.rides
        SET rider_credit_amount = COALESCE(rider_credit_amount, 0) + v_credit,
            credit_confirmation_status = 'accepted',
            pending_rider_credit_amount = 0,
            updated_at = now()
        WHERE id = p_ride_id;
    ELSE
        -- Declined: driver hands back change instead. No wallet movement.
        UPDATE public.rides
        SET change_amount = COALESCE(change_amount, 0) + v_credit,
            credit_confirmation_status = 'declined',
            pending_rider_credit_amount = 0,
            updated_at = now()
        WHERE id = p_ride_id;
    END IF;

    INSERT INTO public.ride_events(ride_id, actor_id, event_type, metadata)
    VALUES (p_ride_id, p_rider_id, 'rider_credit_confirmation',
        jsonb_build_object('accepted', p_accept, 'amount', v_credit));

    RETURN jsonb_build_object(
        'success', true, 'ride_id', p_ride_id, 'accepted', p_accept, 'amount', v_credit,
        'credit_confirmation_status', CASE WHEN p_accept THEN 'accepted' ELSE 'declined' END
    );
END;
$$;

ALTER FUNCTION public.confirm_rider_credit(uuid, uuid, boolean) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.confirm_rider_credit(uuid, uuid, boolean) TO anon;
GRANT EXECUTE ON FUNCTION public.confirm_rider_credit(uuid, uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_rider_credit(uuid, uuid, boolean) TO service_role;

-- Notifications: tell the rider there's a credit decision waiting on
-- them, and tell the driver which way it was resolved.
CREATE OR REPLACE FUNCTION public.trg_notify_cash_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_rider_user_id uuid;
  v_driver_user_id uuid;
BEGIN
  SELECT user_id INTO v_rider_user_id FROM public.riders WHERE id = NEW.rider_id;
  SELECT user_id INTO v_driver_user_id FROM public.drivers WHERE id = NEW.driver_id;

  IF NEW.payment_status IS DISTINCT FROM OLD.payment_status THEN
    IF NEW.payment_status = 'paid' THEN
      PERFORM public.notify_user_push(v_rider_user_id, 'Cash payment confirmed',
        'MWK ' || COALESCE(NEW.cash_received, 0)::int || ' paid for your WeAfrica Ride.',
        jsonb_build_object('ride_id', NEW.id::text, 'payment_status', NEW.payment_status));
      PERFORM public.notify_user_push(v_driver_user_id, 'Cash payment recorded',
        'MWK ' || COALESCE(NEW.cash_received, 0)::int || ' received.',
        jsonb_build_object('ride_id', NEW.id::text, 'payment_status', NEW.payment_status));
    ELSIF NEW.payment_status = 'partially_paid' THEN
      PERFORM public.notify_user_push(v_rider_user_id, 'Partial cash payment recorded',
        'MWK ' || COALESCE(NEW.cash_outstanding_amount, 0)::int || ' still owed to your driver.',
        jsonb_build_object('ride_id', NEW.id::text, 'payment_status', NEW.payment_status));
    END IF;
  END IF;

  IF NEW.credit_confirmation_status IS DISTINCT FROM OLD.credit_confirmation_status THEN
    IF NEW.credit_confirmation_status = 'pending' THEN
      PERFORM public.notify_user_push(v_rider_user_id, 'Confirm your ride credit',
        'Your driver reported MWK ' || COALESCE(NEW.pending_rider_credit_amount, 0)::int ||
          ' extra cash. Open the app to add it to your WeAfrica Wallet or ask for change.',
        jsonb_build_object('ride_id', NEW.id::text, 'credit_confirmation_status', NEW.credit_confirmation_status));
    ELSIF NEW.credit_confirmation_status = 'accepted' THEN
      PERFORM public.notify_user_push(v_driver_user_id, 'Rider accepted the credit',
        'MWK ' || COALESCE(NEW.rider_credit_amount, 0)::int || ' added to the rider''s wallet. No change owed.',
        jsonb_build_object('ride_id', NEW.id::text, 'credit_confirmation_status', NEW.credit_confirmation_status));
    ELSIF NEW.credit_confirmation_status = 'declined' THEN
      PERFORM public.notify_user_push(v_driver_user_id, 'Rider wants change',
        'Please hand back MWK ' || COALESCE(NEW.change_amount, 0)::int || ' change to your rider.',
        jsonb_build_object('ride_id', NEW.id::text, 'credit_confirmation_status', NEW.credit_confirmation_status));
    END IF;
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS rides_notify_cash_payment ON public.rides;
CREATE TRIGGER rides_notify_cash_payment
AFTER UPDATE ON public.rides
FOR EACH ROW
WHEN (NEW.payment_method = 'cash' AND (
  NEW.payment_status IS DISTINCT FROM OLD.payment_status
  OR NEW.credit_confirmation_status IS DISTINCT FROM OLD.credit_confirmation_status
))
EXECUTE FUNCTION public.trg_notify_cash_payment();
