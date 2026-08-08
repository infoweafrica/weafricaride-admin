import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import type { Permission } from "./types";

// Server-only signed session token for the admin dashboard. This is the
// actual security boundary for admin API routes — the AdminSession object
// mirrored into localStorage (see admin-auth.ts) is for client-side UI state
// only and is never trusted by the server.

export const ADMIN_SESSION_COOKIE = "weafrica_admin_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface AdminSessionTokenPayload {
  id: string;
  email: string;
  display_name: string;
  role: string;
  role_id: string;
  permissions: Permission[];
  expires_at: number;
}

function getSecret(): string {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret) {
    throw new Error("ADMIN_SESSION_SECRET is not set");
  }
  return secret;
}

function base64url(input: Buffer): string {
  return input.toString("base64url");
}

export function signAdminSession(
  payload: Omit<AdminSessionTokenPayload, "expires_at">
): { token: string; session: AdminSessionTokenPayload } {
  const session: AdminSessionTokenPayload = {
    ...payload,
    expires_at: Date.now() + SESSION_TTL_MS,
  };
  const payloadB64 = base64url(Buffer.from(JSON.stringify(session), "utf8"));
  const sig = base64url(
    createHmac("sha256", getSecret()).update(payloadB64).digest()
  );
  return { token: `${payloadB64}.${sig}`, session };
}

export function verifyAdminSessionToken(
  token: string | undefined
): AdminSessionTokenPayload | null {
  if (!token) return null;
  const [payloadB64, sig] = token.split(".");
  if (!payloadB64 || !sig) return null;

  const expectedSig = base64url(
    createHmac("sha256", getSecret()).update(payloadB64).digest()
  );
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(payloadB64, "base64url").toString("utf8")
    ) as AdminSessionTokenPayload;
    if (!payload.expires_at || Date.now() > payload.expires_at) return null;
    return payload;
  } catch {
    return null;
  }
}

/** For use inside App Router API route handlers (Node runtime). */
export function requireAdminSession(
  request: NextRequest
): AdminSessionTokenPayload | null {
  const token = request.cookies.get(ADMIN_SESSION_COOKIE)?.value;
  return verifyAdminSessionToken(token);
}

/** For use in Server Components / route handlers via next/headers. */
export async function getAdminSessionFromCookies(): Promise<AdminSessionTokenPayload | null> {
  const store = await cookies();
  const token = store.get(ADMIN_SESSION_COOKIE)?.value;
  return verifyAdminSessionToken(token);
}

/**
 * Server-side mirror of the hasPermission() logic in auth-context.tsx.
 * Sessions with no permissions array (pre-permission-system) fall back to
 * treating the superadmin role as all_access, everyone else as denied.
 */
export function sessionHasPermission(
  session: AdminSessionTokenPayload | null,
  permission: Permission
): boolean {
  if (!session) return false;
  if (!session.permissions || session.permissions.length === 0) {
    return session.role === "superadmin";
  }
  if (session.permissions.includes("all_access")) return true;
  return session.permissions.includes(permission);
}
