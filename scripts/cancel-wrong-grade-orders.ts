/* eslint-disable no-console */
/**
 * Cancel the orders contaminated by the wrong-grade magic-box bug
 * (root-caused and fixed in commit c58d7fe). An order qualifies if at
 * least one of its `order_items` rows points at a product whose
 * `product_grades` set exists but does not include the order's
 * student's grade.
 *
 *   DATABASE_URL=… npx tsx scripts/cancel-wrong-grade-orders.ts
 *   DATABASE_URL=… npx tsx scripts/cancel-wrong-grade-orders.ts --apply
 *   DATABASE_URL=… npx tsx scripts/cancel-wrong-grade-orders.ts --order=SAL-ORD-2026-30077
 *
 * Default is dry-run: prints the orders it WOULD cancel and the ERP
 * events it WOULD enqueue, makes zero writes. Pass --apply to mutate.
 *
 * Status transitions:
 *   orders.status: placed/confirmed → cancelled
 *   payments: untouched. `payment_status` enum is
 *     {pending,paid,failed,refunded} — there is no `cancelled` state,
 *     and `orders.status='cancelled'` is the source of truth admin
 *     and fulfilment queries already filter on. ccavenue-finalize
 *     refuses to mark a cancelled order paid, so leaving pending rows
 *     alone is safe.
 *
 * Skips:
 *   - delivered/shipped/packed orders (physical goods already in
 *     motion — those need a customer-service touch, not a SQL update).
 *   - already-cancelled orders.
 *   - universal products (no product_grades rows are treated as
 *     unrestricted, matching lib/grade-filter.ts).
 *
 * After update, enqueues an `order.cancelled` event so audit.inventre
 * sees the cancellation. The drainer picks it up on the next tick.
 */
import { config } from "dotenv";
import path from "node:path";
config({ path: path.resolve(process.cwd(), ".env.local") });
config({ path: path.resolve(process.cwd(), ".env") });

import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { orders } from "@/db/schema";
import { enqueueOrderEvent } from "@/server/erp-bridge";

type Flags = { apply: boolean; order?: string; kind?: string };

function parseFlags(): Flags {
  const flags: Flags = { apply: false };
  for (const arg of process.argv.slice(2)) {
    if (arg === "--apply") flags.apply = true;
    else if (arg.startsWith("--order=")) flags.order = arg.slice("--order=".length);
    else if (arg.startsWith("--kind=")) flags.kind = arg.slice("--kind=".length);
    else throw new Error(`Unknown flag: ${arg}`);
  }
  return flags;
}

type Row = {
  order_id: string;
  order_number: string;
  status: string;
  payment_status: string;
  total_paise: number;
  student_name: string | null;
  student_grade: string | null;
  school_code: string | null;
  wrong_items: { product_name: string; box_grades: string[] }[];
};

async function findAffected(flags: Flags): Promise<Row[]> {
  // Only consider products that have product_grades rows. A product with
  // zero rows is "universal" per lib/grade-filter.ts and must not be
  // flagged. We also exclude orders that are already cancelled or have
  // moved into fulfilment beyond `confirmed`.
  const orderFilter = flags.order
    ? sql`AND o.order_number = ${flags.order}`
    : sql``;
  const kindFilter = flags.kind
    ? sql`AND p.kind = ${flags.kind}`
    : sql``;

  const result: any = await db.execute(sql`
    WITH product_box_grades AS (
      SELECT pg.product_id, array_agg(pg.grade) AS grades
        FROM product_grades pg
       GROUP BY pg.product_id
    ),
    wrong_lines AS (
      SELECT o.id AS order_id,
             o.order_number,
             o.status,
             o.payment_status,
             o.total AS total_paise,
             s.first_name AS student_name,
             s.grade AS student_grade,
             sc.school_code,
             p.name AS product_name,
             pbg.grades AS box_grades
        FROM orders o
        JOIN order_items oi ON oi.order_id = o.id
        JOIN product_variants v ON v.id = oi.variant_id
        JOIN products p ON p.id = v.product_id
        JOIN product_box_grades pbg ON pbg.product_id = p.id
        LEFT JOIN students s ON s.id = o.student_id
        LEFT JOIN schools sc ON sc.id = o.school_id
       WHERE s.grade IS NOT NULL
         AND NOT (pbg.grades @> ARRAY[s.grade]::text[])
         AND o.status NOT IN ('cancelled', 'returned', 'packed', 'shipped', 'delivered')
         ${orderFilter}
         ${kindFilter}
    )
    SELECT order_id, order_number, status, payment_status, total_paise,
           student_name, student_grade, school_code,
           json_agg(json_build_object('product_name', product_name, 'box_grades', box_grades)) AS wrong_items
      FROM wrong_lines
     GROUP BY order_id, order_number, status, payment_status, total_paise,
              student_name, student_grade, school_code
     ORDER BY order_number;
  `);

  const list = (result?.rows ?? result ?? []) as Row[];
  return list;
}

function formatRow(r: Row): string {
  const total = (r.total_paise / 100).toFixed(2);
  const lines = r.wrong_items
    .map((w) => `      • ${w.product_name}  [allowed: ${w.box_grades.join(", ")}]`)
    .join("\n");
  return [
    `  ${r.order_number}  (${r.status}/${r.payment_status}, ₹${total})`,
    `    student: ${r.student_name ?? "?"}  grade: ${r.student_grade ?? "?"}  school: ${r.school_code ?? "?"}`,
    `    wrong items:\n${lines}`,
  ].join("\n");
}

async function cancelOne(r: Row): Promise<void> {
  // 1. Flip the order to cancelled (idempotent — re-runs are safe).
  await db
    .update(orders)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(eq(orders.id, r.order_id));

  // 2. Notify audit. `payments` is intentionally untouched (no
  //    'cancelled' enum value; orders.status is the source of truth).
  await enqueueOrderEvent(r.order_id, "order.cancelled");
}

async function main() {
  const flags = parseFlags();
  const rows = await findAffected(flags);

  if (rows.length === 0) {
    console.log("[cancel] no affected orders match the filter.");
    return;
  }

  console.log(
    `[cancel] ${rows.length} order(s) to cancel${flags.apply ? "" : "  (DRY-RUN — no writes)"}:\n`
  );
  for (const r of rows) console.log(formatRow(r) + "\n");

  if (!flags.apply) {
    console.log("[cancel] dry-run. Re-run with --apply to mutate.");
    return;
  }

  let done = 0;
  for (const r of rows) {
    try {
      await cancelOne(r);
      done++;
      console.log(`[cancel] cancelled ${r.order_number}`);
    } catch (e) {
      console.error(`[cancel] FAILED ${r.order_number}:`, e);
    }
  }
  console.log(`\n[cancel] ${done}/${rows.length} cancelled.`);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  }
);
