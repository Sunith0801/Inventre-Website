/* eslint-disable no-console */
/**
 * One-off backfill: push the CCAvenue bank/tracking reference
 * (payments.gateway_tracking_id) to the audit ERP for EXISTING orders.
 *
 * Audit already stores it as sales_orders.custom_payment_tracking_id
 * (raw_synth.py:82 reads payload `gateway_tracking_id`, ingest.py:327 writes
 * it). The inventre→audit payload only started carrying the field after the
 * lib/erp-bridge.ts paymentBlock change, so historical audit rows are NULL.
 *
 * This re-emits `order.updated` for every order that has a PAID CCAvenue
 * payment with a real gateway_tracking_id, so audit re-upserts the SO and picks
 * up the tracking id. Uses the live emitOrderEvent → buildErpOrderPayload →
 * postErpEvent path (same signing/seq), so nothing diverges from production.
 *
 * Scope: paid CCAvenue payments with a non-null gateway_tracking_id only.
 *
 *   npx tsx --conditions=react-server scripts/backfill-ccavenue-tracking.ts [flags]
 *
 * Flags:
 *   --dry-run         Count + list, emit NOTHING.
 *   --limit=N         Stop after N emits (smoke-test).
 *   --concurrency=N   Parallel emits (default 8).
 *   --delay-ms=N      Sleep after each emit within a lane (default 0).
 */
import { config } from "dotenv";
import path from "node:path";
// NB: dotenv does NOT override already-set process.env, so the prod
// DATABASE_URL / STAGING_ERP_* exported by the runner win over .env.local (dev).
config({ path: path.resolve(process.cwd(), ".env.local") });
config({ path: path.resolve(process.cwd(), ".env") });

import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { emitOrderEvent } from "@/server/erp-bridge";

const DRY_RUN = process.argv.includes("--dry-run");
function numFlag(name: string, dflt: number): number {
  const raw = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!raw) return dflt;
  const v = Number(raw.split("=")[1]);
  return Number.isFinite(v) && v > 0 ? v : dflt;
}
const LIMIT = numFlag("limit", Number.POSITIVE_INFINITY);
const CONCURRENCY = numFlag("concurrency", 8);
const DELAY_MS = numFlag("delay-ms", 0);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function runPool<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const lane = async (): Promise<void> => {
    while (next < items.length) {
      const item = items[next++];
      await worker(item);
      if (DELAY_MS > 0) await sleep(DELAY_MS);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, lane),
  );
}

async function main(): Promise<void> {
  const res = await db.execute(sql`
    SELECT DISTINCT p.order_id AS id
      FROM payments p
     WHERE p.gateway_provider = 'CCAVENUE'
       AND p.status = 'paid'
       AND p.gateway_tracking_id IS NOT NULL
       AND p.order_id IS NOT NULL
     ORDER BY p.order_id ASC
  `);
  const rows = (Array.isArray(res) ? res : (res as { rows?: unknown[] }).rows ?? []) as {
    id: string;
  }[];
  const all = rows.map((r) => r.id);
  const ids = Number.isFinite(LIMIT) ? all.slice(0, LIMIT) : all;

  console.log(
    `[cca-tracking] paid CCAvenue orders with tracking id: ${all.length} total; ` +
      `emitting ${ids.length} (dry-run=${DRY_RUN}, concurrency=${CONCURRENCY}, delay-ms=${DELAY_MS})`,
  );
  if (DRY_RUN) {
    console.log(`[cca-tracking] DRY RUN — first 3 ids:`, ids.slice(0, 3));
    return;
  }

  let done = 0;
  await runPool(ids, CONCURRENCY, async (id) => {
    await emitOrderEvent(id, "order.updated");
    done++;
    if (done % 250 === 0 || done === ids.length) {
      console.log(`[cca-tracking] ${done}/${ids.length} emitted`);
    }
  });
  console.log(`[cca-tracking] DONE — ${done} emitted`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[cca-tracking] failed:", err);
    process.exit(1);
  });
