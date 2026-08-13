import { NextResponse, type NextRequest } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { requireAdminSession } from "@/lib/admin-session-token";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

const PAGE_SIZE = 50;

export async function GET(request: NextRequest) {
  if (!requireAdminSession(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getServiceClient();
  const { searchParams } = new URL(request.url);
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
  const status = searchParams.get("status"); // paid | partially_paid | awaiting_cash | disputed
  const dateFrom = searchParams.get("date_from");
  const dateTo = searchParams.get("date_to");
  const search = searchParams.get("search"); // ride id / rider or driver name (client-filtered below)

  try {
    let query = supabase
      .from("rides")
      .select(
        "id, rider_id, driver_id, final_fare, actual_fare, estimated_fare, cash_received, change_amount, " +
        "rider_credit_amount, cash_outstanding_amount, payment_status, settlement_status, cash_confirmed_at, " +
        "completed_at, created_at, rider:riders(user:users(full_name)), driver:drivers(user:users(full_name))",
        { count: "exact" }
      )
      .eq("payment_method", "cash")
      .not("payment_status", "is", null)
      .neq("payment_status", "pending")
      .order("created_at", { ascending: false });

    if (status) query = query.eq("payment_status", status);
    if (dateFrom) query = query.gte("created_at", dateFrom);
    if (dateTo) query = query.lte("created_at", dateTo);

    const from = (page - 1) * PAGE_SIZE;
    const { data, error, count } = await query.range(from, from + PAGE_SIZE - 1);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    let transactions = (data || []).map((r: Row) => {
      const fare = r.final_fare || r.actual_fare || r.estimated_fare || 0;
      return {
        ride_id: r.id,
        rider_name: r.rider?.user?.full_name || "N/A",
        driver_name: r.driver?.user?.full_name || "N/A",
        fare,
        cash_received: r.cash_received || 0,
        change_amount: r.change_amount || 0,
        rider_credit_amount: r.rider_credit_amount || 0,
        outstanding_amount: r.cash_outstanding_amount || 0,
        payment_status: r.payment_status,
        settlement_status: r.settlement_status,
        cash_confirmed_at: r.cash_confirmed_at,
        completed_at: r.completed_at,
      };
    });

    if (search) {
      const q = search.toLowerCase();
      transactions = transactions.filter(
        (t) =>
          t.ride_id.toLowerCase().includes(q) ||
          t.rider_name.toLowerCase().includes(q) ||
          t.driver_name.toLowerCase().includes(q)
      );
    }

    // Today's summary — separate unfiltered query so pagination/filters on
    // the table above don't skew the headline numbers.
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const { data: todayRows } = await supabase
      .from("rides")
      .select("cash_received, rider_credit_amount, payment_status, cash_outstanding_amount")
      .eq("payment_method", "cash")
      .not("payment_status", "is", null)
      .neq("payment_status", "pending")
      .gte("cash_confirmed_at", todayStart.toISOString());

    const { data: openDisputes } = await supabase
      .from("ride_disputes")
      .select("refund_amount")
      .eq("dispute_type", "payment")
      .neq("status", "resolved");

    const { data: driverWallets } = await supabase
      .from("driver_wallets")
      .select("commission_owed");

    const rows = todayRows || [];
    const summary = {
      cash_collected_today: rows.reduce((s: number, r: Row) => s + (r.cash_received || 0), 0),
      rider_credits_created_today: rows.reduce((s: number, r: Row) => s + (r.rider_credit_amount || 0), 0),
      pending_cash_today: rows
        .filter((r: Row) => r.payment_status === "partially_paid")
        .reduce((s: number, r: Row) => s + (r.cash_outstanding_amount || 0), 0),
      disputed_amount: (openDisputes || []).reduce((s: number, d: Row) => s + (d.refund_amount || 0), 0),
      outstanding_driver_fees: (driverWallets || []).reduce((s: number, w: Row) => s + (w.commission_owed || 0), 0),
    };

    return NextResponse.json({
      transactions,
      summary,
      pagination: { page, pageSize: PAGE_SIZE, totalCount: count || 0, totalPages: Math.ceil((count || 0) / PAGE_SIZE) },
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
