/* eslint-disable no-console */
/**
 * One-off: re-emit a single `exchange.requested` webhook to the audit ERP for
 * a return whose original emit was dropped (exchange emits are fire-and-forget
 * with no queue/retry — a transient failure at creation time loses the event).
 *
 * Reuses the EXACT live payload builder + HMAC signing (emitExchangeEvent →
 * buildExchangePayload → postErpEvent), so nothing diverges from production.
 * Audit dedupes by return_number, so re-running is safe.
 *
 * Run with the prod app container's ERP + DB env, e.g.:
 *   npx tsx --conditions=react-server scripts/reemit-exchange.ts <RETURN_ID>
 */
import { config } from "dotenv";
import path from "node:path";
config({ path: path.resolve(process.cwd(), ".env.local") });
config({ path: path.resolve(process.cwd(), ".env") });

import { emitExchangeEvent } from "@/server/erp-bridge";

async function main() {
  const returnId = process.argv[2];
  if (!returnId) {
    console.error("usage: reemit-exchange.ts <RETURN_ID>");
    process.exit(1);
  }
  console.log(`Re-emitting exchange.requested for return ${returnId} …`);
  await emitExchangeEvent(returnId, "exchange.requested");
  console.log("Done. Check webhook_deliveries for a new row + HTTP 200.");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
