/* eslint-disable no-console */
/**
 * One-shot backfill for `erp.sales_order_items.category`.
 *
 * Migration 0048 adds the column; existing rows stay NULL until the
 * regular poller re-touches each order, which only happens when audit
 * marks the SO `modified`. Without this script, in-flight orders that
 * have already been polled keep showing "in transit" across the wrong
 * categories on My Orders.
 *
 * Strategy: list every distinct order_erp_name that still has at least
 * one NULL `category` row, fetch /api/orders/{name}, and re-run
 * upsertItemsMirror — which now writes the column.
 *
 *   DATABASE_URL=… npx tsx scripts/backfill-erp-item-category.ts \
 *     [--dry-run] [--limit=N]
 *
 * Idempotent: rows where every line already has a non-NULL category are
 * skipped by the WHERE clause.
 */
import { config } from "dotenv";
import path from "node:path";
config({ path: path.resolve(process.cwd(), ".env.deploy") });
config({ path: path.resolve(process.cwd(), ".env.local") });
config({ path: path.resolve(process.cwd(), ".env") });

import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { erpAuthedGet } from "@/server/erp-jwt";
import {
  upsertItemsMirror,
  type ErpOrderDetailResp,
} from "@/server/erp-poll";

const DRY = process.argv.includes("--dry-run");
const limitArg = process.argv.find((a) => a.startsWith("--limit="));
const LIMIT = limitArg ? Number(limitArg.slice("--limit=".length)) : 10_000;

async function main() {
  const r: any = await db.execute(sql`
    SELECT DISTINCT order_erp_name
      FROM erp.sales_order_items
     WHERE category IS NULL
       AND order_erp_name IS NOT NULL
     LIMIT ${LIMIT}
  `);
  const rows = (r?.rows ?? r ?? []) as Array<{ order_erp_name: string }>;
  console.log(
    `orders with NULL category: ${rows.length}${DRY ? " (dry-run)" : ""}`
  );
  if (DRY || rows.length === 0) return;

  let ok = 0;
  let failed = 0;
  for (const row of rows) {
    const name = row.order_erp_name;
    try {
      const detail = await erpAuthedGet<ErpOrderDetailResp>(
        `/api/orders/${encodeURIComponent(name)}`
      );
      if (!detail?.header?.name || !Array.isArray(detail.items)) {
        failed++;
        continue;
      }
      await upsertItemsMirror(detail.header.name, detail.items);
      ok++;
      if (ok % 100 === 0) {
        console.log(`  ${ok}/${rows.length} (failed=${failed})`);
      }
    } catch (e) {
      failed++;
      console.warn(
        `  ✗ ${name}: ${e instanceof Error ? e.message.slice(0, 160) : e}`
      );
    }
  }
  console.log(`done. backfilled=${ok} failed=${failed}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
