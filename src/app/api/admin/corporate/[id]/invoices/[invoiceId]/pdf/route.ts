import { NextResponse, type NextRequest } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { requireAdminSession, sessionHasPermission } from "@/lib/admin-session-token";
import { generateCorporateInvoicePdf } from "@/lib/pdf/corporate-invoice-pdf";
import { fetchCorporateInvoicePdfData } from "@/lib/corporate-invoice-data";

// Regenerates the PDF on demand rather than storing it anywhere — same
// data the emailed copy was built from, just re-rendered fresh.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; invoiceId: string }> }
) {
  const session = requireAdminSession(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!sessionHasPermission(session, "manage_finance")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { invoiceId } = await params;
  const db = getServiceClient();

  const pdfData = await fetchCorporateInvoicePdfData(db, invoiceId);
  if (!pdfData) {
    return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  }

  const pdfBuffer = await generateCorporateInvoicePdf(pdfData);

  return new NextResponse(new Uint8Array(pdfBuffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="weafrica-invoice-${invoiceId.slice(0, 8)}.pdf"`,
    },
  });
}
