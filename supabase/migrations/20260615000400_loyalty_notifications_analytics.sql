-- ============================================
-- WeAfrica Ride — Loyalty Notifications & Analytics
-- ============================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'users') THEN
    CREATE TABLE IF NOT EXISTS public.loyalty_notifications (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
      rider_id UUID,
      driver_id UUID,
      notification_type TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT,
      metadata JSONB DEFAULT '{}'::jsonb,
      is_read BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  ELSE
    -- Create without foreign key if users doesn't exist
    CREATE TABLE IF NOT EXISTS public.loyalty_notifications (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID,
      rider_id UUID,
      driver_id UUID,
      notification_type TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT,
      metadata JSONB DEFAULT '{}'::jsonb,
      is_read BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  END IF;
END $$;

-- Add indexes if table exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'loyalty_notifications') THEN
    CREATE INDEX IF NOT EXISTS idx_loyalty_notifications_user_id ON public.loyalty_notifications(user_id);
    CREATE INDEX IF NOT EXISTS idx_loyalty_notifications_type ON public.loyalty_notifications(notification_type);
    CREATE INDEX IF NOT EXISTS idx_loyalty_notifications_created_at ON public.loyalty_notifications(created_at);
    CREATE INDEX IF NOT EXISTS idx_loyalty_notifications_is_read ON public.loyalty_notifications(is_read);
  END IF;
END $$;
