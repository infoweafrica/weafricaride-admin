// Sends a single FCM push via the HTTP v1 API, using a Firebase service
// account for auth (no external deps — signs the OAuth2 JWT assertion
// directly with Deno's Web Crypto API).
//
// Called from Postgres triggers (via pg_net) with a shared-secret header,
// not from the browser — there is no user-facing auth here, just the
// internal secret check below.
//
// Expected env vars (set via `supabase secrets set`):
//   FIREBASE_SERVICE_ACCOUNT_JSON — full service account JSON, one line
//   INTERNAL_PUSH_SECRET          — shared secret DB triggers must send
// Auto-injected by the Supabase platform:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

interface SendPushBody {
  delivery_log_id?: string;
  fcm_token: string;
  title: string;
  body: string;
  data?: Record<string, string>;
}

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
  token_uri: string;
}

function base64url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let str = "";
  for (const b of arr) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const b64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function getAccessToken(sa: ServiceAccount): Promise<string> {
  const header = { alg: "RS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: sa.token_uri,
    exp: now + 3600,
    iat: now,
  };

  const encoder = new TextEncoder();
  const headerB64 = base64url(encoder.encode(JSON.stringify(header)));
  const claimsB64 = base64url(encoder.encode(JSON.stringify(claims)));
  const signingInput = `${headerB64}.${claimsB64}`;

  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(sa.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    encoder.encode(signingInput)
  );
  const jwt = `${signingInput}.${base64url(signature)}`;

  const res = await fetch(sa.token_uri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!res.ok) {
    throw new Error(`Token exchange failed: ${res.status} ${await res.text()}`);
  }
  const json = await res.json();
  return json.access_token as string;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  const internalSecret = req.headers.get("x-internal-secret");
  if (!internalSecret || internalSecret !== Deno.env.get("INTERNAL_PUSH_SECRET")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  let payload: SendPushBody;
  try {
    payload = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), { status: 400 });
  }

  if (!payload.fcm_token || !payload.title || !payload.body) {
    return new Response(JSON.stringify({ error: "fcm_token, title, and body are required" }), { status: 400 });
  }

  const saJson = Deno.env.get("FIREBASE_SERVICE_ACCOUNT_JSON");
  if (!saJson) {
    return new Response(JSON.stringify({ error: "FIREBASE_SERVICE_ACCOUNT_JSON not configured" }), { status: 500 });
  }
  const sa: ServiceAccount = JSON.parse(saJson);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  const updateLog = async (status: "sent" | "failed", errorMessage?: string) => {
    if (!payload.delivery_log_id || !supabaseUrl || !serviceRoleKey) return;
    try {
      await fetch(`${supabaseUrl}/rest/v1/notification_delivery_logs?id=eq.${payload.delivery_log_id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
          Prefer: "return=minimal",
        },
        body: JSON.stringify(
          status === "sent"
            ? { status, delivered_at: new Date().toISOString() }
            : { status, error_message: errorMessage?.slice(0, 500) }
        ),
      });
    } catch (e) {
      console.error("Failed to update delivery log:", e);
    }
  };

  try {
    const accessToken = await getAccessToken(sa);

    const fcmRes = await fetch(
      `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          message: {
            token: payload.fcm_token,
            notification: { title: payload.title, body: payload.body },
            data: payload.data || {},
            android: { priority: "high" },
            apns: { headers: { "apns-priority": "10" } },
          },
        }),
      }
    );

    if (!fcmRes.ok) {
      const errText = await fcmRes.text();
      await updateLog("failed", errText);
      return new Response(JSON.stringify({ error: "FCM send failed", details: errText }), { status: 502 });
    }

    await updateLog("sent");
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await updateLog("failed", message);
    return new Response(JSON.stringify({ error: message }), { status: 500 });
  }
});
