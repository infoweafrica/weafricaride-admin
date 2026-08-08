import { NextResponse, type NextRequest } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { requireAdminSession, sessionHasPermission } from "@/lib/admin-session-token";

// commission_configs (per vehicle_class) is the real, current commission
// table — it has a public-read RLS policy, but writes require auth.uid()
// (never true for this app's custom-session model), so writes go through
// admin_update_commission_config via the service role, same as pricing.
// (commission_rules, which the old page used to query, has zero RLS
// policies and is unrelated/dead.)

export async function GET(request: NextRequest) {
  const session = requireAdminSession(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!sessionHasPermission(session, "manage_pricing")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const db = getServiceClient();
  const { data, error } = await db
    .from("commission_configs")
    .select("*")
    .order("vehicle_class")
    .limit(100);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data });
}
