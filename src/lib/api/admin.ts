
// ====================================
// WeAfrica Ride — Admin/Staff API Module
// ====================================
// Queries admin_users, admin_roles, role_permissions, admin_permissions.
// Supports the full 16-role hierarchy.

import { supabase } from "@/lib/supabase";
import type { AdminUser, AdminRole, Permission } from "../types";
import type { PaginatedResult } from "./base";

// ─── FETCH STAFF ──────────────────────────────────────────────

// admin_users has no anon/authenticated RLS policies (see
// 20260716000200_tighten_anon_financial_rls.sql) — every one of these
// functions used to query it directly with the anonymous browser
// `supabase` client, which RLS silently reduces to zero rows (no error),
// not a rejection. That's why staff never showed up: the request
// "succeeded" with an empty result. All of this now goes through the
// service-role-backed /api/admin/staff routes instead, same as the
// driver date-of-birth fix.
export async function fetchStaff(
  page = 1,
  pageSize = 25
): Promise<PaginatedResult<AdminUser[]>> {
  try {
    const res = await fetch(`/api/admin/staff?page=${page}&pageSize=${pageSize}`);
    const result = await res.json();
    if (!res.ok) {
      return { data: null, error: result.error || "Failed to load staff", count: 0, page, pageSize, totalCount: 0, totalPages: 0 };
    }
    const arr = (result.data as AdminUser[]) ?? [];
    return {
      data: arr,
      error: null,
      count: arr.length,
      page: result.page,
      pageSize: result.pageSize,
      totalCount: result.totalCount,
      totalPages: result.totalPages,
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
  newRole: string
): Promise<boolean> {
  // `newRole` is actually admin_roles.id here — the <select> in staff/page.tsx
  // uses role.id as its option value, and the PATCH route resolves that id
  // to the role name/id pair itself.
  return patchStaff(adminId, { role_id: newRole });
}

// This used to call a Supabase Edge Function, `send-invite-email` — which
// doesn't exist on this project (not in the deployed functions list at
// all). Every invite was hitting a 404. The real implementation was
// already built as a Next.js API route (/api/admin/staff/invite,
// service-role, resolves role_id correctly, writes staff_invitations) —
// it just was never wired to this form.
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

export async function deleteStaff(adminId: string): Promise<{ success: boolean; error?: string }> {
  const res = await fetch(`/api/admin/staff/${adminId}`, { method: "DELETE" });
  if (res.ok) return { success: true };
  const result = await res.json().catch(() => ({}));
  return { success: false, error: result.error };
}

export async function resendInvitation(
  email: string,
  fullName: string,
  roleId: string
): Promise<{ success: boolean; message: string }> {
  return inviteStaffByEmail(email, fullName, roleId);
}

export interface PendingStaffInvitation {
  id: string;
  email: string;
  full_name: string;
  admin_role_id: string;
  status: string;
  created_at: string;
  admin_roles: { name: string } | null;
}

export async function fetchPendingInvitations(): Promise<PendingStaffInvitation[]> {
  try {
    const res = await fetch("/api/admin/staff/invite");
    if (!res.ok) return [];
    const body = await res.json();
    return (body.data as PendingStaffInvitation[]) ?? [];
  } catch {
    return [];
  }
}

export async function revokeInvitation(id: string): Promise<boolean> {
  const res = await fetch(`/api/admin/staff/invite/${id}`, { method: "DELETE" });
  return res.ok;
}

// ─── COUNTS ───────────────────────────────────────────────────

// admin_users itself has no anon RLS policy (see the comment on fetchStaff
// above), so these can't use safeCount like every other table's counts do.
// No dedicated count endpoint exists yet — the staff table is small, so
// deriving counts from the full list via the service-role route is simpler
// than adding one.
async function staffCounts(): Promise<{ total: number; active: number; suspended: number }> {
  const result = await fetchStaff(1, 500);
  const staff = result.data ?? [];
  return {
    total: staff.length,
    active: staff.filter((s) => s.is_active).length,
    suspended: staff.filter((s) => !s.is_active).length,
  };
}

export async function fetchTotalStaffCount(): Promise<number> {
  return (await staffCounts()).total;
}

export async function fetchActiveStaffCount(): Promise<number> {
  return (await staffCounts()).active;
}

export async function fetchSuspendedStaffCount(): Promise<number> {
  return (await staffCounts()).suspended;
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
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/send_password_reset`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${anonKey}` },
      body: JSON.stringify({ p_email: email }),
    });
    const data = await response.json();
    if (response.ok) return { success: true, message: "Password reset email sent" };
    return { success: false, message: data?.message || "Failed to send reset email" };
  } catch (err) {
    return { success: false, message: err instanceof Error ? err.message : "Network error" };
  }
}
