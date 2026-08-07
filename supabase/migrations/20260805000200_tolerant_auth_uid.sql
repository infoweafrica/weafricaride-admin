-- Root cause behind a whole family of "invalid input syntax for type
-- uuid: <28-char string>" errors scattered across both mobile apps all
-- session (trip_events sync, rider profile lookups, wallet policies,
-- etc.): auth.uid() unconditionally does `(sub claim)::uuid`. Neither
-- driver-app nor rider-app authenticates via real Supabase Auth — both
-- forward a raw Firebase ID token as the bearer (see SupabaseAuthBridge /
-- Supabase.initialize(accessToken: ...) in each app's main.dart), and
-- Firebase UIDs are 28-char base64-style strings, not UUIDs. So the cast
-- inside auth.uid() throws for every single Firebase-authenticated
-- request that reaches any RLS policy or function calling auth.uid() —
-- confirmed today via trip_events' "Users can view their trip events"
-- policy, but auth.uid() appears in 158 policies across 103 tables
-- project-wide, so the same failure mode almost certainly explains many
-- of the "Fetch performance error" / "Resolve rider profile error" /
-- similar invalid-uuid errors logged elsewhere this session.
--
-- Fix: catch the cast failure and return NULL instead of raising. A NULL
-- auth.uid() is exactly what already happens today for a genuinely
-- anonymous/unauthenticated request under every one of those 158
-- policies — none of them were written to expect auth.uid() to *throw*,
-- so this doesn't change behavior for real Supabase-auth sessions
-- (Google OAuth issued by Supabase's own GoTrue, whose sub *is* a UUID)
-- and makes Firebase-bridged requests fail the policy check (denied)
-- instead of erroring the whole query.
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE plpgsql
STABLE
AS $function$
DECLARE
  v_sub text;
BEGIN
  v_sub := coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  );
  IF v_sub IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN v_sub::uuid;
EXCEPTION WHEN invalid_text_representation THEN
  RETURN NULL;
END;
$function$;
