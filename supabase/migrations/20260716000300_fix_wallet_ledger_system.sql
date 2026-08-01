-- Corrects 20260625000200_wallet_ledger.sql, which was never actually
-- applied to the live database (confirmed 2026-07-16: the `transactions`
-- table it ALTERs did not exist at all, so every statement past line 1
-- would have failed). This migration creates that table from scratch and
-- fixes three further bugs found while doing so:
--
-- 1. create_wallet_for_new_user() inserted into a `pending_balance` column
--    that does not exist on `wallets` (it has ride_credits/promo_balance/
--    refund_balance instead) — would have broken every user signup.
-- 2. settle_trip_payment() looked up wallets via
--    `wallets.user_id = rides.rider_id` / `rides.driver_id`, but
--    rides.rider_id/driver_id are riders.id/drivers.id, not users.id —
--    the lookup could never match a real wallet.
-- 3. settle_trip_payment() read `rides.total_fare` and wrote
--    `rides.driver_payout`/`rides.platform_fee`, none of which exist on
--    `rides` (it has final_fare/rider_total_amount/commission_amount/
--    driver_net_earning instead).
--
-- Also deliberately does NOT expose credit_wallet/debit_wallet to
-- anon/authenticated: they accept a raw wallet_id + amount with no
-- verification that real money changed hands, and this project has no
-- payment-webhook route calling them server-side (the PayChangu client in
-- src/lib/api/paychangu.ts is unused scaffolding) — leaving them open
-- would let anyone credit/debit any wallet by arbitrary amounts.
-- settle_trip_payment remains anon-callable since it only moves money for
-- a trip already marked 'completed', which is a real constraint.

CREATE TABLE IF NOT EXISTS public.transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wallet_id UUID NOT NULL REFERENCES public.wallets(id) ON DELETE CASCADE,
    trip_id UUID REFERENCES public.rides(id) ON DELETE SET NULL,
    type VARCHAR(20) NOT NULL,
    amount NUMERIC(10,2) NOT NULL,
    balance_after NUMERIC(10,2) NOT NULL,
    description TEXT,
    reference VARCHAR(100),
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    ledger_entry_type VARCHAR(20) DEFAULT 'regular',
    reversed_by UUID REFERENCES public.transactions(id),
    idempotency_key VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_transactions_wallet_id ON public.transactions(wallet_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_idempotency
    ON public.transactions(idempotency_key) WHERE idempotency_key IS NOT NULL;

ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

-- Read-only for clients, matching the pattern used for wallets/wallet_transactions
-- (see 20260716000200_tighten_anon_financial_rls.sql) — all writes go through
-- the SECURITY DEFINER functions below.
DROP POLICY IF EXISTS "anon_read_transactions" ON public.transactions;
CREATE POLICY "anon_read_transactions" ON public.transactions
  FOR SELECT TO anon, authenticated USING (true);
-- Explicit table-level grant — this project's default-privilege rule that
-- would normally cover this isn't reliably present on every environment
-- (seen to differ between the two projects migrated 2026-07-16), so don't
-- depend on it for a table clients need to read.
GRANT SELECT ON public.transactions TO anon, authenticated;

-- ============================================================
-- SAFE CREDIT FUNCTION — guarantees no double-credit
-- ============================================================
CREATE OR REPLACE FUNCTION credit_wallet(
    p_wallet_id UUID,
    p_amount DECIMAL(10,2),
    p_type VARCHAR(20),           -- 'credit', 'refund', 'bonus'
    p_description TEXT DEFAULT NULL,
    p_reference VARCHAR(100) DEFAULT NULL,
    p_idempotency_key VARCHAR(100) DEFAULT NULL,
    p_trip_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_current_balance DECIMAL(10,2);
    v_new_balance DECIMAL(10,2);
    v_txn_id UUID;
BEGIN
    IF p_idempotency_key IS NOT NULL THEN
        SELECT id INTO v_txn_id FROM transactions WHERE idempotency_key = p_idempotency_key;
        IF FOUND THEN
            RETURN jsonb_build_object('success', true, 'message', 'Already processed (idempotent)',
                'transaction_id', v_txn_id, 'code', 'IDEMPOTENT');
        END IF;
    END IF;

    SELECT balance INTO v_current_balance FROM wallets WHERE id = p_wallet_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Wallet not found', 'code', 'WALLET_NOT_FOUND');
    END IF;

    v_new_balance := v_current_balance + p_amount;

    UPDATE wallets SET balance = v_new_balance, updated_at = NOW() WHERE id = p_wallet_id;

    INSERT INTO transactions (
        wallet_id, trip_id, type, amount, balance_after,
        description, reference, status, idempotency_key,
        ledger_entry_type, completed_at
    ) VALUES (
        p_wallet_id, p_trip_id, p_type, p_amount, v_new_balance,
        p_description, p_reference, 'completed', p_idempotency_key,
        'regular', NOW()
    )
    RETURNING id INTO v_txn_id;

    RETURN jsonb_build_object('success', true, 'transaction_id', v_txn_id,
        'previous_balance', v_current_balance, 'new_balance', v_new_balance, 'amount', p_amount);
END;
$$;

-- ============================================================
-- SAFE DEBIT FUNCTION — prevents overdraft
-- ============================================================
CREATE OR REPLACE FUNCTION debit_wallet(
    p_wallet_id UUID,
    p_amount DECIMAL(10,2),
    p_type VARCHAR(20),           -- 'debit', 'commission', 'withdrawal'
    p_description TEXT DEFAULT NULL,
    p_reference VARCHAR(100) DEFAULT NULL,
    p_idempotency_key VARCHAR(100) DEFAULT NULL,
    p_trip_id UUID DEFAULT NULL,
    p_allow_overdraft BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_current_balance DECIMAL(10,2);
    v_new_balance DECIMAL(10,2);
    v_txn_id UUID;
BEGIN
    IF p_idempotency_key IS NOT NULL THEN
        SELECT id INTO v_txn_id FROM transactions WHERE idempotency_key = p_idempotency_key;
        IF FOUND THEN
            RETURN jsonb_build_object('success', true, 'message', 'Already processed (idempotent)',
                'transaction_id', v_txn_id, 'code', 'IDEMPOTENT');
        END IF;
    END IF;

    SELECT balance INTO v_current_balance FROM wallets WHERE id = p_wallet_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Wallet not found', 'code', 'WALLET_NOT_FOUND');
    END IF;

    IF v_current_balance < p_amount AND NOT p_allow_overdraft THEN
        RETURN jsonb_build_object('success', false, 'error', 'Insufficient balance', 'code', 'INSUFFICIENT_FUNDS',
            'current_balance', v_current_balance, 'requested_amount', p_amount);
    END IF;

    v_new_balance := v_current_balance - p_amount;

    UPDATE wallets SET balance = v_new_balance, updated_at = NOW() WHERE id = p_wallet_id;

    INSERT INTO transactions (
        wallet_id, trip_id, type, amount, balance_after,
        description, reference, status, idempotency_key,
        ledger_entry_type, completed_at
    ) VALUES (
        p_wallet_id, p_trip_id, p_type, -p_amount, v_new_balance,
        p_description, p_reference, 'completed', p_idempotency_key,
        'regular', NOW()
    )
    RETURNING id INTO v_txn_id;

    RETURN jsonb_build_object('success', true, 'transaction_id', v_txn_id,
        'previous_balance', v_current_balance, 'new_balance', v_new_balance, 'amount', p_amount);
END;
$$;

-- Restrict raw credit/debit to service_role — see header comment. Trip
-- settlement below (which validates a completed trip first) remains the
-- safe anon-callable path for moving money.
REVOKE ALL ON FUNCTION credit_wallet(UUID, DECIMAL, VARCHAR, TEXT, VARCHAR, VARCHAR, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION debit_wallet(UUID, DECIMAL, VARCHAR, TEXT, VARCHAR, VARCHAR, UUID, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION credit_wallet(UUID, DECIMAL, VARCHAR, TEXT, VARCHAR, VARCHAR, UUID) TO service_role;
GRANT ALL ON FUNCTION debit_wallet(UUID, DECIMAL, VARCHAR, TEXT, VARCHAR, VARCHAR, UUID, BOOLEAN) TO service_role;

-- ============================================================
-- REVERSE TRANSACTION — creates offsetting entry, never deletes
-- ============================================================
CREATE OR REPLACE FUNCTION reverse_transaction(
    p_original_txn_id UUID,
    p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_original transactions%ROWTYPE;
    v_reversal_id UUID;
BEGIN
    SELECT * INTO v_original FROM transactions WHERE id = p_original_txn_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Transaction not found', 'code', 'TXN_NOT_FOUND');
    END IF;

    IF v_original.reversed_by IS NOT NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Already reversed', 'code', 'ALREADY_REVERSED');
    END IF;

    UPDATE transactions SET reversed_by = p_original_txn_id WHERE id = p_original_txn_id;

    INSERT INTO transactions (
        wallet_id, trip_id, type, amount, balance_after,
        description, reference, status, idempotency_key,
        ledger_entry_type, reversed_by, completed_at
    ) VALUES (
        v_original.wallet_id, v_original.trip_id,
        CASE WHEN v_original.amount > 0 THEN 'refund' ELSE 'credit' END,
        -v_original.amount,
        (SELECT balance FROM wallets WHERE id = v_original.wallet_id) - v_original.amount,
        COALESCE(p_reason, 'Reversal of ' || v_original.id::text),
        v_original.reference,
        'completed',
        'rev_' || v_original.id::text,
        'reversal',
        p_original_txn_id,
        NOW()
    )
    RETURNING id INTO v_reversal_id;

    UPDATE wallets SET balance = balance - v_original.amount, updated_at = NOW()
    WHERE id = v_original.wallet_id;

    RETURN jsonb_build_object('success', true, 'reversal_id', v_reversal_id,
        'original_txn_id', p_original_txn_id, 'message', 'Transaction reversed');
END;
$$;

REVOKE ALL ON FUNCTION reverse_transaction(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION reverse_transaction(UUID, TEXT) TO service_role;

-- ============================================================
-- TRIP SETTLEMENT — atomic fare distribution (corrected)
-- ============================================================
CREATE OR REPLACE FUNCTION settle_trip_payment(
    p_trip_id UUID,
    p_payment_method VARCHAR(20) DEFAULT 'wallet' -- 'wallet', 'cash', 'airtel', 'mpamba', 'mpesa'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_trip rides%ROWTYPE;
    v_total_fare DECIMAL(10,2);
    v_rider_wallet_id UUID;
    v_driver_wallet_id UUID;
    v_platform_fee DECIMAL(10,2);
    v_driver_payout DECIMAL(10,2);
BEGIN
    SELECT * INTO v_trip FROM rides WHERE id = p_trip_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Trip not found', 'code', 'TRIP_NOT_FOUND');
    END IF;

    IF v_trip.status != 'completed' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Trip not completed', 'code', 'TRIP_NOT_COMPLETED');
    END IF;

    v_total_fare := COALESCE(v_trip.final_fare, v_trip.rider_total_amount, v_trip.actual_fare, v_trip.fare, 0);
    v_platform_fee := ROUND(v_total_fare * (COALESCE(v_trip.commission_rate, 15) / 100), 2);
    v_driver_payout := v_total_fare - v_platform_fee;

    -- rides.rider_id/driver_id are riders.id/drivers.id — join through to
    -- the underlying users.id that wallets.user_id actually references.
    SELECT w.id INTO v_rider_wallet_id
    FROM wallets w JOIN riders r ON r.user_id = w.user_id
    WHERE r.id = v_trip.rider_id;
    IF NOT FOUND AND p_payment_method != 'cash' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Rider wallet not found', 'code', 'NO_RIDER_WALLET');
    END IF;

    SELECT w.id INTO v_driver_wallet_id
    FROM wallets w JOIN drivers d ON d.user_id = w.user_id
    WHERE d.id = v_trip.driver_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Driver wallet not found', 'code', 'NO_DRIVER_WALLET');
    END IF;

    IF p_payment_method != 'cash' AND v_rider_wallet_id IS NOT NULL THEN
        PERFORM debit_wallet(
            v_rider_wallet_id, v_total_fare, 'debit',
            'Trip fare: ' || p_trip_id::text, 'trip_' || p_trip_id::text,
            'settle_rider_' || p_trip_id::text, p_trip_id
        );
    END IF;

    PERFORM credit_wallet(
        v_driver_wallet_id, v_driver_payout, 'credit',
        'Trip earnings: ' || p_trip_id::text, 'trip_' || p_trip_id::text,
        'settle_driver_' || p_trip_id::text, p_trip_id
    );

    UPDATE rides
    SET payment_status = 'paid',
        driver_net_earning = v_driver_payout,
        commission_amount = v_platform_fee
    WHERE id = p_trip_id;

    RETURN jsonb_build_object('success', true, 'total_fare', v_total_fare,
        'platform_fee', v_platform_fee, 'driver_payout', v_driver_payout,
        'payment_method', p_payment_method, 'message', 'Trip settled');
END;
$$;

-- The safe anon-callable path: only moves money for a trip already
-- marked 'completed', unlike raw credit_wallet/debit_wallet above.
GRANT ALL ON FUNCTION settle_trip_payment(UUID, VARCHAR) TO anon, authenticated, service_role;

-- ============================================================
-- TRIGGER: auto-create wallet on user creation (corrected — no
-- pending_balance column on wallets)
-- ============================================================
CREATE OR REPLACE FUNCTION create_wallet_for_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    INSERT INTO wallets (user_id, balance)
    VALUES (NEW.id, 0)
    ON CONFLICT (user_id) DO NOTHING;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_create_wallet ON users;
CREATE TRIGGER trg_create_wallet
    AFTER INSERT ON users
    FOR EACH ROW
    EXECUTE FUNCTION create_wallet_for_new_user();
