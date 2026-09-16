import Link from "next/link";
import { db } from "@/db/client";
import { returns, parents, orders } from "@/db/schema";
import { eq, desc, and, or, ilike, sql, count, type SQL } from "drizzle-orm";
import { PackageOpen } from "lucide-react";
import {
  PageHeader,
  Card,
  Th,
  Td,
  Tr,
  Badge,
  Money,
  EmptyState,
  statusTone,
  Stat,
  Toolbar,
  SearchInput,
  FilterSelect,
} from "@/components/admin/ui/primitives";
import { Pagination, PerPagePicker } from "@/components/admin/ui/pagination";
import { AutoSubmitForm } from "@/components/admin/AutoSubmitForm";
import { DEFAULT_PER_PAGE, PER_PAGE_OPTIONS, pageMeta, readPaging, withPaging } from "@/lib/admin-paging";
import { redirect } from "next/navigation";
import { requireAnyPermission, isResponse } from "@/server/admin-guard";

export const dynamic = "force-dynamic";

const BASE = "/admin/returns";
const STATUSES = ["requested", "approved", "received", "refunded", "rejected"] as const;
type Status = (typeof STATUSES)[number];
const STATUS_LABEL: Record<Status, string> = {
  requested: "Requested",
  approved: "Approved",
  received: "Received",
  refunded: "Refunded",
  rejected: "Rejected",
};
const IST = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" });
// Reasons are stored as snake_case keys ("wrong_size_delivered") or free text.
const humanReason = (r: string | null) => (r ? r.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()) : "—");

/**
 * Returns & RMA — every return request, from the storefront or started by
 * an admin. The "Requested" count is the queue to work through.
 */
export default async function ReturnsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; page?: string; perPage?: string }>;
}) {
  const guard = await requireAnyPermission("returns.read", "returns.write");
  if (isResponse(guard)) redirect("/admin/dashboard");

  const sp = await searchParams;
  const term = (sp.q ?? "").trim();
  const status = (STATUSES as readonly string[]).includes(sp.status ?? "") ? (sp.status as Status) : "";
  const paging = readPaging(sp);

  const conds: SQL[] = [];
  if (term) conds.push(or(ilike(returns.returnNumber, `%${term}%`), ilike(orders.orderNumber, `%${term}%`), ilike(parents.name, `%${term}%`), ilike(parents.phone, `%${term}%`))!);
  if (status) conds.push(eq(returns.status, status));
  const where = conds.length ? and(...conds) : undefined;

  const joined = () =>
    db
      .select({
        ret: returns,
        parentName: parents.name,
        parentPhone: parents.phone,
        orderNumber: orders.orderNumber,
        orderId: orders.id,
      })
      .from(returns)
      .leftJoin(parents, eq(parents.id, returns.parentId))
      .leftJoin(orders, eq(orders.id, returns.orderId));

  const [rows, totalRows, byStatus] = await Promise.all([
    joined().where(where).orderBy(desc(returns.createdAt)).limit(paging.perPage).offset(paging.offset),
    db
      .select({ n: count() })
      .from(returns)
      .leftJoin(parents, eq(parents.id, returns.parentId))
      .leftJoin(orders, eq(orders.id, returns.orderId))
      .where(where),
    db.select({ status: returns.status, n: sql<number>`count(*)::int` }).from(returns).groupBy(returns.status),
  ]);
  const total = Number(totalRows[0]?.n ?? 0);
  const counts = Object.fromEntries(byStatus.map((r) => [r.status, Number(r.n)])) as Record<string, number>;
  const allCount = byStatus.reduce((s, r) => s + Number(r.n), 0);

  const hrefWith = (over: Record<string, string> = {}) => {
    const u = new URLSearchParams();
    const b: Record<string, string> = { q: term, status, ...over };
    for (const [k, v] of Object.entries(b)) if (v) u.set(k, v);
    const qs = u.toString();
    return qs ? `${BASE}?${qs}` : BASE;
  };
  const { pages, from, to } = pageMeta(total, paging);
  if (paging.page > pages) redirect(withPaging(hrefWith(), pages, paging.perPage));
  const hasFilter = !!(term || status);

  return (
    <div>
      <PageHeader
        eyebrow="Sales & Distribution"
        title="Returns & RMA"
        description="Return requests raised by parents on the shop. Approve, receive, then refund."
      />

      <div className="mb-5 grid grid-cols-3 gap-3 lg:grid-cols-6 lg:gap-4">
        <Link href={hrefWith({ status: "" })} className={`block rounded-2xl ${!status ? "ring-2 ring-brand/40" : ""}`}>
          <Stat label="All returns" value={allCount.toLocaleString("en-IN")} />
        </Link>
        {STATUSES.map((s) => (
          <Link key={s} href={hrefWith({ status: s })} className={`block rounded-2xl ${status === s ? "ring-2 ring-brand/40" : ""}`}>
            <Stat label={STATUS_LABEL[s]} value={(counts[s] ?? 0).toLocaleString("en-IN")} />
          </Link>
        ))}
      </div>

      <AutoSubmitForm action={BASE}>
        <Toolbar>
          <SearchInput defaultValue={term} placeholder="Search return #, order #, customer or phone…" />
          <FilterSelect label="Status" name="status" defaultValue={status}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>{STATUS_LABEL[s]}</option>
            ))}
          </FilterSelect>
          {paging.perPage !== DEFAULT_PER_PAGE ? <input type="hidden" name="perPage" value={paging.perPage} /> : null}
          {hasFilter ? <Link href={BASE} className="text-[12.5px] text-ink-500 hover:text-ink-900">Clear</Link> : null}
        </Toolbar>
      </AutoSubmitForm>

      <Card padded={false} className="overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState
            icon={PackageOpen}
            title={hasFilter ? "No returns match" : "No returns yet"}
            description={hasFilter ? "Try a different search or clear the filters." : "Customers can request returns from delivered orders; they appear here for approval."}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <Th>Return</Th>
                  <Th>Customer</Th>
                  <Th>Order</Th>
                  <Th>Reason</Th>
                  <Th>Status</Th>
                  <Th right>Refund</Th>
                  <Th>Requested</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <Tr key={r.ret.id}>
                    <Td>
                      <Link href={`/admin/returns/${r.ret.id}`} className="font-mono font-semibold text-ink-900 hover:text-brand-700">
                        {r.ret.returnNumber ?? r.ret.id.slice(0, 8)}
                      </Link>
                    </Td>
                    <Td>
                      <span className="block font-medium text-ink-900">{r.parentName ?? <span className="text-ink-300">—</span>}</span>
                      {r.parentPhone ? <span className="block font-mono text-[12px] font-normal text-ink-500">{r.parentPhone}</span> : null}
                    </Td>
                    <Td muted>
                      {r.orderId ? (
                        <Link href={`/admin/orders/${r.orderId}`} className="font-mono text-ink-700 hover:text-brand-700">{r.orderNumber}</Link>
                      ) : (
                        <span className="font-mono">{r.orderNumber ?? "—"}</span>
                      )}
                    </Td>
                    <Td muted><span className="block max-w-[260px] truncate" title={r.ret.reason ?? undefined}>{humanReason(r.ret.reason)}</span></Td>
                    <Td>
                      <Badge tone={statusTone(r.ret.status)} dot size="sm">{STATUS_LABEL[r.ret.status as Status] ?? r.ret.status}</Badge>
                    </Td>
                    <Td right>
                      {r.ret.refundAmount ? <Money paise={r.ret.refundAmount} className="font-semibold" /> : <span className="text-ink-300">—</span>}
                    </Td>
                    <Td muted className="whitespace-nowrap">{IST.format(new Date(r.ret.createdAt))}</Td>
                  </Tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {total > 0 ? (
          <Pagination page={paging.page} pages={pages} from={from} to={to} total={total} noun="return" hrefFor={(p) => withPaging(hrefWith(), p, paging.perPage)}>
            <PerPagePicker value={paging.perPage} options={PER_PAGE_OPTIONS} hrefFor={(pp) => withPaging(hrefWith(), 1, pp)} />
          </Pagination>
        ) : null}
      </Card>
    </div>
  );
}
