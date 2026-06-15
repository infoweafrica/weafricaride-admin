-- ====================================
-- WeAfrica Ride — Loyalty Notifications & Analytics
-- Production enhancements for the rewards system
-- ====================================

-- ====================================
-- 1. LOYALTY NOTIFICATIONS TABLE
-- ====================================
CREATE TABLE IF NOT EXISTS public.loyalty_notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    rider_id UUID REFERENCES public.riders(id) ON DELETE CASCADE,
    driver_id UUID REFERENCES public.drivers(id) ON DELETE CASCADE,
    notification_type TEXT NOT NULL, -- points_earned, tier_upgrade, reward_redeemed, reward_used, achievement, birthday, referral, milestone
    title TEXT NOT NULL,
    body TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    is_read BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_loyalty_notif_user ON public.loyalty_notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_loyalty_notif_rider ON public.loyalty_notifications(rider_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_loyalty_notif_unread ON public.loyalty_notifications(user_id) WHERE NOT is_read;

ALTER TABLE public.loyalty_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS anon_loyalty_notifications_all ON public.loyalty_notifications;
CREATE POLICY anon_loyalty_notifications_all ON public.loyalty_notifications
    FOR ALL USING (true) WITH CHECK (true);

-- ====================================
-- 2. ENHANCED RIDE COMPLETION RPC (combines points + notifications + driver milestones)
-- ====================================
CREATE OR REPLACE FUNCTION public.complete_ride_with_loyalty(
    p_ride_id UUID,
    p_actual_fare NUMERIC DEFAULT NULL,
    p_distance_km NUMERIC DEFAULT NULL,
    p_actual_distance_km NUMERIC DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_ride public.rides;
    v_rider_id UUID;
    v_driver_id UUID;
    v_rider_user_id UUID;
    v_driver_user_id UUID;
    v_fare NUMERIC(12,2);
    v_loyalty_result JSONB := '{}'::jsonb;
    v_driver_result JSONB := '{}'::jsonb;
    v_tier_name TEXT;
BEGIN
    -- Get ride
    SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Ride not found';
    END IF;

    v_rider_id := v_ride.rider_id;
    v_driver_id := v_ride.driver_id;
    v_fare := COALESCE(p_actual_fare, v_ride.actual_fare, v_ride.final_fare, v_ride.fare, v_ride.estimated_fare, 0);

    -- Complete the ride
    UPDATE public.rides
    SET status = 'completed',
        actual_fare = v_fare,
        distance_km = COALESCE(p_distance_km, p_actual_distance_km, distance_km),
        completed_at = NOW(),
        updated_at = NOW()
    WHERE id = p_ride_id;

    -- Get user IDs
    SELECT user_id INTO v_rider_user_id FROM public.riders WHERE id = v_rider_id;
    SELECT user_id INTO v_driver_user_id FROM public.drivers WHERE id = v_driver_id;

    -- Award loyalty points to rider
    IF v_rider_id IS NOT NULL THEN
        BEGIN
            v_loyalty_result := public.award_ride_loyalty_points(v_rider_id, p_ride_id, v_fare);

            -- Check if tier upgraded and notify
            IF v_loyalty_result->>'tier_upgraded' = 'true' THEN
                v_tier_name := v_loyalty_result->>'tier';
                -- Create notification
                INSERT INTO public.loyalty_notifications(user_id, rider_id, notification_type, title, body, metadata)
                VALUES (
                    v_rider_user_id, v_rider_id, 'tier_upgrade',
                    'Tier Upgraded! 🎉',
                    'Congratulations! You are now a ' || v_tier_name || ' tier rider and receive exclusive benefits.',
                    jsonb_build_object('tier', v_tier_name, 'ride_id', p_ride_id)
                );
            END IF;

            -- Notify about points earned
            IF (v_loyalty_result->>'points_earned')::INT > 0 THEN
                INSERT INTO public.loyalty_notifications(user_id, rider_id, notification_type, title, body, metadata)
                VALUES (
                    v_rider_user_id, v_rider_id, 'points_earned',
                    'Points Earned! ⭐',
                    'You earned ' || (v_loyalty_result->>'points_earned') || ' points for your ride.',
                    jsonb_build_object('points', (v_loyalty_result->>'points_earned')::INT, 'ride_id', p_ride_id)
                );
            END IF;
        EXCEPTION WHEN OTHERS THEN
            -- Non-critical — don't block ride completion
        END;
    END IF;

    -- Check driver milestones
    IF v_driver_id IS NOT NULL THEN
        BEGIN
            v_driver_result := public.check_driver_milestones(v_driver_id, p_ride_id);

            -- Notify about driver milestones
            IF jsonb_array_length(v_driver_result->'new_milestones') > 0 THEN
                INSERT INTO public.loyalty_notifications(user_id, driver_id, notification_type, title, body, metadata)
                VALUES (
                    v_driver_user_id, v_driver_id, 'milestone',
                    'Milestone Achieved! 🏆',
                    'You reached a new milestone! Check your rewards.',
                    jsonb_build_object('milestones', v_driver_result->'new_milestones', 'ride_id', p_ride_id)
                );
            END IF;
        EXCEPTION WHEN OTHERS THEN
            -- Non-critical
        END;
    END IF;

    RETURN jsonb_build_object(
        'ok', true,
        'ride_id', p_ride_id,
        'actual_fare', v_fare,
        'loyalty', v_loyalty_result,
        'driver_milestones', v_driver_result
    );
END;
$$;

-- ====================================
-- 3. ENHANCED REDEEM REWARD (with notifications)
-- ====================================
CREATE OR REPLACE FUNCTION public.redeem_loyalty_reward_v2(
    p_rider_id UUID,
    p_reward_definition_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_result JSONB;
    v_user_id UUID;
    v_reward_name TEXT;
BEGIN
    -- Call original redeem
    v_result := public.redeem_loyalty_reward(p_rider_id, p_reward_definition_id);

    -- Get user id for notification
    SELECT user_id INTO v_user_id FROM public.riders WHERE id = p_rider_id;

    -- Get reward name
    v_reward_name := (v_result->'reward'->>'reward_name');

    -- Create notification
    IF v_user_id IS NOT NULL AND v_result->>'ok' = 'true' THEN
        INSERT INTO public.loyalty_notifications(user_id, rider_id, notification_type, title, body, metadata)
        VALUES (
            v_user_id, p_rider_id, 'reward_redeemed',
            'Reward Redeemed! 🎁',
            'Your ' || COALESCE(v_reward_name, 'reward') || ' is ready to use.',
            jsonb_build_object('reward', v_result->'reward', 'points_remaining', v_result->'points_remaining')
        );
    END IF;

    RETURN v_result;
END;
$$;

-- ====================================
-- 4. ADMIN LOYALTY ANALYTICS RPC
-- ====================================
CREATE OR REPLACE FUNCTION public.admin_loyalty_analytics() RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_result JSONB;
BEGIN
    SELECT jsonb_build_object(
        'total_members', (SELECT COUNT(*) FROM public.rider_loyalty_accounts),
        'total_points_issued', (SELECT COALESCE(SUM(lifetime_points), 0) FROM public.rider_loyalty_accounts),
        'total_points_redeemed', (SELECT COALESCE(SUM(points_spent), 0) FROM public.rider_rewards),
        'total_rewards_redeemed', (SELECT COUNT(*) FROM public.rider_rewards WHERE status IN ('active', 'used')),
        'active_rewards_count', (SELECT COUNT(*) FROM public.rider_rewards WHERE status = 'active'),
        'used_rewards_count', (SELECT COUNT(*) FROM public.rider_rewards WHERE status = 'used'),
        'bronze_riders', (SELECT COUNT(*) FROM public.rider_loyalty_accounts WHERE current_tier = 'bronze'),
        'silver_riders', (SELECT COUNT(*) FROM public.rider_loyalty_accounts WHERE current_tier = 'silver'),
        'gold_riders', (SELECT COUNT(*) FROM public.rider_loyalty_accounts WHERE current_tier = 'gold'),
        'platinum_riders', (SELECT COUNT(*) FROM public.rider_loyalty_accounts WHERE current_tier = 'platinum'),
        'driver_rewards_pending', (SELECT COUNT(*) FROM public.driver_rewards WHERE status = 'pending'),
        'driver_rewards_approved', (SELECT COUNT(*) FROM public.driver_rewards WHERE status = 'paid'),
        'driver_bonus_total', (SELECT COALESCE(SUM(value), 0) FROM public.driver_rewards WHERE status = 'paid'),
        'top_reward', (SELECT COALESCE(to_jsonb(r), '{}'::jsonb) FROM (
            SELECT rw.reward_name, COUNT(*) as cnt
            FROM public.rider_rewards rw
            GROUP BY rw.reward_name
            ORDER BY cnt DESC LIMIT 1
        ) r),
        'points_distribution', (
            SELECT jsonb_agg(row_to_json(t)) FROM (
                SELECT current_tier, COUNT(*) as count, AVG(points)::INT as avg_points
                FROM public.rider_loyalty_accounts
                GROUP BY current_tier
                ORDER BY AVG(points) DESC
            ) t
        ),
        'recent_tier_upgrades', COALESCE((
            SELECT jsonb_agg(t.*) FROM (
                SELECT rla.current_tier, u.full_name, rla.tier_achieved_at
                FROM public.rider_loyalty_accounts rla
                JOIN public.users u ON u.id = rla.user_id
                WHERE rla.tier_achieved_at IS NOT NULL
                ORDER BY rla.tier_achieved_at DESC
                LIMIT 10
            ) t
        ), '[]'::jsonb)
    ) INTO v_result;

    RETURN v_result;
END;
$$;

-- ====================================
-- 5. GET UNREAD LOYALTY NOTIFICATIONS COUNT
-- ====================================
CREATE OR REPLACE FUNCTION public.get_loyalty_notification_count(
    p_user_id UUID DEFAULT NULL,
    p_rider_id UUID DEFAULT NULL
) RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_count INT;
BEGIN
    SELECT COUNT(*) INTO v_count
    FROM public.loyalty_notifications
    WHERE NOT is_read
      AND (p_user_id IS NULL OR user_id = p_user_id)
      AND (p_rider_id IS NULL OR rider_id = p_rider_id);

    RETURN v_count;
END;
$$;

-- ====================================
-- 6. MARK NOTIFICATION AS READ
-- ====================================
CREATE OR REPLACE FUNCTION public.mark_loyalty_notification_read(
    p_notification_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE public.loyalty_notifications
    SET is_read = true
    WHERE id = p_notification_id;

    RETURN jsonb_build_object('ok', true);
END;
$$;

-- ====================================
-- GRANT EXECUTE
-- ====================================
GRANT EXECUTE ON FUNCTION public.complete_ride_with_loyalty(UUID, NUMERIC, NUMERIC, NUMERIC) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.redeem_loyalty_reward_v2(UUID, UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_loyalty_analytics() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_loyalty_notification_count(UUID, UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_loyalty_notification_read(UUID) TO anon, authenticated;