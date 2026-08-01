-- ============================================
-- Service Zones & Boundaries Admin
-- ============================================

-- Enable pgcrypto if not already enabled
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'service_zones') THEN
    CREATE TABLE IF NOT EXISTS public.airport_zone_queue (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      zone_id UUID NOT NULL REFERENCES public.service_zones(id) ON DELETE CASCADE,
      driver_id UUID,
      status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'called', 'assigned', 'left', 'expired')),
      queue_position INTEGER,
      entered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      called_at TIMESTAMPTZ,
      assigned_ride_id UUID,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      UNIQUE(zone_id, driver_id, status) DEFERRABLE INITIALLY IMMEDIATE
    );
  ELSE
    -- Create without foreign key if service_zones doesn't exist
    CREATE TABLE IF NOT EXISTS public.airport_zone_queue (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      zone_id UUID,
      driver_id UUID,
      status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'called', 'assigned', 'left', 'expired')),
      queue_position INTEGER,
      entered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      called_at TIMESTAMPTZ,
      assigned_ride_id UUID,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      UNIQUE(zone_id, driver_id, status) DEFERRABLE INITIALLY IMMEDIATE
    );
  END IF;
END $$;
