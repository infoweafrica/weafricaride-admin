import { NextResponse, type NextRequest } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { requireAdminSession, sessionHasPermission } from "@/lib/admin-session-token";
import type { CorporateAccount } from "@/lib/types";

// corporate_accounts has no anon/authenticated RLS policies (same posture
// as admin_users) — all CRUD goes through this service-role route, gated
// on the caller's own session, same pattern as /api/admin/staff.

export async function GET(request: NextRequest) {
  const session = requireAdminSession(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!sessionHasPermission(session, "manage_finance")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get("pageSize") || "50", 10)));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const db = getServiceClient();

  const { count: totalCount, error: countErr } = await db
    .from("corporate_accounts")
    .select("*", { count: "exact", head: true });

  if (countErr) {
    return NextResponse.json({ error: countErr.message }, { status: 500 });
  }

  const { data, error } = await db
    .from("corporate_accounts")
    .select("*")
    .order("created_at", { ascending: false })
    .range(from, to);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const total = totalCount ?? 0;

  return NextResponse.json({
    data: (data as CorporateAccount[]) ?? [],
    page,
    pageSize,
    totalCount: total,
    totalPages: Math.ceil(total / pageSize),
  });
}

interface CreateBody {
  name?: string;
  billing_email?: string;
  finance_email?: string;
  phone?: string;
  address?: string;
  registration_number?: string;
  billing_method?: "corporate_wallet" | "monthly_invoice";
  daily_employee_limit?: number;
  monthly_account_limit?: number;
  credit_limit?: number;
}

export async function POST(request: NextRequest) {
  const session = requireAdminSession(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!sessionHasPermission(session, "manage_finance")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as CreateBody;
  const name = body.name?.trim();
  const billingEmail = body.billing_email?.trim().toLowerCase();
  const billingMethod = body.billing_method ?? "monthly_invoice";

  if (!name || !billingEmail) {
    return NextResponse.json({ error: "Company name and billing email are required" }, { status: 400 });
  }
  if (!["corporate_wallet", "monthly_invoice"].includes(billingMethod)) {
    return NextResponse.json({ error: "Invalid billing method" }, { status: 400 });
  }

  const db = getServiceClient();
  const { data, error } = await db
    .from("corporate_accounts")
    .insert({
      name,
      billing_email: billingEmail,
      finance_email: body.finance_email?.trim().toLowerCase() || null,
      phone: body.phone?.trim() || null,
      address: body.address?.trim() || null,
      registration_number: body.registration_number?.trim() || null,
      billing_method: billingMethod,
      daily_employee_limit: body.daily_employee_limit ?? null,
      monthly_account_limit: body.monthly_account_limit ?? null,
      credit_limit: body.credit_limit ?? null,
    })
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, data });
}
