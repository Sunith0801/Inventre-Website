import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/db/client";
import { invoices, parents } from "@/db/schema";
import { asc, count, eq, sql, desc, and, type SQL } from "drizzle-orm";
import { Wallet } from "lucide-react";
import { PageHeader, Th, Td, Tr, Badge, EmptyState, Stat, Money, Toolbar, FilterSelect, type Tone } from "@/components/admin/ui/primitives";
import { Pagination, PerPagePicker } from "@/components/admin/ui/pagination";
import { DEFAULT_PER_PAGE, PER_PAGE_OPTIONS, pageMeta, readPaging } from "@/lib/admin-paging";
import { AutoSubmitForm } from "@/components/admin/AutoSubmitForm";
import { ReportTable } from "@/components/admin/reports/ReportTable";

export const dynamic = "force-dynamic";

const BASE = "/admin/reports/receivables";

const BUCKETS = [
  { key: "current", label: "Not yet due", short: "Current", tone: "success", cond: (d: SQL) => sql`${d} <= 0` },
  { key: "b30", label: "1–30 days overdue", short: "1–30 days", tone: "info", cond: (d: SQL) => sql`${d} BETWEEN 1 AND 30` },
  { key: "b60", label: "31–60 days overdue", short: "31–60 days", tone: "warning", cond: (d: SQL) => sql`${d} BETWEEN 31 AND 60` },
  { key: "b90", label: "61–90 days overdue", short: "61–90 days", tone: "warning", cond: (d: SQL) => sql`${d} BETWEEN 61 AND 90` },
  { key: "b181", label: "Over 90 days overdue", short: "90+ days", tone: "danger", cond: (d: SQL) => sql`${d} > 90` },
] as const satisfies readonly { key: string; label: string; short: string; tone: Tone; cond: (d: SQL) => SQL }[];
type BucketKey = (typeof BUCKETS)[number]["key"];

const bucketFor = (d: number): BucketKey =>
  d <= 0 ? "current" : d <= 30 ? "b30" : d <= 60 ? "b60" : d <= 90 ? "b90" : "b181";

export default async function ReceivablesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; perPage?: string; bucket?: string }>;
}) {
  const sp = await searchParams;
  const paging = readPaging(sp);
  const bucket = BUCKETS.find((b) => b.key === sp.bucket)?.key ?? null;
  // Today in India. The container clock happens to be IST, but toISOString()
  // is always UTC, so before 05:30 IST it named yesterday.
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

  const outstanding = sql`${invoices.outstandingAmount} > 0 AND ${invoices.status} != 'cancelled'`;
  const daysOverdue = sql<number>`GREATEST(0, ${today}::date - COALESCE(${invoices.dueDate}::date, ${invoices.postingDate}::date))::int`;
  const bucketCond = bucket ? BUCKETS.find((b) => b.key === bucket)!.cond(daysOverdue) : null;
  const listWhere = bucketCond ? and(outstanding, bucketCond) : outstanding;

  const [rows, [summary], [listCount]] = await Promise.all([
    db
      .select({
        invoice: invoices,
        parentId: parents.id,
        parentName: parents.name,
        parentPhone: parents.phone,
        daysOverdue,
      })
      .from(invoices)
      .innerJoin(parents, eq(parents.id, invoices.parentId))
      .where(listWhere)
      // id breaks amount ties so an invoice cannot appear on two pages.
      .orderBy(desc(invoices.outstandingAmount), asc(invoices.id))
      .limit(paging.perPage)
      .offset(paging.offset),
    // Totals and aging buckets over EVERY outstanding invoice, not just the page.
    db
      .select({
        count: count(),
        total: sql<string>`COALESCE(SUM(${invoices.outstandingAmount}), 0)`,
        oldest: sql<number>`COALESCE(MAX(${daysOverdue}), 0)::int`,
        ...Object.fromEntries(
          BUCKETS.flatMap((b) => [
            [`${b.key}Amount`, sql<string>`COALESCE(SUM(${invoices.outstandingAmount}) FILTER (WHERE ${b.cond(daysOverdue)}), 0)`],
            [`${b.key}Count`, sql<number>`COUNT(*) FILTER (WHERE ${b.cond(daysOverdue)})::int`],
          ])
        ),
      })
      .from(invoices)
      .where(outstanding),
    db.select({ count: count() }).from(invoices).where(listWhere),
  ]);

  const grand = Number(summary?.total ?? 0);
  const invoiceTotal = Number(summary?.count ?? 0);
  const overdueAmount = grand - Number(summary?.currentAmount ?? 0);
  const over90 = Number(summary?.b181Amount ?? 0);
  const oldest = Number(summary?.oldest ?? 0);
  const listTotal = Number(listCount?.count ?? 0);
  const { pages, from, to } = pageMeta(listTotal, paging);
  const hrefFor = (p: number, pp = paging.perPage) => {
    const q = new URLSearchParams();
    if (bucket) q.set("bucket", bucket);
    if (p > 1) q.set("page", String(p));
    if (pp !== DEFAULT_PER_PAGE) q.set("perPage", String(pp));
    const s = q.toString();
    return s ? `${BASE}?${s}` : BASE;
  };
  if (paging.page > pages) redirect(hrefFor(pages));

  return (
    <div>
      <PageHeader
        eyebrow="Overview & Analytics"
        breadcrumb={[{ label: "Reports", href: "/admin/reports" }, { label: "Receivables aging" }]}
        title="Receivables aging"
      />

      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Total outstanding" value={<Money paise={grand} />} hint={`${invoiceTotal.toLocaleString("en-IN")} invoices`} />
        <Stat label="Overdue" value={<Money paise={overdueAmount} />} hint={grand ? `${Math.round((overdueAmount / grand) * 100)}% of outstanding` : undefined} />
        <Stat label="Over 90 days" value={<Money paise={over90} />} hint={grand ? `${Math.round((over90 / grand) * 100)}% of outstanding` : undefined} />
        <Stat
          label="Oldest"
          value={oldest > 0 ? `${oldest.toLocaleString("en-IN")} days` : "—"}
          hint={oldest > 0 ? "Longest overdue invoice" : "Nothing overdue"}
        />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <ReportTable title="Aging" description="Outstanding balance by days past due">
          <table className="w-full">
            <thead>
              <tr>
                <Th>Age</Th>
                <Th right>Invoices</Th>
                <Th right>Outstanding</Th>
              </tr>
            </thead>
            <tbody>
              {BUCKETS.map((b) => {
                const amt = Number(summary?.[`${b.key}Amount`] ?? 0);
                const n = Number(summary?.[`${b.key}Count`] ?? 0);
                const pct = grand ? (amt / grand) * 100 : 0;
                return (
                  <Tr key={b.key} className={bucket === b.key ? "bg-cream-50" : undefined}>
                    <Td>
                      <Link href={bucket === b.key ? BASE : `${BASE}?bucket=${b.key}`} className="block">
                        <Badge tone={b.tone} dot size="sm" className="whitespace-nowrap">{b.short}</Badge>
                        <span className="mt-1.5 block h-1.5 w-full max-w-[140px] overflow-hidden rounded-full bg-cream-200">
                          <span className="block h-full rounded-full bg-current" style={{ width: `${pct}%`, color: barColor(b.tone) }} />
                        </span>
                      </Link>
                    </Td>
                    <Td right muted>{n.toLocaleString("en-IN")}</Td>
                    <Td right>
                      <Money paise={amt} className="font-semibold" />
                      <div className="text-[11px] font-normal text-ink-500">{pct.toFixed(0)}%</div>
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </table>
        </ReportTable>

        <ReportTable
          className="xl:col-span-2"
          title="Outstanding invoices"
          description={bucket ? `${listTotal.toLocaleString("en-IN")} invoices ${BUCKETS.find((b) => b.key === bucket)!.label.toLowerCase()}` : "Largest balance first"}
          actions={
            // Keyed so the pill follows the URL when an Aging row is clicked.
            <AutoSubmitForm key={bucket ?? ""} action={BASE}>
              <Toolbar className="mb-0 border-0 p-0">
                <FilterSelect label="Age" name="bucket" defaultValue={bucket ?? ""}>
                  {BUCKETS.map((b) => (
                    <option key={b.key} value={b.key}>{b.short}</option>
                  ))}
                </FilterSelect>
              </Toolbar>
            </AutoSubmitForm>
          }
        >
          {listTotal === 0 ? (
            <EmptyState icon={Wallet} title={bucket ? "No invoices in this age band" : "All paid up"} description={bucket ? undefined : "No invoice has an outstanding balance."} />
          ) : (
            <table className="w-full">
              <thead>
                <tr>
                  <Th>Invoice</Th>
                  <Th>Customer</Th>
                  <Th>Posted</Th>
                  <Th>Due</Th>
                  <Th>Overdue</Th>
                  <Th right>Outstanding</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const d = Number(r.daysOverdue);
                  const b = BUCKETS.find((x) => x.key === bucketFor(d))!;
                  return (
                    <Tr key={r.invoice.id}>
                      <Td>
                        <Link href={`/admin/invoices/${r.invoice.id}/print`} className="whitespace-nowrap font-mono text-[12px] hover:text-brand-700">
                          {r.invoice.invoiceNumber}
                        </Link>
                      </Td>
                      <Td>
                        <Link href={`/admin/customers/${r.parentId}`} className="hover:text-brand-700">
                          {r.parentName ?? "No name"}
                        </Link>
                        <div className="font-mono text-[11px] font-normal text-ink-500">{r.parentPhone}</div>
                      </Td>
                      <Td muted className="whitespace-nowrap">{fmtDate(r.invoice.postingDate)}</Td>
                      <Td muted className="whitespace-nowrap">{fmtDate(r.invoice.dueDate)}</Td>
                      <Td>
                        <Badge tone={b.tone} dot size="sm" className="whitespace-nowrap">{d > 0 ? `${d} days` : "Not due"}</Badge>
                      </Td>
                      <Td right><Money paise={r.invoice.outstandingAmount} className="font-semibold" /></Td>
                    </Tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {listTotal > 0 ? (
            <Pagination page={paging.page} pages={pages} from={from} to={to} total={listTotal} noun="invoice" hrefFor={(p) => hrefFor(p)}>
              <PerPagePicker value={paging.perPage} options={PER_PAGE_OPTIONS} hrefFor={(pp) => hrefFor(1, pp)} />
            </Pagination>
          ) : null}
        </ReportTable>
      </div>
    </div>
  );
}

/** "2026-06-01" → "1 Jun 2026", read as a calendar date (no UTC shift). */
function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  const t = new Date(`${d}T00:00:00`);
  return Number.isNaN(t.getTime()) ? d : t.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function barColor(t: Tone): string {
  return t === "danger" ? "#b91c1c" : t === "warning" ? "#b45309" : t === "info" ? "#0369a1" : "#047857";
}
