import { NextResponse, type NextRequest } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { requireAdminSession, sessionHasPermission } from "@/lib/admin-session-token";

// Fields the RPC accepts — mirrors admin_update_pricing_config's parameters.
const EDITABLE_FIELDS = [
  "base_fare",
  "minimum_fare",
  "max_fare_cap",
  "per_km",
  "per_min",
  "booking_fee",
  "waiting_fee",
  "cancellation_fee",
  "free_waiting_minutes",
  "night_multiplier",
  "night_start_time",
  "night_end_time",
  "tax_enabled",
  "tax_percent",
  "tax_name",
  "commission_percent",
  "currency",
  "is_active",
] as const;

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = requireAdminSession(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!sessionHasPermission(session, "manage_pricing")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  const rpcArgs: Record<string, unknown> = { p_config_id: id };
  for (const field of EDITABLE_FIELDS) {
    if (body[field] !== undefined) {
      rpcArgs[`p_${field}`] = body[field];
    }
  }

  const db = getServiceClient();
  const { data, error } = await db.rpc("admin_update_pricing_config", rpcArgs);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
