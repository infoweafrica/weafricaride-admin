-- Booking fee: derive from the admin-configured pricing_config.booking_fee
-- instead of a hard-coded number, and stop double-charging it.
--
-- Found while investigating the earlier zero-fare fix: pricing_config
-- already HAS an admin-configurable booking_fee column (edited today via
-- the admin Pricing page), and compute_fare_estimate() already folds it
-- into the total shown to the rider: v_subtotal := base_fare +
-- distance_fare + time_fare + booking_fee. The rider-app calls
-- estimate_fare() (which wraps compute_fare_estimate()) to get that
-- total, then passes it straight through as p_estimated_fare into
-- book_rider_trip() — so rides.fare/estimated_fare already includes the
-- admin-configured booking fee by the time a ride is created.
--
-- process_ride_payment() didn't know this: it computed
-- v_rider_total := v_fare_amount + v_booking_fee, adding the booking fee
-- a SECOND time on top of a fare that already contains it. This was
-- invisible only because rides.booking_fee (and process_ride_payment's
-- COALESCE(booking_fee, 300) fallback) never actually got populated with
-- the real configured value — the moment either was fixed in isolation,
-- riders would be charged the booking fee twice.
--
-- Fix, per explicit direction: book_rider_trip now looks up the same
-- admin-configured pricing_config row compute_fare_estimate would have
-- used (mirroring its exact city/vehicle_type resolution) and snapshots
-- its booking_fee onto rides.booking_fee — for revenue-attribution
-- reporting only (company_transactions still records it as its own
-- 'booking_fee' line). process_ride_payment no longer adds it to
-- rider_total_amount, since it's already inside v_fare_amount. If no
-- pricing_config row is found at all (not even the global default),
-- booking fails loudly with a clear error rather than silently
-- proceeding with an unconfigured/zero fee.

CREATE OR REPLACE FUNCTION public.book_rider_trip(
  p_rider_id uuid,
  p_category_id uuid DEFAULT NULL,
  p_vehicle_class text DEFAULT NULL,
  p_pickup_address text DEFAULT 'Current Location',
  p_pickup_lat double precision DEFAULT NULL,
  p_pickup_lng double precision DEFAULT NULL,
  p_dropoff_address text DEFAULT '',
  p_dropoff_lat double precision DEFAULT NULL,
  p_dropoff_lng double precision DEFAULT NULL,
  p_payment_method text DEFAULT 'cash',
  p_estimated_fare numeric DEFAULT 0,
  p_distance_km numeric DEFAULT NULL,
  p_duration_min integer DEFAULT NULL,
  p_promo_code text DEFAULT NULL,
  p_corporate_account_id uuid DEFAULT NULL
) RETURNS public.rides
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_ride public.rides;
  v_vehicle_class TEXT;
  v_rider_user_id UUID;
  v_payment_method text;
  v_corp_member public.corporate_account_members;
  v_corp_account public.corporate_accounts;
  v_daily_limit numeric;
  v_daily_spent numeric;
  v_monthly_spent numeric;
  v_city text;
  v_pricing_row public.pricing_config;
  v_booking_fee numeric(10,2);
BEGIN
  IF p_rider_id IS NULL THEN
    RAISE EXCEPTION 'Rider profile is required';
  END IF;

  SELECT user_id INTO v_rider_user_id
  FROM public.riders
  WHERE id = p_rider_id;

  IF v_rider_user_id IS NULL THEN
    RAISE EXCEPTION 'Rider profile not found';
  END IF;

  SELECT COALESCE(p_vehicle_class, rc.slug, rc.name, 'x')
  INTO v_vehicle_class
  FROM public.ride_categories rc
  WHERE rc.id = p_category_id;

  v_vehicle_class := COALESCE(v_vehicle_class, p_vehicle_class, 'x');

  v_payment_method := COALESCE(NULLIF(p_payment_method, ''), 'cash');

  -- Snapshot the admin-configured booking fee for this location/vehicle
  -- class — same resolution order as compute_fare_estimate(): exact city
  -- beats city=NULL default, exact vehicle_type beats the 'all' wildcard,
  -- then a country-level global-default row if nothing city-specific
  -- matches. Only used for revenue-attribution reporting here — the fare
  -- itself (p_estimated_fare) already has this amount baked in from the
  -- rider-app's earlier estimate_fare() call.
  v_city := public.find_nearest_city(p_pickup_lat, p_pickup_lng);

  SELECT * INTO v_pricing_row
  FROM public.pricing_config
  WHERE country_code = 'MW'
    AND (city = v_city OR city IS NULL)
    AND (vehicle_type = v_vehicle_class OR vehicle_type = 'all')
    AND is_active = true
  ORDER BY
    CASE WHEN city = v_city THEN 0 ELSE 1 END,
    CASE WHEN vehicle_type = v_vehicle_class THEN 0 ELSE 1 END
  LIMIT 1;

  IF v_pricing_row.id IS NULL THEN
    SELECT * INTO v_pricing_row
    FROM public.pricing_config
    WHERE country_code = 'MW' AND vehicle_type = 'all' AND is_active = true
    ORDER BY CASE WHEN city = v_city THEN 0 ELSE 1 END
    LIMIT 1;
  END IF;

  IF v_pricing_row.id IS NULL THEN
    RAISE EXCEPTION 'Pricing is not configured for this location/vehicle class — an admin must set up pricing_config before rides can be booked';
  END IF;

  v_booking_fee := COALESCE(v_pricing_row.booking_fee, 0);

  -- Corporate-billed trip: validate membership, limits, and (for prepaid
  -- accounts) balance before this ride is ever created — this is the
  -- company's money, so reject up front rather than letting it go
  -- negative and sorting it out later.
  IF p_corporate_account_id IS NOT NULL THEN
    SELECT * INTO v_corp_member FROM public.corporate_account_members
    WHERE corporate_account_id = p_corporate_account_id AND rider_id = p_rider_id AND status = 'active';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Not an active member of this corporate account';
    END IF;

    SELECT * INTO v_corp_account FROM public.corporate_accounts
    WHERE id = p_corporate_account_id AND status = 'active';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Corporate account is not active';
    END IF;

    IF v_corp_account.allowed_vehicle_classes IS NOT NULL
       AND NOT (v_vehicle_class = ANY(v_corp_account.allowed_vehicle_classes)) THEN
      RAISE EXCEPTION 'This vehicle class is not allowed on your corporate account';
    END IF;

    v_daily_limit := COALESCE(v_corp_member.daily_limit_override, v_corp_account.daily_employee_limit);
    IF v_daily_limit IS NOT NULL THEN
      SELECT COALESCE(SUM(COALESCE(final_fare, estimated_fare, 0)), 0) INTO v_daily_spent
      FROM public.rides
      WHERE rider_id = p_rider_id AND corporate_account_id = p_corporate_account_id
        AND status = 'completed' AND completed_at >= date_trunc('day', now());
      IF v_daily_spent + COALESCE(p_estimated_fare, 0) > v_daily_limit THEN
        RAISE EXCEPTION 'This trip would exceed your daily corporate spending limit';
      END IF;
    END IF;

    IF v_corp_account.monthly_account_limit IS NOT NULL THEN
      SELECT COALESCE(SUM(COALESCE(final_fare, estimated_fare, 0)), 0) INTO v_monthly_spent
      FROM public.rides
      WHERE corporate_account_id = p_corporate_account_id
        AND status = 'completed' AND completed_at >= date_trunc('month', now());
      IF v_monthly_spent + COALESCE(p_estimated_fare, 0) > v_corp_account.monthly_account_limit THEN
        RAISE EXCEPTION 'This trip would exceed your company''s monthly spending limit';
      END IF;
    END IF;

    IF v_corp_account.billing_method = 'corporate_wallet'
       AND v_corp_account.wallet_balance < COALESCE(p_estimated_fare, 0) THEN
      RAISE EXCEPTION 'Corporate wallet balance is too low for this trip';
    END IF;

    v_payment_method := 'corporate';
  END IF;

  INSERT INTO public.rides (
    rider_id,
    category_id,
    vehicle_class,
    status,
    payment_method,
    payment_status,
    estimated_fare,
    fare,
    booking_fee,
    pickup_address,
    pickup_lat,
    pickup_lng,
    dropoff_address,
    dropoff_lat,
    dropoff_lng,
    destination_address,
    destination_lat,
    destination_lng,
    estimated_distance_km,
    distance_km,
    estimated_duration_minutes,
    duration_min,
    promo_code,
    corporate_account_id,
    requested_at,
    updated_at
  ) VALUES (
    p_rider_id,
    p_category_id,
    v_vehicle_class,
    'requested',
    v_payment_method,
    'pending',
    COALESCE(p_estimated_fare, 0),
    COALESCE(p_estimated_fare, 0),
    v_booking_fee,
    COALESCE(NULLIF(p_pickup_address, ''), 'Current Location'),
    p_pickup_lat,
    p_pickup_lng,
    COALESCE(p_dropoff_address, ''),
    p_dropoff_lat,
    p_dropoff_lng,
    COALESCE(p_dropoff_address, ''),
    p_dropoff_lat,
    p_dropoff_lng,
    p_distance_km,
    p_distance_km,
    p_duration_min,
    p_duration_min,
    NULLIF(p_promo_code, ''),
    p_corporate_account_id,
    now(),
    now()
  )
  RETURNING * INTO v_ride;

  INSERT INTO public.ride_events(ride_id, actor_id, event_type, metadata)
  VALUES (
    v_ride.id,
    v_rider_user_id,
    'rider_requested',
    jsonb_build_object(
      'source', 'rider_app',
      'payment_method', v_payment_method,
      'corporate_account_id', p_corporate_account_id,
      'estimated_fare', COALESCE(p_estimated_fare, 0),
      'booking_fee', v_booking_fee
    )
  );

  BEGIN
    PERFORM public.dispatch_ride_to_nearby_drivers(
      v_ride.id,
      p_pickup_lat,
      p_pickup_lng,
      5
    );

    SELECT * INTO v_ride FROM public.rides WHERE id = v_ride.id;
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.ride_events(ride_id, actor_id, event_type, metadata)
    VALUES (
      v_ride.id,
      v_rider_user_id,
      'dispatch_error',
      jsonb_build_object('message', SQLERRM)
    );
  END;

  RETURN v_ride;
END;
$function$;

-- process_ride_payment: stop adding booking_fee a second time. rides.booking_fee
-- is now a revenue-attribution snapshot only (set at booking time above) —
-- v_fare_amount already includes it, so rider_total_amount = v_fare_amount,
-- full stop. company_transactions still gets its own 'booking_fee' line for
-- reporting; that's an attribution split of revenue already collected, not
-- an additional charge. Fallback changed from a fabricated 300 to 0 — 0 here
-- means "this ride predates the booking_fee snapshot fix," not "pricing is
-- unconfigured" (that case is now caught at booking time in book_rider_trip).
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
    v_corporate_account public.corporate_accounts;
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
    v_booking_fee := COALESCE(v_ride.booking_fee, 0);
    v_commission_rate := COALESCE(v_ride.commission_rate, 15);
    v_payment_method := COALESCE(v_ride.payment_method, 'cash');
    v_is_cash := (v_payment_method = 'cash');
    -- Actual cash handed over (set by confirm_cash_payment before this
    -- runs) — falls back to fare for any historical/non-cash-confirm-flow
    -- callers so this stays backward compatible.
    v_cash_credited := COALESCE(v_ride.cash_received, v_fare_amount);

    v_commission_amount := ROUND(v_fare_amount * (v_commission_rate / 100), 2);
    v_driver_net := ROUND(v_fare_amount - v_commission_amount, 2);
    -- v_fare_amount already includes the admin-configured booking fee
    -- (folded in by compute_fare_estimate() at estimate time) — do not
    -- add v_booking_fee again here.
    v_rider_total := v_fare_amount;
    -- Actual withdrawable-wallet movement: zero for cash (driver already
    -- holds the money), the full net earning for wallet/card/corporate trips.
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

    -- Company transaction records — commission and booking fee are both
    -- revenue-attribution lines for reporting; booking_fee here does NOT
    -- represent additional money collected beyond v_fare_amount, it's a
    -- breakdown of how much of that fare was the platform booking fee vs.
    -- commission vs. driver's share.
    INSERT INTO public.company_transactions (transaction_type, amount, ride_id, description)
    VALUES
        ('commission_earning', v_commission_amount, p_ride_id,
         'Commission ' || v_commission_rate || '% on ride fare MWK ' || v_fare_amount),
        ('booking_fee', v_booking_fee, p_ride_id,
         'Rider booking fee MWK ' || v_booking_fee || ' (included within the ride fare, not an additional charge)');

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

    -- New: corporate billing. Driver settlement above already ran the
    -- non-cash branch (v_payment_method = 'corporate' is not 'cash'), so
    -- the driver is already paid — this only settles the company side.
    IF v_ride.corporate_account_id IS NOT NULL THEN
        SELECT * INTO v_corporate_account FROM public.corporate_accounts WHERE id = v_ride.corporate_account_id;
        IF FOUND AND v_corporate_account.billing_method = 'corporate_wallet' THEN
            UPDATE public.corporate_accounts
            SET wallet_balance = wallet_balance - v_rider_total, updated_at = now()
            WHERE id = v_ride.corporate_account_id;

            INSERT INTO public.corporate_wallet_transactions(
                corporate_account_id, ride_id, transaction_type, amount, balance_before, balance_after
            ) VALUES (
                v_ride.corporate_account_id, p_ride_id, 'ride_charge', -v_rider_total,
                v_corporate_account.wallet_balance, v_corporate_account.wallet_balance - v_rider_total
            );
        END IF;
        -- monthly_invoice accounts: no immediate money movement — the ride
        -- sits with corporate_invoice_id IS NULL until an admin generates
        -- an invoice for the period (generate_corporate_invoice).
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
