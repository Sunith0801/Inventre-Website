/* eslint-disable no-console */
/**
 * Re-emit a SINGLE order's `order.updated` event to the audit ERP, reusing
 * the exact live payload builder + HMAC signing (emitOrderEvent). Idempotent —
 * audit dedupes by order_number and re-upserts.
 *
 * Loads .env.deploy FIRST so we pick up the SAME ERP_TARGET +
 * STAGING_ERP_INGEST_URL / STAGING_ERP_WEBHOOK_SECRET the live container uses
 * (→ https://audit.inventre.in). DATABASE_URL is supplied inline in the shell
 * and dotenv won't override it (so we read the prod DB at localhost:6433).
 *
 *   DATABASE_URL=… npx tsx --conditions=react-server \
 *     scripts/reemit-one-order.ts <orderId> [--apply]
 *
 * Without --apply it only prints the resolved target/ingest URL (dry run).
 */
import { config } from "dotenv";
import path from "node:path";
config({ path: path.resolve(process.cwd(), ".env.deploy") });
config({ path: path.resolve(process.cwd(), ".env.local") });
config({ path: path.resolve(process.cwd(), ".env") });

import { emitOrderEvent } from "@/server/erp-bridge";
import { getErpConfig } from "@/server/erp-config";

async function main() {
  const orderId = process.argv[2];
  const apply = process.argv.includes("--apply");
  if (!orderId) {
    console.error("usage: reemit-one-order <orderId> [--apply]");
    process.exit(1);
  }
  const cfg = getErpConfig();
  console.log(`target=${cfg.target}`);
  console.log(`ingestUrl=${cfg.ingestUrl}`);
  console.log(
    `db=${(process.env.DATABASE_URL || "").replace(/:[^:@]*@/, ":****@")}`,
  );
  if (!apply) {
    console.log("DRY RUN — pass --apply to actually emit.");
    return;
  }
  console.log(`emitting order.updated for ${orderId} …`);
  await emitOrderEvent(orderId, "order.updated");
  console.log("done — check webhook_deliveries + audit sales_orders.");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
