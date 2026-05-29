/* eslint-disable no-console */
/**
 * Magic Box / Bookkit single-tag cleanup.
 *
 * ERP feed sends `custom_grade = NULL` for Magic Boxes and many Bookkits,
 * so the ERP-driven cleanup script skipped them. Past BOM-walk + name
 * extraction passes left every such product carrying two tags — the
 * stale ERP-uniform value AND the Targeted-vocab value (e.g.
 * `{Grade 6, Grade 9}` on `SAS BP GRADE 6 MAGIC BOX BOYS`).
 *
 * Strategy: each Magic Box / Bookkit name encodes its grade in the
 * school's own vocabulary (`SAS BP GRADE 6 MAGIC BOX BOYS` → "Grade 6").
 * Look up that grade in `school_grade_mappings` for the product's school,
 * derive the uniform value, run it through erpGradeToReal to get the
 * canonical Targeted tag, and replace product_grades with exactly that
 * one tag.
 *
 * Products that:
 *   - aren't Magic Box / Bookkit (kind / bundle_level), OR
 *   - don't link to exactly one school (multi-school items shouldn't be
 *     auto-grade-set from a name), OR
 *   - have a name we can't parse a grade out of, OR
 *   - already carry exactly one Targeted tag
 * are left untouched.
 *
 * Usage:
 *   tsx scripts/cleanup-product-grades-drop-uniform.ts            # dry run
 *   tsx scripts/cleanup-product-grades-drop-uniform.ts --apply    # write
 */

import { config } from "dotenv";
import path from "path";
config({ path: path.resolve(process.cwd(), ".env.local") });
config({ path: path.resolve(process.cwd(), ".env") });

import { db } from "../db/client";
import { sql } from "drizzle-orm";

const APPLY = process.argv.includes("--apply");

const ERP_TO_REAL: Record<string, string> = {
  "Grade 1": "Nursery", "Grade 2": "LKG", "Grade 3": "UKG",
  "Grade 4": "Grade 1", "Grade 5": "Grade 2", "Grade 6": "Grade 3",
  "Grade 7": "Grade 4", "Grade 8": "Grade 5", "Grade 9": "Grade 6",
  "Grade 10": "Grade 7", "Grade 11": "Grade 8", "Grade 12": "Grade 9",
  "Grade 13": "Grade 10", "Grade 14": "Grade 11", "Grade 15": "Grade 12",
  Nursery: "Nursery", LKG: "LKG", UKG: "UKG",
};

const TARGETED_VOCAB = new Set([
  "Nursery", "LKG", "UKG",
  "Grade 1", "Grade 2", "Grade 3", "Grade 4", "Grade 5", "Grade 6",
  "Grade 7", "Grade 8", "Grade 9", "Grade 10", "Grade 11", "Grade 12",
]);

function erpGradeToReal(raw: string): string | null {
  const t = raw.trim();
  if (ERP_TO_REAL[t]) return ERP_TO_REAL[t];
  const m = t.match(/^grade[\s\-_]*(\d{1,2})$/i);
  if (m) return ERP_TO_REAL[`Grade ${parseInt(m[1], 10)}`] ?? null;
  return null;
}

/** Extract the grade token from a Magic Box / Bookkit name. Returns BOTH
 *  the "Grade N" form and a bare-number form, since schools use either
 *  in `school_grade_mappings.school_given_grade_name` (e.g. TSUS stores
 *  bare `"12"` while SAS stores `"Grade 12"`). */
function extractNameGradeCandidates(name: string): string[] {
  const s = ` ${name} `;
  if (/\bnursery\b/i.test(s)) return ["Nursery"];
  if (/\blkg\b/i.test(s)) return ["LKG", "JKG"];
  if (/\bukg\b/i.test(s)) return ["UKG", "SKG"];
  if (/\bjkg\b/i.test(s)) return ["JKG", "LKG"];
  if (/\bskg\b/i.test(s)) return ["SKG", "UKG"];
  const m = s.match(/\bgrade[\s\-_]*(\d{1,2})\b/i);
  if (m) {
    const n = parseInt(m[1], 10);
    return [`Grade ${n}`, String(n)];
  }
  return [];
}

type MapRow = { schoolGivenLower: string; grade: string };

async function loadSchoolMappings(): Promise<Map<string, MapRow[]>> {
  const rows = (await db.execute(sql`
    SELECT school_id, grade, school_given_grade_name
      FROM school_grade_mappings
     WHERE grade IS NOT NULL AND school_given_grade_name IS NOT NULL
  `)) as unknown as {
    school_id: string;
    grade: string;
    school_given_grade_name: string;
  }[];
  const map = new Map<string, MapRow[]>();
  for (const r of rows) {
    const arr = map.get(r.school_id) ?? [];
    arr.push({
      schoolGivenLower: r.school_given_grade_name.trim().toLowerCase(),
      grade: r.grade,
    });
    map.set(r.school_id, arr);
  }
  return map;
}

async function main() {
  console.log(`mode: ${APPLY ? "APPLY" : "DRY-RUN"}`);
  const schoolMaps = await loadSchoolMappings();

  // Magic boxes + bookkits with their (single) school link + current tags.
  // Include archived rows too — they may still be referenced from BOMs
  // and we want their grade tags consistent so a future restore is clean.
  const products = (await db.execute(sql`
    SELECT p.id, p.name, ps.school_id
      FROM products p
      JOIN product_school ps ON ps.product_id = p.id
     WHERE p.kind IN ('magic_box','kit')
  `)) as unknown as { id: string; name: string; school_id: string }[];

  // Skip products with multiple school links (ambiguous).
  const schoolCount = new Map<string, number>();
  for (const p of products) {
    schoolCount.set(p.id, (schoolCount.get(p.id) ?? 0) + 1);
  }

  const tagsByProduct = new Map<string, Set<string>>();
  const tagRows = (await db.execute(sql`
    SELECT product_id, grade FROM product_grades
  `)) as unknown as { product_id: string; grade: string }[];
  for (const r of tagRows) {
    const s = tagsByProduct.get(r.product_id) ?? new Set<string>();
    s.add(r.grade);
    tagsByProduct.set(r.product_id, s);
  }

  let touched = 0;
  let removed = 0;
  let added = 0;
  let skippedMultiSchool = 0;
  let skippedUnparseable = 0;
  let skippedNoMapping = 0;
  const ops: { productId: string; add: string[]; remove: string[]; name: string }[] = [];

  for (const p of products) {
    if ((schoolCount.get(p.id) ?? 0) > 1) {
      skippedMultiSchool++;
      continue;
    }
    const candidates = extractNameGradeCandidates(p.name);
    if (candidates.length === 0) {
      skippedUnparseable++;
      continue;
    }
    // Find the uniform grade for this school whose school_given_grade_name
    // matches any of the extracted candidates (school-given naming varies).
    const mappings = schoolMaps.get(p.school_id) ?? [];
    let uniform: string | null = null;
    for (const c of candidates) {
      const hit = mappings.find((m) => m.schoolGivenLower === c.toLowerCase());
      if (hit) {
        uniform = hit.grade;
        break;
      }
    }
    // Fallback: if the name says "Nursery"/"LKG"/"UKG" and the school has
    // no explicit mapping row, the extracted token IS the canonical name.
    if (!uniform && /^(Nursery|LKG|UKG)$/i.test(candidates[0])) {
      uniform = candidates[0];
    }
    if (!uniform) {
      skippedNoMapping++;
      continue;
    }
    const targeted = erpGradeToReal(uniform);
    if (!targeted || !TARGETED_VOCAB.has(targeted)) {
      skippedNoMapping++;
      continue;
    }

    const current = tagsByProduct.get(p.id) ?? new Set<string>();
    if (current.size === 1 && current.has(targeted)) continue;

    const toAdd = current.has(targeted) ? [] : [targeted];
    const toRemove = [...current].filter((g) => g !== targeted);
    if (toAdd.length === 0 && toRemove.length === 0) continue;

    touched++;
    added += toAdd.length;
    removed += toRemove.length;
    ops.push({ productId: p.id, name: p.name, add: toAdd, remove: toRemove });
  }

  for (const op of ops.slice(0, 60)) {
    console.log(
      `  ${APPLY ? "[update]" : "[dry-run]"} ${op.name} (id=${op.productId}) remove=[${op.remove.join(",")}] add=[${op.add.join(",")}]`
    );
  }
  if (ops.length > 60) console.log(`  … (${ops.length - 60} more)`);

  if (APPLY) {
    for (const op of ops) {
      for (const g of op.remove) {
        await db.execute(sql`
          DELETE FROM product_grades
           WHERE product_id = ${op.productId} AND grade = ${g}
        `);
      }
      for (const g of op.add) {
        await db.execute(sql`
          INSERT INTO product_grades (product_id, grade)
          VALUES (${op.productId}, ${g})
          ON CONFLICT DO NOTHING
        `);
      }
    }
  }

  console.log("\n=== summary ===");
  console.log(`mode:                   ${APPLY ? "APPLY" : "DRY-RUN"}`);
  console.log(`products touched:       ${touched}`);
  console.log(`rows added:             ${added}`);
  console.log(`rows removed:           ${removed}`);
  console.log(`skipped multi-school:   ${skippedMultiSchool}`);
  console.log(`skipped unparseable:    ${skippedUnparseable}`);
  console.log(`skipped no mapping:     ${skippedNoMapping}`);
  if (!APPLY) console.log("\nrerun with --apply to write changes.");
  if (APPLY) {
    console.log(
      "\n⚠  Restart the deploy app to flush Next.js unstable_cache:\n" +
        "   docker restart inventre-deploy-app"
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
