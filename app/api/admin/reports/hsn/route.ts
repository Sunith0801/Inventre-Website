import { NextResponse } from "next/server";
import { eq, and, gte, lte, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { invoices, invoiceItems } from "@/db/schema";
import { isResponse, requirePermission } from "@/server/admin-guard";

export async function GET(req: Request) {
  const guard = await requirePermission("reports.read");
  if (isResponse(guard)) return guard;

  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const format = url.searchParams.get("format");

  if (!from || !to) {
    return NextResponse.json(
      { error: "from and to dates required" },
      { status: 400 }
    );
  }

  const rows = await db
    .select({
      hsn: invoiceItems.hsnCode,
      gstTreatment: invoiceItems.gstTreatment,
      qty: sql<number>`COALESCE(SUM(${invoiceItems.qty}), 0)::int`,
      taxable: sql<number>`COALESCE(SUM(${invoiceItems.taxableAmount}), 0)::bigint`,
      igst: sql<number>`COALESCE(SUM(${invoiceItems.igstAmount}), 0)::bigint`,
      cgst: sql<number>`COALESCE(SUM(${invoiceItems.cgstAmount}), 0)::bigint`,
      sgst: sql<number>`COALESCE(SUM(${invoiceItems.sgstAmount}), 0)::bigint`,
      total: sql<number>`COALESCE(SUM(${invoiceItems.totalAmount}), 0)::bigint`,
    })
    .from(invoiceItems)
    .innerJoin(invoices, eq(invoices.id, invoiceItems.invoiceId))
    .where(
      and(
        gte(invoices.postingDate, from),
        lte(invoices.postingDate, to),
        sql`${invoices.status} != 'cancelled'`
      )
    )
    .groupBy(invoiceItems.hsnCode, invoiceItems.gstTreatment)
    .orderBy(sql`SUM(${invoiceItems.totalAmount}) DESC`);

  if (format === "csv") {
    const header = "HSN,Treatment,Qty,Taxable (paise),IGST,CGST,SGST,Total\n";
    const body = rows
      .map(
        (r) =>
          `${r.hsn ?? ""},${r.gstTreatment},${r.qty},${r.taxable},${r.igst},${r.cgst},${r.sgst},${r.total}`
      )
      .join("\n");
    return new NextResponse(header + body, {
      headers: {
        "content-type": "text/csv",
        "content-disposition": `attachment; filename="hsn-${from}-${to}.csv"`,
      },
    });
  }

  return NextResponse.json({ from, to, rows });
}
