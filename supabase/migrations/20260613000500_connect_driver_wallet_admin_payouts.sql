-- ============================================
-- Connect Driver Wallet to Admin Payouts
-- ============================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'driver_wallets') THEN
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
  END IF;
END $$;
