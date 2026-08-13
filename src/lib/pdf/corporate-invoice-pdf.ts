// Renders a corporate billing-period invoice as a PDF buffer. Server-only
// (pdfkit streams through Node's Buffer/stream APIs) — never import from a
// client component. Used both for the email attachment sent when an
// invoice is generated and for the admin "Download PDF" action, which
// regenerates on demand rather than storing the file anywhere.

import PDFDocument from "pdfkit";

export interface CorporateInvoiceLineItem {
  rideId: string;
  completedAt: string | null;
  pickupAddress: string | null;
  dropoffAddress: string | null;
  fareAmount: number;
}

export interface CorporateInvoicePdfData {
  invoiceId: string;
  periodStart: string;
  periodEnd: string;
  status: string;
  totalAmount: number;
  issuedAt: string | null;
  companyName: string;
  registrationNumber?: string | null;
  billingEmail: string;
  financeEmail?: string | null;
  address?: string | null;
  items: CorporateInvoiceLineItem[];
}

function formatMwk(n: number): string {
  return `MWK ${Math.round(n).toLocaleString("en-US")}`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", { year: "numeric", month: "short", day: "2-digit" });
}

export function generateCorporateInvoicePdf(data: CorporateInvoicePdfData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: "A4" });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // Header
    doc.fontSize(20).font("Helvetica-Bold").text("WeAfrica Ride", { continued: false });
    doc.fontSize(10).font("Helvetica").fillColor("#555").text("Corporate Invoice");
    doc.moveDown(1.5);

    // Invoice meta (right-aligned block)
    const metaTop = doc.y;
    doc.fontSize(9).fillColor("#000");
    doc.text(`Invoice: ${data.invoiceId.slice(0, 8).toUpperCase()}`, 350, metaTop, { width: 195, align: "right" });
    doc.text(`Issued: ${formatDate(data.issuedAt)}`, 350, doc.y, { width: 195, align: "right" });
    doc.text(`Period: ${formatDate(data.periodStart)} – ${formatDate(data.periodEnd)}`, 350, doc.y, { width: 195, align: "right" });
    doc.text(`Status: ${data.status.toUpperCase()}`, 350, doc.y, { width: 195, align: "right" });

    // Bill-to
    doc.fontSize(11).font("Helvetica-Bold").fillColor("#000").text("Bill To", 50, metaTop);
    doc.fontSize(10).font("Helvetica").text(data.companyName, 50, doc.y);
    if (data.registrationNumber) doc.text(`Reg. No: ${data.registrationNumber}`);
    if (data.address) doc.text(data.address);
    doc.text(data.billingEmail);
    if (data.financeEmail && data.financeEmail !== data.billingEmail) doc.text(data.financeEmail);

    doc.moveDown(2);

    // Line items table
    const tableTop = doc.y;
    const col = { date: 50, route: 130, ride: 380, fare: 470 };
    doc.font("Helvetica-Bold").fontSize(9);
    doc.text("Date", col.date, tableTop);
    doc.text("Route", col.route, tableTop);
    doc.text("Ride", col.ride, tableTop);
    doc.text("Fare", col.fare, tableTop, { width: 75, align: "right" });
    doc.moveTo(50, tableTop + 15).lineTo(545, tableTop + 15).strokeColor("#ccc").stroke();

    let y = tableTop + 22;
    doc.font("Helvetica").fontSize(9);
    for (const item of data.items) {
      if (y > 720) {
        doc.addPage();
        y = 50;
      }
      const route = [item.pickupAddress, item.dropoffAddress].filter(Boolean).join(" → ") || "—";
      doc.text(formatDate(item.completedAt), col.date, y, { width: 75 });
      doc.text(route.length > 45 ? route.slice(0, 42) + "..." : route, col.route, y, { width: 240 });
      doc.text(item.rideId.slice(0, 8), col.ride, y, { width: 80 });
      doc.text(formatMwk(item.fareAmount), col.fare, y, { width: 75, align: "right" });
      y += 18;
    }

    doc.moveTo(50, y + 4).lineTo(545, y + 4).strokeColor("#ccc").stroke();
    y += 14;
    doc.font("Helvetica-Bold").fontSize(11);
    doc.text("Total", col.ride, y, { width: 80 });
    doc.text(formatMwk(data.totalAmount), col.fare, y, { width: 75, align: "right" });

    doc.moveDown(3);
    doc.font("Helvetica").fontSize(8).fillColor("#888").text(
      `${data.items.length} trip${data.items.length === 1 ? "" : "s"} included in this billing period. Contact WeAfrica Ride finance for payment details.`,
      50,
      undefined,
      { width: 495 }
    );

    doc.end();
  });
}
