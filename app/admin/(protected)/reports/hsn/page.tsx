import { db } from "@/db/client";
import { invoices, invoiceItems } from "@/db/schema";
import { eq, and, gte, lte, sql } from "drizzle-orm";
import { Hash, Download } from "lucide-react";
import {
  PageHeader,
  Card,
  Th,
  Td,
  Tr,
  EmptyState,
  Stat,
  Money,
} from "@/components/admin/ui/primitives";

export const dynamic = "force-dynamic";

export default async function HsnReportPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { from, to } = await searchParams;

  const today = new Date();
  const defaultFrom = new Date(today.getFullYear(), today.getMonth(), 1)
    .toISOString()
    .slice(0, 10);
  const defaultTo = new Date(today.getFullYear(), today.getMonth() + 1, 0)
    .toISOString()
    .slice(0, 10);
  const fromDate = from || defaultFrom;
  const toDate = to || defaultTo;

  const conds = [
    gte(invoices.postingDate, fromDate),
    lte(invoices.postingDate, toDate),
    sql`${invoices.status} != 'cancelled'`,
  ];

  // Aggregate by HSN code (GSTR-1 §12 shape: HSN, qty, taxable, igst, cgst, sgst, cess, total)
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
    .where(and(...conds))
    .groupBy(invoiceItems.hsnCode, invoiceItems.gstTreatment)
    .orderBy(sql`SUM(${invoiceItems.totalAmount}) DESC`);

  const totals = rows.reduce(
    (a, r) => ({
      qty: a.qty + Number(r.totalQty),
      taxable: a.taxable + Number(r.taxable),
      tax: a.tax + Number(r.igst) + Number(r.cgst) + Number(r.sgst),
      total: a.total + Number(r.total),
    }),
    { qty: 0, taxable: 0, tax: 0, total: 0 }
  );

  return (
    <div>
      <PageHeader
        breadcrumb={[
          { label: "Reports", href: "/admin/reports" },
          { label: "HSN summary" },
        ]}
        eyebrow="Reports"
        title="HSN-wise summary"
        description="GSTR-1 §12 shape: per-HSN qty + taxable + tax breakup. Use as a sanity check before filing."
        actions={
          <a
            href={`/api/admin/reports/hsn?from=${fromDate}&to=${toDate}&format=csv`}
            download
            className="inline-flex items-center gap-1.5 px-3 h-9 rounded-lg bg-ink-900 text-white text-[13px] font-semibold hover:bg-ink-800"
          >
            <Download className="h-3.5 w-3.5" />
            CSV
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
            defaultValue={fromDate}
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
            defaultValue={toDate}
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

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <Stat label="HSN codes" value={rows.length} iconTone="default" />
        <Stat
          label="Total quantity"
          value={totals.qty.toLocaleString("en-IN")}
          iconTone="info"
        />
        <Stat
          label="Taxable value"
          value={<Money paise={totals.taxable} />}
          iconTone="brand"
        />
        <Stat
          label="Tax collected"
          value={<Money paise={totals.tax} />}
          iconTone="warning"
        />
      </div>

      <Card padded={false}>
        {rows.length === 0 ? (
          <EmptyState
            icon={Hash}
            title="No invoiced items in this range"
            description="Adjust the date range to see HSN aggregates."
          />
        ) : (
          <table className="w-full">
            <thead>
              <tr>
                <Th>HSN</Th>
                <Th>Treatment</Th>
                <Th right>Qty</Th>
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
                    <span className="font-mono text-[12px] font-semibold">
                      {r.hsn ?? <span className="text-red-700">— missing —</span>}
                    </span>
                  </Td>
                  <Td muted className="capitalize">
                    {r.gstTreatment.replace("_", " ")}
                  </Td>
                  <Td right>{Number(r.totalQty)}</Td>
                  <Td right>
                    <Money paise={Number(r.taxable)} />
                  </Td>
                  <Td right muted>
                    <Money paise={Number(r.igst)} fallback="0" />
                  </Td>
                  <Td right muted>
                    <Money paise={Number(r.cgst)} fallback="0" />
                  </Td>
                  <Td right muted>
                    <Money paise={Number(r.sgst)} fallback="0" />
                  </Td>
                  <Td right>
                    <Money paise={Number(r.total)} className="font-semibold" />
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
