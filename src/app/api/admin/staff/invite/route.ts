import { NextResponse, type NextRequest } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { requireAdminSession, sessionHasPermission } from "@/lib/admin-session-token";
import { sendEmail } from "@/lib/email";

interface InviteBody {
  email?: string;
  full_name?: string;
  role_id?: string;
}

export async function POST(request: NextRequest) {
  const session = requireAdminSession(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!sessionHasPermission(session, "manage_staff")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as InviteBody;
  const email = body.email?.trim().toLowerCase();
  const fullName = body.full_name?.trim();
  const roleId = body.role_id;

  if (!email || !fullName || !roleId) {
    return NextResponse.json({ error: "Email, full name, and role are required" }, { status: 400 });
  }

  const db = getServiceClient();

  const { data: role, error: roleErr } = await db
    .from("admin_roles")
    .select("id, name")
    .eq("id", roleId)
    .single();
  if (roleErr || !role) {
    return NextResponse.json({ error: "Unknown role" }, { status: 400 });
  }

  const { data: existingAdmin } = await db
    .from("admin_users")
    .select("id")
    .eq("email", email)
    .maybeSingle();
  if (existingAdmin) {
    return NextResponse.json({ error: "That email already has a staff account" }, { status: 409 });
  }

  // Re-inviting the same email refreshes the existing row rather than
  // creating a duplicate (email has no unique constraint at the DB level,
  // so this is a manual check-then-write instead of an upsert).
  const inviteToken = crypto.randomUUID();
  const inviteFields = {
    email,
    full_name: fullName,
    admin_role_id: roleId,
    invited_by: session.id,
    status: "pending",
    invite_token: inviteToken,
    expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    accepted_by: null,
    accepted_at: null,
  };

  const { data: existingInvite } = await db
    .from("staff_invitations")
    .select("id")
    .eq("email", email)
    .maybeSingle();

  const { error: inviteErr } = existingInvite
    ? await db.from("staff_invitations").update(inviteFields).eq("id", existingInvite.id)
    : await db.from("staff_invitations").insert(inviteFields);

  if (inviteErr) {
    return NextResponse.json({ error: inviteErr.message }, { status: 500 });
  }

  const acceptUrl = `${new URL(request.url).origin}/accept-invitation?token=${inviteToken}`;

  const emailResult = await sendEmail({
    to: email,
    subject: "You've been invited to the WeAfrica Ride Staff Portal",
    html: `
      <p>Hi ${fullName},</p>
      <p>You've been invited to join the WeAfrica Ride Staff Portal as <strong>${(role as { name: string }).name.replace(/_/g, " ")}</strong>.</p>
      <p><a href="${acceptUrl}">Accept your invitation</a> to set your password and activate your account.</p>
      <p>This link expires in 7 days.</p>
    `,
  });

  if (!emailResult.success) {
    return NextResponse.json(
      { error: `Invitation created but the email failed to send: ${emailResult.error}` },
      { status: 502 }
    );
  }

  return NextResponse.json({ success: true, message: "Invitation sent!" });
}
