import Link from "next/link";
import { redirect } from "next/navigation";
import { ShoppingBag } from "lucide-react";
import { db } from "@/db/client";
import { sql } from "drizzle-orm";
import { requireAnyPermission, isResponse } from "@/lib/admin-guard";
import {
  PageHeader,
  Card,
  Toolbar,
  SearchInput,
  EmptyState,
} from "@/components/admin/ui/primitives";
import { SyncFromErpButton } from "@/components/admin/SyncFromErpButton";
import { OrdersBulkRefresh } from "@/components/admin/OrdersBulkRefresh";
import { AutoSubmitForm } from "@/components/admin/AutoSubmitForm";

export const dynamic = "force-dynamic";

const PAGE = 50;

type Row = {
  erp_name: string;
  customer: string | null;
  transaction_date: string | null;
  delivery_date: string | null;
  status: string | null;
  grand_total: number;
  per_delivered: number;
  per_billed: number;
  /** Local orders.id when this row came from the local DB; null when
   *  the row only lives in the ERPNext mirror. Drives whether the
   *  per-row delete chip renders + which detail route the link points
   *  at (uuid path vs erp_name fallback). */
  local_id: string | null;
  /** Ordering context — surfaced on every row so admins can scan the
   *  list without opening each detail page. Sources populate the four
   *  fields from whatever shape they have (snapshots on local, custom_*
   *  on the ERP mirror; the legacy table has none of them and renders
   *  as "—"). ordered_at is timestamptz so we can render IST below. */
  school_name: string | null;
  enrollment_number: string | null;
  grade: string | null;
  ordered_at: string | null;
  /** CCAvenue's primary reference. Local orders read from
   *  payments.gateway_tracking_id (populated only after a successful
   *  payment); mirror rows fall back to custom_gateway_order_id. The
   *  cell on the list uses tracking_id when present, else gateway_order_id
   *  (which is just our own order_number echoed back), else "—". */
  cca_tracking_id: string | null;
  cca_order_id: string | null;
  /** Local payment_status enum: paid / pending / failed / refunded.
   *  Only populated for orders that came from the local `orders` table;
   *  mirror + legacy rows leave this NULL (their status field above
   *  carries fulfilment, not payment). The "Payment status" filter on
   *  the toolbar narrows on this column. */
  payment_status: string | null;
  /** Last forensic message written by the reconcile cron / Refresh button.
   *  Format: "CCAvenue <iso>: status=<raw> [bankRef=…]". Surfaced on the
   *  list as the live status for orders still in pending while CCAvenue
   *  reports Initiated / Awaited / etc. — keeps admins from staring at a
   *  stale "placed" label until the local payment_status flips. */
  gateway_response_message: string | null;
  /** Bucketed display status — one of `confirmed | pending | failed |
   *  aborted | refunded | null`. Drives both the Status column badge
   *  and the active KPI tile / Status filter. NULL for ERP-mirror /
   *  legacy rows that have no local payment row. */
  status_bucket: string | null;
};

function rowsOf<T>(res: unknown): T[] {
  return (Array.isArray(res) ? res : ((res as { rows?: unknown[] }).rows ?? [])) as T[];
}
// Display helpers (`inr`, `fmt`, `fmtIst`) live in `OrdersBulkRefresh.tsx`
// — the client component that owns the table render. The server page only
// shapes the data.

/** Single KPI tile — server-rendered <a>, no client interactivity.
 *  Clicking navigates to the same page with the `paymentStatus` filter
 *  applied. The active tile gets a thicker border + ring so the user
 *  can see which filter is currently in effect.
 *
 *  Declared above the page component (instead of below) because async
 *  server-component bodies don't hoist function declarations into the
 *  JSX scope — referencing it after the page function definition
 *  produces a runtime ReferenceError at SSR time. */
const KpiTile = ({
  label,
  value,
  href,
  active,
  tone,
}: {
  label: string;
  value: number;
  href: string;
  active: boolean;
  tone: "success" | "warning" | "danger" | "violet" | "neutral";
}) => {
  const toneClasses = {
    success: "bg-emerald-50 border-emerald-200 text-emerald-900",
    warning: "bg-amber-50 border-amber-200 text-amber-900",
    danger: "bg-red-50 border-red-200 text-red-900",
    violet: "bg-violet-50 border-violet-200 text-violet-900",
    neutral: "bg-ink-50 border-ink-200 text-ink-900",
  }[tone];
  const activeRing = active
    ? "ring-2 ring-offset-1 ring-brand-500 border-brand-500"
    : "hover:shadow-sm";
  return (
    <a
      href={href}
      className={`block rounded-xl border px-4 py-3 transition-all ${toneClasses} ${activeRing}`}
    >
      <div className="text-[10.5px] font-semibold uppercase tracking-[0.08em] opacity-70">
        {label}
      </div>
      <div className="mt-1 font-display text-[22px] font-extrabold tabular-nums leading-none">
        {value.toLocaleString("en-IN")}
      </div>
    </a>
  );
};

export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    statusBucket?: string;
    dateRange?: string;
    from?: string;
    to?: string;
    page?: string;
  }>;
}) {
  const guard = await requireAnyPermission("orders.read", "orders.write");
  if (isResponse(guard)) redirect("/admin/dashboard");

  const { q, statusBucket, dateRange, from, to, page: pageStr } = await searchParams;
  const page = Math.max(1, parseInt(pageStr ?? "1") || 1);
  const term = (q ?? "").trim();
  const like = `%${term}%`;

  // Date-range filter. Presets resolve to IST day boundaries server-side
  // so "Today" means "Asia/Kolkata midnight → now" regardless of which
  // timezone the request lands in. Custom range falls through to the
  // explicit from/to inputs.
  const dateBound = (() => {
    // `(now() AT TIME ZONE 'Asia/Kolkata')::date AT TIME ZONE 'Asia/Kolkata'`
    // returns a `timestamp without tz` (not a timestamptz), because
    // AT TIME ZONE on a `date` casts via timestamp first. Postgres then
    // compares it against `timestamptz` columns using session TZ (UTC),
    // shifting the IST-today window by 5h30. Use `date_trunc('day', …)` so
    // the inner value stays `timestamp without tz` and AT TIME ZONE returns
    // an honest `timestamptz` at IST midnight.
    if (dateRange === "today") return sql`COALESCE(u.ordered_at, u.transaction_date)::timestamptz >= date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata'`;
    if (dateRange === "week") return sql`COALESCE(u.ordered_at, u.transaction_date)::timestamptz >= date_trunc('week', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata'`;
    if (dateRange === "month") return sql`COALESCE(u.ordered_at, u.transaction_date)::timestamptz >= date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata'`;
    return null;
  })();

  // Source = UNION of three sources of truth, deduped by erp_name. See
  // unionCte below.
  // Filters split into two groups:
  //   `whereNoBucket` — applied to KPI counts (so clicking a KPI tile
  //     narrows the table but doesn't shrink its own count).
  //   `where` — adds the status-bucket filter; drives the table query.
  const baseConds = [sql`TRUE`];
  if (term) baseConds.push(sql`(u.erp_name ILIKE ${like} OR u.customer ILIKE ${like})`);
  if (dateBound) baseConds.push(dateBound);
  if (from) baseConds.push(sql`COALESCE(u.ordered_at, u.transaction_date)::date >= ${from}::date`);
  if (to) baseConds.push(sql`COALESCE(u.ordered_at, u.transaction_date)::date <= ${to}::date`);
  const whereNoBucket = baseConds.reduce((a, b) => sql`${a} AND ${b}`);
  const bucketConds = [...baseConds];
  if (statusBucket) bucketConds.push(sql`u.status_bucket = ${statusBucket}`);
  const where = bucketConds.reduce((a, b) => sql`${a} AND ${b}`);

  // Performance note: the LATERAL "first payment per order" subquery was
  // O(orders × payment scan) and pushed the page to 8s+ on a 16k catalog.
  // Pre-aggregating into a `first_payment` CTE drops that to a single
  // index scan + hash join — 100× faster (8.7s → 88ms in EXPLAIN).
  const unionCte = sql.raw(`
    WITH first_payment AS (
      SELECT DISTINCT ON (order_id)
             order_id, gateway_tracking_id, gateway_order_id, gateway_response_message
        FROM payments
       ORDER BY order_id, created_at ASC
    ),
    unified AS (
      SELECT DISTINCT ON (erp_name)
             erp_name, customer, transaction_date, delivery_date, status,
             grand_total, per_delivered, per_billed, local_id,
             school_name, enrollment_number, grade, ordered_at,
             cca_tracking_id, cca_order_id, payment_status,
             gateway_response_message,
             -- Display bucket: collapses (payment_status, raw CCAvenue
             -- status) into 4 visible states. Drives both the table's
             -- Status column and the KPI tiles / Status filter, so they
             -- always agree.
             CASE
               WHEN payment_status = 'paid'                                  THEN 'confirmed'
               WHEN payment_status = 'refunded'                              THEN 'refunded'
               WHEN payment_status = 'failed'                                THEN 'failed'
               WHEN payment_status = 'pending'
                 AND COALESCE(gateway_response_message, '') ~* 'status=Aborted'
                                                                             THEN 'aborted'
               WHEN payment_status = 'pending'
                 AND COALESCE(gateway_response_message, '') ~* 'status=(Unsuccessful|Failure|Cancelled|Fraud|Invalid|Auto-Cancelled)'
                                                                             THEN 'failed'
               WHEN payment_status = 'pending'                               THEN 'pending'
               ELSE NULL
             END AS status_bucket
        FROM (
          -- 1. Local storefront orders
          -- orders.total is stored in PAISE (1/100 rupee); divide by 100
          -- so display matches the ERP-side grand_total (which is rupees).
          -- school/grade/enrollment use the snapshot columns first (they
          -- pin the order to the school+grade the parent saw at checkout),
          -- falling back to the live FKs for legacy rows without snapshots.
          SELECT o.order_number                                AS erp_name,
                 -- Customer column shows the STUDENT name (sales are tied
                 -- to a student); fall back to parent/receiver only when
                 -- the order has no linked student record.
                 COALESCE(stu.name, p.name, o.shipping_address->>'receiverName') AS customer,
                 o.created_at::date::text                      AS transaction_date,
                 NULL::text                                    AS delivery_date,
                 o.status::text                                AS status,
                 round((o.total::numeric / 100), 0)::int       AS grand_total,
                 0::float                                      AS per_delivered,
                 0::float                                      AS per_billed,
                 o.id::text                                    AS local_id,
                 COALESCE(o.school_name_snapshot, s.school_name, s.name) AS school_name,
                 stu.enrollment_number                         AS enrollment_number,
                 COALESCE(o.grade_snapshot, stu.grade)         AS grade,
                 COALESCE(o.placed_at, o.created_at)::text     AS ordered_at,
                 fp.gateway_tracking_id                        AS cca_tracking_id,
                 fp.gateway_order_id                           AS cca_order_id,
                 o.payment_status::text                        AS payment_status,
                 fp.gateway_response_message                   AS gateway_response_message,
                 1                                             AS pri
            FROM orders o
            LEFT JOIN parents p   ON p.id   = o.parent_id
            LEFT JOIN schools s   ON s.id   = o.school_id
            LEFT JOIN students stu ON stu.id = o.student_id
            LEFT JOIN first_payment fp ON fp.order_id = o.id
          UNION ALL
          -- 2. Mirror (ERP-side round-trip). erp.sales_orders carries the
          -- school/grade as the human label ("KLINK-Kidlink School" etc.).
          -- The "student" field is ERP Students.name which is the
          -- enrollment number for this catalog. creation_at is the
          -- precise insert timestamp on the mirror table itself, which
          -- is the best proxy for order time when the row originated on
          -- the ERP side.
          SELECT so.erp_name,
                 -- Prefer the locally-known student name (joined by
                 -- enrolment number) over the ERP's customer_name, which
                 -- is the guardian/billing contact on the mirror side.
                 COALESCE(stu_m.name, so.customer_name)        AS customer,
                 so.transaction_date::text,
                 so.delivery_date::text,
                 COALESCE(so.custom_display_status, so.status) AS status,
                 round(so.grand_total::numeric, 0)::int        AS grand_total,
                 COALESCE(so.per_delivered, 0)                 AS per_delivered,
                 COALESCE(so.per_billed,    0)                 AS per_billed,
                 NULL::text                                    AS local_id,
                 so.custom_student_school                      AS school_name,
                 so.student                                    AS enrollment_number,
                 so.custom_student_grade                       AS grade,
                 so.creation_at::text                          AS ordered_at,
                 NULL::text                                    AS cca_tracking_id,
                 so.custom_internal_payment_reference          AS cca_order_id,
                 so.custom_payment_status                      AS payment_status,
                 NULL::text                                    AS gateway_response_message,
                 2                                             AS pri
            FROM erp.sales_orders so
            LEFT JOIN students stu_m ON stu_m.enrollment_number = so.student
          UNION ALL
          -- 3. Legacy bulk ERPNext sync — has no school/grade/enrollment
          -- breakdown; renders as "—" in the new columns.
          SELECT erp_name, customer,
                 transaction_date::text, delivery_date::text,
                 status,
                 round(grand_total::numeric, 0)::int,
                 COALESCE(per_delivered, 0),
                 COALESCE(per_billed,    0),
                 NULL::text                                    AS local_id,
                 NULL::text                                    AS school_name,
                 NULL::text                                    AS enrollment_number,
                 NULL::text                                    AS grade,
                 NULL::text                                    AS ordered_at,
                 NULL::text                                    AS cca_tracking_id,
                 NULL::text                                    AS cca_order_id,
                 NULL::text                                    AS payment_status,
                 NULL::text                                    AS gateway_response_message,
                 3                                             AS pri
            FROM erp_sales_orders
        ) src
       ORDER BY erp_name, pri
    )
  `);

  const total = Number(
    rowsOf<{ n: number }>(
      await db.execute(
        sql`${unionCte} SELECT count(*)::int AS n FROM unified u WHERE ${where}`
      )
    )[0]?.n ?? 0
  );
  const pages = Math.ceil(total / PAGE);

  const rows = rowsOf<Row>(
    await db.execute(
      sql`${unionCte}
          SELECT erp_name, customer, transaction_date, delivery_date, status,
                 grand_total, per_delivered, per_billed, local_id,
                 school_name, enrollment_number, grade, ordered_at,
                 cca_tracking_id, cca_order_id, payment_status,
                 gateway_response_message, status_bucket
            FROM unified u WHERE ${where}
           ORDER BY ordered_at DESC NULLS LAST, transaction_date DESC NULLS LAST, erp_name DESC
           LIMIT ${PAGE} OFFSET ${(page - 1) * PAGE}`
    )
  );

  // KPI counts — grouped by the same status_bucket the table uses, and
  // honouring every active filter EXCEPT the bucket filter itself so
  // clicking a tile narrows the rows without zeroing the other tiles.
  const kpiRes = await db.execute(
    sql`${unionCte}
        SELECT status_bucket, COUNT(*)::int AS n
          FROM unified u WHERE ${whereNoBucket}
         GROUP BY 1`
  );
  const kpiRows = rowsOf<{ status_bucket: string | null; n: number }>(kpiRes);
  const bucketCount = (b: string) =>
    kpiRows.find((r) => r.status_bucket === b)?.n ?? 0;
  const kpis = {
    confirmed: bucketCount("confirmed"),
    pending: bucketCount("pending"),
    aborted: bucketCount("aborted"),
    failed: bucketCount("failed"),
    refunded: bucketCount("refunded"),
    total: kpiRows.reduce((s, r) => s + r.n, 0),
  };

  // Helper that builds an `/admin/orders?…` URL preserving every active
  // filter while overriding any subset of (statusBucket, page).
  const qp = (overrides: { page?: number; statusBucket?: string | null }) => {
    const params = new URLSearchParams();
    if (term) params.set("q", term);
    if (dateRange) params.set("dateRange", dateRange);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    const sb =
      overrides.statusBucket === undefined ? statusBucket : overrides.statusBucket;
    if (sb) params.set("statusBucket", sb);
    if (overrides.page) params.set("page", String(overrides.page));
    return `/admin/orders${params.toString() ? `?${params}` : ""}`;
  };

  return (
    <div>
      <PageHeader
        eyebrow="Sales"
        title="Sales Orders"
        description={`${total.toLocaleString("en-IN")} orders to deliver — from ERPNext (Inventre Edu Services Pvt Ltd).`}
        actions={
          guard.role === "super" ? <SyncFromErpButton /> : undefined
        }
      />

      {/* KPI tiles — reflect every active filter except the bucket
          filter itself. Click any tile to narrow / clear the Status
          filter; the active tile gets a ring + bold border. */}
      <div className="mb-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <KpiTile
          label="All orders"
          value={kpis.total}
          href={qp({ statusBucket: null, page: 1 })}
          active={!statusBucket}
          tone="neutral"
        />
        <KpiTile
          label="Confirmed"
          value={kpis.confirmed}
          href={qp({ statusBucket: "confirmed", page: 1 })}
          active={statusBucket === "confirmed"}
          tone="success"
        />
        <KpiTile
          label="Pending"
          value={kpis.pending}
          href={qp({ statusBucket: "pending", page: 1 })}
          active={statusBucket === "pending"}
          tone="warning"
        />
        <KpiTile
          label="Aborted"
          value={kpis.aborted}
          href={qp({ statusBucket: "aborted", page: 1 })}
          active={statusBucket === "aborted"}
          tone="danger"
        />
        <KpiTile
          label="Failed"
          value={kpis.failed}
          href={qp({ statusBucket: "failed", page: 1 })}
          active={statusBucket === "failed"}
          tone="danger"
        />
      </div>

      {/* 650 ms debounce: each navigation re-runs a heavy CTE across
          orders + ERP mirror + legacy table, so we'd rather wait for the
          user to finish typing than fire mid-word. */}
      <AutoSubmitForm action="/admin/orders" debounceMs={650}>
        <Toolbar>
          <SearchInput
            defaultValue={term}
            placeholder="Search order # or customer…"
          />
          <select
            name="statusBucket"
            defaultValue={statusBucket ?? ""}
            className="h-9 px-2.5 rounded-lg border border-ink-200 text-[13px] bg-white"
          >
            <option value="">All statuses</option>
            <option value="confirmed">Confirmed</option>
            <option value="pending">Pending</option>
            <option value="aborted">Aborted by Customer</option>
            <option value="failed">Failed</option>
          </select>
          <select
            name="dateRange"
            defaultValue={dateRange ?? ""}
            className="h-9 px-2.5 rounded-lg border border-ink-200 text-[13px] bg-white"
          >
            <option value="">All time</option>
            <option value="today">Today</option>
            <option value="week">This week</option>
            <option value="month">This month</option>
          </select>
          <input
            type="date"
            name="from"
            defaultValue={from ?? ""}
            className="h-9 px-2.5 rounded-lg border border-ink-200 text-[13px] bg-white"
            aria-label="From date"
          />
          <input
            type="date"
            name="to"
            defaultValue={to ?? ""}
            className="h-9 px-2.5 rounded-lg border border-ink-200 text-[13px] bg-white"
            aria-label="To date"
          />
        </Toolbar>
      </AutoSubmitForm>

      <Card padded={false}>
        {rows.length === 0 ? (
          <EmptyState
            icon={ShoppingBag}
            title={term ? `No orders match “${term}”` : "No orders"}
            description="ERPNext Sales Orders awaiting delivery appear here."
          />
        ) : (
          <OrdersBulkRefresh rows={rows} isSuperAdmin={guard.role === "super"} />
        )}
      </Card>

      {pages > 1 ? (
        <div className="flex items-center gap-2 mt-4 text-[13px]">
          {page > 1 ? (
            <Link
              href={qp({ page: page - 1 })}
              className="px-3 py-1.5 rounded-lg border border-ink-200 bg-white"
            >
              ‹ Prev
            </Link>
          ) : null}
          <span className="text-ink-500">
            Page {page} of {pages}
          </span>
          {page < pages ? (
            <Link
              href={qp({ page: page + 1 })}
              className="px-3 py-1.5 rounded-lg border border-ink-200 bg-white"
            >
              Next ›
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
