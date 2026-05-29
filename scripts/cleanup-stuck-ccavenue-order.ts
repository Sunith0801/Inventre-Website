/**
 * One-shot cleanup for a single CCAvenue order stuck in `pending` because
 * the hosted-redirect sandbox returned `order_status=Success` and the
 * shared mapper (lib/ccavenue.ts:mapCCAvenueStatus) only recognised the
 * Status API's `Successful` enum, so the callback path produced
 * `kind: "no-change"` and the row never finalised.
 *
 *   npx tsx scripts/cleanup-stuck-ccavenue-order.ts <ORDER_NUMBER>
 *
 * Runs the same `finalizeOrderPayment` helper the reconcile cron / status
 * poller use — so stock decrement, cart clear, SMS, and ERP enqueue all
 * fire the way they would have if the callback had worked first time.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { orders, payments } from "@/db/schema";
import { finalizeOrderPayment } from "@/lib/ccavenue-finalize";
import type { NormalizedGatewayResult } from "@/lib/ccavenue";

async function main() {
  const orderNumber = process.argv[2];
  if (!orderNumber) {
    console.error("Usage: tsx scripts/cleanup-stuck-ccavenue-order.ts <ORDER_NUMBER>");
    process.exit(1);
  }

  const [row] = await db
    .select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      paymentStatus: orders.paymentStatus,
      status: orders.status,
      total: orders.total,
      payStatus: payments.status,
      finalized: payments.paymentFinalized,
    })
    .from(orders)
    .leftJoin(payments, eq(payments.orderId, orders.id))
    .where(eq(orders.orderNumber, orderNumber))
    .limit(1);

  if (!row) {
    console.error(`Order ${orderNumber} not found`);
    process.exit(2);
  }

  console.log("Before:", row);

  if (row.finalized) {
    console.log("Already finalized — nothing to do.");
    process.exit(0);
  }

  // Synthetic "callback succeeded" payload. We mirror what CCAvenue would
  // have sent if the hosted-redirect had landed and the mapper had
  // accepted "Success" — paid status, no real tracking ID (test sandbox
  // didn't issue one), amount in rupees from order.total.
  const normalized: NormalizedGatewayResult = {
    status: "paid",
    trackingId: null,
    bankRef: null,
    paidAmount: ((row.total ?? 0) / 100).toFixed(2),
    paymentDate: null,
    paymentMode: "CCAvenue (sandbox replay)",
    rawStatus: "Successful",
    rawResponse: {
      replayedBy: "scripts/cleanup-stuck-ccavenue-order.ts",
      replayedAt: new Date().toISOString(),
      note: "Manual cleanup — sandbox 'Send Response' click never reached pre-mapper-fix callback handler.",
    },
  };

  const result = await finalizeOrderPayment({
    orderId: row.id,
    source: "callback",
    normalized,
  });

  console.log("Result:", result);

  const [after] = await db
    .select({
      paymentStatus: orders.paymentStatus,
      status: orders.status,
      payStatus: payments.status,
      finalized: payments.paymentFinalized,
    })
    .from(orders)
    .leftJoin(payments, eq(payments.orderId, orders.id))
    .where(eq(orders.id, row.id))
    .limit(1);

  console.log("After:", after);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
