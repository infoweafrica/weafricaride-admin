import { NextResponse, type NextRequest } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { requireAdminSession } from "@/lib/admin-session-token";

// Only fields the onboarding review screen is allowed to touch directly —
// approval-status transitions must go through the admin_approve_driver /
// admin_reject_driver RPCs instead, since those enforce the
// validate_driver_approval stage rules.
const UPDATABLE_FIELDS = new Set(["date_of_birth", "id_verified", "license_verified"]);

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!requireAdminSession(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = (await request.json()) as Record<string, unknown>;

  const update: Record<string, unknown> = {};
  for (const key of Object.keys(body)) {
    if (UPDATABLE_FIELDS.has(key)) update[key] = body[key];
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "No updatable fields provided" }, { status: 400 });
  }

  const supabase = getServiceClient();

  try {
    const { error } = await supabase.from("drivers").update(update).eq("id", id);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
