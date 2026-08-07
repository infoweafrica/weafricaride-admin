-- Can't patch auth.uid() itself (permission denied for schema auth, even
-- as the project's postgres role — Supabase locks that schema down
-- platform-wide). This is the public-schema equivalent: same tolerant
-- logic (returns NULL instead of throwing when the JWT's sub claim isn't
-- UUID-shaped, e.g. a Firebase UID), for RLS policies to call instead of
-- auth.uid() directly. See 20260805000200_tolerant_auth_uid.sql for the
-- full root-cause writeup — this is the fallback since that migration's
-- actual approach didn't have permission to apply.
--
-- Policies get migrated to this one at a time, prioritized by what
-- driver-app/rider-app actually hit, not all 158 at once.
CREATE OR REPLACE FUNCTION public.current_uid_safe()
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
