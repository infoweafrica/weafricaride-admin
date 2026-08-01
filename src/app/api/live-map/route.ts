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

    return NextResponse.json({ drivers: locations || [], count: locations?.length ?? 0 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
