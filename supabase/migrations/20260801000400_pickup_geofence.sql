-- ============================================================
-- Server-side pickup geofence.
--
-- driver_arrived() never checked driver location against pickup —
-- the blueprint explicitly calls for this ("driver must be within an
-- approved distance of pickup... prevents accidental or fraudulent
-- trip starts") and it was purely client-trusted before. Mirrors the
-- same Haversine + threshold pattern already used for the destination
-- check in complete_ride(), but blocks (RAISE EXCEPTION) rather than
-- just flagging, since arriving-from-nowhere is the case this exists
-- to prevent. If the caller doesn't pass coordinates (defensive —
-- shouldn't happen once driver-app is updated), the check is skipped
-- rather than blocking everyone.
-- ============================================================

CREATE OR REPLACE FUNCTION public.driver_arrived(p_ride_id uuid, p_driver_lat numeric DEFAULT NULL::numeric, p_driver_lng numeric DEFAULT NULL::numeric)
 RETURNS rides
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ride public.rides;
  v_transition jsonb;
  v_distance_to_pickup DECIMAL(8,2);
BEGIN
  SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ride not found';
  END IF;

  IF p_driver_lat IS NOT NULL AND p_driver_lng IS NOT NULL
     AND v_ride.pickup_lat IS NOT NULL AND v_ride.pickup_lng IS NOT NULL THEN
    SELECT
        6371 * 2 * ASIN(SQRT(
            POWER(SIN(RADIANS(p_driver_lat - v_ride.pickup_lat) / 2), 2) +
            COS(RADIANS(v_ride.pickup_lat)) * COS(RADIANS(p_driver_lat)) *
            POWER(SIN(RADIANS(p_driver_lng - v_ride.pickup_lng) / 2), 2)
        )) INTO v_distance_to_pickup;

    IF v_distance_to_pickup > 0.5 THEN  -- More than 500m from pickup
      RAISE EXCEPTION 'You are % km from the pickup location — too far to mark arrival', ROUND(v_distance_to_pickup, 2);
    END IF;
  END IF;

  v_transition := public.transition_trip_state(p_ride_id, 'arrived', v_ride.driver_id, 'driver', '{}'::jsonb);

  IF NOT (v_transition->>'success')::boolean THEN
    RAISE EXCEPTION 'Ride cannot be marked as arrived: %', v_transition->>'error';
  END IF;

  UPDATE public.rides
  SET arrived_at = now()
  WHERE id = p_ride_id
  RETURNING * INTO v_ride;

  INSERT INTO public.ride_events(ride_id, actor_id, event_type)
  VALUES (p_ride_id, v_ride.driver_id, 'driver_arrived');

  RETURN v_ride;
END;
$function$;
