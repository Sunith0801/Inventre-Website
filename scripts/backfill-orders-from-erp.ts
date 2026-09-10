/* eslint-disable no-console */
/**
 * One-shot CLI to backfill ERPNext Sales Orders into the local `orders`
 * + `order_items` + `payments` tables (the real domain rows, not the
 * `erp_sales_orders` flat mirror that scripts/import-erp-sales-orders.ts
 * maintains for the admin queue view).
 *
 * Driven by the `erp.sales_orders` mirror that lib/erp-poll.ts keeps up
 * to date, so this walks the mirror by `erp_name` and calls
 * `importSalesOrder` for each.
 *
 *   DATABASE_URL=… npx tsx scripts/backfill-orders-from-erp.ts [flags]
 *
 * Flags:
 *   --dry-run                List what would be imported, write nothing.
 *   --limit=N                Cap per-run import count (default 500).
 *   --erp-name=SAL-ORD-…     Import a single specific Sales Order.
 *   --since=YYYY-MM-DD       Filter mirror rows with transaction_date >= this.
 *   --concurrency=N          Imports in flight at once (default 1).
 *   --verbose                Print every result; otherwise print every
 *                            50 results + the final summary.
 *
 * Idempotent — re-runs are cheap because the helper short-circuits on
 * `orders.order_number` matches.
 */
import { config } from "dotenv";
import path from "node:path";
config({ path: path.resolve(process.cwd(), ".env.local") });
config({ path: path.resolve(process.cwd(), ".env") });

import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  accumulate,
  emptySummary,
  importSalesOrder,
  type ImportSummary,
} from "@/server/erp-import-orders";

type Flags = {
  dryRun: boolean;
  limit: number;
  erpName: string | null;
  since: string | null;
  concurrency: number;
  verbose: boolean;
  /** When true, re-import already-local orders (drop + re-insert).
   *  Used to backfill sub-items that earlier passes dropped because
   *  their item_code didn't match a local SKU. */
  refresh: boolean;
};

function parseFlags(argv: string[]): Flags {
  const get = (key: string): string | null => {
    const found = argv.find((a) => a === `--${key}` || a.startsWith(`--${key}=`));
    if (!found) return null;
    if (!found.includes("=")) return ""; // bare flag → present
    return found.split("=", 2)[1] ?? "";
  };
  return {
    dryRun: get("dry-run") !== null,
    limit: Math.max(1, Number(get("limit") || 500)),
    erpName: get("erp-name") || null,
    since: get("since") || null,
    concurrency: Math.max(1, Math.min(8, Number(get("concurrency") || 1))),
    verbose: get("verbose") !== null,
    refresh: get("refresh") !== null,
  };
}

async function listFromMirror(flags: Flags): Promise<string[]> {
  if (flags.erpName) return [flags.erpName];

  // Default: only rows not yet local. With --refresh, include all
  // (already-local rows will be deleted + re-imported by the helper
  // when called with {refresh: true}). Newest-first so the cap-by-limit
  // prefers recent orders.
  const localPredicate = flags.refresh
    ? sql``
    : sql`AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.order_number = m.erp_name)`;
  const result = await db.execute(sql`
    SELECT erp_name
      FROM erp.sales_orders m
     WHERE m.status NOT IN ('Draft', 'Cancelled')
       ${flags.since ? sql`AND m.transaction_date >= ${flags.since}::date` : sql``}
       ${localPredicate}
     ORDER BY m.transaction_date DESC NULLS LAST, m.erp_name DESC
     LIMIT ${flags.limit}
  `);
  const rows = (Array.isArray(result)
    ? result
    : (result as { rows?: unknown[] }).rows ?? []) as Array<{ erp_name: string }>;
  return rows.map((r) => r.erp_name).filter(Boolean);
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  console.log("[backfill-orders-from-erp] flags:", flags);

  const names = await listFromMirror(flags);
  console.log(
    `[backfill-orders-from-erp] ${names.length} candidate erp_name${
      names.length === 1 ? "" : "s"
    } ${flags.erpName ? "(specific lookup)" : "from mirror"}`
  );

  if (flags.dryRun) {
    console.log("[backfill-orders-from-erp] DRY RUN — first 30:");
    for (const n of names.slice(0, 30)) console.log(`  - ${n}`);
    if (names.length > 30) console.log(`  ... and ${names.length - 30} more`);
    console.log("\n[backfill-orders-from-erp] No DB writes performed.");
    return;
  }

  const summary: ImportSummary = emptySummary();

  // Bounded concurrency. ERPNext rate-limits requests, so default 1
  // keeps things polite; admin can bump for a one-off backfill.
  let cursor = 0;
  async function worker() {
    while (cursor < names.length) {
      const i = cursor++;
      const erpName = names[i];
      const r = await importSalesOrder(erpName, { refresh: flags.refresh });
      accumulate(summary, r);
      if (flags.verbose) {
        console.log(
          `  [${summary.checked}/${names.length}] ${erpName} → ${r.kind}${
            r.kind === "skipped" ? ` (${r.reason})` : ""
          }${r.kind === "failed" ? ` — ${r.reason}` : ""}`
        );
      } else if (summary.checked % 50 === 0) {
        console.log(
          `  progress: ${summary.checked}/${names.length} (imported=${summary.imported}, skipped=${summary.skipped}, failed=${summary.failed})`
        );
      }
    }
  }

  await Promise.all(Array.from({ length: flags.concurrency }, () => worker()));

  console.log("\n[backfill-orders-from-erp] === summary ===");
  console.log(`  checked:  ${summary.checked}`);
  console.log(`  imported: ${summary.imported}`);
  console.log(`  skipped:  ${summary.skipped}`);
  for (const [reason, n] of Object.entries(summary.bySkipReason)) {
    console.log(`    - ${reason}: ${n}`);
  }
  console.log(`  failed:   ${summary.failed}`);
  if (summary.failed > 0) {
    console.log("  first 10 failures:");
    for (const f of summary.failures.slice(0, 10)) {
      console.log(`    - ${f.erpName}: ${f.reason}`);
    }
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("[backfill-orders-from-erp] fatal:", e);
  process.exit(1);
});
