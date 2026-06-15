-- ====================================
-- Connect Rider App Bookings to Driver + Admin Flow
-- ====================================
-- Rider app creates rides. This RPC creates ride_requests for online drivers so
-- the driver app receives realtime requests, while the admin dashboard continues
-- to manage the canonical rides rows.

ALTER TABLE public.ride_requests
  ADD COLUMN IF NOT EXISTS pickup_address TEXT,
  ADD COLUMN IF NOT EXISTS pickup_lat DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS pickup_lng DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS destination_address TEXT,
  ADD COLUMN IF NOT EXISTS destination_lat DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS destination_lng DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS vehicle_class TEXT,
  ADD COLUMN IF NOT EXISTS estimated_fare NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS payment_method TEXT;

CREATE INDEX IF NOT EXISTS idx_rides_requested_dispatch
  ON public.rides(status, created_at)
  WHERE status IN ('requested', 'searching');

CREATE OR REPLACE FUNCTION public.dispatch_ride_to_nearby_drivers(
  p_ride_id UUID,
  p_pickup_lat DOUBLE PRECISION DEFAULT NULL,
  p_pickup_lng DOUBLE PRECISION DEFAULT NULL,
  p_max_drivers INTEGER DEFAULT 5
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

GRANT EXECUTE ON FUNCTION public.dispatch_ride_to_nearby_drivers(UUID, DOUBLE PRECISION, DOUBLE PRECISION, INTEGER) TO anon, authenticated;

-- ====================================
-- Driver app Firebase/anon-safe trip RPCs
-- ====================================
-- A previous migration recreated accept/cancel with auth.uid() lookups. The
-- mobile apps use Firebase Auth with the Supabase anon client, so these RPCs
-- must authorize by request/ride ownership in the data itself.

DROP FUNCTION IF EXISTS public.accept_ride_request(UUID);
CREATE OR REPLACE FUNCTION public.accept_ride_request(p_request_id UUID)
RETURNS public.rides
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

DROP FUNCTION IF EXISTS public.driver_cancel_ride(UUID, TEXT, TEXT);
CREATE OR REPLACE FUNCTION public.driver_cancel_ride(
  p_ride_id UUID,
  p_reason TEXT DEFAULT 'Other',
  p_note TEXT DEFAULT NULL
)
RETURNS public.rides
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

GRANT EXECUTE ON FUNCTION public.accept_ride_request(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.driver_cancel_ride(UUID, TEXT, TEXT) TO anon, authenticated;

-- ====================================
-- Dispatch cleanup/retry compatibility
-- ====================================
-- Ensure ON CONFLICT (ride_id, driver_id) is valid on older databases and make
-- expiry cleanup call this dispatch RPC directly instead of relying on a
-- separate webhook/job_queue.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    WHERE i.indrelid = 'public.ride_requests'::regclass
      AND i.indisunique
      AND i.indpred IS NULL
      AND i.indexprs IS NULL
      AND ARRAY(
        SELECT a.attname
        FROM unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord)
        JOIN pg_attribute a
          ON a.attrelid = i.indrelid
         AND a.attnum = k.attnum
        ORDER BY k.ord
      ) = ARRAY['ride_id', 'driver_id']
  ) THEN
    DELETE FROM public.ride_requests rr
    USING (
      SELECT ctid,
             row_number() OVER (
               PARTITION BY ride_id, driver_id
               ORDER BY
                 CASE status
                   WHEN 'accepted' THEN 0
                   WHEN 'pending' THEN 1
                   ELSE 2
                 END,
                 responded_at DESC NULLS LAST,
                 expires_at DESC NULLS LAST,
                 created_at DESC NULLS LAST,
                 id DESC
             ) AS rn
      FROM public.ride_requests
      WHERE ride_id IS NOT NULL
        AND driver_id IS NOT NULL
    ) ranked
    WHERE rr.ctid = ranked.ctid
      AND ranked.rn > 1;

    ALTER TABLE public.ride_requests
      ADD CONSTRAINT ride_requests_ride_id_driver_id_key UNIQUE (ride_id, driver_id);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.expire_stale_ride_requests()
RETURNS SETOF public.rides
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

GRANT EXECUTE ON FUNCTION public.expire_stale_ride_requests() TO anon, authenticated;
