"use client";

import { supabase } from "@/lib/supabase";
import type { Rider } from "@/lib/types";

// riders carries no identity/status columns of its own (id, user_id,
// home_address, work_address, saved_places, emergency_contacts,
// referral_code, total_rides, total_spent, rating, created_at,
// updated_at, firebase_uid, id_verified) -- full_name/phone/email and
// active/suspended status live on the linked users row.
const RIDER_SELECT =
  "id, user_id, home_address, work_address, referral_code, total_rides, total_spent, rating, created_at, updated_at, id_verified, user:users(full_name, phone, email, is_active, is_suspended, email_verified)";

interface RiderUserJoin {
  full_name?: string;
  phone?: string;
  email?: string;
  is_active?: boolean;
  is_suspended?: boolean;
  email_verified?: boolean;
}

interface RiderRow {
  id: string;
  user_id: string;
  home_address?: string;
  work_address?: string;
  referral_code?: string;
  total_rides?: number;
  total_spent?: number;
  rating?: number;
  created_at?: string;
  updated_at?: string;
  id_verified?: boolean;
  user: RiderUserJoin | null;
}

function toRider(row: RiderRow): Rider {
  const user = row.user || {};
  const suspended = user.is_active === false || user.is_suspended === true;
  return {
    id: row.id,
    user_id: row.user_id,
    full_name: user.full_name || "",
    phone: user.phone,
    email: user.email,
    status: suspended ? "suspended" : "active",
    total_rides: row.total_rides ?? 0,
    total_spent: row.total_spent ?? 0,
    rating: row.rating ?? 5,
    home_address: row.home_address,
    work_address: row.work_address,
    referral_code: row.referral_code,
    is_email_verified: !!user.email_verified,
    is_id_verified: !!row.id_verified,
    created_at: row.created_at || "",
    updated_at: row.updated_at || "",
    user: row.user as Record<string, unknown> | undefined,
  };
}

// ─── Fetch Riders ────────────────────────────────────
export async function fetchRiders(
  page = 1,
  pageSize = 25,
  search = "",
  statusFilter = "all"
) {
  // Search/status filtering resolves matching user_ids first, then
  // filters riders by that set -- simpler and more reliable than
  // PostgREST's embedded-resource filter syntax for a table that carries
  // none of the filtered columns itself.
  let userIdFilter: string[] | null = null;

  if (search || statusFilter !== "all") {
    let userQuery = supabase.from("users").select("id");
    if (search) {
      userQuery = userQuery.or(
        `full_name.ilike.%${search}%,phone.ilike.%${search}%,email.ilike.%${search}%`
      );
    }
    if (statusFilter === "active") {
      userQuery = userQuery.eq("is_active", true).eq("is_suspended", false);
    } else if (statusFilter === "suspended") {
      userQuery = userQuery.or("is_active.eq.false,is_suspended.eq.true");
    }

    const { data: matchedUsers, error: userError } = await userQuery;
    if (userError) {
      return { data: [], totalCount: 0, error: userError.message };
    }
    userIdFilter = (matchedUsers || []).map((u) => u.id as string);
    if (userIdFilter.length === 0) {
      return { data: [], totalCount: 0, error: null };
    }
  }

  let query = supabase.from("riders").select(RIDER_SELECT, { count: "exact" });
  if (userIdFilter) query = query.in("user_id", userIdFilter);

  query = query
    .order("created_at", { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1);

  const { data, count, error } = await query;
  return {
    data: ((data as unknown as RiderRow[]) || []).map(toRider),
    totalCount: count || 0,
    error: error?.message || null,
  };
}

// ─── Fetch Rider Stats ───────────────────────────────
export async function fetchRiderStats() {
  const { data, error } = await supabase
    .from("riders")
    .select("id, created_at, id_verified, user:users(is_active, is_suspended, email_verified)");
  if (error || !data) {
    return { total: 0, active: 0, suspended: 0, verified: 0, newThisWeek: 0, error: error?.message || null };
  }

  const rows = data as unknown as RiderRow[];
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  let active = 0, suspended = 0, verified = 0, newThisWeek = 0;
  for (const row of rows) {
    const user = row.user || {};
    if (user.is_active === false || user.is_suspended === true) suspended++; else active++;
    if (user.email_verified || row.id_verified) verified++;
    if (row.created_at && row.created_at >= weekAgo) newThisWeek++;
  }

  return { total: rows.length, active, suspended, verified, newThisWeek, error: null };
}

// ─── Suspend Rider ───────────────────────────────────
// Takes the rider's user_id (from Rider.user_id) -- riders itself has no
// status column, so this updates the linked users row.
export async function suspendRider(userId: string) {
  const { error } = await supabase
    .from("users")
    .update({ is_active: false, is_suspended: true })
    .eq("id", userId);
  return { success: !error, error: error?.message || null };
}

// ─── Activate Rider ──────────────────────────────────
export async function activateRider(userId: string) {
  const { error } = await supabase
    .from("users")
    .update({ is_active: true, is_suspended: false })
    .eq("id", userId);
  return { success: !error, error: error?.message || null };
}

// ─── Delete Rider ─────────────────────────────────────
// There is no hard-delete for riders -- their rows are referenced by
// ride history -- so "delete" here is the same reversible operation as
// suspend, exposed as a separate entry point because the UI presents it
// as a distinct, more final-sounding action.
export async function deleteRider(userId: string) {
  return suspendRider(userId);
}

// ─── Verify Rider Email ──────────────────────────────
export async function verifyRiderEmail(userId: string) {
  const { error } = await supabase.from("users").update({ email_verified: true }).eq("id", userId);
  return { success: !error, error: error?.message || null };
}

// ─── Verify Rider Phone ──────────────────────────────
export async function verifyRiderPhone(userId: string) {
  const { error } = await supabase.from("users").update({ is_phone_verified: true }).eq("id", userId);
  return { success: !error, error: error?.message || null };
}

// ─── Verify Rider ID ─────────────────────────────────
// Manual admin override of the same id_verified flag the rider app sets
// when a rider submits their national ID + safety photo before a cash
// ride.
export async function verifyRiderId(riderId: string) {
  const { error } = await supabase
    .from("riders")
    .update({ id_verified: true, id_verified_at: new Date().toISOString() })
    .eq("id", riderId);
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
  // Goes through the same atomic, balance-updating RPC the rider app uses
  // for top-ups, rather than inserting a standalone ledger row that never
  // touched wallets.balance.
  const { data, error } = await supabase.rpc("credit_wallet", {
    p_wallet_id: walletId,
    p_amount: amount,
    p_type: "bonus",
    p_description: description,
  });
  const response = data as { success?: boolean; error?: string } | null;
  if (error || response?.success === false) {
    return { success: false, error: error?.message || response?.error || "Failed to add bonus" };
  }
  return { success: true, error: null };
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
