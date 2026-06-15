-- ====================================
-- Rider App Booking RPC for Firebase/Anon Clients
-- ====================================
-- Keep admin-dashboard migration mirror in sync with root Supabase migrations.

ALTER TABLE public.rides
  ADD COLUMN IF NOT EXISTS pickup_address TEXT,
  ADD COLUMN IF NOT EXISTS pickup_lat DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS pickup_lng DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS dropoff_address TEXT,
  ADD COLUMN IF NOT EXISTS dropoff_lat DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS dropoff_lng DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS destination_address TEXT,
  ADD COLUMN IF NOT EXISTS destination_lat DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS destination_lng DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS vehicle_class TEXT DEFAULT 'weafrica_x',
  ADD COLUMN IF NOT EXISTS estimated_fare NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fare NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS estimated_distance_km NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS distance_km NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS estimated_duration_minutes INTEGER,
  ADD COLUMN IF NOT EXISTS duration_min INTEGER,
  ADD COLUMN IF NOT EXISTS payment_method TEXT DEFAULT 'cash',
  ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS promo_code TEXT,
  ADD COLUMN IF NOT EXISTS requested_at TIMESTAMPTZ DEFAULT now(),
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_rides_rider_active
  ON public.rides(rider_id, status, created_at DESC);

ALTER TABLE public.rides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ride_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ride_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Riders can view own rides" ON public.rides;
DROP POLICY IF EXISTS "Drivers can view assigned rides" ON public.rides;
DROP POLICY IF EXISTS "Users can create rides" ON public.rides;
DROP POLICY IF EXISTS "Ride participants can update rides" ON public.rides;
DROP POLICY IF EXISTS "rides: allow select" ON public.rides;
DROP POLICY IF EXISTS "rides: allow insert" ON public.rides;
DROP POLICY IF EXISTS "rides: allow update" ON public.rides;

CREATE POLICY "rides: allow select" ON public.rides FOR SELECT USING (true);
CREATE POLICY "rides: allow insert" ON public.rides FOR INSERT WITH CHECK (true);
CREATE POLICY "rides: allow update" ON public.rides FOR UPDATE USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Drivers can view own requests" ON public.ride_requests;
DROP POLICY IF EXISTS "Drivers can update own requests" ON public.ride_requests;
DROP POLICY IF EXISTS "ride_requests: allow select" ON public.ride_requests;
DROP POLICY IF EXISTS "ride_requests: allow insert" ON public.ride_requests;
DROP POLICY IF EXISTS "ride_requests: allow update" ON public.ride_requests;

CREATE POLICY "ride_requests: allow select" ON public.ride_requests FOR SELECT USING (true);
CREATE POLICY "ride_requests: allow insert" ON public.ride_requests FOR INSERT WITH CHECK (true);
CREATE POLICY "ride_requests: allow update" ON public.ride_requests FOR UPDATE USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Participants can view ride events" ON public.ride_events;
DROP POLICY IF EXISTS "ride_events: allow select" ON public.ride_events;
DROP POLICY IF EXISTS "ride_events: allow insert" ON public.ride_events;

CREATE POLICY "ride_events: allow select" ON public.ride_events FOR SELECT USING (true);
CREATE POLICY "ride_events: allow insert" ON public.ride_events FOR INSERT WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.book_rider_trip(
  p_rider_id UUID,
  p_category_id UUID DEFAULT NULL,
  p_vehicle_class TEXT DEFAULT NULL,
  p_pickup_address TEXT DEFAULT 'Current Location',
  p_pickup_lat DOUBLE PRECISION DEFAULT NULL,
  p_pickup_lng DOUBLE PRECISION DEFAULT NULL,
  p_dropoff_address TEXT DEFAULT '',
  p_dropoff_lat DOUBLE PRECISION DEFAULT NULL,
  p_dropoff_lng DOUBLE PRECISION DEFAULT NULL,
  p_payment_method TEXT DEFAULT 'cash',
  p_estimated_fare NUMERIC DEFAULT 0,
  p_distance_km NUMERIC DEFAULT NULL,
  p_duration_min INTEGER DEFAULT NULL,
  p_promo_code TEXT DEFAULT NULL
)
RETURNS public.rides
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
    rider_id, category_id, vehicle_class, status, payment_method,
    payment_status, estimated_fare, fare, pickup_address, pickup_lat,
    pickup_lng, dropoff_address, dropoff_lat, dropoff_lng,
    destination_address, destination_lat, destination_lng,
    estimated_distance_km, distance_km, estimated_duration_minutes,
    duration_min, promo_code, requested_at, updated_at
  ) VALUES (
    p_rider_id, p_category_id, v_vehicle_class, 'requested',
    COALESCE(NULLIF(p_payment_method, ''), 'cash'), 'pending',
    COALESCE(p_estimated_fare, 0), COALESCE(p_estimated_fare, 0),
    COALESCE(NULLIF(p_pickup_address, ''), 'Current Location'), p_pickup_lat,
    p_pickup_lng, COALESCE(p_dropoff_address, ''), p_dropoff_lat,
    p_dropoff_lng, COALESCE(p_dropoff_address, ''), p_dropoff_lat,
    p_dropoff_lng, p_distance_km, p_distance_km, p_duration_min,
    p_duration_min, NULLIF(p_promo_code, ''), now(), now()
  )
  RETURNING * INTO v_ride;

  INSERT INTO public.ride_events(ride_id, actor_id, event_type, metadata)
  VALUES (
    v_ride.id,
    v_rider_user_id,
    'rider_requested',
    jsonb_build_object('source', 'rider_app', 'payment_method', COALESCE(NULLIF(p_payment_method, ''), 'cash'), 'estimated_fare', COALESCE(p_estimated_fare, 0))
  );

  BEGIN
    PERFORM public.dispatch_ride_to_nearby_drivers(v_ride.id, p_pickup_lat, p_pickup_lng, 5);
    SELECT * INTO v_ride FROM public.rides WHERE id = v_ride.id;
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.ride_events(ride_id, actor_id, event_type, metadata)
    VALUES (v_ride.id, v_rider_user_id, 'dispatch_error', jsonb_build_object('message', SQLERRM));
  END;

  RETURN v_ride;
END;
$$;

GRANT EXECUTE ON FUNCTION public.book_rider_trip(
  UUID, UUID, TEXT, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, TEXT,
  DOUBLE PRECISION, DOUBLE PRECISION, TEXT, NUMERIC, NUMERIC, INTEGER, TEXT
) TO anon, authenticated;