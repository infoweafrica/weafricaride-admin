"use client";

import { supabase } from "@/lib/supabase";
import type { Rider } from "@/lib/types";

// ─── Fetch Riders ────────────────────────────────────
export async function fetchRiders(
  page = 1,
  pageSize = 25,
  search = "",
  statusFilter = "all"
) {
  let query = supabase
    .from("riders")
    .select("*, user:users(phone, email, is_active)", { count: "exact" });

  if (search) {
    query = query.or(
      `full_name.ilike.%${search}%,phone.ilike.%${search}%,email.ilike.%${search}%`
    );
  }

  if (statusFilter === "active") {
    query = query.eq("is_active", true);
  } else if (statusFilter === "suspended") {
    query = query.eq("is_active", false);
  }

  query = query
    .order("created_at", { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1);

  const { data, count, error } = await query;
  return {
    data: (data as Rider[]) || [],
    totalCount: count || 0,
    error: error?.message || null,
  };
}

// ─── Fetch Rider Stats ───────────────────────────────
export async function fetchRiderStats() {
  const { data, error } = await supabase.from("riders").select("id, is_active, is_phone_verified, is_email_verified, is_id_verified, created_at");
  if (error || !data) {
    return { total: 0, active: 0, suspended: 0, verified: 0, newThisWeek: 0, error: error?.message || null };
  }

  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

  return {
    total: data.length,
    active: data.filter((r: Record<string, unknown>) => r.is_active).length,
    suspended: data.filter((r: Record<string, unknown>) => !r.is_active).length,
    verified: data.filter((r: Record<string, unknown>) => r.is_phone_verified || r.is_email_verified).length,
    newThisWeek: data.filter((r: Record<string, unknown>) => r.created_at && (r.created_at as string) >= weekAgo).length,
    error: null,
  };
}

// ─── Suspend Rider ───────────────────────────────────
export async function suspendRider(id: string) {
  const { error } = await supabase.from("riders").update({ is_active: false }).eq("id", id);
  return { success: !error, error: error?.message || null };
}

// ─── Activate Rider ──────────────────────────────────
export async function activateRider(id: string) {
  const { error } = await supabase.from("riders").update({ is_active: true }).eq("id", id);
  return { success: !error, error: error?.message || null };
}

// ─── Delete Rider (soft delete) ──────────────────────
export async function deleteRider(id: string) {
  const { error } = await supabase.from("riders").update({ deleted_at: new Date().toISOString() }).eq("id", id);
  return { success: !error, error: error?.message || null };
}

// ─── Verify Rider Phone ──────────────────────────────
export async function verifyRiderPhone(id: string) {
  const { error } = await supabase.from("riders").update({ is_phone_verified: true }).eq("id", id);
  return { success: !error, error: error?.message || null };
}

// ─── Verify Rider Email ──────────────────────────────
export async function verifyRiderEmail(id: string) {
  const { error } = await supabase.from("riders").update({ is_email_verified: true }).eq("id", id);
  return { success: !error, error: error?.message || null };
}

// ─── Verify Rider ID ─────────────────────────────────
export async function verifyRiderId(id: string) {
  const { error } = await supabase.from("riders").update({ is_id_verified: true }).eq("id", id);
  return { success: !error, error: error?.message || null };
}

// ─── Fetch Rider Wallet ──────────────────────────────
export async function fetchRiderWallets(riderId: string) {
  const { data, error } = await supabase
    .from("wallets")
    .select("*")
    .eq("user_id", riderId)
    .single();
  return { wallet: data || null, error: error?.message || null };
}

// ─── Add Wallet Bonus ────────────────────────────────
export async function addWalletBonus(
  walletId: string,
  amount: number,
  description: string
) {
  const { error } = await supabase.from("wallet_transactions").insert({
    wallet_id: walletId,
    transaction_type: "topup",
    amount,
    balance_before: 0,
    balance_after: amount,
    description,
  });
  return { success: !error, error: error?.message || null };
}
// ─── Fetch Rider Trips ───────────────────────────────
export async function fetchRiderTrips(riderId: string) {
  const { data, error } = await supabase
    .from("rides")
    .select("id, status, pickup_address, dropoff_address, fare_total, total_fare, payment_status, created_at, completed_at, driver:drivers(full_name, phone)")
    .eq("rider_id", riderId)
    .order("created_at", { ascending: false })
    .limit(50);

  return { data: data || [], error: error?.message || null };
}

// ─── Fetch Rider Complaints / Support ────────────────
export async function fetchRiderComplaints(riderId?: string) {
  let query = supabase
    .from("support_tickets")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(50);

  if (riderId) query = query.eq("rider_id", riderId);

  const { data, error } = await query;
  return { data: data || [], error: error?.message || null };
}
