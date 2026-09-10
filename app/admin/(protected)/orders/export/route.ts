import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { sql } from "drizzle-orm";
import * as XLSX from "xlsx";
import { requireAnyPermission, isResponse } from "@/server/admin-guard";

export const dynamic = "force-dynamic";

// Excel (.xlsx) export of /admin/orders. Honours the same filters as the
// listing page (q / statusBucket / dateRange / from / to) and emits one
// row per PRICED item the customer selected.
//
// Magic Box handling (ops directive 2026-06-17): a Magic Box is NOT shown
// as one lumped box price — it is SPLIT into the selections the customer
// actually made: every uniform piece (size encoded in the variant code)
// and the BookKit (whose name encodes the LANGUAGE / stream chosen, e.g.
// "…Grade 5 BookkitTelugu 2nd Lan Hin 3rd Lan"). Each split row is priced
// from the catalog (Standard Selling = the transacted rate); the "Magic
// Box / Bundle" column carries the parent box name so the selections stay
// grouped. The box's loose stationery / individual books have NO price in
// the system and are intentionally dropped (no blank-priced rows).
//
// Everything that is NOT a Magic Box (standalone uniform, standalone
// BookKit, add-ons) keeps its own real transacted Rate & Amount from the
// ERP line. Unpriced lines are dropped so no row shows a blank price.
//
// Grade column = the student's ACTUAL (real CBSE) grade, read from
// students.grade (resolved by student_id, else by enrollment). We never
// use orders.grade_snapshot / ERP custom_student_grade for the Grade cell
// because those carry the ERP +3 offset (and, for bulk-imported schools,
// the inverse -3 bug) — students.grade is the one column that is the real
// grade across every school. See [[grade-erp-offset-bulk-import-trap]].

type ItemRow = {
  so_id: string;
  enrollment: string | null;
  student: string | null;
  school: string | null;
  grade: string | null;
  ordered_at: string | null;
  payment_status: string | null;
  grand_total: number | null;
  item_code: string | null;
  item_name: string | null;
  bookkit_language: string | null;
  parent_item_code: string | null;
  qty: number | string | null;
  rate: number | string | null;
  amount: number | string | null;
  category: string | null;
  item_status: string | null;
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
             grand_total, school_name, enrollment_number, grade, real_grade, ordered_at,
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
                 -- Clean grade = students.grade (the real CBSE grade on every
                 -- school). Never grade_snapshot (carries the ERP-offset /
                 -- bulk-import-bugged value). grade and real_grade are the
                 -- same canonical value now.
                 NULLIF(stu.grade, '')                         AS grade,
                 NULLIF(stu.grade, '')                         AS real_grade,
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
                 NULLIF(stu_m.grade, '')                       AS grade,
                 NULLIF(stu_m.grade, '')                       AS real_grade,
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
                 NULL::text, NULL::text, NULL::text, NULL::text, NULL::text,
                 NULL::text, NULL::text,
                 'legacy'::text                                AS source,
                 3                                             AS pri
            FROM erp_sales_orders
        ) src
       ORDER BY erp_name, pri
    ),
    filtered AS (
      SELECT u.erp_name, u.customer, u.school_name, u.enrollment_number,
             u.grade, u.real_grade, u.ordered_at, u.payment_status,
             u.grand_total, u.source
        FROM unified u
       WHERE ${where}
    ),
    expanded AS (
      SELECT
        f.erp_name                              AS so_id,
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
        )                                       AS enrollment,
        f.customer                              AS student,
        f.school_name                           AS school,
        f.real_grade                            AS real_grade,
        f.grade                                 AS snapshot_grade,
        f.ordered_at                            AS ordered_at,
        f.payment_status                        AS payment_status,
        f.grand_total                           AS grand_total,
        x.item_code                             AS item_code,
        x.item_name                             AS item_name,
        x.parent_item_code                      AS parent_item_code,
        x.category                              AS category,
        x.qty                                   AS qty,
        x.rate                                  AS rate,
        x.amount                                AS amount
      FROM filtered f
      -- LEFT JOIN (not inner): an order must NEVER be dropped from the
      -- export just because the lateral found no priced line — that would
      -- silently hide orders that appear in the listing. Orders with no
      -- priced item still emit one row (grand total visible, item cols blank).
      LEFT JOIN LATERAL (
        -- (A) Top-level ORDERED lines (ERP mirror) EXCEPT the Magic Box
        --     container — a Magic Box is split into the selections the
        --     customer actually chose (branches B + C) instead of showing
        --     one lumped box price. Everything else (standalone uniform,
        --     standalone BookKit, add-ons) is ALWAYS shown — it is a thing
        --     the customer ordered — even if its price is missing, so the
        --     item (e.g. a BookKit's language) is never silently hidden.
        --     Rate/Amount prefer the ERP transacted value; when ERP carries
        --     ₹0 (some schools synced unpriced) we fall back to the catalog
        --     Standard-Selling price, and leave it blank only when no price
        --     exists anywhere.
        SELECT i.item_code, i.item_name,
               i.qty::numeric AS qty,
               COALESCE(NULLIF(i.rate, 0)::numeric, ca.rate)                    AS rate,
               COALESCE(NULLIF(i.amount, 0)::numeric, (i.qty * ca.rate)::numeric) AS amount,
               NULL::text AS parent_item_code,
               COALESCE(
                 NULLIF(i.category, ''),
                 CASE
                   WHEN i.item_code ILIKE '%bookkit%' OR i.item_name ILIKE '%bookkit%' THEN 'bookkit'
                   WHEN i.item_name ~* '(book[[:space:]]*set|2nd Lan|3rd Lan)' THEN 'bookkit'
                   WHEN i.item_code ~* '(shirt|pant|trouser|frock|skirt|skort|shoe|sock|belt|tie|blazer|sweater|jacket|track|polo|t.?shirt|tunic|kurta|salwar|dupatta|chunni|pinafore|short|uniform|hoodie|cardigan|cap|tight|rnt|vest|jersey|legging|jegging|kameez|dhoti|scarf)'
                     OR i.item_name ~* '(shirt|pant|trouser|frock|skirt|skort|shoe|sock|belt|tie|blazer|sweater|jacket|track|polo|t.?shirt|tunic|kurta|salwar|dupatta|chunni|pinafore|short|uniform|hoodie|cardigan|cap|tight|rnt|vest|jersey|legging|jegging|kameez|dhoti|scarf)' THEN 'uniform'
                 END
               ) AS category,
               0::numeric AS line_pri, i.id::numeric AS line_seq
          FROM erp.sales_order_items i
          LEFT JOIN LATERAL (
            -- Catalog price for this exact SKU; if the exact size carries no
            -- price, fall back to the HIGHEST price among the same product's
            -- other sizes (ops directive 2026-06-17: when sibling sizes sit
            -- at different tiers, take the higher value). Only used when the
            -- ERP line itself is ₹0.
            SELECT COALESCE(
              (SELECT (ip.price / 100.0)::numeric
                 FROM product_variants pv
                 JOIN item_prices ip ON ip.variant_id = pv.id
                 LEFT JOIN price_lists pl ON pl.id = ip.price_list_id
                WHERE pv.sku = i.item_code AND ip.price > 0
                ORDER BY (pl.name = 'Standard Selling') DESC, ip.updated_at DESC
                LIMIT 1),
              (SELECT max(ip.price / 100.0)::numeric
                 FROM product_variants pv0
                 JOIN product_variants pv2 ON pv2.product_id = pv0.product_id
                 JOIN item_prices ip ON ip.variant_id = pv2.id
                WHERE pv0.sku = i.item_code AND ip.price > 0)
            ) AS rate
          ) ca ON TRUE
         WHERE i.order_erp_name = f.erp_name
           -- Suppress the Magic Box container line ONLY when it actually has
           -- direct children to split into (branches B + C). If its sub-items
           -- were never mirrored to ERP, we keep the box line instead — else
           -- the order would show blank. NULL-safe via COALESCE(..., false)
           -- so the ~95% of items with a NULL category aren't lost to NULL
           -- propagation through OR/NOT.
           AND NOT COALESCE(
                 ( NULLIF(i.category, '') = 'magic_box'
                OR i.item_code ILIKE '%magic%box%' OR i.item_name ILIKE '%magic%box%'
                OR i.item_code ILIKE '%magicbox%'  OR i.item_name ILIKE '%magicbox%' )
                 AND EXISTS (
                   SELECT 1 FROM erp.sales_order_sub_items s
                    WHERE s.order_erp_name = i.order_erp_name
                      AND s.parent_item_code = i.item_code ),
                 false )
        UNION ALL
        -- (B) Magic Box DIRECT children — the uniform pieces / bag / shoes
        --     the customer selected (sizes encoded in the variant code).
        --     Priced from the catalog (Standard Selling, = transacted rate);
        --     the handful of loose direct children with no catalog price are
        --     dropped (INNER join to the price lateral).
        SELECT s.item_code, s.item_code AS item_name,
               s.qty::numeric AS qty, lp.rate AS rate, (s.qty * lp.rate)::numeric AS amount,
               mb.item_code AS parent_item_code,
               CASE
                 WHEN s.item_code ILIKE '%bookkit%' THEN 'bookkit'
                 WHEN s.item_code ~* '(book[[:space:]]*set|2nd Lan|3rd Lan)' THEN 'bookkit'
                 ELSE 'uniform'
               END AS category,
               1::numeric AS line_pri, s.id::numeric AS line_seq
          FROM erp.sales_order_items mb
          JOIN erp.sales_order_sub_items s
            ON s.order_erp_name = mb.order_erp_name AND s.parent_item_code = mb.item_code
          JOIN LATERAL (
            SELECT (ip.price / 100.0)::numeric AS rate
              FROM product_variants pv
              JOIN item_prices ip ON ip.variant_id = pv.id
              LEFT JOIN price_lists pl ON pl.id = ip.price_list_id
             WHERE pv.sku = s.item_code AND ip.price > 0
             ORDER BY (pl.name = 'Standard Selling') DESC, ip.updated_at DESC
             LIMIT 1
          ) lp ON TRUE
         WHERE mb.order_erp_name = f.erp_name
           AND ( NULLIF(mb.category, '') = 'magic_box'
              OR mb.item_code ILIKE '%magic%box%' OR mb.item_name ILIKE '%magic%box%'
              OR mb.item_code ILIKE '%magicbox%'  OR mb.item_name ILIKE '%magicbox%' )
        UNION ALL
        -- (C) The BookKit container node inside the Magic Box. The kit is
        --     stored only as a parent_item_code of its books (never its own
        --     line), and its full name encodes the LANGUAGE / stream the
        --     customer chose (e.g. "…Grade 5 BookkitTelugu 2nd Lan Hin 3rd
        --     Lan"). We surface it as one priced row; its loose book/
        --     stationery children stay hidden.
        SELECT node.kit AS item_code, node.kit AS item_name,
               1::numeric AS qty, lpb.rate AS rate, lpb.rate::numeric AS amount,
               node.box AS parent_item_code,
               'bookkit'::text AS category,
               1::numeric AS line_pri, (node.min_child_id - 0.5)::numeric AS line_seq
          FROM (
            SELECT s.parent_item_code AS kit, MIN(s.id) AS min_child_id,
                   (SELECT mb.item_code FROM erp.sales_order_items mb
                     WHERE mb.order_erp_name = f.erp_name
                       AND ( NULLIF(mb.category, '') = 'magic_box'
                          OR mb.item_code ILIKE '%magic%box%' OR mb.item_name ILIKE '%magic%box%'
                          OR mb.item_code ILIKE '%magicbox%'  OR mb.item_name ILIKE '%magicbox%' )
                     ORDER BY mb.id LIMIT 1) AS box
              FROM erp.sales_order_sub_items s
             WHERE s.order_erp_name = f.erp_name
               AND s.parent_item_code IS NOT NULL
               AND NOT EXISTS (
                 SELECT 1 FROM erp.sales_order_items ti
                  WHERE ti.order_erp_name = f.erp_name AND ti.item_code = s.parent_item_code)
               AND NOT EXISTS (
                 SELECT 1 FROM erp.sales_order_sub_items s2
                  WHERE s2.order_erp_name = f.erp_name AND s2.item_code = s.parent_item_code)
             GROUP BY s.parent_item_code
          ) node
          JOIN LATERAL (
            SELECT (ip.price / 100.0)::numeric AS rate
              FROM product_variants pv
              JOIN item_prices ip ON ip.variant_id = pv.id
              LEFT JOIN price_lists pl ON pl.id = ip.price_list_id
             WHERE pv.sku = node.kit AND ip.price > 0
             ORDER BY (pl.name = 'Standard Selling') DESC, ip.updated_at DESC
             LIMIT 1
          ) lpb ON TRUE
         WHERE node.box IS NOT NULL
        UNION ALL
        -- (D) Local order_items — ONLY when this order has no ERP mirror at
        --     all. Branch A now emits every ERP top line (priced or not), so
        --     firing here for a mirrored order would double up. This covers
        --     storefront orders not yet synced to ERP.
        SELECT oi.name_snapshot AS item_code, oi.name_snapshot AS item_name,
               oi.qty::numeric AS qty,
               (oi.unit_price::numeric / 100) AS rate,
               (oi.total::numeric / 100) AS amount,
               NULL::text AS parent_item_code,
               CASE
                 WHEN p.kind = 'magic_box'                  THEN 'magic_box'
                 WHEN p.kind IN ('kit','sub_bundle','book') THEN 'bookkit'
                 WHEN p.kind IN ('uniform','accessory')     THEN 'uniform'
                 WHEN oi.name_snapshot ILIKE '%bookkit%'                                          THEN 'bookkit'
                 WHEN oi.name_snapshot ~* '(book[[:space:]]*set|2nd Lan|3rd Lan)'                 THEN 'bookkit'
                 WHEN oi.name_snapshot ILIKE '%magic%box%' OR oi.name_snapshot ILIKE '%magicbox%' THEN 'magic_box'
                 WHEN oi.name_snapshot ~* '(shirt|pant|trouser|frock|skirt|skort|shoe|sock|belt|tie|blazer|sweater|jacket|track|polo|t.?shirt|tunic|kurta|salwar|dupatta|chunni|pinafore|short|uniform|hoodie|cardigan|cap|tight|rnt|vest|jersey|legging|jegging|kameez|dhoti|scarf)' THEN 'uniform'
               END AS category,
               0::numeric AS line_pri, NULL::numeric AS line_seq
          FROM order_items oi
          JOIN orders o ON o.id = oi.order_id
          LEFT JOIN product_variants pv ON pv.id = oi.variant_id
          LEFT JOIN products p          ON p.id  = pv.product_id
         WHERE f.source = 'local'
           AND o.order_number = f.erp_name
           AND NOT EXISTS (
             SELECT 1 FROM erp.sales_order_items ii WHERE ii.order_erp_name = f.erp_name
           )
        ORDER BY line_pri, line_seq NULLS LAST
      ) x ON TRUE
    ),
    -- Per-(order, category) fulfilment status, mirrored from audit. On this
    -- stack audit records dispatch at the PARCEL / CATEGORY level, never per
    -- line — erp.sales_order_items.delivered_qty is always 0, so the
    -- authoritative signal is the order's derived_delivery_by_category map
    -- (raw JSON), floored by the live outward_shipments rows for the same
    -- category. This mirrors what the customer order page shows (see
    -- lib/erp-customer-orders.ts / order-category-tracking.ts).
    cat_status_src AS (
      SELECT so.erp_name AS order_erp_name,
             lower(kv.key) AS cat_key,
             CASE
               WHEN lower(kv.value) IN ('delivered','fully delivered','completed') THEN 4
               WHEN lower(kv.value) = 'returned'                                   THEN 4
               WHEN lower(kv.value) IN ('out for delivery','out_for_delivery','ofd') THEN 3
               WHEN lower(kv.value) IN ('in transit','in_transit','shipped','dispatched','packed') THEN 2
               ELSE 1
             END AS rank,
             CASE
               WHEN lower(kv.value) = 'returned'                                   THEN 'returned'
               WHEN lower(kv.value) IN ('delivered','fully delivered','completed') THEN 'delivered'
               WHEN lower(kv.value) IN ('out for delivery','out_for_delivery','ofd') THEN 'out for delivery'
               WHEN lower(kv.value) IN ('in transit','in_transit','shipped','dispatched','packed') THEN 'in transit'
               ELSE 'pending'
             END AS label
        FROM erp.sales_orders so
        -- Guard the function ARGUMENT (not just WHERE): jsonb_each_text
        -- errors on a non-object, and the lateral is evaluated per row
        -- before WHERE can filter. Coerce anything non-object to '{}'.
        CROSS JOIN LATERAL jsonb_each_text(
          CASE
            WHEN so.raw IS NOT NULL
             AND jsonb_typeof((so.raw::jsonb)->'derived_delivery_by_category') = 'object'
            THEN (so.raw::jsonb)->'derived_delivery_by_category'
            ELSE '{}'::jsonb
          END
        ) AS kv(key, value)
      UNION ALL
      SELECT os.order_erp_name,
             lower(os.item_category) AS cat_key,
             CASE
               WHEN lower(os.status) = 'delivered'                                 THEN 4
               WHEN lower(os.status) = 'returned'                                  THEN 4
               WHEN lower(os.status) IN ('out_for_delivery','out for delivery','ofd') THEN 3
               WHEN lower(os.status) IN ('in_transit','in transit','shipped','dispatched','packed')
                 OR os.dispatched_at IS NOT NULL                                   THEN 2
               ELSE 1
             END AS rank,
             CASE
               WHEN lower(os.status) = 'delivered'                                 THEN 'delivered'
               WHEN lower(os.status) = 'returned'                                  THEN 'returned'
               WHEN lower(os.status) IN ('out_for_delivery','out for delivery','ofd') THEN 'out for delivery'
               WHEN lower(os.status) IN ('in_transit','in transit','shipped','dispatched','packed')
                 OR os.dispatched_at IS NOT NULL                                   THEN 'in transit'
               ELSE 'pending'
             END AS label
        FROM erp.outward_shipments os
       WHERE COALESCE(os.is_deleted, false) = false
         AND NULLIF(os.item_category, '') IS NOT NULL
    ),
    cat_status AS (
      SELECT order_erp_name, cat_key,
             (array_agg(label ORDER BY rank DESC))[1] AS label
        FROM cat_status_src
       GROUP BY order_erp_name, cat_key
    ),
    -- True per-item overlay: when audit shipped a parcel tagged with the
    -- exact item_code, that beats the category roll-up. Usually empty
    -- (most parcels are category-level), so it's a best-effort refinement.
    item_ship AS (
      SELECT os.order_erp_name, os.item_code,
             (array_agg(
                CASE
                  WHEN lower(os.status) = 'delivered'                                 THEN 'delivered'
                  WHEN lower(os.status) = 'returned'                                  THEN 'returned'
                  WHEN lower(os.status) IN ('out_for_delivery','out for delivery','ofd') THEN 'out for delivery'
                  WHEN lower(os.status) IN ('in_transit','in transit','shipped','dispatched','packed')
                    OR os.dispatched_at IS NOT NULL                                   THEN 'in transit'
                  ELSE 'pending'
                END
                ORDER BY CASE
                  WHEN lower(os.status) = 'delivered'                                 THEN 4
                  WHEN lower(os.status) = 'returned'                                  THEN 4
                  WHEN lower(os.status) IN ('out_for_delivery','out for delivery','ofd') THEN 3
                  WHEN lower(os.status) IN ('in_transit','in transit','shipped','dispatched','packed')
                    OR os.dispatched_at IS NOT NULL                                   THEN 2
                  ELSE 1
                END DESC
             ))[1] AS label
        FROM erp.outward_shipments os
       WHERE COALESCE(os.is_deleted, false) = false
         AND NULLIF(os.item_code, '') IS NOT NULL
       GROUP BY os.order_erp_name, os.item_code
    ),
    -- Order-level fallback. ~40% of mirrored orders never received audit's
    -- per-category derived_delivery_by_category map (the poll captured the
    -- SO before audit computed it), and some shipments carry no
    -- item_category — those rows would otherwise be blank even though the
    -- order itself has a clear delivery state. custom_display_status is the
    -- order-level field audit always sets ("Fully Delivered", "Dispatched",
    -- …); map it to our vocabulary as the LAST resort, after the exact
    -- item_code and per-category matches. Collapses "Partially Delivered"
    -- to "in transit" (understates rather than overstates per-line).
    ord_status AS (
      SELECT so.erp_name AS order_erp_name,
             CASE
               WHEN cds IN ('fully delivered','delivered')                THEN 'delivered'
               WHEN cds LIKE 'partial%'                                   THEN 'in transit'
               WHEN cds IN ('dispatched','shipment created','out for delivery') THEN 'in transit'
               WHEN cds IN ('not yet delivered','not delivered','to deliver and bill') THEN 'pending'
               WHEN dls = 'fully delivered'                               THEN 'delivered'
               WHEN dls LIKE 'part%'                                      THEN 'in transit'
               WHEN dls = 'not delivered'                                 THEN 'pending'
               ELSE NULL
             END AS label
        FROM (
          SELECT erp_name,
                 lower(COALESCE(custom_display_status, '')) AS cds,
                 lower(COALESCE(delivery_status, ''))       AS dls
            FROM erp.sales_orders
        ) so
    )
    SELECT
      e.so_id,
      e.enrollment,
      e.student,
      e.school,
      -- ACTUAL grade: the student's real CBSE grade. Prefer the grade off
      -- the joined student; if the order had no student_id, look the student
      -- up by the resolved enrollment; only as a last resort fall back to the
      -- order's snapshot grade (which may carry the ERP offset).
      COALESCE(
        e.real_grade,
        (SELECT NULLIF(s.grade, '')
           FROM students s
          WHERE s.enrollment_number = e.enrollment
            AND NULLIF(s.grade, '') IS NOT NULL
          LIMIT 1),
        e.snapshot_grade
      )                                         AS grade,
      e.ordered_at,
      e.payment_status,
      e.grand_total,
      e.item_code,
      e.item_name,
      -- BookKit language / stream the customer selected, lifted out of the
      -- kit's name (everything after "Bookkit") so it's readable at a glance
      -- and filterable — esp. for St. Michaels, whose BookKits carry no price
      -- but whose language selection still matters. Blank for non-BookKits.
      NULLIF(trim(substring(e.item_code from '(?i)bookkit[[:space:]]*(.*)')), '') AS bookkit_language,
      e.category,
      e.parent_item_code,
      e.qty,
      e.rate,
      e.amount,
      -- Per-item fulfilment status as audit sees it, in priority order:
      --   1. exact item_code parcel match (most specific),
      --   2. the order's per-category status (bookkit / uniform),
      --   3. the order-level delivery state (covers orders audit never gave
      --      a per-category map — see ord_status).
      -- Blank only when none apply (local-only / un-synced orders).
      COALESCE(ish.label, cs.label, os3.label)  AS item_status
    FROM expanded e
    LEFT JOIN item_ship ish
      ON ish.order_erp_name = e.so_id AND ish.item_code = e.item_code
    LEFT JOIN cat_status cs
      ON cs.order_erp_name = e.so_id AND cs.cat_key = lower(e.category)
    LEFT JOIN ord_status os3
      ON os3.order_erp_name = e.so_id
    ORDER BY e.ordered_at DESC NULLS LAST, e.so_id DESC, e.parent_item_code NULLS FIRST
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
    "Payment Status",
    "Grand Total (INR)",
    "Item Code",
    "Item Name",
    "BookKit Language",
    "Category",
    "Magic Box / Bundle",
    "Qty",
    "Rate",
    "Amount",
    "Item Status",
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
      r.payment_status,
      toNum(r.grand_total),
      r.item_code,
      r.item_name,
      r.bookkit_language,
      r.category,
      r.parent_item_code,
      toNum(r.qty),
      toNum(r.rate),
      toNum(r.amount),
      r.item_status,
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
    { wch: 14 }, // Payment Status
    { wch: 14 }, // Grand Total
    { wch: 28 }, // Item Code
    { wch: 36 }, // Item Name
    { wch: 26 }, // BookKit Language
    { wch: 14 }, // Category
    { wch: 30 }, // Magic Box / Bundle
    { wch: 6 },  // Qty
    { wch: 10 }, // Rate
    { wch: 12 }, // Amount
    { wch: 12 }, // Item Status
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
  const moneyCols = new Set([7, 14, 15]); // Grand Total, Rate, Amount
  const qtyCol = 13;
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
