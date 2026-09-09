/* eslint-disable no-console */
/**
 * One-off data fix: correct the grade mapping of YIPS (Young India Police
 * School) Magic Box products ONLY.
 *
 * The 12 YIPS Magic Box products are named "... Grade 1" … "... Grade 6"
 * (Boys + Girls) but their `product_grades.grade` is offset 3 levels low
 * (Grade 1 box → "Nursery", … Grade 6 box → "Grade 3"). YIPS runs Grade 1–6
 * with no pre-primary, so this fix re-points each box to its namesake grade:
 *   box "... Grade N"  →  product_grades.grade = "Grade N".
 *
 * Scope guards — touches a product_grades row ONLY when ALL hold:
 *   • product.kind = 'magic_box'
 *   • product is linked to the YIPS school (product_school)
 *   • product name contains "Grade <n>"
 * These 12 products are not shared with any other school, so no other
 * school's data can be affected. Nothing else is written (no students,
 * prices, orders, names, or SKUs).
 *
 *   # dry run (default) — prints before→after, writes nothing:
 *   DATABASE_URL=… npx tsx scripts/fix-yips-magicbox-grades.ts
 *   # apply:
 *   DATABASE_URL=… npx tsx scripts/fix-yips-magicbox-grades.ts --apply
 */
import { config } from "dotenv";
import path from "node:path";
config({ path: path.resolve(process.cwd(), ".env.deploy") });
config({ path: path.resolve(process.cwd(), ".env.local") });
config({ path: path.resolve(process.cwd(), ".env") });

import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { schools, products, productSchool, productGrades } from "@/db/schema";

const SCHOOL_SLUG = "yips-young-india-police-school";

async function main() {
  const apply = process.argv.includes("--apply");
  console.log(`db=${(process.env.DATABASE_URL || "").replace(/:[^:@]*@/, ":****@")}`);
  console.log(`mode=${apply ? "APPLY (writes product_grades)" : "DRY RUN (no writes)"}\n`);

  const [school] = await db.select().from(schools).where(eq(schools.slug, SCHOOL_SLUG)).limit(1);
  if (!school) throw new Error(`School not found: slug=${SCHOOL_SLUG}`);

  // YIPS magic_box products + their current grade row(s)
  const rows = await db
    .select({ pid: products.id, name: products.name, grade: productGrades.grade })
    .from(products)
    .innerJoin(productSchool, and(eq(productSchool.productId, products.id), eq(productSchool.schoolId, school.id)))
    .innerJoin(productGrades, eq(productGrades.productId, products.id))
    .where(eq(products.kind, "magic_box"));

  let changes = 0;
  const planned: { pid: string; name: string; from: string; to: string }[] = [];
  for (const r of rows) {
    const m = r.name.match(/Grade\s+(\d+)/i);
    if (!m) {
      console.log(`  ⚠ skip (no "Grade N" in name): ${r.name}`);
      continue;
    }
    const target = `Grade ${m[1]}`;
    const mark = r.grade === target ? "ok" : "FIX";
    console.log(`  [${mark}] ${r.name.padEnd(34)} ${String(r.grade).padStart(8)}  →  ${target}`);
    if (r.grade !== target) {
      planned.push({ pid: r.pid, name: r.name, from: r.grade, to: target });
      changes++;
    }
  }

  console.log(`\n${changes} row(s) need correction (of ${rows.length} YIPS magic-box grade rows).`);

  if (apply && changes > 0) {
    await db.transaction(async (tx) => {
      for (const p of planned) {
        const res = await tx
          .update(productGrades)
          .set({ grade: p.to })
          .where(and(eq(productGrades.productId, p.pid), eq(productGrades.grade, p.from)));
        console.log(`  ✔ ${p.name}: ${p.from} → ${p.to}`);
      }
    });
    console.log(`\nDone — ${changes} YIPS magic-box grade row(s) corrected.`);
  } else if (!apply) {
    console.log(`\nDRY RUN — pass --apply to write.`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
