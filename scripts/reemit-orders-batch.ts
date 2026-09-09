/* eslint-disable no-console */
/**
 * Re-emit `order.updated` for a batch of order IDs (one per line via a file),
 * reusing the live payload builder + HMAC signing (emitOrderEvent). Idempotent —
 * audit dedupes by order_number and re-upserts sub_items (so corrected
 * bundle_selections quantities propagate).
 *
 *   DATABASE_URL=… npx tsx --conditions=react-server \
 *     scripts/reemit-orders-batch.ts <idsFile> [--apply]
 *
 * Without --apply it prints the resolved target + count (dry run).
 */
import { config } from "dotenv";
import path from "node:path";
import fs from "node:fs";
config({ path: path.resolve(process.cwd(), ".env.deploy") });
config({ path: path.resolve(process.cwd(), ".env.local") });
config({ path: path.resolve(process.cwd(), ".env") });

import { emitOrderEvent } from "@/lib/erp-bridge";
import { getErpConfig } from "@/lib/erp-config";

async function main() {
  const idsFile = process.argv[2];
  const apply = process.argv.includes("--apply");
  if (!idsFile) {
    console.error("usage: reemit-orders-batch <idsFile> [--apply]");
    process.exit(1);
  }
  const ids = fs
    .readFileSync(idsFile, "utf8")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  const cfg = getErpConfig();
  console.log(`target=${cfg.target}`);
  console.log(`ingestUrl=${cfg.ingestUrl}`);
  console.log(`db=${(process.env.DATABASE_URL || "").replace(/:[^:@]*@/, ":****@")}`);
  console.log(`orders=${ids.length}`);
  if (!apply) {
    console.log("DRY RUN — pass --apply to actually emit.");
    return;
  }
  let ok = 0;
  for (const id of ids) {
    try {
      await emitOrderEvent(id, "order.updated");
      ok++;
      console.log(`[${ok}/${ids.length}] emitted ${id}`);
    } catch (e) {
      console.error(`FAILED ${id}:`, e);
    }
  }
  console.log(`done — ${ok}/${ids.length} emitted. Check webhook_deliveries + audit.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
