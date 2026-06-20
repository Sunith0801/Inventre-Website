/* eslint-disable no-console */
/**
 * One-time backfill: attach `orders.student_id` on orders that have none, for
 * parents who have EXACTLY ONE student.
 *
 * WHY
 *   Imported / guest / parent-as-customer orders frequently land with
 *   `orders.student_id = NULL` and an audit Sales Order whose `customer` is the
 *   parent's name with a blank `enrollment_number`. Such an order is
 *   "stranded": `listParentOrdersFromErp` (lib/erp-customer-orders.ts) can only
 *   surface it via the exact local `parent_id` branch or a `contact_mobile ==
 *   myPhone` match — the student phone-graph fan-out has nothing to grab onto.
 *   Result: the order is invisible from any co-guardian number, and the
 *   Exchange / Report-missing buttons never appear. (Root case: order
 *   SAL-ORD-2026-11116, KODAM family, 2026-06-20.)
 *
 *   Linking `student_id` lets the student-identity branch match, so the whole
 *   family sees the order and exchange/missing work normally.
 *
 * SAFE SET
 *   Only parents with exactly one student are touched — the target student is
 *   then unambiguous. Multi-student parents are intentionally left alone (they
 *   need enrollment / customer_link / item-grade matching, out of scope here).
 *
 * USAGE
 *   Dry-run (default — prints counts + a sample, writes NOTHING):
 *     DATABASE_URL=… npx tsx scripts/backfill-order-student-link.ts
 *   Commit:
 *     DATABASE_URL=… npx tsx scripts/backfill-order-student-link.ts --commit
 *
 * FLAGS
 *   --commit            Perform the UPDATE. Without it, nothing is written.
 *   --delivered-only    Restrict to orders.status = 'delivered'.
 *   --batch-size=N      Rows per UPDATE batch (default 500).
 *
 * SAFETY / IDEMPOTENCY
 *   - WHERE guards on `student_id IS NULL`, so re-running never re-touches a
 *     linked row and never overwrites an existing link.
 *   - The single-student constraint is enforced in SQL (HAVING count(*) = 1),
 *     so a parent who gains a 2nd student mid-run simply drops out of the set.
 *   - Batched by order id; a partial run is safe to resume (already-linked
 *     rows are excluded next time).
 */
import { config } from "dotenv";
import path from "node:path";
config({ path: path.resolve(process.cwd(), ".env.local") });
config({ path: path.resolve(process.cwd(), ".env") });

import { sql } from "drizzle-orm";
import { db } from "../db/client";

const args = process.argv.slice(2);
const COMMIT = args.includes("--commit");
const DELIVERED_ONLY = args.includes("--delivered-only");
const BATCH_SIZE = Number(
  (args.find((a) => a.startsWith("--batch-size=")) ?? "").split("=")[1] || 500
);

// Orders eligible for an unambiguous link: no student yet, and their parent
// owns exactly one student. `single_student` resolves the (parent → student)
// pair once; the join then targets the orders.
const eligibleCte = sql`
  WITH single_student AS (
    -- Exactly one student per group (HAVING count = 1), so array_agg[1] is
    -- the sole student id. (Postgres has no min()/max() aggregate for uuid.)
    SELECT parent_id, (array_agg(id))[1] AS student_id
      FROM students
     WHERE parent_id IS NOT NULL
     GROUP BY parent_id
    HAVING count(*) = 1
  )
`;

const deliveredFilter = DELIVERED_ONLY ? sql`AND o.status = 'delivered'` : sql``;

async function main() {
  console.log(
    `[backfill-order-student-link] mode=${COMMIT ? "COMMIT" : "DRY-RUN"} ` +
      `deliveredOnly=${DELIVERED_ONLY} batchSize=${BATCH_SIZE}`
  );

  // 1. Scope report.
  const scope = (await db.execute(sql`
    ${eligibleCte}
    SELECT
      count(*)                                            AS total_eligible,
      count(*) FILTER (WHERE o.status = 'delivered')      AS delivered_eligible
    FROM orders o
    JOIN single_student ss ON ss.parent_id = o.parent_id
    WHERE o.student_id IS NULL
  `)) as unknown as { total_eligible: number; delivered_eligible: number }[];
  console.log(
    `[scope] eligible (single-student parents, student_id NULL): ` +
      `total=${scope[0]?.total_eligible} delivered=${scope[0]?.delivered_eligible}`
  );

  // 2. Sample for eyeballing before commit.
  const sample = (await db.execute(sql`
    ${eligibleCte}
    SELECT o.order_number, o.status::text AS status, s.name AS student_name,
           s.enrollment_number
    FROM orders o
    JOIN single_student ss ON ss.parent_id = o.parent_id
    JOIN students s ON s.id = ss.student_id
    WHERE o.student_id IS NULL ${deliveredFilter}
    ORDER BY o.created_at DESC
    LIMIT 10
  `)) as unknown as {
    order_number: string;
    status: string;
    student_name: string;
    enrollment_number: string | null;
  }[];
  console.log(`[sample] newest ${sample.length} that would be linked:`);
  for (const r of sample) {
    console.log(
      `   ${r.order_number} [${r.status}] -> ${r.student_name} (${r.enrollment_number ?? "—"})`
    );
  }

  if (!COMMIT) {
    console.log(
      `[dry-run] no rows written. Re-run with --commit to apply.` +
        (DELIVERED_ONLY ? "" : " (add --delivered-only to restrict to delivered orders)")
    );
    return;
  }

  // 3. Batched update. Each batch links a bounded set of eligible orders; the
  //    `student_id IS NULL` guard makes the loop self-terminating.
  let totalLinked = 0;
  for (;;) {
    const updated = (await db.execute(sql`
      ${eligibleCte}
      , batch AS (
        SELECT o.id, ss.student_id
        FROM orders o
        JOIN single_student ss ON ss.parent_id = o.parent_id
        WHERE o.student_id IS NULL ${deliveredFilter}
        LIMIT ${BATCH_SIZE}
      )
      UPDATE orders o
         SET student_id = batch.student_id
        FROM batch
       WHERE o.id = batch.id
       RETURNING o.id
    `)) as unknown as { id: string }[];
    if (updated.length === 0) break;
    totalLinked += updated.length;
    console.log(`[commit] linked ${updated.length} (running total ${totalLinked})`);
  }
  console.log(`[done] linked ${totalLinked} orders to their sole student.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("[backfill-order-student-link] FAILED:", e);
    process.exit(1);
  });
