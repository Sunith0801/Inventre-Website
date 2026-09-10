/* eslint-disable no-console */
/**
 * One-shot backfill for the 2026-05-28 → 2026-06-01 poll outage.
 *
 * After ERP_INBOUND_ORDERS_POLL_ENABLED is flipped on, the regular
 * /api/cron/erp-poll endpoint resumes — but it only walks orders
 * whose `modified` timestamp on audit is past the stored watermark.
 * Orders that changed on audit during the outage and haven't been
 * touched since stay invisible. This script force-repolls every
 * non-terminal local order whose erp_last_polled_at is older than
 * the outage cutoff, fetching detail from audit.inventre.in and
 * re-deriving local status.
 *
 *   DATABASE_URL=… npx tsx scripts/repoll-stale-orders.ts [--dry-run] [--limit=N]
 *
 * Idempotent: re-running on already-fresh rows is a no-op fetch.
 */
import { config } from "dotenv";
import path from "node:path";
config({ path: path.resolve(process.cwd(), ".env.deploy") });
config({ path: path.resolve(process.cwd(), ".env.local") });
config({ path: path.resolve(process.cwd(), ".env") });

import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { erpAuthedGet } from "@/server/erp-jwt";
import {
  upsertOrderMirror,
  upsertItemsMirror,
  deriveStatusForErpOrderName,
  type ErpOrderDetailResp,
} from "@/server/erp-poll";

const CUTOFF = "2026-05-28 16:41:00+00";
const DRY = process.argv.includes("--dry-run");
const limitArg = process.argv.find((a) => a.startsWith("--limit="));
const LIMIT = limitArg ? Number(limitArg.slice("--limit=".length)) : 5000;

async function main() {
  const r: any = await db.execute(sql`
    SELECT erp_so_name
      FROM orders
     WHERE erp_so_name IS NOT NULL
       AND status NOT IN ('delivered','cancelled','returned')
       AND (erp_last_polled_at IS NULL OR erp_last_polled_at < ${CUTOFF}::timestamptz)
     ORDER BY created_at ASC
     LIMIT ${LIMIT}
  `);
  const rows = (r?.rows ?? r ?? []) as Array<{ erp_so_name: string }>;
  console.log(`stale candidates: ${rows.length}${DRY ? " (dry-run)" : ""}`);
  if (DRY || rows.length === 0) return;

  let ok = 0;
  let failed = 0;
  let advanced = 0;
  for (const row of rows) {
    const name = row.erp_so_name;
    try {
      const detail = await erpAuthedGet<ErpOrderDetailResp>(
        `/api/orders/${encodeURIComponent(name)}`
      );
      if (!detail?.header?.name) {
        failed++;
        continue;
      }
      await upsertOrderMirror(detail.header);
      if (Array.isArray(detail.items)) {
        await upsertItemsMirror(detail.header.name, detail.items);
      }
      const changed = await deriveStatusForErpOrderName(detail.header.name);
      if (changed) advanced++;
      ok++;
      if (ok % 50 === 0) {
        console.log(`  ${ok}/${rows.length} polled (advanced=${advanced} failed=${failed})`);
      }
    } catch (e) {
      failed++;
      console.warn(
        `  ✗ ${name}: ${e instanceof Error ? e.message.slice(0, 160) : e}`
      );
    }
  }
  console.log(`done. polled=${ok} advanced=${advanced} failed=${failed}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
