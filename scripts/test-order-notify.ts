/* eslint-disable no-console */
/**
 * Scratch test for lib/order-confirmation.ts — DELETE AFTER USE.
 *
 *   DATABASE_URL=… NODE_OPTIONS="--conditions=react-server" \
 *     npx tsx scripts/test-order-notify.ts <orderId>
 *
 * The react-server condition maps the `server-only` marker to its empty
 * stub so lib modules load under plain tsx.
 */
import { config } from "dotenv";
import path from "node:path";
config({ path: path.resolve(process.cwd(), ".env.local") });

async function main() {
  const orderId = process.argv[2];
  if (!orderId) throw new Error("usage: test-order-notify.ts <orderId>");
  const { notifyOrderConfirmed } = await import("@/server/order-confirmation");
  await notifyOrderConfirmed(orderId);
  const { db } = await import("@/db/client");
  const { sql } = await import("drizzle-orm");
  const rows = await db.execute(sql`
    SELECT order_number, channel, recipient, status, vendor_id, error, attempt,
           created_at AT TIME ZONE 'Asia/Kolkata' AS ist
    FROM order_notifications ORDER BY created_at DESC LIMIT 10`);
  console.table(rows);
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
