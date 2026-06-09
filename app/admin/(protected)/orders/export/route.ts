import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { sql } from "drizzle-orm";
import { requireAnyPermission, isResponse } from "@/lib/admin-guard";

export const dynamic = "force-dynamic";

// CSV export of /admin/orders. Honours the same filters as the listing
// page (q / statusBucket / dateRange / from / to) and emits one row per
// SO line item, with sub-items as additional rows whose "Parent Item
// Code" cell points back at the top-level line.

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

type ItemRow = {
  so_id: string;
  enrollment: string | null;
  student: string | null;
  school: string | null;
  grade: string | null;
  ordered_at: string | null;
  status: string | null;
  payment_status: string | null;
  grand_total: number | null;
  item_code: string | null;
  item_name: string | null;
  qty: number | string | null;
  rate: number | string | null;
  amount: number | string | null;
  parent_item_code: string | null;
};

export async function GET(req: Request) {
  const guard = await requireAnyPermission("orders.read", "orders.write");
  if (isResponse(guard)) return guard;

  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const statusBucket = url.searchParams.get("statusBucket") ?? "";
  const dateRange = url.searchParams.get("dateRange") ?? "";
  const from = url.searchParams.get("from") ?? "";
  const to = url.searchParams.get("to") ?? "";
  const like = `%${q}%`;

  // Same IST-aware date bound the listing page uses.
  const dateBound =
    dateRange === "today"
      ? sql`COALESCE(u.ordered_at, u.transaction_date)::timestamptz >= date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata'`
      : dateRange === "week"
        ? sql`COALESCE(u.ordered_at, u.transaction_date)::timestamptz >= date_trunc('week', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata'`
        : dateRange === "month"
          ? sql`COALESCE(u.ordered_at, u.transaction_date)::timestamptz >= date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata'`
          : null;

  const conds = [sql`TRUE`];
  if (q) conds.push(sql`(u.erp_name ILIKE ${like} OR u.customer ILIKE ${like})`);
  if (dateBound) conds.push(dateBound);
  if (from) conds.push(sql`COALESCE(u.ordered_at, u.transaction_date)::date >= ${from}::date`);
  if (to) conds.push(sql`COALESCE(u.ordered_at, u.transaction_date)::date <= ${to}::date`);
  if (statusBucket) conds.push(sql`u.status_bucket = ${statusBucket}`);
  const where = conds.reduce((a, b) => sql`${a} AND ${b}`);

  // Mirrors page.tsx's unified CTE so the export set matches what the
  // admin sees on screen, but only keeps the columns we need for the
  // CSV plus a `source` flag that decides whether to look up local
  // order_items.
  const query = sql`
    WITH first_payment AS (
      SELECT DISTINCT ON (order_id)
             order_id, gateway_response_message
        FROM payments
       ORDER BY order_id, created_at ASC
    ),
    unified AS (
      SELECT DISTINCT ON (erp_name)
             erp_name, customer, transaction_date, status,
             grand_total, school_name, enrollment_number, grade, ordered_at,
             payment_status, gateway_response_message, source,
             CASE
               WHEN payment_status = 'paid'      THEN 'confirmed'
               WHEN payment_status = 'refunded'  THEN 'refunded'
               WHEN payment_status = 'failed'    THEN 'failed'
               WHEN payment_status = 'pending'
                 AND COALESCE(gateway_response_message, '') ~* 'status=Aborted'
                                                 THEN 'aborted'
               WHEN payment_status = 'pending'
                 AND COALESCE(gateway_response_message, '') ~* 'status=(Unsuccessful|Failure|Cancelled|Fraud|Invalid|Auto-Cancelled)'
                                                 THEN 'failed'
               WHEN payment_status = 'pending'   THEN 'pending'
               ELSE NULL
             END AS status_bucket
        FROM (
          SELECT o.order_number                                AS erp_name,
                 COALESCE(stu.name, p.name, o.shipping_address->>'receiverName') AS customer,
                 o.created_at::date::text                      AS transaction_date,
                 o.status::text                                AS status,
                 round((o.total::numeric / 100), 0)::int       AS grand_total,
                 COALESCE(o.school_name_snapshot, s.school_name, s.name) AS school_name,
                 stu.enrollment_number                         AS enrollment_number,
                 COALESCE(o.grade_snapshot, stu.grade)         AS grade,
                 COALESCE(o.placed_at, o.created_at)::text     AS ordered_at,
                 o.payment_status::text                        AS payment_status,
                 fp.gateway_response_message                   AS gateway_response_message,
                 'local'::text                                 AS source,
                 1                                             AS pri
            FROM orders o
            LEFT JOIN parents p   ON p.id   = o.parent_id
            LEFT JOIN schools s   ON s.id   = o.school_id
            LEFT JOIN students stu ON stu.id = o.student_id
            LEFT JOIN first_payment fp ON fp.order_id = o.id
          UNION ALL
          SELECT so.erp_name,
                 COALESCE(stu_m.name, so.customer_name)        AS customer,
                 so.transaction_date::text,
                 COALESCE(so.custom_display_status, so.status) AS status,
                 round(so.grand_total::numeric, 0)::int        AS grand_total,
                 so.custom_student_school                      AS school_name,
                 so.student                                    AS enrollment_number,
                 so.custom_student_grade                       AS grade,
                 so.creation_at::text                          AS ordered_at,
                 so.custom_payment_status                      AS payment_status,
                 NULL::text                                    AS gateway_response_message,
                 'erp'::text                                   AS source,
                 2                                             AS pri
            FROM erp.sales_orders so
            LEFT JOIN students stu_m ON stu_m.enrollment_number = so.student
          UNION ALL
          SELECT erp_name, customer,
                 transaction_date::text, status,
                 round(grand_total::numeric, 0)::int,
                 NULL::text, NULL::text, NULL::text, NULL::text,
                 NULL::text, NULL::text,
                 'legacy'::text                                AS source,
                 3                                             AS pri
            FROM erp_sales_orders
        ) src
       ORDER BY erp_name, pri
    ),
    filtered AS (
      SELECT u.erp_name, u.customer, u.school_name, u.enrollment_number,
             u.grade, u.ordered_at, u.status, u.payment_status,
             u.grand_total, u.source
        FROM unified u
       WHERE ${where}
    )
    SELECT
      f.erp_name                                AS so_id,
      f.enrollment_number                       AS enrollment,
      f.customer                                AS student,
      f.school_name                             AS school,
      f.grade                                   AS grade,
      f.ordered_at                              AS ordered_at,
      f.status                                  AS status,
      f.payment_status                          AS payment_status,
      f.grand_total                             AS grand_total,
      x.item_code                               AS item_code,
      x.item_name                               AS item_name,
      x.qty                                     AS qty,
      x.rate                                    AS rate,
      x.amount                                  AS amount,
      x.parent_item_code                        AS parent_item_code
    FROM filtered f
    LEFT JOIN LATERAL (
      -- ERP top-level items
      SELECT i.item_code, i.item_name,
             i.qty::numeric AS qty, i.rate::numeric AS rate, i.amount::numeric AS amount,
             NULL::text AS parent_item_code,
             0 AS line_pri, i.id AS line_seq
        FROM erp.sales_order_items i
       WHERE i.order_erp_name = f.erp_name
      UNION ALL
      -- ERP sub-items (kit components, etc.)
      SELECT si.item_code, NULL::text AS item_name,
             si.qty::numeric AS qty, NULL::numeric AS rate, NULL::numeric AS amount,
             si.parent_item_code,
             1 AS line_pri, si.id AS line_seq
        FROM erp.sales_order_sub_items si
       WHERE si.order_erp_name = f.erp_name
      UNION ALL
      -- Local order_items, only when this row hasn't been mirrored to
      -- ERP yet (otherwise we'd double up with the rows above).
      SELECT oi.name_snapshot AS item_code, oi.name_snapshot AS item_name,
             oi.qty::numeric AS qty,
             (oi.unit_price::numeric / 100) AS rate,
             (oi.total::numeric / 100) AS amount,
             NULL::text AS parent_item_code,
             0 AS line_pri, NULL::int AS line_seq
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
       WHERE f.source = 'local'
         AND o.order_number = f.erp_name
         AND NOT EXISTS (
           SELECT 1 FROM erp.sales_order_items ii WHERE ii.order_erp_name = f.erp_name
         )
      ORDER BY line_pri, line_seq NULLS LAST
    ) x ON TRUE
    ORDER BY f.ordered_at DESC NULLS LAST, f.erp_name DESC
  `;

  const result = await db.execute(query);
  const list = (Array.isArray(result)
    ? result
    : ((result as { rows?: unknown[] }).rows ?? [])) as ItemRow[];

  const header = [
    "SO ID",
    "Enrollment ID",
    "Student",
    "School",
    "Grade",
    "Order Date (IST)",
    "Status",
    "Payment Status",
    "Grand Total (INR)",
    "Item Code",
    "Item Name",
    "Qty",
    "Rate",
    "Amount",
    "Parent Item Code",
  ];

  const fmtIst = (iso: string | null) => {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  };

  const lines = [header.map(csvEscape).join(",")];
  for (const r of list) {
    lines.push(
      [
        r.so_id,
        r.enrollment,
        r.student,
        r.school,
        r.grade,
        fmtIst(r.ordered_at),
        r.status,
        r.payment_status,
        r.grand_total,
        r.item_code,
        r.item_name,
        r.qty,
        r.rate,
        r.amount,
        r.parent_item_code,
      ]
        .map(csvEscape)
        .join(","),
    );
  }

  const filenameParts = ["sales-orders"];
  if (statusBucket) filenameParts.push(statusBucket);
  if (dateRange) filenameParts.push(dateRange);
  if (from) filenameParts.push(`from-${from}`);
  if (to) filenameParts.push(`to-${to}`);
  filenameParts.push(new Date().toISOString().slice(0, 10));
  const filename = `${filenameParts.join("_")}.csv`;

  // UTF-8 BOM so Excel auto-detects non-ASCII school names correctly.
  const body = "﻿" + lines.join("\r\n");

  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
