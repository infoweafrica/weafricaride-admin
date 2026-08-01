


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';


SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."rides" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "rider_id" "uuid",
    "driver_id" "uuid",
    "pickup_address" "text",
    "dropoff_address" "text",
    "pickup_lat" double precision,
    "pickup_lng" double precision,
    "dropoff_lat" double precision,
    "dropoff_lng" double precision,
    "status" "text" DEFAULT 'pending'::"text",
    "vehicle_type" "text",
    "fare" numeric DEFAULT 0,
    "distance_km" numeric DEFAULT 0,
    "duration_min" numeric DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "actual_fare" numeric DEFAULT 0,
    "estimated_fare" numeric DEFAULT 0,
    "payment_status" "text" DEFAULT 'pending'::"text",
    "payment_method" "text",
    "completed_at" timestamp with time zone,
    "cancelled_at" timestamp with time zone,
    "city" "text",
    "driver_earnings" numeric DEFAULT 0,
    "company_commission" numeric DEFAULT 0,
    "tax_amount" numeric DEFAULT 0,
    "request_source" "text" DEFAULT 'app'::"text",
    "created_by" "uuid",
    "customer_name" "text",
    "customer_phone" "text",
    "operator_notes" "text",
    "accepted_at" timestamp with time zone,
    "arrived_at" timestamp with time zone,
    "started_at" timestamp with time zone,
    "cancellation_reason" "text",
    "cancelled_by" "text",
    "wait_started_at" timestamp with time zone,
    "paid_wait_started_at" timestamp with time zone,
    "cancel_allowed_at" timestamp with time zone,
    "waiting_fee" numeric DEFAULT 0,
    "no_show_fee" numeric DEFAULT 0,
    "vehicle_id" "uuid",
    "category_id" "uuid",
    "ride_type" "text" DEFAULT 'immediate'::"text",
    "estimated_distance_km" numeric(8,2),
    "estimated_duration_minutes" integer,
    "actual_distance_km" numeric(8,2),
    "actual_duration_minutes" integer,
    "base_fare" numeric(10,2),
    "distance_fare" numeric(10,2),
    "time_fare" numeric(10,2),
    "cancellation_fee" numeric(10,2),
    "surge_multiplier" numeric(4,2) DEFAULT 1.00,
    "commission_amount" numeric(10,2),
    "promo_code" "text",
    "promo_discount" numeric(10,2) DEFAULT 0,
    "schedule_time" timestamp with time zone,
    "requested_at" timestamp with time zone DEFAULT "now"(),
    "safety_flagged" boolean DEFAULT false,
    "safety_flag_reason" "text",
    "reviewed_by" "uuid",
    "reviewed_at" timestamp with time zone,
    "rider_pin" "text" DEFAULT "lpad"((("floor"(("random"() * (10000)::double precision)))::integer)::"text", 4, '0'::"text"),
    "final_fare" numeric(12,2),
    "destination_address" "text",
    "destination_lat" double precision,
    "destination_lng" double precision,
    "vehicle_class" "text" DEFAULT 'weafrica_x'::"text",
    "cancellation_note" "text",
    "booking_fee" numeric(10,2) DEFAULT 0,
    "rider_total_amount" numeric(10,2),
    "commission_rate" numeric(5,2) DEFAULT 15,
    "driver_net_earning" numeric(10,2),
    "paid_at" timestamp with time zone,
    "start_pin" "text",
    "driver_arrival_note" "text",
    "payment_collected_at" timestamp with time zone,
    "escrow_id" "uuid",
    "payment_provider" "text",
    "provider_reference" "text",
    "invoice_id" "uuid",
    "driver_completion_lat" numeric(10,7),
    "driver_completion_lng" numeric(10,7),
    "completion_verified" boolean DEFAULT false,
    "idempotency_key" "text"
);

ALTER TABLE ONLY "public"."rides" REPLICA IDENTITY FULL;


ALTER TABLE "public"."rides" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."accept_ride_request"("p_request_id" "uuid") RETURNS "public"."rides"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_request public.ride_requests;
  v_ride public.rides;
  v_active_count INTEGER;
BEGIN
  SELECT * INTO v_request
  FROM public.ride_requests
  WHERE id = p_request_id
    AND status = 'pending'
    AND expires_at > now()
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ride request is no longer available';
  END IF;

  SELECT COUNT(*) INTO v_active_count
  FROM public.rides
  WHERE driver_id = v_request.driver_id
    AND status IN ('accepted', 'arrived', 'in_progress');

  IF v_active_count > 0 THEN
    RAISE EXCEPTION 'Driver already has an active ride';
  END IF;

  UPDATE public.rides
  SET driver_id = v_request.driver_id,
      status = 'accepted',
      accepted_at = COALESCE(accepted_at, now()),
      updated_at = now()
  WHERE id = v_request.ride_id
    AND status IN ('requested', 'searching')
  RETURNING * INTO v_ride;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ride already accepted or unavailable';
  END IF;

  UPDATE public.ride_requests
  SET status = CASE WHEN id = p_request_id THEN 'accepted' ELSE 'expired' END,
      responded_at = now()
  WHERE ride_id = v_request.ride_id
    AND status = 'pending';

  INSERT INTO public.ride_events(ride_id, actor_id, event_type, metadata)
  VALUES (
    v_ride.id,
    v_request.driver_id,
    'driver_accepted',
    jsonb_build_object('request_id', p_request_id)
  );

  RETURN v_ride;
END;
$$;


ALTER FUNCTION "public"."accept_ride_request"("p_request_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."accept_staff_invitation"("p_token" "text", "p_user_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_invitation RECORD;
    v_admin_id UUID;
BEGIN
    SELECT * INTO v_invitation
    FROM public.staff_invitations
    WHERE invite_token = p_token
    AND status = 'pending'
    AND expires_at > NOW();

    IF v_invitation IS NULL THEN
        RETURN jsonb_build_object('error', 'Invalid or expired invitation');
    END IF;

    INSERT INTO public.admin_users (
        user_id, admin_role_id, country_id, city_id, is_active
    ) VALUES (
        p_user_id, v_invitation.admin_role_id, v_invitation.country_id, v_invitation.city_id, true
    )
    RETURNING id INTO v_admin_id;

    UPDATE public.staff_invitations
    SET status = 'accepted', accepted_by = v_admin_id, accepted_at = NOW(), updated_at = NOW()
    WHERE id = v_invitation.id;

    RETURN jsonb_build_object('admin_id', v_admin_id, 'role', v_invitation.admin_role_id);
END;
$$;


ALTER FUNCTION "public"."accept_staff_invitation"("p_token" "text", "p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."activate_queued_ride"("p_driver_id" "uuid") RETURNS "public"."rides"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
DECLARE
  v_queue public.trip_queue;
  v_ride public.rides;
BEGIN
  -- Find queued ride for this driver
  SELECT * INTO v_queue
  FROM public.trip_queue
  WHERE driver_id = p_driver_id AND status = 'queued'
  ORDER BY queued_at ASC
  LIMIT 1
  FOR UPDATE;

  IF v_queue IS NULL THEN
    RAISE EXCEPTION 'No queued ride found for this driver';
  END IF;

  -- Mark queue entry as activated
  UPDATE public.trip_queue
  SET status = 'activated', responded_at = now()
  WHERE id = v_queue.id;

  -- Activate the ride
  UPDATE public.rides
  SET
    driver_id = p_driver_id,
    status = 'accepted',
    updated_at = now()
  WHERE id = v_queue.ride_id
  RETURNING * INTO v_ride;

  -- Log event
  INSERT INTO public.ride_events (ride_id, actor_id, event_type)
  VALUES (v_ride.id, p_driver_id, 'accepted');

  RETURN v_ride;
END;
$$;


ALTER FUNCTION "public"."activate_queued_ride"("p_driver_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_adjust_rewards_wallet"("p_user_id" "uuid", "p_amount" numeric, "p_bucket" "text" DEFAULT 'promo_balance'::"text", "p_reason" "text" DEFAULT 'Manual adjustment'::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."admin_adjust_rewards_wallet"("p_user_id" "uuid", "p_amount" numeric, "p_bucket" "text", "p_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_approve_driver"("p_driver_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_status TEXT;
BEGIN
  SELECT approval_status INTO v_status
  FROM drivers
  WHERE id = p_driver_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Driver not found');
  END IF;

  -- Stage 1: pending_verification → approve identity
  IF v_status = 'pending_verification' THEN
    UPDATE drivers
    SET approval_status = 'approved_driver',
        documents_verified = true,
        identity_verified_at = NOW(),
        rejection_reason = NULL,
        updated_at = NOW()
    WHERE id = p_driver_id;
    RETURN jsonb_build_object('success', true, 'stage', 'identity_approved');
  END IF;

  -- Stage 1 → old-style: 'pending' (legacy)
  IF v_status = 'pending' THEN
    UPDATE drivers
    SET approval_status = 'approved_driver',
        documents_verified = true,
        identity_verified_at = NOW(),
        rejection_reason = NULL,
        updated_at = NOW()
    WHERE id = p_driver_id;
    RETURN jsonb_build_object('success', true, 'stage', 'identity_approved');
  END IF;

  -- Stage 2: pending_vehicle_review → fully approved
  IF v_status = 'pending_vehicle_review' THEN
    UPDATE drivers
    SET approval_status = 'approved',
        vehicle_verified = true,
        can_go_online = true,
        rejection_reason = NULL,
        updated_at = NOW()
    WHERE id = p_driver_id;
    RETURN jsonb_build_object('success', true, 'stage', 'fully_approved');
  END IF;

  -- Already approved
  IF v_status IN ('approved', 'approved_driver') THEN
    RETURN jsonb_build_object('success', true, 'stage', 'already_approved');
  END IF;

  -- Unknown status
  RETURN jsonb_build_object(
    'success', false,
    'error', 'Driver cannot be approved: status is ' || COALESCE(v_status, 'unknown')
  );
END;
$$;


ALTER FUNCTION "public"."admin_approve_driver"("p_driver_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_approve_driver_reward"("p_reward_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."admin_approve_driver_reward"("p_reward_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_approve_payout_full"("p_request_id" "uuid", "p_admin_notes" "text" DEFAULT NULL::"text", "p_admin_id" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_old_status TEXT;
BEGIN
    SELECT status INTO v_old_status FROM driver_payout_requests WHERE id = p_request_id;

    UPDATE driver_payout_requests SET
        status = 'approved',
        approved_by = p_admin_id,
        approved_at = NOW(),
        updated_at = NOW()
    WHERE id = p_request_id;

    INSERT INTO admin_payout_actions (payout_request_id, action, old_status, new_status, admin_notes, processed_by)
    VALUES (p_request_id, 'approve', v_old_status, 'approved', p_admin_notes, p_admin_id);

    INSERT INTO payout_audit_logs (payout_request_id, action, old_status, new_status, changed_by, notes)
    VALUES (p_request_id, 'approve_payout', v_old_status, 'approved', p_admin_id, p_admin_notes);

    RETURN jsonb_build_object('success', true);
END;
$$;


ALTER FUNCTION "public"."admin_approve_payout_full"("p_request_id" "uuid", "p_admin_notes" "text", "p_admin_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_approve_refund_full"("p_refund_id" "uuid", "p_decision" "text" DEFAULT 'full_refund'::"text", "p_partial_amount" numeric DEFAULT 0, "p_penalty_amount" numeric DEFAULT 0, "p_penalty_target" "text" DEFAULT NULL::"text", "p_hold_payout" boolean DEFAULT false, "p_admin_notes" "text" DEFAULT NULL::"text", "p_admin_id" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_old_status TEXT;
    v_amount DECIMAL(12,2);
BEGIN
    SELECT status, amount INTO v_old_status, v_amount FROM refunds WHERE id = p_refund_id;

    UPDATE refunds SET
        status = CASE 
            WHEN p_decision = 'no_refund' THEN 'rejected'
            WHEN p_decision IN ('full_refund','partial_refund','refund_and_penalize','company_absorb') THEN 'approved'
            WHEN p_decision = 'hold_payout' THEN 'processing'
            ELSE 'approved'
        END,
        decision = p_decision,
        partial_amount = CASE WHEN p_decision = 'partial_refund' THEN p_partial_amount ELSE 0 END,
        penalty_amount = p_penalty_amount,
        penalty_target = p_penalty_target,
        hold_payout = p_hold_payout,
        admin_notes = COALESCE(p_admin_notes, admin_notes),
        processed_at = NOW(),
        updated_at = NOW()
    WHERE id = p_refund_id;

    INSERT INTO refund_actions (refund_id, action_type, decision, partial_amount, penalty_amount, penalty_target, hold_driver_payout, admin_notes, processed_by)
    VALUES (p_refund_id, 'approved', p_decision, p_partial_amount, p_penalty_amount, p_penalty_target, p_hold_payout, p_admin_notes, p_admin_id);

    INSERT INTO refund_audit_logs (refund_id, action, old_status, new_status, changed_by, notes)
    VALUES (p_refund_id, 'approve_refund', v_old_status, 
        CASE WHEN p_decision = 'no_refund' THEN 'rejected' ELSE 'approved' END,
        p_admin_id, p_admin_notes);

    IF p_penalty_amount > 0 AND p_penalty_target = 'driver' THEN
        INSERT INTO driver_penalties (driver_id, ride_id, refund_id, amount, reason, status)
        SELECT r.driver_id, r.ride_id, r.id, p_penalty_amount, 'Refund penalty: ' || COALESCE(p_admin_notes,''), 'applied'
        FROM refunds r WHERE r.id = p_refund_id;
    END IF;

    IF p_hold_payout THEN
        UPDATE driver_payouts SET is_held = true, hold_reason = 'Refund investigation', updated_at = NOW()
        WHERE ride_id = (SELECT ride_id FROM refunds WHERE id = p_refund_id);
    END IF;

    IF p_decision IN ('full_refund','partial_refund','refund_and_penalize','company_absorb') THEN
        UPDATE payments SET
            payment_status = 'refunded',
            refund_amount = CASE WHEN p_decision = 'partial_refund' THEN p_partial_amount ELSE v_amount END,
            refunded_at = NOW()
        WHERE id = (SELECT payment_id FROM refunds WHERE id = p_refund_id);
    END IF;

    RETURN jsonb_build_object('success', true, 'refund_id', p_refund_id, 'decision', p_decision);
END;
$$;


ALTER FUNCTION "public"."admin_approve_refund_full"("p_refund_id" "uuid", "p_decision" "text", "p_partial_amount" numeric, "p_penalty_amount" numeric, "p_penalty_target" "text", "p_hold_payout" boolean, "p_admin_notes" "text", "p_admin_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_cancel_refund"("p_refund_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN

    UPDATE refunds
    SET
        status='cancelled',
        processed_at=NOW()
    WHERE id=p_refund_id;

    RETURN jsonb_build_object(
        'success', true,
        'refund_id', p_refund_id
    );

END;
$$;


ALTER FUNCTION "public"."admin_cancel_refund"("p_refund_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_create_city"("p_name" "text", "p_region" "text" DEFAULT NULL::"text", "p_country_id" "uuid" DEFAULT NULL::"uuid", "p_is_active" boolean DEFAULT true) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO cities (name, region, country_id, is_active)
  VALUES (p_name, p_region, p_country_id, p_is_active)
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('success', true, 'id', v_id);
END;
$$;


ALTER FUNCTION "public"."admin_create_city"("p_name" "text", "p_region" "text", "p_country_id" "uuid", "p_is_active" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_create_dispute_from_refund"("p_refund_id" "uuid", "p_dispute_type" "text" DEFAULT 'fare'::"text", "p_priority" "text" DEFAULT 'medium'::"text", "p_admin_id" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_dispute_id UUID;
    v_dispute_number TEXT;
    v_refund RECORD;
BEGIN
    SELECT * INTO v_refund FROM refunds WHERE id = p_refund_id;
    v_dispute_number := 'DSP-' || to_char(NOW(), 'YYMMDD') || '-' || substr(md5(random()::text), 1, 6);
    INSERT INTO ride_disputes (dispute_number, ride_id, opened_by, dispute_type, priority, status,
        rider_id, driver_id, city, description, ride_fare, ride_payment_method, refund_amount)
    VALUES (v_dispute_number, v_refund.ride_id, 'rider', p_dispute_type, p_priority, 'open',
        v_refund.rider_id, v_refund.driver_id, v_refund.city, COALESCE(v_refund.reason, 'Refund escalated to dispute'),
        COALESCE(v_refund.amount, 0), v_refund.payment_method, v_refund.amount)
    RETURNING id INTO v_dispute_id;
    UPDATE refunds SET status = 'escalated', updated_at = NOW() WHERE id = p_refund_id;
    INSERT INTO refund_audit_logs (refund_id, action, old_status, new_status, changed_by, notes)
    VALUES (p_refund_id, 'escalate_to_dispute', 'pending', 'escalated', p_admin_id, 'Dispute created: ' || v_dispute_number);
    RETURN jsonb_build_object('success', true, 'dispute_id', v_dispute_id, 'dispute_number', v_dispute_number);
END;
$$;


ALTER FUNCTION "public"."admin_create_dispute_from_refund"("p_refund_id" "uuid", "p_dispute_type" "text", "p_priority" "text", "p_admin_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_create_incident"("p_type" "text", "p_severity" "text", "p_city" "text" DEFAULT NULL::"text", "p_description" "text" DEFAULT NULL::"text", "p_ride_id" "uuid" DEFAULT NULL::"uuid", "p_rider_id" "uuid" DEFAULT NULL::"uuid", "p_driver_id" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE v_id UUID;
BEGIN
    INSERT INTO safety_incidents (incident_type, severity, status, city, description, ride_id, rider_id, driver_id)
    VALUES (p_type, p_severity, 'open', p_city, p_description, p_ride_id, p_rider_id, p_driver_id)
    RETURNING id INTO v_id;
    INSERT INTO incident_timeline (incident_id, event_type, new_status, notes) VALUES (v_id, 'created', 'open', 'Incident created');
    RETURN jsonb_build_object('success', true, 'id', v_id);
END; $$;


ALTER FUNCTION "public"."admin_create_incident"("p_type" "text", "p_severity" "text", "p_city" "text", "p_description" "text", "p_ride_id" "uuid", "p_rider_id" "uuid", "p_driver_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_create_manual_payout"("p_driver_id" "uuid", "p_amount" numeric, "p_method" "text" DEFAULT 'wallet'::"text", "p_admin_notes" "text" DEFAULT NULL::"text", "p_admin_id" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_request_id UUID;
    v_wallet_id UUID;
BEGIN
    SELECT id INTO v_wallet_id FROM driver_wallets WHERE driver_id = p_driver_id;

    INSERT INTO driver_payout_requests (driver_id, wallet_id, amount, net_amount, payout_method, status, notes)
    VALUES (p_driver_id, v_wallet_id, p_amount, p_amount, p_method, 'approved', COALESCE(p_admin_notes, 'Manual payout by admin'))
    RETURNING id INTO v_request_id;

    INSERT INTO payout_audit_logs (payout_request_id, action, old_status, new_status, changed_by, notes)
    VALUES (v_request_id, 'create_manual', NULL, 'approved', p_admin_id, p_admin_notes);

    RETURN jsonb_build_object('success', true, 'request_id', v_request_id);
END;
$$;


ALTER FUNCTION "public"."admin_create_manual_payout"("p_driver_id" "uuid", "p_amount" numeric, "p_method" "text", "p_admin_notes" "text", "p_admin_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_create_payout_batch"("p_method" "text" DEFAULT NULL::"text", "p_admin_id" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_batch_id UUID;
    v_batch_number TEXT;
    v_total DECIMAL(12,2);
    v_count INT;
BEGIN
    v_batch_number := 'BAT-' || to_char(NOW(), 'YYMMDD') || '-' || substr(md5(random()::text), 1, 6);

    -- Calculate total from pending approved requests
    SELECT COALESCE(SUM(net_amount),0), COUNT(*) INTO v_total, v_count
    FROM driver_payout_requests WHERE status = 'approved' AND batch_id IS NULL
    AND (p_method IS NULL OR payout_method = p_method);

    INSERT INTO payout_batches (batch_number, status, total_amount, total_drivers, payout_method, created_by)
    VALUES (v_batch_number, 'pending', v_total, v_count, p_method, p_admin_id)
    RETURNING id INTO v_batch_id;

    -- Link approved requests to batch
    UPDATE driver_payout_requests SET batch_id = v_batch_id, status = 'processing', updated_at = NOW()
    WHERE status = 'approved' AND batch_id IS NULL
    AND (p_method IS NULL OR payout_method = p_method);

    RETURN jsonb_build_object('success', true, 'batch_id', v_batch_id, 'batch_number', v_batch_number, 'total_amount', v_total, 'total_drivers', v_count);
END;
$$;


ALTER FUNCTION "public"."admin_create_payout_batch"("p_method" "text", "p_admin_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_create_refund"("p_payment_id" "uuid", "p_reason" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_refund_id UUID;
    v_amount NUMERIC;
BEGIN

    SELECT amount
    INTO v_amount
    FROM payments
    WHERE id = p_payment_id;

    INSERT INTO refunds (
        payment_id,
        amount,
        reason,
        status,
        created_at
    )
    VALUES (
        p_payment_id,
        COALESCE(v_amount,0),
        p_reason,
        'pending',
        NOW()
    )
    RETURNING id INTO v_refund_id;

    RETURN jsonb_build_object(
        'success', true,
        'refund_id', v_refund_id
    );

END;
$$;


ALTER FUNCTION "public"."admin_create_refund"("p_payment_id" "uuid", "p_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_daily_revenue"("p_days" integer DEFAULT 7) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_result JSONB;
BEGIN
    WITH day_series AS (
        SELECT generate_series(
            NOW()::date - (p_days - 1) * INTERVAL '1 day',
            NOW()::date,
            INTERVAL '1 day'
        )::date AS day
    ),
    revenue_by_day AS (
        SELECT
            ds.day,
            COALESCE(SUM(p.amount), 0) AS revenue,
            COUNT(p.id) AS tx_count
        FROM day_series ds
        LEFT JOIN payments p ON p.created_at::date = ds.day AND p.payment_status = 'completed'
        GROUP BY ds.day
        ORDER BY ds.day
    )
    SELECT jsonb_agg(jsonb_build_object(
        'day', to_char(day, 'Dy'),
        'date', day,
        'revenue', revenue,
        'tx_count', tx_count
    ))
    INTO v_result
    FROM revenue_by_day;

    RETURN jsonb_build_object('data', COALESCE(v_result, '[]'::jsonb));
END;
$$;


ALTER FUNCTION "public"."admin_daily_revenue"("p_days" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_delete_city"("p_city_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  DELETE FROM cities WHERE id = p_city_id;
  RETURN jsonb_build_object('success', true);
END;
$$;


ALTER FUNCTION "public"."admin_delete_city"("p_city_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_delete_driver"("p_driver_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_user_id UUID;
  v_vehicle_id UUID;
BEGIN
  -- Get linked records
  SELECT user_id, vehicle_id INTO v_user_id, v_vehicle_id
  FROM drivers WHERE id = p_driver_id;

  -- Remove from driver_locations (realtime map)
  DELETE FROM driver_locations WHERE driver_id = p_driver_id;

  -- Remove driver_wallets
  DELETE FROM driver_wallets WHERE driver_id = p_driver_id;

  -- Remove driver_settings
  DELETE FROM driver_settings WHERE driver_id = p_driver_id;

  -- Remove driver_performance
  DELETE FROM driver_performance WHERE driver_id = p_driver_id;

  -- Remove driver_mission_progress
  DELETE FROM driver_mission_progress WHERE driver_id = p_driver_id;

  -- Remove driver_achievement_unlocks
  DELETE FROM driver_achievement_unlocks WHERE driver_id = p_driver_id;

  -- Remove driver_safety_contacts
  DELETE FROM driver_safety_contacts WHERE driver_id = p_driver_id;

  -- Remove driver_transactions
  DELETE FROM driver_transactions WHERE driver_id = p_driver_id;

  -- Remove rides assigned to this driver (only non-completed)
  DELETE FROM rides WHERE driver_id = p_driver_id AND status NOT IN ('completed');

  -- Remove vehicle
  IF v_vehicle_id IS NOT NULL THEN
    DELETE FROM vehicles WHERE id = v_vehicle_id;
  END IF;

  -- Remove driver
  DELETE FROM drivers WHERE id = p_driver_id;

  -- Remove user account
  IF v_user_id IS NOT NULL THEN
    DELETE FROM users WHERE id = v_user_id;
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;


ALTER FUNCTION "public"."admin_delete_driver"("p_driver_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_delete_driver_incentive"("p_incentive_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
    DELETE FROM pricing_driver_incentives WHERE id = p_incentive_id;
    RETURN jsonb_build_object('success', true);
END;
$$;


ALTER FUNCTION "public"."admin_delete_driver_incentive"("p_incentive_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_delete_surge_rule"("p_rule_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
    DELETE FROM pricing_surge_rules WHERE id = p_rule_id;
    RETURN jsonb_build_object('success', true);
END;
$$;


ALTER FUNCTION "public"."admin_delete_surge_rule"("p_rule_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_driver_stats"("p_city_id" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_totalDrivers INT;
  v_activeDrivers INT;
  v_pendingCount INT;
  v_approvedCount INT;
  v_rejectedCount INT;
  v_onTripCount INT;
  v_topByRating JSONB;
  v_topByEarnings JSONB;
BEGIN
  SELECT COUNT(*) INTO v_totalDrivers FROM drivers
    WHERE p_city_id IS NULL OR city_id = p_city_id;

  SELECT COUNT(*) INTO v_activeDrivers FROM driver_locations dl
    JOIN drivers d2 ON d2.id = dl.driver_id
    WHERE dl.is_online = true AND (p_city_id IS NULL OR d2.city_id = p_city_id);

  -- Count ALL pending statuses (both stages)
  SELECT COUNT(*) INTO v_pendingCount FROM drivers
    WHERE approval_status IN ('pending', 'pending_verification', 'pending_vehicle_review');

  SELECT COUNT(*) INTO v_approvedCount FROM drivers
    WHERE approval_status IN ('approved', 'approved_driver');

  SELECT COUNT(*) INTO v_rejectedCount FROM drivers
    WHERE approval_status = 'rejected';

  SELECT COUNT(*) INTO v_onTripCount FROM rides
    WHERE status IN ('driver_accepted', 'driver_arrived', 'in_progress');

  SELECT jsonb_agg(row_to_json(d.*))
  INTO v_topByRating
  FROM (
    SELECT d.*,
      to_jsonb(u) AS "user",
      to_jsonb(v) AS vehicle
    FROM drivers d
    LEFT JOIN users u ON d.user_id = u.id
    LEFT JOIN vehicles v ON d.vehicle_id = v.id
    WHERE d.approval_status IN ('approved', 'approved_driver')
    ORDER BY d.rating DESC
    LIMIT 10
  ) d;

  SELECT jsonb_agg(row_to_json(d.*))
  INTO v_topByEarnings
  FROM (
    SELECT d.*,
      to_jsonb(u) AS "user",
      to_jsonb(v) AS vehicle
    FROM drivers d
    LEFT JOIN users u ON d.user_id = u.id
    LEFT JOIN vehicles v ON d.vehicle_id = v.id
    WHERE d.approval_status IN ('approved', 'approved_driver')
    ORDER BY d.total_earnings DESC
    LIMIT 10
  ) d;

  RETURN jsonb_build_object(
    'totalDrivers', COALESCE(v_totalDrivers, 0),
    'activeDrivers', COALESCE(v_activeDrivers, 0),
    'onTripCount', COALESCE(v_onTripCount, 0),
    'pendingCount', COALESCE(v_pendingCount, 0),
    'approvedCount', COALESCE(v_approvedCount, 0),
    'rejectedCount', COALESCE(v_rejectedCount, 0),
    'topByRating', COALESCE(v_topByRating, '[]'::jsonb),
    'topByEarnings', COALESCE(v_topByEarnings, '[]'::jsonb)
  );
END;
$$;


ALTER FUNCTION "public"."admin_driver_stats"("p_city_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_emergency_stats"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_active INT; v_responding INT; v_resolved_today INT; v_avg_response_seconds INT;
BEGIN
    SELECT COUNT(*) INTO v_active FROM emergency_alerts WHERE status = 'active';
    SELECT COUNT(*) INTO v_responding FROM emergency_alerts WHERE status = 'responding';
    SELECT COUNT(*) INTO v_resolved_today FROM emergency_alerts WHERE status IN ('resolved','false_alarm') AND resolved_at >= NOW()::date;
    SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (responded_at - created_at)))::INT, 0)
    INTO v_avg_response_seconds FROM emergency_alerts WHERE status IN ('responding','resolved','false_alarm') AND responded_at IS NOT NULL;
    RETURN jsonb_build_object(
        'active', v_active, 'responding', v_responding,
        'resolved_today', v_resolved_today, 'avg_response_seconds', v_avg_response_seconds
    );
END;
$$;


ALTER FUNCTION "public"."admin_emergency_stats"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_estimate_fare"("p_pickup_lat" double precision, "p_pickup_lng" double precision, "p_dropoff_lat" double precision, "p_dropoff_lng" double precision, "p_category_id" "uuid") RETURNS numeric
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_vehicle_type text;
  v_base numeric;
  v_per_km numeric;
  v_minimum numeric;
  v_distance numeric;
  v_fare numeric;
BEGIN
  -- Resolve UUID -> vehicle type
  SELECT slug
  INTO v_vehicle_type
  FROM public.ride_categories
  WHERE id = p_category_id;

  IF v_vehicle_type IS NULL THEN
    RAISE EXCEPTION 'Invalid ride category: %', p_category_id;
  END IF;

  -- Load pricing config
  SELECT
    base_fare,
    per_km,
    minimum_fare
  INTO
    v_base,
    v_per_km,
    v_minimum
  FROM public.pricing_config
  WHERE vehicle_type = v_vehicle_type
    AND is_active = true
  LIMIT 1;

  IF v_base IS NULL THEN
    RAISE EXCEPTION 'No pricing config found for vehicle type: %', v_vehicle_type;
  END IF;

  -- Calculate distance
  v_distance :=
    6371 * acos(
      cos(radians(p_pickup_lat))
      * cos(radians(p_dropoff_lat))
      * cos(radians(p_dropoff_lng) - radians(p_pickup_lng))
      + sin(radians(p_pickup_lat))
      * sin(radians(p_dropoff_lat))
    );

  -- Calculate fare
  v_fare := v_base + (v_distance * v_per_km);

  -- Apply minimum fare
  RETURN GREATEST(v_minimum, ROUND(v_fare, 0));
END;
$$;


ALTER FUNCTION "public"."admin_estimate_fare"("p_pickup_lat" double precision, "p_pickup_lng" double precision, "p_dropoff_lat" double precision, "p_dropoff_lng" double precision, "p_category_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_estimate_fare"("p_pickup_lat" double precision, "p_pickup_lng" double precision, "p_dropoff_lat" double precision, "p_dropoff_lng" double precision, "p_category_id" "uuid", "p_city" "text" DEFAULT NULL::"text") RETURNS double precision
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    AS $$
DECLARE
  v_vehicle_slug text;
  v_city text;
  v_base_fare double precision;
  v_per_km double precision;
  v_per_minute double precision;
  v_minimum_fare double precision;
  v_distance_km double precision;
  v_time_minutes integer;
  v_fare double precision;
  v_city_id uuid;
  v_pricing record;
BEGIN
  -- 1. Look up category slug from ride_categories
  SELECT slug INTO v_vehicle_slug
  FROM public.ride_categories
  WHERE id = p_category_id AND is_active = true;
  
  IF v_vehicle_slug IS NULL THEN
    RAISE EXCEPTION 'Category not found or inactive: %', p_category_id;
  END IF;

  -- 2. Resolve city: use provided p_city or geolocate from pickup
  v_city := p_city;
  IF v_city IS NULL OR v_city = '' THEN
    v_city := public.find_nearest_city(p_pickup_lat, p_pickup_lng);
  END IF;
  
  IF v_city IS NULL THEN
    RAISE EXCEPTION 'Cannot determine city for coordinates: %, %', p_pickup_lat, p_pickup_lng;
  END IF;

  -- 3. First attempt: lookup from service_zones with city-specific pricing
  SELECT
    (sz.pricing_rules->>'base_fare')::double precision,
    (sz.pricing_rules->>'per_km')::double precision,
    (sz.pricing_rules->>'per_minute')::double precision,
    (sz.pricing_rules->>'minimum_fare')::double precision
  INTO v_base_fare, v_per_km, v_per_minute, v_minimum_fare
  FROM public.service_zones sz
  WHERE sz.city = v_city
    AND sz.zone_type = 'operating'
    AND sz.status = 'active'
  LIMIT 1;

  -- 4. Second attempt: pricing_rules table (by city_id + category_id)
  IF v_base_fare IS NULL THEN
    SELECT c.id INTO v_city_id
    FROM public.cities c
    WHERE LOWER(c.name) = LOWER(v_city)
      AND c.is_active = true
    LIMIT 1;

    IF v_city_id IS NOT NULL THEN
      SELECT
        pr.base_fare::double precision,
        pr.price_per_km::double precision,
        pr.price_per_minute::double precision,
        pr.minimum_fare::double precision
      INTO v_base_fare, v_per_km, v_per_minute, v_minimum_fare
      FROM public.pricing_rules pr
      WHERE pr.city_id = v_city_id
        AND pr.category_id = p_category_id
        AND pr.is_active = true
      LIMIT 1;

      -- Fallback: match by category only, any city in that country (less specific but still filtered)
      IF v_base_fare IS NULL THEN
        SELECT
          pr.base_fare::double precision,
          pr.price_per_km::double precision,
          pr.price_per_minute::double precision,
          pr.minimum_fare::double precision
        INTO v_base_fare, v_per_km, v_per_minute, v_minimum_fare
        FROM public.pricing_rules pr
        WHERE pr.category_id = p_category_id
          AND pr.is_active = true
          AND pr.city_id IS NULL
        LIMIT 1;
      END IF;
    END IF;
  END IF;

  -- 5. Absolute fallback: first active pricing_rules for this category (any city)
  IF v_base_fare IS NULL THEN
    SELECT
      pr.base_fare::double precision,
      pr.price_per_km::double precision,
      pr.price_per_minute::double precision,
      pr.minimum_fare::double precision
    INTO v_base_fare, v_per_km, v_per_minute, v_minimum_fare
    FROM public.pricing_rules pr
    WHERE pr.category_id = p_category_id
      AND pr.is_active = true
    ORDER BY pr.created_at DESC
    LIMIT 1;
  END IF;

  -- 6. Final fallback: hardcoded defaults per category (Malawi MWK)
  IF v_base_fare IS NULL THEN
    v_base_fare := CASE v_vehicle_slug
      WHEN 'economy' THEN 500.00
      WHEN 'comfort' THEN 800.00
      WHEN 'xl' THEN 1200.00
      WHEN 'boda' THEN 300.00
      WHEN 'delivery' THEN 600.00
      ELSE 500.00
    END;
    v_per_km := CASE v_vehicle_slug
      WHEN 'economy' THEN 300.00
      WHEN 'comfort' THEN 450.00
      WHEN 'xl' THEN 600.00
      WHEN 'boda' THEN 200.00
      WHEN 'delivery' THEN 350.00
      ELSE 300.00
    END;
    v_per_minute := 50.00;
    v_minimum_fare := CASE v_vehicle_slug
      WHEN 'economy' THEN 800.00
      WHEN 'comfort' THEN 1200.00
      WHEN 'xl' THEN 1800.00
      WHEN 'boda' THEN 500.00
      WHEN 'delivery' THEN 900.00
      ELSE 800.00
    END;
  END IF;

  -- 7. Calculate distance (haversine)
  v_distance_km := 6371 * 2 * asin(sqrt(
    power(sin(radians(p_dropoff_lat - p_pickup_lat) / 2), 2) +
    cos(radians(p_pickup_lat)) * cos(radians(p_dropoff_lat)) *
    power(sin(radians(p_dropoff_lng - p_pickup_lng) / 2), 2)
  ));

  -- 8. Estimate time (28 km/h average urban speed with 5 min minimum)
  v_time_minutes := GREATEST(5, (v_distance_km / 28.0 * 60)::integer);

  -- 9. Calculate fare: base + distance + time, capped at minimum
  v_fare := v_base_fare + (v_per_km * v_distance_km) + (v_per_minute * v_time_minutes);
  v_fare := GREATEST(v_fare, v_minimum_fare);

  -- 10. Round to nearest integer (Malawi Kwacha has no subunits)
  RETURN round(v_fare);
END;
$$;


ALTER FUNCTION "public"."admin_estimate_fare"("p_pickup_lat" double precision, "p_pickup_lng" double precision, "p_dropoff_lat" double precision, "p_dropoff_lng" double precision, "p_category_id" "uuid", "p_city" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_finance_stats"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_total_payments DECIMAL(12,2);
    v_total_refunded DECIMAL(12,2);
    v_pending_refunds INT;
    v_failed_refunds INT;
    v_approved_refunds INT;
    v_rejected_refunds INT;
    v_driver_penalties DECIMAL(12,2);
    v_refund_success_rate DECIMAL(5,2);
    v_total_refunds INT;
    v_successful_refunds INT;
BEGIN
    SELECT COALESCE(SUM(amount), 0) INTO v_total_payments FROM payments WHERE payment_status = 'completed';
    SELECT COALESCE(SUM(amount), 0) INTO v_total_refunded FROM refunds WHERE status = 'refunded';
    SELECT COUNT(*) INTO v_pending_refunds FROM refunds WHERE status = 'pending';
    SELECT COUNT(*) INTO v_failed_refunds FROM refunds WHERE status = 'failed';
    SELECT COUNT(*) INTO v_approved_refunds FROM refunds WHERE status = 'approved';
    SELECT COUNT(*) INTO v_rejected_refunds FROM refunds WHERE status = 'rejected';
    SELECT COALESCE(SUM(amount), 0) INTO v_driver_penalties FROM driver_penalties WHERE status = 'applied';
    SELECT COUNT(*) INTO v_total_refunds FROM refunds WHERE status IN ('refunded','failed','approved','rejected');
    SELECT COUNT(*) INTO v_successful_refunds FROM refunds WHERE status = 'refunded';
    IF v_total_refunds > 0 THEN
        v_refund_success_rate := ROUND((v_successful_refunds::DECIMAL / v_total_refunds::DECIMAL) * 100, 1);
    ELSE
        v_refund_success_rate := 100;
    END IF;
    RETURN jsonb_build_object(
        'total_payments', v_total_payments,
        'total_refunded', v_total_refunded,
        'pending_refunds', v_pending_refunds,
        'failed_refunds', v_failed_refunds,
        'approved_refunds', v_approved_refunds,
        'rejected_refunds', v_rejected_refunds,
        'driver_penalties', v_driver_penalties,
        'refund_success_rate', v_refund_success_rate
    );
END;
$$;


ALTER FUNCTION "public"."admin_finance_stats"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_finance_summary_full"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_total_revenue NUMERIC(12,2);
    v_net_revenue NUMERIC(12,2);
    v_company_commission NUMERIC(12,2);
    v_booking_fees NUMERIC(12,2);
    v_driver_earnings NUMERIC(12,2);
    v_total_refunds NUMERIC(12,2);
    v_pending_payouts NUMERIC(12,2);
    v_successful_tx INTEGER;
    v_failed_tx INTEGER;
    v_cash_payments NUMERIC(12,2);
    v_mobile_money NUMERIC(12,2);
    v_card_payments NUMERIC(12,2);
    v_wallet_tx NUMERIC(12,2);
    v_escrow_held NUMERIC(12,2);
    v_escrow_released NUMERIC(12,2);
    v_active_escrows INTEGER;
    v_active_rides INTEGER;
    v_active_drivers INTEGER;
    v_active_passengers INTEGER;
BEGIN
    -- Commission
    SELECT COALESCE(SUM(amount), 0) INTO v_company_commission
    FROM public.company_transactions
    WHERE transaction_type = 'commission_earning';

    -- Booking fees
    SELECT COALESCE(SUM(amount), 0) INTO v_booking_fees
    FROM public.company_transactions
    WHERE transaction_type = 'booking_fee';

    -- Total revenue
    v_total_revenue := COALESCE(v_company_commission, 0) + COALESCE(v_booking_fees, 0);
    v_net_revenue := v_total_revenue;

    -- Driver earnings
    SELECT COALESCE(SUM(amount), 0) INTO v_driver_earnings
    FROM public.driver_transactions
    WHERE transaction_type = 'ride_earning' AND status = 'completed';

    -- Refunds
    SELECT COALESCE(SUM(amount), 0) INTO v_total_refunds
    FROM public.payments
    WHERE payment_status IN ('refunded', 'partially_refunded');

    -- Pending payouts
    SELECT COALESCE(SUM(amount), 0) INTO v_pending_payouts
    FROM public.driver_transactions
    WHERE transaction_type = 'withdrawal' AND status = 'pending';

    -- Transaction counts
    SELECT COUNT(*) INTO v_successful_tx FROM public.payments WHERE payment_status = 'completed';
    SELECT COUNT(*) INTO v_failed_tx FROM public.payments WHERE payment_status IN ('failed', 'error');

    -- Payment method breakdown
    SELECT COALESCE(SUM(amount), 0) INTO v_cash_payments FROM public.payments WHERE payment_method = 'cash' AND payment_status = 'completed';
    SELECT COALESCE(SUM(amount), 0) INTO v_mobile_money FROM public.payments WHERE payment_method IN ('airtel_money', 'tnm_mpamba') AND payment_status = 'completed';
    SELECT COALESCE(SUM(amount), 0) INTO v_card_payments FROM public.payments WHERE payment_method = 'card' AND payment_status = 'completed';
    SELECT COALESCE(SUM(amount), 0) INTO v_wallet_tx FROM public.payments WHERE payment_method = 'wallet' AND payment_status = 'completed';

    -- Escrow
    SELECT
        COALESCE(SUM(amount) FILTER (WHERE escrow_status = 'held'), 0),
        COALESCE(SUM(amount) FILTER (WHERE escrow_status = 'released'), 0),
        COUNT(*) FILTER (WHERE escrow_status = 'held')
    INTO v_escrow_held, v_escrow_released, v_active_escrows
    FROM public.platform_escrow;

    -- Active operations
    SELECT COUNT(*) INTO v_active_rides FROM public.rides WHERE status IN ('requested', 'searching', 'accepted', 'arrived', 'in_progress');
    SELECT COUNT(*) INTO v_active_drivers FROM public.drivers WHERE is_online = true;
    SELECT COUNT(*) INTO v_active_passengers FROM public.rides WHERE status IN ('requested', 'searching', 'accepted', 'arrived', 'in_progress');

    RETURN jsonb_build_object(
        'total_revenue', COALESCE(v_total_revenue, 0),
        'net_revenue', COALESCE(v_net_revenue, 0),
        'company_commission', COALESCE(v_company_commission, 0),
        'booking_fees', COALESCE(v_booking_fees, 0),
        'driver_earnings', COALESCE(v_driver_earnings, 0),
        'total_refunds', COALESCE(v_total_refunds, 0),
        'pending_payouts', COALESCE(v_pending_payouts, 0),
        'successful_tx', COALESCE(v_successful_tx, 0),
        'failed_tx', COALESCE(v_failed_tx, 0),
        'cash_payments', COALESCE(v_cash_payments, 0),
        'mobile_money', COALESCE(v_mobile_money, 0),
        'card_payments', COALESCE(v_card_payments, 0),
        'wallet_tx', COALESCE(v_wallet_tx, 0),
        'escrow_held', COALESCE(v_escrow_held, 0),
        'escrow_released', COALESCE(v_escrow_released, 0),
        'active_escrows', COALESCE(v_active_escrows, 0),
        'active_rides', COALESCE(v_active_rides, 0),
        'active_drivers', COALESCE(v_active_drivers, 0),
        'active_passengers', COALESCE(v_active_passengers, 0),
        'settlement_collected', COALESCE(v_escrow_released, 0),
        'settlement_transferred', COALESCE(v_driver_earnings, 0),
        'settlement_pending', COALESCE(v_escrow_held, 0)
    );
END;
$$;


ALTER FUNCTION "public"."admin_finance_summary_full"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_force_driver_offline"("p_driver_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  UPDATE drivers
  SET is_online = false,
      updated_at = NOW()
  WHERE id = p_driver_id;

  UPDATE driver_locations
  SET is_online = false
  WHERE driver_id = p_driver_id;

  RETURN jsonb_build_object('success', true);
END;
$$;


ALTER FUNCTION "public"."admin_force_driver_offline"("p_driver_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_get_nearby_drivers"("p_lat" numeric, "p_lng" numeric, "p_radius_km" numeric DEFAULT 5) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE v_result JSONB;
BEGIN
    SELECT jsonb_agg(row_to_json(dr.*))
    INTO v_result
    FROM (
        SELECT dl.driver_id, u.full_name AS driver_name, u.phone AS driver_phone,
            dl.latitude, dl.longitude, dl.city, dl.is_online, dl.is_available,
            ROUND(CAST(earth_distance(
                ll_to_earth(dl.latitude, dl.longitude),
                ll_to_earth(p_lat, p_lng)
            ) / 1000 AS DECIMAL), 2) AS distance_km
        FROM driver_locations dl
        LEFT JOIN drivers d ON d.id = dl.driver_id
        LEFT JOIN users u ON u.id = d.user_id
        WHERE dl.is_online = true AND dl.is_available = true
        ORDER BY distance_km ASC
        LIMIT 10
    ) dr;
    RETURN jsonb_build_object('data', COALESCE(v_result, '[]'::jsonb));
END;
$$;


ALTER FUNCTION "public"."admin_get_nearby_drivers"("p_lat" numeric, "p_lng" numeric, "p_radius_km" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_get_payout_settings"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_result JSONB;
BEGIN
    SELECT jsonb_object_agg(setting_key, setting_value)
    INTO v_result FROM payout_settings;
    RETURN v_result;
END;
$$;


ALTER FUNCTION "public"."admin_get_payout_settings"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_get_trip_detail"("p_ride_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_result JSONB;
BEGIN
    SELECT jsonb_build_object(
        'ride_id', r.id,
        'driver_id', r.driver_id,
        'status', r.status,
        'created_at', r.created_at,
        'city', r.city,
        'pickup_address', r.pickup_address,
        'dropoff_address', r.dropoff_address,
        'fare', r.fare,
        'distance_km', r.distance_km,
        'duration_min', r.duration_min,
        'vehicle_class', r.vehicle_class,
        'safety_flagged', r.safety_flagged,
        'safety_flag_reason', r.safety_flag_reason,
        'reviewed_at', r.reviewed_at,
        'rider_name', ru.full_name,
        'rider_phone', ru.phone,
        'driver_name', du.full_name,
        'driver_phone', du.phone,
        'plate_number', v.plate_number,
        'vehicle_make', v.make,
        'vehicle_model', v.model,
        'vehicle_color', v.color,
        'base_fare', r.base_fare,
        'distance_fare', r.distance_fare,
        'time_fare', r.time_fare,
        'surge_multiplier', r.surge_multiplier,
        'payment_method', p.payment_method,
        'payment_status', p.payment_status,
        'payment_amount', p.amount,
        'paid_at', p.paid_at,
        'started_at', r.started_at,
        'completed_at', r.completed_at,
        'cancelled_at', r.cancelled_at,
        'cancellation_reason', r.cancellation_reason,
        'gps_point_count', (SELECT COUNT(*) FROM ride_location_points rlp WHERE rlp.ride_id = r.id),
        'event_count', (SELECT COUNT(*) FROM ride_events re WHERE re.ride_id = r.id),
        'safety_event_count', (SELECT COUNT(*) FROM ride_safety_events rse WHERE rse.ride_id = r.id),
        'dispute_count', (SELECT COUNT(*) FROM ride_disputes rd WHERE rd.ride_id = r.id),
        'commission', COALESCE(te.commission_amount, 0),
        'tax', COALESCE(te.tax_amount, 0),
        'driver_earnings', COALESCE(te.net_earning, 0)
    )
    INTO v_result
    FROM rides r
    LEFT JOIN riders ri ON ri.id = r.rider_id
    LEFT JOIN users ru ON ru.id = ri.user_id
    LEFT JOIN drivers d ON d.id = r.driver_id
    LEFT JOIN users du ON du.id = d.user_id
    LEFT JOIN vehicles v ON v.id = d.vehicle_id
    LEFT JOIN payments p ON p.ride_id = r.id
    LEFT JOIN trip_earnings te ON te.ride_id = r.id
    WHERE r.id = p_ride_id;

    RETURN jsonb_build_object('data', v_result);
END;
$$;


ALTER FUNCTION "public"."admin_get_trip_detail"("p_ride_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_hold_driver_payout"("p_payout_id" "uuid", "p_reason" "text" DEFAULT NULL::"text", "p_admin_id" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
    UPDATE driver_payouts SET is_held = true, hold_reason = p_reason, updated_at = NOW()
    WHERE id = p_payout_id;
    RETURN jsonb_build_object('success', true);
END;
$$;


ALTER FUNCTION "public"."admin_hold_driver_payout"("p_payout_id" "uuid", "p_reason" "text", "p_admin_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_incident_stats"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE v_total INT; v_open INT; v_investigating INT; v_escalated INT; v_resolved INT; v_closed INT; v_high_severity INT;
    v_avg_resolution_hours NUMERIC;
BEGIN
    SELECT COUNT(*) INTO v_total FROM safety_incidents;
    SELECT COUNT(*) INTO v_open FROM safety_incidents WHERE status IN ('open','new');
    SELECT COUNT(*) INTO v_investigating FROM safety_incidents WHERE status IN ('investigating','under_review');
    SELECT COUNT(*) INTO v_escalated FROM safety_incidents WHERE status = 'escalated';
    SELECT COUNT(*) INTO v_resolved FROM safety_incidents WHERE status = 'resolved';
    SELECT COUNT(*) INTO v_closed FROM safety_incidents WHERE status = 'closed';
    SELECT COUNT(*) INTO v_high_severity FROM safety_incidents WHERE severity IN ('high','critical');
    SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (resolved_at - created_at))/3600), 0) INTO v_avg_resolution_hours FROM safety_incidents WHERE status='resolved';
    RETURN jsonb_build_object('total',v_total,'open',v_open,'investigating',v_investigating,'escalated',v_escalated,'resolved',v_resolved,'closed',v_closed,'high_severity',v_high_severity,'avg_resolution_hours',ROUND(v_avg_resolution_hours,1));
END; $$;


ALTER FUNCTION "public"."admin_incident_stats"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_list_commission_configs"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE v_result JSONB;
BEGIN
    SELECT jsonb_agg(row_to_json(cc.*) ORDER BY cc.vehicle_class)
    INTO v_result FROM commission_configs cc WHERE cc.is_active = true;
    RETURN jsonb_build_object('data', COALESCE(v_result, '[]'::jsonb));
END;
$$;


ALTER FUNCTION "public"."admin_list_commission_configs"() OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."countries" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "code" "text" NOT NULL,
    "currency" "text",
    "phone_code" "text",
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "currency_code" "text" DEFAULT 'MWK'::"text" NOT NULL,
    "currency_name" "text" DEFAULT 'Malawi Kwacha'::"text" NOT NULL
);


ALTER TABLE "public"."countries" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_list_countries"() RETURNS SETOF "public"."countries"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT * FROM countries ORDER BY name;
$$;


ALTER FUNCTION "public"."admin_list_countries"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_list_driver_incentives"("p_country_code" "text" DEFAULT 'MW'::"text", "p_city" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_result JSONB;
BEGIN
    SELECT jsonb_agg(row_to_json(i.*) ORDER BY i.created_at DESC)
    INTO v_result
    FROM pricing_driver_incentives i
    WHERE i.country_code = p_country_code
      AND (p_city IS NULL OR i.city = p_city OR i.city IS NULL)
      AND i.is_active = true;

    RETURN jsonb_build_object(
        'data', COALESCE(v_result, '[]'::jsonb),
        'success', true
    );
END;
$$;


ALTER FUNCTION "public"."admin_list_driver_incentives"("p_country_code" "text", "p_city" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_list_drivers"("p_page" integer DEFAULT 1, "p_page_size" integer DEFAULT 25, "p_search" "text" DEFAULT ''::"text", "p_approval_status" "text" DEFAULT ''::"text", "p_is_online" boolean DEFAULT NULL::boolean, "p_city_id" "uuid" DEFAULT NULL::"uuid", "p_driver_tier" "text" DEFAULT ''::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_from INT;
  v_to INT;
  v_total INT;
  v_result JSONB;
BEGIN
  v_from := (p_page - 1) * p_page_size;
  v_to := v_from + p_page_size - 1;

  WITH filtered AS (
    SELECT d.*,
      to_jsonb(u) AS "user",
      to_jsonb(v) AS vehicle
    FROM drivers d
    LEFT JOIN users u ON d.user_id = u.id
    LEFT JOIN vehicles v ON d.vehicle_id = v.id
    WHERE
      (p_search = '' OR u.full_name ILIKE '%' || p_search || '%' OR u.phone ILIKE '%' || p_search || '%')
      AND (p_approval_status = '' OR d.approval_status = p_approval_status)
      AND (p_is_online IS NULL OR d.is_online = p_is_online)
      AND (p_city_id IS NULL OR d.city_id = p_city_id)
      AND (p_driver_tier = '' OR d.driver_tier = p_driver_tier)
  ),
  counted AS (
    SELECT COUNT(*) AS total FROM filtered
  )
  SELECT jsonb_build_object(
    'data', COALESCE((SELECT jsonb_agg(f.*) FROM (SELECT * FROM filtered ORDER BY created_at DESC LIMIT p_page_size OFFSET v_from) f), '[]'::jsonb),
    'totalCount', COALESCE((SELECT total FROM counted), 0),
    'page', p_page,
    'pageSize', p_page_size
  ) INTO v_result;

  RETURN v_result;
END;
$$;


ALTER FUNCTION "public"."admin_list_drivers"("p_page" integer, "p_page_size" integer, "p_search" "text", "p_approval_status" "text", "p_is_online" boolean, "p_city_id" "uuid", "p_driver_tier" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_list_emergencies_enriched"("p_status" "text" DEFAULT NULL::"text", "p_city" "text" DEFAULT NULL::"text", "p_limit" integer DEFAULT 50) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE v_result JSONB;
BEGIN
    WITH enriched AS (
        SELECT ea.*,
            u.full_name AS user_name, u.phone AS user_phone,
            ru.full_name AS rider_name, ru.phone AS rider_phone,
            du.full_name AS driver_name, du.phone AS driver_phone,
            r.pickup_address, r.dropoff_address, r.fare, r.payment_method, r.status AS ride_status,
            v.plate_number, v.make AS vehicle_make, v.model AS vehicle_model,
            (SELECT COUNT(*) FROM emergency_responses er WHERE er.alert_id = ea.id) AS response_count,
            (SELECT jsonb_agg(row_to_json(er.*) ORDER BY er.created_at DESC) FROM emergency_responses er WHERE er.alert_id = ea.id LIMIT 5) AS recent_responses
        FROM emergency_alerts ea
        LEFT JOIN users u ON u.id = ea.triggered_by
        LEFT JOIN riders ri ON ri.id = ea.rider_id
        LEFT JOIN users ru ON ru.id = ri.user_id
        LEFT JOIN drivers d ON d.id = ea.driver_id
        LEFT JOIN users du ON du.id = d.user_id
        LEFT JOIN rides r ON r.id = ea.ride_id
        LEFT JOIN vehicles v ON v.id = d.vehicle_id
        WHERE (p_status IS NULL OR ea.status = p_status)
            AND (p_city IS NULL OR ea.city = p_city)
        ORDER BY
            CASE ea.status WHEN 'active' THEN 0 WHEN 'responding' THEN 1 ELSE 2 END,
            CASE ea.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 ELSE 2 END,
            ea.created_at DESC
        LIMIT p_limit
    )
    SELECT jsonb_build_object('data', COALESCE((SELECT jsonb_agg(row_to_json(e.*)) FROM enriched e), '[]'::jsonb))
    INTO v_result;
    RETURN v_result;
END;
$$;


ALTER FUNCTION "public"."admin_list_emergencies_enriched"("p_status" "text", "p_city" "text", "p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_list_failed_transactions"("p_search" "text" DEFAULT ''::"text", "p_provider" "text" DEFAULT NULL::"text", "p_limit" integer DEFAULT 50) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_result JSONB;
BEGIN
    WITH failed AS (
        SELECT pt.*,
            p.amount AS payment_amount, p.payment_method, p.transaction_reference,
            p.payment_status,
            ru.full_name AS user_name
        FROM payment_transactions pt
        LEFT JOIN payments p ON p.id = pt.payment_id
        LEFT JOIN users ru ON ru.id = p.paid_by
        WHERE pt.provider_status IN ('failed', 'error')
            AND (p_search = '' OR p.transaction_reference ILIKE '%' || p_search || '%' OR ru.full_name ILIKE '%' || p_search || '%')
            AND (p_provider IS NULL OR pt.provider = p_provider)
        ORDER BY pt.created_at DESC
        LIMIT p_limit
    )
    SELECT jsonb_build_object(
        'data', COALESCE((SELECT jsonb_agg(f.*) FROM failed f), '[]'::jsonb)
    ) INTO v_result;
    RETURN v_result;
END;
$$;


ALTER FUNCTION "public"."admin_list_failed_transactions"("p_search" "text", "p_provider" "text", "p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_list_fraud_rules"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE v_result JSONB;
BEGIN
    SELECT jsonb_agg(row_to_json(fr.*) ORDER BY fr.rule_name)
    INTO v_result FROM fraud_protection_rules fr;
    RETURN jsonb_build_object('data', COALESCE(v_result, '[]'::jsonb));
END;
$$;


ALTER FUNCTION "public"."admin_list_fraud_rules"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_list_incidents_enriched"("p_status" "text" DEFAULT NULL::"text", "p_severity" "text" DEFAULT NULL::"text", "p_city" "text" DEFAULT NULL::"text", "p_type" "text" DEFAULT NULL::"text", "p_limit" integer DEFAULT 25) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE v_result JSONB;
BEGIN
    WITH enriched AS (
        SELECT si.*, ru.full_name AS rider_name, du.full_name AS driver_name, du2.phone AS driver_phone,
            r.pickup_address, r.dropoff_address, r.fare, r.status AS ride_status,
            v.plate_number,
            (SELECT COUNT(*) FROM incident_evidence ie WHERE ie.incident_id = si.id) AS evidence_count,
            (SELECT COUNT(*) FROM incident_timeline it WHERE it.incident_id = si.id) AS timeline_count
        FROM safety_incidents si
        LEFT JOIN riders ri ON ri.id = si.rider_id
        LEFT JOIN users ru ON ru.id = ri.user_id
        LEFT JOIN drivers d ON d.id = si.driver_id
        LEFT JOIN users du ON du.id = d.user_id
        LEFT JOIN users du2 ON du2.id = d.user_id
        LEFT JOIN rides r ON r.id = si.ride_id
        LEFT JOIN vehicles v ON v.id = d.vehicle_id
        WHERE (p_status IS NULL OR si.status = p_status) AND (p_severity IS NULL OR si.severity = p_severity)
            AND (p_city IS NULL OR si.city = p_city) AND (p_type IS NULL OR si.incident_type = p_type)
        ORDER BY CASE si.status WHEN 'open' THEN 0 WHEN 'investigating' THEN 1 WHEN 'escalated' THEN 2 ELSE 3 END, si.created_at DESC LIMIT p_limit
    )
    SELECT jsonb_build_object('data', COALESCE((SELECT jsonb_agg(row_to_json(e.*)) FROM enriched e), '[]'::jsonb)) INTO v_result;
    RETURN v_result;
END; $$;


ALTER FUNCTION "public"."admin_list_incidents_enriched"("p_status" "text", "p_severity" "text", "p_city" "text", "p_type" "text", "p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_list_loyalty_accounts"("p_search" "text" DEFAULT ''::"text", "p_tier" "text" DEFAULT NULL::"text", "p_limit" integer DEFAULT 25, "p_offset" integer DEFAULT 0) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."admin_list_loyalty_accounts"("p_search" "text", "p_tier" "text", "p_limit" integer, "p_offset" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_list_payments_enriched"("p_search" "text" DEFAULT ''::"text", "p_status" "text" DEFAULT NULL::"text", "p_method" "text" DEFAULT NULL::"text", "p_city" "text" DEFAULT NULL::"text", "p_date_from" "text" DEFAULT NULL::"text", "p_date_to" "text" DEFAULT NULL::"text", "p_limit" integer DEFAULT 50, "p_offset" integer DEFAULT 0) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_result JSONB;
    v_total INT;
BEGIN
    WITH filtered AS (
        SELECT p.*,
            rd.id AS ride_ride_id,
            rd.pickup_address, rd.dropoff_address, rd.city AS ride_city,
            rd.vehicle_class,
            ri.user_id AS rider_user_id,
            d.user_id AS driver_user_id
        FROM payments p
        LEFT JOIN rides rd ON rd.id = p.ride_id
        LEFT JOIN riders ri ON ri.id = rd.rider_id
        LEFT JOIN drivers d ON d.id = rd.driver_id
        WHERE
            (p_search = '' OR p.transaction_reference ILIKE '%' || p_search || '%')
            AND (p_status IS NULL OR p.payment_status = p_status)
            AND (p_method IS NULL OR p.payment_method = p_method)
            AND (p_city IS NULL OR rd.city = p_city)
            AND (p_date_from IS NULL OR p.created_at >= p_date_from::timestamptz)
            AND (p_date_to IS NULL OR p.created_at <= p_date_to::timestamptz)
    ),
    counted AS (SELECT COUNT(*) AS total FROM filtered)
    SELECT jsonb_build_object(
        'data', COALESCE((SELECT jsonb_agg(f.*) FROM (SELECT * FROM filtered ORDER BY created_at DESC LIMIT p_limit OFFSET p_offset) f), '[]'::jsonb),
        'total', COALESCE((SELECT total FROM counted), 0)
    ) INTO v_result;
    RETURN v_result;
END;
$$;


ALTER FUNCTION "public"."admin_list_payments_enriched"("p_search" "text", "p_status" "text", "p_method" "text", "p_city" "text", "p_date_from" "text", "p_date_to" "text", "p_limit" integer, "p_offset" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_list_payout_requests_full"("p_search" "text" DEFAULT ''::"text", "p_status" "text" DEFAULT NULL::"text", "p_method" "text" DEFAULT NULL::"text", "p_city" "text" DEFAULT NULL::"text", "p_date_from" "text" DEFAULT NULL::"text", "p_date_to" "text" DEFAULT NULL::"text", "p_amount_min" numeric DEFAULT NULL::numeric, "p_amount_max" numeric DEFAULT NULL::numeric, "p_limit" integer DEFAULT 25, "p_offset" integer DEFAULT 0) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_result JSONB;
    v_total INT;
BEGIN
    WITH filtered AS (
        SELECT
            pr.id, pr.driver_id, pr.amount AS requested_amount, pr.fee,
            pr.net_amount, pr.payout_method, pr.account_number, pr.account_name,
            pr.status, pr.transaction_reference, pr.provider_reference,
            pr.failure_reason, pr.notes, pr.processed_at, pr.created_at,
            u.full_name AS driver_name, u.phone AS driver_phone,
            d.city AS driver_city,
            dw.balance AS wallet_balance, dw.available_for_withdrawal,
            (SELECT COUNT(*) FROM trip_earnings te WHERE te.driver_id = pr.driver_id AND te.is_paid_to_wallet = false) AS trips_covered,
            (SELECT COALESCE(SUM(te.commission_amount),0) FROM trip_earnings te WHERE te.driver_id = pr.driver_id AND te.is_paid_to_wallet = false) AS commission_deducted,
            (SELECT COALESCE(SUM(te.tax_amount),0) FROM trip_earnings te WHERE te.driver_id = pr.driver_id AND te.is_paid_to_wallet = false) AS tax_deducted
        FROM driver_payout_requests pr
        LEFT JOIN drivers d ON d.id = pr.driver_id
        LEFT JOIN users u ON u.id = d.user_id
        LEFT JOIN driver_wallets dw ON dw.driver_id = pr.driver_id
        WHERE
            (p_search = '' OR u.full_name ILIKE '%' || p_search || '%'
                OR u.phone ILIKE '%' || p_search || '%'
                OR pr.transaction_reference ILIKE '%' || p_search || '%')
            AND (p_status IS NULL OR pr.status = p_status)
            AND (p_method IS NULL OR pr.payout_method = p_method)
            AND (p_city IS NULL OR d.city = p_city)
            AND (p_date_from IS NULL OR pr.created_at >= p_date_from::timestamptz)
            AND (p_date_to IS NULL OR pr.created_at <= p_date_to::timestamptz)
            AND (p_amount_min IS NULL OR pr.amount >= p_amount_min)
            AND (p_amount_max IS NULL OR pr.amount <= p_amount_max)
    ),
    counted AS (SELECT COUNT(*) AS total FROM filtered)
    SELECT jsonb_build_object(
        'data', COALESCE((SELECT jsonb_agg(f.*) FROM (SELECT * FROM filtered ORDER BY created_at DESC LIMIT p_limit OFFSET p_offset) f), '[]'::jsonb),
        'total', COALESCE((SELECT total FROM counted), 0)
    ) INTO v_result;
    RETURN v_result;
END;
$$;


ALTER FUNCTION "public"."admin_list_payout_requests_full"("p_search" "text", "p_status" "text", "p_method" "text", "p_city" "text", "p_date_from" "text", "p_date_to" "text", "p_amount_min" numeric, "p_amount_max" numeric, "p_limit" integer, "p_offset" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_list_payouts_enriched"("p_search" "text" DEFAULT ''::"text", "p_status" "text" DEFAULT NULL::"text", "p_method" "text" DEFAULT NULL::"text", "p_limit" integer DEFAULT 50, "p_offset" integer DEFAULT 0) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_result JSONB;
BEGIN
    WITH filtered AS (
        SELECT dp.*,
            d.id AS driver_driver_id,
            u.full_name AS driver_name,
            u.phone AS driver_phone,
            rd.pickup_address, rd.dropoff_address, rd.city
        FROM driver_payouts dp
        LEFT JOIN drivers d ON d.id = dp.driver_id
        LEFT JOIN users u ON u.id = d.user_id
        LEFT JOIN rides rd ON rd.id = dp.ride_id
        WHERE
            (p_search = '' OR u.full_name ILIKE '%' || p_search || '%' OR dp.transaction_reference ILIKE '%' || p_search || '%')
            AND (p_status IS NULL OR dp.payout_status = p_status)
            AND (p_method IS NULL OR dp.payout_method = p_method)
        ORDER BY dp.created_at DESC
        LIMIT p_limit OFFSET p_offset
    )
    SELECT jsonb_build_object(
        'data', COALESCE((SELECT jsonb_agg(f.*) FROM filtered f), '[]'::jsonb)
    ) INTO v_result;
    RETURN v_result;
END;
$$;


ALTER FUNCTION "public"."admin_list_payouts_enriched"("p_search" "text", "p_status" "text", "p_method" "text", "p_limit" integer, "p_offset" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_list_pricing_config"("p_country_code" "text" DEFAULT 'MW'::"text", "p_city" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_result JSONB;
BEGIN
    SELECT jsonb_agg(data) INTO v_result
    FROM (
        SELECT row_to_json(p.*) AS data
        FROM pricing_config p
        WHERE p.country_code = admin_list_pricing_config.p_country_code
          AND (admin_list_pricing_config.p_city IS NULL OR p.city = admin_list_pricing_config.p_city)
          AND p.is_active = true
        ORDER BY p.vehicle_type
    ) sub;

    RETURN jsonb_build_object(
        'data', COALESCE(v_result, '[]'::jsonb),
        'success', true
    );
END;
$$;


ALTER FUNCTION "public"."admin_list_pricing_config"("p_country_code" "text", "p_city" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_list_refunds"("p_search" "text" DEFAULT ''::"text", "p_status" "text" DEFAULT NULL::"text", "p_payment_method" "text" DEFAULT NULL::"text", "p_limit" integer DEFAULT 50) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_result JSONB;
BEGIN
    SELECT jsonb_agg(data ORDER BY created_at DESC)
    INTO v_result
    FROM (
        SELECT row_to_json(r.*) AS data
        FROM refunds r
        LEFT JOIN rides rd ON rd.id = r.ride_id
        LEFT JOIN riders ri ON ri.id = r.rider_id
        LEFT JOIN users u ON u.id = ri.user_id
        LEFT JOIN drivers d ON d.id = r.driver_id
        LEFT JOIN users du ON du.id = d.user_id
        WHERE
            (p_search = '' 
                OR u.full_name ILIKE '%' || p_search || '%'
                OR du.full_name ILIKE '%' || p_search || '%'
                OR r.ride_id::text ILIKE '%' || p_search || '%'
                OR r.transaction_reference ILIKE '%' || p_search || '%')
            AND (p_status IS NULL OR r.status = p_status)
            AND (p_payment_method IS NULL OR r.payment_method = p_payment_method)
        ORDER BY r.created_at DESC
        LIMIT p_limit
    ) sub;

    RETURN jsonb_build_object(
        'data', COALESCE(v_result, '[]'::jsonb),
        'success', true
    );
END;
$$;


ALTER FUNCTION "public"."admin_list_refunds"("p_search" "text", "p_status" "text", "p_payment_method" "text", "p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_list_refunds_enriched"("p_search" "text" DEFAULT ''::"text", "p_status" "text" DEFAULT NULL::"text", "p_method" "text" DEFAULT NULL::"text", "p_city" "text" DEFAULT NULL::"text", "p_driver" "text" DEFAULT NULL::"text", "p_rider" "text" DEFAULT NULL::"text", "p_vehicle_class" "text" DEFAULT NULL::"text", "p_amount_min" numeric DEFAULT NULL::numeric, "p_amount_max" numeric DEFAULT NULL::numeric, "p_date_from" "text" DEFAULT NULL::"text", "p_date_to" "text" DEFAULT NULL::"text", "p_provider" "text" DEFAULT NULL::"text", "p_limit" integer DEFAULT 50, "p_offset" integer DEFAULT 0) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_result JSONB;
    v_total INT;
BEGIN
    WITH filtered AS (
        SELECT r.*,
            rd.pickup_address, rd.dropoff_address, rd.distance_km, rd.duration_min,
            rd.fare AS ride_fare, rd.city AS ride_city, rd.vehicle_class,
            rd.status AS ride_status, rd.cancellation_reason AS ride_cancellation_reason,
            p.amount AS payment_amount, p.payment_method, p.transaction_reference AS payment_reference,
            p.payment_status, p.paid_at,
            ru.full_name AS rider_name, ru.phone AS rider_phone,
            du.full_name AS driver_name, du.phone AS driver_phone,
            dp.id AS payout_id, dp.amount AS payout_amount, dp.payout_status,
            dp.gross_fare, dp.commission_amount, dp.tax_amount, dp.net_earning,
            dp.is_held AS payout_held
        FROM refunds r
        LEFT JOIN rides rd ON rd.id = r.ride_id
        LEFT JOIN payments p ON p.id = r.payment_id
        LEFT JOIN riders ri ON ri.id = r.rider_id
        LEFT JOIN users ru ON ru.id = ri.user_id
        LEFT JOIN drivers d ON d.id = r.driver_id
        LEFT JOIN users du ON du.id = d.user_id
        LEFT JOIN driver_payouts dp ON dp.ride_id = r.ride_id
        WHERE
            (p_search = '' 
                OR ru.full_name ILIKE '%' || p_search || '%'
                OR du.full_name ILIKE '%' || p_search || '%'
                OR r.ride_id::text ILIKE '%' || p_search || '%'
                OR r.transaction_reference ILIKE '%' || p_search || '%')
            AND (p_status IS NULL OR r.status = p_status)
            AND (p_method IS NULL OR p.payment_method = p_method)
            AND (p_city IS NULL OR rd.city = p_city)
            AND (p_driver IS NULL OR du.full_name ILIKE '%' || p_driver || '%')
            AND (p_rider IS NULL OR ru.full_name ILIKE '%' || p_rider || '%')
            AND (p_vehicle_class IS NULL OR rd.vehicle_class = p_vehicle_class)
            AND (p_amount_min IS NULL OR r.amount >= p_amount_min)
            AND (p_amount_max IS NULL OR r.amount <= p_amount_max)
            AND (p_date_from IS NULL OR r.created_at >= p_date_from::timestamptz)
            AND (p_date_to IS NULL OR r.created_at <= p_date_to::timestamptz)
            AND (p_provider IS NULL OR p.payment_method = p_provider)
    ),
    counted AS (SELECT COUNT(*) AS total FROM filtered)
    SELECT jsonb_build_object(
        'data', COALESCE((SELECT jsonb_agg(f.*) FROM (SELECT * FROM filtered ORDER BY created_at DESC LIMIT p_limit OFFSET p_offset) f), '[]'::jsonb),
        'total', COALESCE((SELECT total FROM counted), 0)
    ) INTO v_result;
    RETURN v_result;
END;
$$;


ALTER FUNCTION "public"."admin_list_refunds_enriched"("p_search" "text", "p_status" "text", "p_method" "text", "p_city" "text", "p_driver" "text", "p_rider" "text", "p_vehicle_class" "text", "p_amount_min" numeric, "p_amount_max" numeric, "p_date_from" "text", "p_date_to" "text", "p_provider" "text", "p_limit" integer, "p_offset" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_list_surge_rules"("p_country_code" "text" DEFAULT 'MW'::"text", "p_city" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_result JSONB;
BEGIN
    SELECT jsonb_agg(row_to_json(s.*) ORDER BY s.priority DESC, s.surge_type)
    INTO v_result
    FROM pricing_surge_rules s
    WHERE s.country_code = p_country_code
      AND (p_city IS NULL OR s.city = p_city OR s.city IS NULL)
      AND s.is_active = true;

    RETURN jsonb_build_object(
        'data', COALESCE(v_result, '[]'::jsonb),
        'success', true
    );
END;
$$;


ALTER FUNCTION "public"."admin_list_surge_rules"("p_country_code" "text", "p_city" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_list_tax_configs"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE v_result JSONB;
BEGIN
    SELECT jsonb_agg(row_to_json(tc.*) ORDER BY tc.tax_name)
    INTO v_result FROM tax_configs tc;
    RETURN jsonb_build_object('data', COALESCE(v_result, '[]'::jsonb));
END;
$$;


ALTER FUNCTION "public"."admin_list_tax_configs"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_list_transactions_enriched"("p_search" "text" DEFAULT ''::"text", "p_status" "text" DEFAULT NULL::"text", "p_type" "text" DEFAULT NULL::"text", "p_method" "text" DEFAULT NULL::"text", "p_vehicle_class" "text" DEFAULT NULL::"text", "p_city" "text" DEFAULT NULL::"text", "p_date_from" "text" DEFAULT NULL::"text", "p_date_to" "text" DEFAULT NULL::"text", "p_limit" integer DEFAULT 25, "p_offset" integer DEFAULT 0) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_result JSONB;
BEGIN
    WITH payment_rows AS (
        SELECT
            p.id,
            p.ride_id,
            NULL::UUID AS driver_transaction_id,
            COALESCE(p.type, 'ride_payment') AS transaction_type,
            ABS(p.amount) AS gross_amount,
            p.payment_method,
            COALESCE(p.payment_status, p.status, 'pending') AS status,
            COALESCE(p.transaction_reference, p.reference) AS transaction_reference,
            p.created_at,
            rd.pickup_address, rd.dropoff_address,
            rd.distance_km, rd.duration_min,
            rd.city, rd.vehicle_class,
            rd.base_fare, rd.distance_fare, rd.time_fare,
            rd.surge_multiplier,
            COALESCE(te.commission_amount, 0) AS commission,
            COALESCE(te.tax_amount, 0) AS tax,
            COALESCE(te.net_earning, 0) AS driver_earnings,
            CASE WHEN COALESCE(te.is_paid_to_wallet, false) THEN 'paid' ELSE 'pending' END AS payout_status,
            CASE
              WHEN p.ride_id IS NULL AND COALESCE(p.user_type, '') = 'rider' THEN 'rider_wallet'
              ELSE NULL::TEXT
            END AS settlement_status,
            false AS fraud_flag,
            COALESCE(ride_rider_user.full_name, payment_user.full_name) AS rider_name,
            COALESCE(ride_rider_user.phone, payment_user.phone) AS rider_phone,
            driver_user.full_name AS driver_name,
            driver_user.phone AS driver_phone
        FROM public.payments p
        LEFT JOIN public.rides rd ON rd.id = p.ride_id
        LEFT JOIN public.trip_earnings te ON te.ride_id = p.ride_id
        LEFT JOIN public.riders ride_rider ON ride_rider.id = rd.rider_id
        LEFT JOIN public.users ride_rider_user ON ride_rider_user.id = ride_rider.user_id
        LEFT JOIN public.users payment_user ON payment_user.id = COALESCE(p.user_id, p.paid_by)
        LEFT JOIN public.drivers d ON d.id = rd.driver_id
        LEFT JOIN public.users driver_user ON driver_user.id = d.user_id
        WHERE NOT (COALESCE(p.user_type, '') = 'driver' AND COALESCE(p.type, '') IN ('payout', 'topup', 'transfer'))
    ),
    driver_rows AS (
        SELECT
            dt.id,
            CASE WHEN dt.reference_type = 'ride' THEN dt.reference_id ELSE NULL::UUID END AS ride_id,
            dt.id AS driver_transaction_id,
            dt.transaction_type,
            ABS(dt.amount) AS gross_amount,
            dt.payout_method AS payment_method,
            COALESCE(dt.status, 'completed') AS status,
            dt.payout_reference AS transaction_reference,
            dt.created_at,
            NULL::TEXT AS pickup_address, NULL::TEXT AS dropoff_address,
            NULL::NUMERIC AS distance_km, NULL::INTEGER AS duration_min,
            d.city, NULL::TEXT AS vehicle_class,
            NULL::NUMERIC AS base_fare, NULL::NUMERIC AS distance_fare, NULL::NUMERIC AS time_fare,
            NULL::NUMERIC AS surge_multiplier,
            0::NUMERIC AS commission,
            0::NUMERIC AS tax,
            dt.amount AS driver_earnings,
            CASE WHEN dt.transaction_type = 'withdrawal' THEN dt.status ELSE 'wallet' END AS payout_status,
            'driver_wallet' AS settlement_status,
            false AS fraud_flag,
            NULL::TEXT AS rider_name,
            NULL::TEXT AS rider_phone,
            u.full_name AS driver_name,
            u.phone AS driver_phone
        FROM public.driver_transactions dt
        LEFT JOIN public.drivers d ON d.id = dt.driver_id
        LEFT JOIN public.users u ON u.id = d.user_id
    ),
    unioned AS (
        SELECT * FROM payment_rows
        UNION ALL
        SELECT * FROM driver_rows
    ),
    filtered AS (
        SELECT * FROM unioned u
        WHERE
          (p_search = ''
            OR COALESCE(u.transaction_reference, '') ILIKE '%' || p_search || '%'
            OR COALESCE(u.rider_name, '') ILIKE '%' || p_search || '%'
            OR COALESCE(u.rider_phone, '') ILIKE '%' || p_search || '%'
            OR COALESCE(u.driver_name, '') ILIKE '%' || p_search || '%'
            OR COALESCE(u.driver_phone, '') ILIKE '%' || p_search || '%'
            OR u.id::TEXT ILIKE '%' || p_search || '%')
          AND (p_status IS NULL OR u.status = p_status)
          AND (p_type IS NULL OR u.transaction_type = p_type)
          AND (p_method IS NULL OR u.payment_method = p_method)
          AND (p_city IS NULL OR u.city = p_city)
          AND (p_vehicle_class IS NULL OR u.vehicle_class = p_vehicle_class)
          AND (p_date_from IS NULL OR u.created_at >= p_date_from::timestamptz)
          AND (p_date_to IS NULL OR u.created_at <= p_date_to::timestamptz)
    ),
    counted AS (SELECT COUNT(*) AS total FROM filtered)
    SELECT jsonb_build_object(
      'data', COALESCE((SELECT jsonb_agg(f.*) FROM (SELECT * FROM filtered ORDER BY created_at DESC LIMIT p_limit OFFSET p_offset) f), '[]'::jsonb),
      'total', COALESCE((SELECT total FROM counted), 0)
    ) INTO v_result;

    RETURN v_result;
END;
$$;


ALTER FUNCTION "public"."admin_list_transactions_enriched"("p_search" "text", "p_status" "text", "p_type" "text", "p_method" "text", "p_vehicle_class" "text", "p_city" "text", "p_date_from" "text", "p_date_to" "text", "p_limit" integer, "p_offset" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_loyalty_analytics"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."admin_loyalty_analytics"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_mark_payout_paid"("p_request_id" "uuid", "p_transaction_reference" "text" DEFAULT NULL::"text", "p_admin_id" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_old_status TEXT;
    v_driver_id UUID;
    v_driver_wallet_id UUID;
    v_amount DECIMAL(12,2);
BEGIN
    SELECT status, driver_id, wallet_id, amount INTO v_old_status, v_driver_id, v_driver_wallet_id, v_amount
    FROM driver_payout_requests WHERE id = p_request_id;

    UPDATE driver_payout_requests SET
        status = 'paid',
        transaction_reference = p_transaction_reference,
        processed_at = NOW(),
        updated_at = NOW()
    WHERE id = p_request_id;

    -- Mark trip earnings as paid
    UPDATE trip_earnings SET is_paid_to_wallet = true, paid_to_wallet_at = NOW()
    WHERE driver_id = v_driver_id AND is_paid_to_wallet = false;

    INSERT INTO admin_payout_actions (payout_request_id, action, old_status, new_status, processed_by)
    VALUES (p_request_id, 'mark_paid', v_old_status, 'paid', p_admin_id);

    INSERT INTO payout_audit_logs (payout_request_id, action, old_status, new_status, changed_by, notes)
    VALUES (p_request_id, 'mark_payout_paid', v_old_status, 'paid', p_admin_id, p_transaction_reference);

    RETURN jsonb_build_object('success', true);
END;
$$;


ALTER FUNCTION "public"."admin_mark_payout_paid"("p_request_id" "uuid", "p_transaction_reference" "text", "p_admin_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_mark_trip_reviewed"("p_ride_id" "uuid", "p_admin_id" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
    UPDATE rides SET reviewed_by = p_admin_id, reviewed_at = NOW() WHERE id = p_ride_id;
    RETURN jsonb_build_object('success', true);
END;
$$;


ALTER FUNCTION "public"."admin_mark_trip_reviewed"("p_ride_id" "uuid", "p_admin_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_payout_stats_full"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_pending_count INT; v_pending_amount DECIMAL(12,2);
    v_approved_count INT; v_approved_amount DECIMAL(12,2);
    v_paid_week DECIMAL(12,2);
    v_failed_count INT; v_failed_amount DECIMAL(12,2);
    v_wallet_balance DECIMAL(12,2);
    v_commission_held DECIMAL(12,2);
    v_tax_collected DECIMAL(12,2);
    v_refund_impact DECIMAL(12,2);
BEGIN
    -- Pending
    SELECT COUNT(*), COALESCE(SUM(net_amount),0) INTO v_pending_count, v_pending_amount
    FROM driver_payout_requests WHERE status = 'pending';

    -- Approved
    SELECT COUNT(*), COALESCE(SUM(net_amount),0) INTO v_approved_count, v_approved_amount
    FROM driver_payout_requests WHERE status = 'approved';

    -- Paid this week
    SELECT COALESCE(SUM(net_amount),0) INTO v_paid_week
    FROM driver_payout_requests WHERE status = 'paid' AND processed_at >= NOW() - INTERVAL '7 days';

    -- Failed
    SELECT COUNT(*), COALESCE(SUM(net_amount),0) INTO v_failed_count, v_failed_amount
    FROM driver_payout_requests WHERE status = 'failed';

    -- Wallet balance
    SELECT COALESCE(SUM(balance),0) INTO v_wallet_balance FROM driver_wallets;

    -- Commission held
    SELECT COALESCE(SUM(commission_amount),0) INTO v_commission_held FROM company_commissions;

    -- Tax collected
    SELECT COALESCE(SUM(tax_amount),0) INTO v_tax_collected FROM tax_records;

    -- Refund impact
    SELECT COALESCE(SUM(amount),0) INTO v_refund_impact FROM refunds WHERE status = 'refunded';

    RETURN jsonb_build_object(
        'pending_count', v_pending_count,
        'pending_amount', v_pending_amount,
        'approved_count', v_approved_count,
        'approved_amount', v_approved_amount,
        'paid_this_week', v_paid_week,
        'failed_count', v_failed_count,
        'failed_amount', v_failed_amount,
        'wallet_balance', v_wallet_balance,
        'commission_held', v_commission_held,
        'tax_collected', v_tax_collected,
        'refund_impact', v_refund_impact
    );
END;
$$;


ALTER FUNCTION "public"."admin_payout_stats_full"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_penalize_driver"("p_driver_id" "uuid", "p_ride_id" "uuid" DEFAULT NULL::"uuid", "p_refund_id" "uuid" DEFAULT NULL::"uuid", "p_amount" numeric DEFAULT 0, "p_reason" "text" DEFAULT NULL::"text", "p_admin_id" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_penalty_id UUID;
BEGIN
    INSERT INTO driver_penalties (driver_id, ride_id, refund_id, amount, reason, status, applied_at)
    VALUES (p_driver_id, p_ride_id, p_refund_id, p_amount, p_reason, 'applied', NOW())
    RETURNING id INTO v_penalty_id;
    RETURN jsonb_build_object('success', true, 'penalty_id', v_penalty_id);
END;
$$;


ALTER FUNCTION "public"."admin_penalize_driver"("p_driver_id" "uuid", "p_ride_id" "uuid", "p_refund_id" "uuid", "p_amount" numeric, "p_reason" "text", "p_admin_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_process_partial_refund"("p_refund_id" "uuid", "p_partial_amount" numeric, "p_admin_notes" "text" DEFAULT NULL::"text", "p_admin_id" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
    UPDATE refunds SET
        status = 'refunded',
        partial_amount = p_partial_amount,
        decision = 'partial_refund',
        admin_notes = COALESCE(p_admin_notes, admin_notes),
        processed_at = NOW(),
        updated_at = NOW()
    WHERE id = p_refund_id;
    INSERT INTO refund_actions (refund_id, action_type, decision, partial_amount, admin_notes, processed_by)
    VALUES (p_refund_id, 'partial_refund', 'partial_refund', p_partial_amount, p_admin_notes, p_admin_id);
    UPDATE payments SET payment_status = 'partially_refunded', refund_amount = p_partial_amount, refunded_at = NOW()
    WHERE id = (SELECT payment_id FROM refunds WHERE id = p_refund_id);
    RETURN jsonb_build_object('success', true);
END;
$$;


ALTER FUNCTION "public"."admin_process_partial_refund"("p_refund_id" "uuid", "p_partial_amount" numeric, "p_admin_notes" "text", "p_admin_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_process_refund"("p_refund_id" "uuid", "p_status" "text", "p_admin_notes" "text" DEFAULT NULL::"text", "p_failure_reason" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
    UPDATE refunds
    SET
        status = p_status,
        admin_notes = COALESCE(p_admin_notes, admin_notes),
        failure_reason = COALESCE(p_failure_reason, failure_reason),
        processed_at = NOW(),
        updated_at = NOW()
    WHERE id = p_refund_id;

    -- If approved, update the linked payment record
    IF p_status = 'approved' THEN
        UPDATE payments
        SET payment_status = 'refunded',
            refunded_at = NOW()
        WHERE id = (SELECT payment_id FROM refunds WHERE id = p_refund_id);
    END IF;

    RETURN jsonb_build_object('success', true, 'id', p_refund_id, 'status', p_status);
END;
$$;


ALTER FUNCTION "public"."admin_process_refund"("p_refund_id" "uuid", "p_status" "text", "p_admin_notes" "text", "p_failure_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_reject_driver"("p_driver_id" "uuid", "p_reason" "text" DEFAULT ''::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  UPDATE drivers
  SET approval_status = 'rejected',
      rejection_reason = p_reason,
      is_online = false,
      updated_at = NOW()
  WHERE id = p_driver_id;

  RETURN jsonb_build_object('success', true);
END;
$$;


ALTER FUNCTION "public"."admin_reject_driver"("p_driver_id" "uuid", "p_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_reject_payout_full"("p_request_id" "uuid", "p_admin_notes" "text" DEFAULT NULL::"text", "p_admin_id" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_old_status TEXT;
    v_wallet_id UUID;
    v_amount DECIMAL(12,2);
BEGIN
    SELECT status, wallet_id, amount INTO v_old_status, v_wallet_id, v_amount
    FROM driver_payout_requests WHERE id = p_request_id;

    UPDATE driver_payout_requests SET
        status = 'rejected',
        notes = COALESCE(p_admin_notes, notes),
        updated_at = NOW()
    WHERE id = p_request_id;

    -- Refund back to wallet
    IF v_wallet_id IS NOT NULL THEN
        UPDATE driver_wallets SET
            balance = balance + v_amount,
            available_for_withdrawal = available_for_withdrawal + v_amount,
            updated_at = NOW()
        WHERE id = v_wallet_id;
    END IF;

    INSERT INTO admin_payout_actions (payout_request_id, action, old_status, new_status, admin_notes, processed_by)
    VALUES (p_request_id, 'reject', v_old_status, 'rejected', p_admin_notes, p_admin_id);

    INSERT INTO payout_audit_logs (payout_request_id, action, old_status, new_status, changed_by, notes)
    VALUES (p_request_id, 'reject_payout', v_old_status, 'rejected', p_admin_id, p_admin_notes);

    RETURN jsonb_build_object('success', true);
END;
$$;


ALTER FUNCTION "public"."admin_reject_payout_full"("p_request_id" "uuid", "p_admin_notes" "text", "p_admin_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_reject_refund_full"("p_refund_id" "uuid", "p_admin_notes" "text" DEFAULT NULL::"text", "p_admin_id" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_old_status TEXT;
BEGIN
    SELECT status INTO v_old_status FROM refunds WHERE id = p_refund_id;
    UPDATE refunds SET status = 'rejected', admin_notes = COALESCE(p_admin_notes, admin_notes), processed_at = NOW(), updated_at = NOW()
    WHERE id = p_refund_id;
    INSERT INTO refund_actions (refund_id, action_type, decision, admin_notes, processed_by)
    VALUES (p_refund_id, 'rejected', 'no_refund', p_admin_notes, p_admin_id);
    INSERT INTO refund_audit_logs (refund_id, action, old_status, new_status, changed_by, notes)
    VALUES (p_refund_id, 'reject_refund', v_old_status, 'rejected', p_admin_id, p_admin_notes);
    RETURN jsonb_build_object('success', true);
END;
$$;


ALTER FUNCTION "public"."admin_reject_refund_full"("p_refund_id" "uuid", "p_admin_notes" "text", "p_admin_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_release_driver_payout"("p_payout_id" "uuid", "p_admin_id" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
    UPDATE driver_payouts SET is_held = false, hold_reason = NULL, updated_at = NOW()
    WHERE id = p_payout_id;
    RETURN jsonb_build_object('success', true);
END;
$$;


ALTER FUNCTION "public"."admin_release_driver_payout"("p_payout_id" "uuid", "p_admin_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_resolve_dispute_full"("p_dispute_id" "uuid", "p_resolution" "text" DEFAULT NULL::"text", "p_status" "text" DEFAULT 'resolved'::"text", "p_admin_id" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_old_status TEXT;
BEGIN
    SELECT status INTO v_old_status FROM ride_disputes WHERE id = p_dispute_id;
    UPDATE ride_disputes SET
        status = p_status,
        resolution = p_resolution,
        resolved_by = p_admin_id,
        resolved_at = NOW(),
        updated_at = NOW()
    WHERE id = p_dispute_id;
    INSERT INTO dispute_status_history (dispute_id, old_status, new_status, changed_by, notes)
    VALUES (p_dispute_id, v_old_status, p_status, p_admin_id, p_resolution);
    RETURN jsonb_build_object('success', true);
END;
$$;


ALTER FUNCTION "public"."admin_resolve_dispute_full"("p_dispute_id" "uuid", "p_resolution" "text", "p_status" "text", "p_admin_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_respond_to_emergency"("p_alert_id" "uuid", "p_action" "text", "p_notes" "text" DEFAULT NULL::"text", "p_admin_id" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
    -- Log the response
    INSERT INTO emergency_responses (alert_id, admin_id, action, notes) VALUES (p_alert_id, p_admin_id, p_action, p_notes);

    -- Update alert status based on action
    IF p_action IN ('marked_responding') THEN
        UPDATE emergency_alerts SET status = 'responding', responded_at = NOW() WHERE id = p_alert_id;
    END IF;
    IF p_action IN ('marked_resolved') THEN
        UPDATE emergency_alerts SET status = 'resolved', resolved_at = NOW(), resolved_by = p_admin_id WHERE id = p_alert_id;
    END IF;
    IF p_action IN ('marked_false_alarm') THEN
        UPDATE emergency_alerts SET status = 'false_alarm', resolved_at = NOW(), resolved_by = p_admin_id WHERE id = p_alert_id;
    END IF;
    IF p_action IN ('escalated') THEN
        UPDATE emergency_alerts SET priority = 'critical' WHERE id = p_alert_id AND priority != 'critical';
    END IF;
    RETURN jsonb_build_object('success', true);
END;
$$;


ALTER FUNCTION "public"."admin_respond_to_emergency"("p_alert_id" "uuid", "p_action" "text", "p_notes" "text", "p_admin_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_retry_failed_payout"("p_request_id" "uuid", "p_admin_id" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_old_status TEXT;
BEGIN
    SELECT status INTO v_old_status FROM driver_payout_requests WHERE id = p_request_id;

    UPDATE driver_payout_requests SET
        status = 'processing',
        failure_reason = NULL,
        updated_at = NOW()
    WHERE id = p_request_id AND status = 'failed';

    INSERT INTO payout_audit_logs (payout_request_id, action, old_status, new_status, changed_by, notes)
    VALUES (p_request_id, 'retry_payout', v_old_status, 'processing', p_admin_id, 'Retry initiated');

    RETURN jsonb_build_object('success', true);
END;
$$;


ALTER FUNCTION "public"."admin_retry_failed_payout"("p_request_id" "uuid", "p_admin_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_retry_failed_refund"("p_refund_id" "uuid", "p_admin_id" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
    UPDATE refunds SET status = 'processing', failure_reason = NULL, updated_at = NOW()
    WHERE id = p_refund_id AND status = 'failed';
    INSERT INTO refund_audit_logs (refund_id, action, old_status, new_status, changed_by, notes)
    VALUES (p_refund_id, 'retry_refund', 'failed', 'processing', p_admin_id, 'Retry initiated');
    RETURN jsonb_build_object('success', true);
END;
$$;


ALTER FUNCTION "public"."admin_retry_failed_refund"("p_refund_id" "uuid", "p_admin_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_retry_payment_transaction"("p_transaction_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
    UPDATE payment_transactions SET
        retry_count = retry_count + 1,
        last_retry_at = NOW(),
        provider_status = 'pending',
        error_message = NULL,
        updated_at = NOW()
    WHERE id = p_transaction_id;
    RETURN jsonb_build_object('success', true);
END;
$$;


ALTER FUNCTION "public"."admin_retry_payment_transaction"("p_transaction_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_retry_refund"("p_refund_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
    UPDATE refunds
    SET
        status = 'pending',
        failure_reason = NULL,
        updated_at = NOW()
    WHERE id = p_refund_id AND status IN ('failed');

    RETURN jsonb_build_object('success', true, 'id', p_refund_id);
END;
$$;


ALTER FUNCTION "public"."admin_retry_refund"("p_refund_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_search_trips_enriched"("p_search" "text" DEFAULT ''::"text", "p_city" "text" DEFAULT NULL::"text", "p_status" "text" DEFAULT NULL::"text", "p_safety_status" "text" DEFAULT NULL::"text", "p_date_from" "text" DEFAULT NULL::"text", "p_date_to" "text" DEFAULT NULL::"text", "p_limit" integer DEFAULT 20) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_result JSONB;
BEGIN
    WITH filtered AS (
        SELECT
            r.id AS ride_id, r.driver_id, r.status, r.created_at, r.city,
            r.pickup_address, r.dropoff_address, r.fare, r.distance_km, r.duration_min,
            r.safety_flagged, r.safety_flag_reason, r.reviewed_by, r.reviewed_at,
            ru.full_name AS rider_name, ru.phone AS rider_phone,
            du.full_name AS driver_name, du.phone AS driver_phone,
            v.plate_number, v.make, v.model, v.color, r.vehicle_class,
            (SELECT COUNT(*) FROM ride_location_points rlp WHERE rlp.ride_id = r.id) AS gps_point_count,
            (SELECT COUNT(*) FROM ride_safety_events rse WHERE rse.ride_id = r.id) AS safety_event_count,
            (SELECT COUNT(*) FROM ride_disputes rd WHERE rd.ride_id = r.id AND rd.status NOT IN ('resolved','closed')) AS active_dispute_count
        FROM rides r
        LEFT JOIN riders ri ON ri.id = r.rider_id
        LEFT JOIN users ru ON ru.id = ri.user_id
        LEFT JOIN drivers d ON d.id = r.driver_id
        LEFT JOIN users du ON du.id = d.user_id
        LEFT JOIN vehicles v ON v.id = d.vehicle_id
        WHERE
            (p_search = '' 
                OR r.id::text ILIKE '%' || p_search || '%'
                OR ru.full_name ILIKE '%' || p_search || '%'
                OR ru.phone ILIKE '%' || p_search || '%'
                OR du.full_name ILIKE '%' || p_search || '%'
                OR du.phone ILIKE '%' || p_search || '%'
                OR v.plate_number ILIKE '%' || p_search || '%')
            AND (p_city IS NULL OR r.city = p_city)
            AND (p_status IS NULL OR r.status = p_status)
            AND (p_date_from IS NULL OR r.created_at >= p_date_from::timestamptz)
            AND (p_date_to IS NULL OR r.created_at <= p_date_to::timestamptz)
        ORDER BY r.created_at DESC
        LIMIT p_limit
    )
    SELECT jsonb_build_object(
        'data', COALESCE((SELECT jsonb_agg(f.*) FROM filtered f), '[]'::jsonb)
    ) INTO v_result;
    RETURN v_result;
END;
$$;


ALTER FUNCTION "public"."admin_search_trips_enriched"("p_search" "text", "p_city" "text", "p_status" "text", "p_safety_status" "text", "p_date_from" "text", "p_date_to" "text", "p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_service_zone_summary"("p_zone_id" "uuid" DEFAULT NULL::"uuid") RETURNS TABLE("zone_id" "uuid", "zone_name" "text", "city" "text", "zone_type" "text", "status" "text", "online_drivers" bigint, "trips_24h" bigint, "airport_queue" bigint, "manual_surge_active" boolean, "surge_multiplier" numeric)
    LANGUAGE "sql" STABLE
    AS $$
  SELECT
    z.id,
    z.name,
    z.city,
    z.zone_type,
    z.status,
    0::BIGINT AS online_drivers,
    COALESCE((SELECT COUNT(*) FROM public.rides r WHERE r.created_at >= NOW() - INTERVAL '24 hours' AND r.status = 'completed'), 0)::BIGINT AS trips_24h,
    COALESCE((SELECT COUNT(*) FROM public.airport_zone_queue q WHERE q.zone_id = z.id AND q.status = 'waiting'), 0)::BIGINT AS airport_queue,
    COALESCE((z.surge_settings->>'manual_active')::BOOLEAN, false) AS manual_surge_active,
    COALESCE((z.surge_settings->>'multiplier')::NUMERIC, 1) AS surge_multiplier
  FROM public.service_zones z
  WHERE p_zone_id IS NULL OR z.id = p_zone_id;
$$;


ALTER FUNCTION "public"."admin_service_zone_summary"("p_zone_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_suspend_driver"("p_driver_id" "uuid", "p_reason" "text" DEFAULT 'Suspended by admin'::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  UPDATE drivers
  SET is_online = false,
      can_go_online = false,
      suspension_reason = p_reason,
      updated_at = NOW()
  WHERE id = p_driver_id;

  RETURN jsonb_build_object('success', true);
END;
$$;


ALTER FUNCTION "public"."admin_suspend_driver"("p_driver_id" "uuid", "p_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_trip_playback_stats"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_total_trips INT;
    v_gps_trips INT;
    v_flagged_trips INT;
    v_disputed_trips INT;
BEGIN
    SELECT COUNT(*) INTO v_total_trips FROM rides;
    SELECT COUNT(*) INTO v_gps_trips FROM rides r WHERE EXISTS (SELECT 1 FROM ride_location_points rlp WHERE rlp.ride_id = r.id);
    SELECT COUNT(*) INTO v_flagged_trips FROM rides WHERE safety_flagged = true;
    SELECT COUNT(*) INTO v_disputed_trips FROM ride_disputes WHERE status NOT IN ('resolved','closed');
    RETURN jsonb_build_object(
        'total_trips', v_total_trips,
        'gps_trips', v_gps_trips,
        'flagged_trips', v_flagged_trips,
        'disputed_trips', v_disputed_trips
    );
END;
$$;


ALTER FUNCTION "public"."admin_trip_playback_stats"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_unsuspend_driver"("p_driver_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  UPDATE drivers
  SET
    can_go_online = true,
    is_online = false,
    online_status = 'offline',
    suspension_reason = NULL,
    status = 'active',
    approval_status = 'approved',
    is_approved = true,
    is_available = true,
    updated_at = NOW()
  WHERE id = p_driver_id;

  UPDATE driver_locations
  SET
    is_online = false,
    updated_at = NOW(),
    last_seen_at = NOW()
  WHERE driver_id = p_driver_id;

  RETURN jsonb_build_object('success', true);
END;
$$;


ALTER FUNCTION "public"."admin_unsuspend_driver"("p_driver_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_update_city"("p_city_id" "uuid", "p_name" "text" DEFAULT NULL::"text", "p_region" "text" DEFAULT NULL::"text", "p_country_id" "uuid" DEFAULT NULL::"uuid", "p_is_active" boolean DEFAULT NULL::boolean) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  UPDATE cities
  SET name = COALESCE(p_name, name),
      region = COALESCE(p_region, region),
      country_id = COALESCE(p_country_id, country_id),
      is_active = COALESCE(p_is_active, is_active)
  WHERE id = p_city_id;
  RETURN jsonb_build_object('success', true);
END;
$$;


ALTER FUNCTION "public"."admin_update_city"("p_city_id" "uuid", "p_name" "text", "p_region" "text", "p_country_id" "uuid", "p_is_active" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_update_commission_config"("p_vehicle_class" "text", "p_commission_percent" numeric DEFAULT NULL::numeric, "p_min_commission" numeric DEFAULT NULL::numeric, "p_max_commission" numeric DEFAULT NULL::numeric, "p_is_active" boolean DEFAULT NULL::boolean, "p_notes" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
    UPDATE commission_configs SET
        commission_percent = COALESCE(p_commission_percent, commission_percent),
        driver_percent = CASE WHEN p_commission_percent IS NOT NULL THEN 100 - p_commission_percent ELSE driver_percent END,
        min_commission = COALESCE(p_min_commission, min_commission),
        max_commission = COALESCE(p_max_commission, max_commission),
        is_active = COALESCE(p_is_active, is_active),
        notes = COALESCE(p_notes, notes),
        updated_at = NOW()
    WHERE vehicle_class = p_vehicle_class;
    RETURN jsonb_build_object('success', true);
END;
$$;


ALTER FUNCTION "public"."admin_update_commission_config"("p_vehicle_class" "text", "p_commission_percent" numeric, "p_min_commission" numeric, "p_max_commission" numeric, "p_is_active" boolean, "p_notes" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_update_driver"("p_driver_id" "uuid", "p_full_name" "text" DEFAULT NULL::"text", "p_phone" "text" DEFAULT NULL::"text", "p_email" "text" DEFAULT NULL::"text", "p_address" "text" DEFAULT NULL::"text", "p_can_go_online" boolean DEFAULT NULL::boolean, "p_plate_number" "text" DEFAULT NULL::"text", "p_vehicle_make" "text" DEFAULT NULL::"text", "p_vehicle_model" "text" DEFAULT NULL::"text", "p_vehicle_year" integer DEFAULT NULL::integer, "p_vehicle_color" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_user_id UUID;
  v_vehicle_id UUID;
BEGIN
  -- 1. Update the users table (full_name, phone, email)
  SELECT user_id INTO v_user_id FROM drivers WHERE id = p_driver_id;
  
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Driver user relation not found');
  END IF;

  UPDATE users
  SET full_name = COALESCE(p_full_name, full_name),
      phone = COALESCE(p_phone, phone),
      email = COALESCE(p_email, email),
      updated_at = NOW()
  WHERE id = v_user_id;

  -- 2. Update drivers table (address, can_go_online)
  UPDATE drivers
  SET address = COALESCE(p_address, address),
      can_go_online = COALESCE(p_can_go_online, can_go_online),
      updated_at = NOW()
  WHERE id = p_driver_id;

  -- 3. Update or insert vehicle
  IF p_plate_number IS NOT NULL AND p_plate_number != '' THEN
    SELECT vehicle_id INTO v_vehicle_id FROM drivers WHERE id = p_driver_id;
    
    IF v_vehicle_id IS NOT NULL THEN
      UPDATE vehicles
      SET plate_number = COALESCE(p_plate_number, plate_number),
          make = COALESCE(p_vehicle_make, make),
          model = COALESCE(p_vehicle_model, model),
          year = COALESCE(p_vehicle_year, year),
          color = COALESCE(p_vehicle_color, color),
          updated_at = NOW()
      WHERE id = v_vehicle_id;
    ELSE
      -- Create new vehicle and link to driver
      INSERT INTO vehicles (driver_id, vehicle_type, plate_number, make, model, year, color)
      VALUES (p_driver_id, 'economy', p_plate_number, p_vehicle_make, p_vehicle_model, p_vehicle_year, p_vehicle_color)
      RETURNING id INTO v_vehicle_id;
      
      UPDATE drivers SET vehicle_id = v_vehicle_id WHERE id = p_driver_id;
    END IF;
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;


ALTER FUNCTION "public"."admin_update_driver"("p_driver_id" "uuid", "p_full_name" "text", "p_phone" "text", "p_email" "text", "p_address" "text", "p_can_go_online" boolean, "p_plate_number" "text", "p_vehicle_make" "text", "p_vehicle_model" "text", "p_vehicle_year" integer, "p_vehicle_color" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_update_fraud_rule"("p_rule_name" "text", "p_threshold_value" numeric DEFAULT NULL::numeric, "p_threshold_count" integer DEFAULT NULL::integer, "p_action" "text" DEFAULT NULL::"text", "p_is_active" boolean DEFAULT NULL::boolean) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
    UPDATE fraud_protection_rules SET
        threshold_value = COALESCE(p_threshold_value, threshold_value),
        threshold_count = COALESCE(p_threshold_count, threshold_count),
        action = COALESCE(p_action, action),
        is_active = COALESCE(p_is_active, is_active),
        updated_at = NOW()
    WHERE rule_name = p_rule_name;
    RETURN jsonb_build_object('success', true);
END;
$$;


ALTER FUNCTION "public"."admin_update_fraud_rule"("p_rule_name" "text", "p_threshold_value" numeric, "p_threshold_count" integer, "p_action" "text", "p_is_active" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_update_incident"("p_incident_id" "uuid", "p_status" "text" DEFAULT NULL::"text", "p_severity" "text" DEFAULT NULL::"text", "p_assigned_admin_id" "uuid" DEFAULT NULL::"uuid", "p_resolution" "text" DEFAULT NULL::"text", "p_notes" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE v_old_status TEXT;
BEGIN
    SELECT status INTO v_old_status FROM safety_incidents WHERE id = p_incident_id;
    UPDATE safety_incidents SET status = COALESCE(p_status, status), severity = COALESCE(p_severity, severity),
        assigned_admin_id = COALESCE(p_assigned_admin_id, assigned_admin_id),
        resolution = COALESCE(p_resolution, resolution),
        resolved_at = CASE WHEN p_status IN ('resolved','closed') THEN NOW() ELSE resolved_at END,
        updated_at = NOW() WHERE id = p_incident_id;
    INSERT INTO incident_status_history (incident_id, old_status, new_status, notes) VALUES (p_incident_id, v_old_status, COALESCE(p_status, v_old_status), p_notes);
    RETURN jsonb_build_object('success', true);
END; $$;


ALTER FUNCTION "public"."admin_update_incident"("p_incident_id" "uuid", "p_status" "text", "p_severity" "text", "p_assigned_admin_id" "uuid", "p_resolution" "text", "p_notes" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_update_payout_setting"("p_key" "text", "p_value" "text", "p_admin_id" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
    UPDATE payout_settings SET setting_value = p_value, updated_by = p_admin_id, updated_at = NOW()
    WHERE setting_key = p_key;
    RETURN jsonb_build_object('success', true);
END;
$$;


ALTER FUNCTION "public"."admin_update_payout_setting"("p_key" "text", "p_value" "text", "p_admin_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_update_pricing_config"("p_config_id" "uuid", "p_base_fare" numeric DEFAULT NULL::numeric, "p_minimum_fare" numeric DEFAULT NULL::numeric, "p_max_fare_cap" numeric DEFAULT NULL::numeric, "p_per_km" numeric DEFAULT NULL::numeric, "p_per_min" numeric DEFAULT NULL::numeric, "p_booking_fee" numeric DEFAULT NULL::numeric, "p_waiting_fee" numeric DEFAULT NULL::numeric, "p_cancellation_fee" numeric DEFAULT NULL::numeric, "p_free_waiting_minutes" integer DEFAULT NULL::integer, "p_night_multiplier" numeric DEFAULT NULL::numeric, "p_night_start_time" time without time zone DEFAULT NULL::time without time zone, "p_night_end_time" time without time zone DEFAULT NULL::time without time zone, "p_tax_enabled" boolean DEFAULT NULL::boolean, "p_tax_percent" numeric DEFAULT NULL::numeric, "p_tax_name" "text" DEFAULT NULL::"text", "p_commission_percent" numeric DEFAULT NULL::numeric, "p_currency" "text" DEFAULT NULL::"text", "p_is_active" boolean DEFAULT NULL::boolean) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
    UPDATE pricing_config
    SET
        base_fare = COALESCE(p_base_fare, base_fare),
        minimum_fare = COALESCE(p_minimum_fare, minimum_fare),
        max_fare_cap = COALESCE(p_max_fare_cap, max_fare_cap),
        per_km = COALESCE(p_per_km, per_km),
        per_min = COALESCE(p_per_min, per_min),
        booking_fee = COALESCE(p_booking_fee, booking_fee),
        waiting_fee = COALESCE(p_waiting_fee, waiting_fee),
        cancellation_fee = COALESCE(p_cancellation_fee, cancellation_fee),
        free_waiting_minutes = COALESCE(p_free_waiting_minutes, free_waiting_minutes),
        night_multiplier = COALESCE(p_night_multiplier, night_multiplier),
        night_start_time = COALESCE(p_night_start_time, night_start_time),
        night_end_time = COALESCE(p_night_end_time, night_end_time),
        tax_enabled = COALESCE(p_tax_enabled, tax_enabled),
        tax_percent = COALESCE(p_tax_percent, tax_percent),
        tax_name = COALESCE(p_tax_name, tax_name),
        commission_percent = COALESCE(p_commission_percent, commission_percent),
        currency = COALESCE(p_currency, currency),
        is_active = COALESCE(p_is_active, is_active),
        updated_at = NOW()
    WHERE id = p_config_id;

    RETURN jsonb_build_object('success', true, 'id', p_config_id);
END;
$$;


ALTER FUNCTION "public"."admin_update_pricing_config"("p_config_id" "uuid", "p_base_fare" numeric, "p_minimum_fare" numeric, "p_max_fare_cap" numeric, "p_per_km" numeric, "p_per_min" numeric, "p_booking_fee" numeric, "p_waiting_fee" numeric, "p_cancellation_fee" numeric, "p_free_waiting_minutes" integer, "p_night_multiplier" numeric, "p_night_start_time" time without time zone, "p_night_end_time" time without time zone, "p_tax_enabled" boolean, "p_tax_percent" numeric, "p_tax_name" "text", "p_commission_percent" numeric, "p_currency" "text", "p_is_active" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_update_tax_config"("p_tax_name" "text", "p_tax_percent" numeric DEFAULT NULL::numeric, "p_fixed_amount" numeric DEFAULT NULL::numeric, "p_is_active" boolean DEFAULT NULL::boolean, "p_applies_to" "text" DEFAULT NULL::"text", "p_description" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
    UPDATE tax_configs SET
        tax_percent = COALESCE(p_tax_percent, tax_percent),
        fixed_amount = COALESCE(p_fixed_amount, fixed_amount),
        is_active = COALESCE(p_is_active, is_active),
        applies_to = COALESCE(p_applies_to, applies_to),
        description = COALESCE(p_description, description),
        updated_at = NOW()
    WHERE tax_name = p_tax_name;
    RETURN jsonb_build_object('success', true);
END;
$$;


ALTER FUNCTION "public"."admin_update_tax_config"("p_tax_name" "text", "p_tax_percent" numeric, "p_fixed_amount" numeric, "p_is_active" boolean, "p_applies_to" "text", "p_description" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_upsert_driver_incentive"("p_incentive_id" "uuid" DEFAULT NULL::"uuid", "p_country_code" "text" DEFAULT 'MW'::"text", "p_city" "text" DEFAULT NULL::"text", "p_incentive_type" "text" DEFAULT 'trip_bonus'::"text", "p_incentive_label" "text" DEFAULT 'Bonus'::"text", "p_description" "text" DEFAULT NULL::"text", "p_required_trips" integer DEFAULT 0, "p_time_window_hours" integer DEFAULT 24, "p_reward_amount" numeric DEFAULT 0, "p_reward_type" "text" DEFAULT 'bonus'::"text", "p_fare_multiplier" numeric DEFAULT 1.00, "p_starts_at" timestamp with time zone DEFAULT NULL::timestamp with time zone, "p_ends_at" timestamp with time zone DEFAULT NULL::timestamp with time zone, "p_is_active" boolean DEFAULT true) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_id UUID;
BEGIN
    IF p_incentive_id IS NOT NULL THEN
        UPDATE pricing_driver_incentives
        SET
            country_code = p_country_code,
            city = p_city,
            incentive_type = p_incentive_type,
            incentive_label = p_incentive_label,
            description = p_description,
            required_trips = p_required_trips,
            time_window_hours = p_time_window_hours,
            reward_amount = p_reward_amount,
            reward_type = p_reward_type,
            fare_multiplier = p_fare_multiplier,
            starts_at = p_starts_at,
            ends_at = p_ends_at,
            is_active = p_is_active,
            updated_at = NOW()
        WHERE id = p_incentive_id
        RETURNING id INTO v_id;
    ELSE
        INSERT INTO pricing_driver_incentives (country_code, city, incentive_type, incentive_label, description, required_trips, time_window_hours, reward_amount, reward_type, fare_multiplier, starts_at, ends_at, is_active)
        VALUES (p_country_code, p_city, p_incentive_type, p_incentive_label, p_description, p_required_trips, p_time_window_hours, p_reward_amount, p_reward_type, p_fare_multiplier, p_starts_at, p_ends_at, p_is_active)
        RETURNING id INTO v_id;
    END IF;

    RETURN jsonb_build_object('success', true, 'id', v_id);
END;
$$;


ALTER FUNCTION "public"."admin_upsert_driver_incentive"("p_incentive_id" "uuid", "p_country_code" "text", "p_city" "text", "p_incentive_type" "text", "p_incentive_label" "text", "p_description" "text", "p_required_trips" integer, "p_time_window_hours" integer, "p_reward_amount" numeric, "p_reward_type" "text", "p_fare_multiplier" numeric, "p_starts_at" timestamp with time zone, "p_ends_at" timestamp with time zone, "p_is_active" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_upsert_reward_definition"("p_id" "uuid" DEFAULT NULL::"uuid", "p_name" "text" DEFAULT ''::"text", "p_description" "text" DEFAULT ''::"text", "p_reward_type" "text" DEFAULT 'voucher'::"text", "p_value" numeric DEFAULT 0, "p_points_cost" integer DEFAULT 0, "p_min_tier" "text" DEFAULT NULL::"text", "p_min_rides" integer DEFAULT 0, "p_max_redemptions" integer DEFAULT 9999, "p_is_active" boolean DEFAULT true, "p_is_featured" boolean DEFAULT false, "p_is_achievement" boolean DEFAULT false, "p_achievement_trigger" "text" DEFAULT NULL::"text", "p_icon" "text" DEFAULT NULL::"text", "p_accent_color" "text" DEFAULT '#F97316'::"text", "p_sort_order" integer DEFAULT 0, "p_starts_at" "text" DEFAULT NULL::"text", "p_expires_at" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."admin_upsert_reward_definition"("p_id" "uuid", "p_name" "text", "p_description" "text", "p_reward_type" "text", "p_value" numeric, "p_points_cost" integer, "p_min_tier" "text", "p_min_rides" integer, "p_max_redemptions" integer, "p_is_active" boolean, "p_is_featured" boolean, "p_is_achievement" boolean, "p_achievement_trigger" "text", "p_icon" "text", "p_accent_color" "text", "p_sort_order" integer, "p_starts_at" "text", "p_expires_at" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_upsert_surge_rule"("p_rule_id" "uuid" DEFAULT NULL::"uuid", "p_country_code" "text" DEFAULT 'MW'::"text", "p_city" "text" DEFAULT NULL::"text", "p_surge_type" "text" DEFAULT 'custom'::"text", "p_surge_label" "text" DEFAULT 'Custom Surge'::"text", "p_multiplier" numeric DEFAULT 1.00, "p_start_time" time without time zone DEFAULT NULL::time without time zone, "p_end_time" time without time zone DEFAULT NULL::time without time zone, "p_days_of_week" integer[] DEFAULT NULL::integer[], "p_priority" integer DEFAULT 0, "p_is_active" boolean DEFAULT true) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_id UUID;
BEGIN
    IF p_rule_id IS NOT NULL THEN
        UPDATE pricing_surge_rules
        SET
            country_code = p_country_code,
            city = p_city,
            surge_type = p_surge_type,
            surge_label = p_surge_label,
            multiplier = p_multiplier,
            start_time = p_start_time,
            end_time = p_end_time,
            days_of_week = p_days_of_week,
            priority = p_priority,
            is_active = p_is_active,
            updated_at = NOW()
        WHERE id = p_rule_id
        RETURNING id INTO v_id;
    ELSE
        INSERT INTO pricing_surge_rules (country_code, city, surge_type, surge_label, multiplier, start_time, end_time, days_of_week, priority, is_active)
        VALUES (p_country_code, p_city, p_surge_type, p_surge_label, p_multiplier, p_start_time, p_end_time, p_days_of_week, p_priority, p_is_active)
        RETURNING id INTO v_id;
    END IF;

    RETURN jsonb_build_object('success', true, 'id', v_id);
END;
$$;


ALTER FUNCTION "public"."admin_upsert_surge_rule"("p_rule_id" "uuid", "p_country_code" "text", "p_city" "text", "p_surge_type" "text", "p_surge_label" "text", "p_multiplier" numeric, "p_start_time" time without time zone, "p_end_time" time without time zone, "p_days_of_week" integer[], "p_priority" integer, "p_is_active" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."apply_driver_wallet_transaction_to_wallet"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_amount DECIMAL(12,2);
BEGIN
  IF COALESCE(NEW.transaction_type, '') IN ('withdrawal', 'payout', 'transfer')
     AND COALESCE(NEW.amount, 0) < 0
     AND COALESCE(NEW.status, 'pending') IN ('pending', 'approved', 'processing') THEN
    v_amount := ABS(NEW.amount);

    UPDATE public.driver_wallets
    SET
      available_balance = NEW.balance_after,
      available_for_withdrawal = NEW.balance_after,
      balance = NEW.balance_after,
      total_withdrawn = COALESCE(total_withdrawn, 0) + v_amount,
      updated_at = NOW()
    WHERE driver_id = NEW.driver_id
      AND COALESCE(available_balance, available_for_withdrawal, balance, 0) = COALESCE(NEW.balance_before, 0);
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."apply_driver_wallet_transaction_to_wallet"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."assign_driver"("p_ride_id" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_driver_id uuid;
  v_req_id uuid;
  v_ride rides%ROWTYPE;
BEGIN
  SELECT *
  INTO v_ride
  FROM rides
  WHERE id = p_ride_id;

  IF v_ride.id IS NULL THEN
    RAISE EXCEPTION 'Ride not found';
  END IF;

  SELECT d.id
  INTO v_driver_id
  FROM drivers d
  JOIN driver_locations dl ON dl.driver_id = d.id
  WHERE d.is_online = true
    AND d.is_available = true
    AND d.can_go_online = true
    AND COALESCE(d.approval_status, '') = 'approved'
    AND dl.is_online = true
    AND dl.latitude IS NOT NULL
    AND dl.longitude IS NOT NULL
  ORDER BY dl.updated_at DESC
  LIMIT 1;

  IF v_driver_id IS NULL THEN
    UPDATE rides
    SET status = 'no_drivers',
        updated_at = NOW()
    WHERE id = p_ride_id;

    RAISE EXCEPTION 'No online drivers available';
  END IF;

  UPDATE rides
  SET
    status = 'searching',
    driver_id = v_driver_id,
    updated_at = NOW()
  WHERE id = p_ride_id;

  INSERT INTO ride_requests (
    id,
    ride_id,
    driver_id,
    rider_id,
    pickup_address,
    pickup_lat,
    pickup_lng,
    destination_address,
    destination_lat,
    destination_lng,
    status,
    vehicle_class,
    estimated_fare,
    payment_method,
    expires_at,
    created_at,
    updated_at
  )
  VALUES (
    gen_random_uuid(),
    p_ride_id,
    v_driver_id,
    v_ride.rider_id,
    v_ride.pickup_address,
    v_ride.pickup_lat,
    v_ride.pickup_lng,
    v_ride.dropoff_address,
    v_ride.dropoff_lat,
    v_ride.dropoff_lng,
    'pending',
    COALESCE(v_ride.vehicle_type, 'standard'),
    COALESCE(v_ride.estimated_fare, v_ride.fare, 0),
    COALESCE(v_ride.payment_method, 'cash'),
    NOW() + INTERVAL '30 seconds',
    NOW(),
    NOW()
  )
  RETURNING id INTO v_req_id;

  RETURN v_req_id;
END;
$$;


ALTER FUNCTION "public"."assign_driver"("p_ride_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."auto_assign_referral_code_on_approval"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
BEGIN
  -- When driver gets approved and has no referral code, generate one
  IF NEW.approval_status = 'approved' AND OLD.approval_status <> 'approved' AND NEW.referral_code IS NULL THEN
    PERFORM public.generate_referral_code(NEW.id, 'driver');
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."auto_assign_referral_code_on_approval"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."auto_complete_referral_on_first_trip"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE
  v_referral_id UUID;
  v_campaign_id UUID;
  v_bonus DECIMAL(12,2);
  v_credit DECIMAL(12,2);
  v_verdict TEXT;
BEGIN
  -- Only proceed for completed rides
  IF NEW.status <> 'completed' THEN
    RETURN NEW;
  END IF;

  -- If this ride has a driver, check for driver referral completion
  IF NEW.driver_id IS NOT NULL THEN
    -- Check if this was the driver's first completed trip
    SELECT dr.id, dr.campaign_id
    INTO v_referral_id, v_campaign_id
    FROM public.driver_referrals dr
    WHERE dr.referred_driver_id = NEW.driver_id
    AND dr.status IN ('documents_approved', 'signed_up', 'under_review', 'pending')
    AND dr.fraud_verdict IS DISTINCT FROM 'blocked'
    ORDER BY dr.created_at ASC
    LIMIT 1;

    IF v_referral_id IS NOT NULL THEN
      -- Update referral status
      UPDATE public.driver_referrals
      SET status = 'first_trip_completed',
          updated_at = NOW()
      WHERE id = v_referral_id;

      -- Log status change
      INSERT INTO public.referral_events (referral_id, referral_type, event_type,
        old_status, new_status, actor_type)
      VALUES (v_referral_id, 'driver', 'status_change',
        'documents_approved', 'first_trip_completed', 'system');

      -- Run fraud check
      v_verdict := public.check_referral_fraud(v_referral_id, 'driver');

      -- Auto-approve bonus if safe
      IF v_verdict = 'safe' THEN
        -- Get campaign bonus
        SELECT COALESCE(rc.driver_bonus_amount, 5000)
        INTO v_bonus
        FROM public.referral_campaigns rc
        WHERE rc.id = v_campaign_id AND rc.is_active = true;

        IF v_bonus IS NULL THEN
          v_bonus := 5000; -- Default bonus
        END IF;

        UPDATE public.driver_referrals
        SET status = 'bonus_approved',
            bonus_amount = v_bonus,
            updated_at = NOW()
        WHERE id = v_referral_id;

        -- Create reward record
        INSERT INTO public.referral_rewards (referral_id, referral_type,
          recipient_id, recipient_type, amount, currency, reward_type, status)
        SELECT v_referral_id, 'driver', referrer_id, 'driver',
          v_bonus, 'MWK', 'bonus', 'pending'
        FROM public.driver_referrals WHERE id = v_referral_id;

        -- Log
        INSERT INTO public.referral_events (referral_id, referral_type, event_type,
          old_status, new_status, actor_type, metadata)
        VALUES (v_referral_id, 'driver', 'bonus_approved',
          'first_trip_completed', 'bonus_approved', 'system',
          jsonb_build_object('amount', v_bonus));
      END IF;
    END IF;
  END IF;

  -- Check rider referral completion
  IF NEW.rider_id IS NOT NULL THEN
    SELECT rr.id, rr.campaign_id
    INTO v_referral_id, v_campaign_id
    FROM public.rider_referrals rr
    WHERE rr.referred_rider_id = NEW.rider_id
    AND rr.status IN ('signed_up', 'pending')
    AND rr.fraud_verdict IS DISTINCT FROM 'blocked'
    ORDER BY rr.created_at ASC
    LIMIT 1;

    IF v_referral_id IS NOT NULL THEN
      -- Update referral status
      UPDATE public.rider_referrals
      SET status = 'first_ride_completed',
          first_ride_completed_at = NOW(),
          updated_at = NOW()
      WHERE id = v_referral_id;

      -- Log
      INSERT INTO public.referral_events (referral_id, referral_type, event_type,
        old_status, new_status, actor_type)
      VALUES (v_referral_id, 'rider', 'status_change',
        'signed_up', 'first_ride_completed', 'system');

      -- Run fraud check
      v_verdict := public.check_referral_fraud(v_referral_id, 'rider');

      -- Auto-approve credit if safe
      IF v_verdict = 'safe' THEN
        SELECT COALESCE(rc.rider_credit_amount, 1000)
        INTO v_credit
        FROM public.referral_campaigns rc
        WHERE rc.id = v_campaign_id AND rc.is_active = true;

        IF v_credit IS NULL THEN
          v_credit := 1000; -- Default credit
        END IF;

        UPDATE public.rider_referrals
        SET status = 'credit_approved',
            credit_amount = v_credit,
            updated_at = NOW()
        WHERE id = v_referral_id;

        -- Create reward record for referrer
        INSERT INTO public.referral_rewards (referral_id, referral_type,
          recipient_id, recipient_type, amount, currency, reward_type, status)
        SELECT v_referral_id, 'rider', referrer_id, 'rider',
          v_credit, 'MWK', 'credit', 'pending'
        FROM public.rider_referrals WHERE id = v_referral_id;

        -- Log
        INSERT INTO public.referral_events (referral_id, referral_type, event_type,
          old_status, new_status, actor_type, metadata)
        VALUES (v_referral_id, 'rider', 'credit_approved',
          'first_ride_completed', 'credit_approved', 'system',
          jsonb_build_object('amount', v_credit));
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."auto_complete_referral_on_first_trip"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."award_ride_loyalty_points"("p_rider_id" "uuid", "p_ride_id" "uuid", "p_fare_amount" numeric DEFAULT 0) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."award_ride_loyalty_points"("p_rider_id" "uuid", "p_ride_id" "uuid", "p_fare_amount" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."book_rider_trip"("p_rider_id" "uuid", "p_category_id" "uuid" DEFAULT NULL::"uuid", "p_vehicle_class" "text" DEFAULT NULL::"text", "p_pickup_address" "text" DEFAULT 'Current Location'::"text", "p_pickup_lat" double precision DEFAULT NULL::double precision, "p_pickup_lng" double precision DEFAULT NULL::double precision, "p_dropoff_address" "text" DEFAULT ''::"text", "p_dropoff_lat" double precision DEFAULT NULL::double precision, "p_dropoff_lng" double precision DEFAULT NULL::double precision, "p_payment_method" "text" DEFAULT 'cash'::"text", "p_estimated_fare" numeric DEFAULT 0, "p_distance_km" numeric DEFAULT NULL::numeric, "p_duration_min" integer DEFAULT NULL::integer, "p_promo_code" "text" DEFAULT NULL::"text") RETURNS "public"."rides"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_ride public.rides;
  v_vehicle_class TEXT;
  v_rider_user_id UUID;
BEGIN
  IF p_rider_id IS NULL THEN
    RAISE EXCEPTION 'Rider profile is required';
  END IF;

  SELECT user_id INTO v_rider_user_id
  FROM public.riders
  WHERE id = p_rider_id;

  IF v_rider_user_id IS NULL THEN
    RAISE EXCEPTION 'Rider profile not found';
  END IF;

  SELECT COALESCE(p_vehicle_class, rc.slug, rc.name, 'weafrica_x')
  INTO v_vehicle_class
  FROM public.ride_categories rc
  WHERE rc.id = p_category_id;

  v_vehicle_class := COALESCE(v_vehicle_class, p_vehicle_class, 'weafrica_x');

  INSERT INTO public.rides (
    rider_id,
    category_id,
    vehicle_class,
    status,
    payment_method,
    payment_status,
    estimated_fare,
    fare,
    pickup_address,
    pickup_lat,
    pickup_lng,
    dropoff_address,
    dropoff_lat,
    dropoff_lng,
    destination_address,
    destination_lat,
    destination_lng,
    estimated_distance_km,
    distance_km,
    estimated_duration_minutes,
    duration_min,
    promo_code,
    requested_at,
    updated_at
  ) VALUES (
    p_rider_id,
    p_category_id,
    v_vehicle_class,
    'requested',
    COALESCE(NULLIF(p_payment_method, ''), 'cash'),
    'pending',
    COALESCE(p_estimated_fare, 0),
    COALESCE(p_estimated_fare, 0),
    COALESCE(NULLIF(p_pickup_address, ''), 'Current Location'),
    p_pickup_lat,
    p_pickup_lng,
    COALESCE(p_dropoff_address, ''),
    p_dropoff_lat,
    p_dropoff_lng,
    COALESCE(p_dropoff_address, ''),
    p_dropoff_lat,
    p_dropoff_lng,
    p_distance_km,
    p_distance_km,
    p_duration_min,
    p_duration_min,
    NULLIF(p_promo_code, ''),
    now(),
    now()
  )
  RETURNING * INTO v_ride;

  INSERT INTO public.ride_events(ride_id, actor_id, event_type, metadata)
  VALUES (
    v_ride.id,
    v_rider_user_id,
    'rider_requested',
    jsonb_build_object(
      'source', 'rider_app',
      'payment_method', COALESCE(NULLIF(p_payment_method, ''), 'cash'),
      'estimated_fare', COALESCE(p_estimated_fare, 0)
    )
  );

  BEGIN
    PERFORM public.dispatch_ride_to_nearby_drivers(
      v_ride.id,
      p_pickup_lat,
      p_pickup_lng,
      5
    );

    SELECT * INTO v_ride FROM public.rides WHERE id = v_ride.id;
  EXCEPTION WHEN OTHERS THEN
    -- Booking should still succeed even if no dispatch worker/RPC is available.
    INSERT INTO public.ride_events(ride_id, actor_id, event_type, metadata)
    VALUES (
      v_ride.id,
      v_rider_user_id,
      'dispatch_error',
      jsonb_build_object('message', SQLERRM)
    );
  END;

  RETURN v_ride;
END;
$$;


ALTER FUNCTION "public"."book_rider_trip"("p_rider_id" "uuid", "p_category_id" "uuid", "p_vehicle_class" "text", "p_pickup_address" "text", "p_pickup_lat" double precision, "p_pickup_lng" double precision, "p_dropoff_address" "text", "p_dropoff_lat" double precision, "p_dropoff_lng" double precision, "p_payment_method" "text", "p_estimated_fare" numeric, "p_distance_km" numeric, "p_duration_min" integer, "p_promo_code" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."book_rider_trip"("p_rider_id" "uuid", "p_category_id" "uuid", "p_vehicle_class" "text", "p_pickup_address" "text", "p_pickup_lat" double precision, "p_pickup_lng" double precision, "p_dropoff_address" "text", "p_dropoff_lat" double precision, "p_dropoff_lng" double precision, "p_payment_method" "text", "p_estimated_fare" numeric, "p_distance_km" numeric, "p_duration_min" numeric, "p_promo_code" "text") RETURNS "public"."rides"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  -- your logic here
  RETURN NULL;
END;
$$;


ALTER FUNCTION "public"."book_rider_trip"("p_rider_id" "uuid", "p_category_id" "uuid", "p_vehicle_class" "text", "p_pickup_address" "text", "p_pickup_lat" double precision, "p_pickup_lng" double precision, "p_dropoff_address" "text", "p_dropoff_lat" double precision, "p_dropoff_lng" double precision, "p_payment_method" "text", "p_estimated_fare" numeric, "p_distance_km" numeric, "p_duration_min" numeric, "p_promo_code" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."bulk_update_referral_status"("p_ids" "uuid"[], "p_type" "text", "p_new_status" "text", "p_notes" "text" DEFAULT NULL::"text") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE
  updated INTEGER;
BEGIN
  IF p_type = 'driver' THEN
    UPDATE public.driver_referrals
    SET status = p_new_status, notes = COALESCE(p_notes, notes), updated_at = NOW()
    WHERE id = ANY(p_ids);
    GET DIAGNOSTICS updated = ROW_COUNT;
  ELSE
    UPDATE public.rider_referrals
    SET status = p_new_status, notes = COALESCE(p_notes, notes), updated_at = NOW()
    WHERE id = ANY(p_ids);
    GET DIAGNOSTICS updated = ROW_COUNT;
  END IF;
  RETURN updated;
END;
$$;


ALTER FUNCTION "public"."bulk_update_referral_status"("p_ids" "uuid"[], "p_type" "text", "p_new_status" "text", "p_notes" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cancel_push_notification"("p_notification_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
BEGIN
    UPDATE public.push_notifications 
    SET status = 'cancelled', updated_at = NOW()
    WHERE id = p_notification_id AND status IN ('pending', 'scheduled');
END;
$$;


ALTER FUNCTION "public"."cancel_push_notification"("p_notification_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_driver_milestones"("p_driver_id" "uuid", "p_ride_id" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."check_driver_milestones"("p_driver_id" "uuid", "p_ride_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_referral_fraud"("p_referral_id" "uuid", "p_referral_type" "text") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE
  v_referrer_id UUID;
  v_referred_id UUID;
  v_referrer_phone TEXT;
  v_referred_phone TEXT;
  v_verdict TEXT := 'safe';
  v_fail_count INT := 0;
  v_suspicious_count INT := 0;
BEGIN
  -- Get referral details
  IF p_referral_type = 'driver' THEN
    SELECT referrer_id, referred_driver_id
    INTO v_referrer_id, v_referred_id
    FROM public.driver_referrals WHERE id = p_referral_id;
  ELSE
    SELECT referrer_id, referred_rider_id
    INTO v_referrer_id, v_referred_id
    FROM public.rider_referrals WHERE id = p_referral_id;
  END IF;

  IF v_referrer_id IS NULL OR v_referred_id IS NULL THEN
    RETURN 'safe';
  END IF;

  -- Check 1: Self-referral
  IF v_referrer_id = v_referred_id THEN
    INSERT INTO public.referral_fraud_checks (referral_id, referral_type, check_type, result, details)
    VALUES (p_referral_id, p_referral_type, 'self_referral', 'fail', '{}');
    RETURN 'blocked';
  END IF;

  INSERT INTO public.referral_fraud_checks (referral_id, referral_type, check_type, result, details)
  VALUES (p_referral_id, p_referral_type, 'self_referral', 'pass', '{}');

  -- Check 2: Same phone number
  SELECT u.phone INTO v_referrer_phone FROM public.users u
  JOIN public.drivers d ON d.user_id = u.id WHERE d.id = v_referrer_id;

  IF p_referral_type = 'driver' THEN
    SELECT u.phone INTO v_referred_phone FROM public.users u
    JOIN public.drivers d ON d.user_id = u.id WHERE d.id = v_referred_id;
  ELSE
    SELECT u.phone INTO v_referred_phone FROM public.users u
    JOIN public.riders r ON r.user_id = u.id WHERE r.id = v_referred_id;
  END IF;

  IF v_referrer_phone IS NOT NULL AND v_referrer_phone = v_referred_phone THEN
    INSERT INTO public.referral_fraud_checks (referral_id, referral_type, check_type, result, details)
    VALUES (p_referral_id, p_referral_type, 'same_phone', 'fail', jsonb_build_object('phone', v_referrer_phone));
    v_fail_count := v_fail_count + 1;
  ELSE
    INSERT INTO public.referral_fraud_checks (referral_id, referral_type, check_type, result, details)
    VALUES (p_referral_id, p_referral_type, 'same_phone', 'pass', '{}');
  END IF;

  -- Check 3: Too many referrals from same referrer (more than 50 in a day)
  IF p_referral_type = 'driver' THEN
    SELECT COUNT(*) INTO v_fail_count
    FROM public.driver_referrals
    WHERE referrer_id = v_referrer_id
    AND created_at > NOW() - INTERVAL '24 hours';
  ELSE
    SELECT COUNT(*) INTO v_fail_count
    FROM public.rider_referrals
    WHERE referrer_id = v_referrer_id
    AND created_at > NOW() - INTERVAL '24 hours';
  END IF;

  IF v_fail_count > 50 THEN
    INSERT INTO public.referral_fraud_checks (referral_id, referral_type, check_type, result, details)
    VALUES (p_referral_id, p_referral_type, 'too_many_referrals', 'suspicious',
      jsonb_build_object('count_24h', v_fail_count));
    v_suspicious_count := v_suspicious_count + 1;
  ELSE
    INSERT INTO public.referral_fraud_checks (referral_id, referral_type, check_type, result, details)
    VALUES (p_referral_id, p_referral_type, 'too_many_referrals', 'pass',
      jsonb_build_object('count_24h', v_fail_count));
  END IF;

  -- Determine final verdict
  IF v_fail_count > 0 THEN
    v_verdict := 'blocked';
  ELSIF v_suspicious_count > 1 THEN
    v_verdict := 'review';
  ELSE
    v_verdict := 'safe';
  END IF;

  -- Update referral record
  IF p_referral_type = 'driver' THEN
    UPDATE public.driver_referrals
    SET fraud_verdict = v_verdict, fraud_checked_at = NOW()
    WHERE id = p_referral_id;
  ELSE
    UPDATE public.rider_referrals
    SET fraud_verdict = v_verdict, fraud_checked_at = NOW()
    WHERE id = p_referral_id;
  END IF;

  -- Log event
  INSERT INTO public.referral_events (referral_id, referral_type, event_type, actor_type, metadata)
  VALUES (p_referral_id, p_referral_type, 'fraud_detected', 'system',
    jsonb_build_object('verdict', v_verdict));

  RETURN v_verdict;
END;
$$;


ALTER FUNCTION "public"."check_referral_fraud"("p_referral_id" "uuid", "p_referral_type" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cleanup_old_driver_locations"() RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    DELETE FROM public.driver_locations
    WHERE updated_at < NOW() - INTERVAL '30 days';
END;
$$;


ALTER FUNCTION "public"."cleanup_old_driver_locations"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."complete_push_notification"("p_notification_id" "uuid", "p_delivered" integer DEFAULT 0, "p_failed" integer DEFAULT 0) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
BEGIN
    UPDATE public.push_notifications 
    SET status = 'sent', sent_at = NOW(), delivered_count = p_delivered, failed_count = p_failed, updated_at = NOW()
    WHERE id = p_notification_id;
END;
$$;


ALTER FUNCTION "public"."complete_push_notification"("p_notification_id" "uuid", "p_delivered" integer, "p_failed" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."complete_ride"("p_ride_id" "uuid", "p_driver_lat" numeric DEFAULT NULL::numeric, "p_driver_lng" numeric DEFAULT NULL::numeric) RETURNS "public"."rides"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_ride public.rides;
    v_payment_result jsonb;
    v_distance_to_destination DECIMAL(8,2);
    v_destination_lat DECIMAL(10,7);
    v_destination_lng DECIMAL(10,7);
    v_completion_ok BOOLEAN := true;
BEGIN
    -- Update ride status
    UPDATE public.rides
    SET status = 'completed',
        completed_at = now(),
        final_fare = COALESCE(final_fare, actual_fare, estimated_fare),
        actual_fare = COALESCE(actual_fare, final_fare, estimated_fare),
        driver_completion_lat = COALESCE(p_driver_lat, driver_completion_lat),
        driver_completion_lng = COALESCE(p_driver_lng, driver_completion_lng),
        updated_at = now()
    WHERE id = p_ride_id
      AND status = 'in_progress'
    RETURNING * INTO v_ride;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Ride cannot be completed';
    END IF;

    -- Verify driver is near destination (fraud protection)
    v_destination_lat := COALESCE(p_driver_lat, v_ride.driver_completion_lat);
    v_destination_lng := COALESCE(p_driver_lng, v_ride.driver_completion_lng);

    IF v_destination_lat IS NOT NULL AND v_destination_lng IS NOT NULL
       AND v_ride.dropoff_lat IS NOT NULL AND v_ride.dropoff_lng IS NOT NULL THEN
        -- Calculate distance using Haversine formula
        SELECT 
            6371 * 2 * ASIN(SQRT(
                POWER(SIN(RADIANS(v_destination_lat - v_ride.dropoff_lat) / 2), 2) +
                COS(RADIANS(v_ride.dropoff_lat)) * COS(RADIANS(v_destination_lat)) *
                POWER(SIN(RADIANS(v_destination_lng - v_ride.dropoff_lng) / 2), 2)
            )) INTO v_distance_to_destination;

        IF v_distance_to_destination > 0.5 THEN  -- More than 500m from destination
            v_completion_ok := false;
            -- Log fraud flag
            INSERT INTO public.fraud_flags (ride_id, flag_type, severity, description)
            VALUES (
                p_ride_id, 'completion_far_from_destination', 'medium',
                'Driver was ' || ROUND(v_distance_to_destination, 2) || ' km from destination at completion time'
            );
        END IF;
    END IF;

    UPDATE public.rides SET completion_verified = v_completion_ok
    WHERE id = p_ride_id;

    -- Log completion event
    INSERT INTO public.ride_events(ride_id, actor_id, event_type, metadata)
    VALUES (p_ride_id, v_ride.driver_id, 'trip_completed',
        jsonb_build_object(
            'verified', v_completion_ok,
            'distance_to_destination_km', v_distance_to_destination
        ));

    -- Process payment (release escrow → driver wallet + company)
    BEGIN
        SELECT public.process_ride_payment(p_ride_id) INTO v_payment_result;
    EXCEPTION WHEN OTHERS THEN
        INSERT INTO public.ride_events(ride_id, actor_id, event_type, metadata)
        VALUES (
            p_ride_id,
            v_ride.driver_id,
            'payment_processing_failed',
            jsonb_build_object('error', SQLERRM)
        );
    END;

    -- Generate invoice
    BEGIN
        PERFORM public.generate_ride_invoice(p_ride_id);
    EXCEPTION WHEN OTHERS THEN
        -- Invoice generation failure should not block completion
        NULL;
    END;

    SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id;

    RETURN v_ride;
END;
$$;


ALTER FUNCTION "public"."complete_ride"("p_ride_id" "uuid", "p_driver_lat" numeric, "p_driver_lng" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."complete_ride_with_loyalty"("p_ride_id" "uuid", "p_actual_fare" numeric DEFAULT NULL::numeric, "p_distance_km" numeric DEFAULT NULL::numeric, "p_actual_distance_km" numeric DEFAULT NULL::numeric) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."complete_ride_with_loyalty"("p_ride_id" "uuid", "p_actual_fare" numeric, "p_distance_km" numeric, "p_actual_distance_km" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compute_driver_graduation"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    -- Auto-compute can_go_online
    NEW.can_go_online := (
        COALESCE(NEW.onboarding_completed, false)
        AND COALESCE(NEW.documents_verified, false)
        AND COALESCE(NEW.vehicle_verified, false)
        AND COALESCE(NEW.approval_status, 'pending') = 'approved'
    );

    -- Auto-compute tier based on performance
    IF NEW.total_rides >= 5000 AND NEW.rating >= 4.8 AND NEW.total_earnings >= 5000000 THEN
        NEW.driver_tier := 'diamond';
    ELSIF NEW.total_rides >= 2500 AND NEW.rating >= 4.7 AND NEW.total_earnings >= 3000000 THEN
        NEW.driver_tier := 'platinum';
    ELSIF NEW.total_rides >= 1000 AND NEW.rating >= 4.6 AND NEW.total_earnings >= 1500000 THEN
        NEW.driver_tier := 'gold';
    ELSIF NEW.total_rides >= 200 AND NEW.rating >= 4.5 AND NEW.total_earnings >= 400000 THEN
        NEW.driver_tier := 'silver';
    ELSE
        NEW.driver_tier := 'starter';
    END IF;

    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."compute_driver_graduation"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compute_fare_estimate"("p_country_code" "text" DEFAULT 'MW'::"text", "p_city" "text" DEFAULT NULL::"text", "p_vehicle_type" "text" DEFAULT 'economy'::"text", "p_distance_km" numeric DEFAULT 0, "p_estimated_minutes" integer DEFAULT 0, "p_is_night" boolean DEFAULT false) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_pricing RECORD;
    v_base_fare DECIMAL(10,2);
    v_distance_fare DECIMAL(10,2);
    v_time_fare DECIMAL(10,2);
    v_subtotal DECIMAL(12,2);
    v_tax_amount DECIMAL(12,2);
    v_total DECIMAL(12,2);
    v_commission DECIMAL(12,2);
    v_driver_earnings DECIMAL(12,2);
    v_active_surge DECIMAL(4,2);
    v_effective_multiplier DECIMAL(4,2);
BEGIN
    -- Get pricing config for this city + vehicle type
    SELECT * INTO v_pricing
    FROM pricing_config
    WHERE country_code = p_country_code
      AND (city = p_city OR city IS NULL)
      AND (vehicle_type = p_vehicle_type OR vehicle_type = 'all')
      AND is_active = true
    ORDER BY CASE WHEN vehicle_type = p_vehicle_type THEN 0 ELSE 1 END
    LIMIT 1;

    IF v_pricing.id IS NULL THEN
        -- Fallback: global default
        SELECT * INTO v_pricing
        FROM pricing_config
        WHERE country_code = 'MW' AND vehicle_type = 'all' AND is_active = true
        LIMIT 1;
    END IF;

    IF v_pricing.id IS NULL THEN
        RETURN jsonb_build_object('error', 'No pricing config found');
    END IF;

    -- Base calculations
    v_base_fare := COALESCE(v_pricing.base_fare, 0);
    v_distance_fare := ROUND(p_distance_km * COALESCE(v_pricing.per_km, 0), 2);
    v_time_fare := ROUND(p_estimated_minutes * COALESCE(v_pricing.per_min, 0), 2);

    -- Subtotal
    v_subtotal := v_base_fare + v_distance_fare + v_time_fare + COALESCE(v_pricing.booking_fee, 0);

    -- Check minimum fare
    IF COALESCE(v_pricing.minimum_fare, 0) > v_subtotal THEN
        v_subtotal := v_pricing.minimum_fare;
    END IF;

    -- Check maximum fare cap
    IF v_pricing.max_fare_cap IS NOT NULL AND v_pricing.max_fare_cap > 0 AND v_subtotal > v_pricing.max_fare_cap THEN
        v_subtotal := v_pricing.max_fare_cap;
    END IF;

    -- Night multiplier
    v_effective_multiplier := 1.0;
    IF p_is_night AND COALESCE(v_pricing.night_multiplier, 1.0) > 1.0 THEN
        v_effective_multiplier := v_effective_multiplier * v_pricing.night_multiplier;
    END IF;

    -- Check for active surge (simplified — checks if any surge rule matches by country/city)
    SELECT COALESCE(MAX(multiplier), 1.0) INTO v_active_surge
    FROM pricing_surge_rules
    WHERE country_code = p_country_code
      AND (city = p_city OR city IS NULL)
      AND is_active = true
      AND multiplier > 1.0;

    IF v_active_surge > 1.0 THEN
        v_effective_multiplier := v_effective_multiplier * v_active_surge;
    END IF;

    -- Apply multiplier
    v_subtotal := ROUND(v_subtotal * v_effective_multiplier, 2);

    -- Tax
    IF v_pricing.tax_enabled AND COALESCE(v_pricing.tax_percent, 0) > 0 THEN
        v_tax_amount := ROUND(v_subtotal * v_pricing.tax_percent / 100.0, 2);
    ELSE
        v_tax_amount := 0;
    END IF;

    v_total := v_subtotal + v_tax_amount;

    -- Commission
    v_commission := ROUND(v_subtotal * COALESCE(v_pricing.commission_percent, 0) / 100.0, 2);
    v_driver_earnings := v_subtotal - v_commission;

    RETURN jsonb_build_object(
        'base_fare', v_base_fare,
        'distance_fare', v_distance_fare,
        'time_fare', v_time_fare,
        'booking_fee', COALESCE(v_pricing.booking_fee, 0),
        'subtotal', v_subtotal,
        'effective_multiplier', v_effective_multiplier,
        'tax_name', v_pricing.tax_name,
        'tax_percent', v_pricing.tax_percent,
        'tax_amount', v_tax_amount,
        'total', v_total,
        'commission_percent', v_pricing.commission_percent,
        'commission', v_commission,
        'driver_earnings', v_driver_earnings,
        'currency', v_pricing.currency,
        'distance_km', p_distance_km,
        'estimated_minutes', p_estimated_minutes,
        'vehicle_type', p_vehicle_type,
        'is_night', p_is_night
    );
END;
$$;


ALTER FUNCTION "public"."compute_fare_estimate"("p_country_code" "text", "p_city" "text", "p_vehicle_type" "text", "p_distance_km" numeric, "p_estimated_minutes" integer, "p_is_night" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_staff_invitation"("p_email" "text", "p_full_name" "text", "p_role_id" "uuid", "p_invited_by" "uuid", "p_city_id" "uuid" DEFAULT NULL::"uuid", "p_country_id" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_id UUID;
    v_token TEXT;
BEGIN
    IF EXISTS (
        SELECT 1 FROM public.staff_invitations
        WHERE email = p_email AND status = 'pending' AND expires_at > NOW()
    ) THEN
        RETURN jsonb_build_object('error', 'An active invitation already exists for this email');
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.admin_users au
        JOIN public.users u ON u.id = au.user_id
        WHERE u.email = p_email
    ) THEN
        RETURN jsonb_build_object('error', 'This email is already a staff member');
    END IF;

    INSERT INTO public.staff_invitations (
        email, full_name, admin_role_id, country_id, city_id, invited_by, invite_token
    ) VALUES (
        p_email, p_full_name, p_role_id, p_country_id, p_city_id, p_invited_by, gen_random_uuid()::text
    )
    RETURNING id, invite_token INTO v_id, v_token;

    RETURN jsonb_build_object('id', v_id, 'token', v_token);
END;
$$;


ALTER FUNCTION "public"."create_staff_invitation"("p_email" "text", "p_full_name" "text", "p_role_id" "uuid", "p_invited_by" "uuid", "p_city_id" "uuid", "p_country_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."credit_referral_bonus_to_wallet"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE
  v_user_id UUID;
BEGIN
  -- Only fire when bonus transitions to 'paid'
  IF NEW.status = 'bonus_paid' AND (OLD.status IS NULL OR OLD.status <> 'bonus_paid') THEN
    -- Get the referrer's user_id
    IF TG_TABLE_NAME = 'driver_referrals' THEN
      SELECT d.user_id INTO v_user_id FROM public.drivers d WHERE d.id = NEW.referrer_id;
      IF v_user_id IS NOT NULL THEN
        -- Credit driver wallet
        UPDATE public.driver_wallets
        SET available_balance = available_balance + NEW.bonus_amount,
            total_earned = total_earned + NEW.bonus_amount,
            updated_at = NOW()
        WHERE driver_id = NEW.referrer_id;
      END IF;
    ELSIF TG_TABLE_NAME = 'rider_referrals' THEN
      SELECT r.user_id INTO v_user_id FROM public.riders r WHERE r.id = NEW.referrer_id;
      IF v_user_id IS NOT NULL THEN
        -- Credit rider wallet (add ride_credits)
        UPDATE public.wallets
        SET ride_credits = COALESCE(ride_credits, 0) + NEW.credit_amount,
            updated_at = NOW()
        WHERE user_id = v_user_id;
      END IF;
    END IF;

    -- Mark reward as paid
    UPDATE public.referral_rewards
    SET status = 'paid', paid_at = NOW(), updated_at = NOW()
    WHERE referral_id = NEW.id AND referral_type = CASE WHEN TG_TABLE_NAME = 'driver_referrals' THEN 'driver' ELSE 'rider' END;
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."credit_referral_bonus_to_wallet"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."decline_ride_request"("p_request_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_request public.ride_requests;
BEGIN
  SELECT * INTO v_request
  FROM public.ride_requests
  WHERE id = p_request_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ride request not found';
  END IF;

  UPDATE public.ride_requests
  SET status = 'declined',
      responded_at = now()
  WHERE id = p_request_id;

  INSERT INTO public.ride_events(ride_id, actor_id, event_type, metadata)
  VALUES (v_request.ride_id, v_request.driver_id, 'driver_declined', jsonb_build_object('request_id', p_request_id));
END;
$$;


ALTER FUNCTION "public"."decline_ride_request"("p_request_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."dispatch_ride_to_nearby_drivers"("p_ride_id" "uuid", "p_pickup_lat" double precision DEFAULT NULL::double precision, "p_pickup_lng" double precision DEFAULT NULL::double precision, "p_max_drivers" integer DEFAULT 5) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_ride public.rides;
  v_inserted INTEGER := 0;
BEGIN
  SELECT * INTO v_ride
  FROM public.rides
  WHERE id = p_ride_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ride not found';
  END IF;

  IF v_ride.status NOT IN ('requested', 'searching') THEN
    RETURN 0;
  END IF;

  INSERT INTO public.ride_requests (
    ride_id,
    driver_id,
    status,
    expires_at,
    pickup_address,
    pickup_lat,
    pickup_lng,
    destination_address,
    destination_lat,
    destination_lng,
    vehicle_class,
    estimated_fare,
    payment_method
  )
  SELECT
    v_ride.id,
    d.id,
    'pending',
    now() + interval '30 seconds',
    v_ride.pickup_address,
    COALESCE(v_ride.pickup_lat, p_pickup_lat),
    COALESCE(v_ride.pickup_lng, p_pickup_lng),
    v_ride.dropoff_address,
    v_ride.dropoff_lat,
    v_ride.dropoff_lng,
    COALESCE(v_ride.vehicle_class, v_ride.category_id::TEXT),
    COALESCE(v_ride.estimated_fare, v_ride.fare, 0),
    COALESCE(v_ride.payment_method, 'cash')
  FROM public.drivers d
  LEFT JOIN public.driver_locations dl ON dl.driver_id = d.id
  WHERE COALESCE(d.is_online, false) = true
    AND COALESCE(d.can_go_online, true) = true
    AND COALESCE(d.approval_status, 'approved') IN ('approved', 'active')
    AND NOT EXISTS (
      SELECT 1
      FROM public.rides active
      WHERE active.driver_id = d.id
        AND active.status IN ('accepted', 'arrived', 'in_progress')
    )
  ORDER BY
    CASE
      WHEN COALESCE(v_ride.pickup_lat, p_pickup_lat) IS NOT NULL
       AND COALESCE(v_ride.pickup_lng, p_pickup_lng) IS NOT NULL
       AND dl.latitude IS NOT NULL
       AND dl.longitude IS NOT NULL
      THEN ((dl.latitude - COALESCE(v_ride.pickup_lat, p_pickup_lat)) * (dl.latitude - COALESCE(v_ride.pickup_lat, p_pickup_lat)))
         + ((dl.longitude - COALESCE(v_ride.pickup_lng, p_pickup_lng)) * (dl.longitude - COALESCE(v_ride.pickup_lng, p_pickup_lng)))
      ELSE 999999
    END,
    d.updated_at DESC NULLS LAST
  LIMIT GREATEST(1, p_max_drivers)
  ON CONFLICT (ride_id, driver_id) DO UPDATE
    SET status = 'pending',
        expires_at = EXCLUDED.expires_at,
        pickup_address = EXCLUDED.pickup_address,
        pickup_lat = EXCLUDED.pickup_lat,
        pickup_lng = EXCLUDED.pickup_lng,
        destination_address = EXCLUDED.destination_address,
        destination_lat = EXCLUDED.destination_lat,
        destination_lng = EXCLUDED.destination_lng,
        vehicle_class = EXCLUDED.vehicle_class,
        estimated_fare = EXCLUDED.estimated_fare,
        payment_method = EXCLUDED.payment_method;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  UPDATE public.rides
  SET status = CASE WHEN v_inserted > 0 THEN 'searching' ELSE 'requested' END,
      updated_at = now()
  WHERE id = p_ride_id;

  INSERT INTO public.ride_events(ride_id, event_type, metadata)
  VALUES (
    p_ride_id,
    CASE WHEN v_inserted > 0 THEN 'dispatch_sent' ELSE 'dispatch_no_drivers' END,
    jsonb_build_object('driver_count', v_inserted)
  );

  RETURN v_inserted;
END;
$$;


ALTER FUNCTION "public"."dispatch_ride_to_nearby_drivers"("p_ride_id" "uuid", "p_pickup_lat" double precision, "p_pickup_lng" double precision, "p_max_drivers" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."driver_arrived"("p_ride_id" "uuid") RETURNS "public"."rides"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_ride public.rides;
BEGIN
  UPDATE public.rides
  SET status = 'arrived',
      arrived_at = now(),
      updated_at = now()
  WHERE id = p_ride_id
    AND status IN ('accepted', 'driver_assigned', 'driver_arrived')
  RETURNING * INTO v_ride;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ride cannot be marked as arrived';
  END IF;

  INSERT INTO public.ride_events(ride_id, actor_id, event_type)
  VALUES (p_ride_id, v_ride.driver_id, 'driver_arrived');

  RETURN v_ride;
END;
$$;


ALTER FUNCTION "public"."driver_arrived"("p_ride_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."driver_cancel_ride"("p_ride_id" "uuid", "p_reason" "text" DEFAULT 'Other'::"text", "p_note" "text" DEFAULT NULL::"text") RETURNS "public"."rides"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_ride public.rides;
BEGIN
  SELECT * INTO v_ride
  FROM public.rides
  WHERE id = p_ride_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ride not found';
  END IF;

  IF v_ride.status NOT IN ('accepted', 'arrived', 'in_progress') THEN
    RAISE EXCEPTION 'Ride cannot be cancelled in status: %', v_ride.status;
  END IF;

  UPDATE public.rides
  SET status = 'driver_cancelled',
      cancelled_at = now(),
      cancelled_by = 'driver',
      cancellation_reason = p_reason,
      cancellation_note = p_note,
      updated_at = now()
  WHERE id = p_ride_id
  RETURNING * INTO v_ride;

  UPDATE public.ride_requests
  SET status = 'expired', responded_at = now()
  WHERE ride_id = p_ride_id
    AND status = 'pending';

  UPDATE public.trip_queue
  SET status = 'expired', responded_at = now()
  WHERE driver_id = v_ride.driver_id
    AND status = 'queued';

  INSERT INTO public.ride_events(ride_id, actor_id, event_type, metadata)
  VALUES (
    p_ride_id,
    v_ride.driver_id,
    'driver_cancelled',
    jsonb_build_object('reason', p_reason, 'note', p_note)
  );

  RETURN v_ride;
END;
$$;


ALTER FUNCTION "public"."driver_cancel_ride"("p_ride_id" "uuid", "p_reason" "text", "p_note" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."driver_earnings_statement"("p_driver_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_today_trips INTEGER;
    v_today_earned NUMERIC(12,2);
    v_week_trips INTEGER;
    v_week_earned NUMERIC(12,2);
    v_month_trips INTEGER;
    v_month_earned NUMERIC(12,2);
    v_total_earned NUMERIC(12,2);
    v_available_balance NUMERIC(12,2);
    v_pending_balance NUMERIC(12,2);
    v_currency TEXT;
BEGIN
    -- Get wallet data
    SELECT
        COALESCE(trips_today, 0), COALESCE(earned_today, 0),
        COALESCE(trips_this_week, 0), COALESCE(earned_this_week, 0),
        COALESCE(trips_this_month, 0), COALESCE(earned_this_month, 0),
        COALESCE(total_earned, 0), COALESCE(available_balance, 0),
        COALESCE(pending_balance, 0), COALESCE(currency, 'MWK')
    INTO
        v_today_trips, v_today_earned,
        v_week_trips, v_week_earned,
        v_month_trips, v_month_earned,
        v_total_earned, v_available_balance, v_pending_balance, v_currency
    FROM public.driver_wallets
    WHERE driver_id = p_driver_id;

    -- If wallet doesn't exist, compute from transactions
    IF v_total_earned IS NULL THEN
        SELECT
            COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE AND transaction_type = 'ride_earning'),
            COALESCE(SUM(amount) FILTER (WHERE created_at >= CURRENT_DATE AND transaction_type = 'ride_earning'), 0),
            COUNT(*) FILTER (WHERE created_at >= DATE_TRUNC('week', CURRENT_DATE) AND transaction_type = 'ride_earning'),
            COALESCE(SUM(amount) FILTER (WHERE created_at >= DATE_TRUNC('week', CURRENT_DATE) AND transaction_type = 'ride_earning'), 0),
            COUNT(*) FILTER (WHERE created_at >= DATE_TRUNC('month', CURRENT_DATE) AND transaction_type = 'ride_earning'),
            COALESCE(SUM(amount) FILTER (WHERE created_at >= DATE_TRUNC('month', CURRENT_DATE) AND transaction_type = 'ride_earning'), 0),
            COALESCE(SUM(amount) FILTER (WHERE transaction_type = 'ride_earning'), 0)
        INTO
            v_today_trips, v_today_earned,
            v_week_trips, v_week_earned,
            v_month_trips, v_month_earned,
            v_total_earned
        FROM public.driver_transactions
        WHERE driver_id = p_driver_id;
    END IF;

    RETURN jsonb_build_object(
        'currency', COALESCE(v_currency, 'MWK'),
        'available_balance', COALESCE(v_available_balance, 0),
        'pending_balance', COALESCE(v_pending_balance, 0),
        'today', jsonb_build_object(
            'trips', COALESCE(v_today_trips, 0),
            'earned', COALESCE(v_today_earned, 0)
        ),
        'this_week', jsonb_build_object(
            'trips', COALESCE(v_week_trips, 0),
            'earned', COALESCE(v_week_earned, 0)
        ),
        'this_month', jsonb_build_object(
            'trips', COALESCE(v_month_trips, 0),
            'earned', COALESCE(v_month_earned, 0)
        ),
        'total_earned', COALESCE(v_total_earned, 0)
    );
END;
$$;


ALTER FUNCTION "public"."driver_earnings_statement"("p_driver_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."driver_go_offline"("p_driver_id" "uuid", "p_device_id" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_driver public.drivers;
BEGIN
  SELECT * INTO v_driver
  FROM public.drivers
  WHERE id = p_driver_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'driver_not_found');
  END IF;

  -- Only the active device can go offline (or admin can force-offline separately).
  IF v_driver.active_device_id IS NOT NULL
     AND v_driver.active_device_id <> p_device_id THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'wrong_device'
    );
  END IF;

  UPDATE public.drivers
  SET
    is_online = false,
    online_status = 'offline',
    active_device_id = NULL,
    active_device_type = NULL,
    active_device_last_seen_at = now(),
    updated_at = now()
  WHERE id = p_driver_id;

  RETURN jsonb_build_object('success', true, 'status', 'offline');
END;
$$;


ALTER FUNCTION "public"."driver_go_offline"("p_driver_id" "uuid", "p_device_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."driver_go_online"("p_driver_id" "uuid", "p_device_id" "text", "p_device_type" "text" DEFAULT 'android'::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_driver public.drivers;
BEGIN
  SELECT * INTO v_driver
  FROM public.drivers
  WHERE id = p_driver_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'driver_not_found');
  END IF;

  IF COALESCE(v_driver.is_approved, false) = false
     OR COALESCE(v_driver.approval_status, '') <> 'approved'
     OR COALESCE(v_driver.can_go_online, false) = false THEN
    RETURN jsonb_build_object('success', false, 'error', 'driver_not_approved');
  END IF;

  -- One driver = one active device. Block a second phone.
  IF v_driver.active_device_id IS NOT NULL
     AND v_driver.active_device_id <> p_device_id THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'another_device_active',
      'active_device_id', v_driver.active_device_id
    );
  END IF;

  UPDATE public.drivers
  SET
    is_online = true,
    online_status = 'online',
    active_device_id = p_device_id,
    active_device_type = p_device_type,
    active_device_last_seen_at = now(),
    last_online_at = now(),
    updated_at = now()
  WHERE id = p_driver_id;

  RETURN jsonb_build_object('success', true, 'status', 'online');
END;
$$;


ALTER FUNCTION "public"."driver_go_online"("p_driver_id" "uuid", "p_device_id" "text", "p_device_type" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."driver_request_withdrawal"("p_driver_id" "uuid", "p_amount" numeric, "p_method" "text" DEFAULT 'airtel_money'::"text", "p_account_number" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_wallet public.driver_wallets;
    v_available NUMERIC(12,2);
    v_fee_percent NUMERIC(5,2);
    v_fee_amount NUMERIC(10,2);
    v_net_amount NUMERIC(10,2);
    v_deduction_amount NUMERIC(10,2);
    v_reference TEXT;
BEGIN
    SELECT * INTO v_wallet FROM public.driver_wallets WHERE driver_id = p_driver_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Driver wallet not found');
    END IF;

    v_available := COALESCE(v_wallet.available_for_withdrawal, v_wallet.available_balance, v_wallet.balance, 0);

    IF p_amount <= 0 OR p_amount > v_available THEN
        RETURN jsonb_build_object('success', false, 'error', 'Invalid amount. Available: ' || v_available || ' MWK');
    END IF;

    -- Calculate fees (2.5% for mobile money, 1% for bank)
    v_fee_percent := CASE WHEN p_method IN ('airtel_money', 'tnm_mpamba') THEN 2.5 ELSE 1.0 END;
    v_fee_amount := ROUND(p_amount * (v_fee_percent / 100), 2);
    v_net_amount := p_amount - v_fee_amount;
    v_deduction_amount := p_amount;  -- Full amount deducted, fee is service charge

    v_reference := 'withdrawal_' || extract(epoch from clock_timestamp())::bigint || '_' || substr(gen_random_uuid()::text, 1, 8);

    -- Deduct from wallet
    UPDATE public.driver_wallets
    SET available_balance = available_balance - v_deduction_amount,
        available_for_withdrawal = available_for_withdrawal - v_deduction_amount,
        balance = balance - v_deduction_amount,
        total_withdrawn = COALESCE(total_withdrawn, 0) + v_deduction_amount,
        updated_at = NOW()
    WHERE driver_id = p_driver_id;

    -- Log transaction
    INSERT INTO public.driver_transactions (
        driver_id, transaction_type, amount,
        balance_before, balance_after,
        reference_type, reference_id,
        description, payout_method, payout_reference, status, created_at
    ) VALUES (
        p_driver_id, 'withdrawal', -v_deduction_amount,
        v_available, v_available - v_deduction_amount,
        'withdrawal', NULL,
        'Withdrawal of MWK ' || v_deduction_amount || ' via ' || p_method || ' (fee MWK ' || v_fee_amount || ', net MWK ' || v_net_amount || ')',
        p_method, v_reference, 'pending', NOW()
    );

    -- Create payment record for tracking
    INSERT INTO public.payments (
        user_id, paid_by, user_type, type, amount, currency,
        payment_method, payment_status, status,
        transaction_reference, reference
    )
    SELECT u.id, u.id, 'driver', 'payout', -v_deduction_amount, 'MWK',
           p_method, 'pending', 'pending',
           v_reference, v_reference
    FROM public.drivers d
    JOIN public.users u ON u.id = d.user_id
    WHERE d.id = p_driver_id;

    RETURN jsonb_build_object(
        'success', true,
        'driver_id', p_driver_id,
        'requested_amount', v_deduction_amount,
        'fee', v_fee_amount,
        'net_amount', v_net_amount,
        'method', p_method,
        'reference', v_reference,
        'new_balance', v_available - v_deduction_amount
    );
END;
$$;


ALTER FUNCTION "public"."driver_request_withdrawal"("p_driver_id" "uuid", "p_amount" numeric, "p_method" "text", "p_account_number" "text") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."rider_loyalty_accounts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "rider_id" "uuid" NOT NULL,
    "user_id" "uuid",
    "points" integer DEFAULT 0 NOT NULL,
    "lifetime_points" integer DEFAULT 0 NOT NULL,
    "total_rides_completed" integer DEFAULT 0 NOT NULL,
    "total_spent" numeric(12,2) DEFAULT 0 NOT NULL,
    "current_tier" "text" DEFAULT 'bronze'::"text",
    "tier_achieved_at" timestamp with time zone,
    "streak_weeks" integer DEFAULT 0 NOT NULL,
    "last_ride_at" timestamp with time zone,
    "birthday_bonus_claimed" boolean DEFAULT false NOT NULL,
    "referral_bonus_claimed" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."rider_loyalty_accounts" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ensure_rider_loyalty_account"("p_rider_id" "uuid") RETURNS "public"."rider_loyalty_accounts"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."ensure_rider_loyalty_account"("p_rider_id" "uuid") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."wallets" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "balance" numeric(12,2) DEFAULT 0,
    "ride_credits" numeric(12,2) DEFAULT 0,
    "promo_balance" numeric(12,2) DEFAULT 0,
    "refund_balance" numeric(12,2) DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."wallets" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ensure_rider_wallet"("p_rider_id" "uuid") RETURNS "public"."wallets"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_user_id UUID;
  v_wallet public.wallets;
BEGIN
  SELECT user_id INTO v_user_id
  FROM public.riders
  WHERE id = p_rider_id;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Rider profile not found';
  END IF;

  INSERT INTO public.wallets(user_id, balance, ride_credits, promo_balance, refund_balance)
  VALUES (v_user_id, 0, 0, 0, 0)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT * INTO v_wallet
  FROM public.wallets
  WHERE user_id = v_user_id;

  RETURN v_wallet;
END;
$$;


ALTER FUNCTION "public"."ensure_rider_wallet"("p_rider_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."expire_old_invitations"() RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    UPDATE public.staff_invitations
    SET status = 'expired', updated_at = NOW()
    WHERE status = 'pending' AND expires_at < NOW();
END;
$$;


ALTER FUNCTION "public"."expire_old_invitations"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."expire_stale_ride_requests"() RETURNS SETOF "public"."rides"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_ride public.rides;
  v_dispatch_count INTEGER;
BEGIN
  UPDATE public.ride_requests
  SET status = 'expired',
      responded_at = COALESCE(responded_at, now())
  WHERE status = 'pending'
    AND expires_at < now();

  FOR v_ride IN
    SELECT r.*
    FROM public.rides r
    WHERE r.status = 'searching'
      AND NOT EXISTS (
        SELECT 1
        FROM public.ride_requests rr
        WHERE rr.ride_id = r.id
          AND rr.status = 'pending'
      )
    ORDER BY r.created_at ASC
    LIMIT 50
  LOOP
    IF (
      SELECT COUNT(*)
      FROM public.ride_events
      WHERE ride_id = v_ride.id
        AND event_type IN ('dispatch_sent', 'dispatch_no_drivers', 'driver_search_broadcast')
    ) >= 4 THEN
      UPDATE public.rides
      SET status = 'no_driver_found',
          updated_at = now()
      WHERE id = v_ride.id
      RETURNING * INTO v_ride;
    ELSE
      v_dispatch_count := public.dispatch_ride_to_nearby_drivers(
        v_ride.id,
        v_ride.pickup_lat,
        v_ride.pickup_lng,
        5
      );

      SELECT * INTO v_ride
      FROM public.rides
      WHERE id = v_ride.id;

      IF v_dispatch_count = 0 THEN
        UPDATE public.rides
        SET status = 'searching',
            updated_at = now()
        WHERE id = v_ride.id
        RETURNING * INTO v_ride;
      END IF;
    END IF;

    RETURN NEXT v_ride;
  END LOOP;

  RETURN;
END;
$$;


ALTER FUNCTION "public"."expire_stale_ride_requests"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."find_nearest_city"("p_lat" double precision, "p_lng" double precision) RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
  SELECT city
  FROM public.service_zones
  WHERE status = 'active'
    AND zone_type = 'operating'
  ORDER BY
    -- order by proximity to zone center
    ( 6371 * acos( cos(radians(p_lat)) * cos(radians(center_lat))
      * cos(radians(center_lng) - radians(p_lng))
      + sin(radians(p_lat)) * sin(radians(center_lat)) ) )
  LIMIT 1;
$$;


ALTER FUNCTION "public"."find_nearest_city"("p_lat" double precision, "p_lng" double precision) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."generate_referral_code"() RETURNS "text"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  code text;
BEGIN
  code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  RETURN code;
END;
$$;


ALTER FUNCTION "public"."generate_referral_code"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."generate_referral_code"("p_user_id" "uuid", "p_type" "text" DEFAULT 'driver'::"text") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE
  v_code TEXT;
  v_exists INT;
  v_max_attempts INT := 20;
  v_attempt INT := 0;
BEGIN
  LOOP
    v_attempt := v_attempt + 1;

    IF v_attempt > v_max_attempts THEN
      RAISE EXCEPTION 'Could not generate unique referral code after % attempts', v_max_attempts;
    END IF;

    v_code := UPPER(SUBSTRING(REPLACE(REPLACE(REPLACE(REPLACE(
      encode(extensions.gen_random_bytes(6), 'base64'),
      '/', ''), '+', ''), '=', ''), '0', 'W'
    ), 1, 8));

    IF p_type = 'driver' THEN
      SELECT COUNT(*) INTO v_exists
      FROM public.drivers
      WHERE referral_code = v_code;
    ELSE
      SELECT COUNT(*) INTO v_exists
      FROM public.riders
      WHERE referral_code = v_code;
    END IF;

    IF v_exists = 0 THEN
      IF p_type = 'driver' THEN
        SELECT COUNT(*) INTO v_exists
        FROM public.riders
        WHERE referral_code = v_code;
      ELSE
        SELECT COUNT(*) INTO v_exists
        FROM public.drivers
        WHERE referral_code = v_code;
      END IF;
    END IF;

    IF v_exists = 0 THEN
      IF p_type = 'driver' THEN
        UPDATE public.drivers
        SET referral_code = v_code
        WHERE id = p_user_id;
      ELSE
        UPDATE public.riders
        SET referral_code = v_code
        WHERE id = p_user_id;
      END IF;

      INSERT INTO public.referral_events (
        referral_type,
        event_type,
        actor_id,
        actor_type,
        metadata
      )
      VALUES (
        p_type,
        'code_generated',
        p_user_id,
        p_type,
        jsonb_build_object('code', v_code)
      );

      RETURN v_code;
    END IF;
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."generate_referral_code"("p_user_id" "uuid", "p_type" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."generate_ride_invoice"("p_ride_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_ride public.rides;
    v_rider_name TEXT;
    v_rider_phone TEXT;
    v_driver_name TEXT;
    v_driver_phone TEXT;
    v_invoice_number TEXT;
    v_invoice_id UUID;
    v_seq INT;
BEGIN
    SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Ride not found');
    END IF;

    -- Check if invoice already exists
    SELECT id INTO v_invoice_id FROM public.ride_invoices WHERE ride_id = p_ride_id;
    IF FOUND THEN
        RETURN jsonb_build_object('success', true, 'invoice_id', v_invoice_id, 'note', 'Already generated');
    END IF;

    -- Get rider info
    SELECT u.full_name, u.phone INTO v_rider_name, v_rider_phone
    FROM public.riders r
    JOIN public.users u ON u.id = r.user_id
    WHERE r.id = v_ride.rider_id;

    -- Get driver info
    SELECT u.full_name, u.phone INTO v_driver_name, v_driver_phone
    FROM public.drivers d
    JOIN public.users u ON u.id = d.user_id
    WHERE d.id = v_ride.driver_id;

    -- Generate invoice number: WR-YYYYMMDD-SEQ
    SELECT COALESCE(COUNT(*), 0) + 1 INTO v_seq
    FROM public.ride_invoices
    WHERE created_at::date = CURRENT_DATE;

    v_invoice_number := 'WR-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || LPAD(v_seq::TEXT, 6, '0');

    INSERT INTO public.ride_invoices (
        ride_id, invoice_number, rider_id, rider_name, rider_phone,
        driver_id, driver_name,
        pickup_address, dropoff_address,
        distance_km, duration_min,
        ride_fare, booking_fee, total_amount,
        payment_method, payment_status, invoice_status
    ) VALUES (
        p_ride_id, v_invoice_number,
        v_ride.rider_id, COALESCE(v_rider_name, 'Rider'), COALESCE(v_rider_phone, ''),
        v_ride.driver_id, COALESCE(v_driver_name, 'Driver'),
        v_ride.pickup_address, COALESCE(v_ride.dropoff_address, v_ride.destination_address, ''),
        COALESCE(v_ride.actual_distance_km, v_ride.distance_km, v_ride.estimated_distance_km),
        COALESCE(v_ride.actual_duration_min, v_ride.duration_min, v_ride.estimated_duration_minutes),
        COALESCE(NULLIF(v_ride.actual_fare, 0), NULLIF(v_ride.final_fare, 0), v_ride.estimated_fare, 0),
        COALESCE(v_ride.booking_fee, 300),
        COALESCE(v_ride.rider_total_amount, COALESCE(v_ride.actual_fare, v_ride.estimated_fare, 0) + COALESCE(v_ride.booking_fee, 300)),
        COALESCE(v_ride.payment_method, 'Unknown'),
        COALESCE(v_ride.payment_status, 'paid'), 'generated'
    ) RETURNING id INTO v_invoice_id;

    -- Link invoice to ride
    UPDATE public.rides SET invoice_id = v_invoice_id WHERE id = p_ride_id;

    RETURN jsonb_build_object(
        'success', true,
        'invoice_id', v_invoice_id,
        'invoice_number', v_invoice_number,
        'ride_id', p_ride_id,
        'rider_name', COALESCE(v_rider_name, 'Rider'),
        'total_amount', COALESCE(v_ride.rider_total_amount, v_ride.estimated_fare, 0),
        'payment_method', v_ride.payment_method
    );
END;
$$;


ALTER FUNCTION "public"."generate_ride_invoice"("p_ride_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_active_marketing_home"("p_city" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  RETURN jsonb_build_object(
    'promotions', COALESCE((
      SELECT jsonb_agg(item ORDER BY priority DESC, created_at DESC)
      FROM (
        SELECT
          to_jsonb(p) AS item,
          COALESCE(p.priority, 0) AS priority,
          p.created_at
        FROM public.promotions p
        WHERE p.is_active = true
          AND (p.start_date IS NULL OR p.start_date <= NOW())
          AND (p.end_date IS NULL OR p.end_date >= NOW())
          AND (p.target_city IS NULL OR p_city IS NULL OR p.target_city ILIKE p_city)
        UNION ALL
        SELECT
          jsonb_build_object(
            'id', b.id,
            'title', b.title,
            'description', b.subtitle,
            'image_url', b.image_url,
            'promo_code', NULL,
            'discount_type', NULL,
            'discount_value', NULL,
            'placement', COALESCE(b.placement, 'home_carousel'),
            'target_audience', 'all',
            'target_city', b.target_city,
            'category', 'banner',
            'partner_name', b.partner_name,
            'action_text', CASE WHEN b.click_action = 'booking' THEN 'Book Now' ELSE 'Learn More' END,
            'action_url', b.click_action,
            'accent_color', COALESCE(b.accent_color, '#F97316'),
            'priority', COALESCE(b.priority, 0),
            'is_active', b.is_active,
            'created_at', b.created_at
          ) AS item,
          COALESCE(b.priority, 0) AS priority,
          b.created_at
        FROM public.marketing_banners b
        WHERE b.is_active = true
          AND (b.starts_at IS NULL OR b.starts_at <= NOW())
          AND (b.ends_at IS NULL OR b.ends_at >= NOW())
          AND (b.target_city IS NULL OR p_city IS NULL OR b.target_city ILIKE p_city)
        ORDER BY priority DESC, created_at DESC
        LIMIT 30
      ) s
    ), '[]'::jsonb),
    'banners', COALESCE((
      SELECT jsonb_agg(to_jsonb(b) ORDER BY b.priority DESC, b.created_at DESC)
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


ALTER FUNCTION "public"."get_active_marketing_home"("p_city" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_active_referral_campaign"("p_type" "text" DEFAULT 'driver'::"text", "p_city" "text" DEFAULT NULL::"text") RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  SELECT id FROM public.referral_campaigns
  WHERE is_active = true
  AND (campaign_type = p_type OR campaign_type = 'both')
  AND NOW() BETWEEN starts_at AND ends_at
  AND (target_city IS NULL OR target_city = p_city)
  ORDER BY created_at DESC
  LIMIT 1;
$$;


ALTER FUNCTION "public"."get_active_referral_campaign"("p_type" "text", "p_city" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_driver_referral_stats"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
BEGIN
  RETURN jsonb_build_object(
    'total_referrals', (SELECT COUNT(*) FROM public.driver_referrals),
    'pending_bonuses', (SELECT COUNT(*) FROM public.driver_referrals WHERE status IN ('first_trip_completed', 'bonus_approved')),
    'paid_bonuses', (SELECT COUNT(*) FROM public.driver_referrals WHERE status = 'bonus_paid'),
    'conversion_rate', CASE WHEN (SELECT COUNT(*) FROM public.driver_referrals) > 0
      THEN ROUND((SELECT COUNT(*)::DECIMAL FROM public.driver_referrals WHERE status IN ('bonus_approved', 'bonus_paid')) /
        NULLIF((SELECT COUNT(*) FROM public.driver_referrals), 0) * 100, 1) ELSE 0 END,
    'fraud_alerts', (SELECT COUNT(*) FROM public.driver_referrals WHERE fraud_verdict IS NOT NULL AND fraud_verdict != 'safe'),
    'total_bonus_amount', (SELECT COALESCE(SUM(bonus_amount), 0) FROM public.driver_referrals)
  );
END;
$$;


ALTER FUNCTION "public"."get_driver_referral_stats"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_live_operations"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
BEGIN
  RETURN jsonb_build_object(
    'online_drivers', (SELECT COUNT(*) FROM public.drivers WHERE is_online=true),
    'active_trips', (SELECT COUNT(*) FROM public.rides WHERE status IN ('accepted','driver_arriving','driver_arrived','in_progress')),
    'searching_riders', (SELECT COUNT(*) FROM public.rides WHERE status='searching'),
    'queue_waiting', (SELECT COUNT(*) FROM public.rides WHERE status='requested')
  );
END;
$$;


ALTER FUNCTION "public"."get_live_operations"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_loyalty_notification_count"("p_user_id" "uuid" DEFAULT NULL::"uuid", "p_rider_id" "uuid" DEFAULT NULL::"uuid") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."get_loyalty_notification_count"("p_user_id" "uuid", "p_rider_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_marketing_analytics"("p_days" integer DEFAULT 30) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."get_marketing_analytics"("p_days" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_notification_analytics"() RETURNS TABLE("sent" bigint, "delivered" bigint, "opened" bigint, "ctr" numeric)
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  SELECT COUNT(*)::BIGINT,
    COALESCE(SUM(delivered_count),0)::BIGINT,
    COALESCE(SUM(opened_count),0)::BIGINT,
    CASE WHEN SUM(delivered_count)>0 THEN ROUND(SUM(opened_count)::DECIMAL/SUM(delivered_count)*100,1) ELSE 0 END
  FROM public.push_notifications;
$$;


ALTER FUNCTION "public"."get_notification_analytics"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_notification_target_count"("p_recipient_group" "text", "p_target_country" "text" DEFAULT NULL::"text", "p_target_city" "text" DEFAULT NULL::"text") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE
    v_count INTEGER;
BEGIN
    IF p_recipient_group = 'all' THEN
        SELECT COUNT(*) INTO v_count FROM public.users WHERE is_active = true AND deleted_at IS NULL;
    ELSIF p_recipient_group = 'riders' THEN
        SELECT COUNT(*) INTO v_count FROM public.riders r JOIN public.users u ON u.id = r.user_id WHERE u.is_active = true AND u.deleted_at IS NULL;
    ELSIF p_recipient_group = 'drivers' THEN
        SELECT COUNT(*) INTO v_count FROM public.drivers d JOIN public.users u ON u.id = d.user_id WHERE u.is_active = true AND u.deleted_at IS NULL;
    ELSIF p_recipient_group = 'approved_drivers' THEN
        SELECT COUNT(*) INTO v_count FROM public.drivers d JOIN public.users u ON u.id = d.user_id WHERE d.approval_status = 'approved' AND u.is_active = true;
    ELSIF p_recipient_group = 'pending_drivers' THEN
        SELECT COUNT(*) INTO v_count FROM public.drivers d JOIN public.users u ON u.id = d.user_id WHERE d.approval_status = 'pending' AND u.is_active = true;
    ELSIF p_recipient_group = 'online_drivers' THEN
        SELECT COUNT(*) INTO v_count FROM public.drivers d JOIN public.users u ON u.id = d.user_id WHERE d.is_online = true AND u.is_active = true;
    ELSIF p_recipient_group = 'offline_drivers' THEN
        SELECT COUNT(*) INTO v_count FROM public.drivers d JOIN public.users u ON u.id = d.user_id WHERE d.is_online = false AND u.is_active = true;
    ELSIF p_recipient_group = 'city' AND p_target_city IS NOT NULL THEN
        SELECT COUNT(*) INTO v_count FROM public.users u WHERE u.is_active = true AND u.deleted_at IS NULL
        AND (EXISTS (SELECT 1 FROM public.drivers d WHERE d.user_id = u.id AND d.city ILIKE '%' || p_target_city || '%')
          OR EXISTS (SELECT 1 FROM public.riders r WHERE r.user_id = u.id AND r.home_address ILIKE '%' || p_target_city || '%'));
    ELSIF p_recipient_group = 'country' AND p_target_country IS NOT NULL THEN
        SELECT COUNT(*) INTO v_count FROM public.users u WHERE u.is_active = true AND u.deleted_at IS NULL;
    ELSE
        SELECT COUNT(*) INTO v_count FROM public.users u WHERE u.is_active = true AND u.deleted_at IS NULL;
    END IF;
    RETURN COALESCE(v_count, 0);
END;
$$;


ALTER FUNCTION "public"."get_notification_target_count"("p_recipient_group" "text", "p_target_country" "text", "p_target_city" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_platform_stats"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
BEGIN
  RETURN jsonb_build_object(
    'total_rides', (SELECT COUNT(*) FROM public.rides),
    'total_drivers', (SELECT COUNT(*) FROM public.drivers),
    'total_riders', (SELECT COUNT(*) FROM public.riders),
    'online_drivers', (SELECT COUNT(*) FROM public.drivers WHERE is_online = true),
    'active_riders_today', (SELECT COUNT(DISTINCT rider_id) FROM public.rides WHERE created_at::DATE = CURRENT_DATE),
    'completed_today', (SELECT COUNT(*) FROM public.rides WHERE status = 'completed' AND created_at::DATE = CURRENT_DATE),
    'cancelled_today', (SELECT COUNT(*) FROM public.rides WHERE status = 'cancelled' AND created_at::DATE = CURRENT_DATE),
    'pending_trips', (SELECT COUNT(*) FROM public.rides WHERE status IN ('requested','searching','accepted','driver_arriving','driver_arrived','in_progress')),
    'avg_ride_time_min', COALESCE((SELECT ROUND(AVG(EXTRACT(EPOCH FROM (completed_at - started_at))/60)::NUMERIC, 0) FROM public.rides WHERE status = 'completed' AND started_at IS NOT NULL), 0),
    'avg_distance_km', COALESCE((SELECT ROUND(AVG(COALESCE(actual_distance_km, estimated_distance_km, 0))::NUMERIC, 1) FROM public.rides WHERE status = 'completed'), 0),
    'driver_earnings_today', COALESCE((SELECT SUM(COALESCE(actual_fare, estimated_fare, 0) * 0.8) FROM public.rides WHERE status = 'completed' AND created_at::DATE = CURRENT_DATE), 0),
    'company_profit', COALESCE((SELECT SUM(COALESCE(actual_fare, estimated_fare, 0) * 0.2) FROM public.rides WHERE status = 'completed'), 0),
    'gross_revenue', COALESCE((SELECT SUM(COALESCE(actual_fare, estimated_fare, 0)) FROM public.rides WHERE status = 'completed'), 0),
    'refunds_total', COALESCE((SELECT SUM(amount) FROM public.payments WHERE payment_status = 'refunded'), 0),
    'new_signups_today', (SELECT COUNT(*) FROM public.users WHERE created_at::DATE = CURRENT_DATE),
    'safety_incidents', (SELECT COUNT(*) FROM public.safety_incidents WHERE status = 'active'),
    'support_tickets', (SELECT COUNT(*) FROM public.support_tickets WHERE status IN ('open','in_progress')),
    'referral_count', (SELECT COUNT(*) FROM public.driver_referrals)
  );
END;
$$;


ALTER FUNCTION "public"."get_platform_stats"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_referral_analytics"("p_days" integer DEFAULT 30) RETURNS TABLE("day" "date", "driver_referrals" bigint, "rider_referrals" bigint, "driver_bonuses_approved" bigint, "rider_credits_approved" bigint, "total_bonus_amount" numeric)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    d::DATE AS day,
    COALESCE(dr.c, 0) AS driver_referrals,
    COALESCE(rr.c, 0) AS rider_referrals,
    COALESCE(dra.c, 0) AS driver_bonuses_approved,
    COALESCE(rra.c, 0) AS rider_credits_approved,
    COALESCE(drt.amount, 0) AS total_bonus_amount
  FROM generate_series(CURRENT_DATE - (p_days - 1), CURRENT_DATE, '1 day'::INTERVAL) d
  LEFT JOIN LATERAL (SELECT COUNT(*) AS c FROM public.driver_referrals WHERE created_at::DATE = d::DATE) dr ON true
  LEFT JOIN LATERAL (SELECT COUNT(*) AS c FROM public.rider_referrals WHERE created_at::DATE = d::DATE) rr ON true
  LEFT JOIN LATERAL (SELECT COUNT(*) AS c FROM public.driver_referrals WHERE status IN ('bonus_approved', 'bonus_paid') AND updated_at::DATE = d::DATE) dra ON true
  LEFT JOIN LATERAL (SELECT COUNT(*) AS c FROM public.rider_referrals WHERE status IN ('credit_approved', 'credit_issued') AND updated_at::DATE = d::DATE) rra ON true
  LEFT JOIN LATERAL (SELECT COALESCE(SUM(bonus_amount), 0) AS amount FROM public.driver_referrals WHERE updated_at::DATE = d::DATE) drt ON true
  ORDER BY d::DATE;
END;
$$;


ALTER FUNCTION "public"."get_referral_analytics"("p_days" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_referral_funnel"() RETURNS TABLE("stage" "text", "count" bigint)
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  SELECT 'signups', COUNT(*)::BIGINT FROM public.driver_referrals WHERE status IN ('signed_up','documents_submitted','under_review','documents_approved','first_trip_completed','bonus_approved','bonus_paid')
  UNION ALL SELECT 'approved', COUNT(*)::BIGINT FROM public.driver_referrals WHERE status IN ('documents_approved','first_trip_completed','bonus_approved','bonus_paid')
  UNION ALL SELECT 'first_trip', COUNT(*)::BIGINT FROM public.driver_referrals WHERE status IN ('first_trip_completed','bonus_approved','bonus_paid')
  UNION ALL SELECT 'bonus_paid', COUNT(*)::BIGINT FROM public.driver_referrals WHERE status='bonus_paid';
$$;


ALTER FUNCTION "public"."get_referral_funnel"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_referral_settings"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE
  res JSONB := '{}'::JSONB;
BEGIN
  FOR res IN
    SELECT jsonb_object_agg(setting_key, setting_value)
    FROM public.referral_settings
  LOOP
    RETURN res;
  END LOOP;
  RETURN '{}'::JSONB;
END;
$$;


ALTER FUNCTION "public"."get_referral_settings"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_revenue_timeline"("p_period" "text" DEFAULT 'daily'::"text") RETURNS TABLE("period_label" "text", "gross" numeric, "driver_earnings" numeric, "commission" numeric)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE v_interval TEXT;
BEGIN
  v_interval := CASE p_period WHEN 'weekly' THEN 'week' WHEN 'monthly' THEN 'month' ELSE 'day' END;
  RETURN QUERY
  WITH dates AS (SELECT d::DATE AS d FROM generate_series(CURRENT_DATE - 30, CURRENT_DATE, ('1 '||v_interval)::INTERVAL) d)
  SELECT TO_CHAR(dates.d, CASE p_period WHEN 'daily' THEN 'Mon DD' WHEN 'weekly' THEN 'IW Mon' ELSE 'Mon YYYY' END),
    COALESCE(SUM(COALESCE(r.actual_fare,r.estimated_fare,0)),0)::DECIMAL,
    COALESCE(SUM(COALESCE(r.actual_fare,r.estimated_fare,0)*0.8),0)::DECIMAL,
    COALESCE(SUM(COALESCE(r.actual_fare,r.estimated_fare,0)*0.2),0)::DECIMAL
  FROM dates LEFT JOIN public.rides r ON r.status='completed' AND r.created_at::DATE = dates.d
  GROUP BY dates.d ORDER BY dates.d;
END;
$$;


ALTER FUNCTION "public"."get_revenue_timeline"("p_period" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_ride_invoice"("p_ride_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_invoice RECORD;
BEGIN
    SELECT i.*, r.pickup_address, r.dropoff_address, r.distance_km,
           r.duration_min, r.payment_method, r.payment_status,
           r.actual_fare, r.final_fare, r.estimated_fare
    INTO v_invoice
    FROM public.ride_invoices i
    JOIN public.rides r ON r.id = i.ride_id
    WHERE i.ride_id = p_ride_id;

    IF NOT FOUND THEN
        -- Auto-generate if not yet generated
        RETURN public.generate_ride_invoice(p_ride_id);
    END IF;

    RETURN jsonb_build_object(
        'invoice_id', v_invoice.id,
        'invoice_number', v_invoice.invoice_number,
        'ride_id', v_invoice.ride_id,
        'rider_name', v_invoice.rider_name,
        'driver_name', v_invoice.driver_name,
        'pickup_address', v_invoice.pickup_address,
        'dropoff_address', v_invoice.dropoff_address,
        'distance_km', v_invoice.distance_km,
        'duration_min', v_invoice.duration_min,
        'ride_fare', v_invoice.ride_fare,
        'booking_fee', v_invoice.booking_fee,
        'total_amount', v_invoice.total_amount,
        'payment_method', v_invoice.payment_method,
        'payment_status', v_invoice.payment_status,
        'generated_at', v_invoice.generated_at,
        'status', v_invoice.invoice_status
    );
END;
$$;


ALTER FUNCTION "public"."get_ride_invoice"("p_ride_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_ride_type_breakdown"() RETURNS TABLE("ride_type" "text", "total" bigint, "cancelled_pct" numeric, "avg_fare" numeric)
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  SELECT COALESCE((SELECT name FROM public.ride_categories WHERE id=r.category_id), 'standard'),
    COUNT(*)::BIGINT,
    ROUND(COUNT(CASE WHEN status='cancelled' THEN 1 END)::DECIMAL/NULLIF(COUNT(*),0)*100,1),
    ROUND(AVG(COALESCE(actual_fare,estimated_fare,0))::NUMERIC,0)::DECIMAL
  FROM public.rides r GROUP BY 1 ORDER BY 2 DESC;
$$;


ALTER FUNCTION "public"."get_ride_type_breakdown"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_rider_retention"() RETURNS TABLE("month" "text", "new_riders" bigint, "retained_riders" bigint, "retention_pct" numeric)
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  WITH months AS (SELECT d::DATE AS m FROM generate_series(CURRENT_DATE - INTERVAL '6 months', CURRENT_DATE, '1 month'::INTERVAL) d)
  SELECT TO_CHAR(months.m,'Mon YYYY'),
    (SELECT COUNT(*) FROM public.riders WHERE created_at BETWEEN months.m AND months.m + INTERVAL '1 month'),
    (SELECT COUNT(DISTINCT rider_id) FROM public.rides WHERE created_at BETWEEN months.m + INTERVAL '1 month' AND months.m + INTERVAL '2 months'),
    0::DECIMAL
  FROM months ORDER BY months.m;
$$;


ALTER FUNCTION "public"."get_rider_retention"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_top_driver_performance"("p_limit" integer DEFAULT 10) RETURNS TABLE("name" "text", "trips" bigint, "acceptance_pct" numeric, "cancellation_pct" numeric, "rating" numeric, "revenue" numeric, "city" "text")
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  SELECT COALESCE(u.full_name,d.full_name,'Driver'), COUNT(*)::BIGINT,
    100 - ROUND(COUNT(CASE WHEN r.status='cancelled' THEN 1 END)::DECIMAL/NULLIF(COUNT(*),0)*100,1),
    ROUND(COUNT(CASE WHEN r.status='cancelled' THEN 1 END)::DECIMAL/NULLIF(COUNT(*),0)*100,1),
    COALESCE(d.rating,5.0)::DECIMAL,
    COALESCE(SUM(COALESCE(r.actual_fare,r.estimated_fare,0)),0)::DECIMAL,
    COALESCE(d.city,'unknown')
  FROM public.rides r JOIN public.drivers d ON d.id=r.driver_id LEFT JOIN public.users u ON u.id=d.user_id
  GROUP BY d.id,u.full_name,d.full_name,d.rating,d.city ORDER BY 2 DESC LIMIT p_limit;
$$;


ALTER FUNCTION "public"."get_top_driver_performance"("p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_top_referrers"("p_referral_type" "text" DEFAULT 'driver'::"text", "p_limit" integer DEFAULT 10) RETURNS TABLE("referrer_id" "uuid", "referrer_name" "text", "total_referrals" bigint, "successful_referrals" bigint, "total_bonus" numeric, "conversion_rate" numeric)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
BEGIN
  IF p_referral_type = 'driver' THEN
    RETURN QUERY
    SELECT
      dr.referrer_id,
      COALESCE(u.full_name, d.full_name, 'Driver')::TEXT AS referrer_name,
      COUNT(*)::BIGINT AS total_referrals,
      COUNT(CASE WHEN dr.status IN ('bonus_approved', 'bonus_paid') THEN 1 END)::BIGINT AS successful_referrals,
      COALESCE(SUM(dr.bonus_amount), 0) AS total_bonus,
      CASE WHEN COUNT(*) > 0 THEN
        ROUND(COUNT(CASE WHEN dr.status IN ('bonus_approved', 'bonus_paid') THEN 1 END)::DECIMAL / COUNT(*)::DECIMAL * 100, 1)
      ELSE 0 END AS conversion_rate
    FROM public.driver_referrals dr
    JOIN public.drivers d ON d.id = dr.referrer_id
    LEFT JOIN public.users u ON u.id = d.user_id
    GROUP BY dr.referrer_id, u.full_name, d.full_name
    ORDER BY total_referrals DESC
    LIMIT p_limit;
  ELSE
    RETURN QUERY
    SELECT
      rr.referrer_id,
      COALESCE(u.full_name, r.full_name, 'Rider')::TEXT AS referrer_name,
      COUNT(*)::BIGINT AS total_referrals,
      COUNT(CASE WHEN rr.status IN ('credit_approved', 'credit_issued') THEN 1 END)::BIGINT AS successful_referrals,
      COALESCE(SUM(rr.credit_amount), 0) AS total_bonus,
      CASE WHEN COUNT(*) > 0 THEN
        ROUND(COUNT(CASE WHEN rr.status IN ('credit_approved', 'credit_issued') THEN 1 END)::DECIMAL / COUNT(*)::DECIMAL * 100, 1)
      ELSE 0 END AS conversion_rate
    FROM public.rider_referrals rr
    JOIN public.riders r ON r.id = rr.referrer_id
    LEFT JOIN public.users u ON u.id = r.user_id
    GROUP BY rr.referrer_id, u.full_name, r.full_name
    ORDER BY total_referrals DESC
    LIMIT p_limit;
  END IF;
END;
$$;


ALTER FUNCTION "public"."get_top_referrers"("p_referral_type" "text", "p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_top_riders"("p_limit" integer DEFAULT 10) RETURNS TABLE("name" "text", "trips" bigint, "total_spent" numeric, "city" "text")
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  SELECT COALESCE(u.full_name,'Rider'), COUNT(*)::BIGINT,
    COALESCE(SUM(COALESCE(r.actual_fare,r.estimated_fare,0)),0)::DECIMAL,
    COALESCE(r.city,'unknown')
  FROM public.rides r JOIN public.riders ri ON ri.id=r.rider_id LEFT JOIN public.users u ON u.id=ri.user_id
  WHERE r.status='completed' GROUP BY ri.id,u.full_name,r.city ORDER BY 2 DESC LIMIT p_limit;
$$;


ALTER FUNCTION "public"."get_top_riders"("p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_trips_by_city"() RETURNS TABLE("city" "text", "count" bigint, "revenue" numeric)
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  SELECT COALESCE(city,'unknown'), COUNT(*)::BIGINT, COALESCE(SUM(COALESCE(actual_fare,estimated_fare,0)),0)::DECIMAL
  FROM public.rides WHERE status='completed'
  GROUP BY 1 ORDER BY 2 DESC;
$$;


ALTER FUNCTION "public"."get_trips_by_city"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_trips_by_hour"() RETURNS TABLE("hour" integer, "count" bigint)
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  SELECT EXTRACT(HOUR FROM created_at)::INTEGER, COUNT(*)::BIGINT
  FROM public.rides WHERE created_at > CURRENT_DATE - 7
  GROUP BY 1 ORDER BY 1;
$$;


ALTER FUNCTION "public"."get_trips_by_hour"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."insert_ride_location_point"("p_ride_id" "uuid", "p_latitude" numeric, "p_longitude" numeric, "p_speed_kmh" numeric DEFAULT 0, "p_heading" numeric DEFAULT 0, "p_accuracy" numeric DEFAULT 0, "p_event_type" "text" DEFAULT 'location'::"text", "p_recorded_at" timestamp with time zone DEFAULT "now"()) RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
BEGIN
  INSERT INTO public.ride_location_points (
    ride_id,
    latitude,
    longitude,
    speed_kmh,
    heading,
    accuracy,
    event_type,
    recorded_at
  ) VALUES (
    p_ride_id,
    p_latitude,
    p_longitude,
    p_speed_kmh,
    p_heading,
    p_accuracy,
    p_event_type,
    p_recorded_at
  );
END;
$$;


ALTER FUNCTION "public"."insert_ride_location_point"("p_ride_id" "uuid", "p_latitude" numeric, "p_longitude" numeric, "p_speed_kmh" numeric, "p_heading" numeric, "p_accuracy" numeric, "p_event_type" "text", "p_recorded_at" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."insert_ride_location_points"("p_points" "jsonb") RETURNS integer
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
DECLARE
  v_count int;
  v_point jsonb;
BEGIN
  v_count := 0;

  -- Loop through JSON array of points and insert each
  FOR v_point IN SELECT * FROM jsonb_array_elements(p_points)
  LOOP
    INSERT INTO public.ride_location_points (
      ride_id,
      latitude,
      longitude,
      speed_kmh,
      heading,
      accuracy,
      event_type,
      recorded_at
    ) VALUES (
      (v_point->>'ride_id')::uuid,
      (v_point->>'latitude')::decimal,
      (v_point->>'longitude')::decimal,
      COALESCE((v_point->>'speed_kmh')::decimal, 0),
      COALESCE((v_point->>'heading')::decimal, 0),
      COALESCE((v_point->>'accuracy')::decimal, 0),
      COALESCE(v_point->>'event_type', 'location'),
      COALESCE((v_point->>'recorded_at')::timestamptz, now())
    );
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;


ALTER FUNCTION "public"."insert_ride_location_points"("p_points" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_feature_enabled"("p_feature_key" "text", "p_user_role" "text" DEFAULT 'rider'::"text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.platform_feature_flags
    WHERE feature_key = p_feature_key
    AND is_enabled = true
    AND (
      (p_user_role = 'rider' AND enabled_for_riders = true)
      OR (p_user_role = 'driver' AND enabled_for_drivers = true)
      OR (p_user_role = 'admin' AND enabled_for_admin = true)
    )
  );
$$;


ALTER FUNCTION "public"."is_feature_enabled"("p_feature_key" "text", "p_user_role" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."log_integration_event"("p_integration_key" "text", "p_event_type" "text", "p_status" "text" DEFAULT 'success'::"text", "p_request" "jsonb" DEFAULT '{}'::"jsonb", "p_response" "jsonb" DEFAULT '{}'::"jsonb", "p_error" "text" DEFAULT NULL::"text", "p_duration_ms" integer DEFAULT NULL::integer) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE
    v_integration_id UUID;
BEGIN
    SELECT id INTO v_integration_id FROM public.integrations WHERE integration_key = p_integration_key;
    IF v_integration_id IS NULL THEN RETURN; END IF;

    INSERT INTO public.integration_logs (integration_id, event_type, status, request_payload, response_payload, error_message, duration_ms)
    VALUES (v_integration_id, p_event_type, p_status, p_request, p_response, p_error, p_duration_ms);

    -- Update stats
    UPDATE public.integrations
    SET total_requests = total_requests + 1,
        failed_requests = CASE WHEN p_status = 'failed' THEN failed_requests + 1 ELSE failed_requests END,
        success_rate = CASE WHEN total_requests > 0 THEN ROUND((total_requests - CASE WHEN p_status = 'failed' THEN failed_requests + 1 ELSE failed_requests END)::DECIMAL / (total_requests + 1) * 100, 1) ELSE CASE WHEN p_status = 'success' THEN 100 ELSE 0 END END,
        last_error = CASE WHEN p_status = 'failed' THEN p_error ELSE last_error END,
        last_sync_at = CASE WHEN p_status = 'success' THEN NOW() ELSE last_sync_at END,
        updated_at = NOW()
    WHERE id = v_integration_id;
END;
$$;


ALTER FUNCTION "public"."log_integration_event"("p_integration_key" "text", "p_event_type" "text", "p_status" "text", "p_request" "jsonb", "p_response" "jsonb", "p_error" "text", "p_duration_ms" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."log_refund_action"("p_refund_id" "uuid", "p_action" "text", "p_old_status" "text" DEFAULT NULL::"text", "p_new_status" "text" DEFAULT NULL::"text", "p_admin_id" "uuid" DEFAULT NULL::"uuid", "p_admin_email" "text" DEFAULT NULL::"text", "p_notes" "text" DEFAULT NULL::"text", "p_metadata" "jsonb" DEFAULT '{}'::"jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
    INSERT INTO refund_audit_logs (refund_id, action, old_status, new_status, changed_by, admin_email, notes, metadata)
    VALUES (p_refund_id, p_action, p_old_status, p_new_status, p_admin_id, p_admin_email, p_notes, p_metadata);
    RETURN jsonb_build_object('success', true);
END;
$$;


ALTER FUNCTION "public"."log_refund_action"("p_refund_id" "uuid", "p_action" "text", "p_old_status" "text", "p_new_status" "text", "p_admin_id" "uuid", "p_admin_email" "text", "p_notes" "text", "p_metadata" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mark_loyalty_notification_read"("p_notification_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
    UPDATE public.loyalty_notifications
    SET is_read = true
    WHERE id = p_notification_id;

    RETURN jsonb_build_object('ok', true);
END;
$$;


ALTER FUNCTION "public"."mark_loyalty_notification_read"("p_notification_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."normalize_driver_wallet_transaction"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_wallet_balance DECIMAL(12,2);
BEGIN
  IF COALESCE(NEW.transaction_type, '') IN ('withdrawal', 'payout', 'transfer')
     AND COALESCE(NEW.amount, 0) < 0 THEN
    IF NEW.balance_before IS NULL THEN
      SELECT COALESCE(available_balance, available_for_withdrawal, balance, 0)
      INTO v_wallet_balance
      FROM public.driver_wallets
      WHERE driver_id = NEW.driver_id
      LIMIT 1;

      NEW.balance_before := COALESCE(v_wallet_balance, 0);
    END IF;

    IF NEW.balance_after IS NULL OR NEW.balance_after = NEW.balance_before THEN
      NEW.balance_after := GREATEST(COALESCE(NEW.balance_before, 0) + NEW.amount, 0);
    END IF;

    NEW.status := COALESCE(NEW.status, 'pending');
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."normalize_driver_wallet_transaction"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."normalize_payment_compat_fields"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF NEW.payment_status IS NULL THEN
    NEW.payment_status := COALESCE(NEW.status, 'pending');
  END IF;
  IF NEW.status IS NULL THEN
    NEW.status := COALESCE(NEW.payment_status, 'pending');
  END IF;
  IF NEW.transaction_reference IS NULL THEN
    NEW.transaction_reference := NEW.reference;
  END IF;
  IF NEW.reference IS NULL THEN
    NEW.reference := NEW.transaction_reference;
  END IF;
  IF NEW.paid_by IS NULL THEN
    NEW.paid_by := NEW.user_id;
  END IF;
  IF NEW.user_id IS NULL THEN
    NEW.user_id := NEW.paid_by;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."normalize_payment_compat_fields"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."notify_referral_event"("p_referral_id" "uuid", "p_referral_type" "text", "p_event_type" "text", "p_referrer_id" "uuid", "p_referred_name" "text" DEFAULT NULL::"text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE
  v_referrer_user_id UUID;
  v_referrer_name TEXT;
  v_title TEXT;
  v_body TEXT;
  v_notification_type TEXT;
BEGIN
  -- Get the referrer's user_id and name
  IF p_referral_type = 'driver' THEN
    SELECT d.user_id, COALESCE(u.full_name, d.full_name, 'Driver')
    INTO v_referrer_user_id, v_referrer_name
    FROM public.drivers d
    LEFT JOIN public.users u ON u.id = d.user_id
    WHERE d.id = p_referrer_id;
  ELSE
    SELECT r.user_id, COALESCE(u.full_name, r.full_name, 'Rider')
    INTO v_referrer_user_id, v_referrer_name
    FROM public.riders r
    LEFT JOIN public.users u ON u.id = r.user_id
    WHERE r.id = p_referrer_id;
  END IF;

  IF v_referrer_user_id IS NULL THEN
    RETURN;
  END IF;

  -- Build notification based on event type
  CASE p_event_type
    WHEN 'referral_joined' THEN
      v_title := 'Someone used your referral code! 🎉';
      v_body := COALESCE(p_referred_name, 'Someone') || ' signed up with your code.';
      v_notification_type := 'referral_joined';
    WHEN 'first_trip_completed' THEN
      v_title := 'Referral bonus incoming! 💰';
      v_body := COALESCE(p_referred_name, 'Your referral') || ' completed their first trip.';
      v_notification_type := 'referral_completed';
    WHEN 'bonus_approved' THEN
      v_title := 'Referral bonus approved! ✅';
      v_body := 'Your referral bonus has been approved. Check your wallet.';
      v_notification_type := 'referral_bonus_approved';
    WHEN 'bonus_paid' THEN
      v_title := 'Referral bonus paid! 💸';
      v_body := 'Your referral bonus has been paid to your account.';
      v_notification_type := 'referral_bonus_paid';
    WHEN 'fraud_detected' THEN
      v_title := 'Referral review ⚠️';
      v_body := 'One of your referrals is under review.';
      v_notification_type := 'referral_fraud_warning';
    WHEN 'campaign_started' THEN
      v_title := 'New referral campaign! 🚀';
      v_body := 'A new referral campaign is now active. Start sharing to earn more!';
      v_notification_type := 'referral_campaign';
    ELSE
      v_title := 'Referral update';
      v_body := 'Your referral status has been updated.';
      v_notification_type := 'referral_update';
  END CASE;

  -- Insert notification record directly
  INSERT INTO public.notifications (user_id, title, body, notification_type, data)
  VALUES (
    v_referrer_user_id,
    v_title,
    v_body,
    v_notification_type,
    jsonb_build_object(
      'referral_id', p_referral_id,
      'referral_type', p_referral_type,
      'event_type', p_event_type,
      'referred_name', p_referred_name
    )
  );
END;
$$;


ALTER FUNCTION "public"."notify_referral_event"("p_referral_id" "uuid", "p_referral_type" "text", "p_event_type" "text", "p_referrer_id" "uuid", "p_referred_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."platform_escrow_summary"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_total_held NUMERIC(12,2);
    v_total_released NUMERIC(12,2);
    v_total_refunded NUMERIC(12,2);
    v_active_escrows INTEGER;
    v_pending_release NUMERIC(12,2);
BEGIN
    SELECT
        COALESCE(SUM(amount) FILTER (WHERE escrow_status = 'held'), 0),
        COALESCE(SUM(amount) FILTER (WHERE escrow_status = 'released'), 0),
        COALESCE(SUM(amount) FILTER (WHERE escrow_status = 'refunded'), 0),
        COUNT(*) FILTER (WHERE escrow_status = 'held'),
        COALESCE(SUM(amount) FILTER (WHERE escrow_status = 'held'), 0)
    INTO
        v_total_held, v_total_released, v_total_refunded,
        v_active_escrows, v_pending_release
    FROM public.platform_escrow;

    RETURN jsonb_build_object(
        'total_held', COALESCE(v_total_held, 0),
        'total_released', COALESCE(v_total_released, 0),
        'total_refunded', COALESCE(v_total_refunded, 0),
        'active_escrows', COALESCE(v_active_escrows, 0),
        'pending_release', COALESCE(v_pending_release, 0)
    );
END;
$$;


ALTER FUNCTION "public"."platform_escrow_summary"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."process_ride_payment"("p_ride_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_ride public.rides;
    v_escrow public.platform_escrow;
    v_driver_id uuid;
    v_fare_amount numeric(10,2);
    v_booking_fee numeric(10,2);
    v_commission_rate numeric(5,2);
    v_commission_amount numeric(10,2);
    v_driver_net numeric(10,2);
    v_rider_total numeric(10,2);
    v_wallet_id uuid;
    v_balance_before numeric(12,2);
    v_balance_after numeric(12,2);
    v_payment_method text;
BEGIN
    SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Ride not found');
    END IF;

    -- Check if already processed
    IF v_ride.payment_status = 'paid' AND v_ride.driver_earnings IS NOT NULL AND v_ride.driver_earnings > 0 THEN
        RETURN jsonb_build_object('success', true, 'ride_id', p_ride_id, 'note', 'Already processed');
    END IF;

    v_driver_id := v_ride.driver_id;
    v_fare_amount := COALESCE(NULLIF(v_ride.actual_fare, 0), NULLIF(v_ride.final_fare, 0), NULLIF(v_ride.fare, 0), v_ride.estimated_fare, 0);
    v_booking_fee := COALESCE(v_ride.booking_fee, 300);
    v_commission_rate := COALESCE(v_ride.commission_rate, 15);
    v_payment_method := COALESCE(v_ride.payment_method, 'cash');

    v_commission_amount := ROUND(v_fare_amount * (v_commission_rate / 100), 2);
    v_driver_net := ROUND(v_fare_amount - v_commission_amount, 2);
    v_rider_total := v_fare_amount + v_booking_fee;

    -- Release escrow if exists
    SELECT * INTO v_escrow FROM public.platform_escrow WHERE ride_id = p_ride_id;
    IF FOUND AND v_escrow.escrow_status = 'held' THEN
        UPDATE public.platform_escrow
        SET escrow_status = 'released',
            released_to_driver = v_driver_net,
            released_to_company = v_commission_amount + v_booking_fee,
            commission_deducted = v_commission_amount,
            released_at = NOW(),
            notes = 'Funds released on trip completion',
            updated_at = NOW()
        WHERE id = v_escrow.id;
    END IF;

    -- Update ride with payment breakdown
    UPDATE public.rides
    SET
        actual_fare = v_fare_amount,
        final_fare = v_fare_amount,
        commission_amount = v_commission_amount,
        driver_earnings = v_driver_net,
        driver_net_earning = v_driver_net,
        rider_total_amount = v_rider_total,
        payment_status = 'paid',
        paid_at = NOW(),
        updated_at = NOW()
    WHERE id = p_ride_id;

    -- Update/create driver wallet
    INSERT INTO public.driver_wallets (
        driver_id,
        available_balance,
        available_for_withdrawal,
        balance,
        total_earned,
        pending_balance,
        currency,
        created_at,
        updated_at
    )
    VALUES (
        v_driver_id, v_driver_net, v_driver_net,
        v_driver_net, v_driver_net, 0, 'MWK',
        NOW(), NOW()
    )
    ON CONFLICT (driver_id) DO UPDATE
    SET
        available_balance = COALESCE(public.driver_wallets.available_balance, 0) + v_driver_net,
        available_for_withdrawal = COALESCE(public.driver_wallets.available_for_withdrawal, 0) + v_driver_net,
        balance = COALESCE(public.driver_wallets.balance, 0) + v_driver_net,
        total_earned = COALESCE(public.driver_wallets.total_earned, 0) + v_driver_net,
        trips_today = CASE
            WHEN public.driver_wallets.statement_updated_at >= CURRENT_DATE
            THEN COALESCE(public.driver_wallets.trips_today, 0) + 1
            ELSE 1
        END,
        earned_today = CASE
            WHEN public.driver_wallets.statement_updated_at >= CURRENT_DATE
            THEN COALESCE(public.driver_wallets.earned_today, 0) + v_driver_net
            ELSE v_driver_net
        END,
        trips_this_week = CASE
            WHEN public.driver_wallets.statement_updated_at >= DATE_TRUNC('week', CURRENT_DATE)
            THEN COALESCE(public.driver_wallets.trips_this_week, 0) + 1
            ELSE 1
        END,
        earned_this_week = CASE
            WHEN public.driver_wallets.statement_updated_at >= DATE_TRUNC('week', CURRENT_DATE)
            THEN COALESCE(public.driver_wallets.earned_this_week, 0) + v_driver_net
            ELSE v_driver_net
        END,
        trips_this_month = CASE
            WHEN public.driver_wallets.statement_updated_at >= DATE_TRUNC('month', CURRENT_DATE)
            THEN COALESCE(public.driver_wallets.trips_this_month, 0) + 1
            ELSE 1
        END,
        earned_this_month = CASE
            WHEN public.driver_wallets.statement_updated_at >= DATE_TRUNC('month', CURRENT_DATE)
            THEN COALESCE(public.driver_wallets.earned_this_month, 0) + v_driver_net
            ELSE v_driver_net
        END,
        statement_updated_at = NOW(),
        updated_at = NOW()
    RETURNING id, COALESCE(available_balance, 0), COALESCE(available_balance, 0)
    INTO v_wallet_id, v_balance_before, v_balance_after;

    -- Correct: balance_before should be balance_after - v_driver_net
    v_balance_before := v_balance_after - v_driver_net;

    -- Insert driver transaction
    INSERT INTO public.driver_transactions (
        driver_id, transaction_type, amount,
        balance_before, balance_after,
        reference_type, reference_id,
        description, status, created_at
    )
    VALUES (
        v_driver_id, 'ride_earning', v_driver_net,
        COALESCE(v_balance_before, 0), COALESCE(v_balance_after, v_driver_net),
        'ride', p_ride_id,
        'Trip fare MWK ' || v_fare_amount || ' - commission MWK ' || v_commission_amount,
        'completed', NOW()
    );

    -- Insert trip earnings
    INSERT INTO public.trip_earnings (
        ride_id, driver_id, gross_fare,
        commission_rate, commission_amount,
        tax_amount, net_earning,
        is_paid_to_wallet, paid_to_wallet_at, created_at
    )
    VALUES (
        p_ride_id, v_driver_id, v_fare_amount,
        v_commission_rate, v_commission_amount,
        0, v_driver_net, true, NOW(), NOW()
    )
    ON CONFLICT (ride_id) DO UPDATE
    SET
        gross_fare = EXCLUDED.gross_fare,
        commission_rate = EXCLUDED.commission_rate,
        commission_amount = EXCLUDED.commission_amount,
        net_earning = EXCLUDED.net_earning,
        is_paid_to_wallet = true,
        paid_to_wallet_at = NOW();

    -- Company transaction records
    INSERT INTO public.company_transactions (transaction_type, amount, ride_id, description)
    VALUES
        ('commission_earning', v_commission_amount, p_ride_id,
         'Commission ' || v_commission_rate || '% on ride fare MWK ' || v_fare_amount),
        ('booking_fee', v_booking_fee, p_ride_id,
         'Rider booking fee MWK ' || v_booking_fee);

    -- Insert driver payout record
    INSERT INTO public.driver_payouts (
        driver_id, ride_id, amount, payout_method, payout_status,
        gross_fare, commission_amount, tax_amount, net_earning,
        notes
    ) VALUES (
        v_driver_id, p_ride_id, v_driver_net,
        COALESCE(v_payment_method, 'cash'), 'pending',
        v_fare_amount, v_commission_amount, 0, v_driver_net,
        'Auto-created from ride. Withdrawable to Airtel/Mpamba/Bank.'
    );

    RETURN jsonb_build_object(
        'success', true,
        'ride_id', p_ride_id,
        'fare_amount', v_fare_amount,
        'booking_fee', v_booking_fee,
        'rider_total', v_rider_total,
        'commission_rate', v_commission_rate,
        'commission_amount', v_commission_amount,
        'driver_net', v_driver_net,
        'escrow_status', COALESCE(v_escrow.escrow_status, 'no_escrow'),
        'company_revenue', v_commission_amount + v_booking_fee
    );
END;
$$;


ALTER FUNCTION "public"."process_ride_payment"("p_ride_id" "uuid") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."trip_queue" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "driver_id" "uuid" NOT NULL,
    "ride_id" "uuid" NOT NULL,
    "status" "text" DEFAULT 'queued'::"text" NOT NULL,
    "queued_at" timestamp with time zone DEFAULT "now"(),
    "expires_at" timestamp with time zone,
    "responded_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "trip_queue_status_check" CHECK (("status" = ANY (ARRAY['queued'::"text", 'accepted'::"text", 'declined'::"text", 'expired'::"text", 'activated'::"text"])))
);


ALTER TABLE "public"."trip_queue" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."queue_next_ride_for_driver"("p_driver_id" "uuid", "p_ride_id" "uuid") RETURNS "public"."trip_queue"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
DECLARE
  v_queue public.trip_queue;
BEGIN
  -- Check driver doesn't already have a queued ride
  IF EXISTS (
    SELECT 1 FROM public.trip_queue
    WHERE driver_id = p_driver_id AND status = 'queued'
  ) THEN
    RAISE EXCEPTION 'Driver already has a queued ride';
  END IF;

  -- Check driver has an active ride
  IF NOT EXISTS (
    SELECT 1 FROM public.rides
    WHERE driver_id = p_driver_id AND status IN ('accepted', 'arrived', 'in_progress')
  ) THEN
    RAISE EXCEPTION 'Driver does not have an active ride';
  END IF;

  -- Queue the ride
  INSERT INTO public.trip_queue (driver_id, ride_id, status, expires_at)
  VALUES (p_driver_id, p_ride_id, 'queued', now() + interval '5 minutes')
  RETURNING * INTO v_queue;

  RETURN v_queue;
END;
$$;


ALTER FUNCTION "public"."queue_next_ride_for_driver"("p_driver_id" "uuid", "p_ride_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."recalculate_rider_rating"("p_rider_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  update public.riders
  set
    rating = (
      select coalesce(round(avg(rating)::numeric, 2), 5.0)
      from public.rider_ratings
      where rider_id = p_rider_id
    ),
    total_ratings = (
      select count(*)
      from public.rider_ratings
      where rider_id = p_rider_id
    ),
    updated_at = now()
  where id = p_rider_id;
end;
$$;


ALTER FUNCTION "public"."recalculate_rider_rating"("p_rider_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."redeem_loyalty_reward"("p_rider_id" "uuid", "p_reward_definition_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."redeem_loyalty_reward"("p_rider_id" "uuid", "p_reward_definition_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."redeem_loyalty_reward_v2"("p_rider_id" "uuid", "p_reward_definition_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."redeem_loyalty_reward_v2"("p_rider_id" "uuid", "p_reward_definition_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rider_cancel_ride"("p_ride_id" "uuid", "p_reason" "text" DEFAULT 'Cancelled by rider'::"text", "p_rider_id" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_ride public.rides;
    v_escrow public.platform_escrow;
    v_wallet_id UUID;
    v_rider_user_id UUID;
BEGIN
    SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Ride not found');
    END IF;

    -- Check rider ownership
    IF p_rider_id IS NOT NULL AND v_ride.rider_id IS DISTINCT FROM p_rider_id THEN
        RETURN jsonb_build_object('success', false, 'error', 'Rider does not own this ride');
    END IF;

    -- Only allow cancellation in pre-dispatch states
    IF v_ride.status IN ('completed', 'cancelled', 'rider_cancelled', 'driver_cancelled', 'admin_cancelled') THEN
        RETURN jsonb_build_object('success', false, 'error', 'Ride already ' || v_ride.status);
    END IF;

    -- Update ride status
    UPDATE public.rides
    SET status = 'rider_cancelled',
        cancellation_reason = p_reason,
        cancelled_at = NOW(),
        updated_at = NOW()
    WHERE id = p_ride_id;

    -- Handle escrow refund if customer prepaid
    SELECT * INTO v_escrow FROM public.platform_escrow WHERE ride_id = p_ride_id;
    IF FOUND AND v_escrow.escrow_status = 'held' THEN
        -- Refund escrow
        UPDATE public.platform_escrow
        SET escrow_status = 'refunded',
            refunded_at = NOW(),
            notes = 'Refunded on cancellation: ' || p_reason,
            updated_at = NOW()
        WHERE id = v_escrow.id;

        -- Refund to rider wallet if payment was from wallet
        IF v_escrow.payment_method = 'wallet' THEN
            SELECT user_id INTO v_rider_user_id FROM public.riders WHERE id = v_ride.rider_id;
            IF v_rider_user_id IS NOT NULL THEN
                UPDATE public.wallets
                SET balance = balance + v_escrow.amount,
                    refund_balance = COALESCE(refund_balance, 0) + v_escrow.amount,
                    updated_at = NOW()
                WHERE user_id = v_rider_user_id
                RETURNING id INTO v_wallet_id;

                IF v_wallet_id IS NOT NULL THEN
                    INSERT INTO public.wallet_transactions (
                        wallet_id, transaction_type, amount, balance_before, balance_after,
                        reference_type, reference_id, description, payment_method, status,
                        transaction_reference
                    ) VALUES (
                        v_wallet_id, 'refund', v_escrow.amount,
                        (SELECT balance - v_escrow.amount FROM public.wallets WHERE id = v_wallet_id),
                        (SELECT balance FROM public.wallets WHERE id = v_wallet_id),
                        'ride', p_ride_id,
                        'Refund for cancelled ride ' || substring(p_ride_id::text, 1, 8),
                        'wallet', 'completed',
                        'refund_' || extract(epoch from clock_timestamp())::bigint
                    );
                END IF;
            END IF;
        END IF;

        -- Update payment record
        UPDATE public.payments
        SET payment_status = 'refunded',
            refund_amount = v_escrow.amount,
            refund_reason = p_reason,
            refunded_at = NOW()
        WHERE ride_id = p_ride_id AND payment_status = 'completed';
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'ride_id', p_ride_id,
        'status', 'rider_cancelled',
        'refunded', CASE WHEN v_escrow.escrow_status = 'held' THEN v_escrow.amount ELSE 0 END
    );
END;
$$;


ALTER FUNCTION "public"."rider_cancel_ride"("p_ride_id" "uuid", "p_reason" "text", "p_rider_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rider_cancel_ride"("p_ride_id" "uuid", "p_reason" "text" DEFAULT 'Cancelled by rider'::"text", "p_rider_id" "uuid" DEFAULT NULL::"uuid", "p_note" "text" DEFAULT NULL::"text") RETURNS "public"."rides"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_ride public.rides;
  v_previous_status TEXT;
  v_cancellation_fee NUMERIC(12,2) := 0;
BEGIN
  IF p_ride_id IS NULL THEN
    RAISE EXCEPTION 'Ride id is required';
  END IF;

  IF p_rider_id IS NULL THEN
    RAISE EXCEPTION 'Rider id is required';
  END IF;

  SELECT * INTO v_ride
  FROM public.rides
  WHERE id = p_ride_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ride not found';
  END IF;

  IF v_ride.rider_id IS DISTINCT FROM p_rider_id THEN
    RAISE EXCEPTION 'Rider does not own this ride';
  END IF;

  IF v_ride.status = 'completed' THEN
    RAISE EXCEPTION 'Completed rides cannot be cancelled';
  END IF;

  IF v_ride.status IN (
    'cancelled',
    'rider_cancelled',
    'driver_cancelled',
    'admin_cancelled',
    'no_driver_found'
  ) THEN
    RAISE EXCEPTION 'Ride is already in terminal status: %', v_ride.status;
  END IF;

  IF v_ride.status = 'in_progress' THEN
    RAISE EXCEPTION 'Ride already started and cannot be cancelled by rider';
  END IF;

  v_previous_status := v_ride.status;

  -- Simple cancellation-fee policy until configurable pricing rules are added:
  -- no fee before driver arrival; 10% after driver arrival.
  v_cancellation_fee := CASE
    WHEN v_ride.status = 'arrived'
      THEN ROUND((COALESCE(v_ride.estimated_fare, v_ride.fare, v_ride.final_fare, 0) * 0.10)::numeric, 2)
    ELSE 0
  END;

  UPDATE public.rides
  SET status = 'rider_cancelled',
      cancelled_at = now(),
      cancelled_by = 'rider',
      cancellation_reason = COALESCE(NULLIF(p_reason, ''), 'Cancelled by rider'),
      cancellation_note = p_note,
      cancellation_fee = v_cancellation_fee,
      updated_at = now()
  WHERE id = p_ride_id
  RETURNING * INTO v_ride;

  UPDATE public.ride_requests
  SET status = 'expired',
      responded_at = COALESCE(responded_at, now())
  WHERE ride_id = p_ride_id
    AND status = 'pending';

  IF to_regclass('public.trip_queue') IS NOT NULL THEN
    UPDATE public.trip_queue
    SET status = 'expired',
        responded_at = COALESCE(responded_at, now())
    WHERE ride_id = p_ride_id
      AND status = 'queued';
  END IF;

  INSERT INTO public.ride_events(ride_id, actor_id, event_type, metadata)
  SELECT
    p_ride_id,
    r.user_id,
    'rider_cancelled',
    jsonb_build_object(
      'reason', COALESCE(NULLIF(p_reason, ''), 'Cancelled by rider'),
      'note', p_note,
      'previous_status', v_previous_status,
      'cancellation_fee', v_cancellation_fee,
      'source', 'rider_app'
    )
  FROM public.riders r
  WHERE r.id = p_rider_id;

  -- Lightweight in-app notification rows for consumers/admin tooling that read
  -- generic notifications. Push delivery can be layered on via edge functions.
  IF to_regclass('public.notifications') IS NOT NULL THEN
    IF v_ride.driver_id IS NOT NULL THEN
      INSERT INTO public.notifications(user_id, title, body, type, data, created_at)
      SELECT d.user_id,
             'Ride cancelled',
             'The rider cancelled the trip.',
             'trip_update',
             jsonb_build_object('ride_id', p_ride_id, 'status', 'rider_cancelled'),
             now()
      FROM public.drivers d
      WHERE d.id = v_ride.driver_id;
    END IF;
  END IF;

  RETURN v_ride;
END;
$$;


ALTER FUNCTION "public"."rider_cancel_ride"("p_ride_id" "uuid", "p_reason" "text", "p_rider_id" "uuid", "p_note" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rider_prepay_ride"("p_ride_id" "uuid", "p_rider_id" "uuid", "p_fare_amount" numeric, "p_booking_fee" numeric DEFAULT 300, "p_payment_method" "text" DEFAULT 'airtel_money'::"text", "p_payment_reference" "text" DEFAULT NULL::"text", "p_provider_reference" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_ride public.rides;
    v_rider_user_id UUID;
    v_total_amount NUMERIC(12,2);
    v_escrow_id UUID;
    v_wallet_id UUID;
    v_wallet_balance NUMERIC(12,2);
    v_payment_id UUID;
    v_reference TEXT;
BEGIN
    -- Validate ride exists
    SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Ride not found');
    END IF;

    -- Validate rider owns this ride
    IF v_ride.rider_id IS DISTINCT FROM p_rider_id THEN
        RETURN jsonb_build_object('success', false, 'error', 'Rider does not own this ride');
    END IF;

    -- Calculate total
    v_total_amount := COALESCE(p_fare_amount, 0) + COALESCE(p_booking_fee, 300);
    v_reference := COALESCE(p_payment_reference, 'prepay_' || extract(epoch from clock_timestamp())::bigint || '_' || substr(gen_random_uuid()::text, 1, 8));

    -- Handle wallet payment method
    IF p_payment_method = 'wallet' THEN
        -- Get rider user_id for wallet lookup
        SELECT user_id INTO v_rider_user_id FROM public.riders WHERE id = p_rider_id;
        IF v_rider_user_id IS NULL THEN
            RETURN jsonb_build_object('success', false, 'error', 'Rider user not found');
        END IF;

        -- Get wallet
        SELECT id, balance INTO v_wallet_id, v_wallet_balance
        FROM public.wallets
        WHERE user_id = v_rider_user_id;

        IF v_wallet_id IS NULL THEN
            RETURN jsonb_build_object('success', false, 'error', 'Wallet not found. Please top up.');
        END IF;

        -- Check balance
        IF COALESCE(v_wallet_balance, 0) < v_total_amount THEN
            RETURN jsonb_build_object('success', false, 'error', 'Insufficient wallet balance. Need MWK ' || v_total_amount || ', have MWK ' || COALESCE(v_wallet_balance, 0));
        END IF;

        -- Deduct from wallet
        UPDATE public.wallets
        SET balance = balance - v_total_amount,
            updated_at = NOW()
        WHERE id = v_wallet_id
        RETURNING balance INTO v_wallet_balance;

        -- Log wallet transaction
        INSERT INTO public.wallet_transactions (
            wallet_id, transaction_type, amount, balance_before, balance_after,
            reference_type, reference_id, description, payment_method, status, transaction_reference
        ) VALUES (
            v_wallet_id, 'ride_payment', -v_total_amount,
            v_wallet_balance + v_total_amount, v_wallet_balance,
            'ride', p_ride_id, 'Prepayment for ride ' || substring(p_ride_id::text, 1, 8),
            'wallet', 'completed', v_reference
        );
    END IF;

    -- Create payment record
    INSERT INTO public.payments (
        ride_id, user_id, paid_by, user_type, type, amount, currency,
        payment_method, payment_status, status, transaction_reference,
        reference, provider_reference, paid_at
    ) VALUES (
        p_ride_id, v_rider_user_id, v_rider_user_id, 'rider', 'ride_payment',
        v_total_amount, 'MWK', p_payment_method,
        'completed', 'completed', v_reference, v_reference,
        p_provider_reference, NOW()
    ) RETURNING id INTO v_payment_id;

    -- Create escrow hold
    INSERT INTO public.platform_escrow (
        ride_id, rider_id, amount, booking_fee, fare_amount,
        payment_method, payment_reference, payment_provider, provider_reference,
        escrow_status, held_at
    ) VALUES (
        p_ride_id, p_rider_id, v_total_amount,
        COALESCE(p_booking_fee, 300), COALESCE(p_fare_amount, 0),
        p_payment_method, v_reference, p_payment_method,
        p_provider_reference, 'held', NOW()
    ) RETURNING id INTO v_escrow_id;

    -- Update ride as paid
    UPDATE public.rides SET
        payment_status = 'paid',
        payment_method = p_payment_method,
        booking_fee = COALESCE(p_booking_fee, 300),
        rider_total_amount = v_total_amount,
        escrow_id = v_escrow_id,
        payment_provider = p_payment_method,
        provider_reference = p_provider_reference,
        payment_collected_at = NOW(),
        updated_at = NOW()
    WHERE id = p_ride_id;

    RETURN jsonb_build_object(
        'success', true,
        'ride_id', p_ride_id,
        'escrow_id', v_escrow_id,
        'payment_id', v_payment_id,
        'total_amount', v_total_amount,
        'fare_amount', COALESCE(p_fare_amount, 0),
        'booking_fee', COALESCE(p_booking_fee, 300),
        'payment_method', p_payment_method,
        'status', 'paid'
    );
END;
$$;


ALTER FUNCTION "public"."rider_prepay_ride"("p_ride_id" "uuid", "p_rider_id" "uuid", "p_fare_amount" numeric, "p_booking_fee" numeric, "p_payment_method" "text", "p_payment_reference" "text", "p_provider_reference" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rider_wallet_pay_ride"("p_rider_id" "uuid", "p_ride_id" "uuid", "p_amount" numeric DEFAULT NULL::numeric) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_wallet public.wallets;
  v_ride public.rides;
  v_user_id UUID;
  v_amount NUMERIC(12,2);
  v_before NUMERIC(12,2);
  v_after NUMERIC(12,2);
  v_reference TEXT;
  v_payment_id UUID;
  v_tx_id UUID;
BEGIN
  SELECT * INTO v_ride
  FROM public.rides
  WHERE id = p_ride_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ride not found';
  END IF;

  IF v_ride.rider_id IS DISTINCT FROM p_rider_id THEN
    RAISE EXCEPTION 'Rider does not own this ride';
  END IF;

  v_amount := COALESCE(p_amount, v_ride.actual_fare, v_ride.final_fare, v_ride.fare, v_ride.estimated_fare, 0);
  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'Ride payment amount must be greater than zero';
  END IF;

  v_wallet := public.ensure_rider_wallet(p_rider_id);
  v_user_id := v_wallet.user_id;
  v_before := COALESCE(v_wallet.balance, 0);

  IF v_before < v_amount THEN
    RAISE EXCEPTION 'Insufficient wallet balance';
  END IF;

  v_after := v_before - v_amount;
  v_reference := 'wallet_ride_' || extract(epoch from clock_timestamp())::bigint || '_' || substr(gen_random_uuid()::text, 1, 8);

  UPDATE public.wallets
  SET balance = v_after,
      updated_at = now()
  WHERE id = v_wallet.id
  RETURNING * INTO v_wallet;

  UPDATE public.rides
  SET payment_method = 'wallet',
      payment_status = 'paid',
      updated_at = now()
  WHERE id = p_ride_id
  RETURNING * INTO v_ride;

  INSERT INTO public.wallet_transactions(
    wallet_id, transaction_type, amount, balance_before, balance_after,
    reference_type, reference_id, description, payment_method, status, transaction_reference
  ) VALUES (
    v_wallet.id, 'ride_payment', -v_amount, v_before, v_after,
    'ride', p_ride_id, 'Ride payment from wallet', 'wallet', 'completed', v_reference
  ) RETURNING id INTO v_tx_id;

  INSERT INTO public.payments(
    ride_id, user_id, paid_by, user_type, type, amount, currency, payment_method,
    payment_status, status, transaction_reference, reference, paid_at
  ) VALUES (
    p_ride_id, v_user_id, v_user_id, 'rider', 'ride_payment', v_amount, 'MWK', 'wallet',
    'completed', 'completed', v_reference, v_reference, now()
  )
  ON CONFLICT (ride_id) DO UPDATE
    SET amount = EXCLUDED.amount,
        payment_method = EXCLUDED.payment_method,
        payment_status = EXCLUDED.payment_status,
        status = EXCLUDED.status,
        transaction_reference = EXCLUDED.transaction_reference,
        reference = EXCLUDED.reference,
        paid_at = EXCLUDED.paid_at,
        updated_at = now()
  RETURNING id INTO v_payment_id;

  RETURN jsonb_build_object('ok', true, 'wallet', to_jsonb(v_wallet), 'ride', to_jsonb(v_ride), 'transaction_id', v_tx_id, 'payment_id', v_payment_id, 'reference', v_reference);
END;
$$;


ALTER FUNCTION "public"."rider_wallet_pay_ride"("p_rider_id" "uuid", "p_ride_id" "uuid", "p_amount" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rider_wallet_top_up"("p_rider_id" "uuid", "p_amount" numeric, "p_method" "text" DEFAULT 'airtel_money'::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_wallet public.wallets;
  v_user_id UUID;
  v_before NUMERIC(12,2);
  v_after NUMERIC(12,2);
  v_reference TEXT;
  v_payment_id UUID;
  v_tx_id UUID;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Top-up amount must be greater than zero';
  END IF;

  v_wallet := public.ensure_rider_wallet(p_rider_id);
  v_user_id := v_wallet.user_id;
  v_before := COALESCE(v_wallet.balance, 0);
  v_after := v_before + p_amount;
  v_reference := 'rider_topup_' || extract(epoch from clock_timestamp())::bigint || '_' || substr(gen_random_uuid()::text, 1, 8);

  UPDATE public.wallets
  SET balance = v_after,
      updated_at = now()
  WHERE id = v_wallet.id
  RETURNING * INTO v_wallet;

  INSERT INTO public.wallet_transactions(
    wallet_id, transaction_type, amount, balance_before, balance_after,
    reference_type, description, payment_method, status, transaction_reference
  ) VALUES (
    v_wallet.id, 'top_up', p_amount, v_before, v_after,
    'payment', 'Wallet top-up via ' || COALESCE(p_method, 'mobile_money'),
    COALESCE(p_method, 'airtel_money'), 'completed', v_reference
  ) RETURNING id INTO v_tx_id;

  INSERT INTO public.payments(
    user_id, paid_by, user_type, type, amount, currency, payment_method,
    payment_status, status, transaction_reference, reference, paid_at
  ) VALUES (
    v_user_id, v_user_id, 'rider', 'topup', p_amount, 'MWK', COALESCE(p_method, 'airtel_money'),
    'completed', 'completed', v_reference, v_reference, now()
  ) RETURNING id INTO v_payment_id;

  RETURN jsonb_build_object('ok', true, 'wallet', to_jsonb(v_wallet), 'transaction_id', v_tx_id, 'payment_id', v_payment_id, 'reference', v_reference);
END;
$$;


ALTER FUNCTION "public"."rider_wallet_top_up"("p_rider_id" "uuid", "p_amount" numeric, "p_method" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rider_wallet_transfer"("p_rider_id" "uuid", "p_amount" numeric, "p_recipient" "text", "p_method" "text" DEFAULT 'airtel_money'::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_wallet public.wallets;
  v_user_id UUID;
  v_before NUMERIC(12,2);
  v_after NUMERIC(12,2);
  v_reference TEXT;
  v_payment_id UUID;
  v_tx_id UUID;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Transfer amount must be greater than zero';
  END IF;

  IF COALESCE(NULLIF(p_recipient, ''), '') = '' THEN
    RAISE EXCEPTION 'Recipient is required';
  END IF;

  v_wallet := public.ensure_rider_wallet(p_rider_id);
  v_user_id := v_wallet.user_id;
  v_before := COALESCE(v_wallet.balance, 0);

  IF v_before < p_amount THEN
    RAISE EXCEPTION 'Insufficient wallet balance';
  END IF;

  v_after := v_before - p_amount;
  v_reference := 'rider_transfer_' || extract(epoch from clock_timestamp())::bigint || '_' || substr(gen_random_uuid()::text, 1, 8);

  UPDATE public.wallets
  SET balance = v_after,
      updated_at = now()
  WHERE id = v_wallet.id
  RETURNING * INTO v_wallet;

  INSERT INTO public.wallet_transactions(
    wallet_id, transaction_type, amount, balance_before, balance_after,
    reference_type, description, payment_method, status, transaction_reference
  ) VALUES (
    v_wallet.id, 'transfer', -p_amount, v_before, v_after,
    'transfer', 'Wallet transfer to ' || p_recipient,
    COALESCE(p_method, 'airtel_money'), 'pending', v_reference
  ) RETURNING id INTO v_tx_id;

  INSERT INTO public.payments(
    user_id, paid_by, user_type, type, amount, currency, payment_method,
    payment_status, status, transaction_reference, reference
  ) VALUES (
    v_user_id, v_user_id, 'rider', 'transfer', -p_amount, 'MWK', COALESCE(p_method, 'airtel_money'),
    'pending', 'pending', v_reference, v_reference
  ) RETURNING id INTO v_payment_id;

  RETURN jsonb_build_object('ok', true, 'wallet', to_jsonb(v_wallet), 'transaction_id', v_tx_id, 'payment_id', v_payment_id, 'reference', v_reference);
END;
$$;


ALTER FUNCTION "public"."rider_wallet_transfer"("p_rider_id" "uuid", "p_amount" numeric, "p_recipient" "text", "p_method" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."send_push_notification"("p_notification_id" "uuid") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE
    v_notif RECORD;
    v_target_count INTEGER;
BEGIN
    SELECT * INTO v_notif FROM public.push_notifications WHERE id = p_notification_id;
    IF v_notif IS NULL THEN RETURN 0; END IF;

    -- Get target user count
    v_target_count := public.get_notification_target_count(v_notif.recipient_group, v_notif.target_country, v_notif.target_city);

    -- Insert delivery log entries for target users (simplified — actual FCM send happens via edge function)
    INSERT INTO public.notification_delivery_logs (notification_id, user_id, role, fcm_token, status)
    SELECT 
        p_notification_id,
        t.user_id,
        t.role,
        t.fcm_token,
        'pending'
    FROM public.user_notification_tokens t
    WHERE t.is_active = true
    AND (
        v_notif.recipient_group = 'all'
        OR (v_notif.recipient_group = 'riders' AND t.role = 'rider')
        OR (v_notif.recipient_group = 'drivers' AND t.role = 'driver')
        OR (v_notif.recipient_group = 'approved_drivers' AND t.role = 'driver' AND EXISTS (SELECT 1 FROM public.drivers d WHERE d.user_id = t.user_id AND d.approval_status = 'approved'))
        OR (v_notif.recipient_group = 'online_drivers' AND t.role = 'driver' AND EXISTS (SELECT 1 FROM public.drivers d WHERE d.user_id = t.user_id AND d.is_online = true))
    )
    LIMIT 5000;

    -- Mark notification as sending
    UPDATE public.push_notifications 
    SET status = 'sending', target_count = v_target_count, updated_at = NOW()
    WHERE id = p_notification_id;

    RETURN v_target_count;
END;
$$;


ALTER FUNCTION "public"."send_push_notification"("p_notification_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."service_zones_audit_trigger"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.service_zone_audit_logs(zone_id, action, before_data, after_data)
    VALUES (NEW.id, 'zone_created', NULL, to_jsonb(NEW));
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO public.service_zone_audit_logs(zone_id, action, before_data, after_data)
    VALUES (NEW.id, 'zone_updated', to_jsonb(OLD), to_jsonb(NEW));
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.service_zone_audit_logs(zone_id, action, before_data, after_data)
    VALUES (OLD.id, 'zone_deleted', to_jsonb(OLD), NULL);
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;


ALTER FUNCTION "public"."service_zones_audit_trigger"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."service_zones_set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."service_zones_set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_referral_setting"("p_key" "text", "p_value" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
BEGIN
  INSERT INTO public.referral_settings (setting_key, setting_value, updated_at)
  VALUES (p_key, p_value, NOW())
  ON CONFLICT (setting_key)
  DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = NOW();
END;
$$;


ALTER FUNCTION "public"."set_referral_setting"("p_key" "text", "p_value" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."start_ride_with_pin"("p_ride_id" "uuid", "p_pin" "text") RETURNS "public"."rides"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_ride public.rides;
  v_clean_pin text;
BEGIN
  v_clean_pin := trim(COALESCE(p_pin, ''));

  UPDATE public.rides
  SET status = 'in_progress',
      started_at = now(),
      updated_at = now()
  WHERE id = p_ride_id
    AND status IN ('arrived', 'driver_arrived')
    AND (
      COALESCE(rider_pin::text, '') = v_clean_pin
      OR COALESCE(start_pin::text, '') = v_clean_pin
    )
  RETURNING * INTO v_ride;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid ride PIN';
  END IF;

  INSERT INTO public.ride_events(ride_id, actor_id, event_type)
  VALUES (p_ride_id, v_ride.driver_id, 'trip_started');

  RETURN v_ride;
END;
$$;


ALTER FUNCTION "public"."start_ride_with_pin"("p_ride_id" "uuid", "p_pin" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_driver_wallet_balance_columns"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_available DECIMAL(12,2);
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.available_balance IS DISTINCT FROM OLD.available_balance THEN
      v_available := COALESCE(NEW.available_balance, 0);
    ELSIF NEW.available_for_withdrawal IS DISTINCT FROM OLD.available_for_withdrawal THEN
      v_available := COALESCE(NEW.available_for_withdrawal, 0);
    ELSIF NEW.balance IS DISTINCT FROM OLD.balance THEN
      v_available := COALESCE(NEW.balance, 0);
    ELSE
      v_available := COALESCE(NEW.available_balance, NEW.available_for_withdrawal, NEW.balance, 0);
    END IF;
  ELSE
    v_available := COALESCE(NEW.available_balance, NEW.available_for_withdrawal, NEW.balance, 0);
  END IF;

  NEW.available_balance := v_available;
  NEW.available_for_withdrawal := v_available;
  NEW.balance := v_available;
  NEW.pending_balance := COALESCE(NEW.pending_balance, 0);
  NEW.cash_collected := COALESCE(NEW.cash_collected, 0);
  NEW.total_earned := COALESCE(NEW.total_earned, 0);
  NEW.total_withdrawn := COALESCE(NEW.total_withdrawn, 0);
  NEW.currency := COALESCE(NEW.currency, 'MWK');
  NEW.updated_at := NOW();

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."sync_driver_wallet_balance_columns"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_driver_wallet_transaction_to_payout_request"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_wallet_id UUID;
  v_amount DECIMAL(12,2);
  v_reference TEXT;
  v_status TEXT;
BEGIN
  IF COALESCE(NEW.transaction_type, '') NOT IN ('withdrawal', 'payout', 'transfer')
     OR COALESCE(NEW.amount, 0) >= 0 THEN
    RETURN NEW;
  END IF;

  v_amount := ABS(NEW.amount);
  v_reference := COALESCE(NEW.payout_reference, NEW.id::TEXT);

  SELECT id INTO v_wallet_id
  FROM public.driver_wallets
  WHERE driver_id = NEW.driver_id
  LIMIT 1;

  v_status := CASE COALESCE(NEW.status, 'pending')
    WHEN 'completed' THEN 'paid'
    WHEN 'paid' THEN 'paid'
    WHEN 'approved' THEN 'approved'
    WHEN 'processing' THEN 'processing'
    WHEN 'failed' THEN 'failed'
    WHEN 'rejected' THEN 'rejected'
    WHEN 'cancelled' THEN 'cancelled'
    ELSE 'pending'
  END;

  INSERT INTO public.driver_payout_requests (
    driver_id,
    wallet_id,
    amount,
    fee,
    net_amount,
    payout_method,
    account_number,
    account_name,
    status,
    transaction_reference,
    notes,
    created_at,
    updated_at
  )
  SELECT
    NEW.driver_id,
    v_wallet_id,
    v_amount,
    0,
    v_amount,
    NEW.payout_method,
    NULL,
    NULL,
    v_status,
    v_reference,
    COALESCE(NEW.description, 'Driver wallet withdrawal'),
    COALESCE(NEW.created_at, NOW()),
    NOW()
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.driver_payout_requests pr
    WHERE pr.transaction_reference = v_reference
  );

  UPDATE public.driver_payout_requests
  SET
    wallet_id = COALESCE(v_wallet_id, wallet_id),
    amount = v_amount,
    net_amount = v_amount,
    payout_method = COALESCE(NEW.payout_method, payout_method),
    status = v_status,
    notes = COALESCE(NEW.description, notes),
    updated_at = NOW()
  WHERE transaction_reference = v_reference;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."sync_driver_wallet_transaction_to_payout_request"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_payout_request_status_to_driver_wallet"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_driver_tx_status TEXT;
  v_payment_status TEXT;
BEGIN
  IF NEW.transaction_reference IS NULL THEN
    RETURN NEW;
  END IF;

  v_driver_tx_status := CASE COALESCE(NEW.status, 'pending')
    WHEN 'paid' THEN 'completed'
    WHEN 'completed' THEN 'completed'
    WHEN 'failed' THEN 'failed'
    WHEN 'rejected' THEN 'rejected'
    WHEN 'cancelled' THEN 'cancelled'
    WHEN 'approved' THEN 'approved'
    WHEN 'processing' THEN 'processing'
    ELSE 'pending'
  END;

  v_payment_status := CASE COALESCE(NEW.status, 'pending')
    WHEN 'paid' THEN 'completed'
    WHEN 'completed' THEN 'completed'
    WHEN 'failed' THEN 'failed'
    WHEN 'rejected' THEN 'failed'
    WHEN 'cancelled' THEN 'cancelled'
    ELSE 'pending'
  END;

  UPDATE public.driver_transactions
  SET
    status = v_driver_tx_status,
    payout_method = COALESCE(NEW.payout_method, payout_method)
  WHERE payout_reference = NEW.transaction_reference
    AND status IS DISTINCT FROM v_driver_tx_status;

  UPDATE public.payments
  SET
    status = v_payment_status,
    payment_status = v_payment_status
  WHERE COALESCE(transaction_reference, reference) = NEW.transaction_reference
    AND COALESCE(user_type, '') = 'driver'
    AND COALESCE(type, '') IN ('payout', 'transfer')
    AND COALESCE(payment_status, status, '') IS DISTINCT FROM v_payment_status;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."sync_payout_request_status_to_driver_wallet"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_notify_driver_referral_change"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE
  v_referred_name TEXT;
BEGIN
  -- Only fire on meaningful status transitions
  IF NEW.status <> COALESCE(OLD.status, '') THEN
    -- Get referred driver's name
    IF NEW.referred_driver_id IS NOT NULL THEN
      SELECT COALESCE(u.full_name, d.full_name, 'Driver')
      INTO v_referred_name
      FROM public.drivers d
      LEFT JOIN public.users u ON u.id = d.user_id
      WHERE d.id = NEW.referred_driver_id;
    END IF;

    -- Map status to event type
    IF NEW.status = 'signed_up' THEN
      PERFORM public.notify_referral_event(NEW.id, 'driver', 'referral_joined', NEW.referrer_id, v_referred_name);
    ELSIF NEW.status = 'first_trip_completed' THEN
      PERFORM public.notify_referral_event(NEW.id, 'driver', 'first_trip_completed', NEW.referrer_id, v_referred_name);
    ELSIF NEW.status = 'bonus_approved' THEN
      PERFORM public.notify_referral_event(NEW.id, 'driver', 'bonus_approved', NEW.referrer_id, v_referred_name);
    ELSIF NEW.status = 'bonus_paid' THEN
      PERFORM public.notify_referral_event(NEW.id, 'driver', 'bonus_paid', NEW.referrer_id, v_referred_name);
    ELSIF NEW.status = 'fraud_review' THEN
      PERFORM public.notify_referral_event(NEW.id, 'driver', 'fraud_detected', NEW.referrer_id, v_referred_name);
    END IF;
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."trg_notify_driver_referral_change"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_notify_rider_referral_change"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE
  v_referred_name TEXT;
BEGIN
  IF NEW.status <> COALESCE(OLD.status, '') THEN
    IF NEW.referred_rider_id IS NOT NULL THEN
      SELECT COALESCE(u.full_name, r.full_name, 'Rider')
      INTO v_referred_name
      FROM public.riders r
      LEFT JOIN public.users u ON u.id = r.user_id
      WHERE r.id = NEW.referred_rider_id;
    END IF;

    IF NEW.status = 'signed_up' THEN
      PERFORM public.notify_referral_event(NEW.id, 'rider', 'referral_joined', NEW.referrer_id, v_referred_name);
    ELSIF NEW.status = 'first_ride_completed' THEN
      PERFORM public.notify_referral_event(NEW.id, 'rider', 'first_trip_completed', NEW.referrer_id, v_referred_name);
    ELSIF NEW.status = 'credit_approved' THEN
      PERFORM public.notify_referral_event(NEW.id, 'rider', 'bonus_approved', NEW.referrer_id, v_referred_name);
    ELSIF NEW.status = 'credit_issued' THEN
      PERFORM public.notify_referral_event(NEW.id, 'rider', 'bonus_paid', NEW.referrer_id, v_referred_name);
    ELSIF NEW.status = 'fraud_review' THEN
      PERFORM public.notify_referral_event(NEW.id, 'rider', 'fraud_detected', NEW.referrer_id, v_referred_name);
    END IF;
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."trg_notify_rider_referral_change"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trigger_recalculate_rider_rating"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if (tg_op = 'DELETE') then
    perform public.recalculate_rider_rating(old.rider_id);
  else
    perform public.recalculate_rider_rating(new.rider_id);
  end if;
  return null;
end;
$$;


ALTER FUNCTION "public"."trigger_recalculate_rider_rating"() OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."driver_locations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "driver_id" "uuid" NOT NULL,
    "latitude" double precision,
    "longitude" double precision,
    "heading" double precision,
    "speed" double precision,
    "is_online" boolean DEFAULT false,
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "created_at" timestamp with time zone DEFAULT "now"(),
    "firebase_uid" "text",
    "accuracy" double precision,
    "last_seen_at" timestamp with time zone,
    "device_id" "text"
);


ALTER TABLE "public"."driver_locations" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_driver_location"("p_driver_id" "uuid", "p_latitude" double precision, "p_longitude" double precision, "p_heading" double precision DEFAULT 0, "p_speed" double precision DEFAULT 0, "p_accuracy" double precision DEFAULT NULL::double precision, "p_is_online" boolean DEFAULT true) RETURNS "public"."driver_locations"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_location public.driver_locations;
BEGIN
  INSERT INTO public.driver_locations (
    driver_id, latitude, longitude, heading, speed, accuracy, is_online, updated_at
  )
  VALUES (
    p_driver_id, p_latitude, p_longitude, p_heading, p_speed, p_accuracy, p_is_online, now()
  )
  ON CONFLICT (driver_id) DO UPDATE
    SET latitude = EXCLUDED.latitude,
        longitude = EXCLUDED.longitude,
        heading = EXCLUDED.heading,
        speed = EXCLUDED.speed,
        accuracy = EXCLUDED.accuracy,
        is_online = EXCLUDED.is_online,
        updated_at = now()
  RETURNING * INTO v_location;

  UPDATE public.drivers
  SET is_online = p_is_online,
      updated_at = now()
  WHERE id = p_driver_id;

  RETURN v_location;
END;
$$;


ALTER FUNCTION "public"."update_driver_location"("p_driver_id" "uuid", "p_latitude" double precision, "p_longitude" double precision, "p_heading" double precision, "p_speed" double precision, "p_accuracy" double precision, "p_is_online" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_updated_at_column"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_updated_at_column"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."use_rider_reward"("p_reward_id" "uuid", "p_ride_id" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."use_rider_reward"("p_reward_id" "uuid", "p_ride_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."uuid_generate_v4"() RETURNS "uuid"
    LANGUAGE "sql"
    AS $$ SELECT gen_random_uuid(); $$;


ALTER FUNCTION "public"."uuid_generate_v4"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."validate_driver_approval"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF NEW.approval_status = 'approved' THEN

    IF (
      COALESCE(NEW.driver_license_number, NEW.license_number, '') = ''
      OR NEW.date_of_birth IS NULL
      OR COALESCE(NEW.national_id, NEW.id_number, NEW.national_id_number, '') = ''
      OR NEW.license_verified IS NOT TRUE
      OR NEW.id_verified IS NOT TRUE
      OR (
        NEW.driver_type NOT IN ('no_vehicle', 'without_vehicle')
        AND NEW.vehicle_id IS NULL
      )
    ) THEN
      RAISE EXCEPTION 'Driver cannot be approved until verification is complete';
    END IF;

  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."validate_driver_approval"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."validate_promo_code"("p_code" "text", "p_user_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_promo RECORD;
  v_user_use_count INT;
  v_now TIMESTAMPTZ := NOW();
  v_result JSONB;
BEGIN
  -- Find the promo code
  SELECT * INTO v_promo
  FROM promo_codes
  WHERE UPPER(code) = UPPER(p_code)
  LIMIT 1;

  IF v_promo IS NULL THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Promo code not found.');
  END IF;

  -- Check status
  IF v_promo.status != 'active' THEN
    RETURN jsonb_build_object('valid', false, 'error', 'This promo code is no longer active.');
  END IF;

  -- Check start date
  IF v_promo.starts_at IS NOT NULL AND v_promo.starts_at > v_now THEN
    RETURN jsonb_build_object('valid', false, 'error', 'This promo code is not yet active.');
  END IF;

  -- Check expiry
  IF v_promo.expires_at IS NOT NULL AND v_promo.expires_at < v_now THEN
    RETURN jsonb_build_object('valid', false, 'error', 'This promo code has expired.');
  END IF;

  -- Check max uses
  IF v_promo.max_uses IS NOT NULL AND v_promo.current_uses >= v_promo.max_uses THEN
    RETURN jsonb_build_object('valid', false, 'error', 'This promo code has reached its usage limit.');
  END IF;

  -- Check per-user limit
  SELECT COUNT(*) INTO v_user_use_count
  FROM promo_redemptions
  WHERE promo_id = v_promo.id AND user_id = p_user_id;

  IF v_user_use_count >= COALESCE(v_promo.per_user_limit, 1) THEN
    RETURN jsonb_build_object('valid', false, 'error', 'You have already used this promo code.');
  END IF;

  -- All checks passed
  RETURN jsonb_build_object(
    'valid', true,
    'promo_id', v_promo.id,
    'code', v_promo.code,
    'type', v_promo.type,
    'value', v_promo.value,
    'max_discount', COALESCE(v_promo.max_discount, 0),
    'min_order', COALESCE(v_promo.min_order, 0),
    'applies_to', COALESCE(v_promo.applies_to, 'all'),
    'expires_at', v_promo.expires_at
  );
END;
$$;


ALTER FUNCTION "public"."validate_promo_code"("p_code" "text", "p_user_id" "uuid") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."admin_audit_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "admin_id" "uuid",
    "action" "text" NOT NULL,
    "target_type" "text" NOT NULL,
    "target_id" "uuid",
    "case_id" "uuid",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "ip_address" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."admin_audit_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."admin_payout_actions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "payout_request_id" "uuid",
    "batch_id" "uuid",
    "action" "text" NOT NULL,
    "old_status" "text",
    "new_status" "text",
    "admin_notes" "text",
    "processed_by" "uuid",
    "processed_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."admin_payout_actions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."admin_permissions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "description" "text"
);


ALTER TABLE "public"."admin_permissions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."admin_roles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "permissions" "jsonb" DEFAULT '{}'::"jsonb",
    "is_system" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."admin_roles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."admin_settings_audit_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "admin_id" "uuid",
    "setting_key" "text" NOT NULL,
    "section" "text",
    "old_value" "jsonb",
    "new_value" "jsonb",
    "changed_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."admin_settings_audit_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."admin_users" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "email" "text" NOT NULL,
    "display_name" "text",
    "role" "text" DEFAULT 'superadmin'::"text",
    "role_id" "text",
    "password_hash" "text",
    "login_count" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "status" "text" DEFAULT 'active'::"text",
    "last_login" timestamp with time zone,
    "is_active" boolean DEFAULT true,
    "phone_number" "text",
    "permissions" "jsonb" DEFAULT '{}'::"jsonb",
    "last_login_at" timestamp with time zone,
    "suspension_reason" "text",
    "user_id" "uuid",
    "firebase_uid" "text"
);


ALTER TABLE "public"."admin_users" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."airport_zone_queue" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "zone_id" "uuid" NOT NULL,
    "driver_id" "uuid",
    "status" "text" DEFAULT 'waiting'::"text" NOT NULL,
    "queue_position" integer,
    "entered_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "called_at" timestamp with time zone,
    "assigned_ride_id" "uuid",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    CONSTRAINT "airport_zone_queue_status_check" CHECK (("status" = ANY (ARRAY['waiting'::"text", 'called'::"text", 'assigned'::"text", 'left'::"text", 'expired'::"text"])))
);


ALTER TABLE "public"."airport_zone_queue" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."app_settings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "setting_key" "text" NOT NULL,
    "setting_value" "jsonb" NOT NULL,
    "description" "text",
    "section" "text" DEFAULT 'general'::"text",
    "group_name" "text" DEFAULT 'app_identity'::"text",
    "label" "text",
    "value_type" "text" DEFAULT 'text'::"text",
    "options" "jsonb",
    "is_public" boolean DEFAULT true,
    "is_sensitive" boolean DEFAULT false,
    "updated_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."app_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."audit_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "admin_id" "uuid" NOT NULL,
    "action" "text" NOT NULL,
    "target_type" "text" DEFAULT 'staff'::"text",
    "target_id" "text",
    "target_name" "text",
    "details" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."audit_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."cities" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "country_id" "uuid",
    "name" "text" NOT NULL,
    "region" "text",
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."cities" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."commission_configs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "vehicle_class" "text" NOT NULL,
    "commission_percent" numeric(5,2) DEFAULT 20 NOT NULL,
    "min_commission" numeric(12,2) DEFAULT 0,
    "max_commission" numeric(12,2) DEFAULT 0,
    "driver_percent" numeric(5,2) DEFAULT 80,
    "is_active" boolean DEFAULT true,
    "notes" "text",
    "updated_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."commission_configs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."commission_rules" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "role" "text" NOT NULL,
    "commission_rate" numeric NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "country_code" "text"
);


ALTER TABLE "public"."commission_rules" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."company_commissions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "ride_id" "uuid" NOT NULL,
    "driver_id" "uuid",
    "gross_fare" numeric(12,2) DEFAULT 0 NOT NULL,
    "commission_amount" numeric(12,2) DEFAULT 0,
    "commission_percent" numeric(5,2) DEFAULT 20,
    "tax_collected" numeric(12,2) DEFAULT 0,
    "net_commission" numeric(12,2) DEFAULT 0,
    "currency" "text" DEFAULT 'MWK'::"text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."company_commissions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."company_transactions" (
    "id" "uuid" DEFAULT "public"."uuid_generate_v4"() NOT NULL,
    "transaction_type" "text" NOT NULL,
    "amount" numeric(12,2) NOT NULL,
    "ride_id" "uuid",
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."company_transactions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."customer_segments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "city" "text",
    "min_total_rides" integer,
    "max_total_rides" integer,
    "inactive_days" integer,
    "min_spend" numeric(12,2),
    "ride_frequency" "text",
    "estimated_count" integer DEFAULT 0,
    "is_active" boolean DEFAULT true,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."customer_segments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."demand_event_responses" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "event_id" "uuid" NOT NULL,
    "driver_id" "uuid" NOT NULL,
    "status" "text" DEFAULT 'interested'::"text" NOT NULL,
    "notes" "text",
    "responded_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "demand_event_responses_status_check" CHECK (("status" = ANY (ARRAY['interested'::"text", 'going'::"text", 'arrived'::"text", 'completed'::"text", 'dismissed'::"text"])))
);


ALTER TABLE "public"."demand_event_responses" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."demand_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "title" "text" NOT NULL,
    "description" "text",
    "location_name" "text",
    "city" "text",
    "category" "text" DEFAULT 'event'::"text" NOT NULL,
    "source" "text" DEFAULT 'ADMIN'::"text" NOT NULL,
    "accent_color" "text" DEFAULT '#2563EB'::"text",
    "badge" "text",
    "estimated_rides" integer DEFAULT 0,
    "drivers_needed" integer DEFAULT 0,
    "earning_estimate" "text",
    "time_window" "text",
    "starts_at" timestamp with time zone,
    "ends_at" timestamp with time zone,
    "is_active" boolean DEFAULT true,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "instructions" "text",
    "max_drivers" integer DEFAULT 0,
    "target_driver_ids" "uuid"[]
);


ALTER TABLE "public"."demand_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."dispatch_queue" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "rider_id" "uuid",
    "order_id" "uuid",
    "status" "text" DEFAULT 'pending'::"text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."dispatch_queue" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."dispute_evidence" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "dispute_id" "uuid" NOT NULL,
    "evidence_type" "text" NOT NULL,
    "file_url" "text",
    "description" "text",
    "uploaded_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."dispute_evidence" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."dispute_messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "dispute_id" "uuid" NOT NULL,
    "sender_type" "text" NOT NULL,
    "sender_id" "uuid",
    "message" "text" NOT NULL,
    "is_internal" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."dispute_messages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."dispute_status_history" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "dispute_id" "uuid" NOT NULL,
    "old_status" "text",
    "new_status" "text" NOT NULL,
    "changed_by" "uuid",
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."dispute_status_history" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."driver_achievement_unlocks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "driver_id" "uuid",
    "achievement_id" "uuid",
    "unlocked_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."driver_achievement_unlocks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."driver_achievements" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "title" "text" NOT NULL,
    "description" "text",
    "icon" "text" DEFAULT 'star'::"text" NOT NULL,
    "category" "text" DEFAULT 'milestone'::"text",
    "requirement_type" "text" NOT NULL,
    "requirement_value" integer NOT NULL,
    "badge_color" "text" DEFAULT '#059669'::"text",
    "sort_order" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."driver_achievements" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."driver_applications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "full_name" "text" NOT NULL,
    "phone" "text" NOT NULL,
    "email" "text" NOT NULL,
    "city" "text" NOT NULL,
    "vehicle_type" "text" NOT NULL,
    "vehicle_plate_number" "text" NOT NULL,
    "driver_license_number" "text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."driver_applications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."driver_daily_earnings" (
    "id" "uuid" DEFAULT "public"."uuid_generate_v4"() NOT NULL,
    "driver_id" "uuid",
    "earnings_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "total_rides" integer DEFAULT 0,
    "total_fare" double precision DEFAULT 0,
    "commission" double precision DEFAULT 0,
    "bonuses" double precision DEFAULT 0,
    "net_earnings" double precision DEFAULT 0,
    "cash_collected" double precision DEFAULT 0,
    "online_hours" double precision DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."driver_daily_earnings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."driver_documents" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "driver_id" "uuid" NOT NULL,
    "document_type" "text" NOT NULL,
    "bucket" "text" DEFAULT 'driver-documents'::"text" NOT NULL,
    "file_path" "text" NOT NULL,
    "public_url" "text",
    "status" "text" DEFAULT 'pending_review'::"text" NOT NULL,
    "rejection_reason" "text",
    "uploaded_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "reviewed_at" timestamp with time zone,
    "reviewed_by" "uuid"
);


ALTER TABLE "public"."driver_documents" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."driver_loyalty_accounts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "driver_id" "uuid" NOT NULL,
    "user_id" "uuid",
    "points" integer DEFAULT 0 NOT NULL,
    "lifetime_points" integer DEFAULT 0 NOT NULL,
    "total_rides_completed" integer DEFAULT 0 NOT NULL,
    "total_earnings" numeric(12,2) DEFAULT 0 NOT NULL,
    "acceptance_rate" numeric(5,2) DEFAULT 0,
    "avg_rating" numeric(3,2) DEFAULT 0,
    "current_tier" "text" DEFAULT 'standard'::"text",
    "tier_achieved_at" timestamp with time zone,
    "streak_days" integer DEFAULT 0 NOT NULL,
    "last_ride_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."driver_loyalty_accounts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."driver_messages" (
    "id" "uuid" DEFAULT "public"."uuid_generate_v4"() NOT NULL,
    "driver_id" "uuid",
    "title" "text" NOT NULL,
    "body" "text" NOT NULL,
    "message_type" "text" DEFAULT 'info'::"text",
    "is_read" boolean DEFAULT false,
    "action_url" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."driver_messages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."driver_mission_progress" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "driver_id" "uuid" NOT NULL,
    "mission_id" "uuid" NOT NULL,
    "current_value" integer DEFAULT 0,
    "is_completed" boolean DEFAULT false,
    "completed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."driver_mission_progress" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."driver_missions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "title" "text" NOT NULL,
    "description" "text",
    "mission_type" "text" DEFAULT 'daily'::"text",
    "target_value" integer DEFAULT 1,
    "reward_amount" numeric DEFAULT 0,
    "is_active" boolean DEFAULT true,
    "starts_at" timestamp with time zone DEFAULT "now"(),
    "ends_at" timestamp with time zone DEFAULT ("now"() + '7 days'::interval),
    "created_at" timestamp with time zone DEFAULT "now"(),
    "city" "text",
    "currency" "text" DEFAULT 'MWK'::"text"
);


ALTER TABLE "public"."driver_missions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."driver_payout_methods" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "driver_id" "uuid" NOT NULL,
    "method_type" "text" NOT NULL,
    "account_number" "text",
    "account_name" "text",
    "bank_name" "text",
    "bank_branch" "text",
    "is_default" boolean DEFAULT false,
    "is_verified" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."driver_payout_methods" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."driver_payout_requests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "driver_id" "uuid" NOT NULL,
    "wallet_id" "uuid",
    "payout_method_id" "uuid",
    "batch_id" "uuid",
    "amount" numeric(12,2) NOT NULL,
    "fee" numeric(12,2) DEFAULT 0,
    "net_amount" numeric(12,2) DEFAULT 0,
    "payout_method" "text",
    "account_number" "text",
    "account_name" "text",
    "status" "text" DEFAULT 'pending'::"text",
    "transaction_reference" "text",
    "provider_reference" "text",
    "failure_reason" "text",
    "notes" "text",
    "approved_by" "uuid",
    "approved_at" timestamp with time zone,
    "processed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."driver_payout_requests" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."driver_payouts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "driver_id" "uuid",
    "amount" numeric DEFAULT 0,
    "status" "text" DEFAULT 'pending'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "ride_id" "uuid",
    "gross_fare" numeric(12,2) DEFAULT 0,
    "commission_amount" numeric(12,2) DEFAULT 0,
    "tax_amount" numeric(12,2) DEFAULT 0,
    "net_earning" numeric(12,2) DEFAULT 0,
    "payout_method" "text",
    "payout_status" "text" DEFAULT 'pending'::"text",
    "is_held" boolean DEFAULT false,
    "hold_reason" "text",
    "transaction_reference" "text",
    "processed_at" timestamp with time zone,
    "processed_by" "uuid",
    "notes" "text",
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."driver_payouts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."driver_penalties" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "driver_id" "uuid",
    "ride_id" "uuid",
    "refund_id" "uuid",
    "dispute_id" "uuid",
    "amount" numeric(12,2) DEFAULT 0 NOT NULL,
    "reason" "text",
    "status" "text" DEFAULT 'pending'::"text",
    "applied_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."driver_penalties" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."driver_performance" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "driver_id" "uuid" NOT NULL,
    "acceptance_rate" numeric DEFAULT 100,
    "cancellation_rate" numeric DEFAULT 0,
    "completion_rate" numeric DEFAULT 100,
    "total_rides" integer DEFAULT 0,
    "completed_rides" integer DEFAULT 0,
    "cancelled_rides" integer DEFAULT 0,
    "rating" numeric DEFAULT 5.0,
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."driver_performance" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."driver_referrals" (
    "id" "uuid" DEFAULT "public"."uuid_generate_v4"() NOT NULL,
    "referrer_driver_id" "uuid",
    "referred_driver_id" "uuid",
    "referral_code" "text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text",
    "bonus_amount" double precision DEFAULT 0,
    "bonus_paid_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "referrer_id" "uuid",
    "campaign_id" "uuid",
    "bonus_currency" "text" DEFAULT 'MWK'::"text",
    "fraud_verdict" "text",
    "fraud_checked_at" timestamp with time zone,
    "notes" "text",
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."driver_referrals" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."driver_rewards" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "driver_id" "uuid" NOT NULL,
    "reward_type" "text" DEFAULT 'bonus'::"text" NOT NULL,
    "reward_name" "text" NOT NULL,
    "description" "text",
    "value" numeric(12,2) DEFAULT 0,
    "currency" "text" DEFAULT 'MWK'::"text",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "achieved_at" timestamp with time zone DEFAULT "now"(),
    "paid_at" timestamp with time zone,
    "expires_at" timestamp with time zone,
    "ride_id" "uuid",
    "milestone" "text",
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."driver_rewards" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."driver_safety_contacts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "driver_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "phone" "text" NOT NULL,
    "relationship" "text",
    "is_primary" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."driver_safety_contacts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."driver_settings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "driver_id" "uuid" NOT NULL,
    "notifications_enabled" boolean DEFAULT true,
    "location_enabled" boolean DEFAULT true,
    "dark_mode" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."driver_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."driver_transactions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "driver_id" "uuid",
    "amount" numeric DEFAULT 0 NOT NULL,
    "type" "text" DEFAULT 'wallet'::"text" NOT NULL,
    "status" "text" DEFAULT 'completed'::"text" NOT NULL,
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "transaction_type" "text" DEFAULT 'adjustment'::"text" NOT NULL,
    "balance_before" numeric(12,2),
    "balance_after" numeric(12,2),
    "reference_type" "text",
    "reference_id" "uuid",
    "payout_method" "text",
    "payout_reference" "text"
);


ALTER TABLE "public"."driver_transactions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."driver_wallet_transactions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "wallet_id" "uuid" NOT NULL,
    "driver_id" "uuid",
    "transaction_type" "text" NOT NULL,
    "amount" numeric(12,2) NOT NULL,
    "balance_before" numeric(12,2) DEFAULT 0,
    "balance_after" numeric(12,2) DEFAULT 0,
    "reference_type" "text",
    "reference_id" "uuid",
    "ride_id" "uuid",
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."driver_wallet_transactions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."driver_wallets" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "driver_id" "uuid",
    "balance" numeric(12,2) DEFAULT 0,
    "pending_balance" numeric(12,2) DEFAULT 0,
    "total_earned" numeric(12,2) DEFAULT 0,
    "payout_method" "text",
    "payout_account" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "default_payout_method" "text",
    "payout_account_number" "text",
    "payout_phone_number" "text",
    "payout_provider" "text",
    "currency" "text" DEFAULT 'MWK'::"text",
    "is_payout_enabled" boolean DEFAULT true,
    "last_payout_at" timestamp with time zone,
    "firebase_uid" "text",
    "driver_name" "text",
    "driver_email" "text",
    "tnm_mpamba_number" "text",
    "airtel_money_number" "text",
    "bank_account_number" "text",
    "bank_name" "text",
    "account_holder_name" "text",
    "mobile_money_name" "text",
    "available_balance" numeric(12,2) DEFAULT 0,
    "available_for_withdrawal" numeric(12,2) DEFAULT 0,
    "cash_collected" numeric(12,2) DEFAULT 0,
    "total_withdrawn" numeric(12,2) DEFAULT 0,
    "trips_today" integer DEFAULT 0,
    "earned_today" numeric(12,2) DEFAULT 0,
    "trips_this_week" integer DEFAULT 0,
    "earned_this_week" numeric(12,2) DEFAULT 0,
    "trips_this_month" integer DEFAULT 0,
    "earned_this_month" numeric(12,2) DEFAULT 0,
    "statement_updated_at" timestamp with time zone
);


ALTER TABLE "public"."driver_wallets" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."drivers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "firebase_uid" "text",
    "user_id" "uuid",
    "full_name" "text",
    "email" "text",
    "phone" "text",
    "status" "text" DEFAULT 'pending_review'::"text",
    "driver_license_number" "text",
    "vehicle_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "address" "text",
    "city" "text",
    "country" "text",
    "profile_photo_url" "text",
    "date_of_birth" "date",
    "gender" "text",
    "national_id_number" "text",
    "approval_status" "text" DEFAULT 'pending'::"text",
    "can_go_online" boolean DEFAULT false,
    "is_online" boolean DEFAULT false,
    "is_available" boolean DEFAULT false,
    "online_status" "text" DEFAULT 'offline'::"text",
    "approved_at" timestamp with time zone,
    "approved_by" "uuid",
    "driver_tier" "text" DEFAULT 'standard'::"text",
    "rating" numeric(3,2) DEFAULT 5.0,
    "total_trips" integer DEFAULT 0,
    "total_earnings" numeric(12,2) DEFAULT 0,
    "acceptance_rate" numeric(5,2) DEFAULT 100,
    "cancellation_rate" numeric(5,2) DEFAULT 0,
    "current_city" "text",
    "registered_city" "text",
    "onboarding_completed" boolean DEFAULT false,
    "onboarding_step" integer DEFAULT 0,
    "driver_type" "text" DEFAULT 'weafrica_x'::"text",
    "vehicle_category" "text",
    "service_type" "text" DEFAULT 'ride'::"text",
    "supports_delivery" boolean DEFAULT false,
    "supports_rides" boolean DEFAULT true,
    "supports_schedule" boolean DEFAULT true,
    "emergency_contact_name" "text",
    "emergency_contact_phone" "text",
    "emergency_contact_relationship" "text",
    "next_of_kin_name" "text",
    "next_of_kin_phone" "text",
    "next_of_kin_relationship" "text",
    "license_number" "text",
    "license_expiry_date" "date",
    "license_front_url" "text",
    "license_back_url" "text",
    "license_verified" boolean DEFAULT false,
    "national_id_url" "text",
    "id_verified" boolean DEFAULT false,
    "background_check_status" "text" DEFAULT 'pending'::"text",
    "national_id" "text",
    "national_id_front_url" "text",
    "national_id_back_url" "text",
    "nationality" "text",
    "country_of_issue" "text",
    "id_expiry_date" "date",
    "submitted_at" timestamp with time zone DEFAULT "now"(),
    "reviewed_at" timestamp with time zone,
    "rejected_at" timestamp with time zone,
    "activated_at" timestamp with time zone,
    "last_online_at" timestamp with time zone,
    "vehicle_photo_urls" "text"[] DEFAULT ARRAY[]::"text"[],
    "vehicle_photo_url" "text",
    "vehicle_reg_url" "text",
    "insurance_url" "text",
    "rejection_reason" "text",
    "admin_notes" "text",
    "review_notes" "text",
    "rejected_by" "uuid",
    "rejection_code" "text",
    "id_document_url" "text",
    "insurance_document_url" "text",
    "license_document_url" "text",
    "vehicle_registration_url" "text",
    "plate_number" "text",
    "vehicle_make" "text",
    "vehicle_model" "text",
    "vehicle_year" "text",
    "profile_picture_url" "text",
    "last_location_update" timestamp with time zone,
    "city_id" "uuid",
    "total_rides" integer DEFAULT 0,
    "cash_collected" numeric DEFAULT 0,
    "total_ratings" integer DEFAULT 0,
    "assigned_rides" integer DEFAULT 0,
    "driver_cancelled_rides" integer DEFAULT 0,
    "completion_rate" numeric DEFAULT 100,
    "documents_verified" boolean DEFAULT false,
    "vehicle_verified" boolean DEFAULT false,
    "id_number" "text",
    "is_approved" boolean DEFAULT false,
    "available_balance" numeric(12,2) DEFAULT 0,
    "suspension_reason" "text",
    "current_location" "text",
    "driving_experience_years" integer DEFAULT 0,
    "employment_type" "text" DEFAULT 'full_time'::"text",
    "preferred_vehicle_type" "text",
    "application_step" integer DEFAULT 1,
    "referral_code" "text",
    "referred_by" "uuid",
    "emergency_contact" "jsonb",
    "emergency_name" "text",
    "emergency_phone" "text",
    "police_clearance_url" "text",
    "driver_license_url" "text",
    "operating_area" "text",
    "selfie_url" "text",
    "identity_verified_at" timestamp with time zone,
    "active_device_id" "text",
    "active_device_type" "text",
    "active_device_last_seen_at" timestamp with time zone,
    "last_lat" double precision,
    "last_lng" double precision,
    CONSTRAINT "drivers_approval_status_check" CHECK (("approval_status" = ANY (ARRAY['pending_verification'::"text", 'approved_driver'::"text", 'rejected'::"text", 'pending_vehicle_review'::"text", 'approved'::"text", 'suspended'::"text"])))
);

ALTER TABLE ONLY "public"."drivers" REPLICA IDENTITY FULL;


ALTER TABLE "public"."drivers" OWNER TO "postgres";


COMMENT ON COLUMN "public"."drivers"."can_go_online" IS 'Computed: onboarding_completed AND documents_verified AND vehicle_verified AND is_approved';



COMMENT ON COLUMN "public"."drivers"."onboarding_completed" IS 'True after driver completes all onboarding steps';



COMMENT ON COLUMN "public"."drivers"."documents_verified" IS 'True when all documents are verified by admin';



COMMENT ON COLUMN "public"."drivers"."vehicle_verified" IS 'True when vehicle passes inspection & docs verified';



CREATE TABLE IF NOT EXISTS "public"."emergency_alerts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "ride_id" "uuid",
    "triggered_by" "uuid",
    "alert_type" "text" NOT NULL,
    "latitude" numeric(10,7),
    "longitude" numeric(10,7),
    "status" "text" DEFAULT 'active'::"text",
    "acknowledged_by" "uuid",
    "resolved_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "driver_id" "uuid",
    "rider_id" "uuid",
    "role" "text" DEFAULT 'rider'::"text",
    "priority" "text" DEFAULT 'high'::"text",
    "city" "text",
    "address" "text",
    "description" "text",
    "responded_at" timestamp with time zone,
    "resolved_by" "uuid",
    "notes" "text"
);


ALTER TABLE "public"."emergency_alerts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."emergency_contacts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "phone" "text" NOT NULL,
    "relationship" "text",
    "is_primary" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."emergency_contacts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."emergency_responses" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "alert_id" "uuid" NOT NULL,
    "admin_id" "uuid",
    "action" "text" NOT NULL,
    "notes" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."emergency_responses" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."fare_estimation_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "pickup_lat" double precision,
    "pickup_lng" double precision,
    "dropoff_lat" double precision,
    "dropoff_lng" double precision,
    "category_id" "uuid",
    "resolved_city" "text",
    "resolved_vehicle" "text",
    "base_fare" double precision,
    "per_km" double precision,
    "per_minute" double precision,
    "minimum_fare" double precision,
    "distance_km" double precision,
    "time_minutes" integer,
    "final_fare" double precision,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."fare_estimation_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."fraud_flags" (
    "id" "uuid" DEFAULT "public"."uuid_generate_v4"() NOT NULL,
    "ride_id" "uuid",
    "flag_type" "text" NOT NULL,
    "severity" "text" DEFAULT 'low'::"text",
    "description" "text",
    "detected_by" "text" DEFAULT 'system'::"text",
    "is_resolved" boolean DEFAULT false,
    "resolved_by" "uuid",
    "resolved_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."fraud_flags" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."fraud_protection_rules" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "rule_name" "text" NOT NULL,
    "rule_type" "text" NOT NULL,
    "threshold_value" numeric(12,2) DEFAULT 0,
    "threshold_count" integer DEFAULT 0,
    "action" "text" DEFAULT 'flag'::"text",
    "is_active" boolean DEFAULT true,
    "description" "text",
    "updated_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."fraud_protection_rules" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."incident_assignments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "incident_id" "uuid" NOT NULL,
    "admin_id" "uuid" NOT NULL,
    "assigned_by" "uuid",
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."incident_assignments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."incident_evidence" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "incident_id" "uuid" NOT NULL,
    "evidence_type" "text" NOT NULL,
    "file_url" "text",
    "description" "text",
    "uploaded_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."incident_evidence" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."incident_notes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "incident_id" "uuid",
    "admin_id" "uuid",
    "note" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."incident_notes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."incident_status_history" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "incident_id" "uuid" NOT NULL,
    "old_status" "text",
    "new_status" "text" NOT NULL,
    "changed_by" "uuid",
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."incident_status_history" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."incident_timeline" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "incident_id" "uuid" NOT NULL,
    "event_type" "text" NOT NULL,
    "old_status" "text",
    "new_status" "text",
    "admin_id" "uuid",
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."incident_timeline" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."incidents" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "ride_id" "uuid",
    "type" "text",
    "description" "text",
    "status" "text" DEFAULT 'open'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "lat" double precision,
    "lng" double precision,
    "assigned_to" "uuid",
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."incidents" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."integration_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "integration_id" "uuid",
    "event_type" "text" NOT NULL,
    "status" "text" DEFAULT 'success'::"text",
    "request_payload" "jsonb" DEFAULT '{}'::"jsonb",
    "response_payload" "jsonb" DEFAULT '{}'::"jsonb",
    "error_message" "text",
    "duration_ms" integer,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."integration_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."integrations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "integration_key" "text" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "category" "text" DEFAULT 'other'::"text" NOT NULL,
    "status" "text" DEFAULT 'disconnected'::"text" NOT NULL,
    "environment" "text" DEFAULT 'production'::"text",
    "api_key_hash" "text",
    "webhook_url" "text",
    "webhook_secret_hash" "text",
    "last_sync_at" timestamp with time zone,
    "last_error" "text",
    "success_rate" numeric DEFAULT 100,
    "total_requests" integer DEFAULT 0,
    "failed_requests" integer DEFAULT 0,
    "settings" "jsonb" DEFAULT '{}'::"jsonb",
    "is_enabled" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."integrations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."loyalty_notifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "rider_id" "uuid",
    "driver_id" "uuid",
    "notification_type" "text" NOT NULL,
    "title" "text" NOT NULL,
    "body" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "is_read" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."loyalty_notifications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."loyalty_points_transactions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "rider_id" "uuid" NOT NULL,
    "points" integer NOT NULL,
    "points_before" integer DEFAULT 0 NOT NULL,
    "points_after" integer DEFAULT 0 NOT NULL,
    "transaction_type" "text" NOT NULL,
    "reference_type" "text",
    "reference_id" "uuid",
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."loyalty_points_transactions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."loyalty_tier_config" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tier_name" "text" NOT NULL,
    "tier_display" "text" NOT NULL,
    "min_points" integer DEFAULT 0 NOT NULL,
    "min_rides" integer DEFAULT 0 NOT NULL,
    "points_multiplier" numeric(3,2) DEFAULT 1.0,
    "discount_percent" integer DEFAULT 0,
    "priority_support" boolean DEFAULT false,
    "free_cancellations_per_month" integer DEFAULT 0,
    "birthday_bonus" integer DEFAULT 0,
    "voucher_amount" integer DEFAULT 0,
    "referral_bonus_multiplier" numeric(3,2) DEFAULT 1.0,
    "sort_order" integer DEFAULT 0,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."loyalty_tier_config" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."loyalty_tiers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "min_rides" integer DEFAULT 0,
    "discount_percent" numeric(5,2) DEFAULT 0,
    "priority_support" boolean DEFAULT false,
    "voucher_amount" numeric(12,2) DEFAULT 0,
    "benefits" "jsonb" DEFAULT '{}'::"jsonb",
    "sort_order" integer DEFAULT 0,
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."loyalty_tiers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."marketing_banners" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "title" "text" NOT NULL,
    "subtitle" "text",
    "image_url" "text",
    "target_city" "text",
    "click_action" "text" DEFAULT 'home'::"text",
    "starts_at" timestamp with time zone,
    "ends_at" timestamp with time zone,
    "is_active" boolean DEFAULT true,
    "impressions_count" integer DEFAULT 0,
    "clicks_count" integer DEFAULT 0,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "placement" "text" DEFAULT 'home_carousel'::"text",
    "partner_name" "text",
    "priority" integer DEFAULT 0,
    "accent_color" "text" DEFAULT '#F97316'::"text"
);


ALTER TABLE "public"."marketing_banners" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."marketing_campaigns" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "campaign_type" "text" DEFAULT 're_engagement'::"text" NOT NULL,
    "target_segment" "text",
    "trigger_rule" "text",
    "reward_amount" numeric(12,2) DEFAULT 0,
    "promo_code_id" "uuid",
    "status" "text" DEFAULT 'draft'::"text",
    "starts_at" timestamp with time zone,
    "ends_at" timestamp with time zone,
    "sent_count" integer DEFAULT 0,
    "redeemed_count" integer DEFAULT 0,
    "revenue_generated" numeric(12,2) DEFAULT 0,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."marketing_campaigns" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."marketing_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "event_type" "text" NOT NULL,
    "entity_type" "text",
    "entity_id" "uuid",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."marketing_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."moderation_actions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "case_id" "uuid" NOT NULL,
    "admin_id" "uuid",
    "target_user_id" "uuid",
    "action_type" "text" NOT NULL,
    "action_reason" "text",
    "duration_hours" integer,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."moderation_actions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."moderation_appeals" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "case_id" "uuid",
    "appeal_reason" "text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "reviewed_by" "uuid",
    "review_notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "reviewed_at" timestamp with time zone
);


ALTER TABLE "public"."moderation_appeals" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."moderation_cases" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "case_number" "text" NOT NULL,
    "source_app" "text" DEFAULT 'admin'::"text" NOT NULL,
    "case_type" "text" DEFAULT 'general'::"text" NOT NULL,
    "priority" "text" DEFAULT 'medium'::"text" NOT NULL,
    "status" "text" DEFAULT 'open'::"text" NOT NULL,
    "reporter_id" "uuid",
    "reported_user_id" "uuid",
    "reported_user_role" "text",
    "trip_id" "uuid",
    "city" "text",
    "country" "text",
    "reason" "text" NOT NULL,
    "description" "text",
    "assigned_admin_id" "uuid",
    "resolution" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "resolved_at" timestamp with time zone
);


ALTER TABLE "public"."moderation_cases" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."moderation_evidence" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "case_id" "uuid" NOT NULL,
    "evidence_type" "text" NOT NULL,
    "file_url" "text",
    "message" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."moderation_evidence" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."notification_delivery_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "notification_id" "uuid",
    "user_id" "uuid",
    "role" "text",
    "fcm_token" "text",
    "status" "text" DEFAULT 'pending'::"text",
    "error_message" "text",
    "opened_at" timestamp with time zone,
    "delivered_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."notification_delivery_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."notifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "title" "text",
    "body" "text",
    "type" "text",
    "data" "jsonb" DEFAULT '{}'::"jsonb",
    "is_read" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "read_at" timestamp with time zone
);


ALTER TABLE "public"."notifications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."payment_transactions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "payment_id" "uuid",
    "provider" "text" NOT NULL,
    "provider_reference" "text",
    "provider_status" "text",
    "amount" numeric(12,2) NOT NULL,
    "currency" "text" DEFAULT 'MWK'::"text",
    "error_message" "text",
    "error_code" "text",
    "retry_count" integer DEFAULT 0,
    "max_retries" integer DEFAULT 3,
    "last_retry_at" timestamp with time zone,
    "raw_response" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."payment_transactions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."payments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "ride_id" "uuid",
    "amount" numeric(12,2) NOT NULL,
    "payment_method" "text" NOT NULL,
    "payment_status" "text" DEFAULT 'pending'::"text",
    "transaction_reference" "text",
    "provider_reference" "text",
    "paid_by" "uuid",
    "paid_at" timestamp with time zone,
    "refund_amount" numeric(12,2) DEFAULT 0,
    "refund_reason" "text",
    "refunded_at" timestamp with time zone,
    "refunded_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "user_id" "uuid",
    "user_type" "text",
    "type" "text",
    "status" "text",
    "reference" "text",
    "currency" "text" DEFAULT 'MWK'::"text"
);


ALTER TABLE "public"."payments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."payout_audit_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "payout_request_id" "uuid",
    "batch_id" "uuid",
    "action" "text" NOT NULL,
    "old_status" "text",
    "new_status" "text",
    "changed_by" "uuid",
    "admin_email" "text",
    "notes" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."payout_audit_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."payout_batches" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "batch_number" "text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text",
    "total_amount" numeric(12,2) DEFAULT 0,
    "total_drivers" integer DEFAULT 0,
    "processed_count" integer DEFAULT 0,
    "success_count" integer DEFAULT 0,
    "failed_count" integer DEFAULT 0,
    "payout_method" "text",
    "created_by" "uuid",
    "processed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."payout_batches" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."payout_settings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "setting_key" "text" NOT NULL,
    "setting_value" "text" NOT NULL,
    "description" "text",
    "updated_by" "uuid",
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."payout_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."places" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "address" "text",
    "city" "text" NOT NULL,
    "country" "text" DEFAULT 'Malawi'::"text",
    "latitude" double precision NOT NULL,
    "longitude" double precision NOT NULL,
    "type" "text" DEFAULT 'place'::"text",
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."places" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."platform_escrow" (
    "id" "uuid" DEFAULT "public"."uuid_generate_v4"() NOT NULL,
    "ride_id" "uuid",
    "rider_id" "uuid",
    "amount" numeric(12,2) DEFAULT 0 NOT NULL,
    "booking_fee" numeric(10,2) DEFAULT 0 NOT NULL,
    "fare_amount" numeric(10,2) DEFAULT 0 NOT NULL,
    "payment_method" "text" NOT NULL,
    "payment_reference" "text",
    "payment_provider" "text",
    "provider_reference" "text",
    "escrow_status" "text" DEFAULT 'held'::"text",
    "held_at" timestamp with time zone DEFAULT "now"(),
    "released_at" timestamp with time zone,
    "refunded_at" timestamp with time zone,
    "released_to_driver" numeric(12,2) DEFAULT 0,
    "released_to_company" numeric(12,2) DEFAULT 0,
    "commission_deducted" numeric(10,2) DEFAULT 0,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."platform_escrow" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."platform_feature_flags" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "feature_key" "text" NOT NULL,
    "feature_name" "text" NOT NULL,
    "description" "text",
    "category" "text" DEFAULT 'general'::"text" NOT NULL,
    "is_enabled" boolean DEFAULT true,
    "enabled_for_riders" boolean DEFAULT false,
    "enabled_for_drivers" boolean DEFAULT false,
    "enabled_for_admin" boolean DEFAULT false,
    "rollout_percentage" integer DEFAULT 100,
    "environment" "text" DEFAULT 'production'::"text",
    "city_scope" "text"[],
    "country_scope" "text"[],
    "updated_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."platform_feature_flags" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pricing_config" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "country_code" "text" DEFAULT 'MW'::"text" NOT NULL,
    "city" "text",
    "vehicle_type" "text" DEFAULT 'all'::"text" NOT NULL,
    "base_fare" numeric(10,2) DEFAULT 500.00 NOT NULL,
    "minimum_fare" numeric(10,2) DEFAULT 800.00 NOT NULL,
    "per_km" numeric(10,2) DEFAULT 300.00 NOT NULL,
    "per_min" numeric(10,2) DEFAULT 50.00 NOT NULL,
    "booking_fee" numeric(10,2) DEFAULT 0 NOT NULL,
    "waiting_fee" numeric(10,2) DEFAULT 50.00 NOT NULL,
    "cancellation_fee" numeric(10,2) DEFAULT 500.00 NOT NULL,
    "surge_multiplier" numeric(4,2) DEFAULT 1.00 NOT NULL,
    "commission_percent" numeric(5,2) DEFAULT 20.00 NOT NULL,
    "currency" "text" DEFAULT 'MWK'::"text",
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "max_fare_cap" numeric(12,2) DEFAULT NULL::numeric,
    "free_waiting_minutes" integer DEFAULT 5,
    "night_multiplier" numeric(4,2) DEFAULT 1.20,
    "night_start_time" time without time zone DEFAULT '22:00:00'::time without time zone,
    "night_end_time" time without time zone DEFAULT '05:00:00'::time without time zone,
    "tax_enabled" boolean DEFAULT false,
    "tax_percent" numeric(5,2) DEFAULT 17.50,
    "tax_name" "text" DEFAULT 'VAT'::"text"
);


ALTER TABLE "public"."pricing_config" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pricing_driver_incentives" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "country_code" "text" DEFAULT 'MW'::"text" NOT NULL,
    "city" "text",
    "incentive_type" "text" DEFAULT 'trip_bonus'::"text" NOT NULL,
    "incentive_label" "text" NOT NULL,
    "description" "text",
    "required_trips" integer DEFAULT 0 NOT NULL,
    "time_window_hours" integer DEFAULT 24,
    "reward_amount" numeric(12,2) DEFAULT 0 NOT NULL,
    "reward_type" "text" DEFAULT 'bonus'::"text",
    "fare_multiplier" numeric(4,2) DEFAULT 1.00,
    "is_active" boolean DEFAULT true,
    "starts_at" timestamp with time zone,
    "ends_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."pricing_driver_incentives" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pricing_surge_rules" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "country_code" "text" DEFAULT 'MW'::"text" NOT NULL,
    "city" "text",
    "surge_type" "text" NOT NULL,
    "surge_label" "text" NOT NULL,
    "multiplier" numeric(4,2) DEFAULT 1.00 NOT NULL,
    "is_active" boolean DEFAULT true,
    "start_time" time without time zone,
    "end_time" time without time zone,
    "days_of_week" integer[] DEFAULT '{1,2,3,4,5}'::integer[],
    "priority" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."pricing_surge_rules" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."promo_codes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "code" "text" NOT NULL,
    "type" "text" DEFAULT 'percentage'::"text",
    "value" numeric DEFAULT 0 NOT NULL,
    "min_order" numeric DEFAULT 0,
    "max_uses" integer,
    "current_uses" integer DEFAULT 0,
    "recipient_type" "text" DEFAULT 'all'::"text",
    "status" "text" DEFAULT 'active'::"text",
    "expires_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "title" "text",
    "description" "text",
    "max_discount" numeric DEFAULT 0,
    "per_user_limit" integer DEFAULT 1,
    "applies_to" "text" DEFAULT 'all'::"text",
    "city" "text",
    "starts_at" timestamp with time zone,
    "first_ride_only" boolean DEFAULT false,
    "visible" boolean DEFAULT true,
    "applicable_cities" "text"[] DEFAULT '{}'::"text"[],
    "applicable_vehicle_types" "text"[] DEFAULT '{}'::"text"[],
    "metadata" "jsonb" DEFAULT '{}'::"jsonb"
);


ALTER TABLE "public"."promo_codes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."promo_redemptions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "promo_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "ride_id" "uuid",
    "discount_amount" numeric DEFAULT 0 NOT NULL,
    "redeemed_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."promo_redemptions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."promotions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "title" "text" NOT NULL,
    "description" "text",
    "image_url" "text",
    "promo_code" "text",
    "discount_type" "text" DEFAULT 'percentage'::"text",
    "discount_value" numeric(12,2) DEFAULT 0,
    "start_date" timestamp with time zone,
    "end_date" timestamp with time zone,
    "target_audience" "text" DEFAULT 'all'::"text",
    "target_city" "text",
    "category" "text" DEFAULT 'for_you'::"text",
    "placement" "text" DEFAULT 'home_carousel'::"text" NOT NULL,
    "partner_name" "text",
    "action_text" "text" DEFAULT 'Learn More'::"text",
    "action_url" "text",
    "accent_color" "text" DEFAULT '#F97316'::"text",
    "priority" integer DEFAULT 0,
    "is_active" boolean DEFAULT true,
    "impressions_count" integer DEFAULT 0,
    "clicks_count" integer DEFAULT 0,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "promotions_placement_check" CHECK (("placement" = ANY (ARRAY['home_carousel'::"text", 'booking_screen'::"text", 'searching_driver'::"text", 'ride_completed'::"text", 'offers_page'::"text", 'map_banner'::"text", 'notifications_inbox'::"text"])))
);


ALTER TABLE "public"."promotions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."push_notifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "title" "text" NOT NULL,
    "body" "text" NOT NULL,
    "notification_type" "text" DEFAULT 'general'::"text" NOT NULL,
    "recipient_group" "text" DEFAULT 'all'::"text" NOT NULL,
    "target_country" "text",
    "target_city" "text",
    "target_area" "text",
    "image_url" "text",
    "deep_link" "text",
    "priority" "text" DEFAULT 'normal'::"text",
    "status" "text" DEFAULT 'pending'::"text",
    "scheduled_at" timestamp with time zone,
    "sent_at" timestamp with time zone,
    "delivered_count" integer DEFAULT 0,
    "failed_count" integer DEFAULT 0,
    "opened_count" integer DEFAULT 0,
    "target_count" integer DEFAULT 0,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."push_notifications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ratings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "ride_id" "uuid" NOT NULL,
    "driver_id" "uuid",
    "rider_id" "uuid",
    "rating" integer NOT NULL,
    "comment" "text",
    "rated_by" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "ratings_rated_by_check" CHECK (("rated_by" = ANY (ARRAY['rider'::"text", 'driver'::"text"]))),
    CONSTRAINT "ratings_rating_check" CHECK ((("rating" >= 1) AND ("rating" <= 5)))
);


ALTER TABLE "public"."ratings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."referral_campaigns" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "campaign_type" "text" DEFAULT 'driver'::"text" NOT NULL,
    "starts_at" timestamp with time zone NOT NULL,
    "ends_at" timestamp with time zone NOT NULL,
    "driver_bonus_amount" numeric(12,2) DEFAULT 0,
    "driver_bonus_currency" "text" DEFAULT 'MWK'::"text",
    "rider_credit_amount" numeric(12,2) DEFAULT 0,
    "rider_credit_currency" "text" DEFAULT 'MWK'::"text",
    "conditions" "jsonb" DEFAULT '{}'::"jsonb",
    "target_city" "text",
    "target_vehicle_type" "text",
    "is_active" boolean DEFAULT true,
    "max_referrals_per_user" integer,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."referral_campaigns" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."referral_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "referral_id" "uuid",
    "referral_type" "text",
    "event_type" "text" NOT NULL,
    "old_status" "text",
    "new_status" "text",
    "actor_id" "uuid",
    "actor_type" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."referral_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."referral_fraud_checks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "referral_id" "uuid" NOT NULL,
    "referral_type" "text" NOT NULL,
    "check_type" "text" NOT NULL,
    "result" "text" NOT NULL,
    "details" "jsonb" DEFAULT '{}'::"jsonb",
    "checked_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."referral_fraud_checks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."referral_rewards" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "referral_id" "uuid" NOT NULL,
    "referral_type" "text" NOT NULL,
    "recipient_id" "uuid" NOT NULL,
    "recipient_type" "text" NOT NULL,
    "amount" numeric(12,2) NOT NULL,
    "currency" "text" DEFAULT 'MWK'::"text",
    "reward_type" "text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text",
    "approved_by" "uuid",
    "approved_at" timestamp with time zone,
    "paid_at" timestamp with time zone,
    "transaction_reference" "text",
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."referral_rewards" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."referral_settings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "setting_key" "text" NOT NULL,
    "setting_value" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "description" "text",
    "updated_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."referral_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."refund_actions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "refund_id" "uuid",
    "action_type" "text" NOT NULL,
    "decision" "text",
    "partial_amount" numeric(12,2) DEFAULT 0,
    "penalty_amount" numeric(12,2) DEFAULT 0,
    "penalty_target" "text",
    "hold_driver_payout" boolean DEFAULT false,
    "admin_notes" "text",
    "processed_by" "uuid",
    "processed_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."refund_actions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."refund_audit_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "refund_id" "uuid",
    "action" "text" NOT NULL,
    "old_status" "text",
    "new_status" "text",
    "changed_by" "uuid",
    "admin_email" "text",
    "notes" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."refund_audit_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."refunds" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "ride_id" "uuid",
    "payment_id" "uuid",
    "rider_id" "uuid",
    "driver_id" "uuid",
    "amount" numeric(12,2) DEFAULT 0 NOT NULL,
    "reason" "text",
    "status" "text" DEFAULT 'pending'::"text",
    "payment_method" "text",
    "transaction_reference" "text",
    "failure_reason" "text",
    "admin_notes" "text",
    "processed_by" "uuid",
    "processed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "decision" "text",
    "partial_amount" numeric(12,2) DEFAULT 0,
    "penalty_amount" numeric(12,2) DEFAULT 0,
    "penalty_target" "text",
    "hold_payout" boolean DEFAULT false,
    "rider_complaint" "text",
    "driver_response" "text",
    "evidence_urls" "text"[],
    "chat_history" "jsonb",
    "cancellation_reason" "text",
    "city" "text"
);


ALTER TABLE "public"."refunds" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."reward_definitions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "reward_type" "text" DEFAULT 'voucher'::"text" NOT NULL,
    "value" numeric(12,2) DEFAULT 0,
    "points_cost" integer DEFAULT 0,
    "min_tier" "text",
    "min_rides" integer DEFAULT 0,
    "max_redemptions" integer DEFAULT 9999,
    "current_redemptions" integer DEFAULT 0 NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "is_featured" boolean DEFAULT false NOT NULL,
    "is_achievement" boolean DEFAULT false NOT NULL,
    "achievement_trigger" "text",
    "icon" "text",
    "accent_color" "text" DEFAULT '#F97316'::"text",
    "sort_order" integer DEFAULT 0,
    "starts_at" timestamp with time zone,
    "expires_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."reward_definitions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ride_categories" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "description" "text",
    "is_active" boolean DEFAULT true,
    "sort_order" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "icon" "text"
);


ALTER TABLE "public"."ride_categories" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ride_disputes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "dispute_number" "text" NOT NULL,
    "ride_id" "uuid",
    "opened_by" "text" DEFAULT 'rider'::"text" NOT NULL,
    "dispute_type" "text" DEFAULT 'fare'::"text" NOT NULL,
    "priority" "text" DEFAULT 'medium'::"text" NOT NULL,
    "status" "text" DEFAULT 'open'::"text" NOT NULL,
    "rider_id" "uuid",
    "driver_id" "uuid",
    "city" "text",
    "description" "text" NOT NULL,
    "ride_fare" numeric(12,2) DEFAULT 0,
    "ride_payment_method" "text",
    "refund_amount" numeric(12,2) DEFAULT 0,
    "penalty_amount" numeric(12,2) DEFAULT 0,
    "resolution" "text",
    "resolved_by" "uuid",
    "assigned_admin_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "resolved_at" timestamp with time zone
);


ALTER TABLE "public"."ride_disputes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ride_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "ride_id" "uuid" NOT NULL,
    "event_type" "text" NOT NULL,
    "latitude" numeric(10,7),
    "longitude" numeric(10,7),
    "description" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "recorded_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "actor_id" "uuid"
);


ALTER TABLE "public"."ride_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ride_invoices" (
    "id" "uuid" DEFAULT "public"."uuid_generate_v4"() NOT NULL,
    "ride_id" "uuid",
    "invoice_number" "text" NOT NULL,
    "rider_id" "uuid",
    "rider_name" "text",
    "rider_phone" "text",
    "driver_id" "uuid",
    "driver_name" "text",
    "pickup_address" "text",
    "dropoff_address" "text",
    "distance_km" numeric(8,2),
    "duration_min" integer,
    "ride_fare" numeric(10,2) DEFAULT 0 NOT NULL,
    "booking_fee" numeric(10,2) DEFAULT 0 NOT NULL,
    "total_amount" numeric(10,2) DEFAULT 0 NOT NULL,
    "payment_method" "text",
    "payment_status" "text" DEFAULT 'paid'::"text",
    "invoice_status" "text" DEFAULT 'generated'::"text",
    "generated_at" timestamp with time zone DEFAULT "now"(),
    "sent_email" boolean DEFAULT false,
    "downloaded_by_rider" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."ride_invoices" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ride_location_points" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "ride_id" "uuid" NOT NULL,
    "latitude" numeric(10,7) NOT NULL,
    "longitude" numeric(10,7) NOT NULL,
    "speed_kmh" numeric(6,2) DEFAULT 0,
    "heading" numeric(5,2) DEFAULT 0,
    "altitude" numeric(8,2) DEFAULT 0,
    "accuracy" numeric(5,2) DEFAULT 0,
    "event_type" "text" DEFAULT 'location'::"text",
    "recorded_at" timestamp with time zone NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."ride_location_points" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ride_messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "ride_id" "uuid" NOT NULL,
    "sender_id" "uuid" NOT NULL,
    "sender_type" "text" NOT NULL,
    "message" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "is_read" boolean DEFAULT false,
    "message_type" "text" DEFAULT 'text'::"text",
    "flagged" boolean DEFAULT false,
    CONSTRAINT "ride_messages_sender_type_check" CHECK (("sender_type" = ANY (ARRAY['driver'::"text", 'rider'::"text"])))
);


ALTER TABLE "public"."ride_messages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ride_requests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "rider_id" "uuid",
    "driver_id" "uuid",
    "pickup_address" "text",
    "pickup_lat" double precision,
    "pickup_lng" double precision,
    "destination_address" "text",
    "destination_lat" double precision,
    "destination_lng" double precision,
    "status" "text" DEFAULT 'requested'::"text" NOT NULL,
    "vehicle_class" "text" DEFAULT 'weafrica_x'::"text",
    "estimated_fare" numeric(12,2) DEFAULT 0,
    "payment_method" "text" DEFAULT 'cash'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "country_id" "uuid",
    "city_id" "uuid",
    "zone_id" "uuid",
    "ride_id" "uuid",
    "expires_at" timestamp with time zone DEFAULT ("now"() + '00:00:20'::interval),
    "responded_at" timestamp with time zone
);

ALTER TABLE ONLY "public"."ride_requests" REPLICA IDENTITY FULL;


ALTER TABLE "public"."ride_requests" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ride_safety_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "ride_id" "uuid" NOT NULL,
    "event_type" "text" NOT NULL,
    "latitude" numeric(10,7),
    "longitude" numeric(10,7),
    "severity" "text" DEFAULT 'low'::"text",
    "speed_at_event" numeric(6,2),
    "duration_seconds" integer,
    "description" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "recorded_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."ride_safety_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."rider_ratings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "ride_id" "uuid",
    "rider_id" "uuid" NOT NULL,
    "driver_id" "uuid",
    "rating" integer NOT NULL,
    "reason" "text",
    "comment" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "rider_ratings_rating_check" CHECK ((("rating" >= 1) AND ("rating" <= 5)))
);


ALTER TABLE "public"."rider_ratings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."rider_referrals" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "referrer_id" "uuid" NOT NULL,
    "referred_rider_id" "uuid",
    "referral_code" "text" NOT NULL,
    "campaign_id" "uuid",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "credit_amount" numeric(12,2) DEFAULT 0,
    "credit_currency" "text" DEFAULT 'MWK'::"text",
    "credit_issued_at" timestamp with time zone,
    "first_ride_completed_at" timestamp with time zone,
    "fraud_verdict" "text",
    "fraud_checked_at" timestamp with time zone,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."rider_referrals" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."rider_rewards" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "rider_id" "uuid" NOT NULL,
    "reward_definition_id" "uuid",
    "reward_type" "text" DEFAULT 'voucher'::"text" NOT NULL,
    "reward_name" "text" NOT NULL,
    "description" "text",
    "value" numeric(12,2) DEFAULT 0,
    "points_spent" integer DEFAULT 0,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "redeemed_at" timestamp with time zone DEFAULT "now"(),
    "used_at" timestamp with time zone,
    "expires_at" timestamp with time zone,
    "used_on_ride_id" "uuid",
    "promo_code" "text",
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."rider_rewards" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."rider_settings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "rider_id" "uuid",
    "dark_mode" boolean DEFAULT false,
    "notifications_enabled" boolean DEFAULT true,
    "language" "text" DEFAULT 'en'::"text",
    "distance_unit" "text" DEFAULT 'km'::"text",
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."rider_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."riders" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "home_address" "text",
    "work_address" "text",
    "saved_places" "jsonb" DEFAULT '[]'::"jsonb",
    "emergency_contacts" "jsonb" DEFAULT '[]'::"jsonb",
    "referral_code" "text",
    "total_rides" integer DEFAULT 0,
    "total_spent" numeric(12,2) DEFAULT 0,
    "rating" numeric(3,2) DEFAULT 5.00,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "firebase_uid" "text"
);


ALTER TABLE "public"."riders" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."role_permissions" (
    "role_id" "uuid" NOT NULL,
    "permission_id" "uuid" NOT NULL
);


ALTER TABLE "public"."role_permissions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."safety_incidents" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "incident_type" "text" DEFAULT 'safety'::"text" NOT NULL,
    "severity" "text" DEFAULT 'medium'::"text" NOT NULL,
    "status" "text" DEFAULT 'open'::"text" NOT NULL,
    "ride_id" "uuid",
    "rider_id" "uuid",
    "driver_id" "uuid",
    "city" "text",
    "assigned_admin_id" "uuid",
    "description" "text",
    "resolution" "text",
    "resolved_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."safety_incidents" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."service_zone_audit_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "zone_id" "uuid",
    "action" "text" NOT NULL,
    "admin_id" "uuid",
    "admin_email" "text",
    "before_data" "jsonb",
    "after_data" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."service_zone_audit_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."service_zones" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "city_id" "uuid",
    "name" "text" NOT NULL,
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "zone_type" "text" DEFAULT 'operating'::"text",
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "drivers" integer DEFAULT 0,
    "rides_24h" integer DEFAULT 0,
    "description" "text",
    "center_latitude" double precision,
    "center_longitude" double precision,
    "base_fare" numeric DEFAULT 1200,
    "per_km" numeric DEFAULT 650,
    "per_minute" numeric DEFAULT 80,
    "minimum_fare" numeric DEFAULT 1800,
    "airport_pickup_fee" numeric DEFAULT 0,
    "airport_dropoff_fee" numeric DEFAULT 0,
    "airport_queue_enabled" boolean DEFAULT false,
    "airport_queue_capacity" integer DEFAULT 50,
    "surge_enabled" boolean DEFAULT false,
    "surge_manual_active" boolean DEFAULT false,
    "surge_multiplier" numeric DEFAULT 1,
    "surge_starts_at" timestamp with time zone,
    "surge_ends_at" timestamp with time zone,
    "auto_surge_enabled" boolean DEFAULT false,
    "auto_surge_min_demand" integer DEFAULT 25,
    "auto_surge_shortage_ratio" numeric DEFAULT 1.5,
    "auto_surge_multiplier" numeric DEFAULT 1.25,
    "no_pickup" boolean DEFAULT false,
    "no_dropoff" boolean DEFAULT false,
    "no_entry" boolean DEFAULT false,
    "restriction_reason" "text",
    "polygon_coordinates" "jsonb" DEFAULT '[]'::"jsonb",
    "status" "text" DEFAULT 'active'::"text",
    "center_lat" double precision,
    "center_lng" double precision,
    "boundary_coordinates" "jsonb" DEFAULT '[]'::"jsonb",
    "pricing_rules" "jsonb" DEFAULT '{}'::"jsonb",
    "airport_fees" "jsonb" DEFAULT '{}'::"jsonb",
    "surge_settings" "jsonb" DEFAULT '{}'::"jsonb",
    "restricted_rules" "jsonb" DEFAULT '{}'::"jsonb",
    "auto_surge_rules" "jsonb" DEFAULT '{}'::"jsonb",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "city" "text" DEFAULT 'Lilongwe'::"text",
    "created_by" "uuid",
    "updated_by" "uuid"
);


ALTER TABLE "public"."service_zones" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."staff_invitations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "email" "text" NOT NULL,
    "full_name" "text" NOT NULL,
    "admin_role_id" "uuid",
    "country_id" "uuid",
    "city_id" "uuid",
    "invite_token" "text" DEFAULT ("gen_random_uuid"())::"text" NOT NULL,
    "invited_by" "uuid",
    "status" "text" DEFAULT 'pending'::"text",
    "accepted_by" "uuid",
    "accepted_at" timestamp with time zone,
    "expires_at" timestamp with time zone DEFAULT ("now"() + '7 days'::interval),
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."staff_invitations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."support_chat_messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "chat_id" "uuid",
    "sender_type" "text" NOT NULL,
    "message" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."support_chat_messages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."support_chats" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "visitor_name" "text" NOT NULL,
    "visitor_phone" "text",
    "visitor_email" "text",
    "status" "text" DEFAULT 'open'::"text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."support_chats" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."support_tickets" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "user_name" "text",
    "category" "text" DEFAULT 'other'::"text",
    "priority" "text" DEFAULT 'medium'::"text",
    "status" "text" DEFAULT 'open'::"text",
    "subject" "text" NOT NULL,
    "description" "text",
    "assigned_to" "uuid",
    "city" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."support_tickets" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."tax_configs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tax_name" "text" NOT NULL,
    "tax_percent" numeric(5,2) DEFAULT 0 NOT NULL,
    "tax_type" "text" DEFAULT 'percentage'::"text",
    "fixed_amount" numeric(12,2) DEFAULT 0,
    "applies_to" "text" DEFAULT 'driver'::"text",
    "is_active" boolean DEFAULT true,
    "description" "text",
    "updated_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."tax_configs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."tax_records" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "ride_id" "uuid",
    "driver_id" "uuid",
    "tax_type" "text" DEFAULT 'vat'::"text",
    "tax_amount" numeric(12,2) DEFAULT 0 NOT NULL,
    "tax_percent" numeric(5,2) DEFAULT 16.5,
    "tax_base_amount" numeric(12,2) DEFAULT 0,
    "currency" "text" DEFAULT 'MWK'::"text",
    "reporting_period" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."tax_records" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."trip_earnings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "ride_id" "uuid" NOT NULL,
    "driver_id" "uuid",
    "gross_fare" numeric(12,2) DEFAULT 0 NOT NULL,
    "commission_amount" numeric(12,2) DEFAULT 0,
    "commission_percent" numeric(5,2) DEFAULT 20,
    "tax_amount" numeric(12,2) DEFAULT 0,
    "tax_percent" numeric(5,2) DEFAULT 0,
    "net_earning" numeric(12,2) DEFAULT 0,
    "is_paid_to_wallet" boolean DEFAULT false,
    "paid_to_wallet_at" timestamp with time zone,
    "currency" "text" DEFAULT 'MWK'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "commission_rate" numeric(5,2) DEFAULT 15
);


ALTER TABLE "public"."trip_earnings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_notification_tokens" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role" "text" DEFAULT 'rider'::"text" NOT NULL,
    "fcm_token" "text" NOT NULL,
    "device_type" "text" DEFAULT 'android'::"text",
    "is_active" boolean DEFAULT true,
    "last_seen_at" timestamp with time zone DEFAULT "now"(),
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."user_notification_tokens" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_risk_scores" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role" "text" DEFAULT 'rider'::"text" NOT NULL,
    "risk_score" integer DEFAULT 0,
    "fraud_flags" "jsonb" DEFAULT '{}'::"jsonb",
    "safety_flags" "jsonb" DEFAULT '{}'::"jsonb",
    "last_calculated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."user_risk_scores" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_roles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."user_roles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_suspensions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role" "text" NOT NULL,
    "suspension_type" "text" NOT NULL,
    "reason" "text" NOT NULL,
    "starts_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "ends_at" timestamp with time zone,
    "is_active" boolean DEFAULT true,
    "lifted_by" "uuid",
    "lifted_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."user_suspensions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."users" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "firebase_uid" "text",
    "email" "text",
    "phone" "text",
    "full_name" "text",
    "role" "text" DEFAULT 'driver'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "avatar_url" "text",
    "first_name" "text",
    "last_name" "text",
    "is_verified" boolean DEFAULT false,
    "profile_completed" boolean DEFAULT false,
    "is_active" boolean DEFAULT true,
    "rating" numeric DEFAULT 5.0,
    "total_ratings" integer DEFAULT 0,
    "total_rides" integer DEFAULT 0,
    "rider_cancelled_rides" integer DEFAULT 0,
    "cancellation_rate" numeric DEFAULT 0,
    "country_id" "uuid",
    "city_id" "uuid",
    "zone_id" "uuid",
    "role_id" "uuid",
    "is_suspended" boolean DEFAULT false,
    "email_verified" boolean DEFAULT false
);


ALTER TABLE "public"."users" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."vehicle_maintenance_records" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "vehicle_id" "uuid",
    "title" "text" NOT NULL,
    "description" "text",
    "cost" numeric DEFAULT 0,
    "service_date" timestamp with time zone DEFAULT "now"(),
    "next_service_date" timestamp with time zone,
    "mileage" numeric,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."vehicle_maintenance_records" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."vehicles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "driver_id" "uuid",
    "make" "text",
    "model" "text",
    "year" integer,
    "color" "text",
    "plate_number" "text",
    "vehicle_type" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "vehicle_photo_urls" "text"[],
    "vehicle_photo_url" "text",
    "insurance_document_url" "text",
    "registration_document_url" "text",
    "inspection_document_url" "text",
    "vehicle_verified" boolean DEFAULT false,
    "documents_verified" boolean DEFAULT false,
    "is_active" boolean DEFAULT true,
    "driver_firebase_uid" "text",
    "firebase_uid" "text",
    "vehicle_registration_url" "text",
    "approval_status" "text" DEFAULT 'pending_vehicle_review'::"text",
    "status" "text" DEFAULT 'pending_review'::"text",
    "vehicle_category" "text",
    "colour" "text",
    "insurance_doc_url" "text",
    "registration_doc_url" "text",
    "photo_front_url" "text",
    "photo_back_url" "text",
    "photo_left_url" "text",
    "photo_right_url" "text",
    "photo_interior_url" "text",
    "photo_side_url" "text",
    "registration_verified" boolean DEFAULT false,
    "insurance_verified" boolean DEFAULT false,
    "road_tax_verified" boolean DEFAULT false,
    "vehicle_photos_verified" boolean DEFAULT false,
    "inspection_status" "text" DEFAULT 'pending'::"text",
    "inspection_date" timestamp with time zone,
    "insurance_expiry" timestamp with time zone
);


ALTER TABLE "public"."vehicles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."wallet_transactions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "wallet_id" "uuid",
    "transaction_type" "text" NOT NULL,
    "amount" numeric(12,2) NOT NULL,
    "balance_before" numeric(12,2) NOT NULL,
    "balance_after" numeric(12,2) NOT NULL,
    "reference_type" "text",
    "reference_id" "uuid",
    "description" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "payment_method" "text",
    "status" "text" DEFAULT 'completed'::"text",
    "transaction_reference" "text"
);


ALTER TABLE "public"."wallet_transactions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."weafrica_places" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "category" "text" DEFAULT 'general'::"text",
    "latitude" double precision NOT NULL,
    "longitude" double precision NOT NULL,
    "address" "text",
    "city" "text",
    "country" "text" DEFAULT 'Malawi'::"text",
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "city_id" "uuid",
    "zone_id" "uuid",
    "country_id" "uuid",
    "landmark_description" "text",
    "is_pickup_point" boolean DEFAULT true,
    "is_dropoff_point" boolean DEFAULT true,
    "popularity_score" integer DEFAULT 0,
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."weafrica_places" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."webhook_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "integration_id" "uuid",
    "event_type" "text" NOT NULL,
    "payload" "jsonb" DEFAULT '{}'::"jsonb",
    "signature_verified" boolean DEFAULT false,
    "status" "text" DEFAULT 'received'::"text",
    "error_message" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."webhook_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."whatsapp_conversations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "phone" "text" NOT NULL,
    "state" "text" DEFAULT 'welcome'::"text" NOT NULL,
    "context" "jsonb" DEFAULT '{}'::"jsonb",
    "last_interaction" timestamp with time zone DEFAULT "now"(),
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "whatsapp_conversations_state_check" CHECK (("state" = ANY (ARRAY['welcome'::"text", 'awaiting_pickup'::"text", 'awaiting_destination'::"text", 'awaiting_vehicle_choice'::"text", 'awaiting_confirmation'::"text"])))
);


ALTER TABLE "public"."whatsapp_conversations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."whatsapp_ride_requests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "customer_phone" "text" NOT NULL,
    "customer_name" "text",
    "pickup_lat" double precision,
    "pickup_lng" double precision,
    "pickup_address" "text",
    "destination_address" "text",
    "destination_lat" double precision,
    "destination_lng" double precision,
    "vehicle_type" "text" DEFAULT 'weafrica_x'::"text",
    "fare" numeric(10,2),
    "status" "text" DEFAULT 'new'::"text",
    "linked_ride_id" "uuid",
    "driver_id" "uuid",
    "meta_message_id" "text",
    "meta_contact_id" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "whatsapp_ride_requests_status_check" CHECK (("status" = ANY (ARRAY['new'::"text", 'awaiting_pickup'::"text", 'awaiting_destination'::"text", 'awaiting_vehicle_choice'::"text", 'awaiting_confirmation'::"text", 'searching_driver'::"text", 'driver_assigned'::"text", 'driver_en_route'::"text", 'trip_started'::"text", 'completed'::"text", 'cancelled'::"text", 'no_driver_found'::"text"])))
);


ALTER TABLE "public"."whatsapp_ride_requests" OWNER TO "postgres";


ALTER TABLE ONLY "public"."admin_audit_logs"
    ADD CONSTRAINT "admin_audit_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."admin_payout_actions"
    ADD CONSTRAINT "admin_payout_actions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."admin_permissions"
    ADD CONSTRAINT "admin_permissions_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."admin_permissions"
    ADD CONSTRAINT "admin_permissions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."admin_roles"
    ADD CONSTRAINT "admin_roles_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."admin_roles"
    ADD CONSTRAINT "admin_roles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."admin_settings_audit_logs"
    ADD CONSTRAINT "admin_settings_audit_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."admin_users"
    ADD CONSTRAINT "admin_users_email_key" UNIQUE ("email");



ALTER TABLE ONLY "public"."admin_users"
    ADD CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."airport_zone_queue"
    ADD CONSTRAINT "airport_zone_queue_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."airport_zone_queue"
    ADD CONSTRAINT "airport_zone_queue_zone_id_driver_id_status_key" UNIQUE ("zone_id", "driver_id", "status") DEFERRABLE;



ALTER TABLE ONLY "public"."app_settings"
    ADD CONSTRAINT "app_settings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."app_settings"
    ADD CONSTRAINT "app_settings_setting_key_key" UNIQUE ("setting_key");



ALTER TABLE ONLY "public"."audit_logs"
    ADD CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cities"
    ADD CONSTRAINT "cities_country_id_name_key" UNIQUE ("country_id", "name");



ALTER TABLE ONLY "public"."cities"
    ADD CONSTRAINT "cities_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."commission_configs"
    ADD CONSTRAINT "commission_configs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."commission_configs"
    ADD CONSTRAINT "commission_configs_vehicle_class_key" UNIQUE ("vehicle_class");



ALTER TABLE ONLY "public"."commission_rules"
    ADD CONSTRAINT "commission_rules_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."company_commissions"
    ADD CONSTRAINT "company_commissions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."company_transactions"
    ADD CONSTRAINT "company_transactions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."countries"
    ADD CONSTRAINT "countries_code_key" UNIQUE ("code");



ALTER TABLE ONLY "public"."countries"
    ADD CONSTRAINT "countries_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."countries"
    ADD CONSTRAINT "countries_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."customer_segments"
    ADD CONSTRAINT "customer_segments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."demand_event_responses"
    ADD CONSTRAINT "demand_event_responses_event_id_driver_id_key" UNIQUE ("event_id", "driver_id");



ALTER TABLE ONLY "public"."demand_event_responses"
    ADD CONSTRAINT "demand_event_responses_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."demand_events"
    ADD CONSTRAINT "demand_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."dispatch_queue"
    ADD CONSTRAINT "dispatch_queue_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."dispute_evidence"
    ADD CONSTRAINT "dispute_evidence_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."dispute_messages"
    ADD CONSTRAINT "dispute_messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."dispute_status_history"
    ADD CONSTRAINT "dispute_status_history_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."driver_achievement_unlocks"
    ADD CONSTRAINT "driver_achievement_unlocks_driver_id_achievement_id_key" UNIQUE ("driver_id", "achievement_id");



ALTER TABLE ONLY "public"."driver_achievement_unlocks"
    ADD CONSTRAINT "driver_achievement_unlocks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."driver_achievements"
    ADD CONSTRAINT "driver_achievements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."driver_applications"
    ADD CONSTRAINT "driver_applications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."driver_daily_earnings"
    ADD CONSTRAINT "driver_daily_earnings_driver_id_earnings_date_key" UNIQUE ("driver_id", "earnings_date");



ALTER TABLE ONLY "public"."driver_daily_earnings"
    ADD CONSTRAINT "driver_daily_earnings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."driver_documents"
    ADD CONSTRAINT "driver_documents_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."driver_locations"
    ADD CONSTRAINT "driver_locations_driver_id_key" UNIQUE ("driver_id");



ALTER TABLE ONLY "public"."driver_locations"
    ADD CONSTRAINT "driver_locations_driver_id_unique" UNIQUE ("driver_id");



ALTER TABLE ONLY "public"."driver_locations"
    ADD CONSTRAINT "driver_locations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."driver_loyalty_accounts"
    ADD CONSTRAINT "driver_loyalty_accounts_driver_id_key" UNIQUE ("driver_id");



ALTER TABLE ONLY "public"."driver_loyalty_accounts"
    ADD CONSTRAINT "driver_loyalty_accounts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."driver_messages"
    ADD CONSTRAINT "driver_messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."driver_mission_progress"
    ADD CONSTRAINT "driver_mission_progress_driver_id_mission_id_key" UNIQUE ("driver_id", "mission_id");



ALTER TABLE ONLY "public"."driver_mission_progress"
    ADD CONSTRAINT "driver_mission_progress_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."driver_missions"
    ADD CONSTRAINT "driver_missions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."driver_payout_methods"
    ADD CONSTRAINT "driver_payout_methods_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."driver_payout_requests"
    ADD CONSTRAINT "driver_payout_requests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."driver_payouts"
    ADD CONSTRAINT "driver_payouts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."driver_penalties"
    ADD CONSTRAINT "driver_penalties_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."driver_performance"
    ADD CONSTRAINT "driver_performance_driver_id_key" UNIQUE ("driver_id");



ALTER TABLE ONLY "public"."driver_performance"
    ADD CONSTRAINT "driver_performance_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."driver_referrals"
    ADD CONSTRAINT "driver_referrals_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."driver_rewards"
    ADD CONSTRAINT "driver_rewards_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."driver_safety_contacts"
    ADD CONSTRAINT "driver_safety_contacts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."driver_settings"
    ADD CONSTRAINT "driver_settings_driver_id_key" UNIQUE ("driver_id");



ALTER TABLE ONLY "public"."driver_settings"
    ADD CONSTRAINT "driver_settings_driver_id_unique" UNIQUE ("driver_id");



ALTER TABLE ONLY "public"."driver_settings"
    ADD CONSTRAINT "driver_settings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."driver_transactions"
    ADD CONSTRAINT "driver_transactions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."driver_wallet_transactions"
    ADD CONSTRAINT "driver_wallet_transactions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."driver_wallets"
    ADD CONSTRAINT "driver_wallets_driver_id_key" UNIQUE ("driver_id");



ALTER TABLE ONLY "public"."driver_wallets"
    ADD CONSTRAINT "driver_wallets_driver_id_unique" UNIQUE ("driver_id");



ALTER TABLE ONLY "public"."driver_wallets"
    ADD CONSTRAINT "driver_wallets_firebase_uid_unique" UNIQUE ("firebase_uid");



ALTER TABLE ONLY "public"."driver_wallets"
    ADD CONSTRAINT "driver_wallets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."drivers"
    ADD CONSTRAINT "drivers_driver_license_number_key" UNIQUE ("driver_license_number");



ALTER TABLE ONLY "public"."drivers"
    ADD CONSTRAINT "drivers_firebase_uid_key" UNIQUE ("firebase_uid");



ALTER TABLE ONLY "public"."drivers"
    ADD CONSTRAINT "drivers_firebase_uid_unique" UNIQUE ("firebase_uid");



ALTER TABLE ONLY "public"."drivers"
    ADD CONSTRAINT "drivers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."drivers"
    ADD CONSTRAINT "drivers_referral_code_key" UNIQUE ("referral_code");



ALTER TABLE ONLY "public"."drivers"
    ADD CONSTRAINT "drivers_user_id_key" UNIQUE ("user_id");



ALTER TABLE ONLY "public"."drivers"
    ADD CONSTRAINT "drivers_user_id_unique" UNIQUE ("user_id");



ALTER TABLE ONLY "public"."emergency_alerts"
    ADD CONSTRAINT "emergency_alerts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."emergency_contacts"
    ADD CONSTRAINT "emergency_contacts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."emergency_responses"
    ADD CONSTRAINT "emergency_responses_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."fare_estimation_logs"
    ADD CONSTRAINT "fare_estimation_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."fraud_flags"
    ADD CONSTRAINT "fraud_flags_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."fraud_protection_rules"
    ADD CONSTRAINT "fraud_protection_rules_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."fraud_protection_rules"
    ADD CONSTRAINT "fraud_protection_rules_rule_name_key" UNIQUE ("rule_name");



ALTER TABLE ONLY "public"."incident_assignments"
    ADD CONSTRAINT "incident_assignments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."incident_evidence"
    ADD CONSTRAINT "incident_evidence_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."incident_notes"
    ADD CONSTRAINT "incident_notes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."incident_status_history"
    ADD CONSTRAINT "incident_status_history_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."incident_timeline"
    ADD CONSTRAINT "incident_timeline_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."incidents"
    ADD CONSTRAINT "incidents_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."integration_logs"
    ADD CONSTRAINT "integration_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."integrations"
    ADD CONSTRAINT "integrations_integration_key_key" UNIQUE ("integration_key");



ALTER TABLE ONLY "public"."integrations"
    ADD CONSTRAINT "integrations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."loyalty_notifications"
    ADD CONSTRAINT "loyalty_notifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."loyalty_points_transactions"
    ADD CONSTRAINT "loyalty_points_transactions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."loyalty_tier_config"
    ADD CONSTRAINT "loyalty_tier_config_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."loyalty_tier_config"
    ADD CONSTRAINT "loyalty_tier_config_tier_name_key" UNIQUE ("tier_name");



ALTER TABLE ONLY "public"."loyalty_tiers"
    ADD CONSTRAINT "loyalty_tiers_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."loyalty_tiers"
    ADD CONSTRAINT "loyalty_tiers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."marketing_banners"
    ADD CONSTRAINT "marketing_banners_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."marketing_campaigns"
    ADD CONSTRAINT "marketing_campaigns_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."marketing_events"
    ADD CONSTRAINT "marketing_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."moderation_actions"
    ADD CONSTRAINT "moderation_actions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."moderation_appeals"
    ADD CONSTRAINT "moderation_appeals_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."moderation_cases"
    ADD CONSTRAINT "moderation_cases_case_number_key" UNIQUE ("case_number");



ALTER TABLE ONLY "public"."moderation_cases"
    ADD CONSTRAINT "moderation_cases_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."moderation_evidence"
    ADD CONSTRAINT "moderation_evidence_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notification_delivery_logs"
    ADD CONSTRAINT "notification_delivery_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."payment_transactions"
    ADD CONSTRAINT "payment_transactions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_ride_id_key" UNIQUE ("ride_id");



ALTER TABLE ONLY "public"."payout_audit_logs"
    ADD CONSTRAINT "payout_audit_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."payout_batches"
    ADD CONSTRAINT "payout_batches_batch_number_key" UNIQUE ("batch_number");



ALTER TABLE ONLY "public"."payout_batches"
    ADD CONSTRAINT "payout_batches_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."payout_settings"
    ADD CONSTRAINT "payout_settings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."payout_settings"
    ADD CONSTRAINT "payout_settings_setting_key_key" UNIQUE ("setting_key");



ALTER TABLE ONLY "public"."places"
    ADD CONSTRAINT "places_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."platform_escrow"
    ADD CONSTRAINT "platform_escrow_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."platform_escrow"
    ADD CONSTRAINT "platform_escrow_ride_id_key" UNIQUE ("ride_id");



ALTER TABLE ONLY "public"."platform_feature_flags"
    ADD CONSTRAINT "platform_feature_flags_feature_key_key" UNIQUE ("feature_key");



ALTER TABLE ONLY "public"."platform_feature_flags"
    ADD CONSTRAINT "platform_feature_flags_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pricing_config"
    ADD CONSTRAINT "pricing_config_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pricing_driver_incentives"
    ADD CONSTRAINT "pricing_driver_incentives_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pricing_surge_rules"
    ADD CONSTRAINT "pricing_surge_rules_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."promo_codes"
    ADD CONSTRAINT "promo_codes_code_key" UNIQUE ("code");



ALTER TABLE ONLY "public"."promo_codes"
    ADD CONSTRAINT "promo_codes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."promo_redemptions"
    ADD CONSTRAINT "promo_redemptions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."promo_redemptions"
    ADD CONSTRAINT "promo_redemptions_promo_id_user_id_key" UNIQUE ("promo_id", "user_id");



ALTER TABLE ONLY "public"."promotions"
    ADD CONSTRAINT "promotions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."push_notifications"
    ADD CONSTRAINT "push_notifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ratings"
    ADD CONSTRAINT "ratings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ratings"
    ADD CONSTRAINT "ratings_ride_id_rated_by_key" UNIQUE ("ride_id", "rated_by");



ALTER TABLE ONLY "public"."referral_campaigns"
    ADD CONSTRAINT "referral_campaigns_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."referral_events"
    ADD CONSTRAINT "referral_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."referral_fraud_checks"
    ADD CONSTRAINT "referral_fraud_checks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."referral_rewards"
    ADD CONSTRAINT "referral_rewards_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."referral_settings"
    ADD CONSTRAINT "referral_settings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."referral_settings"
    ADD CONSTRAINT "referral_settings_setting_key_key" UNIQUE ("setting_key");



ALTER TABLE ONLY "public"."refund_actions"
    ADD CONSTRAINT "refund_actions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."refund_audit_logs"
    ADD CONSTRAINT "refund_audit_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."refunds"
    ADD CONSTRAINT "refunds_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."reward_definitions"
    ADD CONSTRAINT "reward_definitions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ride_categories"
    ADD CONSTRAINT "ride_categories_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ride_categories"
    ADD CONSTRAINT "ride_categories_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."ride_disputes"
    ADD CONSTRAINT "ride_disputes_dispute_number_key" UNIQUE ("dispute_number");



ALTER TABLE ONLY "public"."ride_disputes"
    ADD CONSTRAINT "ride_disputes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ride_events"
    ADD CONSTRAINT "ride_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ride_invoices"
    ADD CONSTRAINT "ride_invoices_invoice_number_key" UNIQUE ("invoice_number");



ALTER TABLE ONLY "public"."ride_invoices"
    ADD CONSTRAINT "ride_invoices_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ride_invoices"
    ADD CONSTRAINT "ride_invoices_ride_id_key" UNIQUE ("ride_id");



ALTER TABLE ONLY "public"."ride_location_points"
    ADD CONSTRAINT "ride_location_points_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ride_messages"
    ADD CONSTRAINT "ride_messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ride_requests"
    ADD CONSTRAINT "ride_requests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ride_requests"
    ADD CONSTRAINT "ride_requests_ride_id_driver_id_key" UNIQUE ("ride_id", "driver_id");



ALTER TABLE ONLY "public"."ride_safety_events"
    ADD CONSTRAINT "ride_safety_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."rider_loyalty_accounts"
    ADD CONSTRAINT "rider_loyalty_accounts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."rider_loyalty_accounts"
    ADD CONSTRAINT "rider_loyalty_accounts_rider_id_key" UNIQUE ("rider_id");



ALTER TABLE ONLY "public"."rider_ratings"
    ADD CONSTRAINT "rider_ratings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."rider_referrals"
    ADD CONSTRAINT "rider_referrals_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."rider_rewards"
    ADD CONSTRAINT "rider_rewards_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."rider_settings"
    ADD CONSTRAINT "rider_settings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."rider_settings"
    ADD CONSTRAINT "rider_settings_rider_id_key" UNIQUE ("rider_id");



ALTER TABLE ONLY "public"."riders"
    ADD CONSTRAINT "riders_firebase_uid_key" UNIQUE ("firebase_uid");



ALTER TABLE ONLY "public"."riders"
    ADD CONSTRAINT "riders_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."riders"
    ADD CONSTRAINT "riders_referral_code_key" UNIQUE ("referral_code");



ALTER TABLE ONLY "public"."riders"
    ADD CONSTRAINT "riders_user_id_key" UNIQUE ("user_id");



ALTER TABLE ONLY "public"."rides"
    ADD CONSTRAINT "rides_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."role_permissions"
    ADD CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id", "permission_id");



ALTER TABLE ONLY "public"."safety_incidents"
    ADD CONSTRAINT "safety_incidents_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."service_zone_audit_logs"
    ADD CONSTRAINT "service_zone_audit_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."service_zones"
    ADD CONSTRAINT "service_zones_city_id_name_key" UNIQUE ("city_id", "name");



ALTER TABLE ONLY "public"."service_zones"
    ADD CONSTRAINT "service_zones_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."staff_invitations"
    ADD CONSTRAINT "staff_invitations_invite_token_key" UNIQUE ("invite_token");



ALTER TABLE ONLY "public"."staff_invitations"
    ADD CONSTRAINT "staff_invitations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."support_chat_messages"
    ADD CONSTRAINT "support_chat_messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."support_chats"
    ADD CONSTRAINT "support_chats_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."support_tickets"
    ADD CONSTRAINT "support_tickets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tax_configs"
    ADD CONSTRAINT "tax_configs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tax_configs"
    ADD CONSTRAINT "tax_configs_tax_name_key" UNIQUE ("tax_name");



ALTER TABLE ONLY "public"."tax_records"
    ADD CONSTRAINT "tax_records_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."trip_earnings"
    ADD CONSTRAINT "trip_earnings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."trip_earnings"
    ADD CONSTRAINT "trip_earnings_ride_id_key" UNIQUE ("ride_id");



ALTER TABLE ONLY "public"."trip_queue"
    ADD CONSTRAINT "trip_queue_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_notification_tokens"
    ADD CONSTRAINT "user_notification_tokens_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_notification_tokens"
    ADD CONSTRAINT "user_notification_tokens_user_id_fcm_token_key" UNIQUE ("user_id", "fcm_token");



ALTER TABLE ONLY "public"."user_risk_scores"
    ADD CONSTRAINT "user_risk_scores_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_risk_scores"
    ADD CONSTRAINT "user_risk_scores_user_id_key" UNIQUE ("user_id");



ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_suspensions"
    ADD CONSTRAINT "user_suspensions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_firebase_uid_key" UNIQUE ("firebase_uid");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."vehicle_maintenance_records"
    ADD CONSTRAINT "vehicle_maintenance_records_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."vehicles"
    ADD CONSTRAINT "vehicles_driver_id_key" UNIQUE ("driver_id");



ALTER TABLE ONLY "public"."vehicles"
    ADD CONSTRAINT "vehicles_driver_id_unique" UNIQUE ("driver_id");



ALTER TABLE ONLY "public"."vehicles"
    ADD CONSTRAINT "vehicles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."vehicles"
    ADD CONSTRAINT "vehicles_plate_number_unique" UNIQUE ("plate_number");



ALTER TABLE ONLY "public"."wallet_transactions"
    ADD CONSTRAINT "wallet_transactions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."wallets"
    ADD CONSTRAINT "wallets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."wallets"
    ADD CONSTRAINT "wallets_user_id_key" UNIQUE ("user_id");



ALTER TABLE ONLY "public"."weafrica_places"
    ADD CONSTRAINT "weafrica_places_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."webhook_events"
    ADD CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."whatsapp_conversations"
    ADD CONSTRAINT "whatsapp_conversations_phone_key" UNIQUE ("phone");



ALTER TABLE ONLY "public"."whatsapp_conversations"
    ADD CONSTRAINT "whatsapp_conversations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."whatsapp_ride_requests"
    ADD CONSTRAINT "whatsapp_ride_requests_pkey" PRIMARY KEY ("id");



CREATE UNIQUE INDEX "driver_wallets_firebase_uid_key" ON "public"."driver_wallets" USING "btree" ("firebase_uid");



CREATE INDEX "idx_achievement_unlocks_driver" ON "public"."driver_achievement_unlocks" USING "btree" ("driver_id");



CREATE INDEX "idx_admin_pa_request" ON "public"."admin_payout_actions" USING "btree" ("payout_request_id");



CREATE INDEX "idx_airport_zone_queue_driver" ON "public"."airport_zone_queue" USING "btree" ("driver_id", "status");



CREATE INDEX "idx_airport_zone_queue_zone_status" ON "public"."airport_zone_queue" USING "btree" ("zone_id", "status", "entered_at");



CREATE INDEX "idx_appeals_status" ON "public"."moderation_appeals" USING "btree" ("status");



CREATE INDEX "idx_appeals_user" ON "public"."moderation_appeals" USING "btree" ("user_id");



CREATE INDEX "idx_audit_admin" ON "public"."admin_audit_logs" USING "btree" ("admin_id", "created_at" DESC);



CREATE INDEX "idx_audit_logs_action" ON "public"."audit_logs" USING "btree" ("action", "created_at" DESC);



CREATE INDEX "idx_audit_logs_admin" ON "public"."audit_logs" USING "btree" ("admin_id", "created_at" DESC);



CREATE INDEX "idx_audit_logs_target" ON "public"."audit_logs" USING "btree" ("target_type", "target_id");



CREATE INDEX "idx_audit_target" ON "public"."admin_audit_logs" USING "btree" ("target_type", "target_id");



CREATE INDEX "idx_commission_class" ON "public"."commission_configs" USING "btree" ("vehicle_class");



CREATE INDEX "idx_commissions_driver" ON "public"."company_commissions" USING "btree" ("driver_id");



CREATE INDEX "idx_commissions_ride" ON "public"."company_commissions" USING "btree" ("ride_id");



CREATE INDEX "idx_delivery_notif" ON "public"."notification_delivery_logs" USING "btree" ("notification_id");



CREATE INDEX "idx_delivery_status" ON "public"."notification_delivery_logs" USING "btree" ("status");



CREATE INDEX "idx_delivery_user" ON "public"."notification_delivery_logs" USING "btree" ("user_id");



CREATE INDEX "idx_demand_event_responses_driver" ON "public"."demand_event_responses" USING "btree" ("driver_id");



CREATE INDEX "idx_demand_event_responses_event" ON "public"."demand_event_responses" USING "btree" ("event_id");



CREATE INDEX "idx_demand_event_responses_status" ON "public"."demand_event_responses" USING "btree" ("status");



CREATE INDEX "idx_demand_events_active" ON "public"."demand_events" USING "btree" ("is_active");



CREATE INDEX "idx_demand_events_city" ON "public"."demand_events" USING "btree" ("city");



CREATE INDEX "idx_demand_events_source" ON "public"."demand_events" USING "btree" ("source");



CREATE INDEX "idx_demand_events_time_window" ON "public"."demand_events" USING "btree" ("starts_at", "ends_at");



CREATE INDEX "idx_dispute_history_dispute" ON "public"."dispute_status_history" USING "btree" ("dispute_id", "created_at" DESC);



CREATE INDEX "idx_dispute_msgs_dispute" ON "public"."dispute_messages" USING "btree" ("dispute_id", "created_at");



CREATE INDEX "idx_disputes_priority" ON "public"."ride_disputes" USING "btree" ("priority");



CREATE INDEX "idx_disputes_status" ON "public"."ride_disputes" USING "btree" ("status");



CREATE INDEX "idx_disputes_type" ON "public"."ride_disputes" USING "btree" ("dispute_type");



CREATE INDEX "idx_driver_daily_date" ON "public"."driver_daily_earnings" USING "btree" ("driver_id", "earnings_date" DESC);



CREATE INDEX "idx_driver_documents_driver_id" ON "public"."driver_documents" USING "btree" ("driver_id");



CREATE INDEX "idx_driver_documents_status" ON "public"."driver_documents" USING "btree" ("status");



CREATE INDEX "idx_driver_documents_type" ON "public"."driver_documents" USING "btree" ("document_type");



CREATE UNIQUE INDEX "idx_driver_documents_unique" ON "public"."driver_documents" USING "btree" ("driver_id", "document_type") WHERE ("status" = 'approved'::"text");



CREATE INDEX "idx_driver_locations_coords" ON "public"."driver_locations" USING "btree" ("latitude", "longitude");



CREATE INDEX "idx_driver_locations_driver" ON "public"."driver_locations" USING "btree" ("driver_id", "updated_at" DESC);



CREATE INDEX "idx_driver_locations_driver_id" ON "public"."driver_locations" USING "btree" ("driver_id");



CREATE INDEX "idx_driver_locations_firebase" ON "public"."driver_locations" USING "btree" ("firebase_uid");



CREATE INDEX "idx_driver_locations_firebase_uid" ON "public"."driver_locations" USING "btree" ("firebase_uid");



CREATE INDEX "idx_driver_locations_online" ON "public"."driver_locations" USING "btree" ("is_online", "updated_at" DESC);



CREATE UNIQUE INDEX "idx_driver_locations_unique" ON "public"."driver_locations" USING "btree" ("driver_id");



CREATE INDEX "idx_driver_loyalty_accts_driver" ON "public"."driver_loyalty_accounts" USING "btree" ("driver_id");



CREATE INDEX "idx_driver_loyalty_accts_tier" ON "public"."driver_loyalty_accounts" USING "btree" ("current_tier");



CREATE INDEX "idx_driver_messages_driver" ON "public"."driver_messages" USING "btree" ("driver_id", "created_at" DESC);



CREATE INDEX "idx_driver_referrals_campaign" ON "public"."driver_referrals" USING "btree" ("campaign_id");



CREATE INDEX "idx_driver_referrals_ref" ON "public"."driver_referrals" USING "btree" ("referrer_driver_id");



CREATE INDEX "idx_driver_referrals_referred" ON "public"."driver_referrals" USING "btree" ("referred_driver_id");



CREATE INDEX "idx_driver_referrals_referrer" ON "public"."driver_referrals" USING "btree" ("referrer_id", "created_at" DESC);



CREATE INDEX "idx_driver_referrals_status" ON "public"."driver_referrals" USING "btree" ("status");



CREATE INDEX "idx_driver_rewards_driver" ON "public"."driver_rewards" USING "btree" ("driver_id", "status");



CREATE INDEX "idx_driver_transactions_driver" ON "public"."driver_transactions" USING "btree" ("driver_id", "created_at" DESC);



CREATE INDEX "idx_driver_transactions_type" ON "public"."driver_transactions" USING "btree" ("transaction_type");



CREATE INDEX "idx_driver_wallets_driver" ON "public"."driver_wallets" USING "btree" ("driver_id");



CREATE INDEX "idx_drivers_approval_status" ON "public"."drivers" USING "btree" ("approval_status");



CREATE INDEX "idx_drivers_firebase_uid" ON "public"."drivers" USING "btree" ("firebase_uid");



CREATE INDEX "idx_drivers_identity_verified" ON "public"."drivers" USING "btree" ("identity_verified_at");



CREATE INDEX "idx_drivers_referral_code" ON "public"."drivers" USING "btree" ("referral_code");



CREATE INDEX "idx_drivers_referred_by" ON "public"."drivers" USING "btree" ("referred_by");



CREATE INDEX "idx_dw_tx_driver" ON "public"."driver_wallet_transactions" USING "btree" ("driver_id");



CREATE INDEX "idx_dw_tx_type" ON "public"."driver_wallet_transactions" USING "btree" ("transaction_type");



CREATE INDEX "idx_dw_tx_wallet" ON "public"."driver_wallet_transactions" USING "btree" ("wallet_id");



CREATE INDEX "idx_ec_user" ON "public"."emergency_contacts" USING "btree" ("user_id");



CREATE INDEX "idx_emergency_alerts_status" ON "public"."emergency_alerts" USING "btree" ("status");



CREATE INDEX "idx_er_alert" ON "public"."emergency_responses" USING "btree" ("alert_id", "created_at" DESC);



CREATE INDEX "idx_fare_estimation_logs_created" ON "public"."fare_estimation_logs" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_fcm_token_role" ON "public"."user_notification_tokens" USING "btree" ("role", "is_active");



CREATE INDEX "idx_fcm_token_user" ON "public"."user_notification_tokens" USING "btree" ("user_id");



CREATE INDEX "idx_feature_flags_category" ON "public"."platform_feature_flags" USING "btree" ("category");



CREATE INDEX "idx_feature_flags_enabled" ON "public"."platform_feature_flags" USING "btree" ("is_enabled");



CREATE INDEX "idx_fraud_flags_resolved" ON "public"."fraud_flags" USING "btree" ("is_resolved");



CREATE INDEX "idx_fraud_flags_ride" ON "public"."fraud_flags" USING "btree" ("ride_id");



CREATE INDEX "idx_fraud_flags_type" ON "public"."fraud_flags" USING "btree" ("flag_type");



CREATE INDEX "idx_ia_incident" ON "public"."incident_assignments" USING "btree" ("incident_id");



CREATE INDEX "idx_ie_incident" ON "public"."incident_evidence" USING "btree" ("incident_id");



CREATE INDEX "idx_integration_logs_integration" ON "public"."integration_logs" USING "btree" ("integration_id", "created_at" DESC);



CREATE INDEX "idx_invitations_email" ON "public"."staff_invitations" USING "btree" ("email");



CREATE INDEX "idx_invitations_status" ON "public"."staff_invitations" USING "btree" ("status", "expires_at");



CREATE INDEX "idx_invitations_token" ON "public"."staff_invitations" USING "btree" ("invite_token");



CREATE INDEX "idx_ish_incident" ON "public"."incident_status_history" USING "btree" ("incident_id", "created_at" DESC);



CREATE INDEX "idx_it_incident" ON "public"."incident_timeline" USING "btree" ("incident_id", "created_at");



CREATE INDEX "idx_loyalty_notif_rider" ON "public"."loyalty_notifications" USING "btree" ("rider_id", "created_at" DESC);



CREATE INDEX "idx_loyalty_notif_unread" ON "public"."loyalty_notifications" USING "btree" ("user_id") WHERE (NOT "is_read");



CREATE INDEX "idx_loyalty_notif_user" ON "public"."loyalty_notifications" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "idx_loyalty_points_rider" ON "public"."loyalty_points_transactions" USING "btree" ("rider_id", "created_at" DESC);



CREATE INDEX "idx_marketing_banners_active" ON "public"."marketing_banners" USING "btree" ("is_active", "starts_at", "ends_at");



CREATE INDEX "idx_marketing_banners_city" ON "public"."marketing_banners" USING "btree" ("target_city");



CREATE INDEX "idx_marketing_banners_placement" ON "public"."marketing_banners" USING "btree" ("placement", "is_active", "created_at" DESC);



CREATE INDEX "idx_marketing_campaigns_status" ON "public"."marketing_campaigns" USING "btree" ("status");



CREATE INDEX "idx_marketing_campaigns_type" ON "public"."marketing_campaigns" USING "btree" ("campaign_type");



CREATE INDEX "idx_marketing_events_entity" ON "public"."marketing_events" USING "btree" ("entity_type", "entity_id");



CREATE INDEX "idx_marketing_events_type" ON "public"."marketing_events" USING "btree" ("event_type", "created_at" DESC);



CREATE INDEX "idx_mission_progress_driver" ON "public"."driver_mission_progress" USING "btree" ("driver_id");



CREATE INDEX "idx_mod_actions_case" ON "public"."moderation_actions" USING "btree" ("case_id");



CREATE INDEX "idx_mod_cases_priority" ON "public"."moderation_cases" USING "btree" ("priority");



CREATE INDEX "idx_mod_cases_reported" ON "public"."moderation_cases" USING "btree" ("reported_user_id");



CREATE INDEX "idx_mod_cases_status" ON "public"."moderation_cases" USING "btree" ("status");



CREATE INDEX "idx_mod_cases_type" ON "public"."moderation_cases" USING "btree" ("case_type");



CREATE INDEX "idx_mod_evidence_case" ON "public"."moderation_evidence" USING "btree" ("case_id");



CREATE INDEX "idx_notifications_user_unread" ON "public"."notifications" USING "btree" ("user_id", "is_read", "created_at" DESC);



CREATE INDEX "idx_payment_tx_payment" ON "public"."payment_transactions" USING "btree" ("payment_id");



CREATE INDEX "idx_payment_tx_provider" ON "public"."payment_transactions" USING "btree" ("provider");



CREATE INDEX "idx_payment_tx_status" ON "public"."payment_transactions" USING "btree" ("provider_status");



CREATE INDEX "idx_payments_ride" ON "public"."payments" USING "btree" ("ride_id");



CREATE INDEX "idx_payments_status" ON "public"."payments" USING "btree" ("payment_status");



CREATE INDEX "idx_payout_audit_created" ON "public"."payout_audit_logs" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_payout_audit_request" ON "public"."payout_audit_logs" USING "btree" ("payout_request_id");



CREATE INDEX "idx_payout_methods_driver" ON "public"."driver_payout_methods" USING "btree" ("driver_id");



CREATE INDEX "idx_payout_req_batch" ON "public"."driver_payout_requests" USING "btree" ("batch_id");



CREATE INDEX "idx_payout_req_driver" ON "public"."driver_payout_requests" USING "btree" ("driver_id");



CREATE INDEX "idx_payout_req_status" ON "public"."driver_payout_requests" USING "btree" ("status");



CREATE INDEX "idx_penalties_driver" ON "public"."driver_penalties" USING "btree" ("driver_id");



CREATE INDEX "idx_penalties_ride" ON "public"."driver_penalties" USING "btree" ("ride_id");



CREATE INDEX "idx_penalties_status" ON "public"."driver_penalties" USING "btree" ("status");



CREATE INDEX "idx_places_category" ON "public"."weafrica_places" USING "btree" ("category");



CREATE INDEX "idx_places_city" ON "public"."weafrica_places" USING "btree" ("city_id");



CREATE INDEX "idx_places_coords" ON "public"."weafrica_places" USING "btree" ("latitude", "longitude");



CREATE INDEX "idx_platform_escrow_ride" ON "public"."platform_escrow" USING "btree" ("ride_id");



CREATE INDEX "idx_platform_escrow_rider" ON "public"."platform_escrow" USING "btree" ("rider_id");



CREATE INDEX "idx_platform_escrow_status" ON "public"."platform_escrow" USING "btree" ("escrow_status");



CREATE INDEX "idx_promo_codes_code" ON "public"."promo_codes" USING "btree" ("code");



CREATE INDEX "idx_promo_codes_status" ON "public"."promo_codes" USING "btree" ("status");



CREATE INDEX "idx_promo_redemptions_promo_id" ON "public"."promo_redemptions" USING "btree" ("promo_id");



CREATE INDEX "idx_promo_redemptions_ride_id" ON "public"."promo_redemptions" USING "btree" ("ride_id");



CREATE INDEX "idx_promo_redemptions_user_id" ON "public"."promo_redemptions" USING "btree" ("user_id");



CREATE INDEX "idx_promotions_active_placement" ON "public"."promotions" USING "btree" ("is_active", "placement", "priority" DESC, "created_at" DESC);



CREATE INDEX "idx_promotions_dates" ON "public"."promotions" USING "btree" ("start_date", "end_date");



CREATE INDEX "idx_push_notif_created" ON "public"."push_notifications" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_push_notif_status" ON "public"."push_notifications" USING "btree" ("status");



CREATE INDEX "idx_push_notif_type" ON "public"."push_notifications" USING "btree" ("notification_type");



CREATE INDEX "idx_re_ride" ON "public"."ride_events" USING "btree" ("ride_id", "recorded_at");



CREATE INDEX "idx_referral_campaigns_active" ON "public"."referral_campaigns" USING "btree" ("is_active");



CREATE INDEX "idx_referral_campaigns_type" ON "public"."referral_campaigns" USING "btree" ("campaign_type");



CREATE INDEX "idx_referral_events_referral" ON "public"."referral_events" USING "btree" ("referral_id", "created_at" DESC);



CREATE INDEX "idx_referral_events_type" ON "public"."referral_events" USING "btree" ("event_type", "created_at" DESC);



CREATE INDEX "idx_referral_fraud_referral" ON "public"."referral_fraud_checks" USING "btree" ("referral_id");



CREATE INDEX "idx_referral_rewards_recipient" ON "public"."referral_rewards" USING "btree" ("recipient_id", "referral_type");



CREATE INDEX "idx_referral_rewards_referral" ON "public"."referral_rewards" USING "btree" ("referral_id");



CREATE INDEX "idx_referral_rewards_status" ON "public"."referral_rewards" USING "btree" ("status");



CREATE INDEX "idx_refund_actions_refund" ON "public"."refund_actions" USING "btree" ("refund_id");



CREATE INDEX "idx_refund_audit_created" ON "public"."refund_audit_logs" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_refund_audit_refund" ON "public"."refund_audit_logs" USING "btree" ("refund_id");



CREATE INDEX "idx_refunds_created_at" ON "public"."refunds" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_refunds_driver_id" ON "public"."refunds" USING "btree" ("driver_id");



CREATE INDEX "idx_refunds_ride_id" ON "public"."refunds" USING "btree" ("ride_id");



CREATE INDEX "idx_refunds_rider_id" ON "public"."refunds" USING "btree" ("rider_id");



CREATE INDEX "idx_refunds_status" ON "public"."refunds" USING "btree" ("status");



CREATE INDEX "idx_reward_definitions_active" ON "public"."reward_definitions" USING "btree" ("is_active", "sort_order");



CREATE INDEX "idx_ride_invoices_number" ON "public"."ride_invoices" USING "btree" ("invoice_number");



CREATE INDEX "idx_ride_invoices_ride" ON "public"."ride_invoices" USING "btree" ("ride_id");



CREATE INDEX "idx_ride_invoices_rider" ON "public"."ride_invoices" USING "btree" ("rider_id");



CREATE INDEX "idx_ride_messages_ride" ON "public"."ride_messages" USING "btree" ("ride_id", "created_at");



CREATE INDEX "idx_ride_requests_city_id" ON "public"."ride_requests" USING "btree" ("city_id");



CREATE INDEX "idx_rider_loyalty_accounts_rider" ON "public"."rider_loyalty_accounts" USING "btree" ("rider_id");



CREATE INDEX "idx_rider_loyalty_accounts_tier" ON "public"."rider_loyalty_accounts" USING "btree" ("current_tier");



CREATE INDEX "idx_rider_loyalty_accounts_user" ON "public"."rider_loyalty_accounts" USING "btree" ("user_id");



CREATE INDEX "idx_rider_ratings_rating" ON "public"."rider_ratings" USING "btree" ("rating");



CREATE INDEX "idx_rider_ratings_ride_id" ON "public"."rider_ratings" USING "btree" ("ride_id");



CREATE UNIQUE INDEX "idx_rider_ratings_ride_unique" ON "public"."rider_ratings" USING "btree" ("ride_id");



CREATE INDEX "idx_rider_ratings_rider_id" ON "public"."rider_ratings" USING "btree" ("rider_id");



CREATE INDEX "idx_rider_referrals_referred" ON "public"."rider_referrals" USING "btree" ("referred_rider_id");



CREATE INDEX "idx_rider_referrals_referrer" ON "public"."rider_referrals" USING "btree" ("referrer_id", "created_at" DESC);



CREATE INDEX "idx_rider_referrals_status" ON "public"."rider_referrals" USING "btree" ("status");



CREATE INDEX "idx_rider_rewards_expires" ON "public"."rider_rewards" USING "btree" ("expires_at") WHERE ("status" = 'active'::"text");



CREATE INDEX "idx_rider_rewards_rider" ON "public"."rider_rewards" USING "btree" ("rider_id", "status");



CREATE INDEX "idx_rider_rewards_used_ride" ON "public"."rider_rewards" USING "btree" ("used_on_ride_id");



CREATE INDEX "idx_rides_created" ON "public"."rides" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_rides_driver" ON "public"."rides" USING "btree" ("driver_id");



CREATE INDEX "idx_rides_requested_dispatch" ON "public"."rides" USING "btree" ("status", "created_at") WHERE ("status" = ANY (ARRAY['requested'::"text", 'searching'::"text"]));



CREATE INDEX "idx_rides_rider" ON "public"."rides" USING "btree" ("rider_id");



CREATE INDEX "idx_rides_rider_active" ON "public"."rides" USING "btree" ("rider_id", "status", "created_at" DESC);



CREATE INDEX "idx_rides_status" ON "public"."rides" USING "btree" ("status");



CREATE INDEX "idx_risk_user" ON "public"."user_risk_scores" USING "btree" ("user_id");



CREATE INDEX "idx_rlp_ride" ON "public"."ride_location_points" USING "btree" ("ride_id", "recorded_at");



CREATE INDEX "idx_rlp_ride_event" ON "public"."ride_location_points" USING "btree" ("ride_id", "event_type");



CREATE INDEX "idx_rse_ride" ON "public"."ride_safety_events" USING "btree" ("ride_id", "recorded_at");



CREATE INDEX "idx_rse_type" ON "public"."ride_safety_events" USING "btree" ("ride_id", "event_type");



CREATE INDEX "idx_safety_contacts_driver" ON "public"."driver_safety_contacts" USING "btree" ("driver_id");



CREATE INDEX "idx_safety_incidents_severity" ON "public"."safety_incidents" USING "btree" ("severity");



CREATE INDEX "idx_safety_incidents_status" ON "public"."safety_incidents" USING "btree" ("status");



CREATE INDEX "idx_service_zone_audit_action_time" ON "public"."service_zone_audit_logs" USING "btree" ("action", "created_at" DESC);



CREATE INDEX "idx_service_zone_audit_zone_time" ON "public"."service_zone_audit_logs" USING "btree" ("zone_id", "created_at" DESC);



CREATE INDEX "idx_service_zones_boundary_gin" ON "public"."service_zones" USING "gin" ("boundary_coordinates");



CREATE INDEX "idx_service_zones_city_status" ON "public"."service_zones" USING "btree" ("city", "status");



CREATE INDEX "idx_service_zones_type_status" ON "public"."service_zones" USING "btree" ("zone_type", "status");



CREATE INDEX "idx_service_zones_updated" ON "public"."service_zones" USING "btree" ("updated_at" DESC);



CREATE INDEX "idx_settings_audit_admin" ON "public"."admin_settings_audit_logs" USING "btree" ("admin_id");



CREATE INDEX "idx_settings_audit_key" ON "public"."admin_settings_audit_logs" USING "btree" ("setting_key", "changed_at" DESC);



CREATE INDEX "idx_support_tickets_status" ON "public"."support_tickets" USING "btree" ("status");



CREATE INDEX "idx_support_tickets_user" ON "public"."support_tickets" USING "btree" ("user_id");



CREATE INDEX "idx_suspensions_user" ON "public"."user_suspensions" USING "btree" ("user_id", "is_active");



CREATE INDEX "idx_tax_config_name" ON "public"."tax_configs" USING "btree" ("tax_name");



CREATE INDEX "idx_tax_records_driver" ON "public"."tax_records" USING "btree" ("driver_id");



CREATE INDEX "idx_tax_records_period" ON "public"."tax_records" USING "btree" ("reporting_period");



CREATE INDEX "idx_tax_records_ride" ON "public"."tax_records" USING "btree" ("ride_id");



CREATE INDEX "idx_trip_earnings_driver" ON "public"."trip_earnings" USING "btree" ("driver_id");



CREATE INDEX "idx_trip_earnings_paid" ON "public"."trip_earnings" USING "btree" ("is_paid_to_wallet");



CREATE INDEX "idx_trip_earnings_ride" ON "public"."trip_earnings" USING "btree" ("ride_id");



CREATE INDEX "idx_trip_queue_driver" ON "public"."trip_queue" USING "btree" ("driver_id", "status");



CREATE INDEX "idx_trip_queue_ride" ON "public"."trip_queue" USING "btree" ("ride_id");



CREATE INDEX "idx_users_city_id" ON "public"."users" USING "btree" ("city_id");



CREATE INDEX "idx_users_firebase_uid" ON "public"."users" USING "btree" ("firebase_uid");



CREATE INDEX "idx_vehicles_plate_number_unique" ON "public"."vehicles" USING "btree" ("plate_number");



CREATE INDEX "idx_wallet_transactions_wallet" ON "public"."wallet_transactions" USING "btree" ("wallet_id");



CREATE INDEX "idx_webhook_events_integration" ON "public"."webhook_events" USING "btree" ("integration_id", "created_at" DESC);



CREATE INDEX "idx_whatsapp_conversations_phone" ON "public"."whatsapp_conversations" USING "btree" ("phone");



CREATE INDEX "idx_whatsapp_rides_linked" ON "public"."whatsapp_ride_requests" USING "btree" ("linked_ride_id");



CREATE INDEX "idx_whatsapp_rides_phone" ON "public"."whatsapp_ride_requests" USING "btree" ("customer_phone");



CREATE INDEX "idx_whatsapp_rides_status" ON "public"."whatsapp_ride_requests" USING "btree" ("status");



CREATE UNIQUE INDEX "one_active_ride" ON "public"."rides" USING "btree" ("rider_id") WHERE ("status" = ANY (ARRAY['requested'::"text", 'searching'::"text", 'driver_assigned'::"text", 'driver_arrived'::"text", 'started'::"text"]));



CREATE UNIQUE INDEX "one_active_ride_per_rider" ON "public"."rides" USING "btree" ("rider_id") WHERE ("status" = ANY (ARRAY['requested'::"text", 'searching'::"text", 'driver_assigned'::"text"]));



CREATE INDEX "places_address_trgm_idx" ON "public"."places" USING "gin" ("address" "public"."gin_trgm_ops");



CREATE INDEX "places_city_idx" ON "public"."places" USING "btree" ("city");



CREATE INDEX "places_name_trgm_idx" ON "public"."places" USING "gin" ("name" "public"."gin_trgm_ops");



CREATE INDEX "ride_requests_driver_status_idx" ON "public"."ride_requests" USING "btree" ("driver_id", "status");



CREATE INDEX "ride_requests_ride_idx" ON "public"."ride_requests" USING "btree" ("ride_id");



CREATE INDEX "rides_driver_status_idx" ON "public"."rides" USING "btree" ("driver_id", "status");



CREATE UNIQUE INDEX "rides_idempotency_key_idx" ON "public"."rides" USING "btree" ("idempotency_key") WHERE ("idempotency_key" IS NOT NULL);



CREATE INDEX "rides_rider_status_idx" ON "public"."rides" USING "btree" ("rider_id", "status");



CREATE UNIQUE INDEX "unique_driver_vehicle" ON "public"."vehicles" USING "btree" ("driver_id") WHERE ("driver_id" IS NOT NULL);



CREATE UNIQUE INDEX "unique_vehicle_plate_number" ON "public"."vehicles" USING "btree" ("upper"(TRIM(BOTH FROM "plate_number"))) WHERE ("plate_number" IS NOT NULL);



CREATE OR REPLACE TRIGGER "driver_approval_validation" BEFORE INSERT OR UPDATE ON "public"."drivers" FOR EACH ROW EXECUTE FUNCTION "public"."validate_driver_approval"();



CREATE OR REPLACE TRIGGER "service_zones_updated_at" BEFORE UPDATE ON "public"."service_zones" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "trg_apply_driver_wallet_transaction_to_wallet" AFTER INSERT ON "public"."driver_transactions" FOR EACH ROW EXECUTE FUNCTION "public"."apply_driver_wallet_transaction_to_wallet"();



CREATE OR REPLACE TRIGGER "trg_assign_driver_referral_code" AFTER UPDATE OF "approval_status" ON "public"."drivers" FOR EACH ROW WHEN ((("new"."approval_status" = 'approved'::"text") AND ("old"."approval_status" IS DISTINCT FROM 'approved'::"text"))) EXECUTE FUNCTION "public"."auto_assign_referral_code_on_approval"();



CREATE OR REPLACE TRIGGER "trg_auto_complete_referral" AFTER UPDATE OF "status" ON "public"."rides" FOR EACH ROW WHEN (("new"."status" = 'completed'::"text")) EXECUTE FUNCTION "public"."auto_complete_referral_on_first_trip"();



CREATE OR REPLACE TRIGGER "trg_credit_driver_referral_wallet" AFTER UPDATE OF "status" ON "public"."driver_referrals" FOR EACH ROW EXECUTE FUNCTION "public"."credit_referral_bonus_to_wallet"();



CREATE OR REPLACE TRIGGER "trg_credit_rider_referral_wallet" AFTER UPDATE OF "status" ON "public"."rider_referrals" FOR EACH ROW EXECUTE FUNCTION "public"."credit_referral_bonus_to_wallet"();



CREATE OR REPLACE TRIGGER "trg_driver_graduation" BEFORE INSERT OR UPDATE ON "public"."drivers" FOR EACH ROW EXECUTE FUNCTION "public"."compute_driver_graduation"();



CREATE OR REPLACE TRIGGER "trg_normalize_driver_wallet_transaction" BEFORE INSERT OR UPDATE ON "public"."driver_transactions" FOR EACH ROW EXECUTE FUNCTION "public"."normalize_driver_wallet_transaction"();



CREATE OR REPLACE TRIGGER "trg_normalize_payment_compat_fields" BEFORE INSERT OR UPDATE ON "public"."payments" FOR EACH ROW EXECUTE FUNCTION "public"."normalize_payment_compat_fields"();



CREATE OR REPLACE TRIGGER "trg_notify_driver_referral" AFTER UPDATE OF "status" ON "public"."driver_referrals" FOR EACH ROW EXECUTE FUNCTION "public"."trg_notify_driver_referral_change"();



CREATE OR REPLACE TRIGGER "trg_notify_rider_referral" AFTER UPDATE OF "status" ON "public"."rider_referrals" FOR EACH ROW EXECUTE FUNCTION "public"."trg_notify_rider_referral_change"();



CREATE OR REPLACE TRIGGER "trg_rider_ratings_recalc" AFTER INSERT OR DELETE OR UPDATE ON "public"."rider_ratings" FOR EACH ROW EXECUTE FUNCTION "public"."trigger_recalculate_rider_rating"();



CREATE OR REPLACE TRIGGER "trg_service_zones_audit" AFTER INSERT OR DELETE OR UPDATE ON "public"."service_zones" FOR EACH ROW EXECUTE FUNCTION "public"."service_zones_audit_trigger"();



CREATE OR REPLACE TRIGGER "trg_service_zones_updated_at" BEFORE UPDATE ON "public"."service_zones" FOR EACH ROW EXECUTE FUNCTION "public"."service_zones_set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_sync_driver_wallet_balance_columns" BEFORE INSERT OR UPDATE ON "public"."driver_wallets" FOR EACH ROW EXECUTE FUNCTION "public"."sync_driver_wallet_balance_columns"();



CREATE OR REPLACE TRIGGER "trg_sync_driver_wallet_transaction_to_payout_request" AFTER INSERT OR UPDATE OF "status", "payout_reference", "payout_method", "amount", "description" ON "public"."driver_transactions" FOR EACH ROW EXECUTE FUNCTION "public"."sync_driver_wallet_transaction_to_payout_request"();



CREATE OR REPLACE TRIGGER "trg_sync_payout_request_status_to_driver_wallet" AFTER INSERT OR UPDATE OF "status", "payout_method", "transaction_reference" ON "public"."driver_payout_requests" FOR EACH ROW EXECUTE FUNCTION "public"."sync_payout_request_status_to_driver_wallet"();



CREATE OR REPLACE TRIGGER "update_whatsapp_conversations_updated_at" BEFORE UPDATE ON "public"."whatsapp_conversations" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_whatsapp_ride_requests_updated_at" BEFORE UPDATE ON "public"."whatsapp_ride_requests" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



ALTER TABLE ONLY "public"."admin_audit_logs"
    ADD CONSTRAINT "admin_audit_logs_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "public"."admin_users"("id");



ALTER TABLE ONLY "public"."admin_audit_logs"
    ADD CONSTRAINT "admin_audit_logs_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "public"."moderation_cases"("id");



ALTER TABLE ONLY "public"."admin_payout_actions"
    ADD CONSTRAINT "admin_payout_actions_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "public"."payout_batches"("id");



ALTER TABLE ONLY "public"."admin_payout_actions"
    ADD CONSTRAINT "admin_payout_actions_payout_request_id_fkey" FOREIGN KEY ("payout_request_id") REFERENCES "public"."driver_payout_requests"("id");



ALTER TABLE ONLY "public"."admin_users"
    ADD CONSTRAINT "admin_users_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."airport_zone_queue"
    ADD CONSTRAINT "airport_zone_queue_assigned_ride_id_fkey" FOREIGN KEY ("assigned_ride_id") REFERENCES "public"."rides"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."airport_zone_queue"
    ADD CONSTRAINT "airport_zone_queue_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."airport_zone_queue"
    ADD CONSTRAINT "airport_zone_queue_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "public"."service_zones"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."audit_logs"
    ADD CONSTRAINT "audit_logs_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "public"."admin_users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cities"
    ADD CONSTRAINT "cities_country_id_fkey" FOREIGN KEY ("country_id") REFERENCES "public"."countries"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."company_commissions"
    ADD CONSTRAINT "company_commissions_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id");



ALTER TABLE ONLY "public"."company_commissions"
    ADD CONSTRAINT "company_commissions_ride_id_fkey" FOREIGN KEY ("ride_id") REFERENCES "public"."rides"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."company_transactions"
    ADD CONSTRAINT "company_transactions_ride_id_fkey" FOREIGN KEY ("ride_id") REFERENCES "public"."rides"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."customer_segments"
    ADD CONSTRAINT "customer_segments_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."admin_users"("id");



ALTER TABLE ONLY "public"."demand_event_responses"
    ADD CONSTRAINT "demand_event_responses_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."demand_event_responses"
    ADD CONSTRAINT "demand_event_responses_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."demand_events"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."demand_events"
    ADD CONSTRAINT "demand_events_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."admin_users"("id");



ALTER TABLE ONLY "public"."dispute_evidence"
    ADD CONSTRAINT "dispute_evidence_dispute_id_fkey" FOREIGN KEY ("dispute_id") REFERENCES "public"."ride_disputes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."dispute_evidence"
    ADD CONSTRAINT "dispute_evidence_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."dispute_messages"
    ADD CONSTRAINT "dispute_messages_dispute_id_fkey" FOREIGN KEY ("dispute_id") REFERENCES "public"."ride_disputes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."dispute_messages"
    ADD CONSTRAINT "dispute_messages_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."dispute_status_history"
    ADD CONSTRAINT "dispute_status_history_changed_by_fkey" FOREIGN KEY ("changed_by") REFERENCES "public"."admin_users"("id");



ALTER TABLE ONLY "public"."dispute_status_history"
    ADD CONSTRAINT "dispute_status_history_dispute_id_fkey" FOREIGN KEY ("dispute_id") REFERENCES "public"."ride_disputes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."driver_achievement_unlocks"
    ADD CONSTRAINT "driver_achievement_unlocks_achievement_id_fkey" FOREIGN KEY ("achievement_id") REFERENCES "public"."driver_achievements"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."driver_achievement_unlocks"
    ADD CONSTRAINT "driver_achievement_unlocks_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."driver_daily_earnings"
    ADD CONSTRAINT "driver_daily_earnings_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."driver_documents"
    ADD CONSTRAINT "driver_documents_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."driver_locations"
    ADD CONSTRAINT "driver_locations_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."driver_loyalty_accounts"
    ADD CONSTRAINT "driver_loyalty_accounts_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."driver_loyalty_accounts"
    ADD CONSTRAINT "driver_loyalty_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."driver_messages"
    ADD CONSTRAINT "driver_messages_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."driver_mission_progress"
    ADD CONSTRAINT "driver_mission_progress_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."driver_mission_progress"
    ADD CONSTRAINT "driver_mission_progress_mission_id_fkey" FOREIGN KEY ("mission_id") REFERENCES "public"."driver_missions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."driver_payout_methods"
    ADD CONSTRAINT "driver_payout_methods_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."driver_payout_requests"
    ADD CONSTRAINT "driver_payout_requests_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id");



ALTER TABLE ONLY "public"."driver_payout_requests"
    ADD CONSTRAINT "driver_payout_requests_payout_method_id_fkey" FOREIGN KEY ("payout_method_id") REFERENCES "public"."driver_payout_methods"("id");



ALTER TABLE ONLY "public"."driver_payout_requests"
    ADD CONSTRAINT "driver_payout_requests_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "public"."driver_wallets"("id");



ALTER TABLE ONLY "public"."driver_payouts"
    ADD CONSTRAINT "driver_payouts_ride_id_fkey" FOREIGN KEY ("ride_id") REFERENCES "public"."rides"("id");



ALTER TABLE ONLY "public"."driver_penalties"
    ADD CONSTRAINT "driver_penalties_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."driver_penalties"
    ADD CONSTRAINT "driver_penalties_refund_id_fkey" FOREIGN KEY ("refund_id") REFERENCES "public"."refunds"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."driver_penalties"
    ADD CONSTRAINT "driver_penalties_ride_id_fkey" FOREIGN KEY ("ride_id") REFERENCES "public"."rides"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."driver_performance"
    ADD CONSTRAINT "driver_performance_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."driver_referrals"
    ADD CONSTRAINT "driver_referrals_referred_driver_id_fkey" FOREIGN KEY ("referred_driver_id") REFERENCES "public"."drivers"("id");



ALTER TABLE ONLY "public"."driver_referrals"
    ADD CONSTRAINT "driver_referrals_referrer_driver_id_fkey" FOREIGN KEY ("referrer_driver_id") REFERENCES "public"."drivers"("id");



ALTER TABLE ONLY "public"."driver_referrals"
    ADD CONSTRAINT "driver_referrals_referrer_id_fkey" FOREIGN KEY ("referrer_id") REFERENCES "public"."drivers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."driver_rewards"
    ADD CONSTRAINT "driver_rewards_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."driver_rewards"
    ADD CONSTRAINT "driver_rewards_ride_id_fkey" FOREIGN KEY ("ride_id") REFERENCES "public"."rides"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."driver_safety_contacts"
    ADD CONSTRAINT "driver_safety_contacts_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."driver_wallet_transactions"
    ADD CONSTRAINT "driver_wallet_transactions_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id");



ALTER TABLE ONLY "public"."driver_wallet_transactions"
    ADD CONSTRAINT "driver_wallet_transactions_ride_id_fkey" FOREIGN KEY ("ride_id") REFERENCES "public"."rides"("id");



ALTER TABLE ONLY "public"."driver_wallet_transactions"
    ADD CONSTRAINT "driver_wallet_transactions_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "public"."driver_wallets"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."driver_wallets"
    ADD CONSTRAINT "driver_wallets_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."drivers"
    ADD CONSTRAINT "drivers_referred_by_fkey" FOREIGN KEY ("referred_by") REFERENCES "public"."drivers"("id");



ALTER TABLE ONLY "public"."drivers"
    ADD CONSTRAINT "drivers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."drivers"
    ADD CONSTRAINT "drivers_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."emergency_alerts"
    ADD CONSTRAINT "emergency_alerts_acknowledged_by_fkey" FOREIGN KEY ("acknowledged_by") REFERENCES "public"."admin_users"("id");



ALTER TABLE ONLY "public"."emergency_alerts"
    ADD CONSTRAINT "emergency_alerts_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id");



ALTER TABLE ONLY "public"."emergency_alerts"
    ADD CONSTRAINT "emergency_alerts_ride_id_fkey" FOREIGN KEY ("ride_id") REFERENCES "public"."rides"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."emergency_alerts"
    ADD CONSTRAINT "emergency_alerts_rider_id_fkey" FOREIGN KEY ("rider_id") REFERENCES "public"."riders"("id");



ALTER TABLE ONLY "public"."emergency_alerts"
    ADD CONSTRAINT "emergency_alerts_triggered_by_fkey" FOREIGN KEY ("triggered_by") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."emergency_contacts"
    ADD CONSTRAINT "emergency_contacts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."emergency_responses"
    ADD CONSTRAINT "emergency_responses_alert_id_fkey" FOREIGN KEY ("alert_id") REFERENCES "public"."emergency_alerts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."fraud_flags"
    ADD CONSTRAINT "fraud_flags_ride_id_fkey" FOREIGN KEY ("ride_id") REFERENCES "public"."rides"("id");



ALTER TABLE ONLY "public"."incident_assignments"
    ADD CONSTRAINT "incident_assignments_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "public"."safety_incidents"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."incident_evidence"
    ADD CONSTRAINT "incident_evidence_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "public"."safety_incidents"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."incident_notes"
    ADD CONSTRAINT "incident_notes_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "public"."safety_incidents"("id");



ALTER TABLE ONLY "public"."incident_status_history"
    ADD CONSTRAINT "incident_status_history_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "public"."safety_incidents"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."incident_timeline"
    ADD CONSTRAINT "incident_timeline_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "public"."safety_incidents"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."integration_logs"
    ADD CONSTRAINT "integration_logs_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "public"."integrations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."loyalty_notifications"
    ADD CONSTRAINT "loyalty_notifications_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."loyalty_notifications"
    ADD CONSTRAINT "loyalty_notifications_rider_id_fkey" FOREIGN KEY ("rider_id") REFERENCES "public"."riders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."loyalty_notifications"
    ADD CONSTRAINT "loyalty_notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."loyalty_points_transactions"
    ADD CONSTRAINT "loyalty_points_transactions_rider_id_fkey" FOREIGN KEY ("rider_id") REFERENCES "public"."riders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."marketing_banners"
    ADD CONSTRAINT "marketing_banners_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."admin_users"("id");



ALTER TABLE ONLY "public"."marketing_campaigns"
    ADD CONSTRAINT "marketing_campaigns_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."admin_users"("id");



ALTER TABLE ONLY "public"."marketing_campaigns"
    ADD CONSTRAINT "marketing_campaigns_promo_code_id_fkey" FOREIGN KEY ("promo_code_id") REFERENCES "public"."promo_codes"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."marketing_events"
    ADD CONSTRAINT "marketing_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."moderation_actions"
    ADD CONSTRAINT "moderation_actions_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "public"."admin_users"("id");



ALTER TABLE ONLY "public"."moderation_actions"
    ADD CONSTRAINT "moderation_actions_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "public"."moderation_cases"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."moderation_actions"
    ADD CONSTRAINT "moderation_actions_target_user_id_fkey" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."moderation_appeals"
    ADD CONSTRAINT "moderation_appeals_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "public"."moderation_cases"("id");



ALTER TABLE ONLY "public"."moderation_appeals"
    ADD CONSTRAINT "moderation_appeals_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "public"."admin_users"("id");



ALTER TABLE ONLY "public"."moderation_appeals"
    ADD CONSTRAINT "moderation_appeals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."moderation_cases"
    ADD CONSTRAINT "moderation_cases_assigned_admin_id_fkey" FOREIGN KEY ("assigned_admin_id") REFERENCES "public"."admin_users"("id");



ALTER TABLE ONLY "public"."moderation_cases"
    ADD CONSTRAINT "moderation_cases_reported_user_id_fkey" FOREIGN KEY ("reported_user_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."moderation_cases"
    ADD CONSTRAINT "moderation_cases_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."moderation_cases"
    ADD CONSTRAINT "moderation_cases_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "public"."rides"("id");



ALTER TABLE ONLY "public"."moderation_evidence"
    ADD CONSTRAINT "moderation_evidence_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "public"."moderation_cases"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notification_delivery_logs"
    ADD CONSTRAINT "notification_delivery_logs_notification_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "public"."push_notifications"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notification_delivery_logs"
    ADD CONSTRAINT "notification_delivery_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."payment_transactions"
    ADD CONSTRAINT "payment_transactions_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_paid_by_fkey" FOREIGN KEY ("paid_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_refunded_by_fkey" FOREIGN KEY ("refunded_by") REFERENCES "public"."admin_users"("id");



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_ride_id_fkey" FOREIGN KEY ("ride_id") REFERENCES "public"."rides"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."payout_audit_logs"
    ADD CONSTRAINT "payout_audit_logs_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "public"."payout_batches"("id");



ALTER TABLE ONLY "public"."payout_audit_logs"
    ADD CONSTRAINT "payout_audit_logs_payout_request_id_fkey" FOREIGN KEY ("payout_request_id") REFERENCES "public"."driver_payout_requests"("id");



ALTER TABLE ONLY "public"."platform_escrow"
    ADD CONSTRAINT "platform_escrow_ride_id_fkey" FOREIGN KEY ("ride_id") REFERENCES "public"."rides"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."platform_escrow"
    ADD CONSTRAINT "platform_escrow_rider_id_fkey" FOREIGN KEY ("rider_id") REFERENCES "public"."riders"("id");



ALTER TABLE ONLY "public"."platform_feature_flags"
    ADD CONSTRAINT "platform_feature_flags_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."admin_users"("id");



ALTER TABLE ONLY "public"."promo_redemptions"
    ADD CONSTRAINT "promo_redemptions_promo_id_fkey" FOREIGN KEY ("promo_id") REFERENCES "public"."promo_codes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."promo_redemptions"
    ADD CONSTRAINT "promo_redemptions_ride_id_fkey" FOREIGN KEY ("ride_id") REFERENCES "public"."rides"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."promo_redemptions"
    ADD CONSTRAINT "promo_redemptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."push_notifications"
    ADD CONSTRAINT "push_notifications_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."admin_users"("id");



ALTER TABLE ONLY "public"."ratings"
    ADD CONSTRAINT "ratings_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ratings"
    ADD CONSTRAINT "ratings_ride_id_fkey" FOREIGN KEY ("ride_id") REFERENCES "public"."rides"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ratings"
    ADD CONSTRAINT "ratings_rider_id_fkey" FOREIGN KEY ("rider_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."referral_campaigns"
    ADD CONSTRAINT "referral_campaigns_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."admin_users"("id");



ALTER TABLE ONLY "public"."referral_rewards"
    ADD CONSTRAINT "referral_rewards_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "public"."admin_users"("id");



ALTER TABLE ONLY "public"."referral_settings"
    ADD CONSTRAINT "referral_settings_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."admin_users"("id");



ALTER TABLE ONLY "public"."refund_actions"
    ADD CONSTRAINT "refund_actions_refund_id_fkey" FOREIGN KEY ("refund_id") REFERENCES "public"."refunds"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."refund_audit_logs"
    ADD CONSTRAINT "refund_audit_logs_refund_id_fkey" FOREIGN KEY ("refund_id") REFERENCES "public"."refunds"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."refunds"
    ADD CONSTRAINT "refunds_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."refunds"
    ADD CONSTRAINT "refunds_processed_by_fkey" FOREIGN KEY ("processed_by") REFERENCES "public"."admin_users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."refunds"
    ADD CONSTRAINT "refunds_ride_id_fkey" FOREIGN KEY ("ride_id") REFERENCES "public"."rides"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."refunds"
    ADD CONSTRAINT "refunds_rider_id_fkey" FOREIGN KEY ("rider_id") REFERENCES "public"."riders"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."ride_disputes"
    ADD CONSTRAINT "ride_disputes_assigned_admin_id_fkey" FOREIGN KEY ("assigned_admin_id") REFERENCES "public"."admin_users"("id");



ALTER TABLE ONLY "public"."ride_disputes"
    ADD CONSTRAINT "ride_disputes_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."ride_disputes"
    ADD CONSTRAINT "ride_disputes_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "public"."admin_users"("id");



ALTER TABLE ONLY "public"."ride_disputes"
    ADD CONSTRAINT "ride_disputes_ride_id_fkey" FOREIGN KEY ("ride_id") REFERENCES "public"."rides"("id");



ALTER TABLE ONLY "public"."ride_disputes"
    ADD CONSTRAINT "ride_disputes_rider_id_fkey" FOREIGN KEY ("rider_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."ride_events"
    ADD CONSTRAINT "ride_events_ride_id_fkey" FOREIGN KEY ("ride_id") REFERENCES "public"."rides"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ride_invoices"
    ADD CONSTRAINT "ride_invoices_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id");



ALTER TABLE ONLY "public"."ride_invoices"
    ADD CONSTRAINT "ride_invoices_ride_id_fkey" FOREIGN KEY ("ride_id") REFERENCES "public"."rides"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."ride_invoices"
    ADD CONSTRAINT "ride_invoices_rider_id_fkey" FOREIGN KEY ("rider_id") REFERENCES "public"."riders"("id");



ALTER TABLE ONLY "public"."ride_location_points"
    ADD CONSTRAINT "ride_location_points_ride_id_fkey" FOREIGN KEY ("ride_id") REFERENCES "public"."rides"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ride_messages"
    ADD CONSTRAINT "ride_messages_ride_id_fkey" FOREIGN KEY ("ride_id") REFERENCES "public"."rides"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ride_requests"
    ADD CONSTRAINT "ride_requests_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id");



ALTER TABLE ONLY "public"."ride_requests"
    ADD CONSTRAINT "ride_requests_country_id_fkey" FOREIGN KEY ("country_id") REFERENCES "public"."countries"("id");



ALTER TABLE ONLY "public"."ride_requests"
    ADD CONSTRAINT "ride_requests_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ride_requests"
    ADD CONSTRAINT "ride_requests_rider_id_fkey" FOREIGN KEY ("rider_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."ride_requests"
    ADD CONSTRAINT "ride_requests_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "public"."service_zones"("id");



ALTER TABLE ONLY "public"."ride_safety_events"
    ADD CONSTRAINT "ride_safety_events_ride_id_fkey" FOREIGN KEY ("ride_id") REFERENCES "public"."rides"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."rider_loyalty_accounts"
    ADD CONSTRAINT "rider_loyalty_accounts_rider_id_fkey" FOREIGN KEY ("rider_id") REFERENCES "public"."riders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."rider_loyalty_accounts"
    ADD CONSTRAINT "rider_loyalty_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."rider_ratings"
    ADD CONSTRAINT "rider_ratings_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."rider_ratings"
    ADD CONSTRAINT "rider_ratings_ride_id_fkey" FOREIGN KEY ("ride_id") REFERENCES "public"."rides"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."rider_ratings"
    ADD CONSTRAINT "rider_ratings_rider_id_fkey" FOREIGN KEY ("rider_id") REFERENCES "public"."riders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."rider_referrals"
    ADD CONSTRAINT "rider_referrals_referred_rider_id_fkey" FOREIGN KEY ("referred_rider_id") REFERENCES "public"."riders"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."rider_referrals"
    ADD CONSTRAINT "rider_referrals_referrer_id_fkey" FOREIGN KEY ("referrer_id") REFERENCES "public"."riders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."rider_rewards"
    ADD CONSTRAINT "rider_rewards_reward_definition_id_fkey" FOREIGN KEY ("reward_definition_id") REFERENCES "public"."reward_definitions"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."rider_rewards"
    ADD CONSTRAINT "rider_rewards_rider_id_fkey" FOREIGN KEY ("rider_id") REFERENCES "public"."riders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."rider_rewards"
    ADD CONSTRAINT "rider_rewards_used_on_ride_id_fkey" FOREIGN KEY ("used_on_ride_id") REFERENCES "public"."rides"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."rider_settings"
    ADD CONSTRAINT "rider_settings_rider_id_fkey" FOREIGN KEY ("rider_id") REFERENCES "public"."riders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."riders"
    ADD CONSTRAINT "riders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."rides"
    ADD CONSTRAINT "rides_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."ride_categories"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."rides"
    ADD CONSTRAINT "rides_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."rides"
    ADD CONSTRAINT "rides_rider_id_fkey" FOREIGN KEY ("rider_id") REFERENCES "public"."riders"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."rides"
    ADD CONSTRAINT "rides_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."role_permissions"
    ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "public"."admin_permissions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."role_permissions"
    ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "public"."admin_roles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."safety_incidents"
    ADD CONSTRAINT "safety_incidents_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id");



ALTER TABLE ONLY "public"."safety_incidents"
    ADD CONSTRAINT "safety_incidents_ride_id_fkey" FOREIGN KEY ("ride_id") REFERENCES "public"."rides"("id");



ALTER TABLE ONLY "public"."safety_incidents"
    ADD CONSTRAINT "safety_incidents_rider_id_fkey" FOREIGN KEY ("rider_id") REFERENCES "public"."riders"("id");



ALTER TABLE ONLY "public"."service_zone_audit_logs"
    ADD CONSTRAINT "service_zone_audit_logs_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "public"."service_zones"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."service_zones"
    ADD CONSTRAINT "service_zones_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."staff_invitations"
    ADD CONSTRAINT "staff_invitations_accepted_by_fkey" FOREIGN KEY ("accepted_by") REFERENCES "public"."admin_users"("id");



ALTER TABLE ONLY "public"."staff_invitations"
    ADD CONSTRAINT "staff_invitations_admin_role_id_fkey" FOREIGN KEY ("admin_role_id") REFERENCES "public"."admin_roles"("id");



ALTER TABLE ONLY "public"."staff_invitations"
    ADD CONSTRAINT "staff_invitations_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id");



ALTER TABLE ONLY "public"."staff_invitations"
    ADD CONSTRAINT "staff_invitations_country_id_fkey" FOREIGN KEY ("country_id") REFERENCES "public"."countries"("id");



ALTER TABLE ONLY "public"."staff_invitations"
    ADD CONSTRAINT "staff_invitations_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "public"."admin_users"("id");



ALTER TABLE ONLY "public"."support_chat_messages"
    ADD CONSTRAINT "support_chat_messages_chat_id_fkey" FOREIGN KEY ("chat_id") REFERENCES "public"."support_chats"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."support_tickets"
    ADD CONSTRAINT "support_tickets_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "public"."admin_users"("id");



ALTER TABLE ONLY "public"."support_tickets"
    ADD CONSTRAINT "support_tickets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."tax_records"
    ADD CONSTRAINT "tax_records_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id");



ALTER TABLE ONLY "public"."tax_records"
    ADD CONSTRAINT "tax_records_ride_id_fkey" FOREIGN KEY ("ride_id") REFERENCES "public"."rides"("id");



ALTER TABLE ONLY "public"."trip_earnings"
    ADD CONSTRAINT "trip_earnings_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id");



ALTER TABLE ONLY "public"."trip_earnings"
    ADD CONSTRAINT "trip_earnings_ride_id_fkey" FOREIGN KEY ("ride_id") REFERENCES "public"."rides"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."trip_queue"
    ADD CONSTRAINT "trip_queue_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."trip_queue"
    ADD CONSTRAINT "trip_queue_ride_id_fkey" FOREIGN KEY ("ride_id") REFERENCES "public"."rides"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_notification_tokens"
    ADD CONSTRAINT "user_notification_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_risk_scores"
    ADD CONSTRAINT "user_risk_scores_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_suspensions"
    ADD CONSTRAINT "user_suspensions_lifted_by_fkey" FOREIGN KEY ("lifted_by") REFERENCES "public"."admin_users"("id");



ALTER TABLE ONLY "public"."user_suspensions"
    ADD CONSTRAINT "user_suspensions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_country_id_fkey" FOREIGN KEY ("country_id") REFERENCES "public"."countries"("id");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "public"."user_roles"("id");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "public"."service_zones"("id");



ALTER TABLE ONLY "public"."vehicle_maintenance_records"
    ADD CONSTRAINT "vehicle_maintenance_records_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vehicles"
    ADD CONSTRAINT "vehicles_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."wallet_transactions"
    ADD CONSTRAINT "wallet_transactions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."admin_users"("id");



ALTER TABLE ONLY "public"."wallet_transactions"
    ADD CONSTRAINT "wallet_transactions_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."wallets"
    ADD CONSTRAINT "wallets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."weafrica_places"
    ADD CONSTRAINT "weafrica_places_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id");



ALTER TABLE ONLY "public"."weafrica_places"
    ADD CONSTRAINT "weafrica_places_country_id_fkey" FOREIGN KEY ("country_id") REFERENCES "public"."countries"("id");



ALTER TABLE ONLY "public"."weafrica_places"
    ADD CONSTRAINT "weafrica_places_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "public"."service_zones"("id");



ALTER TABLE ONLY "public"."webhook_events"
    ADD CONSTRAINT "webhook_events_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "public"."integrations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."whatsapp_ride_requests"
    ADD CONSTRAINT "whatsapp_ride_requests_linked_ride_id_fkey" FOREIGN KEY ("linked_ride_id") REFERENCES "public"."rides"("id") ON DELETE SET NULL;



CREATE POLICY "Admins can access admin permissions" ON "public"."admin_permissions" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "au"
  WHERE (("au"."user_id" = "auth"."uid"()) AND ("au"."is_active" = true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "au"
  WHERE (("au"."user_id" = "auth"."uid"()) AND ("au"."is_active" = true)))));



CREATE POLICY "Admins can access audit logs" ON "public"."audit_logs" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "au"
  WHERE (("au"."user_id" = "auth"."uid"()) AND ("au"."is_active" = true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "au"
  WHERE (("au"."user_id" = "auth"."uid"()) AND ("au"."is_active" = true)))));



CREATE POLICY "Admins can manage admin roles" ON "public"."admin_roles" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "au"
  WHERE (("au"."user_id" = "auth"."uid"()) AND ("au"."is_active" = true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "au"
  WHERE (("au"."user_id" = "auth"."uid"()) AND ("au"."is_active" = true)))));



CREATE POLICY "Admins can manage driver achievements" ON "public"."driver_achievements" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "au"
  WHERE (("au"."user_id" = "auth"."uid"()) AND ("au"."is_active" = true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "au"
  WHERE (("au"."user_id" = "auth"."uid"()) AND ("au"."is_active" = true)))));



CREATE POLICY "Admins can manage driver daily earnings" ON "public"."driver_daily_earnings" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "au"
  WHERE (("au"."user_id" = "auth"."uid"()) AND ("au"."is_active" = true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "au"
  WHERE (("au"."user_id" = "auth"."uid"()) AND ("au"."is_active" = true)))));



CREATE POLICY "Admins can manage driver messages" ON "public"."driver_messages" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "au"
  WHERE (("au"."user_id" = "auth"."uid"()) AND ("au"."is_active" = true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "au"
  WHERE (("au"."user_id" = "auth"."uid"()) AND ("au"."is_active" = true)))));



CREATE POLICY "Admins can manage driver payouts" ON "public"."driver_payouts" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "au"
  WHERE (("au"."user_id" = "auth"."uid"()) AND ("au"."is_active" = true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "au"
  WHERE (("au"."user_id" = "auth"."uid"()) AND ("au"."is_active" = true)))));



CREATE POLICY "Admins can manage ride categories" ON "public"."ride_categories" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "au"
  WHERE (("au"."user_id" = "auth"."uid"()) AND ("au"."is_active" = true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "au"
  WHERE (("au"."user_id" = "auth"."uid"()) AND ("au"."is_active" = true)))));



CREATE POLICY "Admins can manage riders" ON "public"."riders" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "au"
  WHERE (("au"."user_id" = "auth"."uid"()) AND ("au"."is_active" = true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "au"
  WHERE (("au"."user_id" = "auth"."uid"()) AND ("au"."is_active" = true)))));



CREATE POLICY "Admins can manage role permissions" ON "public"."role_permissions" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "au"
  WHERE (("au"."user_id" = "auth"."uid"()) AND ("au"."is_active" = true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "au"
  WHERE (("au"."user_id" = "auth"."uid"()) AND ("au"."is_active" = true)))));



CREATE POLICY "Admins can manage staff invitations" ON "public"."staff_invitations" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "au"
  WHERE (("au"."user_id" = "auth"."uid"()) AND ("au"."is_active" = true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "au"
  WHERE (("au"."user_id" = "auth"."uid"()) AND ("au"."is_active" = true)))));



CREATE POLICY "Admins can manage user roles" ON "public"."user_roles" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "au"
  WHERE (("au"."user_id" = "auth"."uid"()) AND ("au"."is_active" = true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "au"
  WHERE (("au"."user_id" = "auth"."uid"()) AND ("au"."is_active" = true)))));



CREATE POLICY "Admins full access on admin_audit_logs" ON "public"."admin_audit_logs" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true)))));



CREATE POLICY "Admins full access on customer_segments" ON "public"."customer_segments" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true)))));



CREATE POLICY "Admins full access on dispute_evidence" ON "public"."dispute_evidence" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true)))));



CREATE POLICY "Admins full access on dispute_messages" ON "public"."dispute_messages" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true)))));



CREATE POLICY "Admins full access on dispute_status_history" ON "public"."dispute_status_history" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true)))));



CREATE POLICY "Admins full access on driver_referrals" ON "public"."driver_referrals" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true)))));



CREATE POLICY "Admins full access on integration_logs" ON "public"."integration_logs" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true)))));



CREATE POLICY "Admins full access on integrations" ON "public"."integrations" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true)))));



CREATE POLICY "Admins full access on loyalty_tiers" ON "public"."loyalty_tiers" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true)))));



CREATE POLICY "Admins full access on marketing_campaigns" ON "public"."marketing_campaigns" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true)))));



CREATE POLICY "Admins full access on marketing_events" ON "public"."marketing_events" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true)))));



CREATE POLICY "Admins full access on moderation_actions" ON "public"."moderation_actions" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true)))));



CREATE POLICY "Admins full access on moderation_appeals" ON "public"."moderation_appeals" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true)))));



CREATE POLICY "Admins full access on moderation_cases" ON "public"."moderation_cases" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true)))));



CREATE POLICY "Admins full access on moderation_evidence" ON "public"."moderation_evidence" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true)))));



CREATE POLICY "Admins full access on notification_delivery_logs" ON "public"."notification_delivery_logs" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true)))));



CREATE POLICY "Admins full access on platform_feature_flags" ON "public"."platform_feature_flags" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true)))));



CREATE POLICY "Admins full access on push_notifications" ON "public"."push_notifications" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true)))));



CREATE POLICY "Admins full access on referral_campaigns" ON "public"."referral_campaigns" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true)))));



CREATE POLICY "Admins full access on referral_events" ON "public"."referral_events" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true)))));



CREATE POLICY "Admins full access on referral_fraud_checks" ON "public"."referral_fraud_checks" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true)))));



CREATE POLICY "Admins full access on referral_rewards" ON "public"."referral_rewards" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true)))));



CREATE POLICY "Admins full access on referral_settings" ON "public"."referral_settings" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true)))));



CREATE POLICY "Admins full access on ride_disputes" ON "public"."ride_disputes" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true)))));



CREATE POLICY "Admins full access on rider_referrals" ON "public"."rider_referrals" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true)))));



CREATE POLICY "Admins full access on safety_incidents" ON "public"."safety_incidents" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true)))));



CREATE POLICY "Admins full access on user_notification_tokens" ON "public"."user_notification_tokens" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true)))));



CREATE POLICY "Admins full access on user_risk_scores" ON "public"."user_risk_scores" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true)))));



CREATE POLICY "Admins full access on user_suspensions" ON "public"."user_suspensions" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true)))));



CREATE POLICY "Admins full access on webhook_events" ON "public"."webhook_events" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true)))));



CREATE POLICY "Admins review documents" ON "public"."driver_documents" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE ("admin_users"."user_id" = ( SELECT "auth"."uid"() AS "uid"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE ("admin_users"."user_id" = ( SELECT "auth"."uid"() AS "uid")))));



CREATE POLICY "Allow admin dashboard demand events" ON "public"."demand_events" TO "authenticated", "anon" USING (true) WITH CHECK (true);



CREATE POLICY "Allow admin dashboard vehicle maintenance" ON "public"."vehicle_maintenance_records" TO "authenticated", "anon" USING (true) WITH CHECK (true);



CREATE POLICY "Allow driver wallets insert" ON "public"."driver_wallets" FOR INSERT TO "authenticated", "anon" WITH CHECK (true);



CREATE POLICY "Allow driver wallets select" ON "public"."driver_wallets" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "Allow driver wallets update" ON "public"."driver_wallets" FOR UPDATE TO "authenticated", "anon" USING (true) WITH CHECK (true);



CREATE POLICY "Anon read active loyalty tiers" ON "public"."loyalty_tiers" FOR SELECT TO "anon" USING (("is_active" = true));



CREATE POLICY "Anon read active marketing banners" ON "public"."marketing_banners" FOR SELECT TO "anon" USING (("is_active" = true));



CREATE POLICY "Anyone can read active places" ON "public"."weafrica_places" FOR SELECT USING (("is_active" = true));



CREATE POLICY "Anyone read active campaigns" ON "public"."referral_campaigns" FOR SELECT TO "authenticated" USING (("is_active" = true));



CREATE POLICY "Authenticated full access on marketing_banners" ON "public"."marketing_banners" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Authenticated read active loyalty tiers" ON "public"."loyalty_tiers" FOR SELECT TO "authenticated" USING (("is_active" = true));



CREATE POLICY "Authenticated read active marketing banners" ON "public"."marketing_banners" FOR SELECT TO "authenticated" USING (("is_active" = true));



CREATE POLICY "Authenticated users can manage promo codes" ON "public"."promo_codes" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Authenticated users can read active promo codes" ON "public"."promo_codes" FOR SELECT TO "authenticated" USING (("status" = 'active'::"text"));



CREATE POLICY "Authenticated users can view driver achievements" ON "public"."driver_achievements" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Authenticated users can view ride categories" ON "public"."ride_categories" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Authenticated users can view role permissions" ON "public"."role_permissions" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Authenticated users can view user roles" ON "public"."user_roles" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Drivers can manage own location" ON "public"."driver_locations" USING (true) WITH CHECK (true);



CREATE POLICY "Drivers can rate riders on completed trips" ON "public"."rider_ratings" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."rides"
  WHERE (("rides"."id" = "rider_ratings"."ride_id") AND ("rides"."driver_id" IN ( SELECT "drivers"."id"
           FROM "public"."drivers"
          WHERE ("drivers"."user_id" = "auth"."uid"()))) AND ("rides"."status" = ANY (ARRAY['completed'::"text", 'cancelled'::"text", 'driver_cancelled'::"text", 'rider_cancelled'::"text"]))))));



CREATE POLICY "Drivers can read own transactions" ON "public"."driver_transactions" FOR SELECT USING (true);



CREATE POLICY "Drivers can update own messages" ON "public"."driver_messages" FOR UPDATE TO "authenticated" USING (("driver_id" = "auth"."uid"())) WITH CHECK (("driver_id" = "auth"."uid"()));



CREATE POLICY "Drivers can view own daily earnings" ON "public"."driver_daily_earnings" FOR SELECT TO "authenticated" USING (("driver_id" = "auth"."uid"()));



CREATE POLICY "Drivers can view own messages" ON "public"."driver_messages" FOR SELECT TO "authenticated" USING (("driver_id" = "auth"."uid"()));



CREATE POLICY "Drivers can view own payouts" ON "public"."driver_payouts" FOR SELECT TO "authenticated" USING (("driver_id" = "auth"."uid"()));



CREATE POLICY "Drivers read own referrals" ON "public"."driver_referrals" FOR SELECT TO "authenticated" USING (("referrer_id" IN ( SELECT "drivers"."id"
   FROM "public"."drivers"
  WHERE ("drivers"."user_id" = "auth"."uid"()))));



CREATE POLICY "Drivers read own rewards" ON "public"."referral_rewards" FOR SELECT TO "authenticated" USING (("recipient_id" IN ( SELECT "drivers"."id"
   FROM "public"."drivers"
  WHERE ("drivers"."user_id" = "auth"."uid"()))));



CREATE POLICY "Drivers view own documents" ON "public"."driver_documents" FOR SELECT USING (((EXISTS ( SELECT 1
   FROM "public"."drivers"
  WHERE (("drivers"."id" = "driver_documents"."driver_id") AND ("drivers"."firebase_uid" = ( SELECT ("auth"."uid"())::"text" AS "uid"))))) OR (EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE ("admin_users"."user_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "Public admin delete marketing banners" ON "public"."marketing_banners" FOR DELETE TO "anon" USING (true);



CREATE POLICY "Public admin insert marketing banners" ON "public"."marketing_banners" FOR INSERT TO "anon" WITH CHECK (true);



CREATE POLICY "Public admin update marketing banners" ON "public"."marketing_banners" FOR UPDATE TO "anon" USING (true) WITH CHECK (true);



CREATE POLICY "Riders can create own profile" ON "public"."riders" FOR INSERT TO "authenticated" WITH CHECK (("id" = "auth"."uid"()));



CREATE POLICY "Riders can update own profile" ON "public"."riders" FOR UPDATE TO "authenticated" USING (("id" = "auth"."uid"())) WITH CHECK (("id" = "auth"."uid"()));



CREATE POLICY "Riders can view own profile" ON "public"."riders" FOR SELECT TO "authenticated" USING (("id" = "auth"."uid"()));



CREATE POLICY "Riders can view their own ratings" ON "public"."rider_ratings" FOR SELECT USING ((("auth"."uid"())::"text" IN ( SELECT "riders"."firebase_uid"
   FROM "public"."riders"
  WHERE ("riders"."id" = "rider_ratings"."rider_id"))));



CREATE POLICY "Riders read own referrals" ON "public"."rider_referrals" FOR SELECT TO "authenticated" USING (("referrer_id" IN ( SELECT "riders"."id"
   FROM "public"."riders"
  WHERE ("riders"."user_id" = "auth"."uid"()))));



CREATE POLICY "Riders read own rewards" ON "public"."referral_rewards" FOR SELECT TO "authenticated" USING (("recipient_id" IN ( SELECT "riders"."id"
   FROM "public"."riders"
  WHERE ("riders"."user_id" = "auth"."uid"()))));



CREATE POLICY "Service role can manage notifications" ON "public"."notifications" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "Service role full access on whatsapp_conversations" ON "public"."whatsapp_conversations" USING (true) WITH CHECK (true);



CREATE POLICY "Service role full access on whatsapp_ride_requests" ON "public"."whatsapp_ride_requests" USING (true) WITH CHECK (true);



CREATE POLICY "Service role manages documents" ON "public"."driver_documents" USING (true) WITH CHECK (true);



CREATE POLICY "Users can read feature flags" ON "public"."platform_feature_flags" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Users can read own notifications" ON "public"."notifications" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can update own notifications" ON "public"."notifications" FOR UPDATE TO "authenticated" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "Users view own tokens" ON "public"."user_notification_tokens" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "admin can insert operator rides" ON "public"."rides" FOR INSERT WITH CHECK (true);



CREATE POLICY "admin can update operator rides" ON "public"."rides" FOR UPDATE USING (true) WITH CHECK (true);



CREATE POLICY "admin_all_admin_payout_actions" ON "public"."admin_payout_actions" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true)))));



CREATE POLICY "admin_all_admin_permissions" ON "public"."admin_permissions" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true)))));



CREATE POLICY "admin_all_admin_roles" ON "public"."admin_roles" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true)))));



CREATE POLICY "admin_all_audit_logs" ON "public"."audit_logs" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true)))));



CREATE POLICY "admin_all_commission_configs" ON "public"."commission_configs" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true)))));



CREATE POLICY "admin_all_company_commissions" ON "public"."company_commissions" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true)))));



CREATE POLICY "admin_all_demand_event_responses" ON "public"."demand_event_responses" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true)))));



CREATE POLICY "admin_all_demand_events" ON "public"."demand_events" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true)))));



CREATE POLICY "admin_all_driver_achievement_unlocks" ON "public"."driver_achievement_unlocks" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true)))));



CREATE POLICY "admin_all_driver_achievements" ON "public"."driver_achievements" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true)))));



CREATE POLICY "admin_all_driver_daily_earnings" ON "public"."driver_daily_earnings" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true)))));



CREATE POLICY "admin_all_driver_incentives" ON "public"."pricing_driver_incentives" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true)))));



CREATE POLICY "admin_all_driver_locations" ON "public"."driver_locations" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true)))));



CREATE POLICY "admin_all_driver_messages" ON "public"."driver_messages" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true)))));



CREATE POLICY "admin_all_driver_mission_progress" ON "public"."driver_mission_progress" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true)))));



CREATE POLICY "admin_all_driver_missions" ON "public"."driver_missions" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true)))));



CREATE POLICY "admin_all_driver_payout_methods" ON "public"."driver_payout_methods" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true)))));



CREATE POLICY "admin_all_driver_payout_requests" ON "public"."driver_payout_requests" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true)))));



CREATE POLICY "admin_all_driver_payouts" ON "public"."driver_payouts" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true)))));



CREATE POLICY "admin_all_driver_penalties" ON "public"."driver_penalties" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true)))));



CREATE POLICY "admin_all_driver_performance" ON "public"."driver_performance" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true)))));



CREATE POLICY "admin_all_driver_safety_contacts" ON "public"."driver_safety_contacts" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true)))));



CREATE POLICY "admin_all_driver_settings" ON "public"."driver_settings" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true)))));



CREATE POLICY "admin_all_driver_transactions" ON "public"."driver_transactions" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true)))));



CREATE POLICY "admin_all_driver_wallet_transactions" ON "public"."driver_wallet_transactions" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true)))));



CREATE POLICY "admin_all_driver_wallets" ON "public"."driver_wallets" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true)))));



CREATE POLICY "admin_all_emergency_alerts" ON "public"."emergency_alerts" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true)))));



CREATE POLICY "admin_all_emergency_contacts" ON "public"."emergency_contacts" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true)))));



CREATE POLICY "admin_all_emergency_responses" ON "public"."emergency_responses" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true)))));



CREATE POLICY "admin_all_fare_estimation_logs" ON "public"."fare_estimation_logs" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "au"
  WHERE ("au"."user_id" = "auth"."uid"())))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "au"
  WHERE ("au"."user_id" = "auth"."uid"()))));



CREATE POLICY "admin_all_fraud_protection_rules" ON "public"."fraud_protection_rules" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true)))));



CREATE POLICY "admin_all_incident_assignments" ON "public"."incident_assignments" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true)))));



CREATE POLICY "admin_all_incident_evidence" ON "public"."incident_evidence" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true)))));



CREATE POLICY "admin_all_incident_status_history" ON "public"."incident_status_history" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true)))));



CREATE POLICY "admin_all_incident_timeline" ON "public"."incident_timeline" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true)))));



CREATE POLICY "admin_all_payment_transactions" ON "public"."payment_transactions" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true)))));



CREATE POLICY "admin_all_payments" ON "public"."payments" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true)))));



CREATE POLICY "admin_all_payout_audit_logs" ON "public"."payout_audit_logs" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true)))));



CREATE POLICY "admin_all_payout_batches" ON "public"."payout_batches" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true)))));



CREATE POLICY "admin_all_payout_settings" ON "public"."payout_settings" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true)))));



CREATE POLICY "admin_all_pricing_config" ON "public"."pricing_config" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true)))));



CREATE POLICY "admin_all_promo_codes" ON "public"."promo_codes" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true)))));



CREATE POLICY "admin_all_redemptions" ON "public"."promo_redemptions" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true)))));



CREATE POLICY "admin_all_refund_actions" ON "public"."refund_actions" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true)))));



CREATE POLICY "admin_all_refund_audit_logs" ON "public"."refund_audit_logs" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true)))));



CREATE POLICY "admin_all_refunds" ON "public"."refunds" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true)))));



CREATE POLICY "admin_all_ride_categories" ON "public"."ride_categories" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true)))));



CREATE POLICY "admin_all_ride_events" ON "public"."ride_events" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true)))));



CREATE POLICY "admin_all_ride_location_points" ON "public"."ride_location_points" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true)))));



CREATE POLICY "admin_all_ride_safety_events" ON "public"."ride_safety_events" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true)))));



CREATE POLICY "admin_all_role_permissions" ON "public"."role_permissions" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true)))));



CREATE POLICY "admin_all_staff_invitations" ON "public"."staff_invitations" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true)))));



CREATE POLICY "admin_all_support_tickets" ON "public"."support_tickets" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true)))));



CREATE POLICY "admin_all_surge_rules" ON "public"."pricing_surge_rules" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true)))));



CREATE POLICY "admin_all_tax_configs" ON "public"."tax_configs" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true)))));



CREATE POLICY "admin_all_tax_records" ON "public"."tax_records" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true)))));



CREATE POLICY "admin_all_trip_earnings" ON "public"."trip_earnings" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true)))));



CREATE POLICY "admin_all_user_roles" ON "public"."user_roles" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true)))));



CREATE POLICY "admin_all_wallets" ON "public"."wallets" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true)))));



CREATE POLICY "admin_all_weafrica_places" ON "public"."weafrica_places" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."user_id" = "auth"."uid"()) AND ("admin_users"."is_active" = true)))));



ALTER TABLE "public"."admin_audit_logs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "admin_insert_settings_audit" ON "public"."admin_settings_audit_logs" FOR INSERT WITH CHECK (true);



ALTER TABLE "public"."admin_payout_actions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."admin_permissions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "admin_permissions_anon_read" ON "public"."admin_permissions" FOR SELECT TO "anon" USING (true);



CREATE POLICY "admin_read_settings" ON "public"."app_settings" FOR SELECT USING (true);



CREATE POLICY "admin_read_settings_audit" ON "public"."admin_settings_audit_logs" FOR SELECT USING (true);



ALTER TABLE "public"."admin_roles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "admin_roles_anon_read" ON "public"."admin_roles" FOR SELECT TO "anon" USING (true);



ALTER TABLE "public"."admin_settings_audit_logs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "admin_update_settings" ON "public"."app_settings" FOR UPDATE USING (true);



ALTER TABLE "public"."admin_users" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "admin_users_anon_read" ON "public"."admin_users" FOR SELECT TO "anon" USING (true);



ALTER TABLE "public"."airport_zone_queue" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "airport_zone_queue_admin_all" ON "public"."airport_zone_queue" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "au"
  WHERE (("au"."user_id" = "auth"."uid"()) AND (COALESCE("au"."is_active", true) = true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "au"
  WHERE (("au"."user_id" = "auth"."uid"()) AND (COALESCE("au"."is_active", true) = true)))));



CREATE POLICY "airport_zone_queue_driver_read" ON "public"."airport_zone_queue" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."drivers" "d"
  WHERE (("d"."id" = "airport_zone_queue"."driver_id") AND ("d"."user_id" = "auth"."uid"())))));



CREATE POLICY "allow driver wallets all" ON "public"."driver_wallets" TO "authenticated", "anon" USING (true) WITH CHECK (true);



CREATE POLICY "allow drivers all" ON "public"."drivers" TO "authenticated", "anon" USING (true) WITH CHECK (true);



CREATE POLICY "allow users all" ON "public"."users" TO "authenticated", "anon" USING (true) WITH CHECK (true);



CREATE POLICY "allow vehicles all" ON "public"."vehicles" TO "authenticated", "anon" USING (true) WITH CHECK (true);



CREATE POLICY "anon_all_cities" ON "public"."cities" TO "anon" USING (true) WITH CHECK (true);



CREATE POLICY "anon_all_countries" ON "public"."countries" TO "anon" USING (true) WITH CHECK (true);



CREATE POLICY "anon_all_driver_locations" ON "public"."driver_locations" TO "anon" USING (true) WITH CHECK (true);



CREATE POLICY "anon_all_vehicles" ON "public"."vehicles" TO "anon" USING (true) WITH CHECK (true);



CREATE POLICY "anon_driver_loyalty_all" ON "public"."driver_loyalty_accounts" USING (true) WITH CHECK (true);



CREATE POLICY "anon_driver_rewards_all" ON "public"."driver_rewards" USING (true) WITH CHECK (true);



CREATE POLICY "anon_escrow_all" ON "public"."platform_escrow" USING (true) WITH CHECK (true);



CREATE POLICY "anon_fraud_flags_all" ON "public"."fraud_flags" USING (true) WITH CHECK (true);



CREATE POLICY "anon_insert_demand_event_responses" ON "public"."demand_event_responses" FOR INSERT WITH CHECK (true);



CREATE POLICY "anon_insert_driver_transactions" ON "public"."driver_transactions" FOR INSERT WITH CHECK (true);



CREATE POLICY "anon_insert_payments" ON "public"."payments" FOR INSERT WITH CHECK (true);



CREATE POLICY "anon_invoices_all" ON "public"."ride_invoices" USING (true) WITH CHECK (true);



CREATE POLICY "anon_loyalty_notifications_all" ON "public"."loyalty_notifications" USING (true) WITH CHECK (true);



CREATE POLICY "anon_loyalty_points_all" ON "public"."loyalty_points_transactions" USING (true) WITH CHECK (true);



CREATE POLICY "anon_loyalty_tier_config_select" ON "public"."loyalty_tier_config" FOR SELECT USING (true);



CREATE POLICY "anon_payments_all" ON "public"."payments" USING (true) WITH CHECK (true);



CREATE POLICY "anon_read_demand_event_responses" ON "public"."demand_event_responses" FOR SELECT USING (true);



CREATE POLICY "anon_read_demand_events" ON "public"."demand_events" FOR SELECT USING (("is_active" = true));



CREATE POLICY "anon_read_driver_payout_requests" ON "public"."driver_payout_requests" FOR SELECT USING (true);



CREATE POLICY "anon_read_ownish_payments" ON "public"."payments" FOR SELECT USING (true);



CREATE POLICY "anon_reward_definitions_select" ON "public"."reward_definitions" FOR SELECT USING (true);



CREATE POLICY "anon_rider_loyalty_accounts_all" ON "public"."rider_loyalty_accounts" USING (true) WITH CHECK (true);



CREATE POLICY "anon_rider_rewards_all" ON "public"."rider_rewards" USING (true) WITH CHECK (true);



CREATE POLICY "anon_update_demand_event_responses" ON "public"."demand_event_responses" FOR UPDATE USING (true) WITH CHECK (true);



CREATE POLICY "anon_update_driver_wallets" ON "public"."driver_wallets" FOR UPDATE USING (true) WITH CHECK (true);



CREATE POLICY "anon_wallet_transactions_all" ON "public"."wallet_transactions" USING (true) WITH CHECK (true);



CREATE POLICY "anon_wallets_all" ON "public"."wallets" USING (true) WITH CHECK (true);



ALTER TABLE "public"."app_settings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."audit_logs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "authenticated_insert_ride_location_points" ON "public"."ride_location_points" FOR INSERT WITH CHECK (("auth"."uid"() IS NOT NULL));



CREATE POLICY "authenticated_select_ride_location_points" ON "public"."ride_location_points" FOR SELECT USING (true);



ALTER TABLE "public"."cities" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."commission_configs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."commission_rules" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."company_commissions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."company_transactions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."countries" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."customer_segments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."demand_event_responses" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."demand_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."dispatch_queue" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."dispute_evidence" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."dispute_messages" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."dispute_status_history" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."driver_achievement_unlocks" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."driver_achievements" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."driver_applications" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."driver_daily_earnings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."driver_documents" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."driver_locations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."driver_loyalty_accounts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."driver_messages" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."driver_mission_progress" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."driver_missions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "driver_missions_delete_all" ON "public"."driver_missions" FOR DELETE TO "authenticated", "anon" USING (true);



CREATE POLICY "driver_missions_insert_all" ON "public"."driver_missions" FOR INSERT TO "authenticated", "anon" WITH CHECK (true);



CREATE POLICY "driver_missions_select_all" ON "public"."driver_missions" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "driver_missions_update_all" ON "public"."driver_missions" FOR UPDATE TO "authenticated", "anon" USING (true) WITH CHECK (true);



CREATE POLICY "driver_own_achievement_unlocks" ON "public"."driver_achievement_unlocks" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."drivers" "d"
  WHERE (("d"."id" = "driver_achievement_unlocks"."driver_id") AND ("d"."firebase_uid" = ("auth"."uid"())::"text")))));



CREATE POLICY "driver_own_admin_payout_actions" ON "public"."admin_payout_actions" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."drivers" "d"
  WHERE ("d"."user_id" = "auth"."uid"()))));



CREATE POLICY "driver_own_company_commissions" ON "public"."company_commissions" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."drivers" "d"
  WHERE ("d"."user_id" = "auth"."uid"()))));



CREATE POLICY "driver_own_driver_payout_methods" ON "public"."driver_payout_methods" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."drivers" "d"
  WHERE ("d"."user_id" = "auth"."uid"()))));



CREATE POLICY "driver_own_driver_payout_requests" ON "public"."driver_payout_requests" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."drivers" "d"
  WHERE ("d"."user_id" = "auth"."uid"()))));



CREATE POLICY "driver_own_driver_wallet_transactions" ON "public"."driver_wallet_transactions" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."drivers" "d"
  WHERE ("d"."user_id" = "auth"."uid"()))));



CREATE POLICY "driver_own_driver_wallets" ON "public"."driver_wallets" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."drivers" "d"
  WHERE ("d"."user_id" = "auth"."uid"()))));



CREATE POLICY "driver_own_location" ON "public"."driver_locations" USING (("firebase_uid" = ("auth"."uid"())::"text"));



CREATE POLICY "driver_own_mission_progress" ON "public"."driver_mission_progress" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."drivers" "d"
  WHERE (("d"."id" = "driver_mission_progress"."driver_id") AND ("d"."firebase_uid" = ("auth"."uid"())::"text")))));



CREATE POLICY "driver_own_payout_audit_logs" ON "public"."payout_audit_logs" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."drivers" "d"
  WHERE ("d"."user_id" = "auth"."uid"()))));



CREATE POLICY "driver_own_payout_batches" ON "public"."payout_batches" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."drivers" "d"
  WHERE ("d"."user_id" = "auth"."uid"()))));



CREATE POLICY "driver_own_payout_settings" ON "public"."payout_settings" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."drivers" "d"
  WHERE ("d"."user_id" = "auth"."uid"()))));



CREATE POLICY "driver_own_performance" ON "public"."driver_performance" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."drivers" "d"
  WHERE (("d"."id" = "driver_performance"."driver_id") AND ("d"."firebase_uid" = ("auth"."uid"())::"text")))));



CREATE POLICY "driver_own_safety_contacts" ON "public"."driver_safety_contacts" USING ((EXISTS ( SELECT 1
   FROM "public"."drivers" "d"
  WHERE (("d"."id" = "driver_safety_contacts"."driver_id") AND ("d"."firebase_uid" = ("auth"."uid"())::"text")))));



CREATE POLICY "driver_own_settings" ON "public"."driver_settings" USING ((EXISTS ( SELECT 1
   FROM "public"."drivers" "d"
  WHERE (("d"."id" = "driver_settings"."driver_id") AND ("d"."firebase_uid" = ("auth"."uid"())::"text")))));



CREATE POLICY "driver_own_tax_records" ON "public"."tax_records" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."drivers" "d"
  WHERE ("d"."user_id" = "auth"."uid"()))));



CREATE POLICY "driver_own_transactions" ON "public"."driver_transactions" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."drivers" "d"
  WHERE (("d"."id" = "driver_transactions"."driver_id") AND ("d"."firebase_uid" = ("auth"."uid"())::"text")))));



CREATE POLICY "driver_own_trip_earnings" ON "public"."trip_earnings" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."drivers" "d"
  WHERE ("d"."user_id" = "auth"."uid"()))));



CREATE POLICY "driver_own_wallet" ON "public"."wallets" FOR SELECT USING (("user_id" = "auth"."uid"()));



CREATE POLICY "driver_own_wallets" ON "public"."driver_wallets" USING (("firebase_uid" = ("auth"."uid"())::"text"));



ALTER TABLE "public"."driver_payout_methods" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."driver_payout_requests" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."driver_payouts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."driver_penalties" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."driver_performance" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "driver_read_incentives" ON "public"."pricing_driver_incentives" FOR SELECT USING (true);



ALTER TABLE "public"."driver_referrals" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."driver_rewards" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."driver_safety_contacts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."driver_settings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."driver_transactions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."driver_wallet_transactions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."driver_wallets" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."drivers" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "drivers can insert own settings" ON "public"."driver_settings" FOR INSERT WITH CHECK (true);



CREATE POLICY "drivers can select own settings" ON "public"."driver_settings" FOR SELECT USING (true);



CREATE POLICY "drivers can update own settings" ON "public"."driver_settings" FOR UPDATE USING (true) WITH CHECK (true);



CREATE POLICY "drivers: allow insert" ON "public"."drivers" FOR INSERT WITH CHECK (true);



CREATE POLICY "drivers: allow select" ON "public"."drivers" FOR SELECT USING (true);



CREATE POLICY "drivers: allow update" ON "public"."drivers" FOR UPDATE USING (true) WITH CHECK (true);



CREATE POLICY "drivers_delete_own_settings" ON "public"."driver_settings" FOR DELETE TO "authenticated" USING (true);



CREATE POLICY "drivers_insert_own_settings" ON "public"."driver_settings" FOR INSERT TO "authenticated", "anon" WITH CHECK (true);



CREATE POLICY "drivers_select_own_settings" ON "public"."driver_settings" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "drivers_update_own_settings" ON "public"."driver_settings" FOR UPDATE TO "authenticated", "anon" USING (true) WITH CHECK (true);



ALTER TABLE "public"."emergency_alerts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."emergency_contacts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."emergency_responses" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."fare_estimation_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."fraud_flags" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."fraud_protection_rules" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."incident_assignments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."incident_evidence" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."incident_notes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."incident_status_history" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."incident_timeline" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."incidents" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."integration_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."integrations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."loyalty_notifications" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."loyalty_points_transactions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."loyalty_tier_config" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."loyalty_tiers" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."marketing_banners" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."marketing_campaigns" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."marketing_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."moderation_actions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."moderation_appeals" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."moderation_cases" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."moderation_evidence" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."notification_delivery_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."notifications" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."payment_transactions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."payments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."payout_audit_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."payout_batches" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."payout_settings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."places" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."platform_escrow" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."platform_feature_flags" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pricing_config" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pricing_driver_incentives" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pricing_surge_rules" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."promo_codes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."promo_redemptions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."promotions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "public_delete_promotions" ON "public"."promotions" FOR DELETE USING (true);



CREATE POLICY "public_insert_promotions" ON "public"."promotions" FOR INSERT WITH CHECK (true);



CREATE POLICY "public_read_admin_payout_actions" ON "public"."admin_payout_actions" FOR SELECT USING (true);



CREATE POLICY "public_read_commission_configs" ON "public"."commission_configs" FOR SELECT USING (true);



CREATE POLICY "public_read_company_commissions" ON "public"."company_commissions" FOR SELECT USING (true);



CREATE POLICY "public_read_driver_achievements" ON "public"."driver_achievements" FOR SELECT USING (true);



CREATE POLICY "public_read_driver_daily_earnings" ON "public"."driver_daily_earnings" FOR SELECT USING (true);



CREATE POLICY "public_read_driver_messages" ON "public"."driver_messages" FOR SELECT USING (true);



CREATE POLICY "public_read_driver_missions" ON "public"."driver_missions" FOR SELECT USING (true);



CREATE POLICY "public_read_driver_payout_methods" ON "public"."driver_payout_methods" FOR SELECT USING (true);



CREATE POLICY "public_read_driver_payout_requests" ON "public"."driver_payout_requests" FOR SELECT USING (true);



CREATE POLICY "public_read_driver_payouts" ON "public"."driver_payouts" FOR SELECT USING (true);



CREATE POLICY "public_read_driver_penalties" ON "public"."driver_penalties" FOR SELECT USING (true);



CREATE POLICY "public_read_driver_wallet_transactions" ON "public"."driver_wallet_transactions" FOR SELECT USING (true);



CREATE POLICY "public_read_driver_wallets" ON "public"."driver_wallets" FOR SELECT USING (true);



CREATE POLICY "public_read_emergency_alerts" ON "public"."emergency_alerts" FOR SELECT USING (true);



CREATE POLICY "public_read_emergency_contacts" ON "public"."emergency_contacts" FOR SELECT USING (true);



CREATE POLICY "public_read_emergency_responses" ON "public"."emergency_responses" FOR SELECT USING (true);



CREATE POLICY "public_read_fraud_protection_rules" ON "public"."fraud_protection_rules" FOR SELECT USING (true);



CREATE POLICY "public_read_incident_assignments" ON "public"."incident_assignments" FOR SELECT USING (true);



CREATE POLICY "public_read_incident_evidence" ON "public"."incident_evidence" FOR SELECT USING (true);



CREATE POLICY "public_read_incident_status_history" ON "public"."incident_status_history" FOR SELECT USING (true);



CREATE POLICY "public_read_incident_timeline" ON "public"."incident_timeline" FOR SELECT USING (true);



CREATE POLICY "public_read_payment_transactions" ON "public"."payment_transactions" FOR SELECT USING (true);



CREATE POLICY "public_read_payout_audit_logs" ON "public"."payout_audit_logs" FOR SELECT USING (true);



CREATE POLICY "public_read_payout_batches" ON "public"."payout_batches" FOR SELECT USING (true);



CREATE POLICY "public_read_payout_settings" ON "public"."payout_settings" FOR SELECT USING (true);



CREATE POLICY "public_read_promo_codes" ON "public"."promo_codes" FOR SELECT USING (true);



CREATE POLICY "public_read_promotions" ON "public"."promotions" FOR SELECT USING (true);



CREATE POLICY "public_read_refund_actions" ON "public"."refund_actions" FOR SELECT USING (true);



CREATE POLICY "public_read_refund_audit_logs" ON "public"."refund_audit_logs" FOR SELECT USING (true);



CREATE POLICY "public_read_refunds" ON "public"."refunds" FOR SELECT USING (true);



CREATE POLICY "public_read_ride_categories" ON "public"."ride_categories" FOR SELECT USING (true);



CREATE POLICY "public_read_ride_events" ON "public"."ride_events" FOR SELECT USING (true);



CREATE POLICY "public_read_ride_location_points" ON "public"."ride_location_points" FOR SELECT USING (true);



CREATE POLICY "public_read_ride_safety_events" ON "public"."ride_safety_events" FOR SELECT USING (true);



CREATE POLICY "public_read_support_tickets" ON "public"."support_tickets" FOR SELECT USING (true);



CREATE POLICY "public_read_tax_configs" ON "public"."tax_configs" FOR SELECT USING (true);



CREATE POLICY "public_read_tax_records" ON "public"."tax_records" FOR SELECT USING (true);



CREATE POLICY "public_read_trip_earnings" ON "public"."trip_earnings" FOR SELECT USING (true);



CREATE POLICY "public_read_user_roles" ON "public"."user_roles" FOR SELECT USING (true);



CREATE POLICY "public_read_weafrica_places" ON "public"."weafrica_places" FOR SELECT USING (true);



CREATE POLICY "public_update_promotions" ON "public"."promotions" FOR UPDATE USING (true) WITH CHECK (true);



ALTER TABLE "public"."push_notifications" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ratings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."referral_campaigns" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."referral_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."referral_fraud_checks" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."referral_rewards" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."referral_settings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."refund_actions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."refund_audit_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."refunds" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."reward_definitions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ride_categories" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ride_disputes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ride_events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "ride_events: allow insert" ON "public"."ride_events" FOR INSERT WITH CHECK (true);



CREATE POLICY "ride_events: allow select" ON "public"."ride_events" FOR SELECT USING (true);



ALTER TABLE "public"."ride_invoices" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ride_location_points" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ride_messages" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "ride_messages: allow insert" ON "public"."ride_messages" FOR INSERT WITH CHECK (true);



CREATE POLICY "ride_messages: allow select" ON "public"."ride_messages" FOR SELECT USING (true);



ALTER TABLE "public"."ride_requests" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "ride_requests: allow insert" ON "public"."ride_requests" FOR INSERT WITH CHECK (true);



CREATE POLICY "ride_requests: allow select" ON "public"."ride_requests" FOR SELECT USING (true);



CREATE POLICY "ride_requests: allow update" ON "public"."ride_requests" FOR UPDATE USING (true) WITH CHECK (true);



ALTER TABLE "public"."ride_safety_events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "rider_insert_own_redemptions" ON "public"."promo_redemptions" FOR INSERT WITH CHECK ((("user_id" IN ( SELECT "users"."id"
   FROM "public"."users"
  WHERE ("users"."firebase_uid" = ("auth"."uid"())::"text"))) OR ("user_id" = "auth"."uid"())));



ALTER TABLE "public"."rider_loyalty_accounts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "rider_own_wallet" ON "public"."wallets" FOR SELECT USING (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."rider_ratings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "rider_read_own_redemptions" ON "public"."promo_redemptions" FOR SELECT USING ((("user_id" IN ( SELECT "users"."id"
   FROM "public"."users"
  WHERE ("users"."firebase_uid" = ("auth"."uid"())::"text"))) OR ("user_id" = "auth"."uid"())));



ALTER TABLE "public"."rider_referrals" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."rider_rewards" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."rider_settings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "rider_settings_insert_anon" ON "public"."rider_settings" FOR INSERT TO "anon" WITH CHECK (true);



CREATE POLICY "rider_settings_insert_own" ON "public"."rider_settings" FOR INSERT TO "authenticated" WITH CHECK (("rider_id" IN ( SELECT "riders"."id"
   FROM "public"."riders"
  WHERE ("riders"."user_id" = "auth"."uid"()))));



CREATE POLICY "rider_settings_read_anon" ON "public"."rider_settings" FOR SELECT TO "anon" USING (true);



CREATE POLICY "rider_settings_read_own" ON "public"."rider_settings" FOR SELECT TO "authenticated" USING (("rider_id" IN ( SELECT "riders"."id"
   FROM "public"."riders"
  WHERE ("riders"."user_id" = "auth"."uid"()))));



CREATE POLICY "rider_settings_update_anon" ON "public"."rider_settings" FOR UPDATE TO "anon" USING (true) WITH CHECK (true);



CREATE POLICY "rider_settings_update_own" ON "public"."rider_settings" FOR UPDATE TO "authenticated" USING (("rider_id" IN ( SELECT "riders"."id"
   FROM "public"."riders"
  WHERE ("riders"."user_id" = "auth"."uid"())))) WITH CHECK (("rider_id" IN ( SELECT "riders"."id"
   FROM "public"."riders"
  WHERE ("riders"."user_id" = "auth"."uid"()))));



ALTER TABLE "public"."riders" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "riders: allow insert" ON "public"."riders" FOR INSERT WITH CHECK (true);



CREATE POLICY "riders: allow select" ON "public"."riders" FOR SELECT USING (true);



CREATE POLICY "riders: allow update" ON "public"."riders" FOR UPDATE USING (true) WITH CHECK (true);



ALTER TABLE "public"."rides" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "rides: allow insert" ON "public"."rides" FOR INSERT WITH CHECK (true);



CREATE POLICY "rides: allow select" ON "public"."rides" FOR SELECT USING (true);



CREATE POLICY "rides: allow update" ON "public"."rides" FOR UPDATE USING (true) WITH CHECK (true);



ALTER TABLE "public"."role_permissions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "role_permissions_anon_read" ON "public"."role_permissions" FOR SELECT TO "anon" USING (true);



ALTER TABLE "public"."safety_incidents" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "service_zone_audit_admin_insert" ON "public"."service_zone_audit_logs" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "au"
  WHERE (("au"."user_id" = "auth"."uid"()) AND (COALESCE("au"."is_active", true) = true)))));



CREATE POLICY "service_zone_audit_admin_read" ON "public"."service_zone_audit_logs" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "au"
  WHERE (("au"."user_id" = "auth"."uid"()) AND (COALESCE("au"."is_active", true) = true)))));



ALTER TABLE "public"."service_zone_audit_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."service_zones" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "service_zones_admin_all" ON "public"."service_zones" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "au"
  WHERE (("au"."user_id" = "auth"."uid"()) AND (COALESCE("au"."is_active", true) = true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "au"
  WHERE (("au"."user_id" = "auth"."uid"()) AND (COALESCE("au"."is_active", true) = true)))));



CREATE POLICY "service_zones_read_active" ON "public"."service_zones" FOR SELECT USING ((("status" = 'active'::"text") OR (EXISTS ( SELECT 1
   FROM "public"."admin_users" "au"
  WHERE (("au"."user_id" = "auth"."uid"()) AND (COALESCE("au"."is_active", true) = true))))));



ALTER TABLE "public"."staff_invitations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."support_chat_messages" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."support_chats" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "support_chats_insert" ON "public"."support_chats" FOR INSERT TO "authenticated", "anon" WITH CHECK (true);



CREATE POLICY "support_messages_insert" ON "public"."support_chat_messages" FOR INSERT TO "authenticated", "anon" WITH CHECK (true);



CREATE POLICY "support_messages_select" ON "public"."support_chat_messages" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."support_tickets" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."tax_configs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."tax_records" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."trip_earnings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."trip_queue" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "trip_queue: allow insert" ON "public"."trip_queue" FOR INSERT WITH CHECK (true);



CREATE POLICY "trip_queue: allow select" ON "public"."trip_queue" FOR SELECT USING (true);



CREATE POLICY "trip_queue: allow update" ON "public"."trip_queue" FOR UPDATE USING (true) WITH CHECK (true);



ALTER TABLE "public"."user_notification_tokens" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_risk_scores" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_roles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_suspensions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."users" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "users: allow insert" ON "public"."users" FOR INSERT WITH CHECK (true);



CREATE POLICY "users: allow select" ON "public"."users" FOR SELECT USING (true);



CREATE POLICY "users: allow update" ON "public"."users" FOR UPDATE USING (true) WITH CHECK (true);



ALTER TABLE "public"."vehicle_maintenance_records" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."vehicles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."wallet_transactions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."wallets" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."weafrica_places" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."webhook_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."whatsapp_conversations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."whatsapp_ride_requests" ENABLE ROW LEVEL SECURITY;


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON TABLE "public"."rides" TO "anon";
GRANT ALL ON TABLE "public"."rides" TO "authenticated";
GRANT ALL ON TABLE "public"."rides" TO "service_role";



GRANT ALL ON FUNCTION "public"."accept_ride_request"("p_request_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."accept_ride_request"("p_request_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."accept_ride_request"("p_request_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."accept_staff_invitation"("p_token" "text", "p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."accept_staff_invitation"("p_token" "text", "p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."accept_staff_invitation"("p_token" "text", "p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."activate_queued_ride"("p_driver_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."activate_queued_ride"("p_driver_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."activate_queued_ride"("p_driver_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_adjust_rewards_wallet"("p_user_id" "uuid", "p_amount" numeric, "p_bucket" "text", "p_reason" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_adjust_rewards_wallet"("p_user_id" "uuid", "p_amount" numeric, "p_bucket" "text", "p_reason" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_adjust_rewards_wallet"("p_user_id" "uuid", "p_amount" numeric, "p_bucket" "text", "p_reason" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_approve_driver"("p_driver_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_approve_driver"("p_driver_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_approve_driver"("p_driver_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_approve_driver_reward"("p_reward_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_approve_driver_reward"("p_reward_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_approve_driver_reward"("p_reward_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_approve_payout_full"("p_request_id" "uuid", "p_admin_notes" "text", "p_admin_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_approve_payout_full"("p_request_id" "uuid", "p_admin_notes" "text", "p_admin_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_approve_payout_full"("p_request_id" "uuid", "p_admin_notes" "text", "p_admin_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_approve_refund_full"("p_refund_id" "uuid", "p_decision" "text", "p_partial_amount" numeric, "p_penalty_amount" numeric, "p_penalty_target" "text", "p_hold_payout" boolean, "p_admin_notes" "text", "p_admin_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_approve_refund_full"("p_refund_id" "uuid", "p_decision" "text", "p_partial_amount" numeric, "p_penalty_amount" numeric, "p_penalty_target" "text", "p_hold_payout" boolean, "p_admin_notes" "text", "p_admin_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_approve_refund_full"("p_refund_id" "uuid", "p_decision" "text", "p_partial_amount" numeric, "p_penalty_amount" numeric, "p_penalty_target" "text", "p_hold_payout" boolean, "p_admin_notes" "text", "p_admin_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_cancel_refund"("p_refund_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_cancel_refund"("p_refund_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_cancel_refund"("p_refund_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_create_city"("p_name" "text", "p_region" "text", "p_country_id" "uuid", "p_is_active" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."admin_create_city"("p_name" "text", "p_region" "text", "p_country_id" "uuid", "p_is_active" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_create_city"("p_name" "text", "p_region" "text", "p_country_id" "uuid", "p_is_active" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_create_dispute_from_refund"("p_refund_id" "uuid", "p_dispute_type" "text", "p_priority" "text", "p_admin_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_create_dispute_from_refund"("p_refund_id" "uuid", "p_dispute_type" "text", "p_priority" "text", "p_admin_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_create_dispute_from_refund"("p_refund_id" "uuid", "p_dispute_type" "text", "p_priority" "text", "p_admin_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_create_incident"("p_type" "text", "p_severity" "text", "p_city" "text", "p_description" "text", "p_ride_id" "uuid", "p_rider_id" "uuid", "p_driver_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_create_incident"("p_type" "text", "p_severity" "text", "p_city" "text", "p_description" "text", "p_ride_id" "uuid", "p_rider_id" "uuid", "p_driver_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_create_incident"("p_type" "text", "p_severity" "text", "p_city" "text", "p_description" "text", "p_ride_id" "uuid", "p_rider_id" "uuid", "p_driver_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_create_manual_payout"("p_driver_id" "uuid", "p_amount" numeric, "p_method" "text", "p_admin_notes" "text", "p_admin_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_create_manual_payout"("p_driver_id" "uuid", "p_amount" numeric, "p_method" "text", "p_admin_notes" "text", "p_admin_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_create_manual_payout"("p_driver_id" "uuid", "p_amount" numeric, "p_method" "text", "p_admin_notes" "text", "p_admin_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_create_payout_batch"("p_method" "text", "p_admin_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_create_payout_batch"("p_method" "text", "p_admin_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_create_payout_batch"("p_method" "text", "p_admin_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_create_refund"("p_payment_id" "uuid", "p_reason" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_create_refund"("p_payment_id" "uuid", "p_reason" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_create_refund"("p_payment_id" "uuid", "p_reason" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_daily_revenue"("p_days" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."admin_daily_revenue"("p_days" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_daily_revenue"("p_days" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_delete_city"("p_city_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_delete_city"("p_city_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_delete_city"("p_city_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_delete_driver"("p_driver_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_delete_driver"("p_driver_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_delete_driver"("p_driver_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_delete_driver_incentive"("p_incentive_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_delete_driver_incentive"("p_incentive_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_delete_driver_incentive"("p_incentive_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_delete_surge_rule"("p_rule_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_delete_surge_rule"("p_rule_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_delete_surge_rule"("p_rule_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_driver_stats"("p_city_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_driver_stats"("p_city_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_driver_stats"("p_city_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_emergency_stats"() TO "anon";
GRANT ALL ON FUNCTION "public"."admin_emergency_stats"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_emergency_stats"() TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_estimate_fare"("p_pickup_lat" double precision, "p_pickup_lng" double precision, "p_dropoff_lat" double precision, "p_dropoff_lng" double precision, "p_category_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_estimate_fare"("p_pickup_lat" double precision, "p_pickup_lng" double precision, "p_dropoff_lat" double precision, "p_dropoff_lng" double precision, "p_category_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_estimate_fare"("p_pickup_lat" double precision, "p_pickup_lng" double precision, "p_dropoff_lat" double precision, "p_dropoff_lng" double precision, "p_category_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_estimate_fare"("p_pickup_lat" double precision, "p_pickup_lng" double precision, "p_dropoff_lat" double precision, "p_dropoff_lng" double precision, "p_category_id" "uuid", "p_city" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_estimate_fare"("p_pickup_lat" double precision, "p_pickup_lng" double precision, "p_dropoff_lat" double precision, "p_dropoff_lng" double precision, "p_category_id" "uuid", "p_city" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_estimate_fare"("p_pickup_lat" double precision, "p_pickup_lng" double precision, "p_dropoff_lat" double precision, "p_dropoff_lng" double precision, "p_category_id" "uuid", "p_city" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_finance_stats"() TO "anon";
GRANT ALL ON FUNCTION "public"."admin_finance_stats"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_finance_stats"() TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_finance_summary_full"() TO "anon";
GRANT ALL ON FUNCTION "public"."admin_finance_summary_full"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_finance_summary_full"() TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_force_driver_offline"("p_driver_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_force_driver_offline"("p_driver_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_force_driver_offline"("p_driver_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_get_nearby_drivers"("p_lat" numeric, "p_lng" numeric, "p_radius_km" numeric) TO "anon";
GRANT ALL ON FUNCTION "public"."admin_get_nearby_drivers"("p_lat" numeric, "p_lng" numeric, "p_radius_km" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_get_nearby_drivers"("p_lat" numeric, "p_lng" numeric, "p_radius_km" numeric) TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_get_payout_settings"() TO "anon";
GRANT ALL ON FUNCTION "public"."admin_get_payout_settings"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_get_payout_settings"() TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_get_trip_detail"("p_ride_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_get_trip_detail"("p_ride_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_get_trip_detail"("p_ride_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_hold_driver_payout"("p_payout_id" "uuid", "p_reason" "text", "p_admin_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_hold_driver_payout"("p_payout_id" "uuid", "p_reason" "text", "p_admin_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_hold_driver_payout"("p_payout_id" "uuid", "p_reason" "text", "p_admin_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_incident_stats"() TO "anon";
GRANT ALL ON FUNCTION "public"."admin_incident_stats"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_incident_stats"() TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_list_commission_configs"() TO "anon";
GRANT ALL ON FUNCTION "public"."admin_list_commission_configs"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_list_commission_configs"() TO "service_role";



GRANT ALL ON TABLE "public"."countries" TO "anon";
GRANT ALL ON TABLE "public"."countries" TO "authenticated";
GRANT ALL ON TABLE "public"."countries" TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_list_countries"() TO "anon";
GRANT ALL ON FUNCTION "public"."admin_list_countries"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_list_countries"() TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_list_driver_incentives"("p_country_code" "text", "p_city" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_list_driver_incentives"("p_country_code" "text", "p_city" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_list_driver_incentives"("p_country_code" "text", "p_city" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_list_drivers"("p_page" integer, "p_page_size" integer, "p_search" "text", "p_approval_status" "text", "p_is_online" boolean, "p_city_id" "uuid", "p_driver_tier" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_list_drivers"("p_page" integer, "p_page_size" integer, "p_search" "text", "p_approval_status" "text", "p_is_online" boolean, "p_city_id" "uuid", "p_driver_tier" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_list_drivers"("p_page" integer, "p_page_size" integer, "p_search" "text", "p_approval_status" "text", "p_is_online" boolean, "p_city_id" "uuid", "p_driver_tier" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_list_emergencies_enriched"("p_status" "text", "p_city" "text", "p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."admin_list_emergencies_enriched"("p_status" "text", "p_city" "text", "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_list_emergencies_enriched"("p_status" "text", "p_city" "text", "p_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_list_failed_transactions"("p_search" "text", "p_provider" "text", "p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."admin_list_failed_transactions"("p_search" "text", "p_provider" "text", "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_list_failed_transactions"("p_search" "text", "p_provider" "text", "p_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_list_fraud_rules"() TO "anon";
GRANT ALL ON FUNCTION "public"."admin_list_fraud_rules"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_list_fraud_rules"() TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_list_incidents_enriched"("p_status" "text", "p_severity" "text", "p_city" "text", "p_type" "text", "p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."admin_list_incidents_enriched"("p_status" "text", "p_severity" "text", "p_city" "text", "p_type" "text", "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_list_incidents_enriched"("p_status" "text", "p_severity" "text", "p_city" "text", "p_type" "text", "p_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_list_loyalty_accounts"("p_search" "text", "p_tier" "text", "p_limit" integer, "p_offset" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."admin_list_loyalty_accounts"("p_search" "text", "p_tier" "text", "p_limit" integer, "p_offset" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_list_loyalty_accounts"("p_search" "text", "p_tier" "text", "p_limit" integer, "p_offset" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_list_payments_enriched"("p_search" "text", "p_status" "text", "p_method" "text", "p_city" "text", "p_date_from" "text", "p_date_to" "text", "p_limit" integer, "p_offset" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."admin_list_payments_enriched"("p_search" "text", "p_status" "text", "p_method" "text", "p_city" "text", "p_date_from" "text", "p_date_to" "text", "p_limit" integer, "p_offset" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_list_payments_enriched"("p_search" "text", "p_status" "text", "p_method" "text", "p_city" "text", "p_date_from" "text", "p_date_to" "text", "p_limit" integer, "p_offset" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_list_payout_requests_full"("p_search" "text", "p_status" "text", "p_method" "text", "p_city" "text", "p_date_from" "text", "p_date_to" "text", "p_amount_min" numeric, "p_amount_max" numeric, "p_limit" integer, "p_offset" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."admin_list_payout_requests_full"("p_search" "text", "p_status" "text", "p_method" "text", "p_city" "text", "p_date_from" "text", "p_date_to" "text", "p_amount_min" numeric, "p_amount_max" numeric, "p_limit" integer, "p_offset" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_list_payout_requests_full"("p_search" "text", "p_status" "text", "p_method" "text", "p_city" "text", "p_date_from" "text", "p_date_to" "text", "p_amount_min" numeric, "p_amount_max" numeric, "p_limit" integer, "p_offset" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_list_payouts_enriched"("p_search" "text", "p_status" "text", "p_method" "text", "p_limit" integer, "p_offset" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."admin_list_payouts_enriched"("p_search" "text", "p_status" "text", "p_method" "text", "p_limit" integer, "p_offset" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_list_payouts_enriched"("p_search" "text", "p_status" "text", "p_method" "text", "p_limit" integer, "p_offset" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_list_pricing_config"("p_country_code" "text", "p_city" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_list_pricing_config"("p_country_code" "text", "p_city" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_list_pricing_config"("p_country_code" "text", "p_city" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_list_refunds"("p_search" "text", "p_status" "text", "p_payment_method" "text", "p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."admin_list_refunds"("p_search" "text", "p_status" "text", "p_payment_method" "text", "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_list_refunds"("p_search" "text", "p_status" "text", "p_payment_method" "text", "p_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_list_refunds_enriched"("p_search" "text", "p_status" "text", "p_method" "text", "p_city" "text", "p_driver" "text", "p_rider" "text", "p_vehicle_class" "text", "p_amount_min" numeric, "p_amount_max" numeric, "p_date_from" "text", "p_date_to" "text", "p_provider" "text", "p_limit" integer, "p_offset" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."admin_list_refunds_enriched"("p_search" "text", "p_status" "text", "p_method" "text", "p_city" "text", "p_driver" "text", "p_rider" "text", "p_vehicle_class" "text", "p_amount_min" numeric, "p_amount_max" numeric, "p_date_from" "text", "p_date_to" "text", "p_provider" "text", "p_limit" integer, "p_offset" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_list_refunds_enriched"("p_search" "text", "p_status" "text", "p_method" "text", "p_city" "text", "p_driver" "text", "p_rider" "text", "p_vehicle_class" "text", "p_amount_min" numeric, "p_amount_max" numeric, "p_date_from" "text", "p_date_to" "text", "p_provider" "text", "p_limit" integer, "p_offset" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_list_surge_rules"("p_country_code" "text", "p_city" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_list_surge_rules"("p_country_code" "text", "p_city" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_list_surge_rules"("p_country_code" "text", "p_city" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_list_tax_configs"() TO "anon";
GRANT ALL ON FUNCTION "public"."admin_list_tax_configs"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_list_tax_configs"() TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_list_transactions_enriched"("p_search" "text", "p_status" "text", "p_type" "text", "p_method" "text", "p_vehicle_class" "text", "p_city" "text", "p_date_from" "text", "p_date_to" "text", "p_limit" integer, "p_offset" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."admin_list_transactions_enriched"("p_search" "text", "p_status" "text", "p_type" "text", "p_method" "text", "p_vehicle_class" "text", "p_city" "text", "p_date_from" "text", "p_date_to" "text", "p_limit" integer, "p_offset" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_list_transactions_enriched"("p_search" "text", "p_status" "text", "p_type" "text", "p_method" "text", "p_vehicle_class" "text", "p_city" "text", "p_date_from" "text", "p_date_to" "text", "p_limit" integer, "p_offset" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_loyalty_analytics"() TO "anon";
GRANT ALL ON FUNCTION "public"."admin_loyalty_analytics"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_loyalty_analytics"() TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_mark_payout_paid"("p_request_id" "uuid", "p_transaction_reference" "text", "p_admin_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_mark_payout_paid"("p_request_id" "uuid", "p_transaction_reference" "text", "p_admin_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_mark_payout_paid"("p_request_id" "uuid", "p_transaction_reference" "text", "p_admin_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_mark_trip_reviewed"("p_ride_id" "uuid", "p_admin_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_mark_trip_reviewed"("p_ride_id" "uuid", "p_admin_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_mark_trip_reviewed"("p_ride_id" "uuid", "p_admin_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_payout_stats_full"() TO "anon";
GRANT ALL ON FUNCTION "public"."admin_payout_stats_full"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_payout_stats_full"() TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_penalize_driver"("p_driver_id" "uuid", "p_ride_id" "uuid", "p_refund_id" "uuid", "p_amount" numeric, "p_reason" "text", "p_admin_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_penalize_driver"("p_driver_id" "uuid", "p_ride_id" "uuid", "p_refund_id" "uuid", "p_amount" numeric, "p_reason" "text", "p_admin_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_penalize_driver"("p_driver_id" "uuid", "p_ride_id" "uuid", "p_refund_id" "uuid", "p_amount" numeric, "p_reason" "text", "p_admin_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_process_partial_refund"("p_refund_id" "uuid", "p_partial_amount" numeric, "p_admin_notes" "text", "p_admin_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_process_partial_refund"("p_refund_id" "uuid", "p_partial_amount" numeric, "p_admin_notes" "text", "p_admin_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_process_partial_refund"("p_refund_id" "uuid", "p_partial_amount" numeric, "p_admin_notes" "text", "p_admin_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_process_refund"("p_refund_id" "uuid", "p_status" "text", "p_admin_notes" "text", "p_failure_reason" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_process_refund"("p_refund_id" "uuid", "p_status" "text", "p_admin_notes" "text", "p_failure_reason" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_process_refund"("p_refund_id" "uuid", "p_status" "text", "p_admin_notes" "text", "p_failure_reason" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_reject_driver"("p_driver_id" "uuid", "p_reason" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_reject_driver"("p_driver_id" "uuid", "p_reason" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_reject_driver"("p_driver_id" "uuid", "p_reason" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_reject_payout_full"("p_request_id" "uuid", "p_admin_notes" "text", "p_admin_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_reject_payout_full"("p_request_id" "uuid", "p_admin_notes" "text", "p_admin_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_reject_payout_full"("p_request_id" "uuid", "p_admin_notes" "text", "p_admin_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_reject_refund_full"("p_refund_id" "uuid", "p_admin_notes" "text", "p_admin_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_reject_refund_full"("p_refund_id" "uuid", "p_admin_notes" "text", "p_admin_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_reject_refund_full"("p_refund_id" "uuid", "p_admin_notes" "text", "p_admin_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_release_driver_payout"("p_payout_id" "uuid", "p_admin_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_release_driver_payout"("p_payout_id" "uuid", "p_admin_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_release_driver_payout"("p_payout_id" "uuid", "p_admin_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_resolve_dispute_full"("p_dispute_id" "uuid", "p_resolution" "text", "p_status" "text", "p_admin_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_resolve_dispute_full"("p_dispute_id" "uuid", "p_resolution" "text", "p_status" "text", "p_admin_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_resolve_dispute_full"("p_dispute_id" "uuid", "p_resolution" "text", "p_status" "text", "p_admin_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_respond_to_emergency"("p_alert_id" "uuid", "p_action" "text", "p_notes" "text", "p_admin_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_respond_to_emergency"("p_alert_id" "uuid", "p_action" "text", "p_notes" "text", "p_admin_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_respond_to_emergency"("p_alert_id" "uuid", "p_action" "text", "p_notes" "text", "p_admin_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_retry_failed_payout"("p_request_id" "uuid", "p_admin_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_retry_failed_payout"("p_request_id" "uuid", "p_admin_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_retry_failed_payout"("p_request_id" "uuid", "p_admin_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_retry_failed_refund"("p_refund_id" "uuid", "p_admin_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_retry_failed_refund"("p_refund_id" "uuid", "p_admin_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_retry_failed_refund"("p_refund_id" "uuid", "p_admin_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_retry_payment_transaction"("p_transaction_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_retry_payment_transaction"("p_transaction_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_retry_payment_transaction"("p_transaction_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_retry_refund"("p_refund_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_retry_refund"("p_refund_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_retry_refund"("p_refund_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_search_trips_enriched"("p_search" "text", "p_city" "text", "p_status" "text", "p_safety_status" "text", "p_date_from" "text", "p_date_to" "text", "p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."admin_search_trips_enriched"("p_search" "text", "p_city" "text", "p_status" "text", "p_safety_status" "text", "p_date_from" "text", "p_date_to" "text", "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_search_trips_enriched"("p_search" "text", "p_city" "text", "p_status" "text", "p_safety_status" "text", "p_date_from" "text", "p_date_to" "text", "p_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_service_zone_summary"("p_zone_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_service_zone_summary"("p_zone_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_service_zone_summary"("p_zone_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_suspend_driver"("p_driver_id" "uuid", "p_reason" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_suspend_driver"("p_driver_id" "uuid", "p_reason" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_suspend_driver"("p_driver_id" "uuid", "p_reason" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_trip_playback_stats"() TO "anon";
GRANT ALL ON FUNCTION "public"."admin_trip_playback_stats"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_trip_playback_stats"() TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_unsuspend_driver"("p_driver_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_unsuspend_driver"("p_driver_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_unsuspend_driver"("p_driver_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_update_city"("p_city_id" "uuid", "p_name" "text", "p_region" "text", "p_country_id" "uuid", "p_is_active" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."admin_update_city"("p_city_id" "uuid", "p_name" "text", "p_region" "text", "p_country_id" "uuid", "p_is_active" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_update_city"("p_city_id" "uuid", "p_name" "text", "p_region" "text", "p_country_id" "uuid", "p_is_active" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_update_commission_config"("p_vehicle_class" "text", "p_commission_percent" numeric, "p_min_commission" numeric, "p_max_commission" numeric, "p_is_active" boolean, "p_notes" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_update_commission_config"("p_vehicle_class" "text", "p_commission_percent" numeric, "p_min_commission" numeric, "p_max_commission" numeric, "p_is_active" boolean, "p_notes" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_update_commission_config"("p_vehicle_class" "text", "p_commission_percent" numeric, "p_min_commission" numeric, "p_max_commission" numeric, "p_is_active" boolean, "p_notes" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_update_driver"("p_driver_id" "uuid", "p_full_name" "text", "p_phone" "text", "p_email" "text", "p_address" "text", "p_can_go_online" boolean, "p_plate_number" "text", "p_vehicle_make" "text", "p_vehicle_model" "text", "p_vehicle_year" integer, "p_vehicle_color" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_update_driver"("p_driver_id" "uuid", "p_full_name" "text", "p_phone" "text", "p_email" "text", "p_address" "text", "p_can_go_online" boolean, "p_plate_number" "text", "p_vehicle_make" "text", "p_vehicle_model" "text", "p_vehicle_year" integer, "p_vehicle_color" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_update_driver"("p_driver_id" "uuid", "p_full_name" "text", "p_phone" "text", "p_email" "text", "p_address" "text", "p_can_go_online" boolean, "p_plate_number" "text", "p_vehicle_make" "text", "p_vehicle_model" "text", "p_vehicle_year" integer, "p_vehicle_color" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_update_fraud_rule"("p_rule_name" "text", "p_threshold_value" numeric, "p_threshold_count" integer, "p_action" "text", "p_is_active" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."admin_update_fraud_rule"("p_rule_name" "text", "p_threshold_value" numeric, "p_threshold_count" integer, "p_action" "text", "p_is_active" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_update_fraud_rule"("p_rule_name" "text", "p_threshold_value" numeric, "p_threshold_count" integer, "p_action" "text", "p_is_active" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_update_incident"("p_incident_id" "uuid", "p_status" "text", "p_severity" "text", "p_assigned_admin_id" "uuid", "p_resolution" "text", "p_notes" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_update_incident"("p_incident_id" "uuid", "p_status" "text", "p_severity" "text", "p_assigned_admin_id" "uuid", "p_resolution" "text", "p_notes" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_update_incident"("p_incident_id" "uuid", "p_status" "text", "p_severity" "text", "p_assigned_admin_id" "uuid", "p_resolution" "text", "p_notes" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_update_payout_setting"("p_key" "text", "p_value" "text", "p_admin_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_update_payout_setting"("p_key" "text", "p_value" "text", "p_admin_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_update_payout_setting"("p_key" "text", "p_value" "text", "p_admin_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_update_pricing_config"("p_config_id" "uuid", "p_base_fare" numeric, "p_minimum_fare" numeric, "p_max_fare_cap" numeric, "p_per_km" numeric, "p_per_min" numeric, "p_booking_fee" numeric, "p_waiting_fee" numeric, "p_cancellation_fee" numeric, "p_free_waiting_minutes" integer, "p_night_multiplier" numeric, "p_night_start_time" time without time zone, "p_night_end_time" time without time zone, "p_tax_enabled" boolean, "p_tax_percent" numeric, "p_tax_name" "text", "p_commission_percent" numeric, "p_currency" "text", "p_is_active" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."admin_update_pricing_config"("p_config_id" "uuid", "p_base_fare" numeric, "p_minimum_fare" numeric, "p_max_fare_cap" numeric, "p_per_km" numeric, "p_per_min" numeric, "p_booking_fee" numeric, "p_waiting_fee" numeric, "p_cancellation_fee" numeric, "p_free_waiting_minutes" integer, "p_night_multiplier" numeric, "p_night_start_time" time without time zone, "p_night_end_time" time without time zone, "p_tax_enabled" boolean, "p_tax_percent" numeric, "p_tax_name" "text", "p_commission_percent" numeric, "p_currency" "text", "p_is_active" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_update_pricing_config"("p_config_id" "uuid", "p_base_fare" numeric, "p_minimum_fare" numeric, "p_max_fare_cap" numeric, "p_per_km" numeric, "p_per_min" numeric, "p_booking_fee" numeric, "p_waiting_fee" numeric, "p_cancellation_fee" numeric, "p_free_waiting_minutes" integer, "p_night_multiplier" numeric, "p_night_start_time" time without time zone, "p_night_end_time" time without time zone, "p_tax_enabled" boolean, "p_tax_percent" numeric, "p_tax_name" "text", "p_commission_percent" numeric, "p_currency" "text", "p_is_active" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_update_tax_config"("p_tax_name" "text", "p_tax_percent" numeric, "p_fixed_amount" numeric, "p_is_active" boolean, "p_applies_to" "text", "p_description" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_update_tax_config"("p_tax_name" "text", "p_tax_percent" numeric, "p_fixed_amount" numeric, "p_is_active" boolean, "p_applies_to" "text", "p_description" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_update_tax_config"("p_tax_name" "text", "p_tax_percent" numeric, "p_fixed_amount" numeric, "p_is_active" boolean, "p_applies_to" "text", "p_description" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_upsert_driver_incentive"("p_incentive_id" "uuid", "p_country_code" "text", "p_city" "text", "p_incentive_type" "text", "p_incentive_label" "text", "p_description" "text", "p_required_trips" integer, "p_time_window_hours" integer, "p_reward_amount" numeric, "p_reward_type" "text", "p_fare_multiplier" numeric, "p_starts_at" timestamp with time zone, "p_ends_at" timestamp with time zone, "p_is_active" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."admin_upsert_driver_incentive"("p_incentive_id" "uuid", "p_country_code" "text", "p_city" "text", "p_incentive_type" "text", "p_incentive_label" "text", "p_description" "text", "p_required_trips" integer, "p_time_window_hours" integer, "p_reward_amount" numeric, "p_reward_type" "text", "p_fare_multiplier" numeric, "p_starts_at" timestamp with time zone, "p_ends_at" timestamp with time zone, "p_is_active" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_upsert_driver_incentive"("p_incentive_id" "uuid", "p_country_code" "text", "p_city" "text", "p_incentive_type" "text", "p_incentive_label" "text", "p_description" "text", "p_required_trips" integer, "p_time_window_hours" integer, "p_reward_amount" numeric, "p_reward_type" "text", "p_fare_multiplier" numeric, "p_starts_at" timestamp with time zone, "p_ends_at" timestamp with time zone, "p_is_active" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_upsert_reward_definition"("p_id" "uuid", "p_name" "text", "p_description" "text", "p_reward_type" "text", "p_value" numeric, "p_points_cost" integer, "p_min_tier" "text", "p_min_rides" integer, "p_max_redemptions" integer, "p_is_active" boolean, "p_is_featured" boolean, "p_is_achievement" boolean, "p_achievement_trigger" "text", "p_icon" "text", "p_accent_color" "text", "p_sort_order" integer, "p_starts_at" "text", "p_expires_at" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_upsert_reward_definition"("p_id" "uuid", "p_name" "text", "p_description" "text", "p_reward_type" "text", "p_value" numeric, "p_points_cost" integer, "p_min_tier" "text", "p_min_rides" integer, "p_max_redemptions" integer, "p_is_active" boolean, "p_is_featured" boolean, "p_is_achievement" boolean, "p_achievement_trigger" "text", "p_icon" "text", "p_accent_color" "text", "p_sort_order" integer, "p_starts_at" "text", "p_expires_at" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_upsert_reward_definition"("p_id" "uuid", "p_name" "text", "p_description" "text", "p_reward_type" "text", "p_value" numeric, "p_points_cost" integer, "p_min_tier" "text", "p_min_rides" integer, "p_max_redemptions" integer, "p_is_active" boolean, "p_is_featured" boolean, "p_is_achievement" boolean, "p_achievement_trigger" "text", "p_icon" "text", "p_accent_color" "text", "p_sort_order" integer, "p_starts_at" "text", "p_expires_at" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_upsert_surge_rule"("p_rule_id" "uuid", "p_country_code" "text", "p_city" "text", "p_surge_type" "text", "p_surge_label" "text", "p_multiplier" numeric, "p_start_time" time without time zone, "p_end_time" time without time zone, "p_days_of_week" integer[], "p_priority" integer, "p_is_active" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."admin_upsert_surge_rule"("p_rule_id" "uuid", "p_country_code" "text", "p_city" "text", "p_surge_type" "text", "p_surge_label" "text", "p_multiplier" numeric, "p_start_time" time without time zone, "p_end_time" time without time zone, "p_days_of_week" integer[], "p_priority" integer, "p_is_active" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_upsert_surge_rule"("p_rule_id" "uuid", "p_country_code" "text", "p_city" "text", "p_surge_type" "text", "p_surge_label" "text", "p_multiplier" numeric, "p_start_time" time without time zone, "p_end_time" time without time zone, "p_days_of_week" integer[], "p_priority" integer, "p_is_active" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."apply_driver_wallet_transaction_to_wallet"() TO "anon";
GRANT ALL ON FUNCTION "public"."apply_driver_wallet_transaction_to_wallet"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."apply_driver_wallet_transaction_to_wallet"() TO "service_role";



GRANT ALL ON FUNCTION "public"."assign_driver"("p_ride_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."assign_driver"("p_ride_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."assign_driver"("p_ride_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."auto_assign_referral_code_on_approval"() TO "anon";
GRANT ALL ON FUNCTION "public"."auto_assign_referral_code_on_approval"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."auto_assign_referral_code_on_approval"() TO "service_role";



GRANT ALL ON FUNCTION "public"."auto_complete_referral_on_first_trip"() TO "anon";
GRANT ALL ON FUNCTION "public"."auto_complete_referral_on_first_trip"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."auto_complete_referral_on_first_trip"() TO "service_role";



GRANT ALL ON FUNCTION "public"."award_ride_loyalty_points"("p_rider_id" "uuid", "p_ride_id" "uuid", "p_fare_amount" numeric) TO "anon";
GRANT ALL ON FUNCTION "public"."award_ride_loyalty_points"("p_rider_id" "uuid", "p_ride_id" "uuid", "p_fare_amount" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."award_ride_loyalty_points"("p_rider_id" "uuid", "p_ride_id" "uuid", "p_fare_amount" numeric) TO "service_role";



GRANT ALL ON FUNCTION "public"."book_rider_trip"("p_rider_id" "uuid", "p_category_id" "uuid", "p_vehicle_class" "text", "p_pickup_address" "text", "p_pickup_lat" double precision, "p_pickup_lng" double precision, "p_dropoff_address" "text", "p_dropoff_lat" double precision, "p_dropoff_lng" double precision, "p_payment_method" "text", "p_estimated_fare" numeric, "p_distance_km" numeric, "p_duration_min" integer, "p_promo_code" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."book_rider_trip"("p_rider_id" "uuid", "p_category_id" "uuid", "p_vehicle_class" "text", "p_pickup_address" "text", "p_pickup_lat" double precision, "p_pickup_lng" double precision, "p_dropoff_address" "text", "p_dropoff_lat" double precision, "p_dropoff_lng" double precision, "p_payment_method" "text", "p_estimated_fare" numeric, "p_distance_km" numeric, "p_duration_min" integer, "p_promo_code" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."book_rider_trip"("p_rider_id" "uuid", "p_category_id" "uuid", "p_vehicle_class" "text", "p_pickup_address" "text", "p_pickup_lat" double precision, "p_pickup_lng" double precision, "p_dropoff_address" "text", "p_dropoff_lat" double precision, "p_dropoff_lng" double precision, "p_payment_method" "text", "p_estimated_fare" numeric, "p_distance_km" numeric, "p_duration_min" integer, "p_promo_code" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."book_rider_trip"("p_rider_id" "uuid", "p_category_id" "uuid", "p_vehicle_class" "text", "p_pickup_address" "text", "p_pickup_lat" double precision, "p_pickup_lng" double precision, "p_dropoff_address" "text", "p_dropoff_lat" double precision, "p_dropoff_lng" double precision, "p_payment_method" "text", "p_estimated_fare" numeric, "p_distance_km" numeric, "p_duration_min" numeric, "p_promo_code" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."book_rider_trip"("p_rider_id" "uuid", "p_category_id" "uuid", "p_vehicle_class" "text", "p_pickup_address" "text", "p_pickup_lat" double precision, "p_pickup_lng" double precision, "p_dropoff_address" "text", "p_dropoff_lat" double precision, "p_dropoff_lng" double precision, "p_payment_method" "text", "p_estimated_fare" numeric, "p_distance_km" numeric, "p_duration_min" numeric, "p_promo_code" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."book_rider_trip"("p_rider_id" "uuid", "p_category_id" "uuid", "p_vehicle_class" "text", "p_pickup_address" "text", "p_pickup_lat" double precision, "p_pickup_lng" double precision, "p_dropoff_address" "text", "p_dropoff_lat" double precision, "p_dropoff_lng" double precision, "p_payment_method" "text", "p_estimated_fare" numeric, "p_distance_km" numeric, "p_duration_min" numeric, "p_promo_code" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."bulk_update_referral_status"("p_ids" "uuid"[], "p_type" "text", "p_new_status" "text", "p_notes" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."bulk_update_referral_status"("p_ids" "uuid"[], "p_type" "text", "p_new_status" "text", "p_notes" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."bulk_update_referral_status"("p_ids" "uuid"[], "p_type" "text", "p_new_status" "text", "p_notes" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."cancel_push_notification"("p_notification_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."cancel_push_notification"("p_notification_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."cancel_push_notification"("p_notification_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."check_driver_milestones"("p_driver_id" "uuid", "p_ride_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."check_driver_milestones"("p_driver_id" "uuid", "p_ride_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_driver_milestones"("p_driver_id" "uuid", "p_ride_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."check_referral_fraud"("p_referral_id" "uuid", "p_referral_type" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."check_referral_fraud"("p_referral_id" "uuid", "p_referral_type" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_referral_fraud"("p_referral_id" "uuid", "p_referral_type" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."cleanup_old_driver_locations"() TO "anon";
GRANT ALL ON FUNCTION "public"."cleanup_old_driver_locations"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."cleanup_old_driver_locations"() TO "service_role";



GRANT ALL ON FUNCTION "public"."complete_push_notification"("p_notification_id" "uuid", "p_delivered" integer, "p_failed" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."complete_push_notification"("p_notification_id" "uuid", "p_delivered" integer, "p_failed" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."complete_push_notification"("p_notification_id" "uuid", "p_delivered" integer, "p_failed" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."complete_ride"("p_ride_id" "uuid", "p_driver_lat" numeric, "p_driver_lng" numeric) TO "anon";
GRANT ALL ON FUNCTION "public"."complete_ride"("p_ride_id" "uuid", "p_driver_lat" numeric, "p_driver_lng" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."complete_ride"("p_ride_id" "uuid", "p_driver_lat" numeric, "p_driver_lng" numeric) TO "service_role";



GRANT ALL ON FUNCTION "public"."complete_ride_with_loyalty"("p_ride_id" "uuid", "p_actual_fare" numeric, "p_distance_km" numeric, "p_actual_distance_km" numeric) TO "anon";
GRANT ALL ON FUNCTION "public"."complete_ride_with_loyalty"("p_ride_id" "uuid", "p_actual_fare" numeric, "p_distance_km" numeric, "p_actual_distance_km" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."complete_ride_with_loyalty"("p_ride_id" "uuid", "p_actual_fare" numeric, "p_distance_km" numeric, "p_actual_distance_km" numeric) TO "service_role";



GRANT ALL ON FUNCTION "public"."compute_driver_graduation"() TO "anon";
GRANT ALL ON FUNCTION "public"."compute_driver_graduation"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."compute_driver_graduation"() TO "service_role";



GRANT ALL ON FUNCTION "public"."compute_fare_estimate"("p_country_code" "text", "p_city" "text", "p_vehicle_type" "text", "p_distance_km" numeric, "p_estimated_minutes" integer, "p_is_night" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."compute_fare_estimate"("p_country_code" "text", "p_city" "text", "p_vehicle_type" "text", "p_distance_km" numeric, "p_estimated_minutes" integer, "p_is_night" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."compute_fare_estimate"("p_country_code" "text", "p_city" "text", "p_vehicle_type" "text", "p_distance_km" numeric, "p_estimated_minutes" integer, "p_is_night" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."create_staff_invitation"("p_email" "text", "p_full_name" "text", "p_role_id" "uuid", "p_invited_by" "uuid", "p_city_id" "uuid", "p_country_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."create_staff_invitation"("p_email" "text", "p_full_name" "text", "p_role_id" "uuid", "p_invited_by" "uuid", "p_city_id" "uuid", "p_country_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_staff_invitation"("p_email" "text", "p_full_name" "text", "p_role_id" "uuid", "p_invited_by" "uuid", "p_city_id" "uuid", "p_country_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."credit_referral_bonus_to_wallet"() TO "anon";
GRANT ALL ON FUNCTION "public"."credit_referral_bonus_to_wallet"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."credit_referral_bonus_to_wallet"() TO "service_role";



GRANT ALL ON FUNCTION "public"."decline_ride_request"("p_request_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."decline_ride_request"("p_request_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."decline_ride_request"("p_request_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."dispatch_ride_to_nearby_drivers"("p_ride_id" "uuid", "p_pickup_lat" double precision, "p_pickup_lng" double precision, "p_max_drivers" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."dispatch_ride_to_nearby_drivers"("p_ride_id" "uuid", "p_pickup_lat" double precision, "p_pickup_lng" double precision, "p_max_drivers" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."dispatch_ride_to_nearby_drivers"("p_ride_id" "uuid", "p_pickup_lat" double precision, "p_pickup_lng" double precision, "p_max_drivers" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."driver_arrived"("p_ride_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."driver_arrived"("p_ride_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."driver_arrived"("p_ride_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."driver_cancel_ride"("p_ride_id" "uuid", "p_reason" "text", "p_note" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."driver_cancel_ride"("p_ride_id" "uuid", "p_reason" "text", "p_note" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."driver_cancel_ride"("p_ride_id" "uuid", "p_reason" "text", "p_note" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."driver_earnings_statement"("p_driver_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."driver_earnings_statement"("p_driver_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."driver_earnings_statement"("p_driver_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."driver_go_offline"("p_driver_id" "uuid", "p_device_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."driver_go_offline"("p_driver_id" "uuid", "p_device_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."driver_go_offline"("p_driver_id" "uuid", "p_device_id" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."driver_go_online"("p_driver_id" "uuid", "p_device_id" "text", "p_device_type" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."driver_go_online"("p_driver_id" "uuid", "p_device_id" "text", "p_device_type" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."driver_go_online"("p_driver_id" "uuid", "p_device_id" "text", "p_device_type" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."driver_request_withdrawal"("p_driver_id" "uuid", "p_amount" numeric, "p_method" "text", "p_account_number" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."driver_request_withdrawal"("p_driver_id" "uuid", "p_amount" numeric, "p_method" "text", "p_account_number" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."driver_request_withdrawal"("p_driver_id" "uuid", "p_amount" numeric, "p_method" "text", "p_account_number" "text") TO "service_role";



GRANT ALL ON TABLE "public"."rider_loyalty_accounts" TO "anon";
GRANT ALL ON TABLE "public"."rider_loyalty_accounts" TO "authenticated";
GRANT ALL ON TABLE "public"."rider_loyalty_accounts" TO "service_role";



GRANT ALL ON FUNCTION "public"."ensure_rider_loyalty_account"("p_rider_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."ensure_rider_loyalty_account"("p_rider_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ensure_rider_loyalty_account"("p_rider_id" "uuid") TO "service_role";



GRANT ALL ON TABLE "public"."wallets" TO "anon";
GRANT ALL ON TABLE "public"."wallets" TO "authenticated";
GRANT ALL ON TABLE "public"."wallets" TO "service_role";



GRANT ALL ON FUNCTION "public"."ensure_rider_wallet"("p_rider_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."ensure_rider_wallet"("p_rider_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ensure_rider_wallet"("p_rider_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."expire_old_invitations"() TO "anon";
GRANT ALL ON FUNCTION "public"."expire_old_invitations"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."expire_old_invitations"() TO "service_role";



GRANT ALL ON FUNCTION "public"."expire_stale_ride_requests"() TO "anon";
GRANT ALL ON FUNCTION "public"."expire_stale_ride_requests"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."expire_stale_ride_requests"() TO "service_role";



GRANT ALL ON FUNCTION "public"."find_nearest_city"("p_lat" double precision, "p_lng" double precision) TO "anon";
GRANT ALL ON FUNCTION "public"."find_nearest_city"("p_lat" double precision, "p_lng" double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."find_nearest_city"("p_lat" double precision, "p_lng" double precision) TO "service_role";



GRANT ALL ON FUNCTION "public"."generate_referral_code"() TO "anon";
GRANT ALL ON FUNCTION "public"."generate_referral_code"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."generate_referral_code"() TO "service_role";



GRANT ALL ON FUNCTION "public"."generate_referral_code"("p_user_id" "uuid", "p_type" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."generate_referral_code"("p_user_id" "uuid", "p_type" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."generate_referral_code"("p_user_id" "uuid", "p_type" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."generate_ride_invoice"("p_ride_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."generate_ride_invoice"("p_ride_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."generate_ride_invoice"("p_ride_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_active_marketing_home"("p_city" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_active_marketing_home"("p_city" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_active_marketing_home"("p_city" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_active_referral_campaign"("p_type" "text", "p_city" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_active_referral_campaign"("p_type" "text", "p_city" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_active_referral_campaign"("p_type" "text", "p_city" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_driver_referral_stats"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_driver_referral_stats"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_driver_referral_stats"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_live_operations"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_live_operations"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_live_operations"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_loyalty_notification_count"("p_user_id" "uuid", "p_rider_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_loyalty_notification_count"("p_user_id" "uuid", "p_rider_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_loyalty_notification_count"("p_user_id" "uuid", "p_rider_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_marketing_analytics"("p_days" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."get_marketing_analytics"("p_days" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_marketing_analytics"("p_days" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_notification_analytics"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_notification_analytics"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_notification_analytics"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_notification_target_count"("p_recipient_group" "text", "p_target_country" "text", "p_target_city" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_notification_target_count"("p_recipient_group" "text", "p_target_country" "text", "p_target_city" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_notification_target_count"("p_recipient_group" "text", "p_target_country" "text", "p_target_city" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_platform_stats"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_platform_stats"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_platform_stats"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_referral_analytics"("p_days" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."get_referral_analytics"("p_days" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_referral_analytics"("p_days" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_referral_funnel"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_referral_funnel"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_referral_funnel"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_referral_settings"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_referral_settings"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_referral_settings"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_revenue_timeline"("p_period" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_revenue_timeline"("p_period" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_revenue_timeline"("p_period" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_ride_invoice"("p_ride_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_ride_invoice"("p_ride_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_ride_invoice"("p_ride_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_ride_type_breakdown"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_ride_type_breakdown"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_ride_type_breakdown"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_rider_retention"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_rider_retention"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_rider_retention"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_top_driver_performance"("p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."get_top_driver_performance"("p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_top_driver_performance"("p_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_top_referrers"("p_referral_type" "text", "p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."get_top_referrers"("p_referral_type" "text", "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_top_referrers"("p_referral_type" "text", "p_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_top_riders"("p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."get_top_riders"("p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_top_riders"("p_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_trips_by_city"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_trips_by_city"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_trips_by_city"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_trips_by_hour"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_trips_by_hour"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_trips_by_hour"() TO "service_role";



GRANT ALL ON FUNCTION "public"."insert_ride_location_point"("p_ride_id" "uuid", "p_latitude" numeric, "p_longitude" numeric, "p_speed_kmh" numeric, "p_heading" numeric, "p_accuracy" numeric, "p_event_type" "text", "p_recorded_at" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."insert_ride_location_point"("p_ride_id" "uuid", "p_latitude" numeric, "p_longitude" numeric, "p_speed_kmh" numeric, "p_heading" numeric, "p_accuracy" numeric, "p_event_type" "text", "p_recorded_at" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."insert_ride_location_point"("p_ride_id" "uuid", "p_latitude" numeric, "p_longitude" numeric, "p_speed_kmh" numeric, "p_heading" numeric, "p_accuracy" numeric, "p_event_type" "text", "p_recorded_at" timestamp with time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."insert_ride_location_points"("p_points" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."insert_ride_location_points"("p_points" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."insert_ride_location_points"("p_points" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_feature_enabled"("p_feature_key" "text", "p_user_role" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."is_feature_enabled"("p_feature_key" "text", "p_user_role" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_feature_enabled"("p_feature_key" "text", "p_user_role" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."log_integration_event"("p_integration_key" "text", "p_event_type" "text", "p_status" "text", "p_request" "jsonb", "p_response" "jsonb", "p_error" "text", "p_duration_ms" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."log_integration_event"("p_integration_key" "text", "p_event_type" "text", "p_status" "text", "p_request" "jsonb", "p_response" "jsonb", "p_error" "text", "p_duration_ms" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."log_integration_event"("p_integration_key" "text", "p_event_type" "text", "p_status" "text", "p_request" "jsonb", "p_response" "jsonb", "p_error" "text", "p_duration_ms" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."log_refund_action"("p_refund_id" "uuid", "p_action" "text", "p_old_status" "text", "p_new_status" "text", "p_admin_id" "uuid", "p_admin_email" "text", "p_notes" "text", "p_metadata" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."log_refund_action"("p_refund_id" "uuid", "p_action" "text", "p_old_status" "text", "p_new_status" "text", "p_admin_id" "uuid", "p_admin_email" "text", "p_notes" "text", "p_metadata" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."log_refund_action"("p_refund_id" "uuid", "p_action" "text", "p_old_status" "text", "p_new_status" "text", "p_admin_id" "uuid", "p_admin_email" "text", "p_notes" "text", "p_metadata" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."mark_loyalty_notification_read"("p_notification_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."mark_loyalty_notification_read"("p_notification_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."mark_loyalty_notification_read"("p_notification_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."normalize_driver_wallet_transaction"() TO "anon";
GRANT ALL ON FUNCTION "public"."normalize_driver_wallet_transaction"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."normalize_driver_wallet_transaction"() TO "service_role";



GRANT ALL ON FUNCTION "public"."normalize_payment_compat_fields"() TO "anon";
GRANT ALL ON FUNCTION "public"."normalize_payment_compat_fields"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."normalize_payment_compat_fields"() TO "service_role";



GRANT ALL ON FUNCTION "public"."notify_referral_event"("p_referral_id" "uuid", "p_referral_type" "text", "p_event_type" "text", "p_referrer_id" "uuid", "p_referred_name" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."notify_referral_event"("p_referral_id" "uuid", "p_referral_type" "text", "p_event_type" "text", "p_referrer_id" "uuid", "p_referred_name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."notify_referral_event"("p_referral_id" "uuid", "p_referral_type" "text", "p_event_type" "text", "p_referrer_id" "uuid", "p_referred_name" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."platform_escrow_summary"() TO "anon";
GRANT ALL ON FUNCTION "public"."platform_escrow_summary"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."platform_escrow_summary"() TO "service_role";



GRANT ALL ON FUNCTION "public"."process_ride_payment"("p_ride_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."process_ride_payment"("p_ride_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."process_ride_payment"("p_ride_id" "uuid") TO "service_role";



GRANT ALL ON TABLE "public"."trip_queue" TO "anon";
GRANT ALL ON TABLE "public"."trip_queue" TO "authenticated";
GRANT ALL ON TABLE "public"."trip_queue" TO "service_role";



GRANT ALL ON FUNCTION "public"."queue_next_ride_for_driver"("p_driver_id" "uuid", "p_ride_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."queue_next_ride_for_driver"("p_driver_id" "uuid", "p_ride_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."queue_next_ride_for_driver"("p_driver_id" "uuid", "p_ride_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."recalculate_rider_rating"("p_rider_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."recalculate_rider_rating"("p_rider_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."recalculate_rider_rating"("p_rider_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."redeem_loyalty_reward"("p_rider_id" "uuid", "p_reward_definition_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."redeem_loyalty_reward"("p_rider_id" "uuid", "p_reward_definition_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."redeem_loyalty_reward"("p_rider_id" "uuid", "p_reward_definition_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."redeem_loyalty_reward_v2"("p_rider_id" "uuid", "p_reward_definition_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."redeem_loyalty_reward_v2"("p_rider_id" "uuid", "p_reward_definition_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."redeem_loyalty_reward_v2"("p_rider_id" "uuid", "p_reward_definition_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."rider_cancel_ride"("p_ride_id" "uuid", "p_reason" "text", "p_rider_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."rider_cancel_ride"("p_ride_id" "uuid", "p_reason" "text", "p_rider_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rider_cancel_ride"("p_ride_id" "uuid", "p_reason" "text", "p_rider_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."rider_cancel_ride"("p_ride_id" "uuid", "p_reason" "text", "p_rider_id" "uuid", "p_note" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."rider_cancel_ride"("p_ride_id" "uuid", "p_reason" "text", "p_rider_id" "uuid", "p_note" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rider_cancel_ride"("p_ride_id" "uuid", "p_reason" "text", "p_rider_id" "uuid", "p_note" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."rider_prepay_ride"("p_ride_id" "uuid", "p_rider_id" "uuid", "p_fare_amount" numeric, "p_booking_fee" numeric, "p_payment_method" "text", "p_payment_reference" "text", "p_provider_reference" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."rider_prepay_ride"("p_ride_id" "uuid", "p_rider_id" "uuid", "p_fare_amount" numeric, "p_booking_fee" numeric, "p_payment_method" "text", "p_payment_reference" "text", "p_provider_reference" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rider_prepay_ride"("p_ride_id" "uuid", "p_rider_id" "uuid", "p_fare_amount" numeric, "p_booking_fee" numeric, "p_payment_method" "text", "p_payment_reference" "text", "p_provider_reference" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."rider_wallet_pay_ride"("p_rider_id" "uuid", "p_ride_id" "uuid", "p_amount" numeric) TO "anon";
GRANT ALL ON FUNCTION "public"."rider_wallet_pay_ride"("p_rider_id" "uuid", "p_ride_id" "uuid", "p_amount" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."rider_wallet_pay_ride"("p_rider_id" "uuid", "p_ride_id" "uuid", "p_amount" numeric) TO "service_role";



GRANT ALL ON FUNCTION "public"."rider_wallet_top_up"("p_rider_id" "uuid", "p_amount" numeric, "p_method" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."rider_wallet_top_up"("p_rider_id" "uuid", "p_amount" numeric, "p_method" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rider_wallet_top_up"("p_rider_id" "uuid", "p_amount" numeric, "p_method" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."rider_wallet_transfer"("p_rider_id" "uuid", "p_amount" numeric, "p_recipient" "text", "p_method" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."rider_wallet_transfer"("p_rider_id" "uuid", "p_amount" numeric, "p_recipient" "text", "p_method" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rider_wallet_transfer"("p_rider_id" "uuid", "p_amount" numeric, "p_recipient" "text", "p_method" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."send_push_notification"("p_notification_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."send_push_notification"("p_notification_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."send_push_notification"("p_notification_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."service_zones_audit_trigger"() TO "anon";
GRANT ALL ON FUNCTION "public"."service_zones_audit_trigger"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."service_zones_audit_trigger"() TO "service_role";



GRANT ALL ON FUNCTION "public"."service_zones_set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."service_zones_set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."service_zones_set_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_referral_setting"("p_key" "text", "p_value" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."set_referral_setting"("p_key" "text", "p_value" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_referral_setting"("p_key" "text", "p_value" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."start_ride_with_pin"("p_ride_id" "uuid", "p_pin" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."start_ride_with_pin"("p_ride_id" "uuid", "p_pin" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."start_ride_with_pin"("p_ride_id" "uuid", "p_pin" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_driver_wallet_balance_columns"() TO "anon";
GRANT ALL ON FUNCTION "public"."sync_driver_wallet_balance_columns"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_driver_wallet_balance_columns"() TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_driver_wallet_transaction_to_payout_request"() TO "anon";
GRANT ALL ON FUNCTION "public"."sync_driver_wallet_transaction_to_payout_request"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_driver_wallet_transaction_to_payout_request"() TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_payout_request_status_to_driver_wallet"() TO "anon";
GRANT ALL ON FUNCTION "public"."sync_payout_request_status_to_driver_wallet"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_payout_request_status_to_driver_wallet"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trg_notify_driver_referral_change"() TO "anon";
GRANT ALL ON FUNCTION "public"."trg_notify_driver_referral_change"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_notify_driver_referral_change"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trg_notify_rider_referral_change"() TO "anon";
GRANT ALL ON FUNCTION "public"."trg_notify_rider_referral_change"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_notify_rider_referral_change"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trigger_recalculate_rider_rating"() TO "anon";
GRANT ALL ON FUNCTION "public"."trigger_recalculate_rider_rating"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trigger_recalculate_rider_rating"() TO "service_role";



GRANT ALL ON TABLE "public"."driver_locations" TO "anon";
GRANT ALL ON TABLE "public"."driver_locations" TO "authenticated";
GRANT ALL ON TABLE "public"."driver_locations" TO "service_role";



GRANT ALL ON FUNCTION "public"."update_driver_location"("p_driver_id" "uuid", "p_latitude" double precision, "p_longitude" double precision, "p_heading" double precision, "p_speed" double precision, "p_accuracy" double precision, "p_is_online" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."update_driver_location"("p_driver_id" "uuid", "p_latitude" double precision, "p_longitude" double precision, "p_heading" double precision, "p_speed" double precision, "p_accuracy" double precision, "p_is_online" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_driver_location"("p_driver_id" "uuid", "p_latitude" double precision, "p_longitude" double precision, "p_heading" double precision, "p_speed" double precision, "p_accuracy" double precision, "p_is_online" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "service_role";



GRANT ALL ON FUNCTION "public"."use_rider_reward"("p_reward_id" "uuid", "p_ride_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."use_rider_reward"("p_reward_id" "uuid", "p_ride_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."use_rider_reward"("p_reward_id" "uuid", "p_ride_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."uuid_generate_v4"() TO "anon";
GRANT ALL ON FUNCTION "public"."uuid_generate_v4"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."uuid_generate_v4"() TO "service_role";



GRANT ALL ON FUNCTION "public"."validate_driver_approval"() TO "anon";
GRANT ALL ON FUNCTION "public"."validate_driver_approval"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."validate_driver_approval"() TO "service_role";



GRANT ALL ON FUNCTION "public"."validate_promo_code"("p_code" "text", "p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."validate_promo_code"("p_code" "text", "p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."validate_promo_code"("p_code" "text", "p_user_id" "uuid") TO "service_role";



GRANT ALL ON TABLE "public"."admin_audit_logs" TO "anon";
GRANT ALL ON TABLE "public"."admin_audit_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."admin_audit_logs" TO "service_role";



GRANT ALL ON TABLE "public"."admin_payout_actions" TO "anon";
GRANT ALL ON TABLE "public"."admin_payout_actions" TO "authenticated";
GRANT ALL ON TABLE "public"."admin_payout_actions" TO "service_role";



GRANT ALL ON TABLE "public"."admin_permissions" TO "anon";
GRANT ALL ON TABLE "public"."admin_permissions" TO "authenticated";
GRANT ALL ON TABLE "public"."admin_permissions" TO "service_role";



GRANT ALL ON TABLE "public"."admin_roles" TO "anon";
GRANT ALL ON TABLE "public"."admin_roles" TO "authenticated";
GRANT ALL ON TABLE "public"."admin_roles" TO "service_role";



GRANT ALL ON TABLE "public"."admin_settings_audit_logs" TO "anon";
GRANT ALL ON TABLE "public"."admin_settings_audit_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."admin_settings_audit_logs" TO "service_role";



GRANT ALL ON TABLE "public"."admin_users" TO "anon";
GRANT ALL ON TABLE "public"."admin_users" TO "authenticated";
GRANT ALL ON TABLE "public"."admin_users" TO "service_role";



GRANT ALL ON TABLE "public"."airport_zone_queue" TO "anon";
GRANT ALL ON TABLE "public"."airport_zone_queue" TO "authenticated";
GRANT ALL ON TABLE "public"."airport_zone_queue" TO "service_role";



GRANT ALL ON TABLE "public"."app_settings" TO "anon";
GRANT ALL ON TABLE "public"."app_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."app_settings" TO "service_role";



GRANT ALL ON TABLE "public"."audit_logs" TO "anon";
GRANT ALL ON TABLE "public"."audit_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."audit_logs" TO "service_role";



GRANT ALL ON TABLE "public"."cities" TO "anon";
GRANT ALL ON TABLE "public"."cities" TO "authenticated";
GRANT ALL ON TABLE "public"."cities" TO "service_role";



GRANT ALL ON TABLE "public"."commission_configs" TO "anon";
GRANT ALL ON TABLE "public"."commission_configs" TO "authenticated";
GRANT ALL ON TABLE "public"."commission_configs" TO "service_role";



GRANT ALL ON TABLE "public"."commission_rules" TO "anon";
GRANT ALL ON TABLE "public"."commission_rules" TO "authenticated";
GRANT ALL ON TABLE "public"."commission_rules" TO "service_role";



GRANT ALL ON TABLE "public"."company_commissions" TO "anon";
GRANT ALL ON TABLE "public"."company_commissions" TO "authenticated";
GRANT ALL ON TABLE "public"."company_commissions" TO "service_role";



GRANT ALL ON TABLE "public"."company_transactions" TO "anon";
GRANT ALL ON TABLE "public"."company_transactions" TO "authenticated";
GRANT ALL ON TABLE "public"."company_transactions" TO "service_role";



GRANT ALL ON TABLE "public"."customer_segments" TO "anon";
GRANT ALL ON TABLE "public"."customer_segments" TO "authenticated";
GRANT ALL ON TABLE "public"."customer_segments" TO "service_role";



GRANT ALL ON TABLE "public"."demand_event_responses" TO "anon";
GRANT ALL ON TABLE "public"."demand_event_responses" TO "authenticated";
GRANT ALL ON TABLE "public"."demand_event_responses" TO "service_role";



GRANT ALL ON TABLE "public"."demand_events" TO "anon";
GRANT ALL ON TABLE "public"."demand_events" TO "authenticated";
GRANT ALL ON TABLE "public"."demand_events" TO "service_role";



GRANT ALL ON TABLE "public"."dispatch_queue" TO "anon";
GRANT ALL ON TABLE "public"."dispatch_queue" TO "authenticated";
GRANT ALL ON TABLE "public"."dispatch_queue" TO "service_role";



GRANT ALL ON TABLE "public"."dispute_evidence" TO "anon";
GRANT ALL ON TABLE "public"."dispute_evidence" TO "authenticated";
GRANT ALL ON TABLE "public"."dispute_evidence" TO "service_role";



GRANT ALL ON TABLE "public"."dispute_messages" TO "anon";
GRANT ALL ON TABLE "public"."dispute_messages" TO "authenticated";
GRANT ALL ON TABLE "public"."dispute_messages" TO "service_role";



GRANT ALL ON TABLE "public"."dispute_status_history" TO "anon";
GRANT ALL ON TABLE "public"."dispute_status_history" TO "authenticated";
GRANT ALL ON TABLE "public"."dispute_status_history" TO "service_role";



GRANT ALL ON TABLE "public"."driver_achievement_unlocks" TO "anon";
GRANT ALL ON TABLE "public"."driver_achievement_unlocks" TO "authenticated";
GRANT ALL ON TABLE "public"."driver_achievement_unlocks" TO "service_role";



GRANT ALL ON TABLE "public"."driver_achievements" TO "anon";
GRANT ALL ON TABLE "public"."driver_achievements" TO "authenticated";
GRANT ALL ON TABLE "public"."driver_achievements" TO "service_role";



GRANT ALL ON TABLE "public"."driver_applications" TO "anon";
GRANT ALL ON TABLE "public"."driver_applications" TO "authenticated";
GRANT ALL ON TABLE "public"."driver_applications" TO "service_role";



GRANT ALL ON TABLE "public"."driver_daily_earnings" TO "anon";
GRANT ALL ON TABLE "public"."driver_daily_earnings" TO "authenticated";
GRANT ALL ON TABLE "public"."driver_daily_earnings" TO "service_role";



GRANT ALL ON TABLE "public"."driver_documents" TO "anon";
GRANT ALL ON TABLE "public"."driver_documents" TO "authenticated";
GRANT ALL ON TABLE "public"."driver_documents" TO "service_role";



GRANT ALL ON TABLE "public"."driver_loyalty_accounts" TO "anon";
GRANT ALL ON TABLE "public"."driver_loyalty_accounts" TO "authenticated";
GRANT ALL ON TABLE "public"."driver_loyalty_accounts" TO "service_role";



GRANT ALL ON TABLE "public"."driver_messages" TO "anon";
GRANT ALL ON TABLE "public"."driver_messages" TO "authenticated";
GRANT ALL ON TABLE "public"."driver_messages" TO "service_role";



GRANT ALL ON TABLE "public"."driver_mission_progress" TO "anon";
GRANT ALL ON TABLE "public"."driver_mission_progress" TO "authenticated";
GRANT ALL ON TABLE "public"."driver_mission_progress" TO "service_role";



GRANT ALL ON TABLE "public"."driver_missions" TO "anon";
GRANT ALL ON TABLE "public"."driver_missions" TO "authenticated";
GRANT ALL ON TABLE "public"."driver_missions" TO "service_role";



GRANT ALL ON TABLE "public"."driver_payout_methods" TO "anon";
GRANT ALL ON TABLE "public"."driver_payout_methods" TO "authenticated";
GRANT ALL ON TABLE "public"."driver_payout_methods" TO "service_role";



GRANT ALL ON TABLE "public"."driver_payout_requests" TO "anon";
GRANT ALL ON TABLE "public"."driver_payout_requests" TO "authenticated";
GRANT ALL ON TABLE "public"."driver_payout_requests" TO "service_role";



GRANT ALL ON TABLE "public"."driver_payouts" TO "anon";
GRANT ALL ON TABLE "public"."driver_payouts" TO "authenticated";
GRANT ALL ON TABLE "public"."driver_payouts" TO "service_role";



GRANT ALL ON TABLE "public"."driver_penalties" TO "anon";
GRANT ALL ON TABLE "public"."driver_penalties" TO "authenticated";
GRANT ALL ON TABLE "public"."driver_penalties" TO "service_role";



GRANT ALL ON TABLE "public"."driver_performance" TO "anon";
GRANT ALL ON TABLE "public"."driver_performance" TO "authenticated";
GRANT ALL ON TABLE "public"."driver_performance" TO "service_role";



GRANT ALL ON TABLE "public"."driver_referrals" TO "anon";
GRANT ALL ON TABLE "public"."driver_referrals" TO "authenticated";
GRANT ALL ON TABLE "public"."driver_referrals" TO "service_role";



GRANT ALL ON TABLE "public"."driver_rewards" TO "anon";
GRANT ALL ON TABLE "public"."driver_rewards" TO "authenticated";
GRANT ALL ON TABLE "public"."driver_rewards" TO "service_role";



GRANT ALL ON TABLE "public"."driver_safety_contacts" TO "anon";
GRANT ALL ON TABLE "public"."driver_safety_contacts" TO "authenticated";
GRANT ALL ON TABLE "public"."driver_safety_contacts" TO "service_role";



GRANT ALL ON TABLE "public"."driver_settings" TO "anon";
GRANT ALL ON TABLE "public"."driver_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."driver_settings" TO "service_role";



GRANT ALL ON TABLE "public"."driver_transactions" TO "anon";
GRANT ALL ON TABLE "public"."driver_transactions" TO "authenticated";
GRANT ALL ON TABLE "public"."driver_transactions" TO "service_role";



GRANT ALL ON TABLE "public"."driver_wallet_transactions" TO "anon";
GRANT ALL ON TABLE "public"."driver_wallet_transactions" TO "authenticated";
GRANT ALL ON TABLE "public"."driver_wallet_transactions" TO "service_role";



GRANT ALL ON TABLE "public"."driver_wallets" TO "anon";
GRANT ALL ON TABLE "public"."driver_wallets" TO "authenticated";
GRANT ALL ON TABLE "public"."driver_wallets" TO "service_role";



GRANT ALL ON TABLE "public"."drivers" TO "anon";
GRANT ALL ON TABLE "public"."drivers" TO "authenticated";
GRANT ALL ON TABLE "public"."drivers" TO "service_role";



GRANT ALL ON TABLE "public"."emergency_alerts" TO "anon";
GRANT ALL ON TABLE "public"."emergency_alerts" TO "authenticated";
GRANT ALL ON TABLE "public"."emergency_alerts" TO "service_role";



GRANT ALL ON TABLE "public"."emergency_contacts" TO "anon";
GRANT ALL ON TABLE "public"."emergency_contacts" TO "authenticated";
GRANT ALL ON TABLE "public"."emergency_contacts" TO "service_role";



GRANT ALL ON TABLE "public"."emergency_responses" TO "anon";
GRANT ALL ON TABLE "public"."emergency_responses" TO "authenticated";
GRANT ALL ON TABLE "public"."emergency_responses" TO "service_role";



GRANT ALL ON TABLE "public"."fare_estimation_logs" TO "anon";
GRANT ALL ON TABLE "public"."fare_estimation_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."fare_estimation_logs" TO "service_role";



GRANT ALL ON TABLE "public"."fraud_flags" TO "anon";
GRANT ALL ON TABLE "public"."fraud_flags" TO "authenticated";
GRANT ALL ON TABLE "public"."fraud_flags" TO "service_role";



GRANT ALL ON TABLE "public"."fraud_protection_rules" TO "anon";
GRANT ALL ON TABLE "public"."fraud_protection_rules" TO "authenticated";
GRANT ALL ON TABLE "public"."fraud_protection_rules" TO "service_role";



GRANT ALL ON TABLE "public"."incident_assignments" TO "anon";
GRANT ALL ON TABLE "public"."incident_assignments" TO "authenticated";
GRANT ALL ON TABLE "public"."incident_assignments" TO "service_role";



GRANT ALL ON TABLE "public"."incident_evidence" TO "anon";
GRANT ALL ON TABLE "public"."incident_evidence" TO "authenticated";
GRANT ALL ON TABLE "public"."incident_evidence" TO "service_role";



GRANT ALL ON TABLE "public"."incident_notes" TO "anon";
GRANT ALL ON TABLE "public"."incident_notes" TO "authenticated";
GRANT ALL ON TABLE "public"."incident_notes" TO "service_role";



GRANT ALL ON TABLE "public"."incident_status_history" TO "anon";
GRANT ALL ON TABLE "public"."incident_status_history" TO "authenticated";
GRANT ALL ON TABLE "public"."incident_status_history" TO "service_role";



GRANT ALL ON TABLE "public"."incident_timeline" TO "anon";
GRANT ALL ON TABLE "public"."incident_timeline" TO "authenticated";
GRANT ALL ON TABLE "public"."incident_timeline" TO "service_role";



GRANT ALL ON TABLE "public"."incidents" TO "anon";
GRANT ALL ON TABLE "public"."incidents" TO "authenticated";
GRANT ALL ON TABLE "public"."incidents" TO "service_role";



GRANT ALL ON TABLE "public"."integration_logs" TO "anon";
GRANT ALL ON TABLE "public"."integration_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."integration_logs" TO "service_role";



GRANT ALL ON TABLE "public"."integrations" TO "anon";
GRANT ALL ON TABLE "public"."integrations" TO "authenticated";
GRANT ALL ON TABLE "public"."integrations" TO "service_role";



GRANT ALL ON TABLE "public"."loyalty_notifications" TO "anon";
GRANT ALL ON TABLE "public"."loyalty_notifications" TO "authenticated";
GRANT ALL ON TABLE "public"."loyalty_notifications" TO "service_role";



GRANT ALL ON TABLE "public"."loyalty_points_transactions" TO "anon";
GRANT ALL ON TABLE "public"."loyalty_points_transactions" TO "authenticated";
GRANT ALL ON TABLE "public"."loyalty_points_transactions" TO "service_role";



GRANT ALL ON TABLE "public"."loyalty_tier_config" TO "anon";
GRANT ALL ON TABLE "public"."loyalty_tier_config" TO "authenticated";
GRANT ALL ON TABLE "public"."loyalty_tier_config" TO "service_role";



GRANT ALL ON TABLE "public"."loyalty_tiers" TO "anon";
GRANT ALL ON TABLE "public"."loyalty_tiers" TO "authenticated";
GRANT ALL ON TABLE "public"."loyalty_tiers" TO "service_role";



GRANT ALL ON TABLE "public"."marketing_banners" TO "anon";
GRANT ALL ON TABLE "public"."marketing_banners" TO "authenticated";
GRANT ALL ON TABLE "public"."marketing_banners" TO "service_role";



GRANT ALL ON TABLE "public"."marketing_campaigns" TO "anon";
GRANT ALL ON TABLE "public"."marketing_campaigns" TO "authenticated";
GRANT ALL ON TABLE "public"."marketing_campaigns" TO "service_role";



GRANT ALL ON TABLE "public"."marketing_events" TO "anon";
GRANT ALL ON TABLE "public"."marketing_events" TO "authenticated";
GRANT ALL ON TABLE "public"."marketing_events" TO "service_role";



GRANT ALL ON TABLE "public"."moderation_actions" TO "anon";
GRANT ALL ON TABLE "public"."moderation_actions" TO "authenticated";
GRANT ALL ON TABLE "public"."moderation_actions" TO "service_role";



GRANT ALL ON TABLE "public"."moderation_appeals" TO "anon";
GRANT ALL ON TABLE "public"."moderation_appeals" TO "authenticated";
GRANT ALL ON TABLE "public"."moderation_appeals" TO "service_role";



GRANT ALL ON TABLE "public"."moderation_cases" TO "anon";
GRANT ALL ON TABLE "public"."moderation_cases" TO "authenticated";
GRANT ALL ON TABLE "public"."moderation_cases" TO "service_role";



GRANT ALL ON TABLE "public"."moderation_evidence" TO "anon";
GRANT ALL ON TABLE "public"."moderation_evidence" TO "authenticated";
GRANT ALL ON TABLE "public"."moderation_evidence" TO "service_role";



GRANT ALL ON TABLE "public"."notification_delivery_logs" TO "anon";
GRANT ALL ON TABLE "public"."notification_delivery_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."notification_delivery_logs" TO "service_role";



GRANT ALL ON TABLE "public"."notifications" TO "anon";
GRANT ALL ON TABLE "public"."notifications" TO "authenticated";
GRANT ALL ON TABLE "public"."notifications" TO "service_role";



GRANT ALL ON TABLE "public"."payment_transactions" TO "anon";
GRANT ALL ON TABLE "public"."payment_transactions" TO "authenticated";
GRANT ALL ON TABLE "public"."payment_transactions" TO "service_role";



GRANT ALL ON TABLE "public"."payments" TO "anon";
GRANT ALL ON TABLE "public"."payments" TO "authenticated";
GRANT ALL ON TABLE "public"."payments" TO "service_role";



GRANT ALL ON TABLE "public"."payout_audit_logs" TO "anon";
GRANT ALL ON TABLE "public"."payout_audit_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."payout_audit_logs" TO "service_role";



GRANT ALL ON TABLE "public"."payout_batches" TO "anon";
GRANT ALL ON TABLE "public"."payout_batches" TO "authenticated";
GRANT ALL ON TABLE "public"."payout_batches" TO "service_role";



GRANT ALL ON TABLE "public"."payout_settings" TO "anon";
GRANT ALL ON TABLE "public"."payout_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."payout_settings" TO "service_role";



GRANT ALL ON TABLE "public"."places" TO "anon";
GRANT ALL ON TABLE "public"."places" TO "authenticated";
GRANT ALL ON TABLE "public"."places" TO "service_role";



GRANT ALL ON TABLE "public"."platform_escrow" TO "anon";
GRANT ALL ON TABLE "public"."platform_escrow" TO "authenticated";
GRANT ALL ON TABLE "public"."platform_escrow" TO "service_role";



GRANT ALL ON TABLE "public"."platform_feature_flags" TO "anon";
GRANT ALL ON TABLE "public"."platform_feature_flags" TO "authenticated";
GRANT ALL ON TABLE "public"."platform_feature_flags" TO "service_role";



GRANT ALL ON TABLE "public"."pricing_config" TO "anon";
GRANT ALL ON TABLE "public"."pricing_config" TO "authenticated";
GRANT ALL ON TABLE "public"."pricing_config" TO "service_role";



GRANT ALL ON TABLE "public"."pricing_driver_incentives" TO "anon";
GRANT ALL ON TABLE "public"."pricing_driver_incentives" TO "authenticated";
GRANT ALL ON TABLE "public"."pricing_driver_incentives" TO "service_role";



GRANT ALL ON TABLE "public"."pricing_surge_rules" TO "anon";
GRANT ALL ON TABLE "public"."pricing_surge_rules" TO "authenticated";
GRANT ALL ON TABLE "public"."pricing_surge_rules" TO "service_role";



GRANT ALL ON TABLE "public"."promo_codes" TO "anon";
GRANT ALL ON TABLE "public"."promo_codes" TO "authenticated";
GRANT ALL ON TABLE "public"."promo_codes" TO "service_role";



GRANT ALL ON TABLE "public"."promo_redemptions" TO "anon";
GRANT ALL ON TABLE "public"."promo_redemptions" TO "authenticated";
GRANT ALL ON TABLE "public"."promo_redemptions" TO "service_role";



GRANT ALL ON TABLE "public"."promotions" TO "anon";
GRANT ALL ON TABLE "public"."promotions" TO "authenticated";
GRANT ALL ON TABLE "public"."promotions" TO "service_role";



GRANT ALL ON TABLE "public"."push_notifications" TO "anon";
GRANT ALL ON TABLE "public"."push_notifications" TO "authenticated";
GRANT ALL ON TABLE "public"."push_notifications" TO "service_role";



GRANT ALL ON TABLE "public"."ratings" TO "anon";
GRANT ALL ON TABLE "public"."ratings" TO "authenticated";
GRANT ALL ON TABLE "public"."ratings" TO "service_role";



GRANT ALL ON TABLE "public"."referral_campaigns" TO "anon";
GRANT ALL ON TABLE "public"."referral_campaigns" TO "authenticated";
GRANT ALL ON TABLE "public"."referral_campaigns" TO "service_role";



GRANT ALL ON TABLE "public"."referral_events" TO "anon";
GRANT ALL ON TABLE "public"."referral_events" TO "authenticated";
GRANT ALL ON TABLE "public"."referral_events" TO "service_role";



GRANT ALL ON TABLE "public"."referral_fraud_checks" TO "anon";
GRANT ALL ON TABLE "public"."referral_fraud_checks" TO "authenticated";
GRANT ALL ON TABLE "public"."referral_fraud_checks" TO "service_role";



GRANT ALL ON TABLE "public"."referral_rewards" TO "anon";
GRANT ALL ON TABLE "public"."referral_rewards" TO "authenticated";
GRANT ALL ON TABLE "public"."referral_rewards" TO "service_role";



GRANT ALL ON TABLE "public"."referral_settings" TO "anon";
GRANT ALL ON TABLE "public"."referral_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."referral_settings" TO "service_role";



GRANT ALL ON TABLE "public"."refund_actions" TO "anon";
GRANT ALL ON TABLE "public"."refund_actions" TO "authenticated";
GRANT ALL ON TABLE "public"."refund_actions" TO "service_role";



GRANT ALL ON TABLE "public"."refund_audit_logs" TO "anon";
GRANT ALL ON TABLE "public"."refund_audit_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."refund_audit_logs" TO "service_role";



GRANT ALL ON TABLE "public"."refunds" TO "anon";
GRANT ALL ON TABLE "public"."refunds" TO "authenticated";
GRANT ALL ON TABLE "public"."refunds" TO "service_role";



GRANT ALL ON TABLE "public"."reward_definitions" TO "anon";
GRANT ALL ON TABLE "public"."reward_definitions" TO "authenticated";
GRANT ALL ON TABLE "public"."reward_definitions" TO "service_role";



GRANT ALL ON TABLE "public"."ride_categories" TO "anon";
GRANT ALL ON TABLE "public"."ride_categories" TO "authenticated";
GRANT ALL ON TABLE "public"."ride_categories" TO "service_role";



GRANT ALL ON TABLE "public"."ride_disputes" TO "anon";
GRANT ALL ON TABLE "public"."ride_disputes" TO "authenticated";
GRANT ALL ON TABLE "public"."ride_disputes" TO "service_role";



GRANT ALL ON TABLE "public"."ride_events" TO "anon";
GRANT ALL ON TABLE "public"."ride_events" TO "authenticated";
GRANT ALL ON TABLE "public"."ride_events" TO "service_role";



GRANT ALL ON TABLE "public"."ride_invoices" TO "anon";
GRANT ALL ON TABLE "public"."ride_invoices" TO "authenticated";
GRANT ALL ON TABLE "public"."ride_invoices" TO "service_role";



GRANT ALL ON TABLE "public"."ride_location_points" TO "anon";
GRANT ALL ON TABLE "public"."ride_location_points" TO "authenticated";
GRANT ALL ON TABLE "public"."ride_location_points" TO "service_role";



GRANT ALL ON TABLE "public"."ride_messages" TO "anon";
GRANT ALL ON TABLE "public"."ride_messages" TO "authenticated";
GRANT ALL ON TABLE "public"."ride_messages" TO "service_role";



GRANT ALL ON TABLE "public"."ride_requests" TO "anon";
GRANT ALL ON TABLE "public"."ride_requests" TO "authenticated";
GRANT ALL ON TABLE "public"."ride_requests" TO "service_role";



GRANT ALL ON TABLE "public"."ride_safety_events" TO "anon";
GRANT ALL ON TABLE "public"."ride_safety_events" TO "authenticated";
GRANT ALL ON TABLE "public"."ride_safety_events" TO "service_role";



GRANT ALL ON TABLE "public"."rider_ratings" TO "anon";
GRANT ALL ON TABLE "public"."rider_ratings" TO "authenticated";
GRANT ALL ON TABLE "public"."rider_ratings" TO "service_role";



GRANT ALL ON TABLE "public"."rider_referrals" TO "anon";
GRANT ALL ON TABLE "public"."rider_referrals" TO "authenticated";
GRANT ALL ON TABLE "public"."rider_referrals" TO "service_role";



GRANT ALL ON TABLE "public"."rider_rewards" TO "anon";
GRANT ALL ON TABLE "public"."rider_rewards" TO "authenticated";
GRANT ALL ON TABLE "public"."rider_rewards" TO "service_role";



GRANT ALL ON TABLE "public"."rider_settings" TO "anon";
GRANT ALL ON TABLE "public"."rider_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."rider_settings" TO "service_role";



GRANT ALL ON TABLE "public"."riders" TO "anon";
GRANT ALL ON TABLE "public"."riders" TO "authenticated";
GRANT ALL ON TABLE "public"."riders" TO "service_role";



GRANT ALL ON TABLE "public"."role_permissions" TO "anon";
GRANT ALL ON TABLE "public"."role_permissions" TO "authenticated";
GRANT ALL ON TABLE "public"."role_permissions" TO "service_role";



GRANT ALL ON TABLE "public"."safety_incidents" TO "anon";
GRANT ALL ON TABLE "public"."safety_incidents" TO "authenticated";
GRANT ALL ON TABLE "public"."safety_incidents" TO "service_role";



GRANT ALL ON TABLE "public"."service_zone_audit_logs" TO "anon";
GRANT ALL ON TABLE "public"."service_zone_audit_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."service_zone_audit_logs" TO "service_role";



GRANT ALL ON TABLE "public"."service_zones" TO "anon";
GRANT ALL ON TABLE "public"."service_zones" TO "authenticated";
GRANT ALL ON TABLE "public"."service_zones" TO "service_role";



GRANT ALL ON TABLE "public"."staff_invitations" TO "anon";
GRANT ALL ON TABLE "public"."staff_invitations" TO "authenticated";
GRANT ALL ON TABLE "public"."staff_invitations" TO "service_role";



GRANT ALL ON TABLE "public"."support_chat_messages" TO "anon";
GRANT ALL ON TABLE "public"."support_chat_messages" TO "authenticated";
GRANT ALL ON TABLE "public"."support_chat_messages" TO "service_role";



GRANT ALL ON TABLE "public"."support_chats" TO "anon";
GRANT ALL ON TABLE "public"."support_chats" TO "authenticated";
GRANT ALL ON TABLE "public"."support_chats" TO "service_role";



GRANT ALL ON TABLE "public"."support_tickets" TO "anon";
GRANT ALL ON TABLE "public"."support_tickets" TO "authenticated";
GRANT ALL ON TABLE "public"."support_tickets" TO "service_role";



GRANT ALL ON TABLE "public"."tax_configs" TO "anon";
GRANT ALL ON TABLE "public"."tax_configs" TO "authenticated";
GRANT ALL ON TABLE "public"."tax_configs" TO "service_role";



GRANT ALL ON TABLE "public"."tax_records" TO "anon";
GRANT ALL ON TABLE "public"."tax_records" TO "authenticated";
GRANT ALL ON TABLE "public"."tax_records" TO "service_role";



GRANT ALL ON TABLE "public"."trip_earnings" TO "anon";
GRANT ALL ON TABLE "public"."trip_earnings" TO "authenticated";
GRANT ALL ON TABLE "public"."trip_earnings" TO "service_role";



GRANT ALL ON TABLE "public"."user_notification_tokens" TO "anon";
GRANT ALL ON TABLE "public"."user_notification_tokens" TO "authenticated";
GRANT ALL ON TABLE "public"."user_notification_tokens" TO "service_role";



GRANT ALL ON TABLE "public"."user_risk_scores" TO "anon";
GRANT ALL ON TABLE "public"."user_risk_scores" TO "authenticated";
GRANT ALL ON TABLE "public"."user_risk_scores" TO "service_role";



GRANT ALL ON TABLE "public"."user_roles" TO "anon";
GRANT ALL ON TABLE "public"."user_roles" TO "authenticated";
GRANT ALL ON TABLE "public"."user_roles" TO "service_role";



GRANT ALL ON TABLE "public"."user_suspensions" TO "anon";
GRANT ALL ON TABLE "public"."user_suspensions" TO "authenticated";
GRANT ALL ON TABLE "public"."user_suspensions" TO "service_role";



GRANT ALL ON TABLE "public"."users" TO "anon";
GRANT ALL ON TABLE "public"."users" TO "authenticated";
GRANT ALL ON TABLE "public"."users" TO "service_role";



GRANT ALL ON TABLE "public"."vehicle_maintenance_records" TO "anon";
GRANT ALL ON TABLE "public"."vehicle_maintenance_records" TO "authenticated";
GRANT ALL ON TABLE "public"."vehicle_maintenance_records" TO "service_role";



GRANT ALL ON TABLE "public"."vehicles" TO "anon";
GRANT ALL ON TABLE "public"."vehicles" TO "authenticated";
GRANT ALL ON TABLE "public"."vehicles" TO "service_role";



GRANT ALL ON TABLE "public"."wallet_transactions" TO "anon";
GRANT ALL ON TABLE "public"."wallet_transactions" TO "authenticated";
GRANT ALL ON TABLE "public"."wallet_transactions" TO "service_role";



GRANT ALL ON TABLE "public"."weafrica_places" TO "anon";
GRANT ALL ON TABLE "public"."weafrica_places" TO "authenticated";
GRANT ALL ON TABLE "public"."weafrica_places" TO "service_role";



GRANT ALL ON TABLE "public"."webhook_events" TO "anon";
GRANT ALL ON TABLE "public"."webhook_events" TO "authenticated";
GRANT ALL ON TABLE "public"."webhook_events" TO "service_role";



GRANT ALL ON TABLE "public"."whatsapp_conversations" TO "anon";
GRANT ALL ON TABLE "public"."whatsapp_conversations" TO "authenticated";
GRANT ALL ON TABLE "public"."whatsapp_conversations" TO "service_role";



GRANT ALL ON TABLE "public"."whatsapp_ride_requests" TO "anon";
GRANT ALL ON TABLE "public"."whatsapp_ride_requests" TO "authenticated";
GRANT ALL ON TABLE "public"."whatsapp_ride_requests" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";







