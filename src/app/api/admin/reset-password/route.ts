import { NextResponse, type NextRequest } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { hashAdminPassword } from "@/lib/admin-password";

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

  const { data: reset, error: resetErr } = await db
    .from("admin_password_resets")
    .select("id, admin_id, expires_at, used_at")
    .eq("token", token)
    .maybeSingle();

  if (resetErr || !reset) {
    return NextResponse.json({ error: "Invalid or expired reset link" }, { status: 404 });
  }
  if (reset.used_at) {
    return NextResponse.json({ error: "This reset link has already been used" }, { status: 400 });
  }
  if (new Date(reset.expires_at) < new Date()) {
    return NextResponse.json({ error: "This reset link has expired" }, { status: 400 });
  }

  const { error: updateErr } = await db
    .from("admin_users")
    .update({ password_hash: hashAdminPassword(password), updated_at: new Date().toISOString() })
    .eq("id", reset.admin_id);

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  await db
    .from("admin_password_resets")
    .update({ used_at: new Date().toISOString() })
    .eq("id", reset.id);

  return NextResponse.json({ success: true });
}
