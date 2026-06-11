#!/usr/bin/env node
/**
 * Backfill local `orders.status` to match audit + real shipments.
 *
 * Why: `deriveLocalOrderStatusFromMirror` historically counted synthetic
 * `shipped_to_school` rows (tracking_number LIKE 'syn:%') as real
 * deliveries and cascaded local.status to 'delivered' on ~2,746 orders
 * that audit itself still flags "Not Yet Delivered". Today's deploy
 * filtered synthetic rows out of the derivation so the bleed is stopped
 * going forward — this script repairs the historic damage.
 *
 * Logic matches the storefront listing exactly:
 *   - audit `custom_display_status` Cancelled/Returned wins
 *   - audit `derived_delivery_by_category` reporting every present
 *     category as delivered -> 'delivered'
 *   - audit "Fully Delivered" / "Completed" -> 'delivered'
 *   - audit "Not Yet Delivered" caps below 'delivered'
 *   - then shipment mirror: all delivered -> 'delivered',
 *     out_for_delivery -> 'shipped' (local enum has no OFD),
 *     any -> 'shipped'
 *   - then packing units: dispatched -> 'shipped', sealed -> 'packed'
 *   - then audit text: partial -> 'shipped', etc.
 *   - default -> 'confirmed'
 *
 * Synthetic and is_deleted shipments are excluded everywhere here.
 *
 * Usage:
 *   node scripts/backfill-local-order-status.mjs            # dry-run report
 *   node scripts/backfill-local-order-status.mjs --apply    # write changes
 *   node scripts/backfill-local-order-status.mjs --limit 50 # cap rows
 *
 * Writes are batched and each batch commits independently so a partial
 * run is safe to resume.
 */
import postgres from "/root/Inventre/node_modules/postgres/src/index.js";

const APPLY = process.argv.includes("--apply");
const LIMIT_IDX = process.argv.indexOf("--limit");
const LIMIT =
  LIMIT_IDX >= 0 ? Number(process.argv[LIMIT_IDX + 1]) : null;
const BATCH_SIZE = 500;

const sql = postgres(
  "postgres://inventre:inventre_prod@localhost:6433/inventre",
  { max: 4 }
);

// Recompute correct local status from audit + mirror in pure SQL —
// identical to the listing's CASE WHEN chain, but emitting only values
// from the local order_status enum (placed/confirmed/packed/shipped/
// delivered/returned/cancelled). Storefront "out for delivery" maps to
// "shipped" locally — there's no local enum value for OFD, and shipped
// is the closest semantic.
const COMPUTE = `
  CASE
    WHEN lower(coalesce(so.custom_display_status,'')) LIKE '%cancel%'
      THEN 'cancelled'
    WHEN lower(coalesce(so.custom_display_status,'')) LIKE '%return%'
      THEN 'returned'
    WHEN COALESCE(
      (SELECT bool_and(
         lower(coalesce(so.raw->'derived_delivery_by_category'->>k,''))
           IN ('delivered','fully delivered','completed')
       )
       FROM jsonb_array_elements_text(
         CASE
           WHEN jsonb_typeof((so.raw::jsonb)->'derived_delivery_categories_present') = 'array'
             THEN (so.raw::jsonb)->'derived_delivery_categories_present'
           ELSE '[]'::jsonb
         END
       ) AS k),
      false
    )
      THEN 'delivered'
    WHEN lower(coalesce(so.custom_display_status,'')) LIKE '%complete%'
      OR (lower(coalesce(so.custom_display_status,'')) LIKE '%delivered%'
          AND lower(coalesce(so.custom_display_status,'')) NOT LIKE '%not%')
      THEN 'delivered'
    -- shipment-mirror branch (synthetic + deleted excluded)
    WHEN sh.n > 0 THEN
      CASE
        WHEN sh.delivered >= sh.n
          AND lower(coalesce(so.custom_display_status,'')) NOT LIKE '%not%deliver%'
          THEN 'delivered'
        ELSE 'shipped'
      END
    WHEN pu.dispatched > 0 THEN 'shipped'
    WHEN pu.sealed > 0 THEN 'packed'
    WHEN lower(coalesce(so.custom_display_status,'')) LIKE '%partial%'
      THEN 'shipped'
    WHEN lower(coalesce(so.custom_display_status,'')) LIKE '%packed%'
      THEN 'packed'
    WHEN lower(coalesce(so.custom_display_status,'')) LIKE '%shipped%'
      OR lower(coalesce(so.custom_display_status,'')) LIKE '%shipment%'
      OR lower(coalesce(so.custom_display_status,'')) LIKE '%dispatch%'
      OR lower(coalesce(so.custom_display_status,'')) LIKE '%transit%'
      THEN 'shipped'
    ELSE 'confirmed'
  END
`;

async function loadCandidates() {
  const limitClause = LIMIT ? sql`LIMIT ${LIMIT}` : sql``;
  return await sql.unsafe(
    `
    SELECT
      lo.id::text                    AS id,
      lo.order_number                AS order_number,
      lo.status::text                AS current_status,
      lo.delivered_at IS NOT NULL    AS has_delivered_at,
      lo.shipped_at   IS NOT NULL    AS has_shipped_at,
      so.custom_display_status       AS audit,
      ${COMPUTE}                     AS computed_status
    FROM orders lo
    LEFT JOIN erp.sales_orders so ON so.erp_name = lo.order_number
    LEFT JOIN LATERAL (
      SELECT count(*)                                       AS n,
             count(*) FILTER (WHERE x.status = 'delivered') AS delivered
        FROM erp.outward_shipments x
       WHERE x.order_erp_name = lo.order_number
         AND x.is_deleted = false
         AND COALESCE(x.tracking_number,'') NOT LIKE 'syn:%'
    ) sh ON true
    LEFT JOIN LATERAL (
      SELECT count(*) FILTER (WHERE status='sealed')     AS sealed,
             count(*) FILTER (WHERE status='dispatched') AS dispatched
        FROM erp.packing_units
       WHERE order_erp_name = lo.order_number
    ) pu ON true
    WHERE lo.status::text <> (${COMPUTE})
      -- Don't disturb terminal cancelled/returned local rows that
      -- pre-date this drift (e.g. manually cancelled in admin) — we
      -- only flip when audit explicitly agrees on the new terminal.
      AND NOT (lo.status::text IN ('cancelled','returned')
               AND lower(coalesce(so.custom_display_status,'')) NOT LIKE '%cancel%'
               AND lower(coalesce(so.custom_display_status,'')) NOT LIKE '%return%')
      -- Only repair where there is real evidence to act on. Local-only
      -- orders that audit has not mirrored yet (no display_status, no
      -- shipments, no packing units) sit in placed legitimately;
      -- leaving them alone preserves the just-placed to confirmed flip
      -- the storefront does on payment success, which the COMPUTE chain
      -- here would otherwise pre-empt.
      AND (
        COALESCE(so.custom_display_status,'') <> ''
        OR sh.n > 0
        OR pu.sealed > 0
        OR pu.dispatched > 0
      )
    ORDER BY lo.created_at DESC
    ${LIMIT ? `LIMIT ${Number.parseInt(LIMIT, 10)}` : ""}
    `
  );
}

function summarise(rows) {
  const buckets = new Map();
  for (const r of rows) {
    const k = `${r.current_status} → ${r.computed_status}`;
    buckets.set(k, (buckets.get(k) ?? 0) + 1);
  }
  return [...buckets.entries()].sort((a, b) => b[1] - a[1]);
}

async function apply(rows) {
  let updated = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    await sql.begin(async (tx) => {
      for (const r of batch) {
        // Per-row UPDATE — values vary by row (delivered_at clearing,
        // shipped_at preservation rules differ by direction). Bound
        // by BATCH_SIZE so a single tx commits at most 500 rows.
        await tx`
          UPDATE orders
             SET status       = ${r.computed_status}::order_status,
                 delivered_at = CASE
                   WHEN ${r.computed_status} = 'delivered'
                     THEN COALESCE(delivered_at, now())
                   ELSE NULL
                 END,
                 shipped_at   = CASE
                   WHEN ${r.computed_status} IN ('shipped','delivered')
                     THEN COALESCE(shipped_at, now())
                   ELSE NULL
                 END
           WHERE id = ${r.id}
             AND status::text = ${r.current_status}
        `;
        updated++;
      }
    });
    process.stdout.write(`  committed ${Math.min(i + BATCH_SIZE, rows.length)}/${rows.length}\r`);
  }
  process.stdout.write("\n");
  return updated;
}

(async () => {
  console.log(
    `mode: ${APPLY ? "APPLY" : "DRY-RUN"}${LIMIT ? ` (limit=${LIMIT})` : ""}`
  );
  const rows = await loadCandidates();
  console.log(`candidate rows: ${rows.length}`);
  if (rows.length === 0) {
    console.log("nothing to do.");
    await sql.end();
    return;
  }
  console.log("\ntransitions:");
  for (const [k, n] of summarise(rows)) console.log(`  ${k.padEnd(30)} ${n}`);
  console.log("\nfirst 10 rows:");
  for (const r of rows.slice(0, 10)) {
    console.log(
      `  ${r.order_number.padEnd(20)} ${r.current_status.padEnd(10)} → ${r.computed_status.padEnd(10)} (audit: ${r.audit ?? "—"})`
    );
  }
  if (!APPLY) {
    console.log("\ndry-run: no changes written. add --apply to commit.");
    await sql.end();
    return;
  }
  console.log("\napplying...");
  const n = await apply(rows);
  console.log(`done. updated ${n} rows.`);
  await sql.end();
})().catch(async (e) => {
  console.error("backfill failed:", e);
  await sql.end().catch(() => {});
  process.exit(1);
});
