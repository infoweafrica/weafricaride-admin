-- Check if demand_events table exists before altering
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_tables 
    WHERE schemaname = 'public' 
    AND tablename = 'demand_events'
  ) THEN
    ALTER TABLE public.demand_events 
      ADD COLUMN IF NOT EXISTS max_drivers INTEGER,
      ADD COLUMN IF NOT EXISTS instructions TEXT,
      ADD COLUMN IF NOT EXISTS target_driver_ids UUID[] DEFAULT NULL;
  END IF;
END $$;

-- Only create demand_event_responses if drivers table exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_tables 
    WHERE schemaname = 'public' 
    AND tablename = 'drivers'
  ) AND EXISTS (
    SELECT 1 FROM pg_tables 
    WHERE schemaname = 'public' 
    AND tablename = 'demand_events'
  ) THEN
    CREATE TABLE IF NOT EXISTS public.demand_event_responses (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      event_id UUID NOT NULL REFERENCES public.demand_events(id) ON DELETE CASCADE,
      driver_id UUID NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'interested'
        CHECK (status IN ('interested', 'going', 'arrived', 'completed', 'dismissed')),
      notes TEXT,
      responded_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(event_id, driver_id)
    );
  END IF;
END $$;
