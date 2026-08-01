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
    // If RPC fails, fall back to direct queries
    console.warn("RPC admin_driver_stats failed, falling back to direct queries:", error);
    return await fetchStatsFallback(cityId);
  }
  
  return {
    totalDrivers: data?.total_drivers || 0,
    activeDrivers: data?.active_drivers || 0,
    onTripCount: data?.on_trip_count || 0,
    pendingCount: data?.pending_count || 0,
    approvedCount: data?.approved_count || 0,
    rejectedCount: data?.rejected_count || 0,
    topByRating: data?.top_by_rating || [],
    topByEarnings: data?.top_by_earnings || [],
  };
}

// Fallback function using direct queries if RPC fails
async function fetchStatsFallback(cityId?: string): Promise<NonNullable<typeof _cachedStats>> {
  const [totalDrivers, activeDrivers, pendingCount] = await Promise.all([
    fetchTotalDriversCount(cityId),
    fetchActiveDriversCount(cityId),
    fetchPendingApprovalsCount(cityId),
  ]);

  return {
    totalDrivers,
    activeDrivers,
    onTripCount: 0,
    pendingCount,
    approvedCount: 0,
    rejectedCount: 0,
    topByRating: [],
    topByEarnings: [],
  };
}

export async function fetchTotalDriversCount(cityId?: string): Promise<number> {
  let query = supabase
    .from("drivers")
    .select("*", { count: "exact", head: true });
  if (cityId) query = query.eq("city_id", cityId);
  const { count, error } = await query;
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function fetchActiveDriversCount(cityId?: string): Promise<number> {
  let query = supabase
    .from("drivers")
    .select("*", { count: "exact", head: true })
    .eq("is_online", true);
  if (cityId) query = query.eq("city_id", cityId);
  const { count, error } = await query;
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function fetchPendingApprovalsCount(cityId?: string): Promise<number> {
  let query = supabase
    .from("drivers")
    .select("*", { count: "exact", head: true })
    .eq("approval_status", "pending");
  if (cityId) query = query.eq("city_id", cityId);
  const { count, error } = await query;
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function fetchTotalDriverPayouts(cityId?: string): Promise<number> {
  // Placeholder - you can implement this based on your payout table
  return 0;
}

export async function fetchDrivers(
  page = 1,
  pageSize = 25,
  filters?: DriverFilters,
): Promise<PaginatedResult<Driver[]>> {
  const offset = (page - 1) * pageSize;

  let query = supabase
    .from("drivers")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(offset, offset + pageSize - 1);

  if (filters?.approvalStatus) {
    query = query.eq("approval_status", filters.approvalStatus);
  }

  if (filters?.isOnline !== undefined) {
    query = query.eq("is_online", filters.isOnline);
  }

  if (filters?.cityId) {
    query = query.eq("city_id", filters.cityId);
  }

  if (filters?.search) {
    query = query.ilike("full_name", `%${filters.search}%`);
  }

  const { data, error, count } = await query;
  if (error) {
    return { data: null, error: error.message, count: 0, page, pageSize, totalCount: 0, totalPages: 0 };
  }

  const totalCount = count || 0;
  return {
    data: data || [],
    error: null,
    count: (data || []).length,
    page,
    pageSize,
    totalCount,
    totalPages: Math.max(1, Math.ceil(totalCount / pageSize)),
  };
}

export async function approveDriver(id: string): Promise<boolean> {
  const { error } = await supabase
    .from("drivers")
    .update({ approval_status: "approved", is_active: true })
    .eq("id", id);
  return !error;
}

export async function rejectDriver(id: string, reason?: string): Promise<boolean> {
  const { error } = await supabase
    .from("drivers")
    .update({ approval_status: "rejected", rejection_reason: reason || null })
    .eq("id", id);
  return !error;
}

export async function suspendDriver(id: string, reason?: string): Promise<boolean> {
  const { error } = await supabase
    .from("drivers")
    .update({ is_active: false, approval_status: "suspended", rejection_reason: reason || null })
    .eq("id", id);
  return !error;
}

export async function forceDriverOffline(id: string): Promise<boolean> {
  const { error } = await supabase
    .from("drivers")
    .update({ is_online: false })
    .eq("id", id);
  return !error;
}

export async function fetchApprovedDriversCount(cityId?: string): Promise<number> {
  let query = supabase
    .from("drivers")
    .select("*", { count: "exact", head: true })
    .eq("approval_status", "approved");
  if (cityId) query = query.eq("city_id", cityId);
  const { count, error } = await query;
  if (error) return 0;
  return count ?? 0;
}

export async function fetchRejectedDriversCount(cityId?: string): Promise<number> {
  let query = supabase
    .from("drivers")
    .select("*", { count: "exact", head: true })
    .eq("approval_status", "rejected");
  if (cityId) query = query.eq("city_id", cityId);
  const { count, error } = await query;
  if (error) return 0;
  return count ?? 0;
}

export async function fetchDriversOnTripCount(cityId?: string): Promise<number> {
  let query = supabase
    .from("drivers")
    .select("*", { count: "exact", head: true })
    .eq("is_on_trip", true);
  if (cityId) query = query.eq("city_id", cityId);
  const { count, error } = await query;
  if (error) return 0;
  return count ?? 0;
}

export async function fetchTopDrivers(limit = 5, cityId?: string): Promise<Driver[]> {
  let query = supabase
    .from("drivers")
    .select("*")
    .eq("approval_status", "approved")
    .order("rating", { ascending: false })
    .limit(limit);
  if (cityId) query = query.eq("city_id", cityId);
  const { data } = await query;
  return (data as Driver[]) || [];
}

export async function fetchTopDriversByEarnings(limit = 5, cityId?: string): Promise<Driver[]> {
  let query = supabase
    .from("drivers")
    .select("*")
    .eq("approval_status", "approved")
    .order("total_earnings", { ascending: false })
    .limit(limit);
  if (cityId) query = query.eq("city_id", cityId);
  const { data } = await query;
  return (data as Driver[]) || [];
}
