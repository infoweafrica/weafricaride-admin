-- Single active device/session per account, per app role (driver/rider).
-- Broader than the existing drivers.active_device_id mechanism (see
-- driver_go_online/driver_go_offline): those only guard the go-online
-- action and never notify the other device. This table backs sign-in-time
-- enforcement — a new sign-in overwrites the row, and the previously
-- active device detects the change via Realtime and force-logs-out.
--
-- Uses public.current_firebase_uid() (auth.jwt() ->> 'sub'), not
-- auth.uid() — this project's auth.uid() does a hard ::uuid cast that
-- throws for Firebase's non-UUID subs (see 20260718000100_firebase_auth_rls.sql).

-- Self-contained: 20260718000100_firebase_auth_rls.sql (which also defines
-- this helper) is deliberately not applied yet, pending real app rollout —
-- this migration doesn't depend on that one landing first.
CREATE OR REPLACE FUNCTION public.current_firebase_uid()
RETURNS text
LANGUAGE sql STABLE
AS $$
  SELECT auth.jwt() ->> 'sub'
$$;

CREATE TABLE public.device_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firebase_uid text NOT NULL,
  role text NOT NULL CHECK (role IN ('driver', 'rider')),
  device_id text NOT NULL,
  device_type text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (firebase_uid, role)
);

ALTER TABLE public.device_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own_session_all" ON "public"."device_sessions"
  FOR ALL TO "authenticated"
  USING (firebase_uid = public.current_firebase_uid())
  WITH CHECK (firebase_uid = public.current_firebase_uid());

ALTER PUBLICATION supabase_realtime ADD TABLE public.device_sessions;
