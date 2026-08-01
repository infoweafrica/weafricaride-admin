-- ============================================
-- Premium Promotions & Placements
-- ============================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'marketing_banners') THEN
    ALTER TABLE public.marketing_banners
      ADD COLUMN IF NOT EXISTS placement TEXT DEFAULT 'home_carousel',
      ADD COLUMN IF NOT EXISTS partner_name TEXT,
      ADD COLUMN IF NOT EXISTS priority INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS accent_color TEXT DEFAULT '#F97316';
  END IF;
END $$;
