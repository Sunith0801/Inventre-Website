/* eslint-disable no-console */
/**
 * One-shot (idempotent) backfill: ensure every product_grades.grade row holds
 * the school's uniform/catalog grade. Some legacy rows hold school-given
 * labels like "Nursery"/"LKG"/"UKG"/"JKG"/"SKG", which don't match
 * students.grade (which is uniform). The shop join is exact-string, so those
 * products are invisible to their intended grade.
 *
 * Strategy per (product, school):
 *   - Determine schools this product is sold to (product_school).
 *   - For each (school, row in product_grades), look up
 *     school_grade_mappings: if pg.grade matches a school_given_grade_name
 *     and isn't already the uniform value, rewrite it to the uniform value.
 *   - Skip rows that are already a known uniform grade for ANY of the
 *     product's schools.
 *
 * Two passes:
 *   PASS 1 — products tagged for exactly one school: unambiguous remap.
 *   PASS 2 — products tagged for multiple schools: only remap if every
 *     school agrees on the mapping (same target uniform grade for the same
 *     source label). Conflicts are logged.
 *
 * Uses ON CONFLICT DO NOTHING semantics by inserting the new (productId,
 * uniformGrade) row first and deleting the old (productId, schoolGivenGrade)
 * row second.
 *
 * Usage:
 *   tsx scripts/backfill-product-uniform-grade.ts            # dry run
 *   tsx scripts/backfill-product-uniform-grade.ts --apply    # write
 */

import { config } from "dotenv";
import path from "path";
config({ path: path.resolve(process.cwd(), ".env.local") });
config({ path: path.resolve(process.cwd(), ".env") });

import { db } from "../db/client";
import {
  productGrades,
  productSchool,
  schoolGradeMappings,
  products,
} from "../db/schema";
import { sql, and, eq } from "drizzle-orm";

// Inlined from lib/grade-filter.ts to avoid Next.js's server-only marker
// when running via plain tsx.
function normalizeGrade(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const t = raw.trim().toLowerCase();
  if (!t) return null;
  const stripped = t.replace(/^(grade|class|std\.?|standard)\s+/i, "").trim();
  const roman: Record<string, string> = {
    i: "1", ii: "2", iii: "3", iv: "4", v: "5",
    vi: "6", vii: "7", viii: "8", ix: "9", x: "10",
    xi: "11", xii: "12",
  };
  if (roman[stripped]) return roman[stripped];
  const n = parseInt(stripped, 10);
  if (!Number.isNaN(n) && String(n) === stripped) return String(n);
  return stripped;
}

const APPLY = process.argv.includes("--apply");

type SchoolMap = {
  /** normalized label → uniform grade */
  toUniform: Map<string, string>;
  /** known uniform grades for the school */
  uniform: Set<string>;
};

async function loadSchoolMaps(): Promise<Map<string, SchoolMap>> {
  const rows = await db
    .select({
      schoolId: schoolGradeMappings.schoolId,
      grade: schoolGradeMappings.grade,
      schoolGivenGradeName: schoolGradeMappings.schoolGivenGradeName,
    })
    .from(schoolGradeMappings);

  const out = new Map<string, SchoolMap>();
  for (const r of rows) {
    if (!r.grade) continue;
    const entry = out.get(r.schoolId) ?? {
      toUniform: new Map<string, string>(),
      uniform: new Set<string>(),
    };
    entry.uniform.add(r.grade);
    const nGrade = normalizeGrade(r.grade);
    if (nGrade) entry.toUniform.set(nGrade, r.grade);
    if (r.schoolGivenGradeName) {
      const nGiven = normalizeGrade(r.schoolGivenGradeName);
      if (nGiven && !entry.toUniform.has(nGiven)) {
        entry.toUniform.set(nGiven, r.grade);
      }
    }
    out.set(r.schoolId, entry);
  }
  return out;
}

async function main() {
  const schoolMaps = await loadSchoolMaps();

  const pgRows = await db
    .select({
      productId: productGrades.productId,
      grade: productGrades.grade,
      productName: products.name,
    })
    .from(productGrades)
    .innerJoin(products, eq(products.id, productGrades.productId));

  const psRows = await db
    .select({
      productId: productSchool.productId,
      schoolId: productSchool.schoolId,
    })
    .from(productSchool);

  const schoolsOfProduct = new Map<string, string[]>();
  for (const r of psRows) {
    const arr = schoolsOfProduct.get(r.productId) ?? [];
    arr.push(r.schoolId);
    schoolsOfProduct.set(r.productId, arr);
  }

  let remapped = 0;
  let alreadyCorrect = 0;
  let unmapped = 0;
  let conflict = 0;

  const toApply: { productId: string; from: string; to: string }[] = [];

  for (const r of pgRows) {
    if (!r.grade) continue;
    const schoolIds = schoolsOfProduct.get(r.productId) ?? [];
    if (schoolIds.length === 0) continue;

    const n = normalizeGrade(r.grade);
    if (!n) continue;

    const proposals = new Set<string>();
    let isAlreadyUniformSomewhere = false;
    for (const sid of schoolIds) {
      const map = schoolMaps.get(sid);
      if (!map) continue;
      if (map.uniform.has(r.grade)) {
        isAlreadyUniformSomewhere = true;
        break;
      }
      const hit = map.toUniform.get(n);
      if (hit) proposals.add(hit);
    }
    if (isAlreadyUniformSomewhere) {
      alreadyCorrect++;
      continue;
    }
    if (proposals.size === 0) {
      unmapped++;
      console.log(
        `  [unmapped] product=${r.productName} (id=${r.productId}) grade=${JSON.stringify(r.grade)}`
      );
      continue;
    }
    if (proposals.size > 1) {
      conflict++;
      console.log(
        `  [conflict] product=${r.productName} (id=${r.productId}) grade=${JSON.stringify(r.grade)} → ${[...proposals].join(", ")}`
      );
      continue;
    }
    const target = [...proposals][0];
    if (target === r.grade) {
      alreadyCorrect++;
      continue;
    }
    remapped++;
    console.log(
      `  ${APPLY ? "[update]" : "[dry-run]"} product=${r.productName} (id=${r.productId}) ${JSON.stringify(r.grade)} → ${JSON.stringify(target)}`
    );
    toApply.push({ productId: r.productId, from: r.grade, to: target });
  }

  if (APPLY) {
    for (const t of toApply) {
      // Insert the new (productId, uniformGrade) row if not present,
      // then drop the old (productId, schoolGivenGrade) row.
      await db
        .insert(productGrades)
        .values({ productId: t.productId, grade: t.to })
        .onConflictDoNothing();
      await db
        .delete(productGrades)
        .where(
          and(
            eq(productGrades.productId, t.productId),
            eq(productGrades.grade, t.from)
          )
        );
    }
  }

  console.log("\n=== summary ===");
  console.log(`mode:            ${APPLY ? "APPLY" : "DRY-RUN"}`);
  console.log(`remapped:        ${remapped}`);
  console.log(`already correct: ${alreadyCorrect}`);
  console.log(`unmapped:        ${unmapped}`);
  console.log(`conflict:        ${conflict}`);
  if (!APPLY) console.log("\nrerun with --apply to write changes.");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
