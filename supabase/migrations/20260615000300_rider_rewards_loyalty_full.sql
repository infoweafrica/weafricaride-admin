-- ============================================
-- WeAfrica Ride — Full Rider Rewards & Loyalty System
-- ============================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'riders') THEN
    CREATE TABLE IF NOT EXISTS public.rider_loyalty_accounts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      rider_id UUID NOT NULL REFERENCES public.riders(id) ON DELETE CASCADE UNIQUE,
      user_id UUID,
      points INT NOT NULL DEFAULT 0,
      lifetime_points INT NOT NULL DEFAULT 0,
      total_rides_completed INT NOT NULL DEFAULT 0,
      total_spent NUMERIC(12,2) NOT NULL DEFAULT 0,
      current_tier TEXT DEFAULT 'bronze',
      tier_achieved_at TIMESTAMPTZ,
      streak_weeks INT NOT NULL DEFAULT 0,
      last_ride_at TIMESTAMPTZ,
      birthday_bonus_claimed BOOLEAN NOT NULL DEFAULT false,
      referral_bonus_claimed INT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  ELSE
    -- Create without foreign key if riders doesn't exist
    CREATE TABLE IF NOT EXISTS public.rider_loyalty_accounts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      rider_id UUID,
      user_id UUID,
      points INT NOT NULL DEFAULT 0,
      lifetime_points INT NOT NULL DEFAULT 0,
      total_rides_completed INT NOT NULL DEFAULT 0,
      total_spent NUMERIC(12,2) NOT NULL DEFAULT 0,
      current_tier TEXT DEFAULT 'bronze',
      tier_achieved_at TIMESTAMPTZ,
      streak_weeks INT NOT NULL DEFAULT 0,
      last_ride_at TIMESTAMPTZ,
      birthday_bonus_claimed BOOLEAN NOT NULL DEFAULT false,
      referral_bonus_claimed INT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  END IF;
END $$;

-- Add indexes if table exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'rider_loyalty_accounts') THEN
    CREATE INDEX IF NOT EXISTS idx_rider_loyalty_rider_id ON public.rider_loyalty_accounts(rider_id);
    CREATE INDEX IF NOT EXISTS idx_rider_loyalty_user_id ON public.rider_loyalty_accounts(user_id);
    CREATE INDEX IF NOT EXISTS idx_rider_loyalty_tier ON public.rider_loyalty_accounts(current_tier);
  END IF;
END $$;
