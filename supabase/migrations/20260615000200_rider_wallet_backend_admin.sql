-- ============================================
-- WeAfrica Ride — Rider Wallet Backend/Admin Connectivity
-- ============================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'wallet_transactions') THEN
    ALTER TABLE public.wallet_transactions
      ADD COLUMN IF NOT EXISTS payment_method TEXT,
      ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'completed',
      ADD COLUMN IF NOT EXISTS transaction_reference TEXT;
  END IF;
END $$;
