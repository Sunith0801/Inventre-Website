/* eslint-disable no-console */
/**
 * Read-only audit: flag any rows that look like duplicate students.
 *
 * Coverage:
 *   1. Hard duplicates on (school_id, enrollment_number)
 *      — already blocked by the partial unique index
 *      `students_school_enrolment_uq`. Should always print 0; if not,
 *      the index is corrupt or was rebuilt unsafely.
 *
 *   2. Same enrollment_number across DIFFERENT schools — usually fine
 *      (separate enrollment series), but flagged for review because it
 *      can also mean a kid transferred and both rows linger.
 *
 *   3. Same (parent_id, name) — different rows under the same parent
 *      with identical names. Possible duplicate from a typo or a
 *      bulk-import row that arrived twice.
 *
 *   4. Same (school_id, lower(name), grade) — same kid entered twice
 *      under the same school+grade with no enrollment number.
 *
 *   5. erp_name duplicates (should always be 0 — partial unique index
 *      `students_erp_name_idx` enforces it).
 *
 * Run anytime:
 *
 *   DATABASE_URL="postgres://inventre:inventre_prod@localhost:6433/inventre" \
 *     npx tsx scripts/audit-student-duplicates.ts
 *
 * Exit code 0 = clean (only #2 cross-school enrolments present and ≤ a
 * small threshold). Exit code 1 = something actionable found.
 */

import { config } from "dotenv";
import path from "path";
config({ path: path.resolve(process.cwd(), ".env.deploy") });
config({ path: path.resolve(process.cwd(), ".env.local") });
config({ path: path.resolve(process.cwd(), ".env") });

import postgres from "postgres";

const url = process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_DIRECT_URL or DATABASE_URL is required");
const sql = postgres(url, { max: 1 });

async function main() {
  let problems = 0;

  // 1) (school_id, enrollment_number)
  const hard = (await sql`
    SELECT school_code, enrollment_number, COUNT(*)::int AS n,
           array_agg(id::text) AS ids, array_agg(name) AS names
      FROM students
     WHERE enrollment_number IS NOT NULL
     GROUP BY school_id, school_code, enrollment_number
    HAVING COUNT(*) > 1
     ORDER BY n DESC, school_code
     LIMIT 20
  `) as unknown as Array<{ school_code: string | null; enrollment_number: string; n: number; ids: string[]; names: string[] }>;
  console.log("\n=== (1) Hard duplicates (school_id, enrollment_number) ===");
  if (hard.length === 0) console.log("  ✓ none");
  else { console.table(hard); problems += hard.length; }

  // 1b) Typo-variants: same school + same alphanumeric-only enrollment
  //     (e.g. "26CAG20012" vs "26CAG20012)"). Caught the Arham Yaligar
  //     incident on 2026-06-06 where a stray paren imported by ERP let
  //     a clean re-import sneak past the (school_id, enrollment_number)
  //     unique index.
  const typo = (await sql`
    SELECT school_code,
           regexp_replace(enrollment_number, '[^A-Za-z0-9]', '', 'g') AS enrol_norm,
           COUNT(*)::int AS n,
           array_agg(enrollment_number) AS raw_variants,
           array_agg(id::text) AS ids,
           array_agg(name) AS names
      FROM students
     WHERE enrollment_number IS NOT NULL
     GROUP BY school_id, school_code, enrol_norm
    HAVING COUNT(*) > 1
       AND COUNT(DISTINCT enrollment_number) > 1
     ORDER BY n DESC
     LIMIT 20
  `) as unknown as Array<{ school_code: string | null; enrol_norm: string; n: number; raw_variants: string[]; ids: string[]; names: string[] }>;
  console.log("\n=== (1b) Typo-variant enrollments (same alphanumeric, different literal) ===");
  if (typo.length === 0) console.log("  ✓ none");
  else { console.table(typo); problems += typo.length; }

  // 2) Same enrollment across different schools
  const xs = (await sql`
    SELECT enrollment_number, array_agg(DISTINCT school_code) AS schools, COUNT(*)::int AS n
      FROM students
     WHERE enrollment_number IS NOT NULL
     GROUP BY enrollment_number
    HAVING COUNT(DISTINCT school_id) > 1
     ORDER BY n DESC
     LIMIT 30
  `) as unknown as Array<{ enrollment_number: string; schools: string[]; n: number }>;
  console.log("\n=== (2) Cross-school enrolments (review only) ===");
  if (xs.length === 0) console.log("  ✓ none");
  else console.table(xs);

  // 3) (parent_id, name)
  const sameParent = (await sql`
    SELECT parent_id::text AS parent_id, name, COUNT(*)::int AS n,
           array_agg(id::text) AS ids, array_agg(school_code) AS schools
      FROM students
     WHERE parent_id IS NOT NULL AND name IS NOT NULL
     GROUP BY parent_id, lower(name), name
    HAVING COUNT(*) > 1
     ORDER BY n DESC
     LIMIT 30
  `) as unknown as Array<{ parent_id: string; name: string; n: number; ids: string[]; schools: (string | null)[] }>;
  console.log("\n=== (3) Same parent + same name ===");
  if (sameParent.length === 0) console.log("  ✓ none");
  else { console.table(sameParent); problems += sameParent.length; }

  // 4) (school_id, lower(name), grade) without enrollment_number
  const sameSchool = (await sql`
    SELECT school_code, name, grade, COUNT(*)::int AS n,
           array_agg(id::text) AS ids
      FROM students
     WHERE name IS NOT NULL
     GROUP BY school_id, school_code, lower(name), name, grade
    HAVING COUNT(*) > 1
       AND bool_or(enrollment_number IS NULL)
     ORDER BY n DESC
     LIMIT 30
  `) as unknown as Array<{ school_code: string | null; name: string; grade: string | null; n: number; ids: string[] }>;
  console.log("\n=== (4) Same school + same name + same grade (no enrollment) ===");
  if (sameSchool.length === 0) console.log("  ✓ none");
  else { console.table(sameSchool); problems += sameSchool.length; }

  // 5) erp_name duplicates (should be impossible)
  const erp = (await sql`
    SELECT erp_name, COUNT(*)::int AS n, array_agg(id::text) AS ids
      FROM students
     WHERE erp_name IS NOT NULL
     GROUP BY erp_name
    HAVING COUNT(*) > 1
     LIMIT 20
  `) as unknown as Array<{ erp_name: string; n: number; ids: string[] }>;
  console.log("\n=== (5) Duplicate erp_name ===");
  if (erp.length === 0) console.log("  ✓ none");
  else { console.table(erp); problems += erp.length; }

  console.log("");
  console.log(problems === 0
    ? "✓ No actionable duplicates. Cross-school enrolments (section 2) are review-only."
    : `✗ ${problems} actionable group(s) flagged. Inspect the buckets above before deciding to merge / delete.`);

  await sql.end({ timeout: 5 });
  process.exit(problems === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(2); });
