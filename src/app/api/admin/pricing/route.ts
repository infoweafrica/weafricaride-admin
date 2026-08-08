import { NextResponse, type NextRequest } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { requireAdminSession, sessionHasPermission } from "@/lib/admin-session-token";

// pricing_config's only RLS policy requires auth.uid() (real Supabase Auth),
// which this app never uses — so the anon-key client can never read or
// write it. All access goes through here (service role + session check).

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
    .from("pricing_config")
    .select("*")
    .order("country_code")
    .order("city")
    .order("vehicle_type")
    .limit(100);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data });
}
