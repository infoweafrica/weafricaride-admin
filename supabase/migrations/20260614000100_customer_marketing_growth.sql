-- ============================================
-- Customer Marketing Growth
-- ============================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'users') THEN
    CREATE TABLE IF NOT EXISTS public.marketing_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
      event_type TEXT NOT NULL,
      entity_type TEXT,
      entity_id UUID,
      metadata JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  ELSE
    -- If users doesn't exist, create without foreign key
    CREATE TABLE IF NOT EXISTS public.marketing_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID,
      event_type TEXT NOT NULL,
      entity_type TEXT,
      entity_id UUID,
      metadata JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  END IF;
END $$;

-- Add indexes if table exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'marketing_events') THEN
    CREATE INDEX IF NOT EXISTS idx_marketing_events_user_id ON public.marketing_events(user_id);
    CREATE INDEX IF NOT EXISTS idx_marketing_events_event_type ON public.marketing_events(event_type);
    CREATE INDEX IF NOT EXISTS idx_marketing_events_created_at ON public.marketing_events(created_at);
  END IF;
END $$;
