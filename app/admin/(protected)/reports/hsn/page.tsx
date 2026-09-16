import { db } from "@/db/client";
import { invoices, invoiceItems } from "@/db/schema";
import { eq, and, gte, lte, sql } from "drizzle-orm";
import { Hash, Download } from "lucide-react";
import { PageHeader, Th, Td, Tr, EmptyState, Stat, Money } from "@/components/admin/ui/primitives";
import { ReportToolbar, reportRange } from "@/components/admin/reports/ReportToolbar";
import { ReportTable, DownloadLink } from "@/components/admin/reports/ReportTable";

export const dynamic = "force-dynamic";

export default async function HsnReportPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const sp = await searchParams;
  const { from: fromDate, to: toDate } = reportRange(sp);

  // Aggregate by HSN code (GSTR-1 §12 shape: HSN, qty, taxable, igst, cgst, sgst, total)
  const rows = await db
    .select({
      hsn: invoiceItems.hsnCode,
      gstTreatment: invoiceItems.gstTreatment,
      totalQty: sql<number>`COALESCE(SUM(${invoiceItems.qty}), 0)::int`,
      taxable: sql<number>`COALESCE(SUM(${invoiceItems.taxableAmount}), 0)::bigint`,
      igst: sql<number>`COALESCE(SUM(${invoiceItems.igstAmount}), 0)::bigint`,
      cgst: sql<number>`COALESCE(SUM(${invoiceItems.cgstAmount}), 0)::bigint`,
      sgst: sql<number>`COALESCE(SUM(${invoiceItems.sgstAmount}), 0)::bigint`,
      total: sql<number>`COALESCE(SUM(${invoiceItems.totalAmount}), 0)::bigint`,
    })
    .from(invoiceItems)
    .innerJoin(invoices, eq(invoices.id, invoiceItems.invoiceId))
    .where(and(gte(invoices.postingDate, fromDate), lte(invoices.postingDate, toDate), sql`${invoices.status} != 'cancelled'`))
    .groupBy(invoiceItems.hsnCode, invoiceItems.gstTreatment)
    .orderBy(sql`SUM(${invoiceItems.totalAmount}) DESC`);

  const totals = rows.reduce(
    (a, r) => ({
      qty: a.qty + Number(r.totalQty),
      taxable: a.taxable + Number(r.taxable),
      igst: a.igst + Number(r.igst),
      cgst: a.cgst + Number(r.cgst),
      sgst: a.sgst + Number(r.sgst),
      total: a.total + Number(r.total),
      missingQty: a.missingQty + (r.hsn ? 0 : Number(r.totalQty)),
    }),
    { qty: 0, taxable: 0, igst: 0, cgst: 0, sgst: 0, total: 0, missingQty: 0 }
  );
  const tax = totals.igst + totals.cgst + totals.sgst;
  const codes = new Set(rows.filter((r) => r.hsn).map((r) => r.hsn)).size;

  return (
    <div>
      <PageHeader
        eyebrow="Overview & Analytics"
        breadcrumb={[{ label: "Reports", href: "/admin/reports" }, { label: "HSN summary" }]}
        title="HSN-wise summary"
        actions={
          <DownloadLink href={`/api/admin/reports/hsn?from=${fromDate}&to=${toDate}&format=csv`}>
            <Download className="h-3.5 w-3.5" /> CSV
          </DownloadLink>
        }
      />

      <ReportToolbar action="/admin/reports/hsn" from={fromDate} to={toDate} requested={sp} />

      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="HSN codes"
          value={codes.toLocaleString("en-IN")}
          hint={totals.missingQty ? `${totals.missingQty.toLocaleString("en-IN")} units have no HSN` : undefined}
        />
        <Stat label="Units" value={totals.qty.toLocaleString("en-IN")} />
        <Stat label="Taxable value" value={<Money paise={totals.taxable} />} />
        <Stat label="Tax collected" value={<Money paise={tax} />} />
      </div>

      <ReportTable title="By HSN code" description="Invoice lines posted in the range, excluding cancelled invoices">
        {rows.length === 0 ? (
          <EmptyState icon={Hash} title="No invoiced items in this range" description="Adjust the date filter." />
        ) : (
          <table className="w-full">
            <thead>
              <tr>
                <Th>HSN</Th>
                <Th>Treatment</Th>
                <Th right>Units</Th>
                <Th right>Taxable</Th>
                <Th right>IGST</Th>
                <Th right>CGST</Th>
                <Th right>SGST</Th>
                <Th right>Total</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <Tr key={i}>
                  <Td>
                    {r.hsn ? <span className="font-mono">{r.hsn}</span> : <span className="text-red-700">Missing</span>}
                  </Td>
                  <Td muted className="capitalize">{r.gstTreatment.replace(/_/g, " ")}</Td>
                  <Td right>{Number(r.totalQty).toLocaleString("en-IN")}</Td>
                  <Td right><Money paise={Number(r.taxable)} /></Td>
                  <Td right muted><Money paise={Number(r.igst)} fallback="0" /></Td>
                  <Td right muted><Money paise={Number(r.cgst)} fallback="0" /></Td>
                  <Td right muted><Money paise={Number(r.sgst)} fallback="0" /></Td>
                  <Td right><Money paise={Number(r.total)} className="font-semibold" /></Td>
                </Tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-ink-100 bg-cream-50">
                <Td className="font-semibold" colSpan={2}>Total</Td>
                <Td right className="font-semibold">{totals.qty.toLocaleString("en-IN")}</Td>
                <Td right className="font-semibold"><Money paise={totals.taxable} /></Td>
                <Td right className="font-semibold"><Money paise={totals.igst} /></Td>
                <Td right className="font-semibold"><Money paise={totals.cgst} /></Td>
                <Td right className="font-semibold"><Money paise={totals.sgst} /></Td>
                <Td right className="font-semibold"><Money paise={totals.total} /></Td>
              </tr>
            </tfoot>
          </table>
        )}
      </ReportTable>
    </div>
  );
}
