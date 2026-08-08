import { NextResponse, type NextRequest } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { hashAdminPassword } from "@/lib/admin-password";

interface InvitationRow {
  id: string;
  email: string;
  full_name: string;
  admin_role_id: string;
  status: string;
  expires_at: string;
  admin_roles: { name: string } | null;
}

async function loadValidInvitation(db: ReturnType<typeof getServiceClient>, token: string) {
  const { data, error } = await db
    .from("staff_invitations")
    .select("id, email, full_name, admin_role_id, status, expires_at, admin_roles(name)")
    .eq("invite_token", token)
    .maybeSingle();

  if (error || !data) return { invitation: null, reason: "Invitation not found" };

  const invitation = data as unknown as InvitationRow;
  if (invitation.status !== "pending") {
    return { invitation: null, reason: "This invitation has already been used" };
  }
  if (new Date(invitation.expires_at) < new Date()) {
    return { invitation: null, reason: "This invitation has expired" };
  }
  return { invitation, reason: null };
}

export async function GET(request: NextRequest) {
  const token = new URL(request.url).searchParams.get("token");
  if (!token) {
    return NextResponse.json({ error: "Missing token" }, { status: 400 });
  }

  const db = getServiceClient();
  const { invitation, reason } = await loadValidInvitation(db, token);
  if (!invitation) {
    return NextResponse.json({ error: reason }, { status: 404 });
  }

  return NextResponse.json({
    email: invitation.email,
    full_name: invitation.full_name,
    role_name: invitation.admin_roles?.name ?? null,
  });
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as { token?: string; password?: string };
  const token = body.token;
  const password = body.password;

  if (!token || !password || password.length < 8) {
    return NextResponse.json(
      { error: "A token and a password of at least 8 characters are required" },
      { status: 400 }
    );
  }

  const db = getServiceClient();
  const { invitation, reason } = await loadValidInvitation(db, token);
  if (!invitation) {
    return NextResponse.json({ error: reason }, { status: 404 });
  }

  const { data: newAdmin, error: insertErr } = await db
    .from("admin_users")
    .insert({
      email: invitation.email,
      display_name: invitation.full_name,
      role: invitation.admin_roles?.name ?? "analyst",
      role_id: invitation.admin_role_id,
      password_hash: hashAdminPassword(password),
      status: "active",
      is_active: true,
    })
    .select("id")
    .single();

  if (insertErr || !newAdmin) {
    return NextResponse.json(
      { error: insertErr?.message || "Failed to create staff account" },
      { status: 500 }
    );
  }

  await db
    .from("staff_invitations")
    .update({ status: "accepted", accepted_by: newAdmin.id, accepted_at: new Date().toISOString() })
    .eq("id", invitation.id);

  return NextResponse.json({ success: true });
}
