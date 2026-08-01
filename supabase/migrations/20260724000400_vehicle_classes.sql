-- Admin-configurable vehicle classes: replaces the hardcoded
-- default_eligible_ride_tiers() CASE statement with real, editable rows,
-- so business rules for which ride categories a vehicle qualifies for can
-- change from the admin dashboard without a code deploy.
--
-- Naming note: rides.vehicle_class / ride_requests.vehicle_class (existing)
-- mean the RIDE CATEGORY the rider requested (go/x/xl/...). The new
-- vehicle_classes table / vehicles.vehicle_class_id describe the VEHICLE'S
-- OWN class (Economy Hatchback, Standard Sedan, ...) — a different axis.
-- The eligibility table below uses ride_category_slug, not vehicle_class,
-- to avoid conflating the two.
--
-- Idempotent — safe to re-run via `psql -f`.

CREATE TABLE IF NOT EXISTS public.vehicle_classes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  description text,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.vehicle_class_eligibility (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_class_id uuid NOT NULL REFERENCES public.vehicle_classes(id) ON DELETE CASCADE,
  ride_category_slug text NOT NULL REFERENCES public.ride_categories(slug) ON UPDATE CASCADE,
  priority integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vehicle_class_id, ride_category_slug)
);

-- ON DELETE SET NULL, not RESTRICT — deleting a class must never break a
-- vehicle; it just falls back to legacy tier matching.
ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS vehicle_class_id uuid REFERENCES public.vehicle_classes(id) ON DELETE SET NULL;

ALTER TABLE public.vehicle_classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_class_eligibility ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public_read_vehicle_classes" ON public.vehicle_classes;
CREATE POLICY "public_read_vehicle_classes" ON public.vehicle_classes FOR SELECT USING (true);

DROP POLICY IF EXISTS "public_read_vehicle_class_eligibility" ON public.vehicle_class_eligibility;
CREATE POLICY "public_read_vehicle_class_eligibility" ON public.vehicle_class_eligibility FOR SELECT USING (true);

-- Defense-in-depth admin policy — actual admin-dashboard writes go through
-- the SECURITY DEFINER RPCs below, not this policy (admin-dashboard's
-- anon-key browser client never has auth.uid() set, same reasoning
-- documented on pricing_config's admin_all_pricing_config policy).
DROP POLICY IF EXISTS "admin_all_vehicle_classes" ON public.vehicle_classes;
CREATE POLICY "admin_all_vehicle_classes" ON public.vehicle_classes
  USING (EXISTS (SELECT 1 FROM public.admin_users WHERE admin_users.user_id = auth.uid() AND admin_users.is_active = true))
  WITH CHECK (EXISTS (SELECT 1 FROM public.admin_users WHERE admin_users.user_id = auth.uid() AND admin_users.is_active = true));

DROP POLICY IF EXISTS "admin_all_vehicle_class_eligibility" ON public.vehicle_class_eligibility;
CREATE POLICY "admin_all_vehicle_class_eligibility" ON public.vehicle_class_eligibility
  USING (EXISTS (SELECT 1 FROM public.admin_users WHERE admin_users.user_id = auth.uid() AND admin_users.is_active = true))
  WITH CHECK (EXISTS (SELECT 1 FROM public.admin_users WHERE admin_users.user_id = auth.uid() AND admin_users.is_active = true));

GRANT SELECT ON public.vehicle_classes TO anon, authenticated, service_role;
GRANT SELECT ON public.vehicle_class_eligibility TO anon, authenticated, service_role;

-- ── Seed: 5 classes whose eligibility exactly reproduces
-- default_eligible_ride_tiers() today, so this migration changes nothing
-- for a live driver until an admin reassigns a class. Comfort and Black
-- are kept as separate classes (not merged into one "Premium/Luxury")
-- because they have different eligibility sets and different rating
-- gates (comfort >= 4.5, black >= 4.7) — merging them would silently
-- change eligibility for comfort-tier vehicles on day one.
INSERT INTO public.vehicle_classes (name, slug, description, sort_order, is_active) VALUES
  ('Economy Hatchback',      'economy_hatchback', 'Compact, affordable everyday cars',       1, true),
  ('Standard Sedan',         'standard_sedan',    'Standard sedans — most common vehicle',   2, true),
  ('XL Vehicle',             'xl_vehicle',        'SUVs and vans with room for 6-7',         3, true),
  ('Comfort Sedan',          'comfort_sedan',     'Newer, roomier cars for premium comfort', 4, true),
  ('Premium/Luxury Vehicle', 'premium_luxury',    'Top-tier executive vehicles',             5, true)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name, description = EXCLUDED.description,
  sort_order = EXCLUDED.sort_order, is_active = EXCLUDED.is_active;

INSERT INTO public.vehicle_class_eligibility (vehicle_class_id, ride_category_slug, priority)
SELECT vc.id, e.slug, e.priority
FROM public.vehicle_classes vc
JOIN (VALUES
  ('economy_hatchback', 'go',      1),
  ('standard_sedan',    'go',      1),
  ('standard_sedan',    'x',       2),
  ('xl_vehicle',        'go',      1),
  ('xl_vehicle',        'x',       2),
  ('xl_vehicle',        'xl',      3),
  ('comfort_sedan',     'x',       1),
  ('comfort_sedan',     'comfort', 2),
  ('premium_luxury',    'comfort', 1),
  ('premium_luxury',    'black',   2)
) AS e(class_slug, slug, priority) ON e.class_slug = vc.slug
ON CONFLICT (vehicle_class_id, ride_category_slug) DO UPDATE SET priority = EXCLUDED.priority;

-- Deliberately no backfill of vehicles.vehicle_class_id — every existing
-- vehicle stays NULL and keeps using the legacy normalize_vehicle_tier /
-- default_eligible_ride_tiers path via the COALESCE fallback below.

-- ── Read helpers ──
CREATE OR REPLACE FUNCTION public.vehicle_class_eligible_tiers(p_vehicle_class_id uuid)
RETURNS text[] LANGUAGE sql STABLE AS $$
  SELECT COALESCE(array_agg(ride_category_slug ORDER BY priority, ride_category_slug), ARRAY[]::text[])
  FROM public.vehicle_class_eligibility WHERE vehicle_class_id = p_vehicle_class_id;
$$;

CREATE OR REPLACE FUNCTION public.driver_eligible_ride_tiers(p_vehicle_id uuid)
RETURNS text[] LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    NULLIF(public.vehicle_class_eligible_tiers(v.vehicle_class_id), ARRAY[]::text[]),
    public.default_eligible_ride_tiers(public.normalize_vehicle_tier(COALESCE(v.vehicle_category, v.vehicle_type)))
  )
  FROM public.vehicles v WHERE v.id = p_vehicle_id;
$$;

GRANT EXECUTE ON FUNCTION public.vehicle_class_eligible_tiers(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.driver_eligible_ride_tiers(uuid) TO anon, authenticated, service_role;

-- ── Admin CRUD RPCs ──
CREATE OR REPLACE FUNCTION public.admin_upsert_vehicle_class(
  p_id uuid DEFAULT NULL, p_name text DEFAULT '', p_slug text DEFAULT '',
  p_description text DEFAULT NULL, p_sort_order integer DEFAULT 0, p_is_active boolean DEFAULT true
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_result public.vehicle_classes;
BEGIN
  IF p_id IS NOT NULL THEN
    UPDATE public.vehicle_classes SET
      name = COALESCE(NULLIF(p_name, ''), name),
      slug = COALESCE(NULLIF(p_slug, ''), slug),
      description = p_description,
      sort_order = COALESCE(p_sort_order, sort_order),
      is_active = COALESCE(p_is_active, is_active),
      updated_at = now()
    WHERE id = p_id
    RETURNING * INTO v_result;
  ELSE
    INSERT INTO public.vehicle_classes (name, slug, description, sort_order, is_active)
    VALUES (p_name, p_slug, p_description, p_sort_order, p_is_active)
    RETURNING * INTO v_result;
  END IF;
  RETURN to_jsonb(v_result);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_delete_vehicle_class(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  DELETE FROM public.vehicle_classes WHERE id = p_id;
  RETURN jsonb_build_object('deleted', true, 'id', p_id);
END;
$$;

-- Full-replace-in-one-call, keyed by class id, from a jsonb array like
-- [{"ride_category_slug":"go","priority":1}, {"ride_category_slug":"x","priority":2}]
CREATE OR REPLACE FUNCTION public.admin_upsert_vehicle_class_eligibility(
  p_vehicle_class_id uuid, p_eligibility jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_count integer;
BEGIN
  IF p_vehicle_class_id IS NULL THEN
    RAISE EXCEPTION 'vehicle_class_id is required';
  END IF;
  DELETE FROM public.vehicle_class_eligibility WHERE vehicle_class_id = p_vehicle_class_id;
  INSERT INTO public.vehicle_class_eligibility (vehicle_class_id, ride_category_slug, priority)
  SELECT p_vehicle_class_id, e->>'ride_category_slug', COALESCE((e->>'priority')::integer, 0)
  FROM jsonb_array_elements(COALESCE(p_eligibility, '[]'::jsonb)) AS e;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN jsonb_build_object('vehicle_class_id', p_vehicle_class_id, 'rows', v_count);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_upsert_vehicle_class(uuid, text, text, text, integer, boolean) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_delete_vehicle_class(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_upsert_vehicle_class_eligibility(uuid, jsonb) TO anon, authenticated, service_role;

-- ── Rewire dispatch_ride_to_nearby_drivers to prefer class-configured ──
-- eligibility over the legacy hardcoded default, while staying backward
-- compatible for any vehicle with no class assigned yet.
CREATE OR REPLACE FUNCTION public.dispatch_ride_to_nearby_drivers(
  p_ride_id uuid,
  p_pickup_lat double precision DEFAULT NULL,
  p_pickup_lng double precision DEFAULT NULL,
  p_max_drivers integer DEFAULT 5
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_ride public.rides;
  v_inserted integer := 0;
BEGIN
  SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ride not found';
  END IF;
  IF v_ride.status NOT IN ('requested', 'searching') THEN
    RETURN 0;
  END IF;

  WITH candidate_drivers AS (
    SELECT
      d.id, d.gender, d.rating, d.updated_at, d.preferred_categories,
      dl.latitude, dl.longitude,
      v.vehicle_class_id,
      public.normalize_vehicle_tier(COALESCE(v.vehicle_category, v.vehicle_type)) AS tier
    FROM public.drivers d
    LEFT JOIN public.driver_locations dl ON dl.driver_id = d.id
    LEFT JOIN public.vehicles v ON v.id = d.vehicle_id
    WHERE COALESCE(d.is_online, false) = true
      AND COALESCE(d.can_go_online, true) = true
      AND COALESCE(d.approval_status, 'approved') IN ('approved', 'active')
      AND NOT EXISTS (
        SELECT 1 FROM public.rides active
        WHERE active.driver_id = d.id AND active.status IN ('accepted', 'arrived', 'in_progress')
      )
  )
  INSERT INTO public.ride_requests (
    ride_id, driver_id, status, expires_at, pickup_address, pickup_lat, pickup_lng,
    destination_address, destination_lat, destination_lng, vehicle_class, estimated_fare, payment_method
  )
  SELECT
    v_ride.id, cd.id, 'pending', now() + interval '30 seconds',
    v_ride.pickup_address, COALESCE(v_ride.pickup_lat, p_pickup_lat), COALESCE(v_ride.pickup_lng, p_pickup_lng),
    v_ride.dropoff_address, v_ride.dropoff_lat, v_ride.dropoff_lng,
    COALESCE(v_ride.vehicle_class, v_ride.category_id::TEXT),
    COALESCE(v_ride.estimated_fare, v_ride.fare, 0),
    COALESCE(v_ride.payment_method, 'cash')
  FROM candidate_drivers cd
  WHERE (
    v_ride.vehicle_class IS NULL
    OR (cd.tier IS NULL AND v_ride.vehicle_class IN ('go', 'x'))
    OR v_ride.vehicle_class = ANY(COALESCE(
        cd.preferred_categories,
        NULLIF(public.vehicle_class_eligible_tiers(cd.vehicle_class_id), ARRAY[]::text[]),
        public.default_eligible_ride_tiers(cd.tier)
      ))
    OR (v_ride.vehicle_class = 'women'
        AND lower(COALESCE(cd.gender, '')) = 'female'
        AND cd.tier IN ('go', 'x', 'xl', 'comfort'))
  )
  AND (
    v_ride.vehicle_class NOT IN ('comfort', 'black')
    OR COALESCE(cd.rating, 5.0) >= (CASE v_ride.vehicle_class WHEN 'comfort' THEN 4.5 WHEN 'black' THEN 4.7 ELSE 0 END)
  )
  ORDER BY
    CASE
      WHEN COALESCE(v_ride.pickup_lat, p_pickup_lat) IS NOT NULL
       AND COALESCE(v_ride.pickup_lng, p_pickup_lng) IS NOT NULL
       AND cd.latitude IS NOT NULL AND cd.longitude IS NOT NULL
      THEN ((cd.latitude - COALESCE(v_ride.pickup_lat, p_pickup_lat)) * (cd.latitude - COALESCE(v_ride.pickup_lat, p_pickup_lat)))
         + ((cd.longitude - COALESCE(v_ride.pickup_lng, p_pickup_lng)) * (cd.longitude - COALESCE(v_ride.pickup_lng, p_pickup_lng)))
      ELSE 999999
    END,
    cd.updated_at DESC NULLS LAST
  LIMIT GREATEST(1, p_max_drivers)
  ON CONFLICT (ride_id, driver_id) DO UPDATE
    SET status = 'pending', expires_at = EXCLUDED.expires_at,
        pickup_address = EXCLUDED.pickup_address, pickup_lat = EXCLUDED.pickup_lat, pickup_lng = EXCLUDED.pickup_lng,
        destination_address = EXCLUDED.destination_address, destination_lat = EXCLUDED.destination_lat, destination_lng = EXCLUDED.destination_lng,
        vehicle_class = EXCLUDED.vehicle_class, estimated_fare = EXCLUDED.estimated_fare, payment_method = EXCLUDED.payment_method;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  UPDATE public.rides
  SET status = CASE WHEN v_inserted > 0 THEN 'searching' ELSE 'requested' END, updated_at = now()
  WHERE id = p_ride_id;

  INSERT INTO public.ride_events(ride_id, event_type, metadata)
  VALUES (p_ride_id, CASE WHEN v_inserted > 0 THEN 'dispatch_sent' ELSE 'dispatch_no_drivers' END,
          jsonb_build_object('driver_count', v_inserted));

  RETURN v_inserted;
END;
$$;
