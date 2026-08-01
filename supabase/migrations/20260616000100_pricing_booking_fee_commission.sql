-- ============================================
-- Pricing: Booking Fee + Commission Fields
-- ============================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'rides') THEN
    ALTER TABLE rides ADD COLUMN IF NOT EXISTS booking_fee DECIMAL(10,2) DEFAULT 0;
    ALTER TABLE rides ADD COLUMN IF NOT EXISTS commission_amount DECIMAL(10,2) DEFAULT 0;
    ALTER TABLE rides ADD COLUMN IF NOT EXISTS driver_earnings DECIMAL(10,2) DEFAULT 0;
    ALTER TABLE rides ADD COLUMN IF NOT EXISTS tax_amount DECIMAL(10,2) DEFAULT 0;
  END IF;
END $$;
