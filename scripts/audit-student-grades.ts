/* eslint-disable no-console */
/**
 * Audit student grade consistency across:
 *   • MCB source (`mcb_students.grade`)
 *   • Expected Targeted grade  (= mcbGradeToCanonical(mcb_students.grade))
 *   • Stored Targeted grade    (= students.grade)
 *   • School display label     (= school_grade_mappings.schoolGivenGradeName)
 *   • Catalog targeting        (= product_grades.grade rows exist for the
 *                                 student's grade in their school)
 *
 * Reports the count and a sample of:
 *   A. Mismatches — MCB says Class X, students.grade is something else than X+3
 *   B. Missing display mapping — students.grade has no school_grade_mappings row
 *      → parent sees the raw "Grade N" string
 *   C. Catalog has no products for the student's grade — parent sees an empty
 *      catalog feed
 *
 * READ-ONLY: no writes. Safe to run anytime.
 *
 *   DATABASE_URL="postgres://inventre:inventre_prod@localhost:6433/inventre" \
 *   DATABASE_DIRECT_URL="postgres://inventre:inventre_prod@localhost:55433/inventre" \
 *     npx tsx scripts/audit-student-grades.ts
 */

import { config } from "dotenv";
import path from "path";
config({ path: path.resolve(process.cwd(), ".env.local") });
config({ path: path.resolve(process.cwd(), ".env") });

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import * as schema from "../db/schema";
import { mcbGradeToCanonical } from "../lib/mcb/mappings";

const url = process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_DIRECT_URL or DATABASE_URL is required");
const client = postgres(url, { max: 1 });
const db = drizzle(client, { schema });

type Row = {
  student_id: string;
  enrolment_number: string;
  student_name: string;
  school_name: string;
  school_id: string;
  mcb_grade: string | null;
  stored_grade: string | null;
  display_label: string | null;
};

async function main() {
  console.log("\nAuditing MCB-granted students for grade consistency\n");

  // Pull every student who was MCB-granted (joined via enrolment_number ↔
  // mcb_students.website_access=true). Brings stored grade + the school's
  // display label so we can compare end-to-end in one pass.
  const rows = (await db.execute(sql`
    SELECT s.id AS student_id,
           s.enrollment_number AS enrolment_number,
           COALESCE(s.first_name, s.erp_name) AS student_name,
           sc.school_name AS school_name,
           s.school_id AS school_id,
           m.grade AS mcb_grade,
           s.grade AS stored_grade,
           sgm.school_given_grade_name AS display_label
      FROM students s
      JOIN mcb_students m ON m.enrolment_number = s.enrollment_number
      LEFT JOIN schools sc ON sc.id = s.school_id
      LEFT JOIN school_grade_mappings sgm
             ON sgm.school_id = s.school_id
            AND lower(sgm.grade) = lower(s.grade)
     WHERE m.website_access = true
     ORDER BY sc.school_name, s.enrollment_number
  `)) as unknown as Row[];

  console.log(`  total MCB-granted students with stored grade: ${rows.length}\n`);

  // A. MCB → Targeted mismatches
  const mismatches = rows.filter((r) => {
    if (!r.mcb_grade || !r.stored_grade) return false;
    const expected = mcbGradeToCanonical(r.mcb_grade);
    if (!expected) return false;
    return expected !== r.stored_grade;
  });
  console.log(`A. MCB → stored Targeted mismatches: ${mismatches.length}`);
  for (const r of mismatches.slice(0, 15)) {
    const expected = mcbGradeToCanonical(r.mcb_grade);
    console.log(`   ${r.enrolment_number} · ${r.student_name} · ${r.school_name}`);
    console.log(`     MCB="${r.mcb_grade}"  expected="${expected}"  stored="${r.stored_grade}"`);
  }
  if (mismatches.length > 15) console.log(`   ... and ${mismatches.length - 15} more`);
  console.log("");

  // B. Missing display label (parent sees raw "Grade N")
  const missingDisplay = rows.filter((r) => !!r.stored_grade && !r.display_label);
  console.log(`B. Students missing school_grade_mappings row (parent sees raw grade): ${missingDisplay.length}`);
  // Group by (school, grade) so the report is concise.
  const byKey = new Map<string, number>();
  for (const r of missingDisplay) {
    const key = `${r.school_name} · ${r.stored_grade}`;
    byKey.set(key, (byKey.get(key) ?? 0) + 1);
  }
  for (const [k, n] of Array.from(byKey.entries()).slice(0, 15)) {
    console.log(`   ${n}× ${k}`);
  }
  if (byKey.size > 15) console.log(`   ... and ${byKey.size - 15} more (school × grade) groups`);
  console.log("");

  // C. No catalog products for the student's grade — empty storefront feed
  // (or only products tagged for that grade at that school).
  const gradeCoverageRows = (await db.execute(sql`
    SELECT DISTINCT s.school_id, s.grade
      FROM students s
      JOIN mcb_students m ON m.enrolment_number = s.enrollment_number
     WHERE m.website_access = true AND s.grade IS NOT NULL
  `)) as unknown as { school_id: string; grade: string }[];

  const noCatalog: { school_id: string; grade: string }[] = [];
  for (const row of gradeCoverageRows) {
    const has = (await db.execute(sql`
      SELECT 1 FROM product_grades pg
        JOIN product_school ps ON ps.product_id = pg.product_id AND ps.school_id = ${row.school_id}
        JOIN products p ON p.id = pg.product_id AND p.status = 'active' AND p.is_variant_item = false
       WHERE pg.grade = ${row.grade}
       LIMIT 1
    `)) as unknown as unknown[];
    if (has.length === 0) noCatalog.push(row);
  }
  console.log(`C. (school, grade) pairs with NO active catalog products: ${noCatalog.length}`);
  if (noCatalog.length > 0) {
    const schoolNames = new Map<string, string>();
    const schoolRows = (await db.execute(sql`SELECT id, school_name FROM schools`)) as unknown as { id: string; school_name: string }[];
    for (const s of schoolRows) schoolNames.set(s.id, s.school_name);
    for (const r of noCatalog.slice(0, 25)) {
      console.log(`   ${schoolNames.get(r.school_id) ?? r.school_id} · ${r.grade}`);
    }
  }

  console.log("\nDone.\n");
}

main()
  .then(() => client.end())
  .catch((e) => {
    console.error(e);
    return client.end().then(() => process.exit(1));
  });
