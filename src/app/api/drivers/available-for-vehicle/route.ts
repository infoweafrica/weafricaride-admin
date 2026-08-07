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
    const { data, error } = await supabase
      .from("drivers")
      .select("id, user:users(full_name), vehicle:vehicles(plate_number)")
      .eq("is_approved", true);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const drivers = (data || []).map((d: Row) => ({
      id: d.id,
      full_name: d.user?.full_name || "Unknown",
      plate_number: d.vehicle?.plate_number || undefined,
    }));

    return NextResponse.json({ drivers });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
