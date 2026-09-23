import { NextResponse, type NextRequest } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import {
  requireAdminSession,
  sessionHasPermission,
} from "@/lib/admin-session-token";

export async function GET(request: NextRequest) {
  const session = requireAdminSession(request);

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!sessionHasPermission(session, "manage_promotions")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const clientId = process.env.X_CLIENT_ID;
  const clientSecret = process.env.X_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return NextResponse.json(
      { error: "X OAuth credentials are not configured" },
      { status: 500 }
    );
  }

  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");
  const errorDescription = searchParams.get("error_description");

  if (error) {
    return NextResponse.json(
      {
        error,
        error_description: errorDescription,
      },
      { status: 400 }
    );
  }

  const expectedState = request.cookies.get("x_oauth_state")?.value;
  const codeVerifier =
    request.cookies.get("x_oauth_code_verifier")?.value;
  const redirectUri =
    request.cookies.get("x_oauth_redirect_uri")?.value;

  if (!code || !state) {
    return NextResponse.json(
      { error: "Missing OAuth code or state" },
      { status: 400 }
    );
  }

  if (!expectedState || state !== expectedState) {
    return NextResponse.json(
      { error: "Invalid OAuth state" },
      { status: 400 }
    );
  }

  if (!codeVerifier || !redirectUri) {
    return NextResponse.json(
      { error: "OAuth session expired. Please try again." },
      { status: 400 }
    );
  }

  const basicAuth = Buffer.from(
    `${clientId}:${clientSecret}`
  ).toString("base64");

  const tokenResponse = await fetch("https://api.x.com/2/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    }),
  });

  const tokenResult = await tokenResponse.json();

  if (!tokenResponse.ok) {
    console.error("[X OAuth token exchange]", tokenResult);

    return NextResponse.json(
      {
        error: "X token exchange failed",
        details: tokenResult,
      },
      { status: 400 }
    );
  }

  const accessToken = tokenResult.access_token as string | undefined;
  const refreshToken = tokenResult.refresh_token as string | undefined;

  if (!accessToken) {
    return NextResponse.json(
      { error: "X did not return an access token" },
      { status: 400 }
    );
  }

  const userResponse = await fetch(
    "https://api.x.com/2/users/me?user.fields=id,name,username,profile_image_url",
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );

  const userResult = await userResponse.json();

  if (!userResponse.ok || !userResult.data?.id) {
    console.error("[X OAuth user lookup]", userResult);

    return NextResponse.json(
      {
        error: "Unable to retrieve the connected X account",
        details: userResult,
      },
      { status: 400 }
    );
  }

  const xUser = userResult.data;
  const db = getServiceClient();

  const { data: account, error: accountError } = await db
    .schema("marketing")
    .from("social_accounts")
    .upsert(
      {
        platform: "x",
        account_name: xUser.name ?? null,
        account_handle: xUser.username
          ? `@${xUser.username}`
          : null,
        external_account_id: xUser.id,
        is_active: true,
        last_validated_at: new Date().toISOString(),
      },
      {
        onConflict: "platform,external_account_id",
      }
    )
    .select("id")
    .single();

  if (accountError || !account) {
    console.error("[X OAuth account save]", accountError);

    return NextResponse.json(
      { error: accountError?.message || "Failed to save X account" },
      { status: 500 }
    );
  }

  const secretPayload = {
    account_id: account.id,
    access_token: accessToken,
    refresh_token: refreshToken ?? null,
    token_type: tokenResult.token_type ?? "bearer",
    expires_at: tokenResult.expires_in
      ? new Date(
          Date.now() + Number(tokenResult.expires_in) * 1000
        ).toISOString()
      : null,
  };

  const { error: secretError } = await db
    .schema("marketing")
    .from("social_account_secrets")
    .upsert(secretPayload, {
      onConflict: "account_id",
    });

  if (secretError) {
    console.error("[X OAuth secret save]", secretError);

    return NextResponse.json(
      { error: "Failed to securely save X credentials" },
      { status: 500 }
    );
  }

  const response = NextResponse.redirect(
    new URL("/admin/marketing/social-accounts", request.url)
  );

  response.cookies.delete("x_oauth_state");
  response.cookies.delete("x_oauth_code_verifier");
  response.cookies.delete("x_oauth_redirect_uri");

  return response;
}
