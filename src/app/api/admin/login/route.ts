import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { signAdminSession, ADMIN_SESSION_COOKIE } from "@/lib/admin-session-token";
import { hashAdminPassword } from "@/lib/admin-password";
import type { Permission } from "@/lib/types";

async function fetchPermissionsForRole(
  roleName: string,
  db: ReturnType<typeof getServiceClient>
): Promise<Permission[]> {
  try {
    const { data: role } = await db
      .from("admin_roles")
      .select("id")
      .eq("name", roleName)
      .single();
    if (!role) return [];

    const { data: perms } = await db
      .from("role_permissions")
      .select("admin_permissions!inner(name)")
      .eq("role_id", (role as { id: string }).id);
    if (!perms || perms.length === 0) return [];

    return perms
      .map((p: any) => p.admin_permissions?.name ?? p.permission_name)
      .filter(Boolean) as Permission[];
  } catch {
    return [];
  }
}

export async function POST(request: Request) {
  try {
    const { email, password } = (await request.json()) as {
      email?: string;
      password?: string;
    };
    if (!email || !password) {
      return NextResponse.json(
        { error: "Email and password are required" },
        { status: 400 }
      );
    }

    const normalizedEmail = email.trim().toLowerCase();
    const passwordHash = hashAdminPassword(password);
    const db = getServiceClient();

    // Service-role client bypasses RLS entirely — this route is the only
    // place admin credentials are ever verified, and password_hash never
    // leaves this server-side code path.
    const { data, error } = await db
      .rpc("admin_verify_login", {
        p_email: normalizedEmail,
        p_password_hash: passwordHash,
      })
      .single();

    if (error || !data) {
      if (error) console.error("admin_verify_login RPC error:", error.message);
      return NextResponse.json(
        { error: "Invalid email or password" },
        { status: 401 }
      );
    }

    const admin = data as {
      id: string;
      email: string;
      display_name: string | null;
      role: string | null;
      role_id: string | null;
    };
    const roleName = admin.role || "analyst";
    const permissions = await fetchPermissionsForRole(roleName, db);

    const { token, session } = signAdminSession({
      id: admin.id,
      email: admin.email,
      display_name: admin.display_name || admin.email,
      role: roleName,
      role_id: admin.role_id || "",
      permissions,
    });

    const response = NextResponse.json({ session });
    response.cookies.set(ADMIN_SESSION_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      expires: new Date(session.expires_at),
    });
    return response;
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Sign in failed" },
      { status: 500 }
    );
  }
}
