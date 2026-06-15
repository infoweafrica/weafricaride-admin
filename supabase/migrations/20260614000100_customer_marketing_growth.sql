-- WeAfrica Ride — Customer marketing growth module
-- Admin-controlled customer acquisition, retention, banners, rewards, loyalty and analytics.

ALTER TABLE public.promo_codes
  ADD COLUMN IF NOT EXISTS applicable_cities TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS applicable_vehicle_types TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';

CREATE TABLE IF NOT EXISTS public.marketing_banners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  subtitle TEXT,
  image_url TEXT,
  target_city TEXT,
  click_action TEXT DEFAULT 'home',
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT true,
  impressions_count INTEGER DEFAULT 0,
  clicks_count INTEGER DEFAULT 0,
  created_by UUID REFERENCES public.admin_users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_marketing_banners_active ON public.marketing_banners(is_active, starts_at, ends_at);
CREATE INDEX IF NOT EXISTS idx_marketing_banners_city ON public.marketing_banners(target_city);

CREATE TABLE IF NOT EXISTS public.marketing_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  campaign_type TEXT NOT NULL DEFAULT 're_engagement',
  target_segment TEXT,
  trigger_rule TEXT,
  reward_amount DECIMAL(12,2) DEFAULT 0,
  promo_code_id UUID REFERENCES public.promo_codes(id) ON DELETE SET NULL,
  status TEXT DEFAULT 'draft',
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  sent_count INTEGER DEFAULT 0,
  redeemed_count INTEGER DEFAULT 0,
  revenue_generated DECIMAL(12,2) DEFAULT 0,
  created_by UUID REFERENCES public.admin_users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_marketing_campaigns_type ON public.marketing_campaigns(campaign_type);
CREATE INDEX IF NOT EXISTS idx_marketing_campaigns_status ON public.marketing_campaigns(status);

CREATE TABLE IF NOT EXISTS public.customer_segments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  city TEXT,
  min_total_rides INTEGER,
  max_total_rides INTEGER,
  inactive_days INTEGER,
  min_spend DECIMAL(12,2),
  ride_frequency TEXT,
  estimated_count INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_by UUID REFERENCES public.admin_users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.loyalty_tiers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  min_rides INTEGER DEFAULT 0,
  discount_percent DECIMAL(5,2) DEFAULT 0,
  priority_support BOOLEAN DEFAULT false,
  voucher_amount DECIMAL(12,2) DEFAULT 0,
  benefits JSONB DEFAULT '{}',
  sort_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.marketing_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  entity_type TEXT,
  entity_id UUID,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_marketing_events_type ON public.marketing_events(event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_marketing_events_entity ON public.marketing_events(entity_type, entity_id);

INSERT INTO public.loyalty_tiers (name, min_rides, discount_percent, priority_support, voucher_amount, sort_order, benefits) VALUES
  ('Silver', 10, 5, false, 0, 1, '{"label":"5% occasional discounts"}'::jsonb),
  ('Gold', 30, 10, true, 25, 2, '{"label":"10% discounts + priority support"}'::jsonb),
  ('Platinum', 75, 15, true, 50, 3, '{"label":"15% discounts + monthly ride voucher"}'::jsonb)
ON CONFLICT (name) DO NOTHING;

INSERT INTO public.marketing_banners (title, subtitle, target_city, click_action, is_active) VALUES
  ('Airport Rides Available', 'Book reliable airport rides with WeAfrica Ride.', NULL, 'booking', true),
  ('Refer Friends & Earn', 'Friend gets R50. You get R50 after their first ride.', NULL, 'referral', true),
  ('Women Drivers Now Available', 'Choose trusted ride options in supported cities.', NULL, 'booking', true)
ON CONFLICT DO NOTHING;

INSERT INTO public.customer_segments (name, city, min_total_rides, inactive_days, min_spend, is_active) VALUES
  ('Cape Town riders', 'Cape Town', NULL, NULL, NULL, true),
  ('Users with 50+ rides', NULL, 50, NULL, NULL, true),
  ('Users inactive 60 days', NULL, NULL, 60, NULL, true)
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.admin_adjust_rewards_wallet(
  p_user_id UUID,
  p_amount DECIMAL,
  p_bucket TEXT DEFAULT 'promo_balance',
  p_reason TEXT DEFAULT 'Admin marketing credit'
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wallet RECORD;
  v_balance_before DECIMAL(12,2);
  v_balance_after DECIMAL(12,2);
  v_column TEXT;
BEGIN
  IF p_bucket NOT IN ('ride_credits','promo_balance','refund_balance','balance') THEN
    RAISE EXCEPTION 'Unsupported rewards bucket: %', p_bucket;
  END IF;

  INSERT INTO public.wallets (user_id, balance, ride_credits, promo_balance, refund_balance)
  VALUES (p_user_id, 0, 0, 0, 0)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT * INTO v_wallet FROM public.wallets WHERE user_id = p_user_id;
  v_column := p_bucket;
  v_balance_before := COALESCE((to_jsonb(v_wallet)->>v_column)::DECIMAL, 0);
  v_balance_after := GREATEST(v_balance_before + p_amount, 0);

  EXECUTE format('UPDATE public.wallets SET %I = $1, updated_at = NOW() WHERE id = $2', v_column)
  USING v_balance_after, v_wallet.id;

  INSERT INTO public.wallet_transactions (wallet_id, transaction_type, amount, balance_before, balance_after, reference_type, description)
  VALUES (v_wallet.id, CASE WHEN p_amount >= 0 THEN 'marketing_credit' ELSE 'marketing_debit' END, p_amount, v_balance_before, v_balance_after, p_bucket, p_reason);

  INSERT INTO public.marketing_events (user_id, event_type, entity_type, entity_id, metadata)
  VALUES (p_user_id, 'rewards_wallet_adjusted', 'wallet', v_wallet.id, jsonb_build_object('bucket', p_bucket, 'amount', p_amount, 'reason', p_reason));

  RETURN jsonb_build_object('ok', true, 'wallet_id', v_wallet.id, 'bucket', p_bucket, 'balance_after', v_balance_after);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_active_marketing_home(p_city TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN jsonb_build_object(
    'banners', COALESCE((
      SELECT jsonb_agg(to_jsonb(b) ORDER BY b.created_at DESC)
      FROM public.marketing_banners b
      WHERE b.is_active = true
        AND (b.starts_at IS NULL OR b.starts_at <= NOW())
        AND (b.ends_at IS NULL OR b.ends_at >= NOW())
        AND (b.target_city IS NULL OR p_city IS NULL OR b.target_city ILIKE p_city)
      LIMIT 5
    ), '[]'::jsonb),
    'offers', COALESCE((
      SELECT jsonb_agg(to_jsonb(p) ORDER BY p.created_at DESC)
      FROM public.promo_codes p
      WHERE p.status = 'active'
        AND COALESCE(p.visible, true) = true
        AND (p.starts_at IS NULL OR p.starts_at <= NOW())
        AND (p.expires_at IS NULL OR p.expires_at >= NOW())
      LIMIT 5
    ), '[]'::jsonb),
    'loyalty_tiers', COALESCE((
      SELECT jsonb_agg(to_jsonb(t) ORDER BY t.sort_order)
      FROM public.loyalty_tiers t
      WHERE t.is_active = true
    ), '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_marketing_analytics(p_days INTEGER DEFAULT 30)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_since TIMESTAMPTZ := NOW() - make_interval(days => p_days);
BEGIN
  RETURN jsonb_build_object(
    'promo_usage', COALESCE((SELECT COUNT(*) FROM public.promo_redemptions WHERE redeemed_at >= v_since), 0),
    'referral_signups', COALESCE((SELECT COUNT(*) FROM public.rider_referrals WHERE created_at >= v_since), 0),
    'push_opens', COALESCE((SELECT SUM(opened_count) FROM public.push_notifications WHERE created_at >= v_since), 0),
    'banner_clicks', COALESCE((SELECT SUM(clicks_count) FROM public.marketing_banners), 0),
    'customer_retention', COALESCE((SELECT ROUND((COUNT(*) FILTER (WHERE total_rides > 1))::DECIMAL / NULLIF(COUNT(*), 0) * 100, 1) FROM public.riders), 0),
    'customer_acquisition', COALESCE((SELECT COUNT(*) FROM public.riders WHERE created_at >= v_since), 0),
    'revenue_generated', COALESCE((SELECT SUM(COALESCE(actual_fare, estimated_fare, 0)) FROM public.rides WHERE status = 'completed' AND created_at >= v_since), 0)
  );
END;
$$;

ALTER TABLE public.marketing_banners ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_segments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loyalty_tiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_events ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['marketing_banners','marketing_campaigns','customer_segments','loyalty_tiers','marketing_events'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Admins full access on %1$s" ON public.%1$I', tbl);
    EXECUTE format('CREATE POLICY "Admins full access on %1$s" ON public.%1$I FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = auth.uid() AND is_active = true)) WITH CHECK (EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = auth.uid() AND is_active = true))', tbl);
  END LOOP;
END $$;

DROP POLICY IF EXISTS "Authenticated read active marketing banners" ON public.marketing_banners;
CREATE POLICY "Authenticated read active marketing banners" ON public.marketing_banners
  FOR SELECT TO authenticated
  USING (is_active = true);

DROP POLICY IF EXISTS "Authenticated read active loyalty tiers" ON public.loyalty_tiers;
CREATE POLICY "Authenticated read active loyalty tiers" ON public.loyalty_tiers
  FOR SELECT TO authenticated
  USING (is_active = true);

SELECT 'Customer marketing growth module installed' AS result;
