-- ============================================
-- Connect Driver Transactions to Admin Finance
-- ============================================

-- Step 1: Add columns to payments (if it exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'payments') THEN
    ALTER TABLE public.payments
      ADD COLUMN IF NOT EXISTS user_id UUID,
      ADD COLUMN IF NOT EXISTS user_type TEXT,
      ADD COLUMN IF NOT EXISTS type TEXT,
      ADD COLUMN IF NOT EXISTS status TEXT,
      ADD COLUMN IF NOT EXISTS reference TEXT,
      ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'MWK';
  END IF;
END $$;

-- Step 2: Function for payment compatibility
CREATE OR REPLACE FUNCTION public.normalize_payment_compat_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.payment_status IS NULL THEN
    NEW.payment_status := COALESCE(NEW.status, 'pending');
  END IF;
  IF NEW.status IS NULL THEN
    NEW.status := COALESCE(NEW.payment_status, 'pending');
  END IF;
  IF NEW.transaction_reference IS NULL THEN
    NEW.transaction_reference := NEW.reference;
  END IF;
  IF NEW.reference IS NULL THEN
    NEW.reference := NEW.transaction_reference;
  END IF;
  IF NEW.paid_by IS NULL THEN
    NEW.paid_by := NEW.user_id;
  END IF;
  IF NEW.user_id IS NULL THEN
    NEW.user_id := NEW.paid_by;
  END IF;
  RETURN NEW;
END;
$$;

-- Step 3: Trigger (only if payments exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'payments') THEN
    DROP TRIGGER IF EXISTS trg_normalize_payment_compat_fields ON public.payments;
    CREATE TRIGGER trg_normalize_payment_compat_fields
      BEFORE INSERT OR UPDATE ON public.payments
      FOR EACH ROW
      EXECUTE FUNCTION public.normalize_payment_compat_fields();
  END IF;
END $$;

-- Step 4: RLS policies (only if tables exist)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'payments') THEN
    DROP POLICY IF EXISTS anon_insert_payments ON public.payments;
    CREATE POLICY anon_insert_payments ON public.payments FOR INSERT WITH CHECK (true);
    DROP POLICY IF EXISTS anon_read_ownish_payments ON public.payments;
    CREATE POLICY anon_read_ownish_payments ON public.payments FOR SELECT USING (true);
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'driver_transactions') THEN
    DROP POLICY IF EXISTS anon_insert_driver_transactions ON public.driver_transactions;
    CREATE POLICY anon_insert_driver_transactions ON public.driver_transactions FOR INSERT WITH CHECK (true);
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'driver_wallets') THEN
    DROP POLICY IF EXISTS anon_update_driver_wallets ON public.driver_wallets;
    CREATE POLICY anon_update_driver_wallets ON public.driver_wallets FOR UPDATE USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Step 5: Admin transaction view function
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
AS $$
DECLARE
    v_result JSONB;
BEGIN
    WITH payment_rows AS (
        SELECT
            p.id, p.ride_id, NULL::UUID AS driver_transaction_id,
            COALESCE(p.type, 'ride_payment') AS transaction_type,
            p.amount AS gross_amount, p.payment_method,
            COALESCE(p.payment_status, p.status, 'pending') AS status,
            COALESCE(p.transaction_reference, p.reference) AS transaction_reference,
            p.created_at,
            rd.pickup_address, rd.dropoff_address, rd.distance_km, rd.duration_min,
            rd.city, rd.vehicle_class, rd.base_fare, rd.distance_fare, rd.time_fare,
            rd.surge_multiplier,
            COALESCE(te.commission_amount, 0) AS commission,
            COALESCE(te.tax_amount, 0) AS tax,
            COALESCE(te.net_earning, 0) AS driver_earnings,
            CASE WHEN COALESCE(te.is_paid_to_wallet, false) THEN 'paid' ELSE 'pending' END AS payout_status,
            NULL::TEXT AS settlement_status, false AS fraud_flag,
            ru.full_name AS rider_name, ru.phone AS rider_phone,
            ru2.full_name AS driver_name, ru2.phone AS driver_phone
        FROM public.payments p
        LEFT JOIN public.rides rd ON rd.id = p.ride_id
        LEFT JOIN public.trip_earnings te ON te.ride_id = p.ride_id
        LEFT JOIN public.riders ri ON ri.id = rd.rider_id
        LEFT JOIN public.users ru ON ru.id = ri.user_id
        LEFT JOIN public.drivers d ON d.id = rd.driver_id
        LEFT JOIN public.users ru2 ON ru2.id = d.user_id
        WHERE NOT (COALESCE(p.user_type, '') = 'driver' AND COALESCE(p.type, '') IN ('payout', 'topup', 'transfer'))
    ), driver_rows AS (
        SELECT
            dt.id,
            CASE WHEN dt.reference_type = 'ride' THEN dt.reference_id ELSE NULL::UUID END AS ride_id,
            dt.id AS driver_transaction_id,
            dt.transaction_type, ABS(dt.amount) AS gross_amount,
            dt.payout_method AS payment_method, COALESCE(dt.status,'completed') AS status,
            dt.payout_reference AS transaction_reference, dt.created_at,
            NULL::TEXT AS pickup_address, NULL::TEXT AS dropoff_address,
            NULL::NUMERIC AS distance_km, NULL::INTEGER AS duration_min,
            d.city, NULL::TEXT AS vehicle_class,
            NULL::NUMERIC AS base_fare, NULL::NUMERIC AS distance_fare, NULL::NUMERIC AS time_fare,
            NULL::NUMERIC AS surge_multiplier,
            0::NUMERIC AS commission, 0::NUMERIC AS tax, dt.amount AS driver_earnings,
            CASE WHEN dt.transaction_type = 'withdrawal' THEN dt.status ELSE 'wallet' END AS payout_status,
            'driver_wallet' AS settlement_status, false AS fraud_flag,
            NULL::TEXT AS rider_name, NULL::TEXT AS rider_phone,
            u.full_name AS driver_name, u.phone AS driver_phone
        FROM public.driver_transactions dt
        LEFT JOIN public.drivers d ON d.id = dt.driver_id
        LEFT JOIN public.users u ON u.id = d.user_id
    ), unioned AS (
        SELECT * FROM payment_rows UNION ALL SELECT * FROM driver_rows
    ), filtered AS (
        SELECT * FROM unioned u
        WHERE (p_search = '' OR COALESCE(u.transaction_reference, '') ILIKE '%' || p_search || '%' OR COALESCE(u.rider_name, '') ILIKE '%' || p_search || '%' OR COALESCE(u.driver_name, '') ILIKE '%' || p_search || '%' OR u.id::TEXT ILIKE '%' || p_search || '%')
          AND (p_status IS NULL OR u.status = p_status)
          AND (p_type IS NULL OR u.transaction_type = p_type)
          AND (p_method IS NULL OR u.payment_method = p_method)
          AND (p_city IS NULL OR u.city = p_city)
          AND (p_vehicle_class IS NULL OR u.vehicle_class = p_vehicle_class)
          AND (p_date_from IS NULL OR u.created_at >= p_date_from::timestamptz)
          AND (p_date_to IS NULL OR u.created_at <= p_date_to::timestamptz)
    ), counted AS (SELECT COUNT(*) AS total FROM filtered)
    SELECT jsonb_build_object(
      'data', COALESCE((SELECT jsonb_agg(f.*) FROM (SELECT * FROM filtered ORDER BY created_at DESC LIMIT p_limit OFFSET p_offset) f), '[]'::jsonb),
      'total', COALESCE((SELECT total FROM counted), 0)
    ) INTO v_result;
    RETURN v_result;
END;
$$;
