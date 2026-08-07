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
      .select("*, driver:drivers(user:users(full_name, phone))")
      .order("available_balance", { ascending: false })
      .limit(100);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    let wallets: Row[];
    if (walletData && walletData.length > 0) {
      wallets = walletData.map((w: Row) => {
        const driverObj = w.driver as Row | undefined;
        const userObj = driverObj?.user as Row | undefined;
        return {
          id: w.id,
          driver_id: w.driver_id,
          available_balance: w.available_balance || 0,
          pending_balance: w.pending_balance || 0,
          withdrawn_balance: w.withdrawn_balance || 0,
          cash_collected: w.cash_collected || 0,
          commission_owed: w.commission_owed || 0,
          currency: w.currency || "MWK",
          status: w.status || "active",
          driver_name: userObj?.full_name || driverObj?.full_name || "N/A",
          driver_phone: userObj?.phone || driverObj?.phone || "",
          updated_at: w.updated_at,
        };
      });
    } else {
      const { data: driverData, error: driverError } = await supabase
        .from("drivers")
        .select("id, available_balance, pending_balance, cash_collected, total_earnings, user:users(full_name, phone)")
        .limit(100);

      if (driverError) {
        return NextResponse.json({ error: driverError.message }, { status: 500 });
      }

      wallets = (driverData || []).map((d: Row) => {
        const userObj = d.user as Row | undefined;
        return {
          id: d.id,
          driver_id: d.id,
          available_balance: d.available_balance || 0,
          pending_balance: d.pending_balance || 0,
          withdrawn_balance: (d.total_earnings || 0) - (d.available_balance || 0) - (d.pending_balance || 0),
          cash_collected: d.cash_collected || 0,
          commission_owed: Math.round((d.total_earnings || 0) * 0.15),
          currency: "MWK",
          status: "active",
          driver_name: userObj?.full_name || "N/A",
          driver_phone: userObj?.phone || "",
          updated_at: new Date().toISOString(),
        };
      });
    }

    const summary = {
      available: wallets.reduce((s, w) => s + w.available_balance, 0),
      pending: wallets.reduce((s, w) => s + w.pending_balance, 0),
      withdrawn: wallets.reduce((s, w) => s + w.withdrawn_balance, 0),
      cash: wallets.reduce((s, w) => s + w.cash_collected, 0),
      commission: wallets.reduce((s, w) => s + w.commission_owed, 0),
    };

    return NextResponse.json({ wallets, summary });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
