
// ====================================
// WeAfrica Ride — Admin/Staff API Module
// ====================================
// admin_users has no anon-key RLS access (see
// 20260716000200_tighten_anon_financial_rls.sql) — all staff CRUD below
// goes through /api/admin/staff/*, which uses the service-role client and
// the caller's signed session cookie. admin_roles/role_permissions/
// admin_permissions are still anon-readable (non-sensitive role
// definitions), so fetchRoles() below queries them directly.

import { supabase } from "@/lib/supabase";
import type { AdminUser, AdminRole, Permission } from "../types";
import type { PaginatedResult } from "./base";

const ADMIN_TABLE = "admin_users";

// ─── FETCH STAFF ──────────────────────────────────────────────

export async function fetchStaff(
  page = 1,
  pageSize = 25
): Promise<PaginatedResult<AdminUser[]>> {
  try {
    const res = await fetch(`/api/admin/staff?page=${page}&pageSize=${pageSize}`);
    const body = await res.json();
    if (!res.ok) {
      return { data: null, error: body.error || "Failed to load staff", count: 0, page, pageSize, totalCount: 0, totalPages: 0 };
    }
    const arr = (body.data as AdminUser[]) ?? [];
    return {
      data: arr,
      error: null,
      count: arr.length,
      page: body.page,
      pageSize: body.pageSize,
      totalCount: body.totalCount,
      totalPages: body.totalPages,
    };
  } catch (err) {
    return { data: null, error: err instanceof Error ? err.message : "Unknown", count: 0, page, pageSize, totalCount: 0, totalPages: 0 };
  }
}

// ─── FETCH ROLES (from admin_roles table) ─────────────────────

export async function fetchRoles(): Promise<AdminRole[]> {
  try {
    const { data, error } = await supabase
      .from("admin_roles")
      .select("id, name, description")
      .order("name");

    if (error || !data) return [];

    // For each role, fetch its permissions
    const roles: AdminRole[] = [];

    for (const role of data) {
       
      const { data: permsData, error: permsError } = await supabase
        .from("role_permissions")
        .select("admin_permissions!inner(name)")
        .eq("role_id", (role as { id: string }).id);

      let perms: Permission[] = [];
      if (!permsError && permsData) {
         
        perms = (permsData as any[])
          .map((p: any) => p.admin_permissions?.name)
          .filter(Boolean) as Permission[];
      }

      roles.push({
        id: (role as { id: string }).id,
        name: (role as { name: string }).name as AdminRole["name"],
        description: (role as { description?: string }).description,
        permissions: perms,
        created_at: "",
      });
    }

    return roles;
  } catch {
    return [];
  }
}

// ─── STAFF ACTIONS ────────────────────────────────────────────

async function patchStaff(adminId: string, body: Record<string, unknown>): Promise<boolean> {
  const res = await fetch(`/api/admin/staff/${adminId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.ok;
}

export async function suspendStaff(adminId: string): Promise<boolean> {
  return patchStaff(adminId, { status: "suspended" });
}

export async function activateStaff(adminId: string): Promise<boolean> {
  return patchStaff(adminId, { status: "active" });
}

export async function changeStaffRole(
  adminId: string,
  roleId: string
): Promise<boolean> {
  return patchStaff(adminId, { role_id: roleId });
}

export async function inviteStaffByEmail(
  email: string,
  fullName: string,
  roleId: string
): Promise<{ success: boolean; message: string }> {
  try {
    const response = await fetch("/api/admin/staff/invite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, full_name: fullName, role_id: roleId }),
    });
    const data = await response.json();
    if (response.ok && data.success)
      return { success: true, message: data.message ?? "Invitation sent!" };
    return {
      success: false,
      message: data.error ?? data.message ?? "Failed to send invitation",
    };
  } catch (err) {
    return {
      success: false,
      message: err instanceof Error ? err.message : "Network error",
    };
  }
}

export async function deleteStaff(adminId: string): Promise<boolean> {
  const res = await fetch(`/api/admin/staff/${adminId}`, { method: "DELETE" });
  return res.ok;
}

export async function resendInvitation(
  email: string,
  fullName: string,
  roleId: string
): Promise<{ success: boolean; message: string }> {
  return inviteStaffByEmail(email, fullName, roleId);
}

// ─── COUNTS ───────────────────────────────────────────────────

async function safeCount(
  table: string,
  col?: string,
  val?: unknown
): Promise<number> {
  try {
     
    let q: any = supabase
      .from(table)
      .select("*", { count: "exact", head: true });
    if (col && val !== undefined) q = q.eq(col, val);
    const { count, error } = await q;
    return error ? 0 : count ?? 0;
  } catch {
    return 0;
  }
}

export async function fetchTotalStaffCount(): Promise<number> {
  return safeCount(ADMIN_TABLE);
}

export async function fetchActiveStaffCount(): Promise<number> {
  return safeCount(ADMIN_TABLE, "is_active", true);
}

export async function fetchSuspendedStaffCount(): Promise<number> {
  return safeCount(ADMIN_TABLE, "is_active", false);
}

// ─── LABEL HELPERS ────────────────────────────────────────────

export function roleLabel(role?: string | null): string {
  if (!role) return "Unknown";
  // Capitalize and replace underscores
  return role
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

// ─── BACKWARD COMPATIBILITY EXPORTS ──────────────────────────

/** @deprecated Use AdminUser from @/lib/types instead */
export type AdminUserRow = AdminUser;
export { type AdminRole };
export { type AdminUser };

export async function resetStaffPassword(email: string): Promise<{ success: boolean; message: string }> {
  try {
    const response = await fetch("/api/admin/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const data = await response.json();
    if (response.ok) return { success: true, message: data.message ?? "Password reset email sent" };
    return { success: false, message: data?.error || "Failed to send reset email" };
  } catch (err) {
    return { success: false, message: err instanceof Error ? err.message : "Network error" };
  }
}
