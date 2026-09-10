/* eslint-disable no-console */
/**
 * Enqueue order.updated envelopes for every order in the input CSV
 * that exists locally. The existing erp-drain cron picks them up and
 * POSTs the HMAC-signed envelope to audit.inventre.in's ingest endpoint
 * (via buildErpOrderPayload in lib/erp-bridge.ts).
 *
 *   DATABASE_URL=… npx tsx scripts/push-csv-orders-to-audit.ts
 *   …                                                       --apply
 *   …                                                       --csv=path
 *
 * Dry-run by default — counts only, no inserts. --apply enqueues.
 */
import { config } from "dotenv";
import fs from "node:fs";
import path from "node:path";
config({ path: path.resolve(process.cwd(), ".env.local") });
config({ path: path.resolve(process.cwd(), ".env") });

import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { enqueueOrderEvent } from "@/server/erp-bridge";

type Flags = { apply: boolean; csvPath: string };

function parseFlags(): Flags {
  const flags: Flags = {
    apply: false,
    csvPath: path.resolve(process.cwd(), "scripts/data/ccavenue-orders-to-reconcile.csv"),
  };
  for (const arg of process.argv.slice(2)) {
    if (arg === "--apply") flags.apply = true;
    else if (arg.startsWith("--csv=")) flags.csvPath = path.resolve(process.cwd(), arg.slice("--csv=".length));
    else throw new Error(`Unknown flag: ${arg}`);
  }
  return flags;
}

function loadCsvOrders(p: string): string[] {
  const out = new Set<string>();
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const first = line.split(",")[0].trim();
    if (first.startsWith("SAL-ORD-")) out.add(first);
  }
  return Array.from(out);
}

async function main() {
  const flags = parseFlags();
  const csv = loadCsvOrders(flags.csvPath);
  if (csv.length === 0) {
    console.log("[push-audit] no order numbers in CSV");
    return;
  }

  const r: any = await db.execute(sql`
    SELECT o.id, o.order_number
      FROM orders o
     WHERE o.order_number IN (${sql.join(csv.map((n) => sql`${n}`), sql`, `)})
     ORDER BY o.order_number;
  `);
  const rows = ((r?.rows ?? r ?? []) as { id: string; order_number: string }[]);

  console.log(
    `[push-audit] ${rows.length} local order(s) match CSV; ${csv.length - rows.length} not local${flags.apply ? "" : "  (DRY-RUN)"}`,
  );

  if (!flags.apply) {
    console.log("[push-audit] dry-run. Re-run with --apply to enqueue.");
    return;
  }

  let ok = 0;
  let failed = 0;
  for (const row of rows) {
    const r = await enqueueOrderEvent(row.id, "order.updated");
    if (r) {
      ok++;
      if (ok % 50 === 0) console.log(`[push-audit] enqueued ${ok}/${rows.length}`);
    } else {
      failed++;
      console.error(`[push-audit] FAILED ${row.order_number}`);
    }
  }
  console.log(`[push-audit] enqueued ${ok}/${rows.length} (${failed} failed)`);
  console.log("[push-audit] drain cron will fire these within ~3 min (default ERP_BUFFER_DELAY_SECONDS=180)");
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
