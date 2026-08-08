-- Password reset tokens for admin_users. Only ever read/written by
-- service-role API routes (/api/admin/forgot-password, /api/admin/reset-password);
-- the browser's anon-key client never touches this table directly, so RLS
-- is enabled with zero anon/authenticated policies (default-deny) and the
-- table-level grant is revoked from anon/authenticated to match the
-- default-privilege rule already documented in
-- 20260716000100_admin_verify_login_rpc.sql.

CREATE TABLE IF NOT EXISTS "public"."admin_password_resets" (
    "id" "uuid" DEFAULT "gen_random_uuid"() PRIMARY KEY,
    "admin_id" "uuid" NOT NULL REFERENCES "public"."admin_users"("id") ON DELETE CASCADE,
    "token" "text" NOT NULL UNIQUE,
    "expires_at" timestamp with time zone NOT NULL DEFAULT (now() + interval '1 hour'),
    "used_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "admin_password_resets_token_idx" ON "public"."admin_password_resets" ("token");

ALTER TABLE "public"."admin_password_resets" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."admin_password_resets" FROM PUBLIC, "anon", "authenticated";
GRANT ALL ON TABLE "public"."admin_password_resets" TO "service_role";
