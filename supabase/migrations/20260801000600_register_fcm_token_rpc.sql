-- ============================================================
-- register_fcm_token RPC
--
-- user_notification_tokens has no INSERT/UPDATE policy for regular
-- users at all (only admin_users and a self-SELECT), and that
-- self-SELECT policy uses auth.uid() directly — which, per
-- 20260718000100_firebase_auth_rls.sql, THROWS on real Firebase JWTs
-- (Firebase UIDs aren't valid UUIDs; auth.uid() hard-casts to uuid).
-- So neither app could ever write its own token via RLS. This RPC is
-- SECURITY DEFINER and derives user_id itself from the verified JWT's
-- `sub` claim via current_firebase_uid() (never trusts a client-
-- supplied user id), then upserts. Granted to anon+authenticated for
-- the same reason every other Firebase-auth'd policy/RPC in this
-- project is: Firebase JWTs resolve to the `anon` SQL role since they
-- carry no "role" claim (also documented in that migration).
-- ============================================================

CREATE OR REPLACE FUNCTION public.register_fcm_token(
  p_role text,
  p_fcm_token text,
  p_device_type text DEFAULT 'android'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id uuid;
BEGIN
  IF p_fcm_token IS NULL OR length(trim(p_fcm_token)) = 0 THEN
    RAISE EXCEPTION 'fcm_token is required';
  END IF;
  IF p_role NOT IN ('rider', 'driver') THEN
    RAISE EXCEPTION 'role must be rider or driver';
  END IF;

  SELECT id INTO v_user_id FROM public.users WHERE firebase_uid = public.current_firebase_uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'No user found for current session';
  END IF;

  INSERT INTO public.user_notification_tokens (user_id, role, fcm_token, device_type, is_active, last_seen_at)
  VALUES (v_user_id, p_role, p_fcm_token, COALESCE(p_device_type, 'android'), true, now())
  ON CONFLICT (user_id, fcm_token) DO UPDATE
    SET is_active = true, device_type = EXCLUDED.device_type, last_seen_at = now();
END;
$$;

GRANT EXECUTE ON FUNCTION public.register_fcm_token(text, text, text) TO anon, authenticated;

-- Best-effort cleanup on logout — mark this device's token inactive
-- rather than deleting (keeps the delivery-log FK/audit trail intact).
CREATE OR REPLACE FUNCTION public.unregister_fcm_token(p_fcm_token text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id uuid;
BEGIN
  SELECT id INTO v_user_id FROM public.users WHERE firebase_uid = public.current_firebase_uid();
  IF v_user_id IS NULL THEN RETURN; END IF;

  UPDATE public.user_notification_tokens
  SET is_active = false
  WHERE user_id = v_user_id AND fcm_token = p_fcm_token;
END;
$$;

GRANT EXECUTE ON FUNCTION public.unregister_fcm_token(text) TO anon, authenticated;
