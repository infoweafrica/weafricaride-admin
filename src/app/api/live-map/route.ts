import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdminSession } from "@/lib/admin-session-token";

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

export async function GET(request: NextRequest) {
  if (!requireAdminSession(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getServiceClient();

  try {
    const { data: locations, error } = await supabase
      .from("driver_locations")
      .select("id, driver_id, latitude, longitude, heading, speed, is_online, updated_at")
      .eq("is_online", true)
      .order("updated_at", { ascending: false })
      .limit(200);

    if (error) {
      return NextResponse.json({ error: error.message, code: error.code, details: error.details }, { status: 500 });
    }

    const { data: activeRides, error: ridesError } = await supabase
      .from("rides")
      .select(
        "id, status, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, pickup_address, dropoff_address, " +
          "estimated_fare, actual_fare, driver_id, driver:drivers(full_name), rider:riders(user:users(full_name))"
      )
      .in("status", ["requested", "searching", "assigned", "accepted", "en_route", "arrived", "picked_up", "in_progress"])
      .limit(200);

    if (ridesError) {
      return NextResponse.json({ error: ridesError.message, code: ridesError.code, details: ridesError.details }, { status: 500 });
    }

    type RideRow = {
      id: string;
      status: string;
      pickup_lat: number | null;
      pickup_lng: number | null;
      dropoff_lat: number | null;
      dropoff_lng: number | null;
      pickup_address: string | null;
      dropoff_address: string | null;
      estimated_fare: number | null;
      actual_fare: number | null;
      driver_id: string | null;
      driver: { full_name: string } | { full_name: string }[] | null;
      rider: { user: { full_name: string } | { full_name: string }[] | null } | { user: { full_name: string } | { full_name: string }[] | null }[] | null;
    };
    const first = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? v[0] ?? null : v);

    const rides = ((activeRides || []) as unknown as RideRow[]).map((r) => ({
      id: r.id,
      status: r.status,
      pickup_lat: r.pickup_lat,
      pickup_lng: r.pickup_lng,
      dropoff_lat: r.dropoff_lat,
      dropoff_lng: r.dropoff_lng,
      pickup_addr: r.pickup_address || "",
      dropoff_addr: r.dropoff_address || "",
      driver_id: r.driver_id || undefined,
      driver_name: first(r.driver)?.full_name || undefined,
      rider_name: first(first(r.rider)?.user ?? null)?.full_name || undefined,
      fare: r.actual_fare ?? r.estimated_fare ?? undefined,
    }));

    return NextResponse.json({ drivers: locations || [], rides, count: locations?.length ?? 0 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
