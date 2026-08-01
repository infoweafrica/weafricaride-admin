
// ====================================
// WeAfrica Ride — Admin/Staff API Module
// ====================================
// Queries admin_users, admin_roles, role_permissions, admin_permissions.
// Supports the full 16-role hierarchy.

import { supabase } from "@/lib/supabase";
import type { AdminUser, AdminRole, Permission } from "../types";
import type { PaginatedResult } from "./base";

const ADMIN_TABLE = "admin_users";

// ─── FETCH STAFF ──────────────────────────────────────────────

export async function fetchStaff(
  page = 1,
  pageSize = 25
): Promise<PaginatedResult<AdminUser[]>> {
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  try {
    const { count: total, error: countErr } = await supabase
      .from(ADMIN_TABLE)
      .select("*", { count: "exact", head: true });

    if (countErr) {
      return { data: null, error: countErr.message, count: 0, page, pageSize, totalCount: 0, totalPages: 0 };
    }

    const { data, error } = await supabase
      .from(ADMIN_TABLE)
      .select("*")
      .order("created_at", { ascending: false })
      .range(from, to);

    if (error) {
      return { data: null, error: error.message, count: 0, page, pageSize, totalCount: total ?? 0, totalPages: Math.ceil((total ?? 0) / pageSize) };
    }

    const arr = (data as AdminUser[]) ?? [];
    const totalCount = total ?? 0;

    return {
      data: arr,
      error: null,
      count: arr.length,
      page,
      pageSize,
      totalCount,
      totalPages: Math.ceil(totalCount / pageSize),
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

export async function suspendStaff(adminId: string): Promise<boolean> {
  const { error } = await supabase
    .from(ADMIN_TABLE)
    .update({ is_active: false })
    .eq("id", adminId);
  return !error;
}

export async function activateStaff(adminId: string): Promise<boolean> {
  const { error } = await supabase
    .from(ADMIN_TABLE)
    .update({ is_active: true })
    .eq("id", adminId);
  return !error;
}

export async function changeStaffRole(
  adminId: string,
  newRole: string
): Promise<boolean> {
  const { error } = await supabase
    .from(ADMIN_TABLE)
    .update({ role: newRole })
    .eq("id", adminId);
  return !error;
}

export async function inviteStaffByEmail(
  email: string,
  fullName: string,
  roleId: string
): Promise<{ success: boolean; message: string }> {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
    const response = await fetch(
      `${supabaseUrl}/functions/v1/send-invite-email`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${anonKey}`,
        },
        body: JSON.stringify({ email, full_name: fullName, role_id: roleId }),
      }
    );
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
  const { error } = await supabase.from(ADMIN_TABLE).delete().eq("id", adminId);
  return !error;
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
