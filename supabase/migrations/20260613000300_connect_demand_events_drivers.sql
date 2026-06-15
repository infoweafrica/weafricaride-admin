-- ====================================
-- Connect Demand Events to Driver App
-- Admin creates events; drivers can respond from Discover.
-- ====================================

ALTER TABLE public.demand_events
  ADD COLUMN IF NOT EXISTS max_drivers INTEGER,
  ADD COLUMN IF NOT EXISTS instructions TEXT,
  ADD COLUMN IF NOT EXISTS target_driver_ids UUID[] DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_demand_events_time_window
  ON public.demand_events(starts_at, ends_at);

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

CREATE INDEX IF NOT EXISTS idx_demand_event_responses_event
  ON public.demand_event_responses(event_id);
CREATE INDEX IF NOT EXISTS idx_demand_event_responses_driver
  ON public.demand_event_responses(driver_id);
CREATE INDEX IF NOT EXISTS idx_demand_event_responses_status
  ON public.demand_event_responses(status);

ALTER TABLE public.demand_event_responses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admin_all_demand_event_responses ON public.demand_event_responses;
CREATE POLICY admin_all_demand_event_responses
  ON public.demand_event_responses
  FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM public.admin_users
      WHERE admin_users.user_id = auth.uid()
        AND admin_users.is_active = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.admin_users
      WHERE admin_users.user_id = auth.uid()
        AND admin_users.is_active = true
    )
  );

DROP POLICY IF EXISTS anon_read_demand_event_responses ON public.demand_event_responses;
CREATE POLICY anon_read_demand_event_responses
  ON public.demand_event_responses
  FOR SELECT
  USING (true);

DROP POLICY IF EXISTS anon_insert_demand_event_responses ON public.demand_event_responses;
CREATE POLICY anon_insert_demand_event_responses
  ON public.demand_event_responses
  FOR INSERT
  WITH CHECK (true);

DROP POLICY IF EXISTS anon_update_demand_event_responses ON public.demand_event_responses;
CREATE POLICY anon_update_demand_event_responses
  ON public.demand_event_responses
  FOR UPDATE
  USING (true)
  WITH CHECK (true);
