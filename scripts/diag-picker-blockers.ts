/**
 * Diagnostic (read-only): for one order, dump every signal the exchange /
 * missing PICKER uses, so we can see which gate (if any) empties it.
 * Run: npx tsx --conditions=react-server scripts/diag-picker-blockers.ts ORDNO
 */
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { getParentOrderDetailFromErp } from "@/server/erp-customer-orders";
import {
  classifyReturnItems,
  getHeldBackOrderItemIds,
  getBookkitParcelDelivered,
  getLockedOrderItemIds,
} from "@/server/return-line-eligibility";

async function main() {
  const ono = process.argv[2];
  const r = (await db.execute(sql`
    SELECT id::text AS id, parent_id::text AS parent_id, status, delivered_at
      FROM orders WHERE order_number = ${ono} LIMIT 1
  `)) as unknown as Array<{
    id: string;
    parent_id: string | null;
    status: string;
    delivered_at: Date | null;
  }>;
  const lo = r[0];
  if (!lo) return console.log("no local order");

  const detail = (await getParentOrderDetailFromErp(lo.parent_id!, ono)) as
    | {
        status?: string;
        items?: Array<{ id: string; name: string; status?: string | null }>;
      }
    | null;

  const elig = await classifyReturnItems(
    lo.id,
    ono,
    detail?.status === "delivered" || lo.status === "delivered",
    lo.delivered_at ?? null,
  );
  const held = await getHeldBackOrderItemIds(lo.id, ono);
  const locked = await getLockedOrderItemIds(lo.id);
  const bookkit = await getBookkitParcelDelivered(ono);

  console.log(`order ${ono}  headline=${detail?.status}  bookkitParcel=${bookkit}`);
  for (const it of detail?.items ?? []) {
    const e = elig.get(it.id);
    console.log(
      `  ${it.name.padEnd(34)} badge=${String(it.status).padEnd(12)} ` +
        `delivered=${e?.delivered ?? "-"}  heldBack=${held.has(it.id)}  ` +
        `locked=${locked.has(it.id) ? locked.get(it.id) : "no"}`,
    );
  }
  process.exit(0);
}
main();
