"use client";

import { supabase } from "@/lib/supabase";

export type ServiceZoneType = "operating" | "airport" | "surge" | "restricted";
export type ZoneStatus = "active" | "disabled" | "draft";

export interface ZoneCoordinate {
  lat: number;
  lng: number;
}

export interface ZonePricingRules {
  base_fare: number;
  per_km: number;
  per_minute: number;
  minimum_fare: number;
}

export interface AirportFeeSettings {
  pickup_fee: number;
  dropoff_fee: number;
  queue_enabled: boolean;
  queue_capacity: number;
}

export interface SurgeSettings {
  enabled: boolean;
  manual_active: boolean;
  multiplier: number;
  starts_at: string | null;
  ends_at: string | null;
}

export interface RestrictedZoneRules {
  no_pickup: boolean;
  no_dropoff: boolean;
  no_entry: boolean;
  reason: string;
}

export interface AutomaticSurgeRules {
  enabled: boolean;
  min_demand_requests: number;
  min_driver_shortage_ratio: number;
  multiplier: number;
}

export interface ServiceZoneMetrics {
  drivers_live: number;
  online_drivers: number;
  trips_24h: number;
  demand_24h: number;
  airport_queue: number;
}

export interface ZoneDriver {
  id: string;
  name: string;
  phone: string;
  latitude: number;
  longitude: number;
  is_online: boolean;
  updated_at: string;
  vehicle_label: string;
}

export interface ZoneTrip {
  id: string;
  status: string;
  pickup_address: string;
  dropoff_address: string;
  created_at: string;
  fare: number;
  rider_name: string;
  driver_name: string;
}

export interface ServiceZone {
  id: string;
  name: string;
  city: string;
  zone_type: ServiceZoneType;
  status: ZoneStatus;
  description: string | null;
  center_lat: number | null;
  center_lng: number | null;
  boundary_coordinates: ZoneCoordinate[];
  pricing_rules: ZonePricingRules;
  airport_fees: AirportFeeSettings;
  surge_settings: SurgeSettings;
  restricted_rules: RestrictedZoneRules;
  auto_surge_rules: AutomaticSurgeRules;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  metrics?: ServiceZoneMetrics;
  drivers?: ZoneDriver[];
  trips?: ZoneTrip[];
}

export interface ServiceZoneFilters {
  search?: string;
  city?: string;
  status?: string;
  type?: string;
}

export type ServiceZonePayload = Omit<ServiceZone, "id" | "created_at" | "updated_at" | "metrics" | "drivers" | "trips">;

export interface ServiceZoneAuditLog {
  id: string;
  zone_id: string;
  action: string;
  admin_id: string | null;
  admin_email: string | null;
  before_data: Record<string, unknown> | null;
  after_data: Record<string, unknown> | null;
  created_at: string;
}

export const DEFAULT_PRICING_RULES: ZonePricingRules = {
  base_fare: 1200,
  per_km: 650,
  per_minute: 80,
  minimum_fare: 1800,
};

export const DEFAULT_AIRPORT_FEES: AirportFeeSettings = {
  pickup_fee: 0,
  dropoff_fee: 0,
  queue_enabled: false,
  queue_capacity: 50,
};

export const DEFAULT_SURGE_SETTINGS: SurgeSettings = {
  enabled: false,
  manual_active: false,
  multiplier: 1,
  starts_at: null,
  ends_at: null,
};

export const DEFAULT_RESTRICTED_RULES: RestrictedZoneRules = {
  no_pickup: false,
  no_dropoff: false,
  no_entry: false,
  reason: "",
};

export const DEFAULT_AUTO_SURGE_RULES: AutomaticSurgeRules = {
  enabled: false,
  min_demand_requests: 25,
  min_driver_shortage_ratio: 1.5,
  multiplier: 1.25,
};

const activeRideStatuses = ["requested", "searching", "accepted", "driver_arriving", "driver_arrived", "arrived", "in_progress"];

function normalizeCoordinates(value: unknown): ZoneCoordinate[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((point) => {
      const raw = point as Record<string, unknown>;
      const lat = Number(raw.lat ?? raw.latitude);
      const lng = Number(raw.lng ?? raw.longitude);
      return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
    })
    .filter(Boolean) as ZoneCoordinate[];
}

function normalizeZone(row: Record<string, any>): ServiceZone {
  return {
    id: row.id,
    name: row.name || "Untitled zone",
    city: row.city || "",
    zone_type: (row.zone_type || row.type || "operating") as ServiceZoneType,
    status: (row.status || (row.is_active === false ? "disabled" : "active")) as ZoneStatus,
    description: row.description || null,
    center_lat: row.center_lat == null ? null : Number(row.center_lat),
    center_lng: row.center_lng == null ? null : Number(row.center_lng),
    boundary_coordinates: normalizeCoordinates(row.boundary_coordinates),
    pricing_rules: { ...DEFAULT_PRICING_RULES, ...(row.pricing_rules || {}) },
    airport_fees: { ...DEFAULT_AIRPORT_FEES, ...(row.airport_fees || {}) },
    surge_settings: { ...DEFAULT_SURGE_SETTINGS, ...(row.surge_settings || {}) },
    restricted_rules: { ...DEFAULT_RESTRICTED_RULES, ...(row.restricted_rules || {}) },
    auto_surge_rules: { ...DEFAULT_AUTO_SURGE_RULES, ...(row.auto_surge_rules || {}) },
    metadata: row.metadata || {},
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function pointInPolygon(point: ZoneCoordinate, polygon: ZoneCoordinate[]): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].lng;
    const yi = polygon[i].lat;
    const xj = polygon[j].lng;
    const yj = polygon[j].lat;
    const intersects = yi > point.lat !== yj > point.lat && point.lng < ((xj - xi) * (point.lat - yi)) / (yj - yi || 0.0000001) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function getZoneCenter(zone: Pick<ServiceZone, "center_lat" | "center_lng" | "boundary_coordinates">): ZoneCoordinate | null {
  if (zone.center_lat != null && zone.center_lng != null) return { lat: zone.center_lat, lng: zone.center_lng };
  if (!zone.boundary_coordinates.length) return null;
  const sums = zone.boundary_coordinates.reduce((acc, p) => ({ lat: acc.lat + p.lat, lng: acc.lng + p.lng }), { lat: 0, lng: 0 });
  return { lat: sums.lat / zone.boundary_coordinates.length, lng: sums.lng / zone.boundary_coordinates.length };
}

function zoneContainsPoint(zone: ServiceZone, lat?: number | null, lng?: number | null): boolean {
  if (lat == null || lng == null) return false;
  const point = { lat: Number(lat), lng: Number(lng) };
  if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return false;
  if (zone.boundary_coordinates.length >= 3) return pointInPolygon(point, zone.boundary_coordinates);
  const center = getZoneCenter(zone);
  if (!center) return false;
  return Math.abs(center.lat - point.lat) < 0.15 && Math.abs(center.lng - point.lng) < 0.15;
}

async function fetchDriverMetrics(zones: ServiceZone[]): Promise<Map<string, { metrics: Partial<ServiceZoneMetrics>; drivers: ZoneDriver[] }>> {
  const result = new Map<string, { metrics: Partial<ServiceZoneMetrics>; drivers: ZoneDriver[] }>();
  zones.forEach((zone) => result.set(zone.id, { metrics: { drivers_live: 0, online_drivers: 0 }, drivers: [] }));

  const { data, error } = await supabase
    .from("driver_locations")
    .select("id, driver_id, latitude, longitude, is_online, updated_at, driver:drivers(id, is_online, city, user:users(full_name, phone), vehicle:vehicles!drivers_vehicle_id_fkey(make, model, plate_number))")
    .limit(1000);

  if (error || !data) return result;

  for (const row of data as any[]) {
    const lat = Number(row.latitude);
    const lng = Number(row.longitude);
    for (const zone of zones) {
      if (!zoneContainsPoint(zone, lat, lng)) continue;
      const bucket = result.get(zone.id)!;
      const driver = Array.isArray(row.driver) ? row.driver[0] : row.driver;
      const user = Array.isArray(driver?.user) ? driver.user[0] : driver?.user;
      const vehicle = Array.isArray(driver?.vehicle) ? driver.vehicle[0] : driver?.vehicle;
      const vehicleLabel = [vehicle?.make, vehicle?.model].filter(Boolean).join(" ") || vehicle?.plate_number || "Standard";
      bucket.drivers.push({
        id: row.driver_id,
        name: user?.full_name || row.driver_id?.slice(0, 8) || "Unknown driver",
        phone: user?.phone || "",
        latitude: lat,
        longitude: lng,
        is_online: row.is_online === true || driver?.is_online === true,
        updated_at: row.updated_at,
        vehicle_label: vehicleLabel,
      });
      bucket.metrics.drivers_live = (bucket.metrics.drivers_live || 0) + 1;
      if (row.is_online === true || driver?.is_online === true) bucket.metrics.online_drivers = (bucket.metrics.online_drivers || 0) + 1;
    }
  }

  return result;
}

async function fetchTripMetrics(zones: ServiceZone[]): Promise<Map<string, { metrics: Partial<ServiceZoneMetrics>; trips: ZoneTrip[] }>> {
  const result = new Map<string, { metrics: Partial<ServiceZoneMetrics>; trips: ZoneTrip[] }>();
  zones.forEach((zone) => result.set(zone.id, { metrics: { trips_24h: 0, demand_24h: 0 }, trips: [] }));
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from("rides")
    .select("id, status, pickup_lat, pickup_lng, pickup_latitude, pickup_longitude, pickup_address, dropoff_address, created_at, actual_fare, estimated_fare, rider:riders(user:users(full_name)), driver:drivers(user:users(full_name))")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(1000);

  if (error || !data) return result;

  for (const row of data as any[]) {
    const lat = Number(row.pickup_lat ?? row.pickup_latitude);
    const lng = Number(row.pickup_lng ?? row.pickup_longitude);
    for (const zone of zones) {
      if (!zoneContainsPoint(zone, lat, lng)) continue;
      const bucket = result.get(zone.id)!;
      bucket.metrics.demand_24h = (bucket.metrics.demand_24h || 0) + 1;
      if (row.status === "completed") bucket.metrics.trips_24h = (bucket.metrics.trips_24h || 0) + 1;
      if (bucket.trips.length < 20) {
        const rider = Array.isArray(row.rider) ? row.rider[0] : row.rider;
        const driver = Array.isArray(row.driver) ? row.driver[0] : row.driver;
        const riderUser = Array.isArray(rider?.user) ? rider.user[0] : rider?.user;
        const driverUser = Array.isArray(driver?.user) ? driver.user[0] : driver?.user;
        bucket.trips.push({
          id: row.id,
          status: row.status,
          pickup_address: row.pickup_address || "Pickup",
          dropoff_address: row.dropoff_address || "Drop-off",
          created_at: row.created_at,
          fare: Number(row.actual_fare ?? row.estimated_fare ?? 0),
          rider_name: riderUser?.full_name || "Rider",
          driver_name: driverUser?.full_name || "—",
        });
      }
    }
  }

  return result;
}

async function fetchAirportQueueMetrics(zones: ServiceZone[]): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  zones.forEach((zone) => result.set(zone.id, 0));
  const airportZones = zones.filter((zone) => zone.zone_type === "airport");
  if (!airportZones.length) return result;

  const { data, error } = await supabase
    .from("airport_zone_queue")
    .select("zone_id")
    .eq("status", "waiting")
    .in("zone_id", airportZones.map((zone) => zone.id));

  if (error || !data) return result;
  for (const row of data as any[]) result.set(row.zone_id, (result.get(row.zone_id) || 0) + 1);
  return result;
}

export async function fetchServiceZones(filters: ServiceZoneFilters = {}): Promise<{ data: ServiceZone[]; error: string | null }> {
  try {
    let query = supabase.from("service_zones").select("*").order("updated_at", { ascending: false });
    if (filters.city && filters.city !== "all") query = query.eq("city", filters.city);
    if (filters.status && filters.status !== "all") query = query.eq("status", filters.status);
    if (filters.type && filters.type !== "all") query = query.eq("zone_type", filters.type);
    if (filters.search?.trim()) {
      const term = filters.search.trim().replace(/[%(),]/g, "");
      query = query.or(`name.ilike.%${term}%,city.ilike.%${term}%,description.ilike.%${term}%`);
    }

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    const zones = ((data as any[]) || []).map(normalizeZone);
    const [driverBuckets, tripBuckets, queueBuckets] = await Promise.all([
      fetchDriverMetrics(zones),
      fetchTripMetrics(zones),
      fetchAirportQueueMetrics(zones),
    ]);

    return {
      data: zones.map((zone) => {
        const driverBucket = driverBuckets.get(zone.id);
        const tripBucket = tripBuckets.get(zone.id);
        return {
          ...zone,
          metrics: {
            drivers_live: driverBucket?.metrics.drivers_live || 0,
            online_drivers: driverBucket?.metrics.online_drivers || 0,
            trips_24h: tripBucket?.metrics.trips_24h || 0,
            demand_24h: tripBucket?.metrics.demand_24h || 0,
            airport_queue: queueBuckets.get(zone.id) || 0,
          },
          drivers: driverBucket?.drivers || [],
          trips: tripBucket?.trips || [],
        };
      }),
      error: null,
    };
  } catch (e) {
    return { data: [], error: e instanceof Error ? e.message : "Failed to load service zones" };
  }
}

function toDbPayload(payload: ServiceZonePayload) {
  return {
    name: payload.name,
    city: payload.city,
    zone_type: payload.zone_type,
    status: payload.status,
    description: payload.description || null,
    center_lat: payload.center_lat,
    center_lng: payload.center_lng,
    boundary_coordinates: payload.boundary_coordinates,
    pricing_rules: payload.pricing_rules,
    airport_fees: payload.airport_fees,
    surge_settings: payload.surge_settings,
    restricted_rules: payload.restricted_rules,
    auto_surge_rules: payload.auto_surge_rules,
    metadata: payload.metadata || {},
    updated_at: new Date().toISOString(),
  };
}

export async function saveServiceZone(
  payload: ServiceZonePayload,
  zoneId?: string,
  admin?: { id?: string | null; email?: string | null },
): Promise<{ data: ServiceZone | null; error: string | null }> {
  try {
    const dbPayload = toDbPayload(payload);
    const result = zoneId
      ? await supabase.from("service_zones").update(dbPayload).eq("id", zoneId).select("*").single()
      : await supabase.from("service_zones").insert({ ...dbPayload, created_by: admin?.id || null }).select("*").single();

    if (result.error) throw new Error(result.error.message);
    const zone = normalizeZone(result.data as any);
    await logZoneChange(zone.id, zoneId ? "zone_updated" : "zone_created", null, zone as unknown as Record<string, unknown>, admin);
    return { data: zone, error: null };
  } catch (e) {
    return { data: null, error: e instanceof Error ? e.message : "Failed to save zone" };
  }
}

export async function updateServiceZoneStatus(
  zone: ServiceZone,
  status: ZoneStatus,
  admin?: { id?: string | null; email?: string | null },
): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase.from("service_zones").update({ status, updated_at: new Date().toISOString() }).eq("id", zone.id);
    if (error) throw new Error(error.message);
    await logZoneChange(zone.id, status === "disabled" ? "zone_disabled" : "zone_status_changed", zone as unknown as Record<string, unknown>, { status }, admin);
    return { error: null };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to update status" };
  }
}

export async function deleteServiceZone(zone: ServiceZone, admin?: { id?: string | null; email?: string | null }): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase.from("service_zones").delete().eq("id", zone.id);
    if (error) throw new Error(error.message);
    await logZoneChange(zone.id, "zone_deleted", zone as unknown as Record<string, unknown>, null, admin);
    return { error: null };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to delete zone" };
  }
}

export async function setManualSurge(
  zone: ServiceZone,
  manualActive: boolean,
  admin?: { id?: string | null; email?: string | null },
): Promise<{ error: string | null }> {
  try {
    const surge_settings = {
      ...zone.surge_settings,
      enabled: true,
      manual_active: manualActive,
      starts_at: manualActive ? new Date().toISOString() : zone.surge_settings.starts_at,
      ends_at: manualActive ? zone.surge_settings.ends_at : new Date().toISOString(),
    };
    const { error } = await supabase.from("service_zones").update({ surge_settings, updated_at: new Date().toISOString() }).eq("id", zone.id);
    if (error) throw new Error(error.message);
    await logZoneChange(zone.id, manualActive ? "manual_surge_activated" : "manual_surge_deactivated", zone.surge_settings as unknown as Record<string, unknown>, surge_settings, admin);
    return { error: null };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to update surge" };
  }
}

export async function fetchServiceZoneAuditLogs(zoneId?: string): Promise<{ data: ServiceZoneAuditLog[]; error: string | null }> {
  try {
    let query = supabase.from("service_zone_audit_logs").select("*").order("created_at", { ascending: false }).limit(50);
    if (zoneId) query = query.eq("zone_id", zoneId);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return { data: (data as ServiceZoneAuditLog[]) || [], error: null };
  } catch (e) {
    return { data: [], error: e instanceof Error ? e.message : "Failed to load audit logs" };
  }
}

async function logZoneChange(
  zoneId: string,
  action: string,
  beforeData: Record<string, unknown> | null,
  afterData: Record<string, unknown> | null,
  admin?: { id?: string | null; email?: string | null },
) {
  try {
    await supabase.from("service_zone_audit_logs").insert({
      zone_id: zoneId,
      action,
      admin_id: admin?.id || null,
      admin_email: admin?.email || null,
      before_data: beforeData,
      after_data: afterData,
    });
  } catch {
    // Audit inserts should never block operations; DB triggers also capture changes.
  }
}

export { activeRideStatuses };