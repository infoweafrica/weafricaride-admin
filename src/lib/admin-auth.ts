// ====================================
// WeAfrica Ride - Admin Auth Utilities
// ====================================
// Client-side helpers for the admin dashboard. Credential verification and
// password hashing happen server-side in /api/admin/login, which also sets
// the httpOnly session cookie that API routes actually trust. The
// AdminSession mirrored here (localStorage) is client-side UI state only.

import type { Permission } from "./types";

export interface AdminSession {
  id: string;
  email: string;
  display_name: string;
  role: string;
  role_id: string;
  permissions: Permission[];
  expires_at: number;
}

// ─── AUTHENTICATION ──────────────────────────────────────────

export async function adminSignIn(
  email: string,
  password: string
): Promise<{ session: AdminSession | null; error: string | null }> {
  try {
    const response = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const body = await response.json();
    if (!response.ok || !body.session) {
      return { session: null, error: body.error || "Invalid email or password" };
    }
    return { session: body.session as AdminSession, error: null };
  } catch (err) {
    return {
      session: null,
      error: err instanceof Error ? err.message : "Sign in failed",
    };
  }
}

// ─── SESSION PERSISTENCE (localStorage) ──────────────────────

const SESSION_KEY = "weafrica_admin_session";

export function saveSession(session: AdminSession): void {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    // localStorage may not be available
  }
}

export function loadSession(): AdminSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const session: AdminSession = JSON.parse(raw);
    // Check expiry
    if (Date.now() > session.expires_at) {
      localStorage.removeItem(SESSION_KEY);
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    // ignore
  }
  // Best-effort: clear the httpOnly session cookie server-side too.
  fetch("/api/admin/logout", { method: "POST" }).catch(() => {});
}
