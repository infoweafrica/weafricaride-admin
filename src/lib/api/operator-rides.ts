"use client";

import { supabase } from "@/lib/supabase";

export type OperatorRideInput = {
  customer_name: string;
  customer_phone: string;
  pickup_address: string;
  dropoff_address: string;
  pickup_lat: number;
  pickup_lng: number;
  dropoff_lat: number;
  dropoff_lng: number;
  vehicle_type: string;
  payment_method: string;
  city: string;
  operator_notes?: string;
  request_source?: string;
  // When set, dispatch only this driver — the RPC still rejects it if the
  // driver's vehicle class isn't an exact match for vehicle_type.
  driver_id?: string | null;
};

export type OperatorRideResult = {
  ride_id: string;
  status: string;
  vehicle_class: string;
  vehicle_label: string;
  rider_pin: string;
  customer_phone: string;
  requests_sent: number;
  driver_ids: string[];
};

export function estimateOperatorFare(input: OperatorRideInput) {
  const distanceKm = haversineKm(
    input.pickup_lat,
    input.pickup_lng,
    input.dropoff_lat,
    input.dropoff_lng,
  );

  const baseFare = 1000;
  const perKm = 450;
  const perMin = 80;
  const durationMin = Math.max(5, Math.round(distanceKm * 2.5));

  let multiplier = 1; // x (base tier)
  if (input.vehicle_type === "go") multiplier = 0.85;
  if (input.vehicle_type === "xl") multiplier = 1.3;
  if (input.vehicle_type === "comfort") multiplier = 1.5;
  if (input.vehicle_type === "black") multiplier = 2.0;
  if (input.vehicle_type === "women") multiplier = 1.0;

  const fare = Math.round((baseFare + distanceKm * perKm + durationMin * perMin) * multiplier);

  return {
    distance_km: Number(distanceKm.toFixed(2)),
    duration_min: durationMin,
    estimated_fare: fare,
    fare,
  };
}

// All validation (phone format, resolved coordinates, EXACT vehicle-class
// availability) is enforced server-side by public.operator_create_ride —
// see supabase/migrations/20260907160000_operator_booking_strict_validation.sql.
// A "No WeAfrica X drivers are currently available in your area." rejection
// comes back as error.message and no ride is created.
export async function createOperatorRide(input: OperatorRideInput): Promise<OperatorRideResult> {
  const estimate = estimateOperatorFare(input);

  const { data, error } = await supabase.rpc("operator_create_ride", {
    p_customer_name: input.customer_name,
    p_customer_phone: input.customer_phone,
    p_pickup_address: input.pickup_address,
    p_pickup_lat: input.pickup_lat,
    p_pickup_lng: input.pickup_lng,
    p_dropoff_address: input.dropoff_address,
    p_dropoff_lat: input.dropoff_lat,
    p_dropoff_lng: input.dropoff_lng,
    p_vehicle_type: input.vehicle_type,
    p_payment_method: input.payment_method,
    p_city: input.city,
    p_operator_notes: input.operator_notes ?? null,
    p_request_source: input.request_source ?? "phone_call",
    p_estimated_fare: estimate.estimated_fare,
    p_distance_km: estimate.distance_km,
    p_duration_min: estimate.duration_min,
    p_driver_id: input.driver_id ?? null,
  });

  if (error) throw new Error(error.message);

  return data as OperatorRideResult;
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRad(value: number) {
  return (value * Math.PI) / 180;
}
