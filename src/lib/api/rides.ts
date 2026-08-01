"use client";

import { supabase } from "@/lib/supabase";
import type { Ride } from "@/lib/types";
import { pagedQuery, type PaginatedResult } from "@/lib/api/base";

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
  if (cityId) query = query.eq("city", cityId);
  const { count, error } = await query;
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function fetchCompletedRidesCount(cityId?: string): Promise<number> {
  let query = supabase
    .from("rides")
    .select("*", { count: "exact", head: true })
    .eq("status", "completed");
  if (cityId) query = query.eq("city", cityId);
  const { count, error } = await query;
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function fetchCancelledRidesCount(cityId?: string): Promise<number> {
  let query = supabase
    .from("rides")
    .select("*", { count: "exact", head: true })
    .in("status", ["cancelled", "rider_cancelled", "driver_cancelled", "admin_cancelled"]);
  if (cityId) query = query.eq("city", cityId);
  const { count, error } = await query;
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function fetchRevenueTotal(cityId?: string): Promise<number> {
  let query = supabase
    .from("rides")
    .select("fare", { count: "exact", head: true })
    .eq("status", "completed");
  if (cityId) query = query.eq("city", cityId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data?.reduce((sum: number, r: any) => sum + (r.fare || 0), 0) || 0;
}

export async function fetchRideStatusCounts(cityId?: string): Promise<Record<string, number>> {
  let query = supabase.from("rides").select("status");
  if (cityId) query = query.eq("city", cityId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  
  const counts: Record<string, number> = {};
  data?.forEach((r: any) => {
    counts[r.status] = (counts[r.status] || 0) + 1;
  });
  return counts;
}

export async function fetchRides(
  page: number,
  pageSize: number,
  filters?: RideFilters
): Promise<PaginatedResult<Ride[]>> {
  return pagedQuery<Ride[]>(
    "rides",
    page,
    pageSize,
    "*",
    (q) => {
      // NOTE: rides.city is a text column, not a city_id FK — matches the
      // (pre-existing) convention used elsewhere in this file, e.g.
      // fetchActiveRidesCount/fetchCompletedRidesCount above.
      if (filters?.cityId) q = q.eq("city", filters.cityId);
      if (filters?.status && filters.status !== "all") q = q.eq("status", filters.status);
      if (filters?.paymentStatus && filters.paymentStatus !== "all") {
        q = q.eq("payment_status", filters.paymentStatus);
      }
      if (filters?.dateFrom) q = q.gte("created_at", filters.dateFrom);
      if (filters?.dateTo) q = q.lte("created_at", filters.dateTo);
      // `search` is applied client-side in rides/page.tsx against the
      // fetched page, not server-side here.
      return q;
    }
  );
}

export async function fetchWeeklyRevenue(cityId?: string): Promise<{ day: string; amount: number }[]> {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  
  let query = supabase
    .from("rides")
    .select("fare, created_at")
    .eq("status", "completed")
    .gte("created_at", sevenDaysAgo.toISOString());
  
  if (cityId) query = query.eq("city", cityId);
  
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  
  // Group by day
  const days: Record<string, number> = {};
  data?.forEach((r: any) => {
    const day = new Date(r.created_at).toLocaleDateString();
    days[day] = (days[day] || 0) + (r.fare || 0);
  });
  
  return Object.entries(days).map(([day, amount]) => ({ day, amount }));
}

export async function fetchWeeklyRides(cityId?: string): Promise<{ day: string; count: number }[]> {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  
  let query = supabase
    .from("rides")
    .select("created_at")
    .gte("created_at", sevenDaysAgo.toISOString());
  
  if (cityId) query = query.eq("city", cityId);
  
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  
  const days: Record<string, number> = {};
  data?.forEach((r: any) => {
    const day = new Date(r.created_at).toLocaleDateString();
    days[day] = (days[day] || 0) + 1;
  });
  
  return Object.entries(days).map(([day, count]) => ({ day, count }));
}

export async function reassignRideDriver(rideId: string): Promise<boolean> {
  const { data: transition, error: transitionError } = await supabase.rpc("transition_trip_state", {
    p_trip_id: rideId,
    p_new_state: "searching",
    p_actor_type: "system",
    p_metadata: { reason: "Admin reassign" },
  });

  if (transitionError || !(transition as { success?: boolean } | null)?.success) {
    console.error("reassignRideDriver:", transitionError ?? transition);
    return false;
  }

  const { error } = await supabase
    .from("rides")
    .update({ driver_id: null, updated_at: new Date().toISOString() })
    .eq("id", rideId);

  if (error) {
    console.error("reassignRideDriver (clear driver_id):", error);
    return false;
  }

  return true;
}

export async function refundRide(rideId: string): Promise<boolean> {
  const { data: payment, error: paymentError } = await supabase
    .from("payments")
    .select("id")
    .eq("ride_id", rideId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (paymentError || !payment) {
    console.error("refundRide: no payment found for ride", paymentError);
    return false;
  }

  const { data: refund, error: createError } = await supabase
    .rpc("admin_create_refund", { p_payment_id: payment.id, p_reason: "Admin refund" })
    .single();

  if (createError) {
    console.error("refundRide (create):", createError);
    return false;
  }

  const refundId = (refund as { refund_id?: string } | null)?.refund_id;
  if (!refundId) {
    console.error("refundRide: admin_create_refund did not return a refund id");
    return false;
  }

  const { error: processError } = await supabase.rpc("admin_process_refund", {
    p_refund_id: refundId,
    p_status: "approved",
    p_admin_notes: "Admin refund",
  });

  if (processError) {
    console.error("refundRide (process):", processError);
    return false;
  }

  return true;
}

