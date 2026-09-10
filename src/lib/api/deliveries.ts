"use client";

import { supabase } from "@/lib/supabase";
import { pagedQuery, type PaginatedResult } from "@/lib/api/base";

/// One row of public.delivery_requests (the parcel-courier subsystem — a
/// separate table + lifecycle from `rides`; see the 20260907000200/300/400
/// delivery migrations).
export interface DeliveryRequest {
  id: string;
  reference: string;
  status: string;
  package_type: string;
  package_description: string | null;
  is_fragile: boolean;
  pickup_address: string | null;
  dropoff_address: string | null;
  pickup_contact_name: string | null;
  pickup_contact_phone: string | null;
  recipient_name: string | null;
  recipient_phone: string | null;
  assigned_driver_id: string | null;
  customer_id: string | null;
  distance_km: number | null;
  delivery_fee: number | null;
  currency: string | null;
  payment_method: string | null;
  payment_status: string | null;
  pickup_pin: string | null;
  dropoff_pin: string | null;
  city: string | null;
  cancelled_by: string | null;
  cancellation_reason: string | null;
  failure_reason: string | null;
  requested_at: string | null;
  accepted_at: string | null;
  picked_up_at: string | null;
  delivered_at: string | null;
  created_at: string;
  // joined
  driver?: { id: string; full_name: string | null; phone: string | null } | null;
}

export interface DeliveryFilters {
  status?: string;
  paymentStatus?: string;
  city?: string | null;
  dateFrom?: string;
  dateTo?: string;
}

export const DELIVERY_STATUSES = [
  "requested",
  "searching_driver",
  "driver_assigned",
  "driver_en_route_pickup",
  "driver_arrived_pickup",
  "picked_up",
  "in_transit",
  "driver_arrived_dropoff",
  "delivered",
  "cancelled",
  "no_driver",
  "failed_delivery",
  "returned",
] as const;

/// Statuses where the delivery is still in flight (an operator might need to
/// step in).
export const DELIVERY_ACTIVE_STATUSES = [
  "requested",
  "searching_driver",
  "driver_assigned",
  "driver_en_route_pickup",
  "driver_arrived_pickup",
  "picked_up",
  "in_transit",
  "driver_arrived_dropoff",
];

export function deliveryStatusLabel(status?: string | null): string {
  if (!status) return "—";
  return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// delivery_requests has exactly one FK to drivers (assigned_driver_id), so
// PostgREST resolves this embed unambiguously without a hint.
const SELECT = "*, driver:drivers(id, full_name, phone)";

export async function fetchDeliveries(
  page: number,
  pageSize: number,
  filters?: DeliveryFilters,
): Promise<PaginatedResult<DeliveryRequest[]>> {
  return pagedQuery<DeliveryRequest[]>(
    "delivery_requests",
    page,
    pageSize,
    SELECT,
    (q) => {
      if (filters?.status && filters.status !== "all") q = q.eq("status", filters.status);
      if (filters?.status === "active") q = q.in("status", DELIVERY_ACTIVE_STATUSES);
      if (filters?.paymentStatus && filters.paymentStatus !== "all") {
        q = q.eq("payment_status", filters.paymentStatus);
      }
      if (filters?.city) q = q.eq("city", filters.city);
      if (filters?.dateFrom) q = q.gte("created_at", filters.dateFrom);
      if (filters?.dateTo) q = q.lte("created_at", filters.dateTo);
      return q;
    },
  );
}

export async function fetchDeliveryStatusCounts(): Promise<Record<string, number>> {
  const { data, error } = await supabase.from("delivery_requests").select("status");
  if (error) throw new Error(error.message);
  const counts: Record<string, number> = {};
  (data ?? []).forEach((r: { status: string }) => {
    counts[r.status] = (counts[r.status] || 0) + 1;
  });
  return counts;
}

/// Admin-cancel an in-flight delivery. Uses the same SECURITY DEFINER RPC the
/// apps use (transition-guarded, refunds a prepaid fee, releases the driver).
export async function cancelDelivery(id: string, reason: string): Promise<boolean> {
  const { error } = await supabase.rpc("cancel_delivery_request", {
    p_delivery_id: id,
    p_actor_type: "system",
    p_actor_id: null,
    p_reason: reason || "Cancelled by admin",
  });
  if (error) {
    console.error("cancelDelivery:", error);
    throw new Error(error.message);
  }
  return true;
}

/// Re-run dispatch for a delivery still waiting on a driver
/// (no_driver / searching_driver / requested).
export async function retryDeliveryDispatch(id: string): Promise<boolean> {
  const { error } = await supabase.rpc("retry_delivery_request", { p_delivery_id: id });
  if (error) {
    console.error("retryDeliveryDispatch:", error);
    throw new Error(error.message);
  }
  return true;
}
