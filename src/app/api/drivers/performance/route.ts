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
    const { data: driverData, error } = await supabase
      .from("drivers")
      .select("id, total_trips, total_earnings, rating, available_balance, user:users(full_name, phone)")
      .limit(100);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const performance = await Promise.all(
      (driverData || []).map(async (d: Row) => {
        const userObj = d.user as Row | undefined;

        const { data: rideData } = await supabase
          .from("rides")
          .select("status")
          .eq("driver_id", d.id);

        const totalRides = rideData?.length || 0;
        const completedRides = rideData?.filter((r: Row) => r.status === "completed").length || 0;
        const cancelledRides =
          rideData?.filter((r: Row) => r.status === "cancelled" || r.status === "driver_cancelled").length || 0;

        return {
          id: d.id,
          driver_name: userObj?.full_name || "N/A",
          driver_phone: userObj?.phone || "",
          total_trips: d.total_trips || totalRides,
          acceptance_rate: totalRides > 0 ? Math.round(((totalRides - cancelledRides) / totalRides) * 100) : 0,
          cancellation_rate: totalRides > 0 ? Math.round((cancelledRides / totalRides) * 100) : 0,
          completion_rate: totalRides > 0 ? Math.round((completedRides / totalRides) * 100) : 0,
          average_rating: d.rating || 0,
          safety_score: Math.round((d.rating || 0) * 20),
          complaints: 0,
        };
      })
    );

    return NextResponse.json({ drivers: performance });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
