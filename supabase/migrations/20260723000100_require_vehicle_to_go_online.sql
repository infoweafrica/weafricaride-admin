-- A driver with no vehicle assigned should not be able to go online —
-- there's nothing for the dispatch system to match a ride request against.
-- Adds a guard to driver_go_online returning a distinct 'no_vehicle' error
-- so the app can show a clear "add a vehicle first" message instead of
-- silently letting them appear online with no vehicle_type.

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

  IF v_driver.vehicle_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'no_vehicle');
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
