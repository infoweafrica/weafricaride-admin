-- ============================================================
-- Fix one-active-ride-per-rider enforcement.
--
-- Two unique partial indexes existed, both stale:
--   one_active_ride            WHERE status IN ('requested','searching','driver_assigned','driver_arrived','started')
--   one_active_ride_per_rider  WHERE status IN ('requested','searching','driver_assigned')
--
-- Neither list matches the status values the live functions actually
-- write ('accepted','arrived','in_progress' — not 'driver_assigned',
-- 'driver_arrived', or 'started', which nothing sets). Net effect: once
-- a ride reached 'accepted' or beyond, the DB no longer blocked a
-- second concurrent active ride for the same rider at all. Replace
-- both with one index using the real status vocabulary (matches
-- Trip.isActive in rider-app/lib/core/models/trip.dart).
-- ============================================================

DROP INDEX IF EXISTS public.one_active_ride;
DROP INDEX IF EXISTS public.one_active_ride_per_rider;

CREATE UNIQUE INDEX one_active_ride_per_rider ON public.rides (rider_id)
WHERE (status = ANY (ARRAY[
  'requested', 'searching', 'assigned', 'accepted',
  'en_route', 'arrived', 'picked_up', 'in_progress'
]));
