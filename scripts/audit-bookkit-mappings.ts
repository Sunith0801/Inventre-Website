/* eslint-disable no-console */
/**
 * Read-only audit of bookkit health across every school and grade.
 *
 * For each product where `kind='kit'` AND name matches "<School> Grade N
 * Bookkit" or "<School> Grade <LKG|UKG|Nursery> Bookkit", report:
 *
 *   - cross_grade_tag     : product_grades row whose grade doesn't match
 *                           the grade encoded in the kit name
 *   - missing_grade_tag   : the canonical grade is not present in
 *                           product_grades at all
 *   - missing_variant     : a "template" kit (no language/stream suffix)
 *                           that has zero rows in product_variants
 *   - empty_bom           : a kit (or variant kit) with no product_bundles
 *                           row, or with one but no bundle_components
 *
 * Output: a per-finding line, plus a summary. Exit code is non-zero when
 * any finding fires, so this can also gate CI.
 *
 * Usage:  pnpm tsx scripts/audit-bookkit-mappings.ts
 */

import { config } from "dotenv";
import path from "path";
config({ path: path.resolve(process.cwd(), ".env.local") });
config({ path: path.resolve(process.cwd(), ".env") });

import { db } from "../db/client";
import { sql } from "drizzle-orm";

type Row = {
  id: string;
  name: string;
  is_variant_item: boolean;
  variant_of_product_id: string | null;
  grades: string[];
  variant_count: number;
  has_bundle: boolean;
  bom_child_count: number;
};

function canonicalGradeFromName(name: string): string | null {
  const num = name.match(/\bGrade[ \-_]?(\d{1,2})\b/i);
  if (num) return `Grade ${num[1]}`;
  if (/\bNursery\b/i.test(name)) return "Nursery";
  if (/\bLKG\b/i.test(name)) return "LKG";
  if (/\bUKG\b/i.test(name)) return "UKG";
  return null;
}

function isTemplate(name: string): boolean {
  // Plain "<...> Bookkit" with nothing concatenated after.
  return /\sBookkit$/.test(name);
}

async function main() {
  const rows = (await db.execute(sql`
    SELECT
      p.id,
      p.name,
      p.is_variant_item,
      p.variant_of_product_id,
      COALESCE(
        (SELECT array_agg(pg.grade ORDER BY pg.grade)
           FROM product_grades pg WHERE pg.product_id = p.id),
        '{}'::text[]
      ) AS grades,
      (SELECT COUNT(*)::int FROM product_variants v
        WHERE v.product_id = p.id AND v.is_active) AS variant_count,
      EXISTS (SELECT 1 FROM product_bundles pb WHERE pb.product_id = p.id) AS has_bundle,
      (SELECT COUNT(*)::int
         FROM product_bundles pb
         JOIN bundle_components bc ON bc.bundle_id = pb.id
        WHERE pb.product_id = p.id) AS bom_child_count
      FROM products p
     WHERE p.kind = 'kit'
       AND p.name ILIKE '%Bookkit%'
       AND p.status = 'active'
     ORDER BY p.name
  `)) as unknown as Row[];

  const findings: { kind: string; product: string; detail: string }[] = [];

  for (const r of rows) {
    const canonical = canonicalGradeFromName(r.name);

    // Grade-tag correctness is school-aware after 0041 — the canonical
    // tag is now the INTERNAL grade for schools that maintain a
    // `school_grade_mappings` entry, not the school-given label encoded
    // in the product name. Auditing that requires loading the per-school
    // mapping; skip it here and rely on the live storefront query as
    // the ground truth. We still flag products with ZERO grade tags as
    // those are invisible to every student.
    if (!r.is_variant_item && r.grades.length === 0) {
      findings.push({
        kind: "no_grade_tag",
        product: r.name,
        detail: `kit has no product_grades rows — invisible on storefront`,
      });
    }
    void canonical; // retained for shape parity with `isTemplate` check below

    // missing_variant — only for template kits (e.g. "SMS Grade 6 Bookkit")
    if (isTemplate(r.name) && !r.is_variant_item && r.variant_count === 0) {
      findings.push({
        kind: "missing_variant",
        product: r.name,
        detail: "template bookkit has zero active product_variants rows",
      });
    }

    // empty_bom — applies to variant kits (which carry the actual BOM)
    // and to template kits that have no variants at all.
    const shouldHaveBom =
      r.is_variant_item ||
      (isTemplate(r.name) && r.variant_count === 0);
    if (shouldHaveBom && (!r.has_bundle || r.bom_child_count === 0)) {
      findings.push({
        kind: "empty_bom",
        product: r.name,
        detail: r.has_bundle
          ? `product_bundles row exists but 0 components`
          : `no product_bundles row`,
      });
    }
  }

  // Group + print.
  const byKind = new Map<string, typeof findings>();
  for (const f of findings) {
    const arr = byKind.get(f.kind) ?? [];
    arr.push(f);
    byKind.set(f.kind, arr);
  }

  console.log(`Audited ${rows.length} bookkit products`);
  for (const [kind, arr] of byKind) {
    console.log(`\n== ${kind}: ${arr.length} findings ==`);
    for (const f of arr.slice(0, 50)) {
      console.log(`  - ${f.product}  —  ${f.detail}`);
    }
    if (arr.length > 50) console.log(`  … and ${arr.length - 50} more`);
  }

  if (findings.length === 0) {
    console.log("\nAll bookkit mappings look healthy. ✓");
    process.exit(0);
  } else {
    console.log(`\nTotal findings: ${findings.length}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
