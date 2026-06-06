/* eslint-disable no-console */
/**
 * One-shot CLI to re-emit `order.updated` for every order whose
 * `order_items.bundle_selections` is non-empty. Used to backfill audit
 * (audit.inventre.in) with the magic-box BOM after lib/erp-bridge.ts
 * learned how to project bundle_selections → sub_items.
 *
 *   DATABASE_URL=… npx tsx scripts/replay-magic-box-orders.ts
 *   DATABASE_URL=… npx tsx scripts/replay-magic-box-orders.ts --order=SAL-ORD-2026-30027
 *   DATABASE_URL=… npx tsx scripts/replay-magic-box-orders.ts --dry-run
 *
 * Idempotent — audit dedupes on the envelope's event_id, and the
 * drainer assigns a fresh event_id per send.
 */
import { config } from "dotenv";
import path from "node:path";
config({ path: path.resolve(process.cwd(), ".env.local") });
config({ path: path.resolve(process.cwd(), ".env") });

import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { enqueueOrderEvent } from "@/lib/erp-bridge";

type Flags = { order?: string; dryRun: boolean };

function parseFlags(): Flags {
  const flags: Flags = { dryRun: false };
  for (const arg of process.argv.slice(2)) {
    if (arg === "--dry-run") flags.dryRun = true;
    else if (arg.startsWith("--order=")) flags.order = arg.slice("--order=".length);
    else throw new Error(`Unknown flag: ${arg}`);
  }
  return flags;
}

async function main() {
  const flags = parseFlags();

  const rows = flags.order
    ? await db.execute<{ id: string; order_number: string }>(sql`
        SELECT DISTINCT o.id, o.order_number
        FROM orders o
        JOIN order_items oi ON oi.order_id = o.id
        WHERE o.order_number = ${flags.order}
          AND jsonb_array_length(COALESCE(oi.bundle_selections, '[]'::jsonb)) > 0
      `)
    : await db.execute<{ id: string; order_number: string }>(sql`
        SELECT DISTINCT o.id, o.order_number
        FROM orders o
        JOIN order_items oi ON oi.order_id = o.id
        WHERE jsonb_array_length(COALESCE(oi.bundle_selections, '[]'::jsonb)) > 0
        ORDER BY o.order_number
      `);

  const list = (rows as any).rows ?? rows;
  console.log(`[replay] found ${list.length} order(s) with bundle_selections`);

  if (flags.dryRun) {
    for (const r of list) console.log(`  ${r.order_number}  ${r.id}`);
    console.log("[replay] dry-run; nothing enqueued");
    return;
  }

  let enqueued = 0;
  for (const r of list) {
    await enqueueOrderEvent(r.id, "order.updated");
    enqueued++;
    if (enqueued % 50 === 0) console.log(`[replay] enqueued ${enqueued}/${list.length}`);
  }
  console.log(`[replay] enqueued ${enqueued} order.updated events`);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  }
);
