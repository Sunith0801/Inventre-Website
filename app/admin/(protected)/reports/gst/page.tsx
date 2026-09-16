import { sql, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { invoices, invoiceItems } from "@/db/schema";
import { PageHeader, Stat, Money, Th, Td, Tr, EmptyState } from "@/components/admin/ui/primitives";
import { ReportToolbar, reportRange } from "@/components/admin/reports/ReportToolbar";
import { ReportTable, DownloadLink } from "@/components/admin/reports/ReportTable";
import { Receipt, Download } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function GstReport({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const sp = await searchParams;
  const { from, to } = reportRange(sp);
  const inRange = sql`${invoices.status} != 'cancelled' AND ${invoices.postingDate} BETWEEN ${from} AND ${to}`;

  const [[overall], byTreatment] = await Promise.all([
    db
      .select({
        invoiceCount: sql<number>`COUNT(*)::int`,
        netTotal: sql<number>`COALESCE(SUM(${invoices.netTotal}), 0)::bigint`,
        cgstTotal: sql<number>`COALESCE(SUM(${invoices.cgstTotal}), 0)::bigint`,
        sgstTotal: sql<number>`COALESCE(SUM(${invoices.sgstTotal}), 0)::bigint`,
        igstTotal: sql<number>`COALESCE(SUM(${invoices.igstTotal}), 0)::bigint`,
        grandTotal: sql<number>`COALESCE(SUM(${invoices.grandTotal}), 0)::bigint`,
      })
      .from(invoices)
      .where(inRange),
    db
      .select({
        treatment: invoiceItems.gstTreatment,
        lineCount: sql<number>`COUNT(*)::int`,
        netTotal: sql<number>`COALESCE(SUM(${invoiceItems.netAmount}), 0)::bigint`,
        cgst: sql<number>`COALESCE(SUM(${invoiceItems.cgstAmount}), 0)::bigint`,
        sgst: sql<number>`COALESCE(SUM(${invoiceItems.sgstAmount}), 0)::bigint`,
        igst: sql<number>`COALESCE(SUM(${invoiceItems.igstAmount}), 0)::bigint`,
      })
      .from(invoiceItems)
      .innerJoin(invoices, eq(invoices.id, invoiceItems.invoiceId))
      .where(inRange)
      .groupBy(invoiceItems.gstTreatment)
      .orderBy(sql`SUM(${invoiceItems.netAmount}) DESC`),
  ]);

  return (
    <div>
      <PageHeader
        eyebrow="Overview & Analytics"
        breadcrumb={[{ label: "Reports", href: "/admin/reports" }, { label: "GST summary" }]}
        title="GST summary"
        actions={
          <DownloadLink href={`/api/admin/reports/gstr1?from=${from}&to=${to}&format=json-download`}>
            <Download className="h-3.5 w-3.5" /> GSTR-1 JSON
          </DownloadLink>
        }
      />

      <ReportToolbar action="/admin/reports/gst" from={from} to={to} requested={sp} />

      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <Stat label="Invoices" value={Number(overall?.invoiceCount ?? 0).toLocaleString("en-IN")} />
        <Stat label="Net total" value={<Money paise={Number(overall?.netTotal ?? 0)} />} />
        <Stat label="CGST" value={<Money paise={Number(overall?.cgstTotal ?? 0)} />} />
        <Stat label="SGST" value={<Money paise={Number(overall?.sgstTotal ?? 0)} />} />
        <Stat label="IGST" value={<Money paise={Number(overall?.igstTotal ?? 0)} />} />
        <Stat label="Grand total" value={<Money paise={Number(overall?.grandTotal ?? 0)} />} />
      </div>

      <ReportTable title="By GST treatment" description="Invoice lines posted in the range, excluding cancelled invoices">
        {byTreatment.length === 0 ? (
          <EmptyState icon={Receipt} title="No invoice lines in this range" />
        ) : (
          <table className="w-full">
            <thead>
              <tr>
                <Th>Treatment</Th>
                <Th right>Lines</Th>
                <Th right>Net</Th>
                <Th right>CGST</Th>
                <Th right>SGST</Th>
                <Th right>IGST</Th>
                <Th right>Tax</Th>
              </tr>
            </thead>
            <tbody>
              {byTreatment.map((r) => (
                <Tr key={r.treatment}>
                  <Td className="capitalize">{r.treatment.replace(/_/g, " ")}</Td>
                  <Td right muted>{Number(r.lineCount).toLocaleString("en-IN")}</Td>
                  <Td right><Money paise={Number(r.netTotal)} /></Td>
                  <Td right muted><Money paise={Number(r.cgst)} /></Td>
                  <Td right muted><Money paise={Number(r.sgst)} /></Td>
                  <Td right muted><Money paise={Number(r.igst)} /></Td>
                  <Td right><Money paise={Number(r.cgst) + Number(r.sgst) + Number(r.igst)} className="font-semibold" /></Td>
                </Tr>
              ))}
            </tbody>
          </table>
        )}
      </ReportTable>
    </div>
  );
}
