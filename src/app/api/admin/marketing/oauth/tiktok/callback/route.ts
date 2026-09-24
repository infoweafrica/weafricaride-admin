// src/app/api/admin/marketing/oauth/tiktok/callback/route.ts
//
// Handles the TikTok OAuth redirect: exchanges the authorization code for
// access/refresh tokens, fetches the connected user's basic info, and saves
// both to Supabase (marketing.social_accounts / social_account_secrets).

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

  const clientKey = process.env.TIKTOK_CLIENT_KEY;
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET;

  if (!clientKey || !clientSecret) {
    return NextResponse.json(
      { error: "TikTok OAuth credentials are not configured" },
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
      { error, error_description: errorDescription },
      { status: 400 }
    );
  }

  const expectedState = request.cookies.get("tiktok_oauth_state")?.value;
  const codeVerifier = request.cookies.get("tiktok_oauth_code_verifier")?.value;
  const redirectUri = request.cookies.get("tiktok_oauth_redirect_uri")?.value;

  if (!code || !state) {
    return NextResponse.json(
      { error: "Missing OAuth code or state" },
      { status: 400 }
    );
  }

  if (!expectedState || state !== expectedState) {
    return NextResponse.json({ error: "Invalid OAuth state" }, { status: 400 });
  }

  if (!codeVerifier || !redirectUri) {
    return NextResponse.json(
      { error: "OAuth session expired. Please try again." },
      { status: 400 }
    );
  }

  const tokenResponse = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Cache-Control": "no-cache",
    },
    body: new URLSearchParams({
      client_key: clientKey,
      client_secret: clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    }),
  });

  const tokenResult = await tokenResponse.json();

  if (!tokenResponse.ok || tokenResult.error) {
    console.error("[TikTok OAuth token exchange]", tokenResult);

    return NextResponse.json(
      { error: "TikTok token exchange failed", details: tokenResult },
      { status: 400 }
    );
  }

  const accessToken = tokenResult.access_token as string | undefined;
  const refreshToken = tokenResult.refresh_token as string | undefined;
  const openId = tokenResult.open_id as string | undefined;

  if (!accessToken || !openId) {
    return NextResponse.json(
      { error: "TikTok did not return an access token" },
      { status: 400 }
    );
  }

  const userResponse = await fetch(
    "https://open.tiktokapis.com/v2/user/info/?fields=open_id,username,display_name,avatar_url",
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );

  const userResult = await userResponse.json();
  const tiktokUser = userResult?.data?.user;

  if (!userResponse.ok || !tiktokUser) {
    console.error("[TikTok user lookup]", userResult);

    return NextResponse.json(
      {
        error: "Unable to retrieve the connected TikTok account",
        details: userResult,
      },
      { status: 400 }
    );
  }

  const db = getServiceClient();

  const expiresAt = tokenResult.expires_in
    ? new Date(Date.now() + Number(tokenResult.expires_in) * 1000).toISOString()
    : null;

  const { data: account, error: accountError } = await db
    .schema("marketing")
    .from("social_accounts")
    .upsert(
      {
        platform: "tiktok",
        account_name: tiktokUser.display_name ?? null,
        account_handle: tiktokUser.username ? `@${tiktokUser.username}` : null,
        external_account_id: openId,
        token_expires_at: expiresAt,
        is_active: true,
        last_validated_at: new Date().toISOString(),
      },
      { onConflict: "platform,external_account_id" }
    )
    .select("id")
    .single();

  if (accountError || !account) {
    console.error("[TikTok OAuth account save]", accountError);

    return NextResponse.json(
      { error: accountError?.message || "Failed to save TikTok account" },
      { status: 500 }
    );
  }

  const { error: secretError } = await db
    .schema("marketing")
    .from("social_account_secrets")
    .upsert(
      {
        account_id: account.id,
        access_token: accessToken,
        refresh_token: refreshToken ?? null,
        token_type: tokenResult.token_type ?? "Bearer",
        expires_at: expiresAt,
      },
      { onConflict: "account_id" }
    );

  if (secretError) {
    console.error("[TikTok OAuth secret save]", secretError);

    return NextResponse.json(
      { error: "Failed to securely save TikTok credentials" },
      { status: 500 }
    );
  }

  const response = NextResponse.redirect(
    new URL("/admin/marketing/social-accounts", request.url)
  );

  response.cookies.delete("tiktok_oauth_state");
  response.cookies.delete("tiktok_oauth_code_verifier");
  response.cookies.delete("tiktok_oauth_redirect_uri");

  return response;
}
