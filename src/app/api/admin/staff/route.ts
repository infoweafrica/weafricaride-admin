import { NextResponse, type NextRequest } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { requireAdminSession, sessionHasPermission } from "@/lib/admin-session-token";
import type { AdminUser } from "@/lib/types";

// admin_users has no anon/authenticated RLS policies (see
// 20260716000200_tighten_anon_financial_rls.sql) — all staff CRUD goes
// through this service-role route, gated on the caller's own session.

export async function GET(request: NextRequest) {
  const session = requireAdminSession(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!sessionHasPermission(session, "manage_staff")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get("pageSize") || "100", 10)));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const db = getServiceClient();

  const { count: totalCount, error: countErr } = await db
    .from("admin_users")
    .select("*", { count: "exact", head: true });

  if (countErr) {
    return NextResponse.json({ error: countErr.message }, { status: 500 });
  }

  const { data, error } = await db
    .from("admin_users")
    .select("*")
    .order("created_at", { ascending: false })
    .range(from, to);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const arr = (data as AdminUser[]) ?? [];
  const total = totalCount ?? 0;

  return NextResponse.json({
    data: arr,
    page,
    pageSize,
    totalCount: total,
    totalPages: Math.ceil(total / pageSize),
  });
}
