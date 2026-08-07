import { NextResponse, type NextRequest } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { requireAdminSession } from "@/lib/admin-session-token";

export async function GET(request: NextRequest) {
  if (!requireAdminSession(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getServiceClient();

  try {
    const { data, error } = await supabase
      .from("drivers")
      .select("id, total_earnings, user:users(full_name)")
      .order("total_earnings", { ascending: false })
      .limit(10);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ drivers: data || [] });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
