import { supabase } from "@/lib/supabase";
import type { Driver } from "@/lib/types";
import type { PaginatedResult } from "./base";

export interface DriverFilters {
  search?: string;
  approvalStatus?: string;
  isOnline?: boolean;
  cityId?: string;
  vehicleType?: string;
  driverTier?: string;
}

// ─── COUNT HELPERS (singleton stat fetch to reduce calls) ──────────

let _cachedStats: {
  totalDrivers: number;
  activeDrivers: number;
  onTripCount: number;
  pendingCount: number;
  approvedCount: number;
  rejectedCount: number;
  topByRating: Driver[];
  topByEarnings: Driver[];
} | null = null;

async function fetchStats(cityId?: string): Promise<NonNullable<typeof _cachedStats>> {
  // Use the correct parameter name: p_city_id
  const { data, error } = await supabase.rpc("admin_driver_stats", {
    p_city_id: cityId || null,
  });
  
  if (error) {
    // If the RPC itself is unreachable, degrade to all-zero stats rather
    // than falling back to direct table queries -- those go through the
    // same anon client and get silently zeroed by RLS anyway (drivers has
    // no anon/authenticated policy), and would recurse back into this
    // function via the count helpers below.
    console.warn("RPC admin_driver_stats failed:", error);
    return {
      totalDrivers: 0, activeDrivers: 0, onTripCount: 0, pendingCount: 0,
      approvedCount: 0, rejectedCount: 0, topByRating: [], topByEarnings: [],
    };
  }

  // admin_driver_stats returns camelCase keys (totalDrivers, pendingCount,
  // etc.), not snake_case -- this used to read the wrong keys and always
  // returned zeros even on a successful RPC call.
  return {
    totalDrivers: data?.totalDrivers || 0,
    activeDrivers: data?.activeDrivers || 0,
    onTripCount: data?.onTripCount || 0,
    pendingCount: data?.pendingCount || 0,
    approvedCount: data?.approvedCount || 0,
    rejectedCount: data?.rejectedCount || 0,
    topByRating: data?.topByRating || [],
    topByEarnings: data?.topByEarnings || [],
  };
}

// drivers has no anon/authenticated RLS policy (same posture as
// admin_users) — a direct supabase.from("drivers") read from this
// browser anon client silently returns zero rows, no error. These count
// helpers go through the admin_driver_stats RPC instead, which is
// anon-callable and already computes every count below in one query.
// admin_driver_stats' p_city_id parameter is a genuine uuid column, but
// drivers.city_id is never actually populated on any real row (confirmed:
// 0 of 5 drivers have it set) -- filtering by it always silently returns
// zero, and passing a city *name* string into it hard-errors ("invalid
// input syntax for type uuid"). Since it's the free-text `city` column
// that's actually populated, city-filtered counts go through the
// same-already-fixed /api/drivers list route (filtered by city name)
// instead of the RPC when a city is selected; the unfiltered (all-cities)
// case keeps using the RPC, which works fine for that.
async function fetchDriverCountForCity(cityName: string, extra?: Record<string, string>): Promise<number> {
  const params = new URLSearchParams({ city: cityName, pageSize: "1", ...extra });
  const res = await fetch(`/api/drivers?${params.toString()}`);
  if (!res.ok) return 0;
  const body = await res.json();
  return body.totalCount ?? 0;
}

export async function fetchTotalDriversCount(cityName?: string): Promise<number> {
  if (cityName) return fetchDriverCountForCity(cityName);
  const stats = await fetchStats();
  return stats.totalDrivers;
}

export async function fetchActiveDriversCount(cityName?: string): Promise<number> {
  if (cityName) return fetchDriverCountForCity(cityName, { isOnline: "true" });
  const stats = await fetchStats();
  return stats.activeDrivers;
}

export async function fetchPendingApprovalsCount(cityId?: string): Promise<number> {
  const stats = await fetchStats(cityId);
  return stats.pendingCount;
}

export async function fetchTotalDriverPayouts(cityId?: string): Promise<number> {
  // Placeholder - you can implement this based on your payout table
  return 0;
}

// drivers has no anon/authenticated RLS policy, so this goes through the
// service-role-backed /api/drivers list route instead of querying the
// table directly with the anon client (same reasoning as the counts
// above and updateDriverDateOfBirth below).
export async function fetchDrivers(
  page = 1,
  pageSize = 25,
  filters?: DriverFilters,
): Promise<PaginatedResult<Driver[]>> {
  try {
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (filters?.approvalStatus) params.set("approvalStatus", filters.approvalStatus);
    if (filters?.isOnline !== undefined) params.set("isOnline", String(filters.isOnline));
    // filters.cityId actually carries a city *name* by the time it gets
    // here (see fetchTotalDriversCount above for why) -- the API route's
    // query param is named `city` accordingly.
    if (filters?.cityId) params.set("city", filters.cityId);
    if (filters?.search) params.set("search", filters.search);

    const res = await fetch(`/api/drivers?${params.toString()}`);
    const body = await res.json();
    if (!res.ok) {
      return { data: null, error: body.error || "Failed to load drivers", count: 0, page, pageSize, totalCount: 0, totalPages: 0 };
    }
    return {
      data: body.data || [],
      error: null,
      count: (body.data || []).length,
      page,
      pageSize,
      totalCount: body.totalCount || 0,
      totalPages: Math.max(1, Math.ceil((body.totalCount || 0) / pageSize)),
    };
  } catch (err) {
    return { data: null, error: err instanceof Error ? err.message : "Unknown", count: 0, page, pageSize, totalCount: 0, totalPages: 0 };
  }
}

// admin_approve_driver is anon-callable (SECURITY DEFINER) and enforces
// the validate_driver_approval stage rules -- a raw table update here
// both skips that validation and gets silently no-op'd by RLS anyway.
export async function approveDriver(id: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("admin_approve_driver", { p_driver_id: id });
  return !error && !!data?.success;
}

// The `require_driver_verification_complete` DB trigger blocks
// approval_status='approved' outright when date_of_birth is null (among
// other checks) — but nothing in the driver-app onboarding flow ever
// collects it, and until now nothing in the admin dashboard could set it
// either, so approval was silently impossible for every driver.
//
// Goes through /api/drivers/[id] (service-role, session-checked) rather
// than a direct `supabase.from(...).update()` — the browser `supabase`
// client here is a bare anon-key client with no auth context (admin
// sessions are a separate signed cookie, not a real Supabase JWT), so no
// RLS policy on `drivers` ever matches it and a direct write fails
// silently: no error, zero rows affected, DOB stays null.
export async function updateDriverDateOfBirth(id: string, dateOfBirth: string): Promise<boolean> {
  const res = await fetch(`/api/drivers/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ date_of_birth: dateOfBirth }),
  });
  return res.ok;
}

export async function rejectDriver(id: string, reason?: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("admin_reject_driver", { p_driver_id: id, p_reason: reason || null });
  return !error && !!data?.success;
}

export async function suspendDriver(id: string, reason?: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("admin_suspend_driver", { p_driver_id: id, p_reason: reason || null });
  return !error && !!data?.success;
}

export async function forceDriverOffline(id: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("admin_force_driver_offline", { p_driver_id: id });
  return !error && !!data?.success;
}

export async function fetchApprovedDriversCount(cityId?: string): Promise<number> {
  const stats = await fetchStats(cityId);
  return stats.approvedCount;
}

export async function fetchRejectedDriversCount(cityId?: string): Promise<number> {
  const stats = await fetchStats(cityId);
  return stats.rejectedCount;
}

export async function fetchDriversOnTripCount(cityId?: string): Promise<number> {
  const stats = await fetchStats(cityId);
  return stats.onTripCount;
}

export async function fetchTopDrivers(limit = 5, cityId?: string): Promise<Driver[]> {
  const stats = await fetchStats(cityId);
  return stats.topByRating.slice(0, limit);
}

export async function fetchTopDriversByEarnings(limit = 5, cityId?: string): Promise<Driver[]> {
  const stats = await fetchStats(cityId);
  return stats.topByEarnings.slice(0, limit);
}
