import { NextResponse, type NextRequest } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { requireAdminSession, sessionHasPermission } from "@/lib/admin-session-token";
import { sendEmail } from "@/lib/email";

// No ambiguous characters (0/O, 1/I) — this gets read aloud/typed by hand.
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function generateInviteCode(): string {
  let code = "";
  for (let i = 0; i < 8; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return code;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = requireAdminSession(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!sessionHasPermission(session, "manage_finance")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const db = getServiceClient();

  const { data: members, error: membersErr } = await db
    .from("corporate_account_members")
    .select("*, rider:riders(user:users(full_name, phone, email))")
    .eq("corporate_account_id", id)
    .order("joined_at", { ascending: false });
  if (membersErr) {
    return NextResponse.json({ error: membersErr.message }, { status: 500 });
  }

  const { data: invitations, error: invitesErr } = await db
    .from("corporate_invitations")
    .select("id, email, role, invite_code, status, expires_at, created_at")
    .eq("corporate_account_id", id)
    .eq("status", "pending")
    .order("created_at", { ascending: false });
  if (invitesErr) {
    return NextResponse.json({ error: invitesErr.message }, { status: 500 });
  }

  return NextResponse.json({ members: members ?? [], pendingInvitations: invitations ?? [] });
}

interface InviteBody {
  email?: string;
  role?: "owner" | "admin" | "finance" | "employee";
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = requireAdminSession(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!sessionHasPermission(session, "manage_finance")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as InviteBody;
  const email = body.email?.trim().toLowerCase();
  const role = body.role ?? "employee";

  if (!email) {
    return NextResponse.json({ error: "Email is required" }, { status: 400 });
  }
  if (!["owner", "admin", "finance", "employee"].includes(role)) {
    return NextResponse.json({ error: "Invalid role" }, { status: 400 });
  }

  const db = getServiceClient();

  const { data: account, error: accountErr } = await db
    .from("corporate_accounts")
    .select("id, name")
    .eq("id", id)
    .single();
  if (accountErr || !account) {
    return NextResponse.json({ error: "Corporate account not found" }, { status: 404 });
  }

  // Re-inviting the same email refreshes the existing pending row rather
  // than creating a duplicate, same pattern as /api/admin/staff/invite.
  const { data: existingInvite } = await db
    .from("corporate_invitations")
    .select("id")
    .eq("corporate_account_id", id)
    .eq("email", email)
    .eq("status", "pending")
    .maybeSingle();

  let inviteCode = "";
  let insertError: { message: string; code?: string } | null = null;

  for (let attempt = 0; attempt < 5; attempt++) {
    inviteCode = generateInviteCode();
    const inviteFields = {
      corporate_account_id: id,
      email,
      role,
      invite_code: inviteCode,
      invited_by: session.id,
      status: "pending",
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    };

    const { error } = existingInvite
      ? await db.from("corporate_invitations").update(inviteFields).eq("id", existingInvite.id)
      : await db.from("corporate_invitations").insert(inviteFields);

    if (!error) {
      insertError = null;
      break;
    }
    // 23505 = unique_violation — retry with a freshly generated code.
    if (error.code !== "23505") {
      insertError = error;
      break;
    }
    insertError = error;
  }

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  const emailResult = await sendEmail({
    to: email,
    subject: `You've been invited to ride with ${account.name} on WeAfrica`,
    html: `
      <p>Hi,</p>
      <p>You've been added as <strong>${role}</strong> to <strong>${account.name}</strong>'s WeAfrica Ride corporate account.</p>
      <p>Open the WeAfrica Ride app, choose <strong>Company</strong> as your payment method, and enter this code to join:</p>
      <p style="font-size: 24px; font-weight: 700; letter-spacing: 4px;">${inviteCode}</p>
      <p>This code expires in 7 days.</p>
    `,
  });

  if (!emailResult.success) {
    return NextResponse.json(
      { error: `Invitation created but the email failed to send: ${emailResult.error}`, invite_code: inviteCode },
      { status: 502 }
    );
  }

  return NextResponse.json({ success: true, message: "Invitation sent!", invite_code: inviteCode });
}
