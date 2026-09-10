/**
 * Diagnostic (read-only): for each order number, compare what the storefront
 * order page BADGES against what the exchange/missing BUTTON gate decides.
 * Run: npx tsx --conditions=react-server scripts/diag-porter-gate.ts ORD1 ORD2
 */
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { getParentOrderDetailFromErp } from "@/server/erp-customer-orders";
import { classifyReturnItems } from "@/server/return-line-eligibility";

async function main() {
  const list = process.argv.slice(2);
  for (const ono of list) {
    const r = (await db.execute(sql`
      SELECT id::text AS id, order_number, parent_id::text AS parent_id,
             status, delivered_at
        FROM orders WHERE order_number = ${ono} LIMIT 1
    `)) as unknown as Array<{
      id: string;
      order_number: string;
      parent_id: string | null;
      status: string;
      delivered_at: Date | null;
    }>;
    const lo = r[0];
    if (!lo) {
      console.log(`${ono}: no local order`);
      continue;
    }
    const detail = lo.parent_id
      ? await getParentOrderDetailFromErp(lo.parent_id, ono)
      : null;
    const d = detail as unknown as {
      status?: string;
      categoryGroups?: Array<{
        rootCategoryName: string;
        status: string;
        items?: Array<{ name?: string; status?: string }>;
      }>;
    } | null;
    const derivedDelivered =
      d?.status === "delivered" || lo.status === "delivered";
    const cls = await classifyReturnItems(
      lo.id,
      ono,
      derivedDelivered,
      lo.delivered_at ?? null,
    );
    const anyDelivered = Array.from(cls.values()).some((e) => e.delivered);
    console.log(
      `${ono}  local=${lo.status}  headline=${d?.status ?? "-"}  ` +
        `cards=[${(d?.categoryGroups ?? [])
          .map((g) => `${g.rootCategoryName}:${g.status}`)
          .join(", ")}]  →  BUTTON=${anyDelivered ? "SHOWN" : "HIDDEN"}` +
        `  (lines delivered ${
          Array.from(cls.values()).filter((e) => e.delivered).length
        }/${cls.size})`,
    );
  }
  process.exit(0);
}
main();
