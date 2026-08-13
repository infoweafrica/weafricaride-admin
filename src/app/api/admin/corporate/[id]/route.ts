import { NextResponse, type NextRequest } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { requireAdminSession, sessionHasPermission } from "@/lib/admin-session-token";

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

  const { data, error } = await db.from("corporate_accounts").select("*").eq("id", id).single();
  if (error || !data) {
    return NextResponse.json({ error: error?.message || "Not found" }, { status: 404 });
  }

  return NextResponse.json({ data });
}

interface PatchBody {
  status?: "active" | "suspended";
  billing_method?: "corporate_wallet" | "monthly_invoice";
  daily_employee_limit?: number | null;
  monthly_account_limit?: number | null;
  credit_limit?: number | null;
  allowed_vehicle_classes?: string[] | null;
  /** Adds (or, if negative, removes) from wallet_balance — logged as a
   * corporate_wallet_transactions row, same append-only ledger the
   * per-ride debits in process_ride_payment() write to. */
  wallet_topup_amount?: number;
}

export async function PATCH(
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
  const body = (await request.json().catch(() => ({}))) as PatchBody;
  const db = getServiceClient();

  const { data: account, error: fetchErr } = await db
    .from("corporate_accounts")
    .select("*")
    .eq("id", id)
    .single();
  if (fetchErr || !account) {
    return NextResponse.json({ error: "Corporate account not found" }, { status: 404 });
  }

  const update: Record<string, unknown> = {};
  if (body.status) update.status = body.status;
  if (body.billing_method) update.billing_method = body.billing_method;
  if (body.daily_employee_limit !== undefined) update.daily_employee_limit = body.daily_employee_limit;
  if (body.monthly_account_limit !== undefined) update.monthly_account_limit = body.monthly_account_limit;
  if (body.credit_limit !== undefined) update.credit_limit = body.credit_limit;
  if (body.allowed_vehicle_classes !== undefined) update.allowed_vehicle_classes = body.allowed_vehicle_classes;

  if (body.wallet_topup_amount) {
    const balanceBefore = account.wallet_balance ?? 0;
    const balanceAfter = balanceBefore + body.wallet_topup_amount;
    update.wallet_balance = balanceAfter;

    const { error: ledgerErr } = await db.from("corporate_wallet_transactions").insert({
      corporate_account_id: id,
      transaction_type: body.wallet_topup_amount > 0 ? "admin_topup" : "admin_adjustment",
      amount: body.wallet_topup_amount,
      balance_before: balanceBefore,
      balance_after: balanceAfter,
    });
    if (ledgerErr) {
      return NextResponse.json({ error: ledgerErr.message }, { status: 500 });
    }
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }
  update.updated_at = new Date().toISOString();

  const { error } = await db.from("corporate_accounts").update(update).eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
