-- trip_events had no owner-scoped SELECT policy that actually worked for
-- Firebase-bridged requests: trip_events has no rider_id/driver_id/
-- firebase_uid column of its own, only trip_id -> rides. The policy has
-- to join through rides -> riders/drivers -> users.firebase_uid.
--
-- This was applied live via psql during debugging (see session notes)
-- and is being checked in now for reproducibility.
DROP POLICY IF EXISTS "Users can view their trip events" ON public.trip_events;
CREATE POLICY "Users can view their trip events" ON public.trip_events
FOR SELECT TO authenticated, anon
USING (
  EXISTS (
    SELECT 1 FROM rides r
    WHERE r.id = trip_events.trip_id
      AND (
        EXISTS (SELECT 1 FROM riders rd JOIN users u ON u.id = rd.user_id WHERE rd.id = r.rider_id AND u.firebase_uid = public.current_firebase_uid())
        OR
        EXISTS (SELECT 1 FROM drivers dr JOIN users u ON u.id = dr.user_id WHERE dr.id = r.driver_id AND u.firebase_uid = public.current_firebase_uid())
      )
  )
);
