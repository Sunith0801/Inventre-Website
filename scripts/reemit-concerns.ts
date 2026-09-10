/**
 * Re-emit `concern.created` to audit for every minted concern.
 *
 * Concerns raised before audit's ecom ingest had a `concern.created`
 * handler failed to land (HTTP 401/409). The audit side now upserts on
 * `concern_number`, so re-emitting is idempotent — existing rows update
 * in place, missing ones get created.
 *
 * Run on the inventre host with prod env:
 *   DATABASE_URL=...:6433/inventre ERP_TARGET=staging \
 *   STAGING_ERP_INGEST_URL=... STAGING_ERP_WEBHOOK_SECRET=... \
 *   npx tsx --conditions=react-server scripts/reemit-concerns.ts
 */
import { asc, isNotNull } from "drizzle-orm";
import { db } from "@/db/client";
import { concerns } from "@/db/schema";
import { emitConcernEvent } from "@/server/erp-bridge";

async function main() {
  const rows = await db
    .select({ id: concerns.id, n: concerns.concernNumber })
    .from(concerns)
    .where(isNotNull(concerns.concernNumber))
    .orderBy(asc(concerns.createdAt));

  console.log(`re-emitting ${rows.length} concern(s) to audit…`);
  for (const r of rows) {
    await emitConcernEvent(r.id, "concern.created");
    console.log(`  emitted ${r.n}`);
  }
  console.log("done.");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
