import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { invoices, invoiceItems, parents, orders } from "@/db/schema";
import { getCurrentUser } from "@/server/session";
import { canSeePage } from "@/lib/admin-permissions";

export const dynamic = "force-dynamic";

export default async function InvoicePrintPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const me = await getCurrentUser();
  if (me?.kind !== "admin") notFound();
  // This page sits OUTSIDE the (protected) group, so neither that layout nor
  // the per-section gate covers it — it needs its own check, or a customer
  // invoice is readable by any signed-in staff account.
  if (!canSeePage(me.permissions, "invoices")) notFound();
  const { id } = await params;

  const [inv] = await db.select().from(invoices).where(eq(invoices.id, id)).limit(1);
  if (!inv) notFound();
  const [parent] = await db.select().from(parents).where(eq(parents.id, inv.parentId)).limit(1);
  const [ord] = await db.select().from(orders).where(eq(orders.id, inv.orderId)).limit(1);
  const items = await db
    .select()
    .from(invoiceItems)
    .where(eq(invoiceItems.invoiceId, id));

  const fmt = (paise: number) => `₹${(paise / 100).toFixed(2)}`;
  const billing = inv.billingAddress as Record<string, unknown>;

  return (
    // The root layout already renders <html>/<body>; a second pair here is
    // invalid nesting and made every visit fail hydration. Styles are scoped
    // to .invoice so they no longer leak onto the root <body>.
    <div className="invoice">
      <title>{`Invoice ${inv.invoiceNumber}`}</title>
      <style>{`
        body { background: #fff; }
        .invoice { font-family: 'Helvetica', Arial, sans-serif; color: #111; padding: 40px; max-width: 800px; margin: 0 auto; font-size: 13px; }
        .invoice * { box-sizing: border-box; }
        .invoice h1 { font-size: 28px; margin: 0 0 4px; }
        .invoice .header { display: flex; justify-content: space-between; border-bottom: 2px solid #111; padding-bottom: 16px; margin-bottom: 24px; }
        .invoice .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-bottom: 24px; }
        .invoice .meta h3 { margin: 0 0 6px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; color: #555; }
        .invoice table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
        .invoice th, .invoice td { padding: 8px 6px; border-bottom: 1px solid #ddd; text-align: left; vertical-align: top; }
        .invoice th { font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: #555; }
        .invoice tfoot td { font-weight: 600; border-top: 2px solid #111; }
        .invoice .right { text-align: right; }
        .invoice .totals { width: 320px; margin-left: auto; }
        .invoice .totals tr td { border-bottom: none; padding: 4px 6px; }
        .invoice .totals tr:last-child td { border-top: 2px solid #111; padding-top: 8px; font-size: 16px; font-weight: 700; }
        .invoice .small { font-size: 11px; color: #555; }
        .invoice .print-btn { display: inline-block; padding: 8px 16px; border: 1px solid #999; border-radius: 4px; background: #f3f3f3; color: inherit; text-decoration: none; }
        @media print {
          .invoice { padding: 20px; }
          .invoice .no-print { display: none; }
        }
      `}</style>
      <div className="no-print" style={{ marginBottom: 20 }}>
        {/* A link inside a <button> is invalid HTML; the link is the control. */}
        <a className="print-btn" href="javascript:window.print()">
          Print / Save as PDF
        </a>
      </div>

        <div className="header">
          <div>
            <h1>Tax Invoice</h1>
            <div className="small">{inv.invoiceNumber} · FY {inv.financialYear}</div>
            {inv.isReturn ? <div style={{ color: "#c00", fontWeight: 600 }}>CREDIT NOTE</div> : null}
          </div>
          <div style={{ textAlign: "right" }}>
            <strong>Inventre Edu Services Pvt Ltd</strong>
            <div className="small">24th Floor, One West, Nanakramguda</div>
            <div className="small">Hyderabad, Telangana 500032</div>
            <div className="small">GSTIN: 36AAMCP1199C1ZA</div>
          </div>
        </div>

        <div className="meta">
          <div>
            <h3>Bill To</h3>
            <strong>{parent?.name ?? "Customer"}</strong>
            <div className="small">{parent?.phone}</div>
            <div className="small">{billing?.line1 as string}</div>
            <div className="small">{billing?.line2 as string}</div>
            <div className="small">
              {billing?.city as string}, {billing?.state as string} {billing?.pincode as string}
            </div>
          </div>
          <div>
            <h3>Invoice Details</h3>
            <div>Date: {inv.postingDate}</div>
            <div>Order: {ord?.orderNumber}</div>
            <div>Place of Supply: {inv.placeOfSupply}</div>
            <div>Status: {inv.status.toUpperCase()}</div>
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th>Item</th>
              <th>HSN</th>
              <th className="right">Qty</th>
              <th className="right">Rate</th>
              <th className="right">Net</th>
              <th className="right">CGST</th>
              <th className="right">SGST</th>
              <th className="right">IGST</th>
              <th className="right">Total</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.id}>
                <td>{it.itemNameSnapshot}</td>
                <td className="small">{it.hsnCode ?? "—"}</td>
                <td className="right">{it.qty}</td>
                <td className="right">{fmt(it.unitPrice)}</td>
                <td className="right">{fmt(it.netAmount)}</td>
                <td className="right">{fmt(it.cgstAmount)} <div className="small">{Number(it.cgstRate)}%</div></td>
                <td className="right">{fmt(it.sgstAmount)} <div className="small">{Number(it.sgstRate)}%</div></td>
                <td className="right">{fmt(it.igstAmount)} <div className="small">{Number(it.igstRate)}%</div></td>
                <td className="right">{fmt(it.totalAmount)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <table className="totals">
          <tbody>
            <tr><td>Net Total</td><td className="right">{fmt(inv.netTotal)}</td></tr>
            <tr><td>CGST</td><td className="right">{fmt(inv.cgstTotal)}</td></tr>
            <tr><td>SGST</td><td className="right">{fmt(inv.sgstTotal)}</td></tr>
            <tr><td>IGST</td><td className="right">{fmt(inv.igstTotal)}</td></tr>
            <tr><td>Rounding</td><td className="right">{fmt(inv.roundingAdjustment)}</td></tr>
            <tr><td>Grand Total</td><td className="right">{fmt(inv.grandTotal)}</td></tr>
          </tbody>
        </table>

        <p className="small" style={{ marginTop: 40 }}>
          This is a computer-generated invoice. No signature required.
        </p>
    </div>
  );
}
