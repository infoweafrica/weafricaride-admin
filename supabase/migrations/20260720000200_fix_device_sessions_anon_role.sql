-- Fixes a real gap found while testing device_sessions live: PostgREST
-- only assigns the `authenticated` SQL role when the JWT carries an
-- explicit "role" claim. Firebase ID tokens never have one — even a
-- successfully-verified third-party Firebase token resolves to `anon`.
-- The policy on device_sessions was scoped `TO authenticated` only, so it
-- never matched real app traffic (confirmed: 42501 permission denied,
-- even with a valid, verified Firebase JWT attached).
--
-- Safe to widen to anon+authenticated: the actual authorization is the
-- row condition (firebase_uid = current_firebase_uid()), not the SQL
-- role. A request with no real Firebase JWT gets NULL from
-- current_firebase_uid() and matches nothing regardless of role.

DROP POLICY IF EXISTS "own_session_all" ON "public"."device_sessions";
CREATE POLICY "own_session_all" ON "public"."device_sessions"
  FOR ALL TO "anon", "authenticated"
  USING (firebase_uid = public.current_firebase_uid())
  WITH CHECK (firebase_uid = public.current_firebase_uid());

GRANT SELECT, INSERT, UPDATE ON public.device_sessions TO anon, authenticated;
