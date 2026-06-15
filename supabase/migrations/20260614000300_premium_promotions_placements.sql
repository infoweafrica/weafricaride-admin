-- Mirror of root Supabase migration: premium rider promotion placements.

CREATE TABLE IF NOT EXISTS public.promotions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  image_url TEXT,
  promo_code TEXT,
  discount_type TEXT DEFAULT 'percentage',
  discount_value NUMERIC(12,2) DEFAULT 0,
  start_date TIMESTAMPTZ,
  end_date TIMESTAMPTZ,
  target_audience TEXT DEFAULT 'all',
  target_city TEXT,
  category TEXT DEFAULT 'for_you',
  placement TEXT NOT NULL DEFAULT 'home_carousel' CHECK (placement IN ('home_carousel','booking_screen','searching_driver','ride_completed','offers_page','map_banner','notifications_inbox')),
  partner_name TEXT,
  action_text TEXT DEFAULT 'Learn More',
  action_url TEXT,
  accent_color TEXT DEFAULT '#F97316',
  priority INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  impressions_count INTEGER DEFAULT 0,
  clicks_count INTEGER DEFAULT 0,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.marketing_banners
  ADD COLUMN IF NOT EXISTS placement TEXT DEFAULT 'home_carousel',
  ADD COLUMN IF NOT EXISTS partner_name TEXT,
  ADD COLUMN IF NOT EXISTS priority INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS accent_color TEXT DEFAULT '#F97316';

CREATE INDEX IF NOT EXISTS idx_promotions_active_placement ON public.promotions(is_active, placement, priority DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_promotions_dates ON public.promotions(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_marketing_banners_placement ON public.marketing_banners(placement, is_active, created_at DESC);

INSERT INTO public.promotions (title, description, promo_code, discount_type, discount_value, placement, category, action_text, accent_color, priority, is_active) VALUES
  ('20% OFF AIRPORT RIDES', 'Save on airport trips this week.', 'AIRPORT20', 'percentage', 20, 'home_carousel', 'airport', 'Book Now', '#F97316', 100, true),
  ('Use PROMO20', 'Save MWK 1,000 on this booking.', 'PROMO20', 'fixed', 1000, 'booking_screen', 'for_you', 'Apply', '#111827', 90, true),
  ('Airtel Money', 'Fast & secure payments for your ride.', NULL, 'percentage', 0, 'searching_driver', 'partner', 'Learn More', '#D97706', 80, true),
  ('15% OFF NEXT RIDE', 'Use RIDE15 after your trip.', 'RIDE15', 'percentage', 15, 'ride_completed', 'for_you', 'Use Code', '#059669', 70, true),
  ('Weekend Airport Discount', 'Save 20% this weekend.', 'AIRPORT20', 'percentage', 20, 'offers_page', 'weekend', 'View Offer', '#7C3AED', 60, true),
  ('Near Airport', 'Airport rides now 15% cheaper.', 'AIRPORT15', 'percentage', 15, 'map_banner', 'airport', 'Book Now', '#2563EB', 50, true)
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.get_active_marketing_home(p_city TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN jsonb_build_object(
    'promotions', COALESCE((SELECT jsonb_agg(item ORDER BY priority DESC, created_at DESC) FROM (
      SELECT to_jsonb(p) AS item, COALESCE(p.priority, 0) AS priority, p.created_at FROM public.promotions p
      WHERE p.is_active = true AND (p.start_date IS NULL OR p.start_date <= NOW()) AND (p.end_date IS NULL OR p.end_date >= NOW()) AND (p.target_city IS NULL OR p_city IS NULL OR p.target_city ILIKE p_city)
      UNION ALL
      SELECT jsonb_build_object('id', b.id, 'title', b.title, 'description', b.subtitle, 'image_url', b.image_url, 'promo_code', NULL, 'discount_type', NULL, 'discount_value', NULL, 'placement', COALESCE(b.placement, 'home_carousel'), 'target_audience', 'all', 'target_city', b.target_city, 'category', 'banner', 'partner_name', b.partner_name, 'action_text', CASE WHEN b.click_action = 'booking' THEN 'Book Now' ELSE 'Learn More' END, 'action_url', b.click_action, 'accent_color', COALESCE(b.accent_color, '#F97316'), 'priority', COALESCE(b.priority, 0), 'is_active', b.is_active, 'created_at', b.created_at) AS item, COALESCE(b.priority, 0) AS priority, b.created_at FROM public.marketing_banners b
      WHERE b.is_active = true AND (b.starts_at IS NULL OR b.starts_at <= NOW()) AND (b.ends_at IS NULL OR b.ends_at >= NOW()) AND (b.target_city IS NULL OR p_city IS NULL OR b.target_city ILIKE p_city)
      ORDER BY priority DESC, created_at DESC LIMIT 30
    ) s), '[]'::jsonb),
    'banners', COALESCE((SELECT jsonb_agg(to_jsonb(b) ORDER BY b.priority DESC, b.created_at DESC) FROM public.marketing_banners b WHERE b.is_active = true AND (b.starts_at IS NULL OR b.starts_at <= NOW()) AND (b.ends_at IS NULL OR b.ends_at >= NOW()) AND (b.target_city IS NULL OR p_city IS NULL OR b.target_city ILIKE p_city) LIMIT 5), '[]'::jsonb),
    'offers', COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.created_at DESC) FROM public.promo_codes p WHERE p.status = 'active' AND COALESCE(p.visible, true) = true AND (p.starts_at IS NULL OR p.starts_at <= NOW()) AND (p.expires_at IS NULL OR p.expires_at >= NOW()) LIMIT 5), '[]'::jsonb),
    'loyalty_tiers', COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.sort_order) FROM public.loyalty_tiers t WHERE t.is_active = true), '[]'::jsonb)
  );
END;
$$;

ALTER TABLE public.promotions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS public_read_promotions ON public.promotions;
DROP POLICY IF EXISTS public_insert_promotions ON public.promotions;
DROP POLICY IF EXISTS public_update_promotions ON public.promotions;
DROP POLICY IF EXISTS public_delete_promotions ON public.promotions;
CREATE POLICY public_read_promotions ON public.promotions FOR SELECT USING (true);
CREATE POLICY public_insert_promotions ON public.promotions FOR INSERT WITH CHECK (true);
CREATE POLICY public_update_promotions ON public.promotions FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY public_delete_promotions ON public.promotions FOR DELETE USING (true);
GRANT EXECUTE ON FUNCTION public.get_active_marketing_home(TEXT) TO anon, authenticated;