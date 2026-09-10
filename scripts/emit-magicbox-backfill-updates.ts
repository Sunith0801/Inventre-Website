/**
 * Companion to insert-missing-magicbox-selections.ts: push the newly-written
 * bundle_selections to audit as order.updated.
 *
 * Split out because the insert run had no ERP env loaded, so its emit was
 * skipped (emitOrderEvent swallows a missing-config as a warn, not a throw).
 * Verifies the bridge is actually configured BEFORE emitting, and awaits each
 * emit — a floating emit is lost at process exit.
 *
 *   eval "$(docker exec inventre-deploy-app printenv \
 *     | grep -E '^(ERP_TARGET|STAGING_ERP_|PROD_ERP_)' | sed 's/^/export /')" \
 *   DATABASE_URL=... npx tsx --conditions=react-server \
 *     scripts/emit-magicbox-backfill-updates.ts
 */
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { emitOrderEvent, buildErpOrderPayload } from "@/server/erp-bridge";
import { isErpBridgeConfigured } from "@/server/erp-config";

const ORDERS = ["SAL-ORD-2026-27393", "SAL-ORD-2026-30648"];

async function main() {
  if (!isErpBridgeConfigured()) {
    throw new Error(
      "ERP bridge not configured — refusing to emit. Load ERP_TARGET + the matching *_ERP_INGEST_URL / *_ERP_WEBHOOK_SECRET."
    );
  }

  for (const orderNo of ORDERS) {
    const res: any = await db.execute(sql`
      SELECT id FROM orders WHERE order_number = ${orderNo}
    `);
    const rows = res.rows ?? res;
    if (rows.length !== 1) throw new Error(`${orderNo}: not found`);
    const orderId = rows[0].id;

    // Confirm the payload actually carries the sub-items before pushing.
    const payload: any = await buildErpOrderPayload(orderId);
    const subs = payload?.order?.sub_items ?? [];
    console.log(`${orderNo}: payload carries ${subs.length} sub_items`);
    if (subs.length === 0) {
      throw new Error(`${orderNo}: 0 sub_items in payload — aborting emit`);
    }

    await emitOrderEvent(orderId, "order.updated");
    console.log(`${orderNo}: ✓ order.updated emitted`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
