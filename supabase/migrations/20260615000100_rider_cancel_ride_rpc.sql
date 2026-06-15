-- ====================================
-- WeAfrica Ride — Rider Cancellation RPC
-- ====================================
-- Mobile apps authenticate with Firebase and call Supabase with the anon key.
-- This SECURITY DEFINER RPC performs the trusted rider cancellation transition
-- while verifying the ride belongs to the supplied riders.id.

ALTER TABLE public.rides
  ADD COLUMN IF NOT EXISTS cancellation_reason TEXT,
  ADD COLUMN IF NOT EXISTS cancellation_note TEXT,
  ADD COLUMN IF NOT EXISTS cancelled_by TEXT,
  ADD COLUMN IF NOT EXISTS cancellation_fee NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

CREATE OR REPLACE FUNCTION public.rider_cancel_ride(
  p_ride_id UUID,
  p_reason TEXT DEFAULT 'Cancelled by rider',
  p_rider_id UUID DEFAULT NULL,
  p_note TEXT DEFAULT NULL
)
RETURNS public.rides
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

GRANT EXECUTE ON FUNCTION public.rider_cancel_ride(UUID, TEXT, UUID, TEXT) TO anon, authenticated;
