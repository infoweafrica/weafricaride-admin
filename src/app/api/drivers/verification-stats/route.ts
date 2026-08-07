import { NextResponse, type NextRequest } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { requireAdminSession } from "@/lib/admin-session-token";

export async function GET(request: NextRequest) {
  if (!requireAdminSession(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getServiceClient();

  try {
    const { count: verified } = await supabase
      .from("drivers")
      .select("*", { count: "exact", head: true })
      .eq("onboarding_status", "approved")
      .maybeSingle();
    const { count: pending } = await supabase
      .from("drivers")
      .select("*", { count: "exact", head: true })
      .in("onboarding_status", ["applied", "documents_submitted", "under_review", "interview", "vehicle_inspection"])
      .maybeSingle();
    const { count: rejected } = await supabase
      .from("drivers")
      .select("*", { count: "exact", head: true })
      .eq("onboarding_status", "rejected")
      .maybeSingle();

    return NextResponse.json({
      stats: { verified: verified || 0, pending: pending || 0, rejected: rejected || 0, expired: 0 },
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
