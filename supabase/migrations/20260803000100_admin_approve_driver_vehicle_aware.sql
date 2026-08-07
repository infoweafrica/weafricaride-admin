-- admin_approve_driver's Stage 1 branch (pending_verification/legacy
-- pending -> approved_driver) always sent the driver to "approved_driver"
-- ("needs vehicle"), even when a vehicle was already submitted alongside
-- identity in the same application (own_vehicle drivers submit both in one
-- upsert — see driver-app onboarding_screen.dart's single-form submit).
-- That left drivers stuck seeing "Register Vehicle" in the app for a
-- vehicle that was already in the database, because the app's stage
-- routing (driver_shell.dart) reads approval_status as a string state
-- machine, not "does vehicle_id exist". Now checks vehicle_id before
-- deciding the target status.
--
-- Does NOT retroactively fix drivers already stuck at approved_driver with
-- a vehicle attached (e.g. Steve Joe, id 7092e137-b2cc-4fd4-8e43-aaf387c3acaa)
-- — the "already approved" branch below intentionally no-ops on repeat
-- calls, so those need a one-off manual UPDATE.

CREATE OR REPLACE FUNCTION public.admin_approve_driver(p_driver_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_status TEXT;
  v_has_vehicle BOOLEAN;
BEGIN
  SELECT approval_status, vehicle_id IS NOT NULL INTO v_status, v_has_vehicle
  FROM drivers
  WHERE id = p_driver_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Driver not found');
  END IF;

  -- Stage 1: pending_verification → approve identity
  IF v_status = 'pending_verification' THEN
    UPDATE drivers
    SET approval_status = CASE WHEN v_has_vehicle THEN 'pending_vehicle_review' ELSE 'approved_driver' END,
        documents_verified = true,
        identity_verified_at = NOW(),
        rejection_reason = NULL,
        updated_at = NOW()
    WHERE id = p_driver_id;
    RETURN jsonb_build_object('success', true, 'stage', CASE WHEN v_has_vehicle THEN 'identity_and_vehicle_approved' ELSE 'identity_approved' END);
  END IF;

  -- Stage 1 → old-style: 'pending' (legacy)
  IF v_status = 'pending' THEN
    UPDATE drivers
    SET approval_status = CASE WHEN v_has_vehicle THEN 'pending_vehicle_review' ELSE 'approved_driver' END,
        documents_verified = true,
        identity_verified_at = NOW(),
        rejection_reason = NULL,
        updated_at = NOW()
    WHERE id = p_driver_id;
    RETURN jsonb_build_object('success', true, 'stage', CASE WHEN v_has_vehicle THEN 'identity_and_vehicle_approved' ELSE 'identity_approved' END);
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
$function$;
