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

export async function createOperatorRide(input: OperatorRideInput) {
  const estimate = estimateOperatorFare(input);

  const { data, error } = await supabase
    .from("rides")
    .insert({
      rider_id: null,
      driver_id: null,
      pickup_address: input.pickup_address,
      dropoff_address: input.dropoff_address,
      pickup_lat: input.pickup_lat,
      pickup_lng: input.pickup_lng,
      dropoff_lat: input.dropoff_lat,
      dropoff_lng: input.dropoff_lng,
      status: "requested",
      vehicle_type: input.vehicle_type,
      fare: estimate.fare,
      estimated_fare: estimate.estimated_fare,
      distance_km: estimate.distance_km,
      duration_min: estimate.duration_min,
      payment_method: input.payment_method,
      payment_status: "pending",
      city: input.city,
      request_source: "admin",
      customer_name: input.customer_name,
      customer_phone: input.customer_phone,
      operator_notes: input.operator_notes ?? null,
    })
    .select("*")
    .single();

  if (error) throw new Error(error.message);

  return data;
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
