// ====================================
// WeAfrica Ride - Admin Auth Utilities
// ====================================
// Handles direct admin_users authentication using SHA-256 password hashing,
// plus loads full role + permission data from the 16-role hierarchy.

import { supabase } from "./supabase";
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

// ─── SHA-256 PASSWORD UTILITIES ──────────────────────────────

async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function verifyPassword(
  password: string,
  storedHash: string
): Promise<boolean> {
  const hashed = await hashPassword(password);
  return hashed === storedHash;
}

// ─── PERMISSION LOADING ──────────────────────────────────────

/**
 * Fetch all permission names assigned to the role via the role_permissions table.
 * Uses the role name stored in admin_users.role (e.g. "superadmin").
 */
async function fetchPermissionsForRole(roleName: string): Promise<Permission[]> {
  try {
    // Look up the role ID from admin_roles
    const { data: role } = await supabase
      .from("admin_roles")
      .select("id")
      .eq("name", roleName)
      .single();

    if (!role) return [];

    // Fetch permission names via role_permissions + admin_permissions join
    const { data: perms } = await supabase
      .from("role_permissions")
      .select("admin_permissions!inner(name)")
      .eq("role_id", (role as { id: string }).id);

    if (!perms || perms.length === 0) return [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return perms.map((p: any) => p.admin_permissions?.name ?? p.permission_name).filter(Boolean) as Permission[];
  } catch {
    return [];
  }
}

// ─── AUTHENTICATION ──────────────────────────────────────────

export async function adminSignIn(
  email: string,
  password: string
): Promise<{ session: AdminSession | null; error: string | null }> {
  try {
    const normalizedEmail = email.trim().toLowerCase();

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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = data as any;

    // 2. Verify password
    const isValid = await verifyPassword(
      password,
      admin.password_hash || ""
    );

    if (!isValid) {
      return { session: null, error: "Invalid email or password" };
    }

    // 3. Load permissions for this role
    const roleName: string = admin.role || "analyst";
    const permissions = await fetchPermissionsForRole(roleName);

    // 4. Update last login
    await supabase
      .from("admin_users")
      .update({
        last_login_at: new Date().toISOString(),
        login_count: (admin.login_count || 0) + 1,
      })
      .eq("id", admin.id);

    // 5. Build session
    const session: AdminSession = {
      id: admin.id as string,
      email: admin.email as string,
      display_name: (admin.display_name || admin.email) as string,
      role: roleName,
      role_id: (admin.role_id || "") as string,
      permissions,
      expires_at: Date.now() + 7 * 24 * 60 * 60 * 1000,
    };

    return { session, error: null };
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
}