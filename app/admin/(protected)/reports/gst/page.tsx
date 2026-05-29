import { sql, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { invoices, invoiceItems } from "@/db/schema";
import {
  PageHeader,
  Card,
  CardHeader,
  Stat,
  Money,
  Th,
  Td,
  Tr,
  EmptyState,
} from "@/components/admin/ui/primitives";
import { Receipt, Download } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function GstReport({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const sp = await searchParams;
  const today = new Date();
  const from =
    sp.from ??
    new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
  const to =
    sp.to ??
    new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().slice(0, 10);

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
    .where(
      sql`${invoices.status} != 'cancelled' AND ${invoices.postingDate} BETWEEN ${from} AND ${to}`
    );

  const byTreatment = await db
    .select({
      treatment: invoiceItems.gstTreatment,
      lineCount: sql<number>`COUNT(*)::int`,
      netTotal: sql<number>`COALESCE(SUM(${invoiceItems.netAmount}), 0)::bigint`,
      taxTotal: sql<number>`COALESCE(SUM(${invoiceItems.cgstAmount} + ${invoiceItems.sgstAmount} + ${invoiceItems.igstAmount}), 0)::bigint`,
    })
    .from(invoiceItems)
    .innerJoin(invoices, eq(invoices.id, invoiceItems.invoiceId))
    .where(
      sql`${invoices.status} != 'cancelled' AND ${invoices.postingDate} BETWEEN ${from} AND ${to}`
    )
    .groupBy(invoiceItems.gstTreatment);

  return (
    <div>
      <PageHeader
        breadcrumb={[
          { label: "Reports", href: "/admin/reports" },
          { label: "GST summary" },
        ]}
        title="GST summary"
        description="Outward supply summary in the GSTR-1 spirit. Excludes cancelled invoices."
        actions={
          <a
            href={`/api/admin/reports/gstr1?from=${from}&to=${to}&format=json-download`}
            download
            className="inline-flex items-center gap-1.5 px-3 h-9 rounded-lg bg-ink-900 text-white text-[13px] font-semibold hover:bg-ink-800"
          >
            <Download className="h-3.5 w-3.5" />
            GSTR-1 JSON
          </a>
        }
      />

      <form
        method="GET"
        className="mb-5 flex flex-wrap gap-2 items-end p-3 bg-white border border-ink-100/70 rounded-xl"
      >
        <div>
          <label className="text-[11px] font-semibold text-ink-700 uppercase tracking-wider">
            From
          </label>
          <input
            type="date"
            name="from"
            defaultValue={from}
            className="block mt-1 h-9 px-3 text-[13px] rounded-lg bg-cream-50 border border-ink-100"
          />
        </div>
        <div>
          <label className="text-[11px] font-semibold text-ink-700 uppercase tracking-wider">
            To
          </label>
          <input
            type="date"
            name="to"
            defaultValue={to}
            className="block mt-1 h-9 px-3 text-[13px] rounded-lg bg-cream-50 border border-ink-100"
          />
        </div>
        <button
          type="submit"
          className="h-9 px-4 rounded-lg bg-ink-900 text-white text-[13px] font-semibold hover:bg-ink-800"
        >
          Apply
        </button>
      </form>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
        <Stat label="Active invoices" value={Number(overall?.invoiceCount ?? 0)} />
        <Stat label="Net total" value={<Money paise={Number(overall?.netTotal ?? 0)} />} iconTone="info" />
        <Stat label="Grand total" value={<Money paise={Number(overall?.grandTotal ?? 0)} />} iconTone="success" />
        <Stat label="CGST" value={<Money paise={Number(overall?.cgstTotal ?? 0)} />} iconTone="default" />
        <Stat label="SGST" value={<Money paise={Number(overall?.sgstTotal ?? 0)} />} iconTone="default" />
        <Stat label="IGST" value={<Money paise={Number(overall?.igstTotal ?? 0)} />} iconTone="default" />
      </div>

      <Card padded={false}>
        <div className="px-5 lg:px-6 pt-5 lg:pt-6 pb-3">
          <CardHeader title="By GST treatment" description="Lines grouped by tax category" />
        </div>
        {byTreatment.length === 0 ? (
          <EmptyState icon={Receipt} title="No invoice line items yet" />
        ) : (
          <table className="w-full">
            <thead>
              <tr>
                <Th>Treatment</Th>
                <Th right>Lines</Th>
                <Th right>Net</Th>
                <Th right>Tax</Th>
              </tr>
            </thead>
            <tbody>
              {byTreatment.map((r) => (
                <Tr key={r.treatment}>
                  <Td className="capitalize">{r.treatment.replace("_", " ")}</Td>
                  <Td right>{r.lineCount}</Td>
                  <Td right>
                    <Money paise={Number(r.netTotal)} />
                  </Td>
                  <Td right>
                    <Money paise={Number(r.taxTotal)} />
                  </Td>
                </Tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
