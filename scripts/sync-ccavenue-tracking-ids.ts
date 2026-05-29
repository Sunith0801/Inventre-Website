/* eslint-disable no-console */
/**
 * Backfill `payments.gateway_tracking_id` from CCAvenue's Status API for
 * every paid/failed/aborted order that doesn't already have one.
 *
 * Usage:
 *   npx tsx scripts/sync-ccavenue-tracking-ids.ts            # full apply
 *   npx tsx scripts/sync-ccavenue-tracking-ids.ts --dry-run  # report only
 *   npx tsx scripts/sync-ccavenue-tracking-ids.ts --limit=50 # cap call count
 *
 * The Status API call uses `lib/ccavenue.ts:fetchCCAvenueOrderStatus`
 * with our merchant `order_no` (= orders.order_number). For each row we
 * get back, we merge the CCAvenue tracking_id, paid amount, mode, and
 * date into the local payment row.
 *
 * Throttled at 200ms between calls to avoid hammering CCAvenue.
 */

import { config } from "dotenv";
import path from "path";
config({ path: path.resolve(process.cwd(), ".env.local") });
config({ path: path.resolve(process.cwd(), ".env") });

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import { fetchCCAvenueOrderStatus, isCCAvenueConfigured } from "@/lib/ccavenue";

const url = process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_DIRECT_URL or DATABASE_URL is required");

const client = postgres(url, { max: 5 });
const db = drizzle(client);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const THROTTLE_MS = 200;

type Candidate = {
  order_id: string;
  order_number: string;
  payment_id: string;
  payment_status: string | null;
  gateway_tracking_id: string | null;
};

async function main() {
  if (!isCCAvenueConfigured()) {
    console.error(
      "[sync-ccavenue] CCAvenue env vars not set. Add CCAVENUE_MERCHANT_ID / ACCESS_CODE / WORKING_KEY / API_BASE to .env.local and re-run."
    );
    process.exit(1);
  }

  const dryRun = process.argv.includes("--dry-run");
  const limitArg = process.argv.find((a) => a.startsWith("--limit="));
  const limit = limitArg ? Math.max(1, parseInt(limitArg.split("=")[1], 10)) : 0;

  console.log(`\n[sync-ccavenue] ${dryRun ? "DRY-RUN" : "LIVE"} — scanning for payments missing gateway_tracking_id…`);

  // Candidates: every payment row without a tracking_id, restricted to
  // payments that LOOK finalised (status not in pending/null) — pending
  // payments don't have a tracking_id assigned at CCAvenue yet and would
  // return "Initiated" on the Status API, wasting a call. We also skip
  // payments where the parent order's order_number doesn't match our
  // canonical format, just in case.
  const candidatesRes = await db.execute(sql`
    SELECT o.id::text   AS order_id,
           o.order_number,
           p.id::text   AS payment_id,
           p.status     AS payment_status,
           p.gateway_tracking_id
      FROM orders o
      JOIN payments p ON p.order_id = o.id
     WHERE (p.gateway_tracking_id IS NULL OR p.gateway_tracking_id = '')
       AND o.order_number ~* '^SAL-ORD-'
       AND p.status IN ('paid','failed','refunded')
     ORDER BY o.created_at DESC
     ${limit > 0 ? sql`LIMIT ${limit}` : sql``}
  `);
  const candidates = ((candidatesRes as { rows?: Candidate[] }).rows ??
    (candidatesRes as unknown as Candidate[])) as Candidate[];

  console.log(`  ${candidates.length} candidates to look up.\n`);
  if (candidates.length === 0) {
    await client.end();
    return;
  }

  let updated = 0;
  let skipped = 0;
  let errored = 0;
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    try {
      const result = await fetchCCAvenueOrderStatus({
        orderNo: c.order_number,
        referenceNo: null,
      });
      const newTracking = result.trackingId ?? null;
      if (!newTracking) {
        skipped++;
        if (i % 25 === 0) console.log(`  [${i + 1}/${candidates.length}] ${c.order_number} → no tracking_id (${result.rawStatus})`);
        continue;
      }
      if (dryRun) {
        console.log(`  [${i + 1}/${candidates.length}] ${c.order_number} → would set tracking_id=${newTracking}`);
      } else {
        await db.execute(sql`
          UPDATE payments
             SET gateway_tracking_id = ${newTracking},
                 paid_amount         = COALESCE(${result.paidAmount}, paid_amount),
                 payment_mode        = COALESCE(${result.paymentMode}, payment_mode),
                 payment_date        = COALESCE(${result.paymentDate}, payment_date),
                 gateway_response_message = ${'CCAvenue sync ' + new Date().toISOString() + ': status=' + result.rawStatus},
                 last_status_poll_at = NOW()
           WHERE id = ${c.payment_id}
        `);
      }
      updated++;
      if (i % 25 === 0) console.log(`  [${i + 1}/${candidates.length}] ${c.order_number} → ${newTracking}`);
    } catch (e) {
      errored++;
      console.warn(`  [${i + 1}/${candidates.length}] ${c.order_number} → error: ${e instanceof Error ? e.message.slice(0, 120) : e}`);
    }
    await sleep(THROTTLE_MS);
  }

  console.log(`\n[sync-ccavenue] done.`);
  console.log(`  ${dryRun ? "would update" : "updated"}: ${updated}`);
  console.log(`  skipped (no tracking_id from CCAvenue): ${skipped}`);
  console.log(`  errored: ${errored}\n`);
  await client.end();
}

main().catch(async (e) => {
  console.error(e);
  await client.end();
  process.exit(1);
});
