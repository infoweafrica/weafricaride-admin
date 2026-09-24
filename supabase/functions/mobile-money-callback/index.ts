// PayChangu webhook: called by PayChangu's servers when a checkout
// (currently: wallet top-ups from paychangu-initiate) reaches a final
// state. The webhook body itself is never trusted for the pay/no-pay
// decision -- anyone can POST to this URL, so the only thing taken from
// the body is tx_ref, which is then used to independently ask PayChangu
// "did this transaction actually succeed?" via their verify endpoint
// using our secret key. Only that server-to-server answer can credit a
// wallet.
//
// credit_wallet is idempotent on p_idempotency_key (set to tx_ref
// here), so a webhook retry -- or an attacker replaying a captured
// payload -- can never double-credit the same transaction.
//
// Expected env vars (set via `supabase secrets set`):
//   PAYCHANGU_SECRET_KEY — PayChangu API secret key
// Auto-injected by the Supabase platform:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

const PAYCHANGU_BASE_URL = "https://api.paychangu.com";

function extractTxRefFromBody(body: Record<string, unknown>): string | null {
  const direct = body["tx_ref"];
  if (typeof direct === "string" && direct) return direct;
  const data = body["data"];
  if (data && typeof data === "object") {
    const nested = (data as Record<string, unknown>)["tx_ref"];
    if (typeof nested === "string" && nested) return nested;
  }
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  // Primary source: paychangu-initiate puts tx_ref on the callback_url's
  // query string itself, so it's known for certain regardless of what
  // shape PayChangu's webhook body turns out to be. Body parsing is only
  // a fallback for calls that don't carry it that way.
  const url = new URL(req.url);
  let txRef = url.searchParams.get("tx_ref");

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    // Malformed/empty body is fine as long as tx_ref came from the URL.
  }

  txRef = txRef || extractTxRefFromBody(body);
  if (!txRef) {
    return new Response(JSON.stringify({ ok: true, note: "no tx_ref in request" }), { status: 200 });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const paychanguSecretKey = Deno.env.get("PAYCHANGU_SECRET_KEY");
  if (!supabaseUrl || !serviceRoleKey || !paychanguSecretKey) {
    return new Response(JSON.stringify({ error: "Server not configured" }), { status: 500 });
  }

  const restHeaders = {
    "Content-Type": "application/json",
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
  };

  try {
    const intentRes = await fetch(
      `${supabaseUrl}/rest/v1/paychangu_topup_intents?tx_ref=eq.${encodeURIComponent(txRef)}&select=*`,
      { headers: restHeaders }
    );
    const intents = await intentRes.json();
    const intent = Array.isArray(intents) ? intents[0] : null;
    if (!intent) {
      // Not one of ours (or already deleted) -- ack and stop.
      return new Response(JSON.stringify({ ok: true, note: "unknown tx_ref" }), { status: 200 });
    }
    if (intent.status === "completed") {
      // Already processed -- ack without re-crediting.
      return new Response(JSON.stringify({ ok: true, note: "already completed" }), { status: 200 });
    }

    // Independent server-to-server confirmation -- the whole point of
    // this function. Never trust req body's own status field. Per
    // PayChangu's docs, response shape is { status, message, data: {
    // tx_ref, status, amount, currency, ... } } -- single-level data,
    // not nested twice like the checkout-initiation response is.
    const verifyRes = await fetch(`${PAYCHANGU_BASE_URL}/verify-payment/${encodeURIComponent(txRef)}`, {
      headers: { Accept: "application/json", Authorization: `Bearer ${paychanguSecretKey}` },
    });
    const verifyData = await verifyRes.json();

    if (verifyData.status !== "success" || verifyData.data?.status !== "success") {
      // Payment not actually confirmed successful -- do not credit.
      await fetch(
        `${supabaseUrl}/rest/v1/paychangu_topup_intents?tx_ref=eq.${encodeURIComponent(txRef)}`,
        { method: "PATCH", headers: { ...restHeaders, Prefer: "return=minimal" }, body: JSON.stringify({ status: "failed" }) }
      );
      return new Response(JSON.stringify({ ok: true, note: "payment not verified successful" }), { status: 200 });
    }

    // Defense against a tampered/replayed amount: only credit what
    // PayChangu itself confirms was paid, and only if it matches what
    // we asked for.
    const verifiedAmount = Number(verifyData.data.amount);
    if (!verifiedAmount || Math.abs(verifiedAmount - Number(intent.amount)) > 0.01) {
      return new Response(JSON.stringify({ ok: true, note: "amount mismatch, not credited" }), { status: 200 });
    }

    const creditRes = await fetch(`${supabaseUrl}/rest/v1/rpc/credit_wallet`, {
      method: "POST",
      headers: restHeaders,
      body: JSON.stringify({
        p_wallet_id: intent.wallet_id,
        p_amount: verifiedAmount,
        p_type: "credit",
        p_description: "PayChangu top-up",
        p_reference: txRef,
        p_idempotency_key: txRef,
      }),
    });
    const creditData = await creditRes.json();
    if (creditData?.success !== true) {
      return new Response(JSON.stringify({ error: "credit_wallet failed", details: creditData }), { status: 502 });
    }

    await fetch(
      `${supabaseUrl}/rest/v1/paychangu_topup_intents?tx_ref=eq.${encodeURIComponent(txRef)}`,
      {
        method: "PATCH",
        headers: { ...restHeaders, Prefer: "return=minimal" },
        body: JSON.stringify({ status: "completed", completed_at: new Date().toISOString() }),
      }
    );

    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: message }), { status: 500 });
  }
});
