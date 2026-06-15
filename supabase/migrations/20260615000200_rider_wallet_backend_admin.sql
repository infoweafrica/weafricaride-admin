-- ====================================
-- WeAfrica Ride — Rider Wallet Backend/Admin Connectivity
-- ====================================
-- Firebase mobile clients use the anon Supabase key, so wallet money movement
-- must happen through SECURITY DEFINER RPCs. These functions keep wallets,
-- wallet_transactions, payments, rides, and admin finance in sync.

ALTER TABLE public.wallet_transactions
  ADD COLUMN IF NOT EXISTS payment_method TEXT,
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'completed',
  ADD COLUMN IF NOT EXISTS transaction_reference TEXT;

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS user_type TEXT,
  ADD COLUMN IF NOT EXISTS type TEXT,
  ADD COLUMN IF NOT EXISTS status TEXT,
  ADD COLUMN IF NOT EXISTS reference TEXT,
  ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'MWK';

ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS anon_wallets_all ON public.wallets;
CREATE POLICY anon_wallets_all ON public.wallets
  FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS anon_wallet_transactions_all ON public.wallet_transactions;
CREATE POLICY anon_wallet_transactions_all ON public.wallet_transactions
  FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS anon_payments_all ON public.payments;
CREATE POLICY anon_payments_all ON public.payments
  FOR ALL USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.ensure_rider_wallet(p_rider_id UUID)
RETURNS public.wallets
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_wallet public.wallets;
BEGIN
  SELECT user_id INTO v_user_id
  FROM public.riders
  WHERE id = p_rider_id;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Rider profile not found';
  END IF;

  INSERT INTO public.wallets(user_id, balance, ride_credits, promo_balance, refund_balance)
  VALUES (v_user_id, 0, 0, 0, 0)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT * INTO v_wallet
  FROM public.wallets
  WHERE user_id = v_user_id;

  RETURN v_wallet;
END;
$$;

CREATE OR REPLACE FUNCTION public.rider_wallet_top_up(
  p_rider_id UUID,
  p_amount NUMERIC,
  p_method TEXT DEFAULT 'airtel_money'
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wallet public.wallets;
  v_user_id UUID;
  v_before NUMERIC(12,2);
  v_after NUMERIC(12,2);
  v_reference TEXT;
  v_payment_id UUID;
  v_tx_id UUID;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Top-up amount must be greater than zero';
  END IF;

  v_wallet := public.ensure_rider_wallet(p_rider_id);
  v_user_id := v_wallet.user_id;
  v_before := COALESCE(v_wallet.balance, 0);
  v_after := v_before + p_amount;
  v_reference := 'rider_topup_' || extract(epoch from clock_timestamp())::bigint || '_' || substr(gen_random_uuid()::text, 1, 8);

  UPDATE public.wallets
  SET balance = v_after,
      updated_at = now()
  WHERE id = v_wallet.id
  RETURNING * INTO v_wallet;

  INSERT INTO public.wallet_transactions(
    wallet_id, transaction_type, amount, balance_before, balance_after,
    reference_type, description, payment_method, status, transaction_reference
  ) VALUES (
    v_wallet.id, 'top_up', p_amount, v_before, v_after,
    'payment', 'Wallet top-up via ' || COALESCE(p_method, 'mobile_money'),
    COALESCE(p_method, 'airtel_money'), 'completed', v_reference
  ) RETURNING id INTO v_tx_id;

  INSERT INTO public.payments(
    user_id, paid_by, user_type, type, amount, currency, payment_method,
    payment_status, status, transaction_reference, reference, paid_at
  ) VALUES (
    v_user_id, v_user_id, 'rider', 'topup', p_amount, 'MWK', COALESCE(p_method, 'airtel_money'),
    'completed', 'completed', v_reference, v_reference, now()
  ) RETURNING id INTO v_payment_id;

  RETURN jsonb_build_object('ok', true, 'wallet', to_jsonb(v_wallet), 'transaction_id', v_tx_id, 'payment_id', v_payment_id, 'reference', v_reference);
END;
$$;

CREATE OR REPLACE FUNCTION public.rider_wallet_transfer(
  p_rider_id UUID,
  p_amount NUMERIC,
  p_recipient TEXT,
  p_method TEXT DEFAULT 'airtel_money'
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wallet public.wallets;
  v_user_id UUID;
  v_before NUMERIC(12,2);
  v_after NUMERIC(12,2);
  v_reference TEXT;
  v_payment_id UUID;
  v_tx_id UUID;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Transfer amount must be greater than zero';
  END IF;

  IF COALESCE(NULLIF(p_recipient, ''), '') = '' THEN
    RAISE EXCEPTION 'Recipient is required';
  END IF;

  v_wallet := public.ensure_rider_wallet(p_rider_id);
  v_user_id := v_wallet.user_id;
  v_before := COALESCE(v_wallet.balance, 0);

  IF v_before < p_amount THEN
    RAISE EXCEPTION 'Insufficient wallet balance';
  END IF;

  v_after := v_before - p_amount;
  v_reference := 'rider_transfer_' || extract(epoch from clock_timestamp())::bigint || '_' || substr(gen_random_uuid()::text, 1, 8);

  UPDATE public.wallets
  SET balance = v_after,
      updated_at = now()
  WHERE id = v_wallet.id
  RETURNING * INTO v_wallet;

  INSERT INTO public.wallet_transactions(
    wallet_id, transaction_type, amount, balance_before, balance_after,
    reference_type, description, payment_method, status, transaction_reference
  ) VALUES (
    v_wallet.id, 'transfer', -p_amount, v_before, v_after,
    'transfer', 'Wallet transfer to ' || p_recipient,
    COALESCE(p_method, 'airtel_money'), 'pending', v_reference
  ) RETURNING id INTO v_tx_id;

  INSERT INTO public.payments(
    user_id, paid_by, user_type, type, amount, currency, payment_method,
    payment_status, status, transaction_reference, reference
  ) VALUES (
    v_user_id, v_user_id, 'rider', 'transfer', -p_amount, 'MWK', COALESCE(p_method, 'airtel_money'),
    'pending', 'pending', v_reference, v_reference
  ) RETURNING id INTO v_payment_id;

  RETURN jsonb_build_object('ok', true, 'wallet', to_jsonb(v_wallet), 'transaction_id', v_tx_id, 'payment_id', v_payment_id, 'reference', v_reference);
END;
$$;

CREATE OR REPLACE FUNCTION public.rider_wallet_pay_ride(
  p_rider_id UUID,
  p_ride_id UUID,
  p_amount NUMERIC DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wallet public.wallets;
  v_ride public.rides;
  v_user_id UUID;
  v_amount NUMERIC(12,2);
  v_before NUMERIC(12,2);
  v_after NUMERIC(12,2);
  v_reference TEXT;
  v_payment_id UUID;
  v_tx_id UUID;
BEGIN
  SELECT * INTO v_ride
  FROM public.rides
  WHERE id = p_ride_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ride not found';
  END IF;

  IF v_ride.rider_id IS DISTINCT FROM p_rider_id THEN
    RAISE EXCEPTION 'Rider does not own this ride';
  END IF;

  v_amount := COALESCE(p_amount, v_ride.actual_fare, v_ride.final_fare, v_ride.fare, v_ride.estimated_fare, 0);
  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'Ride payment amount must be greater than zero';
  END IF;

  v_wallet := public.ensure_rider_wallet(p_rider_id);
  v_user_id := v_wallet.user_id;
  v_before := COALESCE(v_wallet.balance, 0);

  IF v_before < v_amount THEN
    RAISE EXCEPTION 'Insufficient wallet balance';
  END IF;

  v_after := v_before - v_amount;
  v_reference := 'wallet_ride_' || extract(epoch from clock_timestamp())::bigint || '_' || substr(gen_random_uuid()::text, 1, 8);

  UPDATE public.wallets
  SET balance = v_after,
      updated_at = now()
  WHERE id = v_wallet.id
  RETURNING * INTO v_wallet;

  UPDATE public.rides
  SET payment_method = 'wallet',
      payment_status = 'paid',
      updated_at = now()
  WHERE id = p_ride_id
  RETURNING * INTO v_ride;

  INSERT INTO public.wallet_transactions(
    wallet_id, transaction_type, amount, balance_before, balance_after,
    reference_type, reference_id, description, payment_method, status, transaction_reference
  ) VALUES (
    v_wallet.id, 'ride_payment', -v_amount, v_before, v_after,
    'ride', p_ride_id, 'Ride payment from wallet', 'wallet', 'completed', v_reference
  ) RETURNING id INTO v_tx_id;

  INSERT INTO public.payments(
    ride_id, user_id, paid_by, user_type, type, amount, currency, payment_method,
    payment_status, status, transaction_reference, reference, paid_at
  ) VALUES (
    p_ride_id, v_user_id, v_user_id, 'rider', 'ride_payment', v_amount, 'MWK', 'wallet',
    'completed', 'completed', v_reference, v_reference, now()
  )
  ON CONFLICT (ride_id) DO UPDATE
    SET amount = EXCLUDED.amount,
        payment_method = EXCLUDED.payment_method,
        payment_status = EXCLUDED.payment_status,
        status = EXCLUDED.status,
        transaction_reference = EXCLUDED.transaction_reference,
        reference = EXCLUDED.reference,
        paid_at = EXCLUDED.paid_at,
        updated_at = now()
  RETURNING id INTO v_payment_id;

  RETURN jsonb_build_object('ok', true, 'wallet', to_jsonb(v_wallet), 'ride', to_jsonb(v_ride), 'transaction_id', v_tx_id, 'payment_id', v_payment_id, 'reference', v_reference);
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_rider_wallet(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rider_wallet_top_up(UUID, NUMERIC, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rider_wallet_transfer(UUID, NUMERIC, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rider_wallet_pay_ride(UUID, UUID, NUMERIC) TO anon, authenticated;

-- Keep admin finance aligned with rider wallet rows too. The previous admin
-- transaction RPC already listed payments, but rider top-ups/transfers have no
-- ride_id, so rider identity was blank. This version resolves riders by either
-- the ride or the payment user_id/paid_by and still unions driver wallet events.
CREATE OR REPLACE FUNCTION public.admin_list_transactions_enriched(
    p_search TEXT DEFAULT '',
    p_status TEXT DEFAULT NULL,
    p_type TEXT DEFAULT NULL,
    p_method TEXT DEFAULT NULL,
    p_vehicle_class TEXT DEFAULT NULL,
    p_city TEXT DEFAULT NULL,
    p_date_from TEXT DEFAULT NULL,
    p_date_to TEXT DEFAULT NULL,
    p_limit INT DEFAULT 25,
    p_offset INT DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_result JSONB;
BEGIN
    WITH payment_rows AS (
        SELECT
            p.id,
            p.ride_id,
            NULL::UUID AS driver_transaction_id,
            COALESCE(p.type, 'ride_payment') AS transaction_type,
            ABS(p.amount) AS gross_amount,
            p.payment_method,
            COALESCE(p.payment_status, p.status, 'pending') AS status,
            COALESCE(p.transaction_reference, p.reference) AS transaction_reference,
            p.created_at,
            rd.pickup_address, rd.dropoff_address,
            rd.distance_km, rd.duration_min,
            rd.city, rd.vehicle_class,
            rd.base_fare, rd.distance_fare, rd.time_fare,
            rd.surge_multiplier,
            COALESCE(te.commission_amount, 0) AS commission,
            COALESCE(te.tax_amount, 0) AS tax,
            COALESCE(te.net_earning, 0) AS driver_earnings,
            CASE WHEN COALESCE(te.is_paid_to_wallet, false) THEN 'paid' ELSE 'pending' END AS payout_status,
            CASE
              WHEN p.ride_id IS NULL AND COALESCE(p.user_type, '') = 'rider' THEN 'rider_wallet'
              ELSE NULL::TEXT
            END AS settlement_status,
            false AS fraud_flag,
            COALESCE(ride_rider_user.full_name, payment_user.full_name) AS rider_name,
            COALESCE(ride_rider_user.phone, payment_user.phone) AS rider_phone,
            driver_user.full_name AS driver_name,
            driver_user.phone AS driver_phone
        FROM public.payments p
        LEFT JOIN public.rides rd ON rd.id = p.ride_id
        LEFT JOIN public.trip_earnings te ON te.ride_id = p.ride_id
        LEFT JOIN public.riders ride_rider ON ride_rider.id = rd.rider_id
        LEFT JOIN public.users ride_rider_user ON ride_rider_user.id = ride_rider.user_id
        LEFT JOIN public.users payment_user ON payment_user.id = COALESCE(p.user_id, p.paid_by)
        LEFT JOIN public.drivers d ON d.id = rd.driver_id
        LEFT JOIN public.users driver_user ON driver_user.id = d.user_id
        WHERE NOT (COALESCE(p.user_type, '') = 'driver' AND COALESCE(p.type, '') IN ('payout', 'topup', 'transfer'))
    ),
    driver_rows AS (
        SELECT
            dt.id,
            CASE WHEN dt.reference_type = 'ride' THEN dt.reference_id ELSE NULL::UUID END AS ride_id,
            dt.id AS driver_transaction_id,
            dt.transaction_type,
            ABS(dt.amount) AS gross_amount,
            dt.payout_method AS payment_method,
            COALESCE(dt.status, 'completed') AS status,
            dt.payout_reference AS transaction_reference,
            dt.created_at,
            NULL::TEXT AS pickup_address, NULL::TEXT AS dropoff_address,
            NULL::NUMERIC AS distance_km, NULL::INTEGER AS duration_min,
            d.city, NULL::TEXT AS vehicle_class,
            NULL::NUMERIC AS base_fare, NULL::NUMERIC AS distance_fare, NULL::NUMERIC AS time_fare,
            NULL::NUMERIC AS surge_multiplier,
            0::NUMERIC AS commission,
            0::NUMERIC AS tax,
            dt.amount AS driver_earnings,
            CASE WHEN dt.transaction_type = 'withdrawal' THEN dt.status ELSE 'wallet' END AS payout_status,
            'driver_wallet' AS settlement_status,
            false AS fraud_flag,
            NULL::TEXT AS rider_name,
            NULL::TEXT AS rider_phone,
            u.full_name AS driver_name,
            u.phone AS driver_phone
        FROM public.driver_transactions dt
        LEFT JOIN public.drivers d ON d.id = dt.driver_id
        LEFT JOIN public.users u ON u.id = d.user_id
    ),
    unioned AS (
        SELECT * FROM payment_rows
        UNION ALL
        SELECT * FROM driver_rows
    ),
    filtered AS (
        SELECT * FROM unioned u
        WHERE
          (p_search = ''
            OR COALESCE(u.transaction_reference, '') ILIKE '%' || p_search || '%'
            OR COALESCE(u.rider_name, '') ILIKE '%' || p_search || '%'
            OR COALESCE(u.rider_phone, '') ILIKE '%' || p_search || '%'
            OR COALESCE(u.driver_name, '') ILIKE '%' || p_search || '%'
            OR COALESCE(u.driver_phone, '') ILIKE '%' || p_search || '%'
            OR u.id::TEXT ILIKE '%' || p_search || '%')
          AND (p_status IS NULL OR u.status = p_status)
          AND (p_type IS NULL OR u.transaction_type = p_type)
          AND (p_method IS NULL OR u.payment_method = p_method)
          AND (p_city IS NULL OR u.city = p_city)
          AND (p_vehicle_class IS NULL OR u.vehicle_class = p_vehicle_class)
          AND (p_date_from IS NULL OR u.created_at >= p_date_from::timestamptz)
          AND (p_date_to IS NULL OR u.created_at <= p_date_to::timestamptz)
    ),
    counted AS (SELECT COUNT(*) AS total FROM filtered)
    SELECT jsonb_build_object(
      'data', COALESCE((SELECT jsonb_agg(f.*) FROM (SELECT * FROM filtered ORDER BY created_at DESC LIMIT p_limit OFFSET p_offset) f), '[]'::jsonb),
      'total', COALESCE((SELECT total FROM counted), 0)
    ) INTO v_result;

    RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_list_transactions_enriched(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INT, INT) TO anon, authenticated;