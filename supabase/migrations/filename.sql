CREATE TABLE public.demand_event_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.demand_events(id) ON DELETE CASCADE,
  driver_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'interested'
    CHECK (status IN ('interested', 'going', 'arrived', 'completed', 'dismissed')),
  notes TEXT,
  responded_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(event_id, driver_id)
);
