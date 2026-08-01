-- ============================================
-- Rider App Booking RPC for Firebase/Anon Clients
-- ============================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'rides') THEN
    ALTER TABLE public.rides
      ADD COLUMN IF NOT EXISTS pickup_address TEXT,
      ADD COLUMN IF NOT EXISTS pickup_lat DOUBLE PRECISION,
      ADD COLUMN IF NOT EXISTS pickup_lng DOUBLE PRECISION,
      ADD COLUMN IF NOT EXISTS dropoff_address TEXT,
      ADD COLUMN IF NOT EXISTS dropoff_lat DOUBLE PRECISION,
      ADD COLUMN IF NOT EXISTS dropoff_lng DOUBLE PRECISION,
      ADD COLUMN IF NOT EXISTS destination_address TEXT,
      ADD COLUMN IF NOT EXISTS destination_lat DOUBLE PRECISION,
      ADD COLUMN IF NOT EXISTS destination_lng DOUBLE PRECISION,
      ADD COLUMN IF NOT EXISTS vehicle_class TEXT DEFAULT 'weafrica_x',
      ADD COLUMN IF NOT EXISTS estimated_fare NUMERIC(12,2) DEFAULT 0,
      ADD COLUMN IF NOT EXISTS fare NUMERIC(12,2) DEFAULT 0,
      ADD COLUMN IF NOT EXISTS estimated_distance_km NUMERIC(10,2),
      ADD COLUMN IF NOT EXISTS distance_km NUMERIC(10,2),
      ADD COLUMN IF NOT EXISTS estimated_duration_minutes INTEGER,
      ADD COLUMN IF NOT EXISTS duration_min INTEGER,
      ADD COLUMN IF NOT EXISTS payment_method TEXT DEFAULT 'cash',
      ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'pending',
      ADD COLUMN IF NOT EXISTS promo_code TEXT,
      ADD COLUMN IF NOT EXISTS requested_at TIMESTAMPTZ DEFAULT now(),
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now(),
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
  END IF;
END $$;
