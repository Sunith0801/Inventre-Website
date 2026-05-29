/* eslint-disable no-console */
/**
 * One-shot heal: re-push every paid order placed since 2026-05-25 00:00 IST
 * to the audit dashboard at https://audit.inventre.in.
 *
 * Run on the prod app container AFTER the audit-side fix has been deployed
 * (audit must honor incoming `order_number` instead of auto-incrementing,
 * and the audit sales-order table must be wiped of rows since the cutoff).
 *
 *   DATABASE_URL=… npx tsx scripts/resync-orders-since-may25.ts [--dry-run]
 *
 * What it does:
 *   1. Cancels the in-flight queue rows that have been failing on the
 *      orders_order_number_idx collision (the symptom that prompted this
 *      heal) so the drainer doesn't keep retrying them.
 *   2. Selects every order where payment_status='paid' AND created_at
 *      crossed 2026-05-25 00:00 IST.
 *   3. Inserts one new `order.created` row per order into erp_outbound_queue
 *      with `scheduled_for = now()` so the drain worker (30-second cadence)
 *      picks them up immediately rather than waiting for the default 180s
 *      buffer.
 *   4. Prints a summary; the operator watches webhook_deliveries / drain
 *      logs to confirm progress.
 *
 * Idempotent: re-runs will simply enqueue another order.created. Audit's
 * dedupe-by-order_number on its ingest path makes this safe.
 */
import { config } from "dotenv";
import path from "node:path";
config({ path: path.resolve(process.cwd(), ".env.local") });
config({ path: path.resolve(process.cwd(), ".env") });

import { sql } from "drizzle-orm";
import { db } from "@/db/client";

// 2026-05-25 00:00 IST == 2026-05-24 18:30 UTC.
const CUTOFF_UTC = "2026-05-24 18:30:00+00";

const DRY_RUN = process.argv.includes("--dry-run");

async function main(): Promise<void> {
  console.log(`[resync] cutoff = ${CUTOFF_UTC} (2026-05-25 00:00 IST)`);
  console.log(`[resync] dry-run = ${DRY_RUN}`);

  // ── Step 1: cancel the stuck queue rows. ────────────────────────────
  // These are the rows whose drainer back-link failed on the
  // orders_order_number_idx collision before the B1 fix landed. They'll
  // be superseded by the fresh enqueue below.
  const stuckRes = await db.execute(sql`
    SELECT COUNT(*)::int AS n
      FROM erp_outbound_queue
     WHERE status = 'failed'
       AND last_error LIKE '%duplicate key%'
  `);
  const stuckCount = Number((stuckRes as unknown as { n: number }[])[0]?.n ?? 0);
  console.log(`[resync] stuck queue rows to cancel: ${stuckCount}`);

  if (!DRY_RUN && stuckCount > 0) {
    await db.execute(sql`
      UPDATE erp_outbound_queue
         SET status = 'cancelled',
             last_error = 'superseded by resync ' || to_char(now(), 'YYYY-MM-DD')
       WHERE status = 'failed'
         AND last_error LIKE '%duplicate key%'
    `);
    console.log(`[resync] cancelled ${stuckCount} stuck queue rows`);
  }

  // ── Step 2: find orders to re-push. ─────────────────────────────────
  const candidatesRes = await db.execute(sql`
    SELECT id, order_number, created_at
      FROM orders
     WHERE payment_status = 'paid'
       AND created_at >= ${CUTOFF_UTC}::timestamptz
     ORDER BY created_at
  `);
  const candidates = candidatesRes as unknown as Array<{
    id: string;
    order_number: string;
    // `db.execute(sql)` returns column values as strings (raw pg) — not
    // typed Date objects.
    created_at: string;
  }>;
  console.log(`[resync] paid orders since cutoff: ${candidates.length}`);
  if (candidates.length === 0) {
    console.log(`[resync] nothing to do — exiting`);
    return;
  }
  console.log(
    `[resync]   oldest: ${candidates[0].order_number} @ ${candidates[0].created_at}`
  );
  console.log(
    `[resync]   newest: ${candidates[candidates.length - 1].order_number} @ ${candidates[
      candidates.length - 1
    ].created_at}`
  );

  if (DRY_RUN) {
    console.log(`[resync] DRY RUN — no queue rows inserted`);
    return;
  }

  // ── Step 3: enqueue order.created for each, scheduled NOW. ──────────
  // Bypass the default 180s buffer (`enqueueOrderEvent`'s delay) — for a
  // controlled heal we want the drain worker to pick these up on its
  // next 30s tick, not 3+ minutes later.
  //
  // Per-row inserts because postgres-js doesn't bind a JS string[] to
  // `uuid[]` cleanly through a single parameter; 76 inserts is fine.
  let inserted = 0;
  for (const c of candidates) {
    await db.execute(sql`
      INSERT INTO erp_outbound_queue (order_id, event_type, scheduled_for)
      VALUES (${c.id}::uuid, 'order.created', now())
    `);
    inserted += 1;
  }
  console.log(`[resync] enqueued ${inserted} order.created events`);
  console.log(`[resync] drain worker will pick them up within ~30s`);
  console.log(`[resync] watch progress:`);
  console.log(`[resync]   docker exec inventre-deploy-postgres psql -U inventre -d inventre -c "SELECT status, COUNT(*) FROM erp_outbound_queue GROUP BY status"`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[resync] failed:", err);
    process.exit(1);
  });
