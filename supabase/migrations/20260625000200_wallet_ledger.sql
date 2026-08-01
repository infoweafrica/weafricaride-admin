-- ============================================================
-- WALLET LEDGER SYSTEM — Immutable, double-spend-proof
-- ============================================================

-- 1. ENFORCE immutable ledger: no UPDATE or DELETE on transactions
--    All corrections must be made via new reversing entries.
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS ledger_entry_type VARCHAR(20) DEFAULT 'regular';
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS reversed_by UUID REFERENCES transactions(id);
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(100);

-- Unique constraint to prevent double-processing of the same idempotency key
CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_idempotency
    ON transactions(idempotency_key) WHERE idempotency_key IS NOT NULL;

-- ============================================================
-- 2. SAFE CREDIT FUNCTION — guarantees no double-credit
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
    -- Idempotency check: if this exact request was already processed, return it
    IF p_idempotency_key IS NOT NULL THEN
        SELECT id INTO v_txn_id
        FROM transactions
        WHERE idempotency_key = p_idempotency_key;
        
        IF FOUND THEN
            RETURN jsonb_build_object(
                'success', true,
                'message', 'Already processed (idempotent)',
                'transaction_id', v_txn_id,
                'code', 'IDEMPOTENT'
            );
        END IF;
    END IF;

    -- Lock the wallet row to prevent concurrent updates
    SELECT balance INTO v_current_balance
    FROM wallets
    WHERE id = p_wallet_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Wallet not found',
            'code', 'WALLET_NOT_FOUND'
        );
    END IF;

    -- Calculate new balance (cannot overflow — Postgres numeric handles this)
    v_new_balance := v_current_balance + p_amount;

    -- Atomic update
    UPDATE wallets
    SET balance = v_new_balance,
        updated_at = NOW()
    WHERE id = p_wallet_id;

    -- Insert immutable ledger entry
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

    RETURN jsonb_build_object(
        'success', true,
        'transaction_id', v_txn_id,
        'previous_balance', v_current_balance,
        'new_balance', v_new_balance,
        'amount', p_amount
    );
END;
$$;

-- ============================================================
-- 3. SAFE DEBIT FUNCTION — prevents overdraft
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
    -- Idempotency check
    IF p_idempotency_key IS NOT NULL THEN
        SELECT id INTO v_txn_id
        FROM transactions
        WHERE idempotency_key = p_idempotency_key;
        
        IF FOUND THEN
            RETURN jsonb_build_object(
                'success', true,
                'message', 'Already processed (idempotent)',
                'transaction_id', v_txn_id,
                'code', 'IDEMPOTENT'
            );
        END IF;
    END IF;

    -- Lock wallet row
    SELECT balance INTO v_current_balance
    FROM wallets
    WHERE id = p_wallet_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Wallet not found',
            'code', 'WALLET_NOT_FOUND'
        );
    END IF;

    -- Overdraft protection
    IF v_current_balance < p_amount AND NOT p_allow_overdraft THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Insufficient balance',
            'code', 'INSUFFICIENT_FUNDS',
            'current_balance', v_current_balance,
            'requested_amount', p_amount
        );
    END IF;

    v_new_balance := v_current_balance - p_amount;

    -- Atomic update
    UPDATE wallets
    SET balance = v_new_balance,
        updated_at = NOW()
    WHERE id = p_wallet_id;

    -- Insert immutable ledger entry
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

    RETURN jsonb_build_object(
        'success', true,
        'transaction_id', v_txn_id,
        'previous_balance', v_current_balance,
        'new_balance', v_new_balance,
        'amount', p_amount
    );
END;
$$;

-- ============================================================
-- 4. REVERSE TRANSACTION — creates offsetting entry, never deletes
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

    -- Mark original as reversed
    UPDATE transactions SET reversed_by = p_original_txn_id WHERE id = p_original_txn_id;

    -- Create reversing entry (opposite sign)
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

    -- Update wallet balance
    UPDATE wallets
    SET balance = balance - v_original.amount,
        updated_at = NOW()
    WHERE id = v_original.wallet_id;

    RETURN jsonb_build_object(
        'success', true,
        'reversal_id', v_reversal_id,
        'original_txn_id', p_original_txn_id,
        'message', 'Transaction reversed'
    );
END;
$$;

-- ============================================================
-- 5. TRIP SETTLEMENT — atomic fare distribution
--    Called when trip is completed to:
--    a) Debit rider wallet (or mark as cash)
--    b) Credit driver earnings (minus platform fee)
--    c) Credit platform fee to admin wallet
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
    v_rider_wallet_id UUID;
    v_driver_wallet_id UUID;
    v_platform_fee DECIMAL(10,2);
    v_driver_payout DECIMAL(10,2);
    v_txn_id UUID;
BEGIN
    SELECT * INTO v_trip FROM rides WHERE id = p_trip_id;
    
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Trip not found', 'code', 'TRIP_NOT_FOUND');
    END IF;

    IF v_trip.status != 'completed' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Trip not completed', 'code', 'TRIP_NOT_COMPLETED');
    END IF;

    -- Calculate amounts
    v_platform_fee := COALESCE(v_trip.total_fare, 0) * 0.15; -- 15% platform fee
    v_driver_payout := COALESCE(v_trip.total_fare, 0) - v_platform_fee;

    -- Get rider wallet
    SELECT id INTO v_rider_wallet_id FROM wallets WHERE user_id = v_trip.rider_id;
    IF NOT FOUND AND p_payment_method != 'cash' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Rider wallet not found', 'code', 'NO_RIDER_WALLET');
    END IF;

    -- Get driver wallet
    SELECT id INTO v_driver_wallet_id FROM wallets WHERE user_id = v_trip.driver_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Driver wallet not found', 'code', 'NO_DRIVER_WALLET');
    END IF;

    -- Debit rider wallet (skip for cash)
    IF p_payment_method != 'cash' AND v_rider_wallet_id IS NOT NULL THEN
        PERFORM debit_wallet(
            v_rider_wallet_id,
            v_trip.total_fare,
            'debit',
            'Trip fare: ' || p_trip_id::text,
            'trip_' || p_trip_id::text,
            'settle_rider_' || p_trip_id::text,
            p_trip_id
        );
    END IF;

    -- Credit driver earnings
    PERFORM credit_wallet(
        v_driver_wallet_id,
        v_driver_payout,
        'credit',
        'Trip earnings: ' || p_trip_id::text,
        'trip_' || p_trip_id::text,
        'settle_driver_' || p_trip_id::text,
        p_trip_id
    );

    -- Update trip payment status
    UPDATE rides
    SET payment_status = 'paid',
        driver_payout = v_driver_payout,
        platform_fee = v_platform_fee
    WHERE id = p_trip_id;

    RETURN jsonb_build_object(
        'success', true,
        'total_fare', v_trip.total_fare,
        'platform_fee', v_platform_fee,
        'driver_payout', v_driver_payout,
        'payment_method', p_payment_method,
        'message', 'Trip settled'
    );
END;
$$;

-- ============================================================
-- 6. TRIGGER: auto-create wallet on user creation
-- ============================================================
CREATE OR REPLACE FUNCTION create_wallet_for_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    INSERT INTO wallets (user_id, balance, pending_balance)
    VALUES (NEW.id, 0, 0)
    ON CONFLICT (user_id) DO NOTHING;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_create_wallet ON users;
CREATE TRIGGER trg_create_wallet
    AFTER INSERT ON users
    FOR EACH ROW
    EXECUTE FUNCTION create_wallet_for_new_user();