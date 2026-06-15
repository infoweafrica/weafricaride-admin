"use client";

import { supabase } from "@/lib/supabase";
import type {
  DriverReferral,
  RiderReferral,
  ReferralCampaign,
  ReferralReward,
  ReferralFraudCheck,
  ReferralEvent,
  PaginatedResponse,
  FilterParams,
} from "@/lib/types";

// ─── DRIVER REFERRALS ─────────────────────────────────

export async function fetchDriverReferrals(
  page = 1,
  pageSize = 20,
  filters?: { city?: string; status?: string; search?: string; campaign_id?: string }
) {
  let query = supabase
    .from("driver_referrals")
    .select("*, referrer:drivers!driver_referrals_referrer_id_fkey(id, full_name, phone, user:users(full_name, phone)), referred_driver:drivers!driver_referrals_referred_driver_id_fkey(id, full_name, approval_status, user:users(full_name, phone)), campaign:referral_campaigns(id, name)", { count: "exact" });

  if (filters?.status) {
    query = query.eq("status", filters.status);
  }

  if (filters?.search) {
    query = query.or(
      `referral_code.ilike.%${filters.search}%,notes.ilike.%${filters.search}%`
    );
  }

  if (filters?.campaign_id) {
    query = query.eq("campaign_id", filters.campaign_id);
  }

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  query = query.order("created_at", { ascending: false }).range(from, to);

  const { data, count, error } = await query;
  if (error) throw error;

  return {
    data: (data || []) as DriverReferral[],
    total: count || 0,
    page,
    page_size: pageSize,
  } as PaginatedResponse<DriverReferral>;
}

export async function fetchDriverReferralStats() {
  const { data, error } = await supabase.rpc("get_driver_referral_stats");
  if (error) throw error;
  return (data || {
    total_referrals: 0,
    pending_bonuses: 0,
    paid_bonuses: 0,
    conversion_rate: 0,
    fraud_alerts: 0,
    total_bonus_amount: 0,
  }) as {
    total_referrals: number;
    pending_bonuses: number;
    paid_bonuses: number;
    conversion_rate: number;
    fraud_alerts: number;
    total_bonus_amount: number;
  };
}

export async function approveDriverReferralBonus(
  referralId: string,
  amount?: number
) {
  const { error } = await supabase
    .from("driver_referrals")
    .update({
      status: "bonus_approved",
      bonus_amount: amount,
      updated_at: new Date().toISOString(),
    })
    .eq("id", referralId);

  if (error) throw error;

  // Create reward record
  const { data: referral } = await supabase
    .from("driver_referrals")
    .select("referrer_id, bonus_amount")
    .eq("id", referralId)
    .single();

  if (referral) {
    await supabase.from("referral_rewards").insert({
      referral_id: referralId,
      referral_type: "driver",
      recipient_id: (referral as Record<string, unknown>).referrer_id as string,
      recipient_type: "driver",
      amount: amount || (referral as Record<string, unknown>).bonus_amount || 5000,
      currency: "MWK",
      reward_type: "bonus",
      status: "pending",
    });
  }
}

export async function approveRiderReferralCredit(
  referralId: string,
  amount?: number
) {
  const { error } = await supabase
    .from("rider_referrals")
    .update({
      status: "credit_approved",
      credit_amount: amount,
      updated_at: new Date().toISOString(),
    })
    .eq("id", referralId);

  if (error) throw error;
}

export async function rejectReferral(referralId: string, referralType: "driver" | "rider", reason?: string) {
  const table = referralType === "driver" ? "driver_referrals" : "rider_referrals";
  const { error } = await supabase
    .from(table)
    .update({
      status: "rejected",
      notes: reason,
      updated_at: new Date().toISOString(),
    })
    .eq("id", referralId);

  if (error) throw error;
}

export async function payReferralBonus(referralId: string, transactionRef?: string) {
  // Mark referral bonus as paid
  const { error: refError } = await supabase
    .from("driver_referrals")
    .update({
      status: "bonus_paid",
      bonus_paid_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", referralId);

  if (refError) throw refError;

  // Update reward record
  const { error: rewardError } = await supabase
    .from("referral_rewards")
    .update({
      status: "paid",
      paid_at: new Date().toISOString(),
      transaction_reference: transactionRef,
      updated_at: new Date().toISOString(),
    })
    .eq("referral_id", referralId);

  if (rewardError) throw rewardError;
}

export async function suspendReferral(referralId: string, referralType: "driver" | "rider") {
  const table = referralType === "driver" ? "driver_referrals" : "rider_referrals";
  const { error } = await supabase
    .from(table)
    .update({ status: "suspended", updated_at: new Date().toISOString() })
    .eq("id", referralId);

  if (error) throw error;
}

export async function flagReferralFraud(referralId: string, referralType: "driver" | "rider") {
  const table = referralType === "driver" ? "driver_referrals" : "rider_referrals";
  const { error } = await supabase
    .from(table)
    .update({
      status: "fraud_review",
      fraud_verdict: "review",
      updated_at: new Date().toISOString(),
    })
    .eq("id", referralId);

  if (error) throw error;
}

// ─── RIDER REFERRALS ──────────────────────────────────

export async function fetchRiderReferrals(
  page = 1,
  pageSize = 20,
  filters?: { status?: string; search?: string }
) {
  let query = supabase
    .from("rider_referrals")
    .select("*, referrer:riders!rider_referrals_referrer_id_fkey(id, full_name, user:users(full_name, phone)), referred_rider:riders!rider_referrals_referred_rider_id_fkey(id, full_name, user:users(full_name, phone))", { count: "exact" });

  if (filters?.status) {
    query = query.eq("status", filters.status);
  }

  if (filters?.search) {
    query = query.or(`referral_code.ilike.%${filters.search}%`);
  }

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  query = query.order("created_at", { ascending: false }).range(from, to);

  const { data, count, error } = await query;
  if (error) throw error;

  return {
    data: (data || []) as RiderReferral[],
    total: count || 0,
    page,
    page_size: pageSize,
  } as PaginatedResponse<RiderReferral>;
}

// ─── CAMPAIGNS ────────────────────────────────────────

export async function fetchCampaigns(page = 1, pageSize = 20) {
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const { data, count, error } = await supabase
    .from("referral_campaigns")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, to);

  if (error) throw error;

  return {
    data: (data || []) as ReferralCampaign[],
    total: count || 0,
    page,
    page_size: pageSize,
  } as PaginatedResponse<ReferralCampaign>;
}

export async function createCampaign(campaign: Partial<ReferralCampaign>) {
  const { data, error } = await supabase
    .from("referral_campaigns")
    .insert({
      name: campaign.name,
      description: campaign.description,
      campaign_type: campaign.campaign_type || "both",
      starts_at: campaign.starts_at,
      ends_at: campaign.ends_at,
      driver_bonus_amount: campaign.driver_bonus_amount || 0,
      rider_credit_amount: campaign.rider_credit_amount || 0,
      conditions: campaign.conditions || {},
      target_city: campaign.target_city,
      target_vehicle_type: campaign.target_vehicle_type,
      is_active: true,
      max_referrals_per_user: campaign.max_referrals_per_user,
    })
    .select()
    .single();

  if (error) throw error;
  return data as ReferralCampaign;
}

export async function updateCampaign(id: string, updates: Partial<ReferralCampaign>) {
  const { data, error } = await supabase
    .from("referral_campaigns")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;
  return data as ReferralCampaign;
}

export async function toggleCampaign(id: string, isActive: boolean) {
  const { error } = await supabase
    .from("referral_campaigns")
    .update({ is_active: isActive, updated_at: new Date().toISOString() })
    .eq("id", id);

  if (error) throw error;
}

// ─── REWARDS ──────────────────────────────────────────

export async function fetchReferralRewards(
  page = 1,
  pageSize = 20,
  filters?: { referral_type?: string; status?: string }
) {
  let query = supabase
    .from("referral_rewards")
    .select("*", { count: "exact" });

  if (filters?.referral_type) {
    query = query.eq("referral_type", filters.referral_type);
  }
  if (filters?.status) {
    query = query.eq("status", filters.status);
  }

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  query = query.order("created_at", { ascending: false }).range(from, to);

  const { data, count, error } = await query;
  if (error) throw error;

  return {
    data: (data || []) as ReferralReward[],
    total: count || 0,
    page,
    page_size: pageSize,
  } as PaginatedResponse<ReferralReward>;
}

export async function approveReward(rewardId: string) {
  const { error } = await supabase
    .from("referral_rewards")
    .update({ status: "approved", approved_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", rewardId);

  if (error) throw error;
}

export async function markRewardPaid(rewardId: string, transactionRef?: string) {
  const { error } = await supabase
    .from("referral_rewards")
    .update({
      status: "paid",
      paid_at: new Date().toISOString(),
      transaction_reference: transactionRef,
      updated_at: new Date().toISOString(),
    })
    .eq("id", rewardId);

  if (error) throw error;
}

// ─── FRAUD CHECKS ─────────────────────────────────────

export async function fetchFraudChecks(
  page = 1,
  pageSize = 20,
  filters?: { referral_id?: string; referral_type?: string; result?: string }
) {
  let query = supabase
    .from("referral_fraud_checks")
    .select("*", { count: "exact" });

  if (filters?.referral_id) {
    query = query.eq("referral_id", filters.referral_id);
  }
  if (filters?.referral_type) {
    query = query.eq("referral_type", filters.referral_type);
  }
  if (filters?.result) {
    query = query.eq("result", filters.result);
  }

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  query = query.order("checked_at", { ascending: false }).range(from, to);

  const { data, count, error } = await query;
  if (error) throw error;

  return {
    data: (data || []) as ReferralFraudCheck[],
    total: count || 0,
    page,
    page_size: pageSize,
  } as PaginatedResponse<ReferralFraudCheck>;
}

// ─── EVENTS ───────────────────────────────────────────

export async function fetchReferralEvents(
  page = 1,
  pageSize = 50,
  filters?: { referral_id?: string; event_type?: string }
) {
  let query = supabase
    .from("referral_events")
    .select("*", { count: "exact" });

  if (filters?.referral_id) {
    query = query.eq("referral_id", filters.referral_id);
  }
  if (filters?.event_type) {
    query = query.eq("event_type", filters.event_type);
  }

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  query = query.order("created_at", { ascending: false }).range(from, to);

  const { data, count, error } = await query;
  if (error) throw error;

  return {
    data: (data || []) as ReferralEvent[],
    total: count || 0,
    page,
    page_size: pageSize,
  } as PaginatedResponse<ReferralEvent>;
}

// ─── ADMIN STATS RPC FUNCTION ─────────────────────────

/**
 * Call this once during migration or via SQL editor to create the stats function.
 * SQL:
 * CREATE OR REPLACE FUNCTION public.get_driver_referral_stats()
 * RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
 * BEGIN
 *   RETURN jsonb_build_object(
 *     'total_referrals', (SELECT COUNT(*) FROM public.driver_referrals),
 *     'pending_bonuses', (SELECT COUNT(*) FROM public.driver_referrals WHERE status IN ('first_trip_completed', 'bonus_approved')),
 *     'paid_bonuses', (SELECT COUNT(*) FROM public.driver_referrals WHERE status = 'bonus_paid'),
 *     'conversion_rate', CASE WHEN (SELECT COUNT(*) FROM public.driver_referrals) > 0
 *       THEN ROUND((SELECT COUNT(*) FROM public.driver_referrals WHERE status IN ('bonus_approved', 'bonus_paid'))::DECIMAL /
 *         NULLIF((SELECT COUNT(*) FROM public.driver_referrals), 0) * 100, 1) ELSE 0 END,
 *     'fraud_alerts', (SELECT COUNT(*) FROM public.driver_referrals WHERE fraud_verdict IS NOT NULL AND fraud_verdict != 'safe'),
 *     'total_bonus_amount', (SELECT COALESCE(SUM(bonus_amount), 0) FROM public.driver_referrals)
 *   );
 * END;
 * $$;
 */