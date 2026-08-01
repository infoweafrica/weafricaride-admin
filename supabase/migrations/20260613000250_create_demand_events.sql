-- ====================================
-- Create Demand Events Table
-- This was originally created on remote Supabase but never captured locally.
-- The 202606120* placeholders are empty stubs, so we create the table here
-- before 20260613000300 references it.
-- ====================================

CREATE TABLE IF NOT EXISTS public.demand_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  event_type TEXT NOT NULL DEFAULT 'ride_demand',
  city TEXT,
  zone_name TEXT,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  base_fare_multiplier NUMERIC DEFAULT 1.0,
  driver_earnings_multiplier NUMERIC DEFAULT 1.0,
  max_drivers INTEGER,
  instructions TEXT,
  target_driver_ids UUID[] DEFAULT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_demand_events_status ON public.demand_events(status);
CREATE INDEX IF NOT EXISTS idx_demand_events_city ON public.demand_events(city);

ALTER TABLE public.demand_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS anon_read_demand_events ON public.demand_events;
CREATE POLICY anon_read_demand_events
  ON public.demand_events
  FOR SELECT
  USING (true);

DROP POLICY IF EXISTS admin_all_demand_events ON public.demand_events;
CREATE POLICY admin_all_demand_events
  ON public.demand_events
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.admin_users
      WHERE admin_users.auth_user_id = auth.uid()
        AND admin_users.is_active = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.admin_users
      WHERE admin_users.auth_user_id = auth.uid()
        AND admin_users.is_active = true
    )
  );
