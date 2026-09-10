/* eslint-disable no-console */
/**
 * One-shot: re-fetch a single order from audit.inventre.in and
 * re-derive its local status. Bypasses the terminal-status guard in
 * scripts/repoll-stale-orders.ts so it works for delivered/cancelled
 * rows too.
 *
 *   DATABASE_URL=… npx tsx scripts/repoll-one-order.ts SAL-ORD-2026-XXXXX
 */
import { config } from "dotenv";
import path from "node:path";
config({ path: path.resolve(process.cwd(), ".env.deploy") });
config({ path: path.resolve(process.cwd(), ".env.local") });
config({ path: path.resolve(process.cwd(), ".env") });

import { erpAuthedGet } from "@/server/erp-jwt";
import {
  upsertOrderMirror,
  upsertItemsMirror,
  deriveStatusForErpOrderName,
  type ErpOrderDetailResp,
} from "@/server/erp-poll";

async function main() {
  const name = process.argv[2];
  if (!name) {
    console.error("Usage: tsx scripts/repoll-one-order.ts <SAL-ORD-...>");
    process.exit(1);
  }
  const detail = await erpAuthedGet<ErpOrderDetailResp>(
    `/api/orders/${encodeURIComponent(name)}`
  );
  if (!detail?.header?.name) {
    console.error(`audit returned no header for ${name}`);
    process.exit(2);
  }
  console.log("audit header:", JSON.stringify(detail.header, null, 2));
  await upsertOrderMirror(detail.header);
  if (Array.isArray(detail.items)) {
    await upsertItemsMirror(detail.header.name, detail.items);
  }
  const changed = await deriveStatusForErpOrderName(detail.header.name);
  console.log(`status changed: ${changed}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
