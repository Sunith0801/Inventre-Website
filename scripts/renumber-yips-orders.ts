/**
 * Resequence YIPS offline-order numbers to YIPS-2026-NNNN (single sequence
 * across both source years, ordered by source ID). Source link is kept in
 * payments.internal_payment_reference (untouched).
 *
 * Audit dedups by order_number, so a rename needs the old-named SO removed and
 * the new-named one created. Host scripts can't emit to audit (no ERP env), so
 * we ENQUEUE events (DB-only) and let the in-container cron drain send them
 * (the drain rebuilds each payload from live DB state at send time). That
 * forces a strict phase order:
 *
 *   1. --phase delete : enqueue order.deleted for all (names still OLD) → drain
 *                       → audit drops 25YIPS####/26YIPS####.   [DRAIN BEFORE 2]
 *   2. --phase rename : UPDATE order_number + payments.gateway_order_id.
 *   3. --phase create : enqueue order.created for all (names now NEW) → drain
 *                       → audit creates YIPS-2026-####.
 *
 *   DATABASE_URL=… NODE_PATH=<shim> npx tsx --conditions=react-server \
 *     scripts/renumber-yips-orders.ts --phase <delete|rename|create> [--apply] [--limit N]
 */
import { config } from "dotenv";
import { and, eq, ilike } from "drizzle-orm";
import { db } from "@/db/client";
import { orders, payments } from "@/db/schema";
import { enqueueOrderEvent } from "@/lib/erp-bridge";

config({ path: ".env.local" });
config();

const PREFIX = "YIPS-2026-";
const SRC_RE = /yips-offline:(\d{2})yips0*(\d+)/i;

async function plan() {
  const rows = await db
    .select({ id: orders.id, orderNumber: orders.orderNumber, ref: payments.internalPaymentReference })
    .from(orders)
    .innerJoin(payments, eq(payments.orderId, orders.id))
    .where(ilike(payments.internalPaymentReference, "yips-offline:%"));
  // APPEND-STABLE: orders already numbered YIPS-2026-#### keep their number;
  // any still on a source ID get appended after the current max, ordered by
  // source ID. This lets late-corrected orders join without renumbering the
  // already-live sequence.
  const kept = rows.filter((r) => new RegExp(`^${PREFIX}\\d+$`).test(r.orderNumber));
  let maxSeq = 0;
  for (const r of kept) maxSeq = Math.max(maxSeq, parseInt(r.orderNumber.slice(PREFIX.length), 10) || 0);
  const news = rows
    .filter((r) => !r.orderNumber.startsWith(PREFIX))
    .map((r) => {
      const m = (r.ref || "").match(SRC_RE);
      return { ...r, yy: m ? parseInt(m[1], 10) : 99, nn: m ? parseInt(m[2], 10) : 0 };
    })
    .sort((a, b) => a.yy - b.yy || a.nn - b.nn || a.orderNumber.localeCompare(b.orderNumber));
  const mapping = kept.map((r) => ({ ...r, target: r.orderNumber }));
  let seq = maxSeq;
  for (const r of news) { seq += 1; mapping.push({ ...r, target: `${PREFIX}${String(seq).padStart(4, "0")}` }); }
  return mapping;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const phaseIdx = process.argv.indexOf("--phase");
  const phase = phaseIdx >= 0 ? process.argv[phaseIdx + 1] : "";
  const limIdx = process.argv.indexOf("--limit");
  const limit = limIdx >= 0 ? parseInt(process.argv[limIdx + 1], 10) : Infinity;
  if (!["delete", "rename", "create"].includes(phase)) {
    console.error("usage: --phase <delete|rename|create> [--apply] [--limit N]");
    process.exit(1);
  }
  console.log(`db=${(process.env.DATABASE_URL || "").replace(/:[^:@]*@/, ":****@")}`);
  console.log(`phase=${phase}  mode=${apply ? "APPLY" : "DRY RUN"}  limit=${limit}`);

  const mapping = await plan();
  console.log(`${mapping.length} YIPS orders`);

  let done = 0;
  for (const r of mapping) {
    if (done >= limit) break;
    const needsRename = r.orderNumber !== r.target;

    if (phase === "delete") {
      // Only delete orders that will actually be renamed (the already-correct
      // sample keeps its audit SO — no delete needed).
      if (!needsRename) continue;
      console.log(`del ${r.orderNumber}`);
      if (apply) await enqueueOrderEvent(r.id, "order.deleted");
    } else if (phase === "rename") {
      if (!needsRename) continue;
      console.log(`→ ${r.orderNumber.padEnd(12)} ⇒ ${r.target}`);
      if (apply) {
        await db.update(orders).set({ orderNumber: r.target }).where(eq(orders.id, r.id));
        await db
          .update(payments)
          .set({ gatewayOrderId: r.target })
          .where(and(eq(payments.orderId, r.id), ilike(payments.internalPaymentReference, "yips-offline:%")));
      }
    } else {
      // create: (re)create EVERY order's new-named SO in audit (incl. sample,
      // an idempotent upsert). Expects rename phase already applied.
      console.log(`new ${r.target}`);
      if (apply) await enqueueOrderEvent(r.id, "order.created");
    }
    done += 1;
  }
  console.log(`\n${apply ? "APPLIED" : "DRY RUN"} phase=${phase}: ${done} order(s)`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
