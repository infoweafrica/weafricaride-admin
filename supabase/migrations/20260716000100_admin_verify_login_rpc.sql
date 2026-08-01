-- Creates the admin_verify_login RPC that admin-auth.ts calls.
-- Verifies email + password_hash server-side and returns the admin
-- record without ever exposing password_hash to the client.

CREATE OR REPLACE FUNCTION "public"."admin_verify_login"(
    "p_email" "text",
    "p_password_hash" "text"
) RETURNS TABLE(
    "id" "uuid",
    "email" "text",
    "display_name" "text",
    "role" "text",
    "role_id" "text"
)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  UPDATE admin_users
  SET login_count = COALESCE(login_count, 0) + 1,
      last_login = NOW(),
      last_login_at = NOW()
  WHERE admin_users.email = p_email
    AND admin_users.password_hash = p_password_hash
    AND admin_users.is_active = true
    AND admin_users.status = 'active';

  RETURN QUERY
  SELECT admin_users.id, admin_users.email, admin_users.display_name,
         admin_users.role, admin_users.role_id
  FROM admin_users
  WHERE admin_users.email = p_email
    AND admin_users.password_hash = p_password_hash
    AND admin_users.is_active = true
    AND admin_users.status = 'active';
END;
$$;

ALTER FUNCTION "public"."admin_verify_login"("text", "text") OWNER TO "postgres";

-- Only the server-side /api/admin/login route (using the service-role
-- client) calls this — never the browser's anon-key client — so it does
-- not need to be anon/authenticated-callable. Revoked explicitly from
-- anon/authenticated (not just PUBLIC) because this project has a
-- default-privilege rule that auto-grants EXECUTE on new functions to
-- those roles directly, which a PUBLIC-only revoke does not undo.
REVOKE ALL ON FUNCTION "public"."admin_verify_login"("text", "text") FROM PUBLIC, "anon", "authenticated";
GRANT ALL ON FUNCTION "public"."admin_verify_login"("text", "text") TO "service_role";
