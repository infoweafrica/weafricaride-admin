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

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return NextResponse.json(
      { error: "Google OAuth credentials are not configured" },
      { status: 500 }
    );
  }

  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const oauthError = searchParams.get("error");

  if (oauthError) {
    return NextResponse.json(
      { error: `Google OAuth error: ${oauthError}` },
      { status: 400 }
    );
  }

  const expectedState = request.cookies.get("youtube_oauth_state")?.value;
  const redirectUri =
    request.cookies.get("youtube_oauth_redirect_uri")?.value ||
    process.env.YOUTUBE_REDIRECT_URI;

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

  if (!redirectUri) {
    return NextResponse.json(
      { error: "YouTube redirect URI is not configured" },
      { status: 500 }
    );
  }

  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });

  const tokenResult = await tokenResponse.json();

  if (!tokenResponse.ok) {
    console.error("[YouTube OAuth token exchange]", tokenResult);

    return NextResponse.json(
      {
        error: "YouTube token exchange failed",
        details: tokenResult,
      },
      { status: 400 }
    );
  }

  const accessToken = tokenResult.access_token as string | undefined;
  const refreshToken = tokenResult.refresh_token as string | undefined;

  if (!accessToken) {
    return NextResponse.json(
      { error: "Google did not return an access token" },
      { status: 400 }
    );
  }

  const channelResponse = await fetch(
    "https://www.googleapis.com/youtube/v3/channels?part=snippet,contentDetails&mine=true",
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );

  const channelResult = await channelResponse.json();

  if (
    !channelResponse.ok ||
    !Array.isArray(channelResult.items) ||
    !channelResult.items.length
  ) {
    console.error("[YouTube channel lookup]", channelResult);

    return NextResponse.json(
      {
        error:
          "Unable to retrieve the connected YouTube channel. Make sure the Google account has a YouTube channel.",
        details: channelResult,
      },
      { status: 400 }
    );
  }

  const channel = channelResult.items[0];
  const channelId = channel.id as string;
  const channelTitle =
    channel.snippet?.title || "YouTube Channel";
  const customUrl =
    channel.snippet?.customUrl || null;

  const db = getServiceClient();

  const scopes = String(tokenResult.scope || "")
    .split(" ")
    .map((scope) => scope.trim())
    .filter(Boolean);

  const expiresAt = tokenResult.expires_in
    ? new Date(
        Date.now() + Number(tokenResult.expires_in) * 1000
      ).toISOString()
    : null;

  const { data: account, error: accountError } = await db
    .schema("marketing")
    .from("social_accounts")
    .upsert(
      {
        platform: "youtube",
        account_name: channelTitle,
        account_handle: customUrl,
        external_account_id: channelId,
        scopes,
        token_expires_at: expiresAt,
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
    console.error("[YouTube OAuth account save]", accountError);

    return NextResponse.json(
      {
        error:
          accountError?.message ||
          "Failed to save YouTube account",
      },
      { status: 500 }
    );
  }

  const { data: existingSecret } = await db
    .schema("marketing")
    .from("social_account_secrets")
    .select("refresh_token")
    .eq("account_id", account.id)
    .maybeSingle();

  const { error: secretError } = await db
    .schema("marketing")
    .from("social_account_secrets")
    .upsert(
      {
        account_id: account.id,
        access_token: accessToken,
        refresh_token:
          refreshToken ??
          existingSecret?.refresh_token ??
          null,
        token_type: tokenResult.token_type ?? "Bearer",
        expires_at: expiresAt,
      },
      {
        onConflict: "account_id",
      }
    );

  if (secretError) {
    console.error("[YouTube OAuth secret save]", secretError);

    return NextResponse.json(
      { error: "Failed to securely save YouTube credentials" },
      { status: 500 }
    );
  }

  const response = NextResponse.redirect(
    new URL("/admin/marketing/social-accounts", request.url)
  );

  response.cookies.delete("youtube_oauth_state");
  response.cookies.delete("youtube_oauth_redirect_uri");

  return response;
}
