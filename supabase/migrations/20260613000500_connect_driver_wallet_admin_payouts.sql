-- ====================================
-- Connect Driver Wallet to Admin Payouts
-- Driver wallet cash-outs/transfers now surface in admin payout requests,
-- and legacy/new wallet balance columns stay in sync.
-- ====================================

-- The project has two historical wallet shapes:
--   driver app: available_balance, cash_collected, total_earned
--   payout admin: balance, available_for_withdrawal, total_withdrawn
-- Keep both shapes available so mobile + admin RPCs read the same wallet.
ALTER TABLE public.driver_wallets
  ADD COLUMN IF NOT EXISTS firebase_uid TEXT,
  ADD COLUMN IF NOT EXISTS available_balance DECIMAL(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS available_for_withdrawal DECIMAL(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS balance DECIMAL(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pending_balance DECIMAL(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cash_collected DECIMAL(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_earned DECIMAL(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_withdrawn DECIMAL(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'MWK';

UPDATE public.driver_wallets
SET
  available_balance = COALESCE(available_balance, available_for_withdrawal, balance, 0),
  available_for_withdrawal = COALESCE(available_for_withdrawal, available_balance, balance, 0),
  balance = COALESCE(balance, available_balance, available_for_withdrawal, 0),
  total_earned = COALESCE(total_earned, 0),
  total_withdrawn = COALESCE(total_withdrawn, 0),
  pending_balance = COALESCE(pending_balance, 0),
  cash_collected = COALESCE(cash_collected, 0),
  currency = COALESCE(currency, 'MWK');

CREATE OR REPLACE FUNCTION public.sync_driver_wallet_balance_columns()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_available DECIMAL(12,2);
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.available_balance IS DISTINCT FROM OLD.available_balance THEN
      v_available := COALESCE(NEW.available_balance, 0);
    ELSIF NEW.available_for_withdrawal IS DISTINCT FROM OLD.available_for_withdrawal THEN
      v_available := COALESCE(NEW.available_for_withdrawal, 0);
    ELSIF NEW.balance IS DISTINCT FROM OLD.balance THEN
      v_available := COALESCE(NEW.balance, 0);
    ELSE
      v_available := COALESCE(NEW.available_balance, NEW.available_for_withdrawal, NEW.balance, 0);
    END IF;
  ELSE
    v_available := COALESCE(NEW.available_balance, NEW.available_for_withdrawal, NEW.balance, 0);
  END IF;

  NEW.available_balance := v_available;
  NEW.available_for_withdrawal := v_available;
  NEW.balance := v_available;
  NEW.pending_balance := COALESCE(NEW.pending_balance, 0);
  NEW.cash_collected := COALESCE(NEW.cash_collected, 0);
  NEW.total_earned := COALESCE(NEW.total_earned, 0);
  NEW.total_withdrawn := COALESCE(NEW.total_withdrawn, 0);
  NEW.currency := COALESCE(NEW.currency, 'MWK');
  NEW.updated_at := NOW();

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_driver_wallet_balance_columns ON public.driver_wallets;
CREATE TRIGGER trg_sync_driver_wallet_balance_columns
  BEFORE INSERT OR UPDATE ON public.driver_wallets
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_driver_wallet_balance_columns();

-- Normalize pending driver wallet withdrawals/transfers before they are stored.
CREATE OR REPLACE FUNCTION public.normalize_driver_wallet_transaction()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_wallet_balance DECIMAL(12,2);
BEGIN
  IF COALESCE(NEW.transaction_type, '') IN ('withdrawal', 'payout', 'transfer')
     AND COALESCE(NEW.amount, 0) < 0 THEN
    IF NEW.balance_before IS NULL THEN
      SELECT COALESCE(available_balance, available_for_withdrawal, balance, 0)
      INTO v_wallet_balance
      FROM public.driver_wallets
      WHERE driver_id = NEW.driver_id
      LIMIT 1;

      NEW.balance_before := COALESCE(v_wallet_balance, 0);
    END IF;

    IF NEW.balance_after IS NULL OR NEW.balance_after = NEW.balance_before THEN
      NEW.balance_after := GREATEST(COALESCE(NEW.balance_before, 0) + NEW.amount, 0);
    END IF;

    NEW.status := COALESCE(NEW.status, 'pending');
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_normalize_driver_wallet_transaction ON public.driver_transactions;
CREATE TRIGGER trg_normalize_driver_wallet_transaction
  BEFORE INSERT OR UPDATE ON public.driver_transactions
  FOR EACH ROW
  EXECUTE FUNCTION public.normalize_driver_wallet_transaction();

-- Apply wallet withdrawal holds once when the mobile app creates a pending wallet transaction.
CREATE OR REPLACE FUNCTION public.apply_driver_wallet_transaction_to_wallet()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_amount DECIMAL(12,2);
BEGIN
  IF COALESCE(NEW.transaction_type, '') IN ('withdrawal', 'payout', 'transfer')
     AND COALESCE(NEW.amount, 0) < 0
     AND COALESCE(NEW.status, 'pending') IN ('pending', 'approved', 'processing') THEN
    v_amount := ABS(NEW.amount);

    UPDATE public.driver_wallets
    SET
      available_balance = NEW.balance_after,
      available_for_withdrawal = NEW.balance_after,
      balance = NEW.balance_after,
      total_withdrawn = COALESCE(total_withdrawn, 0) + v_amount,
      updated_at = NOW()
    WHERE driver_id = NEW.driver_id
      AND COALESCE(available_balance, available_for_withdrawal, balance, 0) = COALESCE(NEW.balance_before, 0);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_apply_driver_wallet_transaction_to_wallet ON public.driver_transactions;
CREATE TRIGGER trg_apply_driver_wallet_transaction_to_wallet
  AFTER INSERT ON public.driver_transactions
  FOR EACH ROW
  EXECUTE FUNCTION public.apply_driver_wallet_transaction_to_wallet();

-- Bridge driver wallet withdrawal/transfer transactions into admin payout requests.
CREATE OR REPLACE FUNCTION public.sync_driver_wallet_transaction_to_payout_request()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wallet_id UUID;
  v_amount DECIMAL(12,2);
  v_reference TEXT;
  v_status TEXT;
BEGIN
  IF COALESCE(NEW.transaction_type, '') NOT IN ('withdrawal', 'payout', 'transfer')
     OR COALESCE(NEW.amount, 0) >= 0 THEN
    RETURN NEW;
  END IF;

  v_amount := ABS(NEW.amount);
  v_reference := COALESCE(NEW.payout_reference, NEW.id::TEXT);

  SELECT id INTO v_wallet_id
  FROM public.driver_wallets
  WHERE driver_id = NEW.driver_id
  LIMIT 1;

  v_status := CASE COALESCE(NEW.status, 'pending')
    WHEN 'completed' THEN 'paid'
    WHEN 'paid' THEN 'paid'
    WHEN 'approved' THEN 'approved'
    WHEN 'processing' THEN 'processing'
    WHEN 'failed' THEN 'failed'
    WHEN 'rejected' THEN 'rejected'
    WHEN 'cancelled' THEN 'cancelled'
    ELSE 'pending'
  END;

  INSERT INTO public.driver_payout_requests (
    driver_id,
    wallet_id,
    amount,
    fee,
    net_amount,
    payout_method,
    account_number,
    account_name,
    status,
    transaction_reference,
    notes,
    created_at,
    updated_at
  )
  SELECT
    NEW.driver_id,
    v_wallet_id,
    v_amount,
    0,
    v_amount,
    NEW.payout_method,
    NULL,
    NULL,
    v_status,
    v_reference,
    COALESCE(NEW.description, 'Driver wallet withdrawal'),
    COALESCE(NEW.created_at, NOW()),
    NOW()
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.driver_payout_requests pr
    WHERE pr.transaction_reference = v_reference
  );

  UPDATE public.driver_payout_requests
  SET
    wallet_id = COALESCE(v_wallet_id, wallet_id),
    amount = v_amount,
    net_amount = v_amount,
    payout_method = COALESCE(NEW.payout_method, payout_method),
    status = v_status,
    notes = COALESCE(NEW.description, notes),
    updated_at = NOW()
  WHERE transaction_reference = v_reference;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_driver_wallet_transaction_to_payout_request ON public.driver_transactions;
CREATE TRIGGER trg_sync_driver_wallet_transaction_to_payout_request
  AFTER INSERT OR UPDATE OF status, payout_reference, payout_method, amount, description ON public.driver_transactions
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_driver_wallet_transaction_to_payout_request();

-- When admin approves/rejects/marks paid from the payout queue, reflect the
-- decision back to the driver's wallet transaction and compatibility payment row.
CREATE OR REPLACE FUNCTION public.sync_payout_request_status_to_driver_wallet()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_driver_tx_status TEXT;
  v_payment_status TEXT;
BEGIN
  IF NEW.transaction_reference IS NULL THEN
    RETURN NEW;
  END IF;

  v_driver_tx_status := CASE COALESCE(NEW.status, 'pending')
    WHEN 'paid' THEN 'completed'
    WHEN 'completed' THEN 'completed'
    WHEN 'failed' THEN 'failed'
    WHEN 'rejected' THEN 'rejected'
    WHEN 'cancelled' THEN 'cancelled'
    WHEN 'approved' THEN 'approved'
    WHEN 'processing' THEN 'processing'
    ELSE 'pending'
  END;

  v_payment_status := CASE COALESCE(NEW.status, 'pending')
    WHEN 'paid' THEN 'completed'
    WHEN 'completed' THEN 'completed'
    WHEN 'failed' THEN 'failed'
    WHEN 'rejected' THEN 'failed'
    WHEN 'cancelled' THEN 'cancelled'
    ELSE 'pending'
  END;

  UPDATE public.driver_transactions
  SET
    status = v_driver_tx_status,
    payout_method = COALESCE(NEW.payout_method, payout_method)
  WHERE payout_reference = NEW.transaction_reference
    AND status IS DISTINCT FROM v_driver_tx_status;

  UPDATE public.payments
  SET
    status = v_payment_status,
    payment_status = v_payment_status
  WHERE COALESCE(transaction_reference, reference) = NEW.transaction_reference
    AND COALESCE(user_type, '') = 'driver'
    AND COALESCE(type, '') IN ('payout', 'transfer')
    AND COALESCE(payment_status, status, '') IS DISTINCT FROM v_payment_status;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_payout_request_status_to_driver_wallet ON public.driver_payout_requests;
CREATE TRIGGER trg_sync_payout_request_status_to_driver_wallet
  AFTER INSERT OR UPDATE OF status, payout_method, transaction_reference ON public.driver_payout_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_payout_request_status_to_driver_wallet();

-- Allow the Firebase/anon driver app compatibility path to read payout requests
-- created by the trigger if the app later needs to show admin processing state.
DROP POLICY IF EXISTS anon_read_driver_payout_requests ON public.driver_payout_requests;
CREATE POLICY anon_read_driver_payout_requests
  ON public.driver_payout_requests
  FOR SELECT
  USING (true);

SELECT 'Driver wallet connected to admin payouts' AS result;