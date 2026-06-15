// PayChangu API Client — Malawi Payment Gateway
// Supports Airtel Money, TNM Mpamba, Visa, Mastercard
// Secret key operations require server-side context (API routes / Edge functions)
// Public operations (checkout redirect, tx ref generation) are safe for client use

const PAYCHANGU_BASE_URL = "https://api.paychangu.com";
const PAYCHANGU_PUBLIC_KEY = process.env.NEXT_PUBLIC_PAYCHANGU_PUBLIC_KEY || "";
const PAYCHANGU_SECRET_KEY = process.env.PAYCHANGU_SECRET_KEY || "";

interface PayChanguCheckoutRequest {
  amount: number;
  currency: string;
  email: string;
  first_name: string;
  last_name: string;
  tx_ref: string;
  callback_url: string;
  return_url: string;
  customization?: {
    title: string;
    description: string;
  };
}

interface PayChanguCheckoutResponse {
  status: string;
  message: string;
  data?: {
    checkout_url: string;
    tx_ref: string;
  };
}

interface PayChanguVerifyResponse {
  status: string;
  message: string;
  data?: {
    tx_ref: string;
    amount: number;
    currency: string;
    status: string;
    payment_method: string;
    created_at: string;
  };
}

// ─── Initiate Checkout ────────────────────────────────
export async function initiatePayChanguCheckout(
  params: PayChanguCheckoutRequest
): Promise<{ success: boolean; checkoutUrl?: string; txRef?: string; error?: string }> {
  try {
    const response = await fetch(`${PAYCHANGU_BASE_URL}/v1/checkout`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${PAYCHANGU_SECRET_KEY}`,
      },
      body: JSON.stringify({
        amount: params.amount,
        currency: params.currency || "MWK",
        email: params.email,
        first_name: params.first_name,
        last_name: params.last_name,
        tx_ref: params.tx_ref,
        callback_url: params.callback_url,
        return_url: params.return_url || params.callback_url,
        customization: params.customization || {
          title: "WeAfrica Ride",
          description: "Ride payment",
        },
      }),
    });

    const data: PayChanguCheckoutResponse = await response.json();

    if (data.status === "success" && data.data?.checkout_url) {
      return {
        success: true,
        checkoutUrl: data.data.checkout_url,
        txRef: data.data.tx_ref,
      };
    }

    return { success: false, error: data.message || "Checkout initiation failed" };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

// ─── Verify Transaction ───────────────────────────────
export async function verifyPayChanguTransaction(
  txRef: string
): Promise<{ success: boolean; status?: string; amount?: number; paymentMethod?: string; error?: string }> {
  try {
    const response = await fetch(`${PAYCHANGU_BASE_URL}/v1/transactions/${txRef}/verify`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${PAYCHANGU_SECRET_KEY}`,
      },
    });

    const data: PayChanguVerifyResponse = await response.json();

    if (data.status === "success" && data.data) {
      return {
        success: true,
        status: data.data.status,
        amount: data.data.amount,
        paymentMethod: data.data.payment_method,
      };
    }

    return { success: false, error: data.message || "Verification failed" };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

// ─── Direct Mobile Money Collection ───────────────────
export async function collectMobileMoney(
  phone: string,
  amount: number,
  provider: "airtel" | "tnm",
  txRef: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await fetch(`${PAYCHANGU_BASE_URL}/v1/collection`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${PAYCHANGU_SECRET_KEY}`,
      },
      body: JSON.stringify({
        amount,
        currency: "MWK",
        phone,
        provider,
        tx_ref: txRef,
      }),
    });

    const data = await response.json();

    if (data.status === "success") {
      return { success: true };
    }

    return { success: false, error: data.message || "Collection failed" };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

// ─── Generate TX Reference ────────────────────────────
export function generateTxRef(): string {
  return `WEA-${Date.now()}-${Math.random().toString(36).substring(2, 9).toUpperCase()}`;
}

// ─── Get Public Key (for frontend checkout widgets) ───
export function getPayChanguPublicKey(): string {
  return PAYCHANGU_PUBLIC_KEY;
}