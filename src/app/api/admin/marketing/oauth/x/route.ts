import { NextResponse, type NextRequest } from "next/server";
import crypto from "node:crypto";
import {
  requireAdminSession,
  sessionHasPermission,
} from "@/lib/admin-session-token";

function base64Url(buffer: Buffer) {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export async function GET(request: NextRequest) {
  const session = requireAdminSession(request);

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!sessionHasPermission(session, "manage_promotions")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const clientId = process.env.X_CLIENT_ID;

  if (!clientId) {
    return NextResponse.json(
      { error: "X_CLIENT_ID is not configured" },
      { status: 500 }
    );
  }

  const redirectUri =
    process.env.X_REDIRECT_URI ||
    `${new URL(request.url).origin}/api/admin/marketing/oauth/x/callback`;

  const state = base64Url(crypto.randomBytes(32));
  const codeVerifier = base64Url(crypto.randomBytes(32));

  const challenge = base64Url(
    crypto.createHash("sha256").update(codeVerifier).digest()
  );

  const authorizationUrl = new URL(
    "https://x.com/i/oauth2/authorize"
  );

  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("client_id", clientId);
  authorizationUrl.searchParams.set("redirect_uri", redirectUri);
  authorizationUrl.searchParams.set(
    "scope",
    "tweet.read tweet.write users.read media.write offline.access"
  );
  authorizationUrl.searchParams.set("state", state);
  authorizationUrl.searchParams.set("code_challenge", challenge);
  authorizationUrl.searchParams.set("code_challenge_method", "S256");

  const response = NextResponse.redirect(authorizationUrl);

  response.cookies.set("x_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });

  response.cookies.set("x_oauth_code_verifier", codeVerifier, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });

  response.cookies.set("x_oauth_redirect_uri", redirectUri, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });

  return response;
}
