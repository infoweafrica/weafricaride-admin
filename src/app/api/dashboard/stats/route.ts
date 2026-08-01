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

  const { searchParams } = new URL(request.url);
  const cityId = searchParams.get("cityId") || undefined;
  const supabase = getServiceClient();

  const cancelledStatuses = ["cancelled","rider_cancelled","driver_cancelled","admin_cancelled"];

  try {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const weekAgo = sevenDaysAgo.toISOString();

    const activeStatuses = ["requested","searching","accepted","driver_arriving","driver_arrived","arrived","in_progress"];

    const [
      activeRidesRes,
      completedRidesRes,
      cancelledRidesRes,
      revenueRes,
      totalDriversRes,
      activeDriversRes,
      pendingRes,
      payoutsRes,
      weeklyRevRes,
      weeklyRidesRes,
      statusCountsRes,
      recentRidesRes,
      totalRidersRes,
    ] = await Promise.all([
      (() => { let q = supabase.from("rides").select("*", { count: "exact", head: true }).in("status", activeStatuses); if (cityId) q = q.eq("city", cityId); return q; })(),
      (() => { let q = supabase.from("rides").select("*", { count: "exact", head: true }).eq("status", "completed"); if (cityId) q = q.eq("city", cityId); return q; })(),
      (() => { let q = supabase.from("rides").select("*", { count: "exact", head: true }).in("status", cancelledStatuses); if (cityId) q = q.eq("city", cityId); return q; })(),
      (() => { let q = supabase.from("rides").select("fare").eq("status", "completed"); if (cityId) q = q.eq("city", cityId); return q; })(),
      (() => { let q = supabase.from("drivers").select("*", { count: "exact", head: true }); if (cityId) q = q.eq("city_id", cityId); return q; })(),
      (() => { let q = supabase.from("drivers").select("*", { count: "exact", head: true }).eq("is_active", true); if (cityId) q = q.eq("city_id", cityId); return q; })(),
      supabase.from("drivers").select("*", { count: "exact", head: true }).eq("approval_status", "pending"),
      supabase.from("driver_payouts").select("amount"),
      (() => { let q = supabase.from("rides").select("fare, created_at").eq("status", "completed").gte("created_at", weekAgo); if (cityId) q = q.eq("city", cityId); return q; })(),
      (() => { let q = supabase.from("rides").select("status, created_at").gte("created_at", weekAgo); if (cityId) q = q.eq("city", cityId); return q; })(),
      (() => { let q = supabase.from("rides").select("status"); if (cityId) q = q.eq("city", cityId); return q; })(),
      (() => { let q = supabase.from("rides").select("*, rider:riders(full_name), driver:drivers(full_name), category:ride_categories(name)").order("created_at", { ascending: false }).limit(10); if (cityId) q = q.eq("city", cityId); return q; })(),
      supabase.from("riders").select("*", { count: "exact", head: true }),
    ]);

    const revByDay: Record<string, number> = {};
    (weeklyRevRes.data || []).forEach((r: any) => {
      const day = new Date(r.created_at).toLocaleDateString("en-US", { weekday: "short" });
      revByDay[day] = (revByDay[day] || 0) + (r.fare || 0);
    });
    const weeklyRevenue = Object.entries(revByDay).map(([name, revenue]) => ({ name, revenue }));

    const ridesByDay: Record<string, { completed: number; cancelled: number }> = {};
    (weeklyRidesRes.data || []).forEach((r: any) => {
      const day = new Date(r.created_at).toLocaleDateString("en-US", { weekday: "short" });
      if (!ridesByDay[day]) ridesByDay[day] = { completed: 0, cancelled: 0 };
      if (r.status === "completed") ridesByDay[day].completed++;
      if (cancelledStatuses.includes(r.status)) ridesByDay[day].cancelled++;
    });
    const weeklyRides = Object.entries(ridesByDay).map(([name, v]) => ({ name, ...v }));

    const statusCounts: Record<string, number> = {};
    (statusCountsRes.data || []).forEach((r: any) => {
      statusCounts[r.status] = (statusCounts[r.status] || 0) + 1;
    });

    const totalRevenue = (revenueRes.data || []).reduce((sum: number, r: any) => sum + (r.fare || 0), 0);
    const totalPayouts = (payoutsRes.data || []).reduce((sum: number, r: any) => sum + (r.amount || 0), 0);

    return NextResponse.json({
      activeRides: activeRidesRes.count ?? 0,
      completedRides: completedRidesRes.count ?? 0,
      cancelledRides: cancelledRidesRes.count ?? 0,
      totalRevenue,
      totalDrivers: totalDriversRes.count ?? 0,
      activeDrivers: activeDriversRes.count ?? 0,
      pendingApprovals: pendingRes.count ?? 0,
      driverPayouts: totalPayouts,
      totalRiders: totalRidersRes.count ?? 0,
      weeklyRevenue,
      weeklyRides,
      statusCounts,
      recentRides: recentRidesRes.data || [],
    });
  } catch (err) {
    console.error("[/api/dashboard/stats]", err);
    return NextResponse.json({ error: "Failed to fetch dashboard stats" }, { status: 500 });
  }
}
