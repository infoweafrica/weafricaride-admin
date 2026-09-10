-- ============================================================================
-- Operator Booking — strict server-side validation
-- ============================================================================
-- Closes three holes in the Admin → Operator Dispatch Center flow
-- (admin-dashboard/src/app/admin/operations/operator-booking/page.tsx):
--
--   1. ADDRESS  — the page let an operator free-type any pickup/destination
--      string while keeping stale lat/lng. operator_create_ride now REQUIRES
--      real coordinates (the React page only supplies them when a Mapbox
--      suggestion is picked), and a BEFORE INSERT trigger rejects any
--      operator ride (rider_id IS NULL) that lands without them.
--
--   2. PHONE    — customer_phone had no validation anywhere. We now
--      normalize + strictly validate it as a Malawi MSISDN (+265, 9 national
--      digits starting 8 or 9) in the RPC AND in the trigger, so it cannot
--      be bypassed by writing straight to the table with the anon key
--      (rides RLS is `WITH CHECK (true)`). customer_phone_verified column +
--      an RPC parameter are added as the hook for OTP, which is a later pass
--      — a bad *format* blocks the booking now; "unverified" does not yet.
--
--   3. VEHICLE CLASS — the auto path (assign_driver) did ZERO class
--      filtering; the manual path never checked the picked driver's class.
--      operator_create_ride matches ONLY drivers whose vehicle tier is
--      EXACTLY the requested tier (no go→x upgrade, no black→x downgrade,
--      no NULL-tier fallback). Zero matches ⇒ the ride is NOT created and
--      the RPC raises:
--          "No WeAfrica X drivers are currently available in your area."
--      A BEFORE INSERT trigger on ride_requests enforces the same
--      exact-tier rule for operator rides regardless of how the row is
--      inserted. The single deliberate cross-tier rule is Women (female
--      driver, car tier in go/x/xl/comfort).
--
-- Scope note: rider-app dispatch (dispatch_ride_to_nearby_drivers, used by
-- book_rider_trip) is intentionally left on its existing admin-configurable
-- eligibility matrix — flipping it to exact-tier needs vehicles.vehicle_category
-- to be backfilled first or it strands real drivers. Follow-up migration.
--
-- Idempotent — CREATE OR REPLACE / IF NOT EXISTS / DROP ... IF EXISTS
-- throughout; safe to re-run via `psql -f`.
-- ============================================================================


-- ── 0. customer_phone_verified: OTP hook (no SMS yet) ────────────────────────
ALTER TABLE public.rides
  ADD COLUMN IF NOT EXISTS customer_phone_verified boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.rides.customer_phone_verified IS
  'Operator bookings: set true once the customer number has been OTP-verified. '
  'OTP send/verify is a later pass; today only phone FORMAT is enforced.';


-- ── 1. Malawi phone number helpers ──────────────────────────────────────────
-- Accepts the shapes an operator realistically types and returns a canonical
-- E.164 string (+265XXXXXXXXX) or NULL when the number is not a valid MW
-- mobile number. Mobile national number = 9 digits, first digit 8 or 9.
CREATE OR REPLACE FUNCTION public.normalize_mw_msisdn(p_raw text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v text;
BEGIN
  IF p_raw IS NULL THEN
    RETURN NULL;
  END IF;

  -- digits only (drops +, spaces, dashes, parens, dots)
  v := regexp_replace(p_raw, '[^0-9]', '', 'g');
  IF v = '' THEN
    RETURN NULL;
  END IF;

  -- drop an international 00 prefix
  IF left(v, 2) = '00' THEN
    v := substr(v, 3);
  END IF;

  IF left(v, 3) = '265' AND length(v) = 12 THEN
    -- already a full MSISDN
    NULL;
  ELSIF left(v, 1) = '0' AND length(v) = 10 THEN
    -- 0XXXXXXXXX national form
    v := '265' || substr(v, 2);
  ELSIF length(v) = 9 THEN
    -- bare national significant number
    v := '265' || v;
  ELSE
    RETURN NULL;
  END IF;

  IF v ~ '^265[89][0-9]{8}$' THEN
    RETURN '+' || v;
  END IF;

  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.is_valid_mw_msisdn(p_raw text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT public.normalize_mw_msisdn(p_raw) IS NOT NULL;
$$;

GRANT EXECUTE ON FUNCTION public.normalize_mw_msisdn(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_valid_mw_msisdn(text)  TO anon, authenticated, service_role;


-- ── 2. Ride-tier label (for human-readable error messages) ──────────────────
CREATE OR REPLACE FUNCTION public.ride_tier_label(p_tier text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE public.normalize_vehicle_tier(p_tier)
    WHEN 'go'      THEN 'Go'
    WHEN 'x'       THEN 'X'
    WHEN 'xl'      THEN 'XL'
    WHEN 'comfort' THEN 'Comfort'
    WHEN 'black'   THEN 'Black'
    WHEN 'women'   THEN 'Women'
    ELSE COALESCE(NULLIF(p_tier, ''), 'ride')
  END;
$$;

GRANT EXECUTE ON FUNCTION public.ride_tier_label(text) TO anon, authenticated, service_role;


-- ── 3. A driver's EXACT vehicle tier ───────────────────────────────────────
-- Source of truth is the driver's assigned vehicle; falls back to the
-- driver's own class fields. Returns NULL when nothing resolves — an
-- unresolvable class is treated as "not eligible for anything".
CREATE OR REPLACE FUNCTION public.operator_driver_exact_tier(p_driver_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.normalize_vehicle_tier(
           COALESCE(v.vehicle_category, v.vehicle_type, d.vehicle_category, d.driver_type)
         )
  FROM public.drivers d
  LEFT JOIN public.vehicles v ON v.id = d.vehicle_id
  WHERE d.id = p_driver_id;
$$;

GRANT EXECUTE ON FUNCTION public.operator_driver_exact_tier(uuid) TO anon, authenticated, service_role;


-- ── 4. Available drivers for a tier — EXACT match only ──────────────────────
-- online + available + approved + not on an active trip, whose vehicle tier
-- is EXACTLY p_tier (Women: female driver whose car tier is go/x/xl/comfort).
-- When pickup coords are given, only drivers with a known location within
-- p_radius_km are returned, nearest first.
CREATE OR REPLACE FUNCTION public.operator_available_drivers_for_tier(
  p_tier       text,
  p_pickup_lat double precision DEFAULT NULL,
  p_pickup_lng double precision DEFAULT NULL,
  p_radius_km  numeric          DEFAULT 15
)
RETURNS TABLE(driver_id uuid, distance_km numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tier text := public.normalize_vehicle_tier(p_tier);
BEGIN
  IF v_tier IS NULL THEN
    RAISE EXCEPTION 'Unknown vehicle class: %', COALESCE(p_tier, '(blank)')
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN QUERY
  WITH cand AS (
    SELECT
      d.id,
      lower(COALESCE(d.gender, '')) AS gender,
      public.normalize_vehicle_tier(
        COALESCE(v.vehicle_category, v.vehicle_type, d.vehicle_category, d.driver_type)
      ) AS tier,
      CASE
        WHEN p_pickup_lat IS NOT NULL AND p_pickup_lng IS NOT NULL
             AND dl.latitude IS NOT NULL AND dl.longitude IS NOT NULL
        THEN 6371 * 2 * asin(sqrt(
               power(sin(radians(dl.latitude  - p_pickup_lat) / 2), 2) +
               cos(radians(p_pickup_lat)) * cos(radians(dl.latitude)) *
               power(sin(radians(dl.longitude - p_pickup_lng) / 2), 2)
             ))
        ELSE NULL
      END::numeric AS dist_km
    FROM public.drivers d
    LEFT JOIN public.driver_locations dl ON dl.driver_id = d.id
    LEFT JOIN public.vehicles v          ON v.id = d.vehicle_id
    WHERE COALESCE(d.is_online, false) = true
      AND COALESCE(d.is_available, true) = true
      AND COALESCE(d.can_go_online, true) = true
      AND COALESCE(d.approval_status, 'approved') IN ('approved', 'active')
      AND NOT EXISTS (
        SELECT 1 FROM public.rides ar
        WHERE ar.driver_id = d.id
          AND ar.status IN ('accepted','arrived','in_progress','assigned',
                            'driver_assigned','started','picked_up')
      )
  )
  SELECT c.id, c.dist_km
  FROM cand c
  WHERE (
          (v_tier <> 'women' AND c.tier = v_tier)
       OR (v_tier =  'women' AND c.gender = 'female' AND c.tier IN ('go','x','xl','comfort'))
        )
    AND (
          p_pickup_lat IS NULL OR p_pickup_lng IS NULL
       OR (c.dist_km IS NOT NULL AND c.dist_km <= p_radius_km)
        )
  ORDER BY c.dist_km NULLS LAST;
END;
$$;

GRANT EXECUTE ON FUNCTION public.operator_available_drivers_for_tier(text, double precision, double precision, numeric)
  TO anon, authenticated, service_role;


-- ── 5. operator_create_ride — the one entry point the dashboard should use ───
-- Validates everything server-side, then creates the ride + fans out
-- ride_requests to EXACT-tier drivers only. Raises (and creates nothing) when
-- the customer data is bad or no eligible driver exists.
CREATE OR REPLACE FUNCTION public.operator_create_ride(
  p_customer_name          text,
  p_customer_phone         text,
  p_pickup_address         text,
  p_pickup_lat             double precision,
  p_pickup_lng             double precision,
  p_dropoff_address        text,
  p_dropoff_lat            double precision,
  p_dropoff_lng            double precision,
  p_vehicle_type           text,
  p_payment_method         text    DEFAULT 'cash',
  p_city                   text    DEFAULT NULL,
  p_operator_notes         text    DEFAULT NULL,
  p_request_source         text    DEFAULT 'phone_call',
  p_estimated_fare         numeric DEFAULT 0,
  p_distance_km            numeric DEFAULT NULL,
  p_duration_min           integer DEFAULT NULL,
  p_driver_id              uuid    DEFAULT NULL,
  p_max_drivers            integer DEFAULT 5,
  p_radius_km              numeric DEFAULT 15,
  p_customer_phone_verified boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_name             text := btrim(COALESCE(p_customer_name, ''));
  v_phone            text;
  v_tier             text;
  v_label            text;
  v_pin              text;
  v_ride             public.rides;
  v_driver_ids       uuid[];
  v_did              uuid;
  v_sent             integer := 0;
  v_drv              public.drivers%ROWTYPE;
  v_drv_tier         text;
  v_allowed_payments text[] := ARRAY['cash','airtel_money','tnm_mpamba','wallet','bank_card'];
BEGIN
  --------------------------------------------------------------------------
  -- 1. Customer name
  --------------------------------------------------------------------------
  IF v_name = '' THEN
    RAISE EXCEPTION 'Customer name is required.' USING ERRCODE = 'check_violation';
  END IF;

  --------------------------------------------------------------------------
  -- 2. Phone — strict Malawi MSISDN
  --------------------------------------------------------------------------
  v_phone := public.normalize_mw_msisdn(p_customer_phone);
  IF v_phone IS NULL THEN
    RAISE EXCEPTION
      'Invalid Malawi phone number: %. Enter a real +265 mobile number (9 digits, starting 8 or 9).',
      COALESCE(NULLIF(p_customer_phone, ''), '(blank)')
      USING ERRCODE = 'check_violation';
  END IF;

  --------------------------------------------------------------------------
  -- 3. Vehicle class
  --------------------------------------------------------------------------
  v_tier := public.normalize_vehicle_tier(p_vehicle_type);
  IF v_tier IS NULL THEN
    RAISE EXCEPTION 'Unknown vehicle class: %.', COALESCE(NULLIF(p_vehicle_type, ''), '(blank)')
      USING ERRCODE = 'check_violation';
  END IF;
  v_label := public.ride_tier_label(v_tier);

  --------------------------------------------------------------------------
  -- 4. Payment method
  --------------------------------------------------------------------------
  IF NOT (COALESCE(NULLIF(p_payment_method, ''), 'cash') = ANY (v_allowed_payments)) THEN
    RAISE EXCEPTION 'Unsupported payment method: %.', p_payment_method
      USING ERRCODE = 'check_violation';
  END IF;

  --------------------------------------------------------------------------
  -- 5. Coordinates — must come from a resolved (geocoded) address
  --------------------------------------------------------------------------
  IF p_pickup_lat IS NULL OR p_pickup_lng IS NULL
     OR p_dropoff_lat IS NULL OR p_dropoff_lng IS NULL THEN
    RAISE EXCEPTION
      'Pickup and destination must be selected from the address suggestions (coordinates missing).'
      USING ERRCODE = 'check_violation';
  END IF;

  IF abs(p_pickup_lat)  > 90  OR abs(p_dropoff_lat)  > 90
     OR abs(p_pickup_lng) > 180 OR abs(p_dropoff_lng) > 180
     OR (p_pickup_lat  = 0 AND p_pickup_lng  = 0)
     OR (p_dropoff_lat = 0 AND p_dropoff_lng = 0) THEN
    RAISE EXCEPTION 'Pickup or destination coordinates are invalid.' USING ERRCODE = 'check_violation';
  END IF;

  IF p_pickup_lat = p_dropoff_lat AND p_pickup_lng = p_dropoff_lng THEN
    RAISE EXCEPTION 'Pickup and destination cannot be the same location.' USING ERRCODE = 'check_violation';
  END IF;

  IF btrim(COALESCE(p_pickup_address, '')) = '' OR btrim(COALESCE(p_dropoff_address, '')) = '' THEN
    RAISE EXCEPTION 'Pickup and destination addresses are required.' USING ERRCODE = 'check_violation';
  END IF;

  --------------------------------------------------------------------------
  -- 6. Driver selection — EXACT vehicle-class match only
  --------------------------------------------------------------------------
  IF p_driver_id IS NOT NULL THEN
    -- Operator hand-picked a driver: validate that specific driver.
    SELECT * INTO v_drv FROM public.drivers WHERE id = p_driver_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Selected driver not found.' USING ERRCODE = 'no_data_found';
    END IF;
    IF COALESCE(v_drv.is_online, false) = false THEN
      RAISE EXCEPTION 'Selected driver is offline.' USING ERRCODE = 'check_violation';
    END IF;
    IF COALESCE(v_drv.is_available, true) = false THEN
      RAISE EXCEPTION 'Selected driver is not available for a trip right now.' USING ERRCODE = 'check_violation';
    END IF;
    IF COALESCE(v_drv.approval_status, 'approved') NOT IN ('approved', 'active') THEN
      RAISE EXCEPTION 'Selected driver is not approved.' USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.rides ar
      WHERE ar.driver_id = p_driver_id
        AND ar.status IN ('accepted','arrived','in_progress','assigned',
                          'driver_assigned','started','picked_up')
    ) THEN
      RAISE EXCEPTION 'Selected driver is already on an active trip.' USING ERRCODE = 'check_violation';
    END IF;

    v_drv_tier := public.operator_driver_exact_tier(p_driver_id);
    IF v_tier = 'women' THEN
      IF lower(COALESCE(v_drv.gender, '')) <> 'female'
         OR COALESCE(v_drv_tier, '') NOT IN ('go','x','xl','comfort') THEN
        RAISE EXCEPTION 'Selected driver is not eligible for WeAfrica Women.'
          USING ERRCODE = 'check_violation';
      END IF;
    ELSIF COALESCE(v_drv_tier, '') <> v_tier THEN
      RAISE EXCEPTION
        'Selected driver is not a WeAfrica % driver (their vehicle class is %). Cross-class dispatch is not allowed.',
        v_label, public.ride_tier_label(v_drv_tier)
        USING ERRCODE = 'check_violation';
    END IF;

    v_driver_ids := ARRAY[p_driver_id];
  ELSE
    -- Auto dispatch: nearest EXACT-tier drivers.
    SELECT array_agg(t.driver_id)
    INTO v_driver_ids
    FROM (
      SELECT driver_id
      FROM public.operator_available_drivers_for_tier(v_tier, p_pickup_lat, p_pickup_lng, p_radius_km)
      LIMIT GREATEST(1, p_max_drivers)
    ) t;

    IF v_driver_ids IS NULL OR array_length(v_driver_ids, 1) IS NULL THEN
      RAISE EXCEPTION 'No WeAfrica % drivers are currently available in your area.', v_label
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  --------------------------------------------------------------------------
  -- 7. Create the ride (canonical tier written to BOTH columns)
  --------------------------------------------------------------------------
  v_pin := lpad(((floor(random() * 9000))::int + 1000)::text, 4, '0');

  INSERT INTO public.rides (
    rider_id, driver_id,
    pickup_address, dropoff_address, destination_address,
    pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, destination_lat, destination_lng,
    status, vehicle_type, vehicle_class,
    fare, estimated_fare, distance_km, duration_min,
    estimated_distance_km, estimated_duration_minutes,
    payment_method, payment_status, city,
    request_source, customer_name, customer_phone, customer_phone_verified,
    operator_notes, rider_pin, requested_at, updated_at
  ) VALUES (
    NULL,
    p_driver_id,
    p_pickup_address, p_dropoff_address, p_dropoff_address,
    p_pickup_lat, p_pickup_lng, p_dropoff_lat, p_dropoff_lng, p_dropoff_lat, p_dropoff_lng,
    'searching', v_tier, v_tier,
    COALESCE(p_estimated_fare, 0), COALESCE(p_estimated_fare, 0), p_distance_km, p_duration_min,
    p_distance_km, p_duration_min,
    COALESCE(NULLIF(p_payment_method, ''), 'cash'), 'pending', p_city,
    COALESCE(NULLIF(p_request_source, ''), 'phone_call'),
    v_name, v_phone, COALESCE(p_customer_phone_verified, false),
    NULLIF(p_operator_notes, ''), v_pin, now(), now()
  )
  RETURNING * INTO v_ride;

  --------------------------------------------------------------------------
  -- 8. Fan out ride_requests to the matched drivers
  --------------------------------------------------------------------------
  FOREACH v_did IN ARRAY v_driver_ids LOOP
    INSERT INTO public.ride_requests (
      id, ride_id, driver_id, rider_id,
      pickup_address, pickup_lat, pickup_lng,
      destination_address, destination_lat, destination_lng,
      status, vehicle_class, estimated_fare, payment_method,
      expires_at, created_at, updated_at
    ) VALUES (
      gen_random_uuid(), v_ride.id, v_did, NULL,
      v_ride.pickup_address, v_ride.pickup_lat, v_ride.pickup_lng,
      v_ride.dropoff_address, v_ride.dropoff_lat, v_ride.dropoff_lng,
      'pending', v_tier, v_ride.estimated_fare, v_ride.payment_method,
      now() + interval '30 seconds', now(), now()
    )
    ON CONFLICT (ride_id, driver_id) DO NOTHING;
    v_sent := v_sent + 1;
  END LOOP;

  INSERT INTO public.ride_events(ride_id, event_type, metadata)
  VALUES (
    v_ride.id, 'operator_dispatch',
    jsonb_build_object(
      'vehicle_class',   v_tier,
      'requests_sent',   v_sent,
      'manual_driver_id', p_driver_id,
      'source',          'operator_booking'
    )
  );

  RETURN jsonb_build_object(
    'ride_id',        v_ride.id,
    'status',         v_ride.status,
    'vehicle_class',  v_tier,
    'vehicle_label',  v_label,
    'rider_pin',      v_pin,
    'customer_phone', v_phone,
    'requests_sent',  v_sent,
    'driver_ids',     to_jsonb(v_driver_ids)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.operator_create_ride(
  text, text, text, double precision, double precision, text, double precision, double precision,
  text, text, text, text, text, numeric, numeric, integer, uuid, integer, numeric, boolean
) TO anon, authenticated, service_role;


-- ── 6. Defense-in-depth: BEFORE INSERT trigger on rides ─────────────────────
-- rides RLS is `WITH CHECK (true)`, so the RPC alone is not a guarantee.
-- This rejects any *operator* ride (no linked rider account) inserted with a
-- bad phone, missing coordinates, or an unresolvable vehicle class — whether
-- it comes from the RPC, a direct anon insert, or a future code path.
CREATE OR REPLACE FUNCTION public.enforce_operator_ride_integrity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_tier  text;
  v_phone text;
BEGIN
  -- Rider-app bookings always carry a rider_id — leave them alone.
  IF NEW.rider_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Only guard rows that are clearly an operator/dispatcher booking: they
  -- carry a walk-up customer, or an operator-channel request_source.
  IF NEW.customer_name IS NULL
     AND NEW.customer_phone IS NULL
     AND COALESCE(NEW.request_source, 'app') NOT IN
         ('admin','operator','phone_call','whatsapp','walk_in','hotel','call_center') THEN
    RETURN NEW;
  END IF;

  IF btrim(COALESCE(NEW.customer_name, '')) = '' THEN
    RAISE EXCEPTION 'Operator ride rejected: customer name is required.'
      USING ERRCODE = 'check_violation';
  END IF;

  v_phone := public.normalize_mw_msisdn(NEW.customer_phone);
  IF v_phone IS NULL THEN
    RAISE EXCEPTION 'Operator ride rejected: invalid Malawi phone number "%".',
      COALESCE(NEW.customer_phone, '')
      USING ERRCODE = 'check_violation';
  END IF;
  NEW.customer_phone := v_phone;

  v_tier := public.normalize_vehicle_tier(COALESCE(NEW.vehicle_class, NEW.vehicle_type));
  IF v_tier IS NULL THEN
    RAISE EXCEPTION 'Operator ride rejected: unknown vehicle class "%".',
      COALESCE(NEW.vehicle_class, NEW.vehicle_type, '')
      USING ERRCODE = 'check_violation';
  END IF;
  NEW.vehicle_class := v_tier;
  NEW.vehicle_type  := v_tier;

  IF NEW.pickup_lat IS NULL OR NEW.pickup_lng IS NULL
     OR COALESCE(NEW.dropoff_lat, NEW.destination_lat) IS NULL
     OR COALESCE(NEW.dropoff_lng, NEW.destination_lng) IS NULL THEN
    RAISE EXCEPTION
      'Operator ride rejected: pickup and destination must be picked from address suggestions (coordinates missing).'
      USING ERRCODE = 'check_violation';
  END IF;

  IF abs(NEW.pickup_lat) > 90 OR abs(NEW.pickup_lng) > 180
     OR (NEW.pickup_lat = 0 AND NEW.pickup_lng = 0)
     OR (COALESCE(NEW.dropoff_lat, NEW.destination_lat) = 0
         AND COALESCE(NEW.dropoff_lng, NEW.destination_lng) = 0) THEN
    RAISE EXCEPTION 'Operator ride rejected: coordinates are invalid.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_operator_ride_integrity ON public.rides;
CREATE TRIGGER trg_enforce_operator_ride_integrity
  BEFORE INSERT ON public.rides
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_operator_ride_integrity();


-- ── 7. Defense-in-depth: BEFORE INSERT trigger on ride_requests ─────────────
-- Blocks a cross-class ride_request for an operator ride no matter who writes
-- it (ride_requests RLS is also `WITH CHECK (true)`). Rider-app rides are not
-- affected here — see the scope note at the top.
CREATE OR REPLACE FUNCTION public.enforce_ride_request_exact_class()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_ride   public.rides;
  v_want   text;
  v_have   text;
  v_gender text;
BEGIN
  SELECT * INTO v_ride FROM public.rides WHERE id = NEW.ride_id;
  IF NOT FOUND THEN
    RETURN NEW;  -- let the FK raise
  END IF;

  -- Operator rides only.
  IF v_ride.rider_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  v_want := public.normalize_vehicle_tier(
              COALESCE(v_ride.vehicle_class, v_ride.vehicle_type, NEW.vehicle_class)
            );
  IF v_want IS NULL THEN
    RETURN NEW;
  END IF;

  v_have := public.operator_driver_exact_tier(NEW.driver_id);
  SELECT lower(COALESCE(gender, '')) INTO v_gender FROM public.drivers WHERE id = NEW.driver_id;

  IF v_want = 'women' THEN
    IF v_gender <> 'female' OR COALESCE(v_have, '') NOT IN ('go','x','xl','comfort') THEN
      RAISE EXCEPTION
        'Cross-class dispatch blocked: WeAfrica Women ride % cannot be offered to this driver.',
        NEW.ride_id
        USING ERRCODE = 'check_violation';
    END IF;
  ELSIF COALESCE(v_have, '') <> v_want THEN
    RAISE EXCEPTION
      'Cross-class dispatch blocked: WeAfrica % ride % cannot be offered to a % driver.',
      public.ride_tier_label(v_want), NEW.ride_id, public.ride_tier_label(v_have)
      USING ERRCODE = 'check_violation';
  END IF;

  NEW.vehicle_class := v_want;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_ride_request_exact_class ON public.ride_requests;
CREATE TRIGGER trg_enforce_ride_request_exact_class
  BEFORE INSERT ON public.ride_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_ride_request_exact_class();
