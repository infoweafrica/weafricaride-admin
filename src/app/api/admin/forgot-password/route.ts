import { NextResponse, type NextRequest } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { sendEmail } from "@/lib/email";

const GENERIC_MESSAGE = "If that email has a staff account, a reset link has been sent.";

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as { email?: string };
  const email = body.email?.trim().toLowerCase();
  if (!email) {
    return NextResponse.json({ error: "Email is required" }, { status: 400 });
  }

  const db = getServiceClient();

  // Never reveal whether the email exists — always return the same message.
  const { data: admin } = await db
    .from("admin_users")
    .select("id, display_name")
    .eq("email", email)
    .eq("is_active", true)
    .maybeSingle();

  if (admin) {
    const token = crypto.randomUUID();
    const { error: insertErr } = await db.from("admin_password_resets").insert({
      admin_id: admin.id,
      token,
      expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    if (!insertErr) {
      const resetUrl = `${new URL(request.url).origin}/reset-password?token=${token}`;
      await sendEmail({
        to: email,
        subject: "Reset your WeAfrica Ride staff password",
        html: `
          <p>Hi ${admin.display_name || ""},</p>
          <p>Someone requested a password reset for your WeAfrica Ride staff account. If this was you, click below:</p>
          <p><a href="${resetUrl}">Reset your password</a></p>
          <p>This link expires in 1 hour. If you didn't request this, you can ignore this email.</p>
        `,
      });
    }
  }

  return NextResponse.json({ success: true, message: GENERIC_MESSAGE });
}
