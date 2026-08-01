-- ============================================
-- Connect Rider App Bookings to Driver + Admin Flow
-- ============================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'ride_requests') THEN
    ALTER TABLE public.ride_requests
      ADD COLUMN IF NOT EXISTS pickup_address TEXT,
      ADD COLUMN IF NOT EXISTS pickup_lat DOUBLE PRECISION,
      ADD COLUMN IF NOT EXISTS pickup_lng DOUBLE PRECISION,
      ADD COLUMN IF NOT EXISTS destination_address TEXT,
      ADD COLUMN IF NOT EXISTS destination_lat DOUBLE PRECISION,
      ADD COLUMN IF NOT EXISTS destination_lng DOUBLE PRECISION,
      ADD COLUMN IF NOT EXISTS vehicle_class TEXT,
      ADD COLUMN IF NOT EXISTS estimated_fare NUMERIC(12,2),
      ADD COLUMN IF NOT EXISTS payment_method TEXT;
  END IF;
END $$;
