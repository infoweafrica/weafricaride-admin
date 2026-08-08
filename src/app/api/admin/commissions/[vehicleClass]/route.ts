import { NextResponse, type NextRequest } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { requireAdminSession, sessionHasPermission } from "@/lib/admin-session-token";

const EDITABLE_FIELDS = [
  "commission_percent",
  "min_commission",
  "max_commission",
  "is_active",
  "notes",
] as const;

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ vehicleClass: string }> }
) {
  const session = requireAdminSession(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!sessionHasPermission(session, "manage_pricing")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { vehicleClass } = await params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  const rpcArgs: Record<string, unknown> = { p_vehicle_class: vehicleClass };
  for (const field of EDITABLE_FIELDS) {
    if (body[field] !== undefined) {
      rpcArgs[`p_${field}`] = body[field];
    }
  }

  const db = getServiceClient();
  const { data, error } = await db.rpc("admin_update_commission_config", rpcArgs);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // The RPC doesn't stamp who made the change — do it here since the
  // column exists specifically for this (commission_configs.updated_by).
  await db
    .from("commission_configs")
    .update({ updated_by: session.id })
    .eq("vehicle_class", vehicleClass);

  return NextResponse.json(data);
}
