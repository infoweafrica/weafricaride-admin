-- Corporate Account & Billing Engine.
--
-- Businesses whose employees ride and get billed to the company instead
-- of paying personally. Admin-managed for this first pass (WeAfrica staff
-- create accounts and invite employees from admin-dashboard, mirroring
-- the existing staff_invitations flow) — employees only interact via the
-- rider app (pick "Company" as payment method, join with an invite code).
-- A self-service company-admin surface inside the rider app is an
-- explicit fast-follow, not built here.
--
-- Two billing methods ship now: corporate_wallet (prepaid, debited per
-- trip, blocks booking if the balance is too low) and monthly_invoice
-- (postpaid, rides accumulate until an admin generates an invoice).
--
-- Naming uses corporate_* throughout — company_commissions/
-- company_transactions are WeAfrica's own internal revenue bookkeeping,
-- not customer-facing, and share nothing with this feature beyond the
-- word "company."

-- ── 1. corporate_accounts — the paying business ──
CREATE TABLE public.corporate_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  registration_number text,
  billing_email text NOT NULL,
  finance_email text,
  phone text,
  address text,
  billing_method text NOT NULL DEFAULT 'monthly_invoice' CHECK (billing_method IN ('corporate_wallet', 'monthly_invoice')),
  wallet_balance numeric(12,2) NOT NULL DEFAULT 0,   -- only moves for corporate_wallet accounts
  credit_limit numeric(12,2),
  daily_employee_limit numeric(10,2),                -- default per-employee daily cap; corporate_account_members.daily_limit_override wins if set
  monthly_account_limit numeric(12,2),                -- cap across all employees combined
  allowed_vehicle_classes text[],                     -- null = all classes allowed
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  invoice_frequency text NOT NULL DEFAULT 'monthly',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ── 2. corporate_account_members — a rider's membership in a company ──
-- One active membership per rider for this MVP: joining a second company
-- while active in one is rejected (simplicity over flexibility for now).
CREATE TABLE public.corporate_account_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  corporate_account_id uuid NOT NULL REFERENCES public.corporate_accounts(id),
  rider_id uuid NOT NULL REFERENCES public.riders(id),
  role text NOT NULL DEFAULT 'employee' CHECK (role IN ('owner', 'admin', 'finance', 'employee')),
  daily_limit_override numeric(10,2),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  invited_by uuid
);
CREATE UNIQUE INDEX corporate_account_members_one_active_per_rider
  ON public.corporate_account_members (rider_id) WHERE status = 'active';
CREATE INDEX idx_corporate_account_members_account ON public.corporate_account_members(corporate_account_id);

-- ── 3. corporate_invitations — mirrors staff_invitations, scoped to a ──
-- corporate account instead of a geography. A short, human-enterable
-- code (not a long token) since the rider enters it directly in-app —
-- no email-link/deep-link infrastructure to build.
CREATE TABLE public.corporate_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  corporate_account_id uuid NOT NULL REFERENCES public.corporate_accounts(id),
  email text NOT NULL,
  role text NOT NULL DEFAULT 'employee' CHECK (role IN ('owner', 'admin', 'finance', 'employee')),
  invite_code text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'expired', 'revoked')),
  invited_by uuid,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  accepted_by uuid REFERENCES public.riders(id),
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_corporate_invitations_account ON public.corporate_invitations(corporate_account_id);

-- ── 4. corporate_wallet_transactions — ledger for corporate_wallet ──
-- accounts, same append-only pattern as wallet_transactions.
CREATE TABLE public.corporate_wallet_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  corporate_account_id uuid NOT NULL REFERENCES public.corporate_accounts(id),
  ride_id uuid REFERENCES public.rides(id),
  transaction_type text NOT NULL,
  amount numeric(12,2) NOT NULL,
  balance_before numeric(12,2),
  balance_after numeric(12,2),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_corporate_wallet_transactions_account ON public.corporate_wallet_transactions(corporate_account_id);

-- ── 5. corporate_invoices + corporate_invoice_items — for ──
-- monthly_invoice accounts. Distinct from the existing per-ride
-- ride_invoices (which stays the individual employee receipt) — this is
-- the many-rides-to-one-invoice aggregate.
CREATE TABLE public.corporate_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  corporate_account_id uuid NOT NULL REFERENCES public.corporate_accounts(id),
  period_start date NOT NULL,
  period_end date NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'issued', 'paid', 'overdue')),
  total_amount numeric(12,2) NOT NULL DEFAULT 0,
  issued_at timestamptz,
  due_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.corporate_invoice_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  corporate_invoice_id uuid NOT NULL REFERENCES public.corporate_invoices(id),
  ride_id uuid NOT NULL REFERENCES public.rides(id),
  fare_amount numeric(10,2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_corporate_invoices_account ON public.corporate_invoices(corporate_account_id);
CREATE INDEX idx_corporate_invoice_items_invoice ON public.corporate_invoice_items(corporate_invoice_id);

-- ── 6. rides — link a ride to a corporate account + (once billed) invoice ──
ALTER TABLE public.rides
  ADD COLUMN IF NOT EXISTS corporate_account_id uuid REFERENCES public.corporate_accounts(id),
  ADD COLUMN IF NOT EXISTS corporate_invoice_id uuid REFERENCES public.corporate_invoices(id);
CREATE INDEX IF NOT EXISTS idx_rides_corporate_unbilled
  ON public.rides(corporate_account_id) WHERE corporate_account_id IS NOT NULL AND corporate_invoice_id IS NULL;

-- ── RLS: default-deny, same posture as admin_users — all admin CRUD goes ──
-- through service-role API routes, all rider-app access goes through the
-- SECURITY DEFINER RPCs below. No anon/authenticated policy needed on any
-- of these six objects (no direct client reads of corporate financial
-- data, unlike the more permissive early-era tables this project has
-- since had to walk back).
ALTER TABLE public.corporate_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.corporate_account_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.corporate_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.corporate_wallet_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.corporate_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.corporate_invoice_items ENABLE ROW LEVEL SECURITY;

-- ── 7. book_rider_trip — extend with an optional corporate-billed path ──
-- Appends one new trailing param (this file's own established pattern —
-- it previously dropped a stale overload precisely to avoid ambiguous-
-- overload collisions, so new params go on the end with a DEFAULT).
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
AS $$
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
      'estimated_fare', COALESCE(p_estimated_fare, 0)
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
$$;

-- ── 8. process_ride_payment — one small additive branch for corporate ──
-- billing. Driver settlement is already correct with zero changes: the
-- function already treats any non-'cash' payment_method as "WeAfrica
-- collected the money, credit the driver's net earnings immediately"
-- (v_wallet_delta is nonzero for anything that isn't 'cash') — a
-- 'corporate' ride falls into that same branch automatically, exactly
-- like a wallet/card trip. Only the billing side is new: for
-- corporate_wallet accounts, debit the company's balance right here; for
-- monthly_invoice accounts, do nothing now — the ride just sits with
-- corporate_invoice_id IS NULL until generate_corporate_invoice sweeps
-- it up later.
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

-- ── 9. get_active_corporate_membership — rider-app lookup ──
-- Small, anon-callable RPC rather than an open RLS policy on
-- corporate_account_members/corporate_accounts — keeps both tables at
-- default-deny while still letting the rider app check "does this rider
-- belong to an active company" before showing the payment option.
CREATE OR REPLACE FUNCTION public.get_active_corporate_membership(p_rider_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_member public.corporate_account_members;
    v_account public.corporate_accounts;
BEGIN
    SELECT * INTO v_member FROM public.corporate_account_members
    WHERE rider_id = p_rider_id AND status = 'active';
    IF NOT FOUND THEN
        RETURN jsonb_build_object('has_membership', false);
    END IF;

    SELECT * INTO v_account FROM public.corporate_accounts WHERE id = v_member.corporate_account_id;

    RETURN jsonb_build_object(
        'has_membership', true,
        'corporate_account_id', v_member.corporate_account_id,
        'company_name', v_account.name,
        'role', v_member.role,
        'account_status', v_account.status
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_active_corporate_membership(uuid) TO anon, authenticated;

-- ── 10. confirm_corporate_invite — rider joins a company with a code ──
CREATE OR REPLACE FUNCTION public.confirm_corporate_invite(p_invite_code text, p_rider_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_invite public.corporate_invitations;
    v_existing public.corporate_account_members;
BEGIN
    IF p_invite_code IS NULL OR p_rider_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Invite code and rider are required');
    END IF;

    SELECT * INTO v_invite FROM public.corporate_invitations
    WHERE invite_code = upper(trim(p_invite_code)) FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Invalid invite code', 'code', 'INVALID_CODE');
    END IF;
    IF v_invite.status != 'pending' THEN
        RETURN jsonb_build_object('success', false, 'error', 'This invite has already been used or revoked', 'code', 'INVITE_NOT_PENDING');
    END IF;
    IF v_invite.expires_at < now() THEN
        UPDATE public.corporate_invitations SET status = 'expired' WHERE id = v_invite.id;
        RETURN jsonb_build_object('success', false, 'error', 'This invite code has expired', 'code', 'INVITE_EXPIRED');
    END IF;

    SELECT * INTO v_existing FROM public.corporate_account_members
    WHERE rider_id = p_rider_id AND status = 'active';
    IF FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'You already belong to a company account', 'code', 'ALREADY_A_MEMBER');
    END IF;

    INSERT INTO public.corporate_account_members(corporate_account_id, rider_id, role, invited_by)
    VALUES (v_invite.corporate_account_id, p_rider_id, v_invite.role, v_invite.invited_by);

    UPDATE public.corporate_invitations
    SET status = 'accepted', accepted_by = p_rider_id, accepted_at = now()
    WHERE id = v_invite.id;

    RETURN jsonb_build_object('success', true, 'corporate_account_id', v_invite.corporate_account_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.confirm_corporate_invite(text, uuid) TO anon, authenticated;

-- ── 11. generate_corporate_invoice — admin-triggered, service-role only ──
-- (called from the admin-dashboard API route via the service-role
-- client, not by anon/authenticated clients — mirrors admin_verify_login's
-- revoke-from-anon pattern). Kept as one atomic function rather than
-- multiple service-role queries from the API route since it has to insert
-- one invoice + N line items + stamp N rides consistently.
CREATE OR REPLACE FUNCTION public.generate_corporate_invoice(
    p_corporate_account_id uuid,
    p_period_start date,
    p_period_end date
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_invoice public.corporate_invoices;
    v_total numeric(12,2) := 0;
    v_ride RECORD;
    v_count integer := 0;
BEGIN
    INSERT INTO public.corporate_invoices(corporate_account_id, period_start, period_end, status, issued_at)
    VALUES (p_corporate_account_id, p_period_start, p_period_end, 'issued', now())
    RETURNING * INTO v_invoice;

    FOR v_ride IN
        SELECT id, COALESCE(final_fare, actual_fare, estimated_fare, 0) AS fare_amount
        FROM public.rides
        WHERE corporate_account_id = p_corporate_account_id
          AND corporate_invoice_id IS NULL
          AND payment_status = 'paid'
          AND completed_at::date BETWEEN p_period_start AND p_period_end
        FOR UPDATE
    LOOP
        INSERT INTO public.corporate_invoice_items(corporate_invoice_id, ride_id, fare_amount)
        VALUES (v_invoice.id, v_ride.id, v_ride.fare_amount);

        UPDATE public.rides SET corporate_invoice_id = v_invoice.id WHERE id = v_ride.id;

        v_total := v_total + v_ride.fare_amount;
        v_count := v_count + 1;
    END LOOP;

    UPDATE public.corporate_invoices SET total_amount = v_total WHERE id = v_invoice.id;

    RETURN jsonb_build_object(
        'success', true,
        'corporate_invoice_id', v_invoice.id,
        'ride_count', v_count,
        'total_amount', v_total
    );
END;
$$;

REVOKE ALL ON FUNCTION public.generate_corporate_invoice(uuid, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.generate_corporate_invoice(uuid, date, date) TO service_role;
