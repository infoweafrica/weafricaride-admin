-- ============================================
-- WeAfrica Ride — Rider Cancellation RPC
-- ============================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'rides') THEN
    ALTER TABLE public.rides
      ADD COLUMN IF NOT EXISTS cancellation_reason TEXT,
      ADD COLUMN IF NOT EXISTS cancellation_note TEXT,
      ADD COLUMN IF NOT EXISTS cancelled_by TEXT,
      ADD COLUMN IF NOT EXISTS cancellation_fee NUMERIC(12,2) DEFAULT 0,
      ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
  END IF;
END $$;
