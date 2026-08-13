-- Driver Settlement — Module 2. confirm_cash_payment() already
-- auto-settles as much of a driver's commission_owed as their
-- available_balance covers, immediately, at cash-confirm time. This adds
-- the manual path for whatever's left over (or for a driver who wants to
-- pay down commission_owed from balance they've since earned) — mirrors
-- the existing driver_request_withdrawal() shape exactly, just moving
-- money the other direction (driver -> platform instead of platform ->
-- driver).

CREATE OR REPLACE FUNCTION public.settle_cash_owed(
    p_driver_id uuid,
    p_amount numeric,
    p_method text DEFAULT 'wallet_balance'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_wallet public.driver_wallets;
BEGIN
    IF p_amount IS NULL OR p_amount <= 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Settlement amount must be greater than zero', 'code', 'INVALID_AMOUNT');
    END IF;

    SELECT * INTO v_wallet FROM public.driver_wallets WHERE driver_id = p_driver_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Driver wallet not found', 'code', 'WALLET_NOT_FOUND');
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
        reference_type, description, payout_method, status
    ) VALUES (
        p_driver_id, 'cash_settlement', -p_amount,
        v_wallet.available_balance, v_wallet.available_balance - p_amount,
        'settlement', 'Manual cash settlement via ' || COALESCE(p_method, 'wallet_balance'),
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

ALTER FUNCTION public.settle_cash_owed(uuid, numeric, text) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.settle_cash_owed(uuid, numeric, text) TO anon;
GRANT EXECUTE ON FUNCTION public.settle_cash_owed(uuid, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.settle_cash_owed(uuid, numeric, text) TO service_role;

-- Driver Cash Balance Limit — Module 3, warning-only (no dispatch/
-- matching changes). Admin-configurable via app_settings, same table
-- rider_support_screen.dart already reads live for support contact info.
INSERT INTO public.app_settings (setting_key, setting_value, section, group_name, label, value_type, is_public)
VALUES
    ('cash_balance_warning_threshold', '40000'::jsonb, 'payments', 'cash', 'Cash balance warning threshold (MWK)', 'number', true),
    ('cash_balance_limit', '50000'::jsonb, 'payments', 'cash', 'Cash balance limit (MWK)', 'number', true)
ON CONFLICT (setting_key) DO NOTHING;
