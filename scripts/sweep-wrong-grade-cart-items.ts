/* eslint-disable no-console */
/**
 * One-time defensive sweep: delete pre-existing `cart_items` rows that
 * the new POST-time grade-match guard (lib commit c58d7fe) would now
 * refuse to write. The cart-read sweep in lib/repos/cart.ts is
 * non-destructive by policy — it only HIDES wrong-grade lines from the
 * active sibling's view. So a contaminated row sitting in a parent's
 * cart from yesterday still rides into checkout's per-student grouping
 * and becomes tomorrow's bad order. This script flushes those.
 *
 *   DATABASE_URL=… npx tsx scripts/sweep-wrong-grade-cart-items.ts
 *   DATABASE_URL=… npx tsx scripts/sweep-wrong-grade-cart-items.ts --apply
 *
 * Dry-run by default — prints every row it would delete with the
 * variant, the owning student's grade, and the product's allowed
 * grades. Pass --apply to mutate.
 *
 * Universal products (no `product_grades` rows) pass through, matching
 * filterProductsByGrade()'s semantics. Untagged rows
 * (`cart_items.student_id IS NULL`) are also skipped — those are
 * pre-Phase-5 legacy and the checkout fallback handles them.
 */
import { config } from "dotenv";
import path from "node:path";
config({ path: path.resolve(process.cwd(), ".env.local") });
config({ path: path.resolve(process.cwd(), ".env") });

import { inArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { cartItems } from "@/db/schema";

type Flags = { apply: boolean };

function parseFlags(): Flags {
  const flags: Flags = { apply: false };
  for (const arg of process.argv.slice(2)) {
    if (arg === "--apply") flags.apply = true;
    else throw new Error(`Unknown flag: ${arg}`);
  }
  return flags;
}

type Row = {
  cart_item_id: string;
  parent_id: string;
  variant_id: string;
  qty: number;
  student_id: string;
  student_name: string | null;
  student_grade: string;
  product_name: string;
  box_grades: string[];
};

async function findRows(): Promise<Row[]> {
  const result: any = await db.execute(sql`
    WITH product_grades_agg AS (
      SELECT pg.product_id, array_agg(pg.grade) AS grades
        FROM product_grades pg
       GROUP BY pg.product_id
    )
    SELECT ci.id AS cart_item_id,
           c.parent_id,
           ci.variant_id,
           ci.qty,
           ci.student_id,
           s.first_name AS student_name,
           s.grade AS student_grade,
           p.name AS product_name,
           pga.grades AS box_grades
      FROM cart_items ci
      JOIN carts c ON c.id = ci.cart_id
      JOIN students s ON s.id = ci.student_id
      JOIN product_variants v ON v.id = ci.variant_id
      JOIN products p ON p.id = v.product_id
      JOIN product_grades_agg pga ON pga.product_id = p.id
     WHERE ci.student_id IS NOT NULL
       AND s.grade IS NOT NULL
       AND NOT (pga.grades @> ARRAY[s.grade]::text[])
     ORDER BY c.parent_id, p.name;
  `);
  return ((result?.rows ?? result ?? []) as Row[]);
}

async function main() {
  const flags = parseFlags();
  const rows = await findRows();

  if (rows.length === 0) {
    console.log("[sweep] no contaminated cart_items rows.");
    return;
  }

  console.log(
    `[sweep] ${rows.length} cart_items row(s) to delete${flags.apply ? "" : "  (DRY-RUN — no writes)"}:\n`
  );
  for (const r of rows) {
    console.log(
      `  cart_item ${r.cart_item_id.slice(0, 8)}  qty=${r.qty}  variant=${r.variant_id.slice(0, 8)}`
    );
    console.log(
      `    student: ${r.student_name ?? "?"} (grade: ${r.student_grade})  parent: ${r.parent_id.slice(0, 8)}`
    );
    console.log(
      `    product: ${r.product_name}  [allowed: ${r.box_grades.join(", ")}]\n`
    );
  }

  if (!flags.apply) {
    console.log("[sweep] dry-run. Re-run with --apply to delete these rows.");
    return;
  }

  const ids = rows.map((r) => r.cart_item_id);
  const deleted = await db
    .delete(cartItems)
    .where(inArray(cartItems.id, ids))
    .returning({ id: cartItems.id });
  console.log(`[sweep] deleted ${deleted.length} cart_items row(s).`);

  // Redis cart hashes carry a qty mirror keyed by variantId — they need
  // to be invalidated so the next read rehydrates from the freshly
  // sanitised DB. Simplest: delete the entire `cart:<parentId>` key for
  // every affected parent; lib/repos/cart.ts:rehydrateRedisFromDb runs
  // on the next read.
  const parentIds = Array.from(new Set(rows.map((r) => r.parent_id)));
  if (parentIds.length > 0) {
    const { redis } = await import("@/server/redis");
    const keys = parentIds.map((id) => `cart:${id}`);
    const cleared = await redis.del(...keys);
    console.log(`[sweep] cleared ${cleared} Redis cart hash(es) for rehydrate.`);
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  }
);
