import { NextResponse, type NextRequest } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { requireAdminSession } from "@/lib/admin-session-token";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

const ACTIVE_RIDE_STATUSES = ["accepted", "driver_arriving", "driver_arrived", "arrived", "in_progress"];

export async function GET(request: NextRequest) {
  if (!requireAdminSession(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getServiceClient();

  try {
    const { data: driverData, error } = await supabase
      .from("drivers")
      .select("id, status, is_online, city, vehicle_id, user:users(full_name, phone)")
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const driverIds = (driverData || []).map((d: Row) => d.id).filter(Boolean);
    const vehicleIds = [...new Set((driverData || []).map((d: Row) => d.vehicle_id).filter(Boolean))];

    const { data: vehicleData } = vehicleIds.length
      ? await supabase.from("vehicles").select("id, plate_number, make, model, vehicle_type").in("id", vehicleIds)
      : { data: [] as Row[] };

    const vehicleMap: Record<string, Row> = {};
    (vehicleData || []).forEach((v: Row) => {
      vehicleMap[v.id] = v;
    });

    const { data: locData } = driverIds.length
      ? await supabase.from("driver_locations").select("driver_id, is_online, updated_at, latitude, longitude").in("driver_id", driverIds)
      : { data: [] as Row[] };

    const locationMap: Record<string, Row> = {};
    (locData || []).forEach((loc: Row) => {
      locationMap[loc.driver_id] = loc;
    });

    const { data: activeRideData } = driverIds.length
      ? await supabase.from("rides").select("id, driver_id, status").in("driver_id", driverIds).in("status", ACTIVE_RIDE_STATUSES)
      : { data: [] as Row[] };

    const activeRideMap: Record<string, Row> = {};
    (activeRideData || []).forEach((ride: Row) => {
      if (ride.driver_id) activeRideMap[ride.driver_id] = ride;
    });

    const now = new Date();
    let onlineCount = 0;
    let offlineCount = 0;
    let busyCount = 0;
    let idleCount = 0;

    const drivers = (driverData || []).map((d: Row) => {
      const loc = locationMap[d.id];
      const liveOnline = loc?.is_online === true;
      const profileOnline = d.is_online === true;
      const activeRide = activeRideMap[d.id];
      const lastSeenValue = loc?.updated_at || "";
      const lastSeen = lastSeenValue ? new Date(lastSeenValue) : null;
      const minutesAgo = lastSeen ? Math.floor((now.getTime() - lastSeen.getTime()) / 60000) : 999999;

      let driverStatus = "offline";
      if (activeRide) {
        driverStatus = "busy";
        busyCount++;
      } else if (liveOnline || profileOnline) {
        driverStatus = "idle";
        idleCount++;
        onlineCount++;
      } else {
        offlineCount++;
      }

      const vehicle = vehicleMap[d.vehicle_id];
      const vehicleLabel = [vehicle?.make, vehicle?.model].filter(Boolean).join(" ");

      return {
        id: d.id,
        name: d.user?.full_name || d.id?.slice(0, 8) || "Unknown",
        phone: d.user?.phone || "",
        status: driverStatus,
        last_seen: lastSeenValue,
        city: d.city || "—",
        vehicle_type: vehicle?.vehicle_type || d.status || "Standard",
        vehicle_label: vehicleLabel || "No vehicle",
        plate: vehicle?.plate_number || "",
        current_ride_id: activeRide?.id || null,
        online_duration: minutesAgo < 60 ? `${minutesAgo}m ago` : minutesAgo < 999999 ? `${Math.floor(minutesAgo / 60)}h ago` : "Never",
      };
    });

    return NextResponse.json({
      drivers,
      stats: { online: onlineCount, offline: offlineCount, busy: busyCount, idle: idleCount, total: drivers.length },
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
