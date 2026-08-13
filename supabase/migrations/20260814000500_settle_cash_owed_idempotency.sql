-- settle_cash_owed() idempotency guard.
--
-- Every other money-moving RPC touched by this feature is naturally
-- idempotent because it's tied to a state that can only resolve once
-- (confirm_cash_payment/confirm_rider_credit check rides.payment_status/
-- credit_confirmation_status; generate_corporate_invoice only picks up
-- rides with corporate_invoice_id IS NULL). settle_cash_owed has no such
-- anchor — it's a driver manually saying "pay down this much of what I
-- owe right now" against their own running balance, so two calls with
-- identical arguments are not obviously "the same request retried" vs.
-- "two separate settlements." A lost network response after a successful
-- call, followed by the driver-app retrying, would deduct twice.
--
-- Fix: an optional client-supplied idempotency key, stored on the
-- driver_transactions row this function already writes (reusing
-- reference_id/reference_type rather than adding new columns) and
-- protected by a unique index. Confirmed safe against the concurrent-
-- retry race specifically because this function already locks the
-- driver_wallets row FOR UPDATE before checking — two near-simultaneous
-- calls for the same driver serialize on that lock, so the second one's
-- idempotency check reliably sees the first one's committed insert.

CREATE UNIQUE INDEX IF NOT EXISTS idx_driver_transactions_settlement_idempotency
  ON public.driver_transactions(reference_id)
  WHERE transaction_type = 'cash_settlement' AND reference_id IS NOT NULL;

-- Same ambiguous-overload landmine as book_rider_trip earlier in this
-- feature: adding a trailing param via CREATE OR REPLACE creates a
-- second overload instead of replacing the old 3-arg one. Drop it first.
DROP FUNCTION IF EXISTS public.settle_cash_owed(uuid, numeric, text);

CREATE OR REPLACE FUNCTION public.settle_cash_owed(
    p_driver_id uuid,
    p_amount numeric,
    p_method text DEFAULT 'wallet_balance',
    p_idempotency_key uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_wallet public.driver_wallets;
    v_existing public.driver_transactions;
BEGIN
    IF p_amount IS NULL OR p_amount <= 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Settlement amount must be greater than zero', 'code', 'INVALID_AMOUNT');
    END IF;

    SELECT * INTO v_wallet FROM public.driver_wallets WHERE driver_id = p_driver_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Driver wallet not found', 'code', 'WALLET_NOT_FOUND');
    END IF;

    -- Idempotent replay: same key as an already-processed settlement for
    -- this driver returns the original result rather than deducting again.
    IF p_idempotency_key IS NOT NULL THEN
        SELECT * INTO v_existing FROM public.driver_transactions
        WHERE reference_id = p_idempotency_key AND transaction_type = 'cash_settlement' AND driver_id = p_driver_id;
        IF FOUND THEN
            RETURN jsonb_build_object(
                'success', true,
                'already_settled', true,
                'amount_settled', ABS(v_existing.amount),
                'commission_owed_after', COALESCE(v_wallet.commission_owed, 0),
                'available_balance_after', COALESCE(v_wallet.available_balance, 0)
            );
        END IF;
    END IF;

    IF p_amount > COALESCE(v_wallet.commission_owed, 0) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Amount exceeds outstanding commission owed', 'code', 'AMOUNT_EXCEEDS_OWED');
    END IF;
    IF p_amount > COALESCE(v_wallet.available_balance, 0) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Insufficient wallet balance', 'code', 'INSUFFICIENT_BALANCE');
    END IF;

    UPDATE public.driver_wallets
    SET available_balance = available_balance - p_amount,
        available_for_withdrawal = available_for_withdrawal - p_amount,
        commission_owed = commission_owed - p_amount,
        updated_at = now()
    WHERE driver_id = p_driver_id;

    INSERT INTO public.driver_transactions(
        driver_id, transaction_type, amount, balance_before, balance_after,
        reference_type, reference_id, description, payout_method, status
    ) VALUES (
        p_driver_id, 'cash_settlement', -p_amount,
        v_wallet.available_balance, v_wallet.available_balance - p_amount,
        'settlement_request', p_idempotency_key, 'Manual cash settlement via ' || COALESCE(p_method, 'wallet_balance'),
        p_method, 'completed'
    );

    RETURN jsonb_build_object(
        'success', true,
        'amount_settled', p_amount,
        'commission_owed_after', COALESCE(v_wallet.commission_owed, 0) - p_amount,
        'available_balance_after', COALESCE(v_wallet.available_balance, 0) - p_amount
    );
END;
$$;
