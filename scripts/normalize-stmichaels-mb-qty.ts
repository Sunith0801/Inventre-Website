/* eslint-disable no-console */
/**
 * One-time remediation: St. Michaels School zero-value Magic Box orders that
 * were placed with a line qty > 1 (the pre-2026-07-02 qty>1 cart loophole).
 * These are still PENDING (confirmed/packed), ₹0, one line each. We set the
 * magic_box line qty back to 1 in the DB and re-emit `order.updated` so
 * audit.inventre.in picks up the corrected quantity.
 *
 *   ...env... npx tsx --conditions=react-server scripts/normalize-stmichaels-mb-qty.ts [--dry-run]
 *
 * Idempotent: only touches magic_box lines whose qty > 1; re-running is a no-op
 * once normalized. emitOrderEvent reuses the live signed payload builder so the
 * audit push matches production exactly.
 */
import { config } from "dotenv";
import path from "node:path";
config({ path: path.resolve(process.cwd(), ".env.local") });
config({ path: path.resolve(process.cwd(), ".env") });

import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { emitOrderEvent } from "@/lib/erp-bridge";

const DRY_RUN = process.argv.includes("--dry-run");

// The 5 confirmed target orders (Bucket A: single ₹0 order, magic_box qty>1).
const ORDER_NUMBERS = [
  "SAL-ORD-2026-34081",
  "SAL-ORD-2026-37298",
  "SAL-ORD-2026-33772",
  "SAL-ORD-2026-33845",
  "SAL-ORD-2026-36824",
];

async function main() {
  console.log(`\n=== Normalize St.Michaels Magic Box qty→1 ${DRY_RUN ? "(DRY RUN)" : "(APPLY)"} ===\n`);

  for (const orderNumber of ORDER_NUMBERS) {
    // Look up the order + its magic_box lines with qty>1.
    // db uses drizzle/postgres-js → db.execute() returns the row array directly.
    const rows = (await db.execute(sql`
        SELECT o.id AS order_id, o.status::text AS status,
               oi.id AS item_id, oi.name_snapshot, oi.qty, oi.unit_price
        FROM orders o
        JOIN order_items oi ON oi.order_id = o.id
        JOIN product_variants pv ON pv.id = oi.variant_id
        JOIN products p ON p.id = pv.product_id
        WHERE o.order_number = ${orderNumber}
          AND p.is_magic_box = true
          AND oi.qty > 1
      `)) as unknown as Array<{
      order_id: string;
      status: string;
      item_id: string;
      name_snapshot: string;
      qty: number;
      unit_price: number;
    }>;

    if (rows.length === 0) {
      console.log(`• ${orderNumber}: no magic_box line with qty>1 (already normalized?) — skipping`);
      continue;
    }

    const orderId = rows[0].order_id;
    for (const r of rows) {
      console.log(
        `• ${orderNumber} [${r.status}] "${r.name_snapshot}" qty ${r.qty} → 1  (unit_price=${r.unit_price})`
      );
    }

    if (DRY_RUN) continue;

    // 1) DB: set the magic_box line(s) qty=1, keep total = unit_price*1.
    await db.execute(sql`
      UPDATE order_items oi
      SET qty = 1, total = oi.unit_price
      FROM product_variants pv, products p
      WHERE oi.order_id = ${orderId}
        AND pv.id = oi.variant_id
        AND p.id = pv.product_id
        AND p.is_magic_box = true
        AND oi.qty > 1
    `);

    // 2) Recompute order money totals from the (now-normalized) lines. All ₹0
    //    here, but keep it correct/idempotent rather than assume.
    await db.execute(sql`
      UPDATE orders
      SET subtotal = COALESCE((SELECT SUM(total) FROM order_items WHERE order_id = ${orderId}), 0),
          total    = COALESCE((SELECT SUM(total) FROM order_items WHERE order_id = ${orderId}), 0)
                     + COALESCE(tax,0) + COALESCE(shipping,0) - COALESCE(discount,0)
      WHERE id = ${orderId}
    `);

    // 3) Push corrected order to audit.inventre.in (live signed payload).
    await emitOrderEvent(orderId, "order.updated");
    console.log(`  ✓ updated DB + emitted order.updated → audit`);
  }

  console.log(`\nDone.\n`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
