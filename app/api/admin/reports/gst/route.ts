import { NextResponse } from "next/server";
import { sql, gte, lte, and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { invoices, invoiceItems } from "@/db/schema";
import { isResponse, requirePermission } from "@/server/admin-guard";

/**
 * GST summary report — supports the GSTR-1 outward-supply view.
 * Aggregates invoices in a date range by GST treatment (Nil-Rated vs Taxable)
 * and by tax type (CGST/SGST vs IGST).
 *
 * Query params: ?from=YYYY-MM-DD &to=YYYY-MM-DD &fy=26-27
 */
export async function GET(req: Request) {
  const guard = await requirePermission("reports.read");
  if (isResponse(guard)) return guard;
  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const fy = url.searchParams.get("fy");

  const conds = [];
  if (from) conds.push(gte(invoices.postingDate, from));
  if (to) conds.push(lte(invoices.postingDate, to));
  if (fy) conds.push(eq(invoices.financialYear, fy));
  conds.push(sql`${invoices.status} != 'cancelled'`);

  const [overall] = await db
    .select({
      invoiceCount: sql<number>`COUNT(*)::int`,
      netTotal: sql<number>`COALESCE(SUM(${invoices.netTotal}), 0)::bigint`,
      cgstTotal: sql<number>`COALESCE(SUM(${invoices.cgstTotal}), 0)::bigint`,
      sgstTotal: sql<number>`COALESCE(SUM(${invoices.sgstTotal}), 0)::bigint`,
      igstTotal: sql<number>`COALESCE(SUM(${invoices.igstTotal}), 0)::bigint`,
      grandTotal: sql<number>`COALESCE(SUM(${invoices.grandTotal}), 0)::bigint`,
    })
    .from(invoices)
    .where(and(...conds));

  // Per-treatment breakdown (Nil-Rated vs Taxable etc.) computed off invoiceItems
  // This requires joining invoiceItems → invoices to apply the date filter.
  const byTreatment = await db
    .select({
      treatment: invoiceItems.gstTreatment,
      lineCount: sql<number>`COUNT(*)::int`,
      netTotal: sql<number>`COALESCE(SUM(${invoiceItems.netAmount}), 0)::bigint`,
      taxTotal: sql<number>`COALESCE(SUM(${invoiceItems.cgstAmount} + ${invoiceItems.sgstAmount} + ${invoiceItems.igstAmount}), 0)::bigint`,
    })
    .from(invoiceItems)
    .innerJoin(invoices, eq(invoices.id, invoiceItems.invoiceId))
    .where(and(...conds))
    .groupBy(invoiceItems.gstTreatment);

  const byPlaceOfSupply = await db
    .select({
      placeOfSupply: invoices.placeOfSupply,
      invoiceCount: sql<number>`COUNT(*)::int`,
      netTotal: sql<number>`COALESCE(SUM(${invoices.netTotal}), 0)::bigint`,
      taxTotal: sql<number>`COALESCE(SUM(${invoices.cgstTotal} + ${invoices.sgstTotal} + ${invoices.igstTotal}), 0)::bigint`,
    })
    .from(invoices)
    .where(and(...conds))
    .groupBy(invoices.placeOfSupply);

  return NextResponse.json({
    summary: {
      invoiceCount: Number(overall?.invoiceCount ?? 0),
      netTotalPaise: Number(overall?.netTotal ?? 0),
      cgstTotalPaise: Number(overall?.cgstTotal ?? 0),
      sgstTotalPaise: Number(overall?.sgstTotal ?? 0),
      igstTotalPaise: Number(overall?.igstTotal ?? 0),
      grandTotalPaise: Number(overall?.grandTotal ?? 0),
    },
    byTreatment: byTreatment.map((r) => ({
      treatment: r.treatment,
      lineCount: Number(r.lineCount),
      netTotalPaise: Number(r.netTotal),
      taxTotalPaise: Number(r.taxTotal),
    })),
    byPlaceOfSupply: byPlaceOfSupply.map((r) => ({
      placeOfSupply: r.placeOfSupply,
      invoiceCount: Number(r.invoiceCount),
      netTotalPaise: Number(r.netTotal),
      taxTotalPaise: Number(r.taxTotal),
    })),
  });
}
