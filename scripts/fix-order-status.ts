// Run with NODE_OPTIONS="--conditions=react-server" — the audit-sync
// enqueue below pulls in lib/erp-bridge, whose `server-only` marker throws
// under plain tsx without that resolution condition.
import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { orders } from "@/db/schema";

async function main() {
  const orderNumber = process.argv[2];
  const newStatus = process.argv[3] ?? "confirmed";
  if (!orderNumber) {
    console.error("Usage: tsx scripts/fix-order-status.ts <ORDER_NUMBER> [status]");
    process.exit(1);
  }

  const [before] = await db
    .select({
      id: orders.id,
      status: orders.status,
      paymentStatus: orders.paymentStatus,
      confirmedAt: orders.confirmedAt,
    })
    .from(orders)
    .where(eq(orders.orderNumber, orderNumber))
    .limit(1);

  if (!before) {
    console.error(`Order ${orderNumber} not found`);
    process.exit(2);
  }

  console.log("before:", before);

  await db
    .update(orders)
    .set({
      status: newStatus,
      confirmedAt: before.confirmedAt ?? new Date(),
    })
    .where(eq(orders.id, before.id));

  // Script-side cancellations must reach audit too — same buffered queue
  // the admin-UI cancel uses (app/api/admin/orders/[id]/route.ts).
  if (newStatus === "cancelled") {
    const { enqueueOrderEvent } = await import("@/server/erp-bridge");
    await enqueueOrderEvent(before.id, "order.cancelled");
    console.log("enqueued order.cancelled for audit sync");
  }

  const [after] = await db
    .select({
      status: orders.status,
      paymentStatus: orders.paymentStatus,
      confirmedAt: orders.confirmedAt,
    })
    .from(orders)
    .where(eq(orders.id, before.id))
    .limit(1);

  console.log("after:", after);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
