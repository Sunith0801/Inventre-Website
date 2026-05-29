import "server-only";
import { sql, eq, desc } from "drizzle-orm";
import { db } from "@/db/client";
import {
  orders,
  parents,
  schools,
  products,
  productVariants,
  reviews,
} from "@/db/schema";

/** Bucketed display status used on the orders dashboard. Kept in sync
 *  with the CASE expression in app/admin/(protected)/orders/page.tsx so
 *  this dashboard's Recent Orders table shows the same label the orders
 *  list shows for the same row. */
export type OrderStatusBucket =
  | "confirmed"
  | "pending"
  | "aborted"
  | "failed"
  | "refunded"
  | null;

export type AdminStats = {
  totalSchools: number;
  totalParents: number;
  totalProducts: number;
  totalOrders: number;
  paidOrdersToday: number;
  gmvToday: number; // rupees
  /** Breakdown of `paidOrdersToday` by source — exposed inline so the
   *  dashboard can explain its gap with the CCAvenue page:
   *    - ccavenue: every paid order that maps to a CCAvenue
   *      transaction, including sibling orders in multi-school baskets
   *      (the parent paid once but received N distinct order numbers).
   *    - zeroValue: ₹0 baskets that bypass the gateway entirely
   *      (gateway_provider='COMPLIMENTARY' in the DB; renamed to
   *      "Zero Value Orders" everywhere admin-facing). */
  paidBreakdownToday: {
    ccavenue: number;
    zeroValue: number;
  };
  pendingReviews: number;
  lowStockSkus: number;
  recentOrders: {
    id: string;
    orderNumber: string;
    status: string;
    statusBucket: OrderStatusBucket;
    total: number;
    createdAt: string;
  }[];
};

export type DateRangeFilter = {
  /** Preset shortcut. `null` falls through to from/to (or no filter). */
  preset?: "today" | "week" | "month" | null;
  /** ISO date strings (YYYY-MM-DD) — interpreted as IST day boundaries. */
  from?: string | null;
  to?: string | null;
};

export async function getAdminStats(
  range: DateRangeFilter = {}
): Promise<AdminStats> {
  // "Today" is IST midnight → now, regardless of where the server runs.
  // Aligns with the orders page date filter so the dashboard's
  // "Paid orders today" matches what the user sees there.
  const istTodayStart = sql`((now() AT TIME ZONE 'Asia/Kolkata')::date) AT TIME ZONE 'Asia/Kolkata'`;

  // Resolve the range filter into a lower bound (>= ) and an upper
  // bound (< ) on orders.created_at. Presets are computed in IST; custom
  // from/to are interpreted as inclusive IST days.
  const lowerBound = (() => {
    if (range.preset === "today")
      return sql`((now() AT TIME ZONE 'Asia/Kolkata')::date) AT TIME ZONE 'Asia/Kolkata'`;
    if (range.preset === "week")
      return sql`date_trunc('week', (now() AT TIME ZONE 'Asia/Kolkata')::date) AT TIME ZONE 'Asia/Kolkata'`;
    if (range.preset === "month")
      return sql`date_trunc('month', (now() AT TIME ZONE 'Asia/Kolkata')::date) AT TIME ZONE 'Asia/Kolkata'`;
    if (range.from) return sql`${range.from}::date AT TIME ZONE 'Asia/Kolkata'`;
    return null;
  })();
  const upperBound = (() => {
    if (range.preset) return null; // open-ended → now()
    if (range.to)
      return sql`(${range.to}::date + INTERVAL '1 day') AT TIME ZONE 'Asia/Kolkata'`;
    return null;
  })();

  // Composable WHERE fragment for orders.created_at — appended to every
  // query in this file so the dashboard tiles + recent-orders table all
  // describe the same slice.
  const rangeWhere = sql`
    ${lowerBound ? sql`AND o.created_at >= ${lowerBound}` : sql``}
    ${upperBound ? sql`AND o.created_at <  ${upperBound}` : sql``}
  `;
  // Same fragment but aliased to the bare table for non-aliased queries.
  const rangeWhereBare = sql`
    ${lowerBound ? sql`AND ${orders.createdAt} >= ${lowerBound}` : sql``}
    ${upperBound ? sql`AND ${orders.createdAt} <  ${upperBound}` : sql``}
  `;
  const hasRange = !!(lowerBound || upperBound);

  // Same bucketing rule as app/admin/(protected)/orders/page.tsx —
  // joined here against the first payment per order so a pending order
  // whose CCAvenue refresh said "Aborted" classifies as 'aborted'
  // exactly the way the orders list classifies it.
  const bucketExpr = sql<string | null>`
    CASE
      WHEN o.payment_status = 'paid'                                  THEN 'confirmed'
      WHEN o.payment_status = 'refunded'                              THEN 'refunded'
      WHEN o.payment_status = 'failed'                                THEN 'failed'
      WHEN o.payment_status = 'pending'
        AND COALESCE(fp.gateway_response_message, '') ~* 'status=Aborted'
                                                                      THEN 'aborted'
      WHEN o.payment_status = 'pending'
        AND COALESCE(fp.gateway_response_message, '') ~* 'status=(Unsuccessful|Failure|Cancelled|Fraud|Invalid|Auto-Cancelled)'
                                                                      THEN 'failed'
      WHEN o.payment_status = 'pending'                               THEN 'pending'
      ELSE NULL
    END
  `;

  const [
    [{ schoolsCount }],
    [{ parentsCount }],
    [{ productsCount }],
    [{ ordersCount }],
    [{ paidToday }],
    [{ gmvTodayPaise }],
    breakdownRes,
    [{ pendingReviewsCount }],
    [{ lowStockCount }],
    recent,
  ] = await Promise.all([
    db.select({ schoolsCount: sql<number>`COUNT(*)` }).from(schools),
    db.select({ parentsCount: sql<number>`COUNT(*)` }).from(parents),
    db.select({ productsCount: sql<number>`COUNT(*)` }).from(products),
    // "Orders all-time" reads as "orders in the active range" when a
    // range is set; the dashboard relabels the tile accordingly.
    db
      .select({ ordersCount: sql<number>`COUNT(*)` })
      .from(orders)
      .where(sql`TRUE ${rangeWhereBare}`),
    // Paid + GMV honour the range when set, otherwise fall back to
    // "today" so the default-loaded dashboard still shows the familiar
    // KPIs without any filter applied.
    db
      .select({ paidToday: sql<number>`COUNT(*)` })
      .from(orders)
      .where(
        hasRange
          ? sql`${orders.paymentStatus} = 'paid' ${rangeWhereBare}`
          : sql`${orders.paymentStatus} = 'paid' AND ${orders.createdAt} >= ${istTodayStart}`
      ),
    db
      .select({
        gmvTodayPaise: sql<number>`COALESCE(SUM(${orders.total}), 0)`,
      })
      .from(orders)
      .where(
        hasRange
          ? sql`${orders.paymentStatus} = 'paid' ${rangeWhereBare}`
          : sql`${orders.paymentStatus} = 'paid' AND ${orders.createdAt} >= ${istTodayStart}`
      ),
    // Breakdown of paid orders by source for the same paid_window the GMV
    // tile shows — drives the inline hint that reconciles the
    // dashboard count with the CCAvenue page count.
    db.execute(sql`
      WITH paid_window AS (
        SELECT o.id, o.total, o.order_group_id, p.gateway_provider, p.gateway_order_id
          FROM orders o
          LEFT JOIN payments p ON p.order_id = o.id
         WHERE o.payment_status = 'paid'
           ${hasRange
              ? rangeWhere
              : sql`AND o.created_at >= ${istTodayStart}`}
      ),
      classified AS (
        SELECT id,
               CASE
                 WHEN gateway_provider = 'COMPLIMENTARY' OR total = 0
                                                                       THEN 'zeroValue'
                 -- Sibling orders share a CCAvenue transaction with
                 -- another order in the same basket. They're distinct
                 -- order numbers paid via CCAvenue, so they count under
                 -- ccavenue — not as their own bucket — matching the
                 -- way the parent thinks of "I paid through CCAvenue
                 -- once and got 2 orders".
                 WHEN gateway_provider IS NULL
                   AND EXISTS (
                     SELECT 1 FROM payments p2
                       JOIN orders sib ON sib.id = p2.order_id
                      WHERE sib.order_group_id = paid_window.order_group_id
                        AND sib.id <> paid_window.id
                        AND p2.status = 'paid'
                        AND p2.gateway_provider = 'CCAVENUE'
                   )
                                                                       THEN 'ccavenue'
                 WHEN gateway_provider = 'CCAVENUE' AND gateway_order_id LIKE 'SAL-ORD-%'
                                                                       THEN 'ccavenue'
                 ELSE 'other'
               END AS bucket
          FROM paid_window
      )
      SELECT bucket, COUNT(*)::int AS n
        FROM classified
       GROUP BY 1
    `),
    db
      .select({ pendingReviewsCount: sql<number>`COUNT(*)` })
      .from(reviews)
      .where(eq(reviews.status, "pending")),
    db
      .select({ lowStockCount: sql<number>`COUNT(*)` })
      .from(productVariants)
      .where(sql`${productVariants.stockQty} <= ${productVariants.lowStockThreshold}`),
    db.execute(sql`
      WITH first_payment AS (
        SELECT DISTINCT ON (order_id)
               order_id, gateway_response_message
          FROM payments
         ORDER BY order_id, created_at ASC
      )
      SELECT o.id::text                                  AS id,
             o.order_number                              AS "orderNumber",
             o.status::text                              AS status,
             ${bucketExpr}                               AS "statusBucket",
             o.total                                     AS total,
             o.created_at                                AS "createdAt"
        FROM orders o
        LEFT JOIN first_payment fp ON fp.order_id = o.id
       WHERE TRUE ${rangeWhere}
       ORDER BY o.created_at DESC
       LIMIT 10
    `),
  ]);

  const recentRows = (Array.isArray(recent)
    ? recent
    : ((recent as { rows?: unknown[] }).rows ?? [])) as {
    id: string;
    orderNumber: string;
    status: string;
    statusBucket: string | null;
    total: number | string;
    createdAt: string | Date;
  }[];

  const breakdownRows = (Array.isArray(breakdownRes)
    ? breakdownRes
    : ((breakdownRes as { rows?: unknown[] }).rows ?? [])) as {
    bucket: string;
    n: number;
  }[];
  const bucketCount = (b: string) =>
    Number(breakdownRows.find((r) => r.bucket === b)?.n ?? 0);

  return {
    totalSchools: Number(schoolsCount),
    totalParents: Number(parentsCount),
    totalProducts: Number(productsCount),
    totalOrders: Number(ordersCount),
    paidOrdersToday: Number(paidToday),
    gmvToday: Math.round(Number(gmvTodayPaise) / 100),
    paidBreakdownToday: {
      ccavenue: bucketCount("ccavenue"),
      zeroValue: bucketCount("zeroValue"),
    },
    pendingReviews: Number(pendingReviewsCount),
    lowStockSkus: Number(lowStockCount),
    recentOrders: recentRows.map((r) => ({
      id: r.id,
      orderNumber: r.orderNumber,
      status: r.status,
      statusBucket: (r.statusBucket as OrderStatusBucket) ?? null,
      total: Math.round(Number(r.total) / 100),
      createdAt:
        r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
    })),
  };
}
