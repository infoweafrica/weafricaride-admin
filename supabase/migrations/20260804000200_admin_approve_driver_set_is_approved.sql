-- driver_go_online() gates on THREE separate columns: is_approved,
-- approval_status = 'approved', and can_go_online — but admin_approve_driver's
-- Stage 2 branch only ever set approval_status and can_go_online, never
-- is_approved. That left every fully-approved driver permanently unable to
-- go online with error 'driver_not_approved', since is_approved stayed at
-- its default false. Setting it alongside the other two so they can't drift
-- apart again.

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
        is_approved = true,
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

-- One-off backfill: any driver already sitting at approval_status='approved'
-- from before this fix existed would otherwise stay permanently blocked.
UPDATE drivers SET is_approved = true WHERE approval_status = 'approved' AND is_approved IS NOT TRUE;
