import re
path = "src/lib/admin-auth.ts"
with open(path, "r") as f:
    lines = f.readlines()
start_idx = None
end_idx = None
for i, line in enumerate(lines):
    if 'from("admin_users")' in line and start_idx is None:
        for j in range(i, max(i - 6, -1), -1):
            if "const normalizedEmail" in lines[j]:
                start_idx = j
                break
    if start_idx is not None and 'Invalid' in line and 'or password' in line:
        for k in range(i, min(i + 4, len(lines))):
            if lines[k].strip() == "}":
                end_idx = k
                break
        break
if start_idx is None or end_idx is None:
    print("ERROR: could not locate block via anchors. start_idx=%s end_idx=%s" % (start_idx, end_idx))
    raise SystemExit(1)
new_block = '''    const normalizedEmail = email.trim().toLowerCase();
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
'''
lines[start_idx:end_idx + 1] = [new_block]
with open(path, "w") as f:
    f.writelines(lines)
print("Patched lines %d-%d in %s" % (start_idx + 1, end_idx + 1, path))
