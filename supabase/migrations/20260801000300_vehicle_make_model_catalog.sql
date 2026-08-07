-- Malawi-focused vehicle make/model catalog.
--
-- Problem: today a driver free-types Make/Model and separately
-- self-selects their own service tier (Go/X/XL/Comfort/Black) from a
-- dropdown at onboarding — the driver decides what they qualify for,
-- rather than the vehicle. This adds a Make -> Model catalog where each
-- model carries a vehicle_class_id, so selecting "Toyota" -> "Noah"
-- automatically resolves to the 7-Seater class (and therefore its
-- eligible ride categories via vehicle_class_eligibility, unchanged).
--
-- This does not replace vehicle_classes / vehicle_class_eligibility
-- (20260724000400, reconciled to the v1 4-class scheme by
-- 20260724000500) — it feeds them. vehicles.vehicle_class_id stays the
-- single source of truth eligibility reads from; vehicle_model_id is
-- just how the app looks up which class_id to write.
--
-- Idempotent — safe to re-run via `psql -f`.

CREATE TABLE IF NOT EXISTS public.vehicle_makes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.vehicle_models (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  make_id uuid NOT NULL REFERENCES public.vehicle_makes(id) ON DELETE CASCADE,
  name text NOT NULL,
  slug text NOT NULL,
  -- ON DELETE SET NULL, not RESTRICT — deleting a vehicle_classes row must
  -- never break a catalog entry; it just stops auto-resolving a class
  -- until an admin picks a new one (same reasoning as vehicles.vehicle_class_id).
  vehicle_class_id uuid REFERENCES public.vehicle_classes(id) ON DELETE SET NULL,
  passenger_capacity integer,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (make_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_vehicle_models_make_id ON public.vehicle_models(make_id);

-- Deliberately no FK from vehicles to vehicle_models on the hot path —
-- the app resolves vehicle_class_id from the chosen model client-side and
-- writes it directly to vehicles.vehicle_class_id, same as an admin's
-- manual override. vehicle_model_id is kept for display/audit only.
ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS vehicle_model_id uuid REFERENCES public.vehicle_models(id) ON DELETE SET NULL;

ALTER TABLE public.vehicle_makes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_models ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public_read_vehicle_makes" ON public.vehicle_makes;
CREATE POLICY "public_read_vehicle_makes" ON public.vehicle_makes FOR SELECT USING (true);

DROP POLICY IF EXISTS "public_read_vehicle_models" ON public.vehicle_models;
CREATE POLICY "public_read_vehicle_models" ON public.vehicle_models FOR SELECT USING (true);

-- Defense-in-depth admin policy — actual admin-dashboard writes go through
-- the SECURITY DEFINER RPCs below, not this policy (same reasoning as
-- vehicle_classes' admin_all_vehicle_classes policy).
DROP POLICY IF EXISTS "admin_all_vehicle_makes" ON public.vehicle_makes;
CREATE POLICY "admin_all_vehicle_makes" ON public.vehicle_makes
  USING (EXISTS (SELECT 1 FROM public.admin_users WHERE admin_users.user_id = auth.uid() AND admin_users.is_active = true))
  WITH CHECK (EXISTS (SELECT 1 FROM public.admin_users WHERE admin_users.user_id = auth.uid() AND admin_users.is_active = true));

DROP POLICY IF EXISTS "admin_all_vehicle_models" ON public.vehicle_models;
CREATE POLICY "admin_all_vehicle_models" ON public.vehicle_models
  USING (EXISTS (SELECT 1 FROM public.admin_users WHERE admin_users.user_id = auth.uid() AND admin_users.is_active = true))
  WITH CHECK (EXISTS (SELECT 1 FROM public.admin_users WHERE admin_users.user_id = auth.uid() AND admin_users.is_active = true));

GRANT SELECT ON public.vehicle_makes TO anon, authenticated, service_role;
GRANT SELECT ON public.vehicle_models TO anon, authenticated, service_role;

-- ── Seed: Malawi-focused make/model catalog ──
-- Mapped onto the 4 vehicle_classes slugs live today (per 20260724000500's
-- reconciliation): small_hatchback, sedan, seven_seater, luxury — the
-- former comfort_sedan/premium_luxury split was already merged into a
-- single luxury class, so former "Comfort" and "Black" candidate models
-- (C-Class, 3 Series, A4, IS as well as E-Class, 5 Series, etc.) all map
-- to luxury here. This is a starting catalog, not a claim of every vehicle
-- on Malawi roads — admins add more via the CRUD RPCs below as new models
-- show up.
INSERT INTO public.vehicle_makes (name, slug, sort_order) VALUES
  ('Toyota', 'toyota', 1),
  ('Honda', 'honda', 2),
  ('Nissan', 'nissan', 3),
  ('Mazda', 'mazda', 4),
  ('Suzuki', 'suzuki', 5),
  ('Daihatsu', 'daihatsu', 6),
  ('Mitsubishi', 'mitsubishi', 7),
  ('Subaru', 'subaru', 8),
  ('Volkswagen', 'volkswagen', 9),
  ('Mercedes-Benz', 'mercedes_benz', 10),
  ('BMW', 'bmw', 11),
  ('Audi', 'audi', 12),
  ('Lexus', 'lexus', 13),
  ('Volvo', 'volvo', 14),
  ('Jaguar', 'jaguar', 15),
  ('Land Rover', 'land_rover', 16),
  ('Porsche', 'porsche', 17)
ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, sort_order = EXCLUDED.sort_order;

INSERT INTO public.vehicle_models (make_id, name, slug, vehicle_class_id, passenger_capacity, sort_order)
SELECT mk.id, m.name, m.slug, vc.id, m.capacity, m.sort_order
FROM (VALUES
  -- make_slug, model_name, model_slug, class_slug, capacity, sort_order
  ('toyota', 'Vitz / Yaris',        'vitz_yaris',        'small_hatchback', 4, 1),
  ('toyota', 'Starlet',             'starlet',           'small_hatchback', 4, 2),
  ('toyota', 'Aqua',                'aqua',              'small_hatchback', 4, 3),
  ('toyota', 'Corolla',             'corolla',           'sedan',    5, 4),
  ('toyota', 'Axio',                'axio',              'sedan',    5, 5),
  ('toyota', 'Premio',              'premio',            'sedan',    5, 6),
  ('toyota', 'Allion',              'allion',            'sedan',    5, 7),
  ('toyota', 'Camry',               'camry',             'sedan',    5, 8),
  ('toyota', 'Mark X',              'mark_x',            'sedan',    5, 9),
  ('toyota', 'Fortuner',            'fortuner',          'seven_seater',        7, 10),
  ('toyota', 'Land Cruiser Prado',  'land_cruiser_prado','seven_seater',        7, 11),
  ('toyota', 'RAV4',                'rav4',              'seven_seater',        7, 12),
  ('toyota', 'Noah',                'noah',              'seven_seater',        7, 13),
  ('toyota', 'Voxy',                'voxy',              'seven_seater',        7, 14),
  ('toyota', 'Wish',                'wish',              'seven_seater',        7, 15),
  ('toyota', 'Sienta',              'sienta',            'seven_seater',        7, 16),
  ('toyota', 'Land Cruiser 300',    'land_cruiser_300',  'luxury',    7, 17),

  ('honda', 'Fit / Jazz',           'fit_jazz',          'small_hatchback', 4, 1),
  ('honda', 'Fit Hybrid',           'fit_hybrid',        'small_hatchback', 4, 2),
  ('honda', 'Civic',                'civic',             'sedan',    5, 3),
  ('honda', 'Accord',               'accord',            'sedan',    5, 4),
  ('honda', 'Stream',               'stream',            'seven_seater',        7, 5),
  ('honda', 'Freed',                'freed',             'seven_seater',        7, 6),

  ('nissan', 'Note',                'note',              'small_hatchback', 4, 1),
  ('nissan', 'March / Micra',       'march_micra',       'small_hatchback', 4, 2),
  ('nissan', 'Sunny',               'sunny',             'sedan',    5, 3),
  ('nissan', 'Bluebird Sylphy',     'bluebird_sylphy',   'sedan',    5, 4),
  ('nissan', 'Tiida Sedan',         'tiida_sedan',       'sedan',    5, 5),
  ('nissan', 'X-Trail',             'x_trail',           'seven_seater',        7, 6),
  ('nissan', 'Serena',              'serena',            'seven_seater',        7, 7),

  ('mazda', 'Demio / Mazda2',       'demio_mazda2',      'small_hatchback', 4, 1),
  ('mazda', 'Axela / Mazda3 Sedan', 'axela_mazda3',      'sedan',    5, 2),

  ('suzuki', 'Swift',               'swift',             'small_hatchback', 4, 1),
  ('suzuki', 'Alto',                'alto',              'small_hatchback', 4, 2),

  ('daihatsu', 'Mira',              'mira',              'small_hatchback', 4, 1),
  ('daihatsu', 'Move',              'move',              'small_hatchback', 4, 2),

  ('mitsubishi', 'Lancer',          'lancer',            'sedan',    5, 1),
  ('mitsubishi', 'Pajero',          'pajero',            'seven_seater',        7, 2),
  ('mitsubishi', 'Outlander',       'outlander',         'seven_seater',        7, 3),

  ('subaru', 'Impreza Sedan',       'impreza_sedan',     'sedan',    5, 1),

  ('volkswagen', 'Polo',            'polo',              'small_hatchback', 4, 1),
  ('volkswagen', 'Jetta',           'jetta',             'sedan',    5, 2),

  ('mercedes_benz', 'C-Class',      'c_class',           'luxury',     5, 1),
  ('mercedes_benz', 'E-Class',      'e_class',           'luxury',    5, 2),
  ('mercedes_benz', 'S-Class',      's_class',           'luxury',    5, 3),
  ('mercedes_benz', 'GLC',          'glc',               'luxury',    5, 4),
  ('mercedes_benz', 'GLE',          'gle',               'luxury',    5, 5),

  ('bmw', '3 Series',               'bmw_3_series',      'luxury',     5, 1),
  ('bmw', '5 Series',               'bmw_5_series',      'luxury',    5, 2),
  ('bmw', '7 Series',               'bmw_7_series',      'luxury',    5, 3),
  ('bmw', 'X3',                     'bmw_x3',            'luxury',    5, 4),
  ('bmw', 'X5',                     'bmw_x5',            'luxury',    5, 5),
  ('bmw', 'X7',                     'bmw_x7',            'luxury',    7, 6),

  ('audi', 'A4',                    'a4',                'luxury',     5, 1),
  ('audi', 'A6',                    'a6',                'luxury',    5, 2),
  ('audi', 'A8',                    'a8',                'luxury',    5, 3),
  ('audi', 'Q5',                    'q5',                'luxury',    5, 4),
  ('audi', 'Q7',                    'q7',                'luxury',    7, 5),

  ('lexus', 'IS',                   'is',                'luxury',     5, 1),
  ('lexus', 'ES',                   'es',                'luxury',    5, 2),
  ('lexus', 'LS',                   'ls',                'luxury',    5, 3),
  ('lexus', 'RX',                   'rx',                'luxury',    5, 4),

  ('volvo', 'S90',                  's90',               'luxury',    5, 1),
  ('volvo', 'XC90',                 'xc90',              'luxury',    7, 2),
  ('jaguar', 'XF',                  'xf',                'luxury',    5, 1),
  ('land_rover', 'Range Rover',     'range_rover',       'luxury',    5, 1),
  ('porsche', 'Cayenne',            'cayenne',           'luxury',    5, 1)
) AS m(make_slug, name, slug, class_slug, capacity, sort_order)
JOIN public.vehicle_makes mk ON mk.slug = m.make_slug
LEFT JOIN public.vehicle_classes vc ON vc.slug = m.class_slug
ON CONFLICT (make_id, slug) DO UPDATE SET
  name = EXCLUDED.name, vehicle_class_id = EXCLUDED.vehicle_class_id,
  passenger_capacity = EXCLUDED.passenger_capacity, sort_order = EXCLUDED.sort_order;

-- ── Read helper: resolve a model's class in one round trip ──
CREATE OR REPLACE FUNCTION public.vehicle_model_class_id(p_vehicle_model_id uuid)
RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT vehicle_class_id FROM public.vehicle_models WHERE id = p_vehicle_model_id;
$$;

GRANT EXECUTE ON FUNCTION public.vehicle_model_class_id(uuid) TO anon, authenticated, service_role;

-- ── Admin CRUD RPCs (mirrors admin_upsert_vehicle_class pattern) ──
CREATE OR REPLACE FUNCTION public.admin_upsert_vehicle_make(
  p_id uuid DEFAULT NULL, p_name text DEFAULT '', p_slug text DEFAULT '',
  p_sort_order integer DEFAULT 0, p_is_active boolean DEFAULT true
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_result public.vehicle_makes;
BEGIN
  IF p_id IS NOT NULL THEN
    UPDATE public.vehicle_makes SET
      name = COALESCE(NULLIF(p_name, ''), name),
      slug = COALESCE(NULLIF(p_slug, ''), slug),
      sort_order = COALESCE(p_sort_order, sort_order),
      is_active = COALESCE(p_is_active, is_active),
      updated_at = now()
    WHERE id = p_id
    RETURNING * INTO v_result;
  ELSE
    INSERT INTO public.vehicle_makes (name, slug, sort_order, is_active)
    VALUES (p_name, p_slug, p_sort_order, p_is_active)
    RETURNING * INTO v_result;
  END IF;
  RETURN to_jsonb(v_result);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_delete_vehicle_make(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  DELETE FROM public.vehicle_makes WHERE id = p_id;
  RETURN jsonb_build_object('deleted', true, 'id', p_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_upsert_vehicle_model(
  p_id uuid DEFAULT NULL, p_make_id uuid DEFAULT NULL, p_name text DEFAULT '',
  p_slug text DEFAULT '', p_vehicle_class_id uuid DEFAULT NULL,
  p_passenger_capacity integer DEFAULT NULL, p_sort_order integer DEFAULT 0,
  p_is_active boolean DEFAULT true
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_result public.vehicle_models;
BEGIN
  IF p_id IS NOT NULL THEN
    UPDATE public.vehicle_models SET
      make_id = COALESCE(p_make_id, make_id),
      name = COALESCE(NULLIF(p_name, ''), name),
      slug = COALESCE(NULLIF(p_slug, ''), slug),
      vehicle_class_id = p_vehicle_class_id,
      passenger_capacity = p_passenger_capacity,
      sort_order = COALESCE(p_sort_order, sort_order),
      is_active = COALESCE(p_is_active, is_active),
      updated_at = now()
    WHERE id = p_id
    RETURNING * INTO v_result;
  ELSE
    IF p_make_id IS NULL THEN
      RAISE EXCEPTION 'make_id is required';
    END IF;
    INSERT INTO public.vehicle_models (make_id, name, slug, vehicle_class_id, passenger_capacity, sort_order, is_active)
    VALUES (p_make_id, p_name, p_slug, p_vehicle_class_id, p_passenger_capacity, p_sort_order, p_is_active)
    RETURNING * INTO v_result;
  END IF;
  RETURN to_jsonb(v_result);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_delete_vehicle_model(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  DELETE FROM public.vehicle_models WHERE id = p_id;
  RETURN jsonb_build_object('deleted', true, 'id', p_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_upsert_vehicle_make(uuid, text, text, integer, boolean) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_delete_vehicle_make(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_upsert_vehicle_model(uuid, uuid, text, text, uuid, integer, integer, boolean) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_delete_vehicle_model(uuid) TO anon, authenticated, service_role;
