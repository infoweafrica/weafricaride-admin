#!/bin/bash
set -e
FILE="src/lib/admin-auth.ts"
python3 - "$FILE" <<'PYEOF'
import sys
path = sys.argv[1]
with open(path, "r") as f:
    content = f.read()
old = '''    const normalizedEmail = email.trim().toLowerCase();
    // 1. Fetch admin user by email
    const { data, error } = await supabase
      .from("admin_users")
      .select("*")
      .eq("email", normalizedEmail)
      .eq("is_active", true)
      .single();
    if (error || !data) {
      return { session: null, error: "No admin account found with this email" };
    }
     
    const admin = data as any;
    // 2. Verify password
    const isValid = await verifyPassword(
      password,
      admin.password_hash || ""
    );
    if (!isValid) {
      return { session: null, error: "Invalidemail or password" };
    }'''
new = '''    const normalizedEmail = email.trim().toLowerCase();
    // 1. Hash the password client-side (as before), then verify it
    //    server-side via RPC. The RPC checks the hash inside Postgres
    //    and never returns password_hash to the client.
    const passwordHash = await hashPassword(password);
    const { data, error } = await supabase
      .rpc("admin_verify_login", {
        p_email: normalizedEmail,
        p_password_hash: passwordHash,
      })
      .single();
    if (error || !data) {
      return { session: null, error: "Invalid email or password" };
    }
     
    const admin = data as any;'''
if old not in content:
    print("ERROR: old block not found verbatim — manual edit needed.")
    sys.exit(1)
content = content.replace(old, new, 1)
with open(path, "w") as f:
    f.write(content)
print("Patched", path)
PYEOF
