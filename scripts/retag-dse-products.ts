/* eslint-disable no-console */
/**
 * DSE products should only surface to students in DSE-specific grades.
 * Right now many are tagged with the plain grade (e.g. "Grade 9") so they
 * bleed into the regular-class catalog.
 *
 * For each product whose name contains the standalone token "DSE":
 *   1. Extract the grade number from the name (e.g. "Grade 9 DSE Kit" → 9).
 *   2. Compute the DSE-grade tag — preserving the school's grade vocab
 *      where possible. We use "Grade N DSE" (where N is the parsed
 *      number), which mirrors the existing "Grade 12 DSE" / "Grade 13 DSE"
 *      pattern.
 *   3. Ensure that tag exists on the product.
 *   4. Remove any non-DSE grade tag (e.g. "Grade 9") so the product
 *      vanishes from the regular-grade catalog. Targeted-vocab DSE tags
 *      ("Grade 12 DSE", "Grade 13 DSE") are preserved untouched.
 *
 * Idempotent.
 *
 * Usage:
 *   tsx scripts/retag-dse-products.ts            # dry run
 *   tsx scripts/retag-dse-products.ts --apply    # write
 */

import { config } from "dotenv";
import path from "path";
config({ path: path.resolve(process.cwd(), ".env.local") });
config({ path: path.resolve(process.cwd(), ".env") });

import { db } from "../db/client";
import { sql } from "drizzle-orm";

const APPLY = process.argv.includes("--apply");

/** Parse the grade number from a product name. Handles "Grade 9", "Grade
 *  10", "Gr 9", "Class 9". Returns null when no grade token is present. */
function extractGradeNum(name: string): number | null {
  const m = name.match(/\b(?:grade|class|gr\.?)\s*(\d{1,2})\b/i);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  if (Number.isNaN(n) || n < 1 || n > 15) return null;
  return n;
}

async function main() {
  console.log(`mode: ${APPLY ? "APPLY" : "DRY-RUN"}`);

  // DSE-named active products with their current grade tags.
  const products = (await db.execute(sql`
    SELECT p.id, p.name,
           ARRAY(SELECT pg.grade FROM product_grades pg WHERE pg.product_id = p.id) AS grades
      FROM products p
     WHERE p.status = 'active'
       AND p.name ~* '\\yDSE\\y'
     ORDER BY p.name
  `)) as unknown as { id: string; name: string; grades: string[] }[];

  console.log(`  ${products.length} DSE-named active products.`);

  let touched = 0;
  let added = 0;
  let removed = 0;
  let skippedNoGrade = 0;
  const adds: { productId: string; grade: string; name: string }[] = [];
  const drops: { productId: string; grade: string; name: string }[] = [];

  for (const p of products) {
    const gradeNum = extractGradeNum(p.name);
    if (gradeNum == null) {
      skippedNoGrade++;
      continue;
    }
    const dseTag = `Grade ${gradeNum} DSE`;
    const hasDseTag = p.grades.includes(dseTag);
    // Drop every grade tag that's NOT a DSE tag (i.e. doesn't contain "DSE").
    const nonDseTags = p.grades.filter((g) => !/\bDSE\b/i.test(g));
    if (hasDseTag && nonDseTags.length === 0) continue;

    touched++;
    if (!hasDseTag) {
      adds.push({ productId: p.id, grade: dseTag, name: p.name });
    }
    for (const g of nonDseTags) {
      drops.push({ productId: p.id, grade: g, name: p.name });
    }
  }

  // Show samples
  for (const a of adds.slice(0, 25)) {
    console.log(`  ${APPLY ? "[+]" : "[dry +]"} ${a.name}  ← ${a.grade}`);
  }
  if (adds.length > 25) console.log(`  … ${adds.length - 25} more adds`);
  for (const d of drops.slice(0, 25)) {
    console.log(`  ${APPLY ? "[-]" : "[dry -]"} ${d.name}  ✗ ${d.grade}`);
  }
  if (drops.length > 25) console.log(`  … ${drops.length - 25} more drops`);

  if (APPLY) {
    for (const a of adds) {
      await db.execute(sql`
        INSERT INTO product_grades (product_id, grade)
        VALUES (${a.productId}, ${a.grade})
        ON CONFLICT DO NOTHING
      `);
      added++;
    }
    for (const d of drops) {
      await db.execute(sql`
        DELETE FROM product_grades
         WHERE product_id = ${d.productId} AND grade = ${d.grade}
      `);
      removed++;
    }
  } else {
    added = adds.length;
    removed = drops.length;
  }

  console.log("\n=== summary ===");
  console.log(`mode:               ${APPLY ? "APPLY" : "DRY-RUN"}`);
  console.log(`products touched:   ${touched}`);
  console.log(`rows added:         ${added}`);
  console.log(`rows removed:       ${removed}`);
  console.log(`skipped (no grade): ${skippedNoGrade}`);
  if (!APPLY) console.log("\nrerun with --apply to write changes.");
  if (APPLY)
    console.log(
      "\n⚠  Restart the deploy app to flush Next.js unstable_cache:\n" +
        "   docker restart inventre-deploy-app"
    );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
