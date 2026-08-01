-- ============================================
-- Shared connection missing-only migration
-- ============================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'drivers') THEN
    CREATE TABLE IF NOT EXISTS public.driver_locations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      driver_id UUID NOT NULL UNIQUE REFERENCES public.drivers(id) ON DELETE CASCADE,
      latitude DOUBLE PRECISION,
      longitude DOUBLE PRECISION,
      heading DOUBLE PRECISION DEFAULT 0,
      speed DOUBLE PRECISION DEFAULT 0,
      accuracy DOUBLE PRECISION,
      is_online BOOLEAN DEFAULT false,
      updated_at TIMESTAMPTZ DEFAULT now(),
      created_at TIMESTAMPTZ DEFAULT now()
    );
  ELSE
    -- Create without foreign key if drivers doesn't exist
    CREATE TABLE IF NOT EXISTS public.driver_locations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      driver_id UUID NOT NULL UNIQUE,
      latitude DOUBLE PRECISION,
      longitude DOUBLE PRECISION,
      heading DOUBLE PRECISION DEFAULT 0,
      speed DOUBLE PRECISION DEFAULT 0,
      accuracy DOUBLE PRECISION,
      is_online BOOLEAN DEFAULT false,
      updated_at TIMESTAMPTZ DEFAULT now(),
      created_at TIMESTAMPTZ DEFAULT now()
    );
  END IF;
END $$;

-- Add indexes if table exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'driver_locations') THEN
    CREATE INDEX IF NOT EXISTS idx_driver_locations_driver_id ON public.driver_locations(driver_id);
    CREATE INDEX IF NOT EXISTS idx_driver_locations_updated_at ON public.driver_locations(updated_at);
    CREATE INDEX IF NOT EXISTS idx_driver_locations_is_online ON public.driver_locations(is_online);
  END IF;
END $$;
