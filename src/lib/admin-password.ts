import { createHash } from "node:crypto";

/** Matches the hashing scheme admin_verify_login expects (see /api/admin/login). */
export function hashAdminPassword(password: string): string {
  return createHash("sha256").update(password, "utf8").digest("hex");
}
