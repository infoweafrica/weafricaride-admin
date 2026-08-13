import { NextResponse, type NextRequest } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { requireAdminSession, sessionHasPermission } from "@/lib/admin-session-token";
import { sendEmail } from "@/lib/email";

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

  const { data, error } = await db
    .from("corporate_invoices")
    .select("*")
    .eq("corporate_account_id", id)
    .order("created_at", { ascending: false });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data: data ?? [] });
}

interface GenerateBody {
  period_start?: string;
  period_end?: string;
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
  const body = (await request.json().catch(() => ({}))) as GenerateBody;
  if (!body.period_start || !body.period_end) {
    return NextResponse.json({ error: "period_start and period_end are required" }, { status: 400 });
  }

  const db = getServiceClient();

  const { data: account } = await db
    .from("corporate_accounts")
    .select("name, finance_email, billing_email")
    .eq("id", id)
    .single();

  // generate_corporate_invoice is service_role-only (revoked from anon/
  // authenticated) — the service client can call it because it connects
  // with the service-role key, bypassing that grant restriction entirely,
  // same as it bypasses RLS on every table above.
  const { data: result, error } = await db.rpc("generate_corporate_invoice", {
    p_corporate_account_id: id,
    p_period_start: body.period_start,
    p_period_end: body.period_end,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const toEmail = account?.finance_email || account?.billing_email;
  if (toEmail && result?.ride_count > 0) {
    await sendEmail({
      to: toEmail,
      subject: `WeAfrica Ride — Corporate invoice for ${account?.name ?? "your account"}`,
      html: `
        <p>Hi,</p>
        <p>Your WeAfrica Ride corporate invoice for ${body.period_start} to ${body.period_end} is ready.</p>
        <p><strong>${result.ride_count}</strong> trips, total <strong>MWK ${Number(result.total_amount).toLocaleString()}</strong>.</p>
        <p>Contact WeAfrica Ride finance for payment details.</p>
      `,
    });
  }

  return NextResponse.json({ success: true, ...result });
}
