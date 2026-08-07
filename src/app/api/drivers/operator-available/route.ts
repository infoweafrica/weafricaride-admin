import { NextResponse, type NextRequest } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { requireAdminSession } from "@/lib/admin-session-token";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

export async function GET(request: NextRequest) {
  if (!requireAdminSession(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getServiceClient();

  try {
    // drivers.is_online is the source of truth (set atomically by the
    // driver_go_online/offline RPCs). driver_locations is populated
    // separately by the client's GPS stream and can lag behind or be
    // missing entirely — so it must only enrich position, never gate
    // whether a driver is considered online.
    const { data: drData, error: drErr } = await supabase
      .from("drivers")
      .select("id, user:users(full_name), vehicle:vehicles!drivers_vehicle_id_fkey(plate_number, make, model, vehicle_type)")
      .eq("is_online", true);

    if (drErr) {
      return NextResponse.json({ error: drErr.message }, { status: 500 });
    }

    const ids = (drData || []).map((d: Row) => d.id);
    const locMap: Record<string, Row> = {};
    if (ids.length > 0) {
      const { data: locData } = await supabase
        .from("driver_locations")
        .select("driver_id, latitude, longitude, heading, speed, updated_at")
        .in("driver_id", ids);

      (locData || []).forEach((l: Row) => {
        locMap[l.driver_id] = l;
      });
    }

    const drivers = (drData || []).map((d: Row) => {
      const loc = locMap[d.id];
      return {
        id: d.id,
        driver_id: d.id,
        driver_name: d.user?.full_name || d.id.slice(0, 8),
        plate: d.vehicle?.plate_number,
        vehicle: [d.vehicle?.make, d.vehicle?.model].filter(Boolean).join(" "),
        vehicle_type: d.vehicle?.vehicle_type,
        latitude: loc?.latitude ?? null,
        longitude: loc?.longitude ?? null,
        heading: loc?.heading,
        speed: loc?.speed,
        is_online: true,
        updated_at: loc?.updated_at,
      };
    });

    return NextResponse.json({ drivers });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
