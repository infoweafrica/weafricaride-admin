// Shared query used by both the invoice-generation email step and the
// on-demand "Download PDF" route — one place that knows how to assemble
// a corporate_invoices row + its corporate_invoice_items + the owning
// corporate_accounts row into the shape generateCorporateInvoicePdf() needs.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { CorporateInvoicePdfData } from "./pdf/corporate-invoice-pdf";

export async function fetchCorporateInvoicePdfData(
  db: SupabaseClient,
  invoiceId: string
): Promise<CorporateInvoicePdfData | null> {
  const { data: invoice, error: invoiceErr } = await db
    .from("corporate_invoices")
    .select("*, corporate_accounts(name, registration_number, billing_email, finance_email, address)")
    .eq("id", invoiceId)
    .single();
  if (invoiceErr || !invoice) return null;

  const { data: items, error: itemsErr } = await db
    .from("corporate_invoice_items")
    .select("ride_id, fare_amount, rides(completed_at, pickup_address, dropoff_address)")
    .eq("corporate_invoice_id", invoiceId);
  if (itemsErr) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const account = invoice.corporate_accounts as any;

  return {
    invoiceId: invoice.id,
    periodStart: invoice.period_start,
    periodEnd: invoice.period_end,
    status: invoice.status,
    totalAmount: invoice.total_amount,
    issuedAt: invoice.issued_at,
    companyName: account?.name ?? "Unknown company",
    registrationNumber: account?.registration_number,
    billingEmail: account?.billing_email ?? "",
    financeEmail: account?.finance_email,
    address: account?.address,
    items: (items ?? []).map((row) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ride = row.rides as any;
      return {
        rideId: row.ride_id,
        completedAt: ride?.completed_at ?? null,
        pickupAddress: ride?.pickup_address ?? null,
        dropoffAddress: ride?.dropoff_address ?? null,
        fareAmount: row.fare_amount,
      };
    }),
  };
}
