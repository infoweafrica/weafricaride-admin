"use client";

import { supabase } from "@/lib/supabase";
import type { Ride } from "@/lib/types";
import type { PaginatedResult } from "@/lib/api/base";

export interface RideFilters {
  cityId?: string | null;
  status?: string;
  paymentStatus?: string;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
}

// ── Dashboard Stats ──

export async function fetchActiveRidesCount(cityId?: string): Promise<number> {
  let query = supabase
    .from("rides")
    .select("*", { count: "exact", head: true })
    .in("status", ["requested", "searching", "accepted", "driver_arriving", "driver_arrived", "arrived", "in_progress"]);
  if (cityId) query = query.eq("city_id", cityId);
  const { count, error } = await query;
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function fetchCompletedRidesCount(cityId?: string): Promise<number> {
  let query = supabase
    .from("rides")
    .select("*", { count: "exact", head: true })
    .eq("status", "completed");
  if (cityId) query = query.eq("city_id", cityId);
  const { count, error } = await query;
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function fetchCancelledRidesCount(cityId?: string): Promise<number> {
  let query = supabase
    .from("rides")
    .select("*", { count: "exact", head: true })
    .in("status", ["cancelled", "rider_cancelled", "driver_cancelled", "admin_cancelled"]);
  if (cityId) query = query.eq("city_id", cityId);
  const { count, error } = await query;
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function fetchRevenueTotal(): Promise<number> {
  const { data, error } = await supabase
    .from("rides")
    .select("actual_fare, estimated_fare")
    .eq("status", "completed");
  if (error) throw new Error(error.message);
  let total = 0;
  for (const row of (data as any[]) ?? []) {
    total += (row.actual_fare || row.estimated_fare || 0);
  }
  return total;
}

export async function fetchWeeklyRevenue(cityId?: string): Promise<{ name: string; revenue: number }[]> {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  let query = supabase
    .from("rides")
    .select("actual_fare, estimated_fare, created_at")
    .eq("status", "completed")
    .gte("created_at", sevenDaysAgo.toISOString());
  if (cityId) query = query.eq("city_id", cityId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const days: Record<string, number> = {};
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = dayNames[d.getDay()] + " " + d.getDate();
    days[key] = 0;
  }

  for (const row of (data as any[]) ?? []) {
    const date = new Date(row.created_at);
    const key = dayNames[date.getDay()] + " " + date.getDate();
    if (days[key] !== undefined) {
      days[key] += (row.actual_fare || row.estimated_fare || 0);
    }
  }

  return Object.entries(days).map(([name, revenue]) => ({ name, revenue }));
}

export async function fetchWeeklyRides(cityId?: string): Promise<{ name: string; completed: number; cancelled: number }[]> {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  let query = supabase
    .from("rides")
    .select("status, created_at")
    .gte("created_at", sevenDaysAgo.toISOString());
  if (cityId) query = query.eq("city_id", cityId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const days: Record<string, { completed: number; cancelled: number }> = {};
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = dayNames[d.getDay()] + " " + d.getDate();
    days[key] = { completed: 0, cancelled: 0 };
  }

  for (const row of (data as any[]) ?? []) {
    const date = new Date(row.created_at);
    const key = dayNames[date.getDay()] + " " + date.getDate();
    if (days[key] !== undefined) {
      if (row.status === "completed") days[key].completed++;
      else if (row.status === "cancelled") days[key].cancelled++;
    }
  }

  return Object.entries(days).map(([name, counts]) => ({
    name,
    completed: counts.completed,
    cancelled: counts.cancelled,
  }));
}

export async function fetchRideStatusCounts(cityId?: string): Promise<Record<string, number>> {
  let query = supabase.from("rides").select("status");
  if (cityId) query = query.eq("city_id", cityId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const counts: Record<string, number> = {};
  for (const row of (data as any[]) ?? []) {
    const status = row.status || "unknown";
    counts[status] = (counts[status] || 0) + 1;
  }
  return counts;
}

// ── Paginated Rides List ──

export async function fetchRides(
  page: number,
  pageSize: number,
  filters?: RideFilters,
): Promise<PaginatedResult<Ride[]>> {
  try {
    let query = supabase
      .from("rides")
      .select(
        "*, rider:riders(user:users(full_name, phone)), driver:drivers(user:users(full_name, phone)), category:ride_categories(name, icon)",
        { count: "exact" },
      );

    if (filters?.cityId) query = query.eq("city_id", filters.cityId);
    if (filters?.status && filters.status !== "all") query = query.eq("status", filters.status);
    if (filters?.paymentStatus && filters.paymentStatus !== "all") query = query.eq("payment_status", filters.paymentStatus);
    if (filters?.dateFrom) query = query.gte("created_at", filters.dateFrom);
    if (filters?.dateTo) query = query.lte("created_at", filters.dateTo);

    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;
    query = query.order("created_at", { ascending: false }).range(from, to);

    const { data, count, error } = await query;

    return {
      data: (data as unknown as Ride[]) ?? [],
      page,
      pageSize,
      totalCount: count ?? 0,
      totalPages: count ? Math.ceil(count / pageSize) : 0,
      count: (data as unknown as any[])?.length ?? 0,
      error: error?.message ?? null,
    };
  } catch (e: any) {
    return {
      data: [],
      page,
      pageSize,
      totalCount: 0,
      totalPages: 0,
      count: 0,
      error: e?.message ?? "Failed to fetch rides",
    };
  }
}

// ── Admin Actions ──

export async function reassignRideDriver(rideId: string): Promise<boolean> {
  try {
    const { error } = await supabase
      .from("rides")
      .update({ status: "searching", driver_id: null })
      .eq("id", rideId);
    return !error;
  } catch {
    return false;
  }
}

export async function refundRide(rideId: string): Promise<boolean> {
  try {
    const { error } = await supabase
      .from("rides")
      .update({ payment_status: "refunded" })
      .eq("id", rideId);
    return !error;
  } catch {
    return false;
  }
}
