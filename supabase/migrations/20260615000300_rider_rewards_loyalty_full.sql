-- ====================================
-- WeAfrica Ride — Full Rider Rewards & Loyalty System
-- Tables, RPCs, Triggers, RLS
-- Connects: rider-app, driver-app, admin-dashboard
-- ====================================

-- ====================================
-- 1. RIDER LOYALTY ACCOUNTS
-- ====================================
CREATE TABLE IF NOT EXISTS public.rider_loyalty_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rider_id UUID NOT NULL REFERENCES public.riders(id) ON DELETE CASCADE UNIQUE,
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
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

CREATE INDEX IF NOT EXISTS idx_rider_loyalty_accounts_rider ON public.rider_loyalty_accounts(rider_id);
CREATE INDEX IF NOT EXISTS idx_rider_loyalty_accounts_user ON public.rider_loyalty_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_rider_loyalty_accounts_tier ON public.rider_loyalty_accounts(current_tier);

-- ====================================
-- 2. REWARD DEFINITIONS (admin-managed)
-- ====================================
CREATE TABLE IF NOT EXISTS public.reward_definitions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT,
    reward_type TEXT NOT NULL DEFAULT 'voucher', -- voucher, discount, free_ride, bonus_points, cashback, gift
    value NUMERIC(12,2) DEFAULT 0, -- voucher amount or discount %
    points_cost INT DEFAULT 0, -- points needed to redeem (0 = achievement-based)
    min_tier TEXT, -- bronze, silver, gold, platinum (NULL = all tiers)
    min_rides INT DEFAULT 0,
    max_redemptions INT DEFAULT 9999,
    current_redemptions INT NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT true,
    is_featured BOOLEAN NOT NULL DEFAULT false,
    is_achievement BOOLEAN NOT NULL DEFAULT false, -- auto-awarded, not redeemed
    achievement_trigger TEXT, -- 'rides_5', 'rides_10', 'rides_25', 'streak_4', 'birthday', 'referral_5', 'spent_50000'
    icon TEXT,
    accent_color TEXT DEFAULT '#F97316',
    sort_order INT DEFAULT 0,
    starts_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reward_definitions_active ON public.reward_definitions(is_active, sort_order);

-- ====================================
-- 3. RIDER REDEMPTIONS (issued/claimed rewards)
-- ====================================
CREATE TABLE IF NOT EXISTS public.rider_rewards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rider_id UUID NOT NULL REFERENCES public.riders(id) ON DELETE CASCADE,
    reward_definition_id UUID REFERENCES public.reward_definitions(id) ON DELETE SET NULL,
    reward_type TEXT NOT NULL DEFAULT 'voucher',
    reward_name TEXT NOT NULL,
    description TEXT,
    value NUMERIC(12,2) DEFAULT 0,
    points_spent INT DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active', -- active, used, expired, cancelled
    redeemed_at TIMESTAMPTZ DEFAULT NOW(),
    used_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    used_on_ride_id UUID REFERENCES public.rides(id) ON DELETE SET NULL,
    promo_code TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rider_rewards_rider ON public.rider_rewards(rider_id, status);
CREATE INDEX IF NOT EXISTS idx_rider_rewards_used_ride ON public.rider_rewards(used_on_ride_id);
CREATE INDEX IF NOT EXISTS idx_rider_rewards_expires ON public.rider_rewards(expires_at) WHERE status = 'active';

-- ====================================
-- 4. POINTS TRANSACTIONS (audit log)
-- ====================================
CREATE TABLE IF NOT EXISTS public.loyalty_points_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rider_id UUID NOT NULL REFERENCES public.riders(id) ON DELETE CASCADE,
    points INT NOT NULL,
    points_before INT NOT NULL DEFAULT 0,
    points_after INT NOT NULL DEFAULT 0,
    transaction_type TEXT NOT NULL, -- ride_completed, achievement, referral, bonus, redemption, admin_adjust, birthday, streak
    reference_type TEXT,
    reference_id UUID,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_loyalty_points_rider ON public.loyalty_points_transactions(rider_id, created_at DESC);

-- ====================================
-- 5. DRIVER LOYALTY ACCOUNTS
-- ====================================
CREATE TABLE IF NOT EXISTS public.driver_loyalty_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    driver_id UUID NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE UNIQUE,
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    points INT NOT NULL DEFAULT 0,
    lifetime_points INT NOT NULL DEFAULT 0,
    total_rides_completed INT NOT NULL DEFAULT 0,
    total_earnings NUMERIC(12,2) NOT NULL DEFAULT 0,
    acceptance_rate NUMERIC(5,2) DEFAULT 0,
    avg_rating NUMERIC(3,2) DEFAULT 0,
    current_tier TEXT DEFAULT 'standard', -- standard, silver, gold, platinum
    tier_achieved_at TIMESTAMPTZ,
    streak_days INT NOT NULL DEFAULT 0,
    last_ride_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_driver_loyalty_accts_driver ON public.driver_loyalty_accounts(driver_id);
CREATE INDEX IF NOT EXISTS idx_driver_loyalty_accts_tier ON public.driver_loyalty_accounts(current_tier);

-- ====================================
-- 6. DRIVER REWARDS
-- ====================================
CREATE TABLE IF NOT EXISTS public.driver_rewards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    driver_id UUID NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
    reward_type TEXT NOT NULL DEFAULT 'bonus', -- bonus, milestone, achievement, cashback, fuel_voucher
    reward_name TEXT NOT NULL,
    description TEXT,
    value NUMERIC(12,2) DEFAULT 0,
    currency TEXT DEFAULT 'MWK',
    status TEXT NOT NULL DEFAULT 'pending', -- pending, approved, paid, expired, cancelled
    achieved_at TIMESTAMPTZ DEFAULT NOW(),
    paid_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    ride_id UUID REFERENCES public.rides(id) ON DELETE SET NULL,
    milestone TEXT, -- 'rides_50', 'rides_100', 'rides_500', 'earnings_100k', 'rating_4_8', etc.
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_driver_rewards_driver ON public.driver_rewards(driver_id, status);

-- ====================================
-- 7. TIER CONFIG (extends existing loyalty_tiers)
-- ====================================
CREATE TABLE IF NOT EXISTS public.loyalty_tier_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tier_name TEXT NOT NULL UNIQUE, -- bronze, silver, gold, platinum
    tier_display TEXT NOT NULL,
    min_points INT NOT NULL DEFAULT 0,
    min_rides INT NOT NULL DEFAULT 0,
    points_multiplier NUMERIC(3,2) DEFAULT 1.0, -- e.g. silver earns 1.5x
    discount_percent INT DEFAULT 0,
    priority_support BOOLEAN DEFAULT false,
    free_cancellations_per_month INT DEFAULT 0,
    birthday_bonus INT DEFAULT 0,
    voucher_amount INT DEFAULT 0,
    referral_bonus_multiplier NUMERIC(3,2) DEFAULT 1.0,
    sort_order INT DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed default tiers from existing loyalty_tiers if they don't exist in tier_config
INSERT INTO public.loyalty_tier_config (tier_name, tier_display, min_points, min_rides, points_multiplier, discount_percent, priority_support, free_cancellations_per_month, birthday_bonus, voucher_amount, sort_order, is_active)
VALUES
    ('bronze', 'Bronze', 0, 0, 1.0, 0, false, 0, 100, 0, 0, true),
    ('silver', 'Silver', 500, 10, 1.25, 5, false, 1, 250, 500, 1, true),
    ('gold', 'Gold', 2000, 25, 1.5, 10, true, 2, 500, 1000, 2, true),
    ('platinum', 'Platinum', 5000, 50, 2.0, 15, true, 3, 1000, 2500, 3, true)
ON CONFLICT (tier_name) DO NOTHING;

-- ====================================
-- 8. RLS POLICIES
-- ====================================
ALTER TABLE public.rider_loyalty_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reward_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rider_rewards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loyalty_points_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_loyalty_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_rewards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loyalty_tier_config ENABLE ROW LEVEL SECURITY;

-- Allow anon (mobile apps via Firebase auth) to read/write their loyalty data
DROP POLICY IF EXISTS anon_rider_loyalty_accounts_all ON public.rider_loyalty_accounts;
CREATE POLICY anon_rider_loyalty_accounts_all ON public.rider_loyalty_accounts
    FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS anon_reward_definitions_select ON public.reward_definitions;
CREATE POLICY anon_reward_definitions_select ON public.reward_definitions
    FOR SELECT USING (true);

DROP POLICY IF EXISTS anon_rider_rewards_all ON public.rider_rewards;
CREATE POLICY anon_rider_rewards_all ON public.rider_rewards
    FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS anon_loyalty_points_all ON public.loyalty_points_transactions;
CREATE POLICY anon_loyalty_points_all ON public.loyalty_points_transactions
    FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS anon_driver_loyalty_all ON public.driver_loyalty_accounts;
CREATE POLICY anon_driver_loyalty_all ON public.driver_loyalty_accounts
    FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS anon_driver_rewards_all ON public.driver_rewards;
CREATE POLICY anon_driver_rewards_all ON public.driver_rewards
    FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS anon_loyalty_tier_config_select ON public.loyalty_tier_config;
CREATE POLICY anon_loyalty_tier_config_select ON public.loyalty_tier_config
    FOR SELECT USING (true);

-- ====================================
-- 9. RPC: ENSURE RIDER LOYALTY ACCOUNT
-- ====================================
CREATE OR REPLACE FUNCTION public.ensure_rider_loyalty_account(p_rider_id UUID)
RETURNS public.rider_loyalty_accounts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_account public.rider_loyalty_accounts;
    v_user_id UUID;
BEGIN
    SELECT user_id INTO v_user_id FROM public.riders WHERE id = p_rider_id;
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Rider not found';
    END IF;

    INSERT INTO public.rider_loyalty_accounts(rider_id, user_id)
    VALUES (p_rider_id, v_user_id)
    ON CONFLICT (rider_id) DO NOTHING;

    SELECT * INTO v_account
    FROM public.rider_loyalty_accounts
    WHERE rider_id = p_rider_id;

    RETURN v_account;
END;
$$;

-- ====================================
-- 10. RPC: AWARD LOYALTY POINTS (for ride completion)
-- ====================================
CREATE OR REPLACE FUNCTION public.award_ride_loyalty_points(
    p_rider_id UUID,
    p_ride_id UUID,
    p_fare_amount NUMERIC DEFAULT 0
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_account public.rider_loyalty_accounts;
    v_points_earned INT;
    v_current_tier TEXT;
    v_multiplier NUMERIC(3,2) := 1.0;
    v_points_before INT;
    v_points_after INT;
    v_new_tier TEXT;
BEGIN
    -- Ensure account exists
    v_account := public.ensure_rider_loyalty_account(p_rider_id);
    v_points_before := COALESCE(v_account.points, 0);

    -- Get tier multiplier
    SELECT points_multiplier INTO v_multiplier
    FROM public.loyalty_tier_config
    WHERE tier_name = v_account.current_tier AND is_active = true;

    -- Base points: 10 points per ride + 1 point per 100 MWK spent
    v_points_earned := 10 + GREATEST(0, FLOOR(COALESCE(p_fare_amount, 0) / 100)::INT);
    v_points_earned := CEIL(v_points_earned * COALESCE(v_multiplier, 1.0));

    v_points_after := v_points_before + v_points_earned;

    -- Update account
    UPDATE public.rider_loyalty_accounts
    SET points = v_points_after,
        lifetime_points = COALESCE(lifetime_points, 0) + v_points_earned,
        total_rides_completed = COALESCE(total_rides_completed, 0) + 1,
        total_spent = COALESCE(total_spent, 0) + COALESCE(p_fare_amount, 0),
        last_ride_at = NOW(),
        updated_at = NOW()
    WHERE rider_id = p_rider_id
    RETURNING * INTO v_account;

    -- Log transaction
    INSERT INTO public.loyalty_points_transactions(
        rider_id, points, points_before, points_after,
        transaction_type, reference_type, reference_id, description
    ) VALUES (
        p_rider_id, v_points_earned, v_points_before, v_points_after,
        'ride_completed', 'ride', p_ride_id,
        'Ride completed - earned ' || v_points_earned || ' points'
    );

    -- Check for tier upgrade
    SELECT tier_name INTO v_new_tier
    FROM public.loyalty_tier_config
    WHERE is_active = true
      AND v_account.total_rides_completed >= min_rides
      AND v_account.lifetime_points >= min_points
    ORDER BY sort_order DESC
    LIMIT 1;

    IF v_new_tier IS NOT NULL AND v_new_tier != v_account.current_tier THEN
        UPDATE public.rider_loyalty_accounts
        SET current_tier = v_new_tier,
            tier_achieved_at = NOW(),
            updated_at = NOW()
        WHERE rider_id = p_rider_id;

        INSERT INTO public.loyalty_points_transactions(
            rider_id, points, points_before, points_after,
            transaction_type, description
        ) VALUES (
            p_rider_id, 0, v_points_after, v_points_after,
            'achievement',
            'Tier upgraded to ' || v_new_tier
        );

        -- Auto-award tier achievement reward
        INSERT INTO public.rider_rewards(
            rider_id, reward_type, reward_name, description,
            value, points_spent, status, expires_at
        )
        SELECT
            p_rider_id, 'voucher', 'Tier Upgrade: ' || ltc.tier_display,
            'Congratulations! You''ve reached ' || ltc.tier_display || ' tier!',
            ltc.voucher_amount, 0, 'active',
            NOW() + INTERVAL '90 days'
        FROM public.loyalty_tier_config ltc
        WHERE ltc.tier_name = v_new_tier AND ltc.voucher_amount > 0;
    END IF;

    -- Check for milestone achievements
    -- 5 rides
    IF v_account.total_rides_completed = 5 THEN
        INSERT INTO public.rider_rewards(rider_id, reward_type, reward_name, description, value, points_spent, status, expires_at)
        VALUES (p_rider_id, 'voucher', '5 Rides Milestone', 'Completed 5 rides!', 200, 0, 'active', NOW() + INTERVAL '30 days');
    END IF;

    -- 10 rides
    IF v_account.total_rides_completed = 10 THEN
        INSERT INTO public.rider_rewards(rider_id, reward_type, reward_name, description, value, points_spent, status, expires_at)
        VALUES (p_rider_id, 'voucher', '10 Rides Milestone', 'Completed 10 rides!', 500, 0, 'active', NOW() + INTERVAL '30 days');
    END IF;

    -- 25 rides
    IF v_account.total_rides_completed = 25 THEN
        INSERT INTO public.rider_rewards(rider_id, reward_type, reward_name, description, value, points_spent, status, expires_at)
        VALUES (p_rider_id, 'free_ride', '25 Rides Milestone', 'You earned a free ride!', 0, 0, 'active', NOW() + INTERVAL '60 days');
    END IF;

    -- 50 rides
    IF v_account.total_rides_completed = 50 THEN
        INSERT INTO public.rider_rewards(rider_id, reward_type, reward_name, description, value, points_spent, status, expires_at)
        VALUES (p_rider_id, 'voucher', '50 Rides Champion', '50 rides completed!', 2000, 0, 'active', NOW() + INTERVAL '30 days');
    END IF;

    RETURN jsonb_build_object(
        'ok', true,
        'points_earned', v_points_earned,
        'total_points', v_points_after,
        'tier', COALESCE(v_new_tier, v_account.current_tier),
        'tier_upgraded', v_new_tier IS NOT NULL AND v_new_tier != v_account.current_tier
    );
END;
$$;

-- ====================================
-- 11. RPC: REDEEM REWARD
-- ====================================
CREATE OR REPLACE FUNCTION public.redeem_loyalty_reward(
    p_rider_id UUID,
    p_reward_definition_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_def public.reward_definitions;
    v_account public.rider_loyalty_accounts;
    v_points_before INT;
    v_points_after INT;
    v_reward public.rider_rewards;
BEGIN
    -- Get reward definition
    SELECT * INTO v_def
    FROM public.reward_definitions
    WHERE id = p_reward_definition_id
      AND is_active = true
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Reward not found or not active';
    END IF;

    -- Check expiry
    IF v_def.expires_at IS NOT NULL AND v_def.expires_at < NOW() THEN
        RAISE EXCEPTION 'Reward has expired';
    END IF;

    -- Check max redemptions
    IF v_def.max_redemptions IS NOT NULL AND v_def.current_redemptions >= v_def.max_redemptions THEN
        RAISE EXCEPTION 'Reward redemptions limit reached';
    END IF;

    -- Get loyalty account
    v_account := public.ensure_rider_loyalty_account(p_rider_id);
    v_points_before := COALESCE(v_account.points, 0);

    -- Check tier requirement
    IF v_def.min_tier IS NOT NULL THEN
        -- Simple tier check (bronze < silver < gold < platinum)
        IF NOT (
            (v_def.min_tier = 'bronze') OR
            (v_def.min_tier = 'silver' AND v_account.current_tier IN ('silver', 'gold', 'platinum')) OR
            (v_def.min_tier = 'gold' AND v_account.current_tier IN ('gold', 'platinum')) OR
            (v_def.min_tier = 'platinum' AND v_account.current_tier = 'platinum')
        ) THEN
            RAISE EXCEPTION 'You need % tier or higher', v_def.min_tier;
        END IF;
    END IF;

    -- Check min rides
    IF v_def.min_rides > 0 AND COALESCE(v_account.total_rides_completed, 0) < v_def.min_rides THEN
        RAISE EXCEPTION 'You need % rides to redeem this reward', v_def.min_rides;
    END IF;

    -- Check points
    IF v_def.points_cost > 0 AND v_points_before < v_def.points_cost THEN
        RAISE EXCEPTION 'Not enough points. Need % but have %', v_def.points_cost, v_points_before;
    END IF;

    -- Deduct points
    IF v_def.points_cost > 0 THEN
        v_points_after := v_points_before - v_def.points_cost;
        UPDATE public.rider_loyalty_accounts
        SET points = v_points_after, updated_at = NOW()
        WHERE rider_id = p_rider_id;

        INSERT INTO public.loyalty_points_transactions(
            rider_id, points, points_before, points_after,
            transaction_type, reference_type, reference_id, description
        ) VALUES (
            p_rider_id, -v_def.points_cost, v_points_before, v_points_after,
            'redemption', 'reward_definition', p_reward_definition_id,
            'Redeemed reward: ' || v_def.name
        );
    END IF;

    -- Increment redemption count
    UPDATE public.reward_definitions
    SET current_redemptions = current_redemptions + 1
    WHERE id = p_reward_definition_id;

    -- Create rider reward
    INSERT INTO public.rider_rewards(
        rider_id, reward_definition_id, reward_type, reward_name,
        description, value, points_spent, status, expires_at
    ) VALUES (
        p_rider_id, p_reward_definition_id, v_def.reward_type,
        v_def.name, v_def.description,
        v_def.value, v_def.points_cost, 'active',
        COALESCE(v_def.expires_at, NOW() + INTERVAL '30 days')
    ) RETURNING * INTO v_reward;

    RETURN jsonb_build_object(
        'ok', true,
        'reward', to_jsonb(v_reward),
        'points_remaining', v_points_after,
        'message', 'Reward redeemed successfully!'
    );
END;
$$;

-- ====================================
-- 12. RPC: MARK REWARD AS USED
-- ====================================
CREATE OR REPLACE FUNCTION public.use_rider_reward(
    p_reward_id UUID,
    p_ride_id UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_reward public.rider_rewards;
BEGIN
    SELECT * INTO v_reward
    FROM public.rider_rewards
    WHERE id = p_reward_id AND status = 'active'
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Reward not found or already used';
    END IF;

    IF v_reward.expires_at IS NOT NULL AND v_reward.expires_at < NOW() THEN
        -- Mark as expired instead
        UPDATE public.rider_rewards
        SET status = 'expired', updated_at = NOW()
        WHERE id = p_reward_id;
        RAISE EXCEPTION 'Reward has expired';
    END IF;

    UPDATE public.rider_rewards
    SET status = 'used',
        used_at = NOW(),
        used_on_ride_id = p_ride_id,
        updated_at = NOW()
    WHERE id = p_reward_id
    RETURNING * INTO v_reward;

    RETURN jsonb_build_object('ok', true, 'reward', to_jsonb(v_reward));
END;
$$;

-- ====================================
-- 13. RPC: ADMIN — MANAGE REWARD DEFINITIONS
-- ====================================
CREATE OR REPLACE FUNCTION public.admin_upsert_reward_definition(
    p_id UUID DEFAULT NULL,
    p_name TEXT DEFAULT '',
    p_description TEXT DEFAULT '',
    p_reward_type TEXT DEFAULT 'voucher',
    p_value NUMERIC DEFAULT 0,
    p_points_cost INT DEFAULT 0,
    p_min_tier TEXT DEFAULT NULL,
    p_min_rides INT DEFAULT 0,
    p_max_redemptions INT DEFAULT 9999,
    p_is_active BOOLEAN DEFAULT true,
    p_is_featured BOOLEAN DEFAULT false,
    p_is_achievement BOOLEAN DEFAULT false,
    p_achievement_trigger TEXT DEFAULT NULL,
    p_icon TEXT DEFAULT NULL,
    p_accent_color TEXT DEFAULT '#F97316',
    p_sort_order INT DEFAULT 0,
    p_starts_at TEXT DEFAULT NULL,
    p_expires_at TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_result public.reward_definitions;
BEGIN
    IF p_id IS NOT NULL THEN
        UPDATE public.reward_definitions
        SET name = COALESCE(NULLIF(p_name, ''), name),
            description = COALESCE(p_description, description),
            reward_type = COALESCE(NULLIF(p_reward_type, ''), reward_type),
            value = COALESCE(p_value, value),
            points_cost = COALESCE(p_points_cost, points_cost),
            min_tier = p_min_tier,
            min_rides = COALESCE(p_min_rides, min_rides),
            max_redemptions = COALESCE(p_max_redemptions, max_redemptions),
            is_active = p_is_active,
            is_featured = p_is_featured,
            is_achievement = p_is_achievement,
            achievement_trigger = p_achievement_trigger,
            icon = COALESCE(p_icon, icon),
            accent_color = COALESCE(NULLIF(p_accent_color, ''), accent_color),
            sort_order = COALESCE(p_sort_order, sort_order),
            starts_at = COALESCE(p_starts_at::timestamptz, starts_at),
            expires_at = COALESCE(p_expires_at::timestamptz, expires_at),
            updated_at = NOW()
        WHERE id = p_id
        RETURNING * INTO v_result;
    ELSE
        INSERT INTO public.reward_definitions(
            name, description, reward_type, value, points_cost,
            min_tier, min_rides, max_redemptions, is_active, is_featured,
            is_achievement, achievement_trigger, icon, accent_color,
            sort_order, starts_at, expires_at
        ) VALUES (
            p_name, p_description, p_reward_type, p_value, p_points_cost,
            NULLIF(p_min_tier, ''), p_min_rides, p_max_redemptions, p_is_active, p_is_featured,
            p_is_achievement, NULLIF(p_achievement_trigger, ''), p_icon,
            p_accent_color, p_sort_order,
            p_starts_at::timestamptz, p_expires_at::timestamptz
        ) RETURNING * INTO v_result;
    END IF;

    RETURN to_jsonb(v_result);
END;
$$;

-- ====================================
-- 14. RPC: ADMIN — ADJUST REWARDS WALLET (already exists, ensure it handles all buckets)
-- ====================================
CREATE OR REPLACE FUNCTION public.admin_adjust_rewards_wallet(
    p_user_id UUID,
    p_amount NUMERIC,
    p_bucket TEXT DEFAULT 'promo_balance',
    p_reason TEXT DEFAULT 'Manual adjustment'
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_wallet public.wallets;
    v_column TEXT;
BEGIN
    -- Validate bucket column name
    IF p_bucket NOT IN ('balance', 'ride_credits', 'promo_balance', 'refund_balance') THEN
        RAISE EXCEPTION 'Invalid bucket: %', p_bucket;
    END IF;

    v_column := p_bucket;

    -- Ensure wallet exists
    INSERT INTO public.wallets(user_id, balance, ride_credits, promo_balance, refund_balance)
    VALUES (p_user_id, 0, 0, 0, 0)
    ON CONFLICT (user_id) DO NOTHING;

    -- Update the specific bucket
    EXECUTE format(
        'UPDATE public.wallets SET %I = GREATEST(0, COALESCE(%I, 0) + %L), updated_at = NOW() WHERE user_id = %L RETURNING *',
        v_column, v_column, p_amount, p_user_id
    ) INTO v_wallet;

    -- Log transaction
    INSERT INTO public.wallet_transactions(
        wallet_id, transaction_type, amount, balance_before, balance_after,
        reference_type, description, status, transaction_reference
    ) VALUES (
        v_wallet.id, 'admin_adjust', p_amount,
        GREATEST(0, COALESCE(v_wallet.balance, 0) - CASE WHEN p_bucket = 'balance' THEN p_amount ELSE 0 END),
        COALESCE(v_wallet.balance, 0),
        'admin', p_reason, 'completed',
        'admin_adj_' || EXTRACT(EPOCH FROM NOW())::BIGINT
    );

    RETURN jsonb_build_object('ok', true, 'wallet', to_jsonb(v_wallet));
END;
$$;

-- ====================================
-- 15. RPC: ADMIN — LIST ALL RIDER LOYALTY ACCOUNTS
-- ====================================
CREATE OR REPLACE FUNCTION public.admin_list_loyalty_accounts(
    p_search TEXT DEFAULT '',
    p_tier TEXT DEFAULT NULL,
    p_limit INT DEFAULT 25,
    p_offset INT DEFAULT 0
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_result JSONB;
BEGIN
    SELECT jsonb_build_object(
        'data', COALESCE(
            (SELECT jsonb_agg(t.*) FROM (
                SELECT
                    rla.*,
                    r.user_id AS rider_user_id,
                    u.full_name AS rider_name,
                    u.phone AS rider_phone,
                    u.email AS rider_email
                FROM public.rider_loyalty_accounts rla
                LEFT JOIN public.riders r ON r.id = rla.rider_id
                LEFT JOIN public.users u ON u.id = rla.user_id
                WHERE
                    (p_search = '' OR
                     u.full_name ILIKE '%' || p_search || '%' OR
                     u.phone ILIKE '%' || p_search || '%')
                    AND (p_tier IS NULL OR rla.current_tier = p_tier)
                ORDER BY rla.points DESC
                LIMIT p_limit OFFSET p_offset
            ) t),
            '[]'::jsonb
        ),
        'total', (SELECT COUNT(*) FROM public.rider_loyalty_accounts rla
            LEFT JOIN public.users u ON u.id = rla.user_id
            WHERE
                (p_search = '' OR u.full_name ILIKE '%' || p_search || '%' OR u.phone ILIKE '%' || p_search || '%')
                AND (p_tier IS NULL OR rla.current_tier = p_tier))
    ) INTO v_result;

    RETURN v_result;
END;
$$;

-- ====================================
-- 16. RPC: DRIVER MILESTONE CHECK (called after ride completion)
-- ====================================
CREATE OR REPLACE FUNCTION public.check_driver_milestones(
    p_driver_id UUID,
    p_ride_id UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_account public.driver_loyalty_accounts;
    v_driver_user_id UUID;
    v_total_rides INT;
    v_total_earnings NUMERIC;
    v_new_milestones JSONB := '[]'::jsonb;
    v_new_tier TEXT;
BEGIN
    SELECT user_id INTO v_driver_user_id FROM public.drivers WHERE id = p_driver_id;
    IF v_driver_user_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Driver not found');
    END IF;

    -- Ensure account
    INSERT INTO public.driver_loyalty_accounts(driver_id, user_id)
    VALUES (p_driver_id, v_driver_user_id)
    ON CONFLICT (driver_id) DO NOTHING;

    -- Refresh counts
    SELECT COUNT(*) INTO v_total_rides
    FROM public.rides
    WHERE driver_id = p_driver_id AND status = 'completed';

    SELECT COALESCE(SUM(actual_fare), 0) INTO v_total_earnings
    FROM public.rides
    WHERE driver_id = p_driver_id AND status = 'completed';

    UPDATE public.driver_loyalty_accounts
    SET total_rides_completed = v_total_rides,
        total_earnings = v_total_earnings,
        last_ride_at = NOW(),
        updated_at = NOW()
    WHERE driver_id = p_driver_id
    RETURNING * INTO v_account;

    -- 50 rides
    IF v_total_rides >= 50 AND NOT EXISTS (
        SELECT 1 FROM public.driver_rewards WHERE driver_id = p_driver_id AND milestone = 'rides_50'
    ) THEN
        INSERT INTO public.driver_rewards(driver_id, reward_type, reward_name, description, value, milestone, ride_id)
        VALUES (p_driver_id, 'bonus', '50 Rides Milestone', 'Completed 50 rides!', 3000, 'rides_50', p_ride_id);

        IF v_new_milestones = '[]'::jsonb THEN
            v_new_milestones := jsonb_build_array();
        END IF;
        v_new_milestones := v_new_milestones || jsonb_build_object('milestone', 'rides_50', 'bonus', 3000);
    END IF;

    -- 100 rides
    IF v_total_rides >= 100 AND NOT EXISTS (
        SELECT 1 FROM public.driver_rewards WHERE driver_id = p_driver_id AND milestone = 'rides_100'
    ) THEN
        INSERT INTO public.driver_rewards(driver_id, reward_type, reward_name, description, value, milestone, ride_id)
        VALUES (p_driver_id, 'bonus', '100 Rides Champion', 'Completed 100 rides!', 7500, 'rides_100', p_ride_id);

        v_new_milestones := v_new_milestones || jsonb_build_object('milestone', 'rides_100', 'bonus', 7500);
    END IF;

    -- Earnings milestone 100k
    IF v_total_earnings >= 100000 AND NOT EXISTS (
        SELECT 1 FROM public.driver_rewards WHERE driver_id = p_driver_id AND milestone = 'earnings_100k'
    ) THEN
        INSERT INTO public.driver_rewards(driver_id, reward_type, reward_name, description, value, milestone, ride_id)
        VALUES (p_driver_id, 'bonus', '100K Earnings', 'Earned 100,000 MK!', 5000, 'earnings_100k', p_ride_id);

        v_new_milestones := v_new_milestones || jsonb_build_object('milestone', 'earnings_100k', 'bonus', 5000);
    END IF;

    -- Determine driver tier
    IF v_total_rides >= 500 THEN v_new_tier := 'platinum';
    ELSIF v_total_rides >= 100 THEN v_new_tier := 'gold';
    ELSIF v_total_rides >= 25 THEN v_new_tier := 'silver';
    ELSE v_new_tier := 'standard';
    END IF;

    IF v_new_tier != v_account.current_tier THEN
        UPDATE public.driver_loyalty_accounts
        SET current_tier = v_new_tier, tier_achieved_at = NOW(), updated_at = NOW()
        WHERE driver_id = p_driver_id;
    END IF;

    RETURN jsonb_build_object(
        'ok', true,
        'total_rides', v_total_rides,
        'total_earnings', v_total_earnings,
        'tier', v_new_tier,
        'new_milestones', v_new_milestones
    );
END;
$$;

-- ====================================
-- 17. RPC: ADMIN — APPROVE DRIVER REWARD (pay out bonus)
-- ====================================
CREATE OR REPLACE FUNCTION public.admin_approve_driver_reward(
    p_reward_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_reward public.driver_rewards;
    v_driver public.drivers;
    v_wallet public.wallets;
    v_user_id UUID;
BEGIN
    SELECT * INTO v_reward
    FROM public.driver_rewards
    WHERE id = p_reward_id AND status = 'pending'
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Reward not found or not in pending status';
    END IF;

    SELECT * INTO v_driver FROM public.drivers WHERE id = v_reward.driver_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Driver not found';
    END IF;

    v_user_id := v_driver.user_id;

    -- Ensure driver wallet
    INSERT INTO public.wallets(user_id, balance, ride_credits, promo_balance, refund_balance)
    VALUES (v_user_id, 0, 0, 0, 0)
    ON CONFLICT (user_id) DO NOTHING;

    -- Add reward to promo_balance
    UPDATE public.wallets
    SET promo_balance = COALESCE(promo_balance, 0) + v_reward.value,
        updated_at = NOW()
    WHERE user_id = v_user_id
    RETURNING * INTO v_wallet;

    -- Log transaction
    INSERT INTO public.wallet_transactions(
        wallet_id, transaction_type, amount, balance_before, balance_after,
        reference_type, reference_id, description, status, transaction_reference
    ) VALUES (
        v_wallet.id, 'bonus', v_reward.value,
        COALESCE(v_wallet.promo_balance, 0) - v_reward.value,
        COALESCE(v_wallet.promo_balance, 0),
        'driver_reward', p_reward_id,
        'Driver reward: ' || v_reward.reward_name,
        'completed',
        'drv_reward_' || EXTRACT(EPOCH FROM NOW())::BIGINT
    );

    -- Mark reward as paid
    UPDATE public.driver_rewards
    SET status = 'paid', paid_at = NOW(), updated_at = NOW()
    WHERE id = p_reward_id;

    RETURN jsonb_build_object('ok', true, 'reward', to_jsonb(v_reward));
END;
$$;

-- ====================================
-- GRANT EXECUTE PERMISSIONS
-- ====================================
GRANT EXECUTE ON FUNCTION public.ensure_rider_loyalty_account(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.award_ride_loyalty_points(UUID, UUID, NUMERIC) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.redeem_loyalty_reward(UUID, UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.use_rider_reward(UUID, UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_upsert_reward_definition(UUID, TEXT, TEXT, TEXT, NUMERIC, INT, TEXT, INT, INT, BOOLEAN, BOOLEAN, BOOLEAN, TEXT, TEXT, TEXT, INT, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_adjust_rewards_wallet(UUID, NUMERIC, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_loyalty_accounts(TEXT, TEXT, INT, INT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_driver_milestones(UUID, UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_approve_driver_reward(UUID) TO anon, authenticated;