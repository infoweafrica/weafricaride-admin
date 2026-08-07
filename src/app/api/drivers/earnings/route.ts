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
    const { data: walletData, error } = await supabase
      .from("driver_wallets")
      .select("*, driver:drivers(id, user:users(full_name, phone))")
      .order("available_balance", { ascending: false })
      .limit(100);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    const [{ data: todayRides }, { data: weekRides }, { data: monthRides }] = await Promise.all([
      supabase.from("rides").select("driver_id, fare_amount, commission_amount, driver_earning").eq("status", "completed").gte("created_at", todayStart),
      supabase.from("rides").select("driver_id, fare_amount, commission_amount, driver_earning").eq("status", "completed").gte("created_at", weekStart),
      supabase.from("rides").select("driver_id, fare_amount, commission_amount, driver_earning").eq("status", "completed").gte("created_at", monthStart),
    ]);

    const todayByDriver: Record<string, number> = {};
    const weekByDriver: Record<string, number> = {};
    const monthByDriver: Record<string, number> = {};
    const tripsByDriver: Record<string, number> = {};

    (todayRides || []).forEach((r: Row) => {
      todayByDriver[r.driver_id] = (todayByDriver[r.driver_id] || 0) + (r.driver_earning || r.fare_amount || 0);
    });
    (weekRides || []).forEach((r: Row) => {
      weekByDriver[r.driver_id] = (weekByDriver[r.driver_id] || 0) + (r.driver_earning || r.fare_amount || 0);
    });
    (monthRides || []).forEach((r: Row) => {
      monthByDriver[r.driver_id] = (monthByDriver[r.driver_id] || 0) + (r.driver_earning || r.fare_amount || 0);
      tripsByDriver[r.driver_id] = (tripsByDriver[r.driver_id] || 0) + 1;
    });

    let earnings: Row[];
    if (walletData && walletData.length > 0) {
      earnings = walletData.map((w: Row) => {
        const driverObj = w.driver as Row | undefined;
        const userObj = driverObj?.user as Row | undefined;
        const driverId = w.driver_id || driverObj?.id;
        return {
          id: w.id,
          driver_id: driverId,
          driver_name: userObj?.full_name || "Unknown Driver",
          driver_phone: userObj?.phone || "",
          today: todayByDriver[driverId] || 0,
          this_week: weekByDriver[driverId] || 0,
          this_month: monthByDriver[driverId] || 0,
          total_trips: tripsByDriver[driverId] || 0,
          available_balance: w.available_balance || 0,
          pending_balance: w.pending_balance || 0,
          commission_owed: w.commission_owed || 0,
        };
      });
    } else {
      const { data: driverData, error: driverError } = await supabase
        .from("drivers")
        .select("id, total_earnings, available_balance, pending_balance, user:users(full_name, phone)")
        .limit(100);

      if (driverError) {
        return NextResponse.json({ error: driverError.message }, { status: 500 });
      }

      earnings = (driverData || []).map((d: Row) => {
        const userObj = d.user as Row | undefined;
        const driverId = d.id;
        return {
          id: driverId,
          driver_id: driverId,
          driver_name: userObj?.full_name || "Unknown Driver",
          driver_phone: userObj?.phone || "",
          today: todayByDriver[driverId] || 0,
          this_week: weekByDriver[driverId] || 0,
          this_month: monthByDriver[driverId] || 0,
          total_trips: tripsByDriver[driverId] || 0,
          available_balance: d.available_balance || 0,
          pending_balance: d.pending_balance || 0,
          commission_owed: Math.round((d.total_earnings || 0) * 0.15),
        };
      });
    }

    const summary = {
      today: earnings.reduce((s, e) => s + e.today, 0),
      week: earnings.reduce((s, e) => s + e.this_week, 0),
      month: earnings.reduce((s, e) => s + e.this_month, 0),
      pending: earnings.reduce((s, e) => s + e.pending_balance, 0),
    };

    return NextResponse.json({ earnings, summary });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
