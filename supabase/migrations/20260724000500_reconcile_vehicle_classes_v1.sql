-- Reconciles vehicle_classes with the locked "WeAfrica Ride Malawi v1"
-- eligibility matrix:
--   Small Hatchback -> Go, Delivery
--   Sedan           -> Go, X, Delivery
--   7-Seater        -> Go, XL, Delivery
--   Luxury          -> Comfort, Black
--
-- Two real changes from what 20260724000400 seeded:
--   1. Comfort and Black merge into a single Luxury class (previously
--      split into comfort_sedan/premium_luxury for backward-compat
--      reasons — the user has now explicitly confirmed the merge).
--   2. 7-Seater drops X (previously xl_vehicle had go+x+xl; the v1 spec
--      is go+xl only — a real behavior change, not just a rename).
--   3. A new "Delivery" service is added to every non-luxury class.
--
-- Safe to re-run: renames existing rows by their current slug (idempotent
-- since a second run finds the already-renamed slug and no-ops the WHERE
-- clause), and the eligibility rewrite is a full delete-then-insert per
-- class exactly like admin_upsert_vehicle_class_eligibility does.

-- ── 1. New "Delivery" ride category (must exist before eligibility rows ──
-- reference it, since vehicle_class_eligibility.ride_category_slug FKs to
-- ride_categories.slug).
INSERT INTO public.ride_categories (name, slug, description, icon, sort_order, is_active)
VALUES ('Delivery', 'delivery', 'Parcel and package delivery', 'delivery', 7, true)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name, description = EXCLUDED.description,
  icon = EXCLUDED.icon, is_active = EXCLUDED.is_active;

-- Placeholder national pricing for delivery, mirroring Go's rates — real
-- delivery pricing (likely weight/size-based, not just distance) is not
-- yet defined; this just makes the row exist so nothing errors if
-- delivery ever goes through the same estimate_fare/compute_fare_estimate
-- pipeline as passenger rides. pricing_config has no unique constraint to
-- ON CONFLICT against, so delete-then-insert for idempotency (same
-- pattern used in 20260724000100).
DELETE FROM public.pricing_config
WHERE country_code = 'MW' AND city IS NULL AND vehicle_type = 'delivery';
INSERT INTO public.pricing_config
  (country_code, city, vehicle_type, base_fare, minimum_fare, per_km, per_min, commission_percent, currency, is_active)
VALUES ('MW', NULL, 'delivery', 1000, 1500, 350, 40, 20.00, 'MWK', true);

-- ── 2. Rename existing classes to match the v1 names/slugs ──
UPDATE public.vehicle_classes SET name = 'Small Hatchback', slug = 'small_hatchback',
  description = 'Compact, affordable everyday cars' WHERE slug = 'economy_hatchback';
UPDATE public.vehicle_classes SET name = 'Sedan', slug = 'sedan',
  description = 'Standard 4-5 seater sedans' WHERE slug = 'standard_sedan';
UPDATE public.vehicle_classes SET name = '7-Seater', slug = 'seven_seater',
  description = 'SUVs, vans, and 7-seater MPVs' WHERE slug = 'xl_vehicle';
UPDATE public.vehicle_classes SET name = 'Luxury', slug = 'luxury',
  description = 'Approved premium/executive vehicles — evaluated individually by make, model, year, and condition'
  WHERE slug = 'premium_luxury';

-- ── 3. Merge comfort_sedan into luxury, then drop it ──
-- No vehicles are assigned to comfort_sedan yet (confirmed live before
-- writing this migration), so this is a clean delete, not a reassignment.
DELETE FROM public.vehicle_class_eligibility
WHERE vehicle_class_id = (SELECT id FROM public.vehicle_classes WHERE slug = 'comfort_sedan');
DELETE FROM public.vehicle_classes WHERE slug = 'comfort_sedan';

-- ── 4. Rewrite eligibility per class to match the v1 matrix exactly ──
-- (full delete-then-insert per class, same idempotent pattern as
-- admin_upsert_vehicle_class_eligibility)
DELETE FROM public.vehicle_class_eligibility
WHERE vehicle_class_id IN (SELECT id FROM public.vehicle_classes WHERE slug IN
  ('small_hatchback', 'sedan', 'seven_seater', 'luxury'));

INSERT INTO public.vehicle_class_eligibility (vehicle_class_id, ride_category_slug, priority)
SELECT vc.id, e.slug, e.priority
FROM public.vehicle_classes vc
JOIN (VALUES
  ('small_hatchback', 'go',       1),
  ('small_hatchback', 'delivery', 2),
  ('sedan',           'go',       1),
  ('sedan',           'x',        2),
  ('sedan',           'delivery', 3),
  ('seven_seater',    'go',       1),
  ('seven_seater',    'xl',       2),
  ('seven_seater',    'delivery', 3),
  ('luxury',          'comfort',  1),
  ('luxury',          'black',    2)
) AS e(class_slug, slug, priority) ON e.class_slug = vc.slug
ON CONFLICT (vehicle_class_id, ride_category_slug) DO UPDATE SET priority = EXCLUDED.priority;
