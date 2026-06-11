import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { sql } from "drizzle-orm";
import * as XLSX from "xlsx";
import { requireAnyPermission, isResponse } from "@/lib/admin-guard";

export const dynamic = "force-dynamic";

// Excel (.xlsx) export of /admin/orders. Honours the same filters as the
// listing page (q / statusBucket / dateRange / from / to) and emits one
// row per SO line item, with sub-items as additional rows whose "Parent
// Item Code" cell points back at the top-level line.

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
  category: string | null;
  order_category: string | null;
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
                 COALESCE(NULLIF(stu.enrollment_number, ''), NULLIF(c_l.custom_enrollment_number, ''), NULLIF(so_l.student, '')) AS enrollment_number,
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
            LEFT JOIN erp.sales_orders so_l ON so_l.erp_name = o.order_number
            LEFT JOIN erp.customers   c_l  ON c_l.erp_name  = so_l.customer
          UNION ALL
          SELECT so.erp_name,
                 COALESCE(stu_m.name, so.customer_name)        AS customer,
                 so.transaction_date::text,
                 COALESCE(so.custom_display_status, so.status) AS status,
                 round(so.grand_total::numeric, 0)::int        AS grand_total,
                 so.custom_student_school                      AS school_name,
                 COALESCE(NULLIF(c.custom_enrollment_number, ''), so.student) AS enrollment_number,
                 so.custom_student_grade                       AS grade,
                 so.creation_at::text                          AS ordered_at,
                 so.custom_payment_status                      AS payment_status,
                 NULL::text                                    AS gateway_response_message,
                 'erp'::text                                   AS source,
                 2                                             AS pri
            FROM erp.sales_orders so
            LEFT JOIN erp.customers c ON c.erp_name = so.customer
            LEFT JOIN students stu_m ON stu_m.enrollment_number = NULLIF(c.custom_enrollment_number, '')
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
             u.grand_total, u.source,
             -- Roll the per-line categories up into a single label per SO
             -- so each row of a multi-line order carries the order-level
             -- type. Only ~5% of historic items have a category populated
             -- in ERP, so we also infer from item_code/item_name keywords
             -- (anything with "bookkit" / "magic box" in the name is
             -- classified even when ERP left the column blank). Lines that
             -- can't be inferred (transport, add-ons, uncategorised
             -- uniform items) drop out so they don't pollute the label.
             (SELECT string_agg(DISTINCT cat, '+' ORDER BY cat)
                FROM (
                  SELECT COALESCE(
                           NULLIF(ii.category, ''),
                           CASE
                             WHEN ii.item_code ILIKE '%bookkit%' OR ii.item_name ILIKE '%bookkit%' THEN 'bookkit'
                             WHEN ii.item_name ~* '(book[[:space:]]*set|2nd Lan|3rd Lan)' THEN 'bookkit'
                             WHEN ii.item_code ILIKE '%magic%box%' OR ii.item_name ILIKE '%magic%box%' THEN 'magic_box'
                             WHEN ii.item_code ILIKE '%magicbox%' OR ii.item_name ILIKE '%magicbox%' THEN 'magic_box'
                             WHEN ii.item_name ~* '(shirt|pant|trouser|frock|skirt|shoe|sock|belt|tie|blazer|sweater|jacket|track|polo|t.shirt|tunic|kurta|salwar|dupatta|chunni|pinafore|short|uniform|hoodie|cardigan)' THEN 'uniform'
                           END
                         ) AS cat
                    FROM erp.sales_order_items ii
                   WHERE ii.order_erp_name = u.erp_name
                  UNION ALL
                  -- Fallback for orders that haven't been mirrored to ERP yet:
                  -- derive the order-level category from local order_items via
                  -- the product's enum kind, with a name-based regex as last
                  -- resort.
                  SELECT CASE
                           WHEN p.kind = 'magic_box'                  THEN 'magic_box'
                           WHEN p.kind IN ('kit','sub_bundle','book') THEN 'bookkit'
                           WHEN p.kind IN ('uniform','accessory')     THEN 'uniform'
                           WHEN oi.name_snapshot ILIKE '%bookkit%'                                         THEN 'bookkit'
                           WHEN oi.name_snapshot ~* '(book[[:space:]]*set|2nd Lan|3rd Lan)'                THEN 'bookkit'
                           WHEN oi.name_snapshot ILIKE '%magic%box%' OR oi.name_snapshot ILIKE '%magicbox%' THEN 'magic_box'
                           WHEN oi.name_snapshot ~* '(shirt|pant|trouser|frock|skirt|shoe|sock|belt|tie|blazer|sweater|jacket|track|polo|t.shirt|tunic|kurta|salwar|dupatta|chunni|pinafore|short|uniform|hoodie|cardigan)' THEN 'uniform'
                         END AS cat
                    FROM orders o2
                    JOIN order_items oi      ON oi.order_id  = o2.id
                    LEFT JOIN product_variants pv ON pv.id   = oi.variant_id
                    LEFT JOIN products p          ON p.id    = pv.product_id
                   WHERE o2.order_number = u.erp_name
                ) c
               WHERE cat IS NOT NULL) AS order_category
        FROM unified u
       WHERE ${where}
    )
    SELECT
      f.erp_name                                AS so_id,
      -- Fallback for paid orders placed without a student_id (guest-style
      -- checkouts): if the parent on the order resolves to exactly one
      -- enrolled student — directly or via guardian phone links — use that
      -- student's enrollment number. COALESCE short-circuits, so the
      -- subquery only runs for the handful of rows where enrollment is
      -- otherwise blank.
      COALESCE(
        f.enrollment_number,
        (SELECT CASE WHEN count(DISTINCT cand.en) = 1 THEN min(cand.en) END
           FROM (
             SELECT NULLIF(s.enrollment_number, '') AS en
               FROM orders o3
               JOIN students s ON s.parent_id = o3.parent_id
              WHERE o3.order_number = f.erp_name
             UNION
             SELECT NULLIF(s2.enrollment_number, '')
               FROM orders o4
               JOIN parents p4 ON p4.id = o4.parent_id
               JOIN student_guardian_links sgl
                 ON right(regexp_replace(COALESCE(sgl.phone_no, ''), '[^0-9]', '', 'g'), 10)
                  = right(regexp_replace(COALESCE(p4.phone, ''), '[^0-9]', '', 'g'), 10)
                AND length(right(regexp_replace(COALESCE(p4.phone, ''), '[^0-9]', '', 'g'), 10)) = 10
               JOIN students s2 ON s2.id = sgl.student_id
              WHERE o4.order_number = f.erp_name
           ) cand
          WHERE cand.en IS NOT NULL)
      )                                         AS enrollment,
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
      x.parent_item_code                        AS parent_item_code,
      x.category                                AS category,
      f.order_category                          AS order_category
    FROM filtered f
    LEFT JOIN LATERAL (
      -- ERP top-level items
      SELECT i.item_code, i.item_name,
             i.qty::numeric AS qty, i.rate::numeric AS rate, i.amount::numeric AS amount,
             NULL::text AS parent_item_code,
             COALESCE(
               NULLIF(i.category, ''),
               CASE
                 WHEN i.item_code ILIKE '%bookkit%' OR i.item_name ILIKE '%bookkit%' THEN 'bookkit'
                 WHEN i.item_name ~* '(book[[:space:]]*set|2nd Lan|3rd Lan)' THEN 'bookkit'
                 WHEN i.item_code ILIKE '%magic%box%' OR i.item_name ILIKE '%magic%box%' THEN 'magic_box'
                 WHEN i.item_code ILIKE '%magicbox%' OR i.item_name ILIKE '%magicbox%' THEN 'magic_box'
                 WHEN i.item_name ~* '(shirt|pant|trouser|frock|skirt|shoe|sock|belt|tie|blazer|sweater|jacket|track|polo|t.shirt|tunic|kurta|salwar|dupatta|chunni|pinafore|short|uniform|hoodie|cardigan)' THEN 'uniform'
               END
             ) AS category,
             0 AS line_pri, i.id AS line_seq
        FROM erp.sales_order_items i
       WHERE i.order_erp_name = f.erp_name
      UNION ALL
      -- ERP sub-items (kit components, etc.) — inherit category from parent line.
      -- The sub-items mirror carries no rate (the bridge ships bundle picks
      -- without prices), so we price them from the local catalog instead:
      -- item_prices on the "Standard Selling" list matches transacted ERP
      -- rates 1:1. Amount stays NULL on these rows so summing the Amount
      -- column still reconciles with order grand totals (the parent bundle
      -- line already carries the transacted amount).
      SELECT si.item_code, NULL::text AS item_name,
             si.qty::numeric AS qty, lp.rate AS rate, NULL::numeric AS amount,
             si.parent_item_code,
             (SELECT COALESCE(
                       NULLIF(pi.category, ''),
                       CASE
                         WHEN pi.item_code ILIKE '%bookkit%' OR pi.item_name ILIKE '%bookkit%' THEN 'bookkit'
                         WHEN pi.item_name ~* '(book[[:space:]]*set|2nd Lan|3rd Lan)' THEN 'bookkit'
                         WHEN pi.item_code ILIKE '%magic%box%' OR pi.item_name ILIKE '%magic%box%' THEN 'magic_box'
                         WHEN pi.item_code ILIKE '%magicbox%' OR pi.item_name ILIKE '%magicbox%' THEN 'magic_box'
                         WHEN pi.item_name ~* '(shirt|pant|trouser|frock|skirt|shoe|sock|belt|tie|blazer|sweater|jacket|track|polo|t.shirt|tunic|kurta|salwar|dupatta|chunni|pinafore|short|uniform|hoodie|cardigan)' THEN 'uniform'
                       END
                     )
                FROM erp.sales_order_items pi
               WHERE pi.order_erp_name = si.order_erp_name
                 AND pi.item_code = si.parent_item_code
               LIMIT 1) AS category,
             1 AS line_pri, si.id AS line_seq
        FROM erp.sales_order_sub_items si
        LEFT JOIN LATERAL (
          SELECT (ip.price / 100.0)::numeric AS rate
            FROM product_variants pv
            JOIN item_prices ip ON ip.variant_id = pv.id
            LEFT JOIN price_lists pl ON pl.id = ip.price_list_id
           WHERE pv.sku = si.item_code AND ip.price > 0
           ORDER BY (pl.name = 'Standard Selling') DESC, ip.updated_at DESC
           LIMIT 1
        ) lp ON TRUE
       WHERE si.order_erp_name = f.erp_name
      UNION ALL
      -- Local order_items, only when this row hasn't been mirrored to
      -- ERP yet (otherwise we'd double up with the rows above).
      SELECT oi.name_snapshot AS item_code, oi.name_snapshot AS item_name,
             oi.qty::numeric AS qty,
             (oi.unit_price::numeric / 100) AS rate,
             (oi.total::numeric / 100) AS amount,
             NULL::text AS parent_item_code,
             NULL::text AS category,
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
    "Order Category",
    "Item Code",
    "Item Name",
    "Qty",
    "Rate",
    "Amount",
    "Parent Item Code",
    "Category",
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

  const toNum = (v: number | string | null | undefined): number | null => {
    if (v === null || v === undefined || v === "") return null;
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? n : null;
  };

  const aoa: (string | number | null)[][] = [header];
  for (const r of list) {
    aoa.push([
      r.so_id,
      r.enrollment,
      r.student,
      r.school,
      r.grade,
      fmtIst(r.ordered_at),
      r.status,
      r.payment_status,
      toNum(r.grand_total),
      r.order_category,
      r.item_code,
      r.item_name,
      toNum(r.qty),
      toNum(r.rate),
      toNum(r.amount),
      r.parent_item_code,
      r.category,
    ]);
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);

  // Column widths roughly matched to expected content.
  ws["!cols"] = [
    { wch: 16 }, // SO ID
    { wch: 14 }, // Enrollment ID
    { wch: 22 }, // Student
    { wch: 28 }, // School
    { wch: 8 },  // Grade
    { wch: 18 }, // Order Date (IST)
    { wch: 14 }, // Status
    { wch: 14 }, // Payment Status
    { wch: 14 }, // Grand Total
    { wch: 16 }, // Order Category
    { wch: 22 }, // Item Code
    { wch: 32 }, // Item Name
    { wch: 6 },  // Qty
    { wch: 10 }, // Rate
    { wch: 12 }, // Amount
    { wch: 22 }, // Parent Item Code
    { wch: 14 }, // Category
  ];

  if (aoa.length > 1) {
    ws["!autofilter"] = {
      ref: XLSX.utils.encode_range({
        s: { r: 0, c: 0 },
        e: { r: aoa.length - 1, c: header.length - 1 },
      }),
    };
  }

  // Number formats: INR for money columns, integers for qty.
  const inrFmt = '#,##0';
  const moneyCols = new Set([8, 13, 14]); // Grand Total, Rate, Amount
  const qtyCol = 12;
  for (let r = 1; r < aoa.length; r++) {
    for (const c of moneyCols) {
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = ws[addr];
      if (cell && typeof cell.v === "number") cell.z = inrFmt;
    }
    const qAddr = XLSX.utils.encode_cell({ r, c: qtyCol });
    const qCell = ws[qAddr];
    if (qCell && typeof qCell.v === "number") qCell.z = "0";
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sales Orders");

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

  const filenameParts = ["sales-orders"];
  if (statusBucket) filenameParts.push(statusBucket);
  if (dateRange) filenameParts.push(dateRange);
  if (from) filenameParts.push(`from-${from}`);
  if (to) filenameParts.push(`to-${to}`);
  filenameParts.push(new Date().toISOString().slice(0, 10));
  const filename = `${filenameParts.join("_")}.xlsx`;

  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
