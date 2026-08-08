import { NextResponse, type NextRequest } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { requireAdminSession, sessionHasPermission } from "@/lib/admin-session-token";

interface PatchBody {
  /** 'active' or 'suspended' — mirrored into both status and is_active. */
  status?: "active" | "suspended";
  /** admin_roles.id — the target role to move this staff member to. */
  role_id?: string;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = requireAdminSession(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!sessionHasPermission(session, "manage_staff")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as PatchBody;
  const db = getServiceClient();

  const update: Record<string, unknown> = {};

  if (body.status === "active") {
    update.status = "active";
    update.is_active = true;
  } else if (body.status === "suspended") {
    update.status = "suspended";
    update.is_active = false;
  }

  if (body.role_id) {
    const { data: role, error: roleErr } = await db
      .from("admin_roles")
      .select("id, name")
      .eq("id", body.role_id)
      .single();
    if (roleErr || !role) {
      return NextResponse.json({ error: "Unknown role" }, { status: 400 });
    }
    update.role = (role as { name: string }).name;
    update.role_id = (role as { id: string }).id;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }
  update.updated_at = new Date().toISOString();

  const { error } = await db.from("admin_users").update(update).eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = requireAdminSession(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!sessionHasPermission(session, "manage_staff")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  if (id === session.id) {
    return NextResponse.json({ error: "You cannot delete your own account" }, { status: 400 });
  }

  const db = getServiceClient();
  const { error } = await db.from("admin_users").delete().eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
