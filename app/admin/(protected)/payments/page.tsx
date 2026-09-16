import type * as React from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  CreditCard,
  AlertTriangle,
  CheckCircle2,
  Clock,
  IndianRupee,
  ChevronRight,
} from "lucide-react";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { requireAnyPermission, isResponse } from "@/server/admin-guard";
import {
  PageHeader,
  Card,
  Stat,
  Toolbar,
  SearchInput,
  EmptyState,
  Th,
  Td,
  Tr,
  Badge,
  statusTone,
  Money,
  FilterSelect,
} from "@/components/admin/ui/primitives";
import { AutoSubmitForm } from "@/components/admin/AutoSubmitForm";
import { Pagination } from "@/components/admin/ui/pagination";

export const dynamic = "force-dynamic";

const PAGE = 50;

// What counts as "stuck pending" — the customer left CCAvenue's hosted
// page or never reached it. Anything older than this with no callback
// almost certainly needs admin follow-up (no auto-sweeper today).
const STUCK_MINUTES = 15;

type StatusFilter = "all" | "pending" | "paid" | "failed" | "refunded";
// IST-aligned date presets — match the orders / dashboard pages so the
// three views describe the same slice when set to the same chip.
type RangeFilter = "today" | "week" | "month" | "all";

type Row = {
  payment_id: string;
  payment_status: string;
  payment_finalized: boolean;
  payment_mode: string | null;
  gateway_tracking_id: string | null;
  paid_amount: string | null;
  payment_created_at: string;
  payment_date: string | null;
  /** Last forensic message written by the reconcile cron / Refresh
   *  button — drives the "Live CCAvenue" column on the table. */
  gateway_response_message: string | null;
  is_stuck: boolean;
  order_id: string;
  order_number: string;
  order_total_paise: number;
  order_created_at: string;
  order_status: string;
  parent_name: string | null;
  parent_phone: string | null;
  student_name: string | null;
  items_count: number;
  units_count: number;
};

type StatsRow = {
  total: number;
  pending: number;
  paid: number;
  failed: number;
  stuck: number;
  collected_paise: number;
};

function rowsOf<T>(res: unknown): T[] {
  return (Array.isArray(res) ? res : ((res as { rows?: unknown[] }).rows ?? [])) as T[];
}

/** SQL fragment for the lower bound of the active range preset, in IST.
 *  Returns null for "all" so the caller can skip the WHERE clause. */
function rangeLowerBound(r: RangeFilter) {
  // AT TIME ZONE on a `date` yields a `timestamp without tz` (not a
  // timestamptz), shifting comparisons against `created_at` by 5h30. Use
  // date_trunc on the timestamp form so AT TIME ZONE returns an honest
  // timestamptz at IST midnight.
  if (r === "today")
    return sql`date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata'`;
  if (r === "week")
    return sql`date_trunc('week', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata'`;
  if (r === "month")
    return sql`date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata'`;
  return null;
}

/** Extract the raw CCAvenue status word from a forensic message like
 *  `CCAvenue 2026-05-28T12:30:21.397Z: status=No Record Found bankRef=…`. */
function extractCcaStatus(msg: string | null): string | null {
  if (!msg) return null;
  const m = msg.match(/status=([^\s][^]*?)(?:\s+bankRef=|$)/);
  return m ? m[1].trim() : null;
}

function relativeTime(iso: string): string {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function absoluteTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    status?: StatusFilter;
    range?: RangeFilter;
    page?: string;
  }>;
}) {
  const guard = await requireAnyPermission("payments.read", "payments.write");
  if (isResponse(guard)) redirect("/admin/dashboard");

  const sp = await searchParams;
  const term = (sp.q ?? "").trim();
  const status: StatusFilter =
    sp.status && ["pending", "paid", "failed", "refunded"].includes(sp.status)
      ? sp.status
      : "all";
  const range: RangeFilter =
    sp.range && ["today", "week", "month", "all"].includes(sp.range)
      ? sp.range
      : "month";
  const page = Math.max(1, parseInt(sp.page ?? "1") || 1);
  const cutoff = rangeLowerBound(range);
  const like = `%${term}%`;

  // ── Build WHERE — kept identical across stats + page queries so the
  //    Stat cards always describe the filtered slice the user sees.
  //
  //    Scope: only payments that originated from this app's /shop CCAvenue
  //    checkout flow. The ERP order importer (lib/erp-import-orders.ts)
  //    creates a synthetic `payments` row for every imported ERPNext SO
  //    and defaults `gateway_provider='CCAVENUE'` — those rows reference
  //    CCAvenue's native `SO…` order IDs in `gateway_order_id`, while our
  //    own create-order route (app/api/checkout/ccavenue/create-order)
  //    sets `gateway_order_id = orderNumber` (the `SAL-ORD-…` format).
  //    Pattern match on that prefix cleanly separates the two without
  //    needing a new source column.
  //
  //    NB: equality with `orders.order_number` is too strict — the ERP
  //    poller can rewrite `orders.order_number` after the fact when
  //    ERPNext assigns a different SO name, but `gateway_order_id` keeps
  //    the value our checkout originally allocated.
  const where = (() => {
    const conds = [
      sql`p.gateway_provider = 'CCAVENUE'`,
      sql`p.gateway_order_id LIKE 'SAL-ORD-%'`,
    ];
    if (status !== "all") conds.push(sql`p.status = ${status}`);
    if (cutoff) conds.push(sql`p.created_at >= ${cutoff}`);
    if (term) {
      conds.push(
        sql`(o.order_number ILIKE ${like} OR par.name ILIKE ${like} OR par.phone LIKE ${like} OR p.gateway_tracking_id ILIKE ${like})`
      );
    }
    return conds.reduce((a, b) => sql`${a} AND ${b}`);
  })();

  // ── Stats — single grouped query for the headline cards.
  const stats =
    rowsOf<StatsRow>(
      await db.execute(sql`
        SELECT
          count(*)::int AS total,
          count(*) FILTER (WHERE p.status = 'pending')::int  AS pending,
          count(*) FILTER (WHERE p.status = 'paid')::int     AS paid,
          count(*) FILTER (WHERE p.status = 'failed')::int   AS failed,
          count(*) FILTER (
            WHERE p.status = 'pending'
              AND p.payment_finalized = false
              AND o.created_at < now() - interval '${sql.raw(String(STUCK_MINUTES))} minutes'
          )::int AS stuck,
          -- Sum payment.amount: now per-order on every row (post 2026-06-04
          -- multi-sibling split). Each sibling order has its own payment
          -- row stamped with its own total, so SUM(p.amount) across the
          -- group still equals the basket total CCAvenue actually charged
          -- (gateway capture = sum of per-order totals). Total across all
          -- groups equals true GMV without double-counting.
          COALESCE(SUM(CASE WHEN p.status = 'paid' THEN p.amount ELSE 0 END), 0)::bigint AS collected_paise
          FROM payments p
          JOIN orders o ON o.id = p.order_id
          LEFT JOIN parents par ON par.id = o.parent_id
         WHERE ${where}
      `)
    )[0] ?? { total: 0, pending: 0, paid: 0, failed: 0, stuck: 0, collected_paise: 0 };

  const total = Number(stats.total ?? 0);
  const pages = Math.max(1, Math.ceil(total / PAGE));

  // ── Page rows.
  const rows = rowsOf<Row>(
    await db.execute(sql`
      SELECT
        p.id                                   AS payment_id,
        p.status::text                         AS payment_status,
        p.payment_finalized                    AS payment_finalized,
        p.payment_mode                         AS payment_mode,
        p.gateway_tracking_id                  AS gateway_tracking_id,
        p.paid_amount                          AS paid_amount,
        p.created_at::text                     AS payment_created_at,
        p.payment_date                         AS payment_date,
        p.gateway_response_message             AS gateway_response_message,
        (p.status = 'pending'
          AND p.payment_finalized = false
          AND o.created_at < now() - interval '${sql.raw(String(STUCK_MINUTES))} minutes'
        )                                      AS is_stuck,
        o.id                                   AS order_id,
        o.order_number                         AS order_number,
        o.total                                AS order_total_paise,
        o.created_at::text                     AS order_created_at,
        o.status::text                         AS order_status,
        par.name                               AS parent_name,
        par.phone                              AS parent_phone,
        st.name                                AS student_name,
        COALESCE((SELECT count(*)::int FROM order_items WHERE order_id = o.id), 0)         AS items_count,
        COALESCE((SELECT SUM(qty)::int FROM order_items WHERE order_id = o.id), 0)          AS units_count
        FROM payments p
        JOIN orders o ON o.id = p.order_id
        LEFT JOIN parents  par ON par.id = o.parent_id
        LEFT JOIN students st  ON st.id  = o.student_id
       WHERE ${where}
       ORDER BY p.created_at DESC
       LIMIT ${PAGE} OFFSET ${(page - 1) * PAGE}
    `)
  );

  const qp = (overrides: Partial<{ q: string; status: string; range: string; page: number }>) => {
    const params = new URLSearchParams();
    const next = {
      q: overrides.q ?? term,
      status: overrides.status ?? (status === "all" ? "" : status),
      range: overrides.range ?? range,
      page: String(overrides.page ?? 1),
    };
    for (const [k, v] of Object.entries(next)) {
      if (v) params.set(k, v);
    }
    return `/admin/payments?${params.toString()}`;
  };

  return (
    <div>
      <PageHeader
        eyebrow="Finance"
        title="Payments"
        description="CCAvenue checkouts from the shop. Cheques and bank transfers are under Manual Entries."
      />

      {/* ── Stat cards — each one is a filter. The ring marks the one in force. */}
      {(() => {
        const cards: { key: StatusFilter; label: string; value: React.ReactNode; hint?: string }[] = [
          { key: "all", label: "Transactions", value: total.toLocaleString("en-IN") },
          {
            key: "pending",
            label: "Pending",
            value: stats.pending.toLocaleString("en-IN"),
            hint: stats.stuck > 0 ? `${stats.stuck} stuck > ${STUCK_MINUTES} min` : undefined,
          },
          { key: "paid", label: "Successful", value: stats.paid.toLocaleString("en-IN") },
          { key: "failed", label: "Failed", value: stats.failed.toLocaleString("en-IN") },
        ];
        return (
          <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
            {cards.map((c) => (
              <Link
                key={c.key}
                href={qp({ status: c.key === "all" ? "" : c.key, page: 1 })}
                className={`block rounded-2xl ${status === c.key ? "ring-2 ring-brand/40" : ""}`}
              >
                <Stat label={c.label} value={c.value} hint={c.hint} />
              </Link>
            ))}
            <Stat label="Collected" value={<Money paise={Number(stats.collected_paise)} />} hint="Paid orders" />
          </div>
        );
      })()}

      {/* ── Stuck-pending callout ─────────────────────────────────────── */}
      {stats.stuck > 0 ? (
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3 text-[13px] text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
          <div className="flex-1">
            <span className="font-bold">{stats.stuck} stuck-pending checkout{stats.stuck === 1 ? "" : "s"}</span>{" "}
            — older than {STUCK_MINUTES} min with no gateway response; the customer likely closed the tab.{" "}
            <Link href={qp({ status: "pending", page: 1 })} className="font-semibold hover:text-amber-700">
              View pending →
            </Link>
          </div>
        </div>
      ) : null}

      {/* ── Filters ───────────────────────────────────────────────────── */}
      <AutoSubmitForm action="/admin/payments">
        <Toolbar>
          <SearchInput
            defaultValue={term}
            placeholder="Order #, customer, phone, or tracking ID…"
          />
          <FilterSelect label="Status" name="status" defaultValue={status === "all" ? "" : status}>
            <option value="pending">Pending</option>
            <option value="paid">Paid</option>
            <option value="failed">Failed</option>
            <option value="refunded">Refunded</option>
          </FilterSelect>
          <FilterSelect label="Period" noAll name="range" defaultValue={range}>
            <option value="today">Today</option>
            <option value="week">This week</option>
            <option value="month">This month</option>
            <option value="all">All time</option>
          </FilterSelect>
        </Toolbar>
      </AutoSubmitForm>

      {/* ── Results table ─────────────────────────────────────────────── */}
      <Card padded={false} className="overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState
            icon={CreditCard}
            title={term ? `No payments match “${term}”` : "No CCAvenue transactions"}
            description="Successful and failed checkouts appear here as they happen. Widen the period to see more."
          />
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <Th>Order</Th>
                <Th>Customer</Th>
                <Th right>Amount</Th>
                <Th>Status</Th>
                <Th>Method</Th>
                <Th>CCAvenue says</Th>
                <Th right>Items</Th>
                <Th>Time</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const tone = statusTone(r.payment_status);
                const detailHref = `/admin/payments/ccavenue/${r.order_id}`;
                // Latest raw CCAvenue status the reconcile cron or Refresh
                // button persisted — keeps this view in lock-step with
                // /admin/orders so a "No Record Found" surfaces here too.
                const live = extractCcaStatus(r.gateway_response_message);
                return (
                  // Whole-row click target — the stretched <Link> overlays
                  // the entire row, so clicking anywhere opens the detail.
                  <Tr key={r.payment_id} className="relative cursor-pointer">
                    <Td>
                      <Link
                        href={detailHref}
                        aria-label={`Open transaction ${r.order_number}`}
                        className="absolute inset-0 z-[1]"
                      />
                      <span className="block font-mono font-semibold text-ink-900">{r.order_number}</span>
                      {r.gateway_tracking_id ? (
                        <span className="mt-0.5 block font-mono text-[11.5px] font-normal text-ink-500">{r.gateway_tracking_id}</span>
                      ) : null}
                    </Td>
                    <Td>
                      <span className="block font-medium text-ink-900">{r.parent_name ?? "—"}</span>
                      <span className="block text-[12px] font-normal text-ink-500">
                        <span className="font-mono">{r.parent_phone ?? "—"}</span>
                        {r.student_name ? <span className="text-ink-400"> · {r.student_name}</span> : null}
                      </span>
                    </Td>
                    <Td right>
                      <Money paise={r.order_total_paise} className="font-semibold" />
                    </Td>
                    <Td>
                      <span className="inline-flex flex-wrap items-center gap-1">
                        <Badge size="sm" tone={tone} dot>{r.payment_status}</Badge>
                        {r.is_stuck ? <Badge size="sm" tone="warning">stuck</Badge> : null}
                      </span>
                    </Td>
                    <Td muted>{r.payment_mode ?? "—"}</Td>
                    <Td muted>{live ?? <span className="text-ink-300">—</span>}</Td>
                    <Td right>
                      {r.items_count}
                      {r.units_count > r.items_count ? (
                        <span className="ml-1 text-[11px] text-ink-400">({r.units_count} qty)</span>
                      ) : null}
                    </Td>
                    <Td muted className="whitespace-nowrap" title={absoluteTime(r.payment_created_at)}>
                      {relativeTime(r.payment_created_at)}
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </table>
          </div>
        )}
        {total > 0 ? (
          <Pagination
            page={page}
            pages={pages}
            from={(page - 1) * PAGE + 1}
            to={Math.min(page * PAGE, total)}
            total={total}
            noun="transaction"
            hrefFor={(p) => qp({ page: p })}
          />
        ) : null}
      </Card>
    </div>
  );
}
