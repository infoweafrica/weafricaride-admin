// ====================================
// WeAfrica Ride — Corporate Accounts API Module
// ====================================
// corporate_accounts and friends have no anon-key RLS access (same
// posture as admin_users) — all CRUD below goes through
// /api/admin/corporate/*, which uses the service-role client and the
// caller's signed session cookie. Mirrors lib/api/admin.ts's conventions.

import type { CorporateAccount, CorporateAccountMember, CorporateInvitation, CorporateInvoice, CorporateMemberRole } from "../types";
import type { PaginatedResult } from "./base";

export async function fetchCorporateAccounts(
  page = 1,
  pageSize = 50
): Promise<PaginatedResult<CorporateAccount[]>> {
  try {
    const res = await fetch(`/api/admin/corporate?page=${page}&pageSize=${pageSize}`);
    const body = await res.json();
    if (!res.ok) {
      return { data: null, error: body.error || "Failed to load corporate accounts", count: 0, page, pageSize, totalCount: 0, totalPages: 0 };
    }
    const arr = (body.data as CorporateAccount[]) ?? [];
    return { data: arr, error: null, count: arr.length, page: body.page, pageSize: body.pageSize, totalCount: body.totalCount, totalPages: body.totalPages };
  } catch (err) {
    return { data: null, error: err instanceof Error ? err.message : "Unknown", count: 0, page, pageSize, totalCount: 0, totalPages: 0 };
  }
}

export async function createCorporateAccount(fields: {
  name: string;
  billing_email: string;
  finance_email?: string;
  phone?: string;
  address?: string;
  registration_number?: string;
  billing_method: "corporate_wallet" | "monthly_invoice";
  daily_employee_limit?: number;
  monthly_account_limit?: number;
  credit_limit?: number;
}): Promise<{ success: boolean; message: string; data?: CorporateAccount }> {
  try {
    const res = await fetch("/api/admin/corporate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fields),
    });
    const body = await res.json();
    if (res.ok && body.success) return { success: true, message: "Corporate account created", data: body.data };
    return { success: false, message: body.error ?? "Failed to create corporate account" };
  } catch (err) {
    return { success: false, message: err instanceof Error ? err.message : "Network error" };
  }
}

export async function fetchCorporateAccount(id: string): Promise<CorporateAccount | null> {
  try {
    const res = await fetch(`/api/admin/corporate/${id}`);
    if (!res.ok) return null;
    const body = await res.json();
    return (body.data as CorporateAccount) ?? null;
  } catch {
    return null;
  }
}

export async function updateCorporateAccount(
  id: string,
  patch: Record<string, unknown>
): Promise<boolean> {
  const res = await fetch(`/api/admin/corporate/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  return res.ok;
}

export async function suspendCorporateAccount(id: string): Promise<boolean> {
  return updateCorporateAccount(id, { status: "suspended" });
}

export async function activateCorporateAccount(id: string): Promise<boolean> {
  return updateCorporateAccount(id, { status: "active" });
}

export async function topUpCorporateWallet(id: string, amount: number): Promise<boolean> {
  return updateCorporateAccount(id, { wallet_topup_amount: amount });
}

export async function fetchCorporateMembers(
  id: string
): Promise<{ members: CorporateAccountMember[]; pendingInvitations: CorporateInvitation[] }> {
  try {
    const res = await fetch(`/api/admin/corporate/${id}/members`);
    if (!res.ok) return { members: [], pendingInvitations: [] };
    const body = await res.json();
    return { members: body.members ?? [], pendingInvitations: body.pendingInvitations ?? [] };
  } catch {
    return { members: [], pendingInvitations: [] };
  }
}

export async function inviteCorporateMember(
  id: string,
  email: string,
  role: CorporateMemberRole
): Promise<{ success: boolean; message: string; invite_code?: string }> {
  try {
    const res = await fetch(`/api/admin/corporate/${id}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, role }),
    });
    const body = await res.json();
    if (res.ok && body.success) return { success: true, message: body.message ?? "Invitation sent!", invite_code: body.invite_code };
    return { success: false, message: body.error ?? "Failed to send invitation", invite_code: body.invite_code };
  } catch (err) {
    return { success: false, message: err instanceof Error ? err.message : "Network error" };
  }
}

export async function updateCorporateMember(
  corporateAccountId: string,
  memberId: string,
  patch: Record<string, unknown>
): Promise<boolean> {
  const res = await fetch(`/api/admin/corporate/${corporateAccountId}/members/${memberId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  return res.ok;
}

export async function fetchCorporateInvoices(id: string): Promise<CorporateInvoice[]> {
  try {
    const res = await fetch(`/api/admin/corporate/${id}/invoices`);
    if (!res.ok) return [];
    const body = await res.json();
    return body.data ?? [];
  } catch {
    return [];
  }
}

export async function generateCorporateInvoice(
  id: string,
  periodStart: string,
  periodEnd: string
): Promise<{ success: boolean; message: string; ride_count?: number; total_amount?: number }> {
  try {
    const res = await fetch(`/api/admin/corporate/${id}/invoices`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ period_start: periodStart, period_end: periodEnd }),
    });
    const body = await res.json();
    if (res.ok && body.success) return { success: true, message: "Invoice generated", ride_count: body.ride_count, total_amount: body.total_amount };
    return { success: false, message: body.error ?? "Failed to generate invoice" };
  } catch (err) {
    return { success: false, message: err instanceof Error ? err.message : "Network error" };
  }
}

export function corporateRoleLabel(role?: string | null): string {
  if (!role) return "Unknown";
  return role.charAt(0).toUpperCase() + role.slice(1);
}
