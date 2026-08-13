import { NextResponse, type NextRequest } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { requireAdminSession, sessionHasPermission } from "@/lib/admin-session-token";

interface PatchBody {
  status?: "active" | "suspended";
  role?: "owner" | "admin" | "finance" | "employee";
  daily_limit_override?: number | null;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; memberId: string }> }
) {
  const session = requireAdminSession(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!sessionHasPermission(session, "manage_finance")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id, memberId } = await params;
  const body = (await request.json().catch(() => ({}))) as PatchBody;
  const db = getServiceClient();

  const update: Record<string, unknown> = {};
  if (body.status) update.status = body.status;
  if (body.role) update.role = body.role;
  if (body.daily_limit_override !== undefined) update.daily_limit_override = body.daily_limit_override;

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const { error } = await db
    .from("corporate_account_members")
    .update(update)
    .eq("id", memberId)
    .eq("corporate_account_id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
