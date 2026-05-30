/* eslint-disable no-console */
/**
 * Phase A — convert students.grade + students.class from ERP space
 * ("Grade 1..15") to CBSE space ("Nursery"/"LKG"/"UKG"/"Grade 1..12")
 * for every non-MCB school whose school_grade_mappings still hold
 * ERP→CBSE translation rows.
 *
 * Predicate: a school is treated as "ERP-keyed" iff at least one of
 * its school_grade_mappings rows has grade matching `^Grade [0-9]+$`
 * AND erpGradeToReal(grade) != grade (i.e. it's a translation row,
 * not a 1:1 row). The 5 MCB schools were already cleaned to 1:1 and
 * fail this predicate, so they're skipped.
 *
 *   npx tsx scripts/cleanup-erp-students-non-mcb.ts            # dry-run
 *   npx tsx scripts/cleanup-erp-students-non-mcb.ts --apply    # commit
 */
import { config } from "dotenv";
import path from "path";
config({ path: path.resolve(process.cwd(), ".env.local") });
config({ path: path.resolve(process.cwd(), ".env") });

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import * as schema from "../db/schema";
import { erpGradeToReal } from "../lib/grade-translate";

const APPLY = process.argv.includes("--apply");

const url = process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const client = postgres(url, { max: 1 });
const db = drizzle(client, { schema });

async function main() {
  console.log(`\nPhase A — students.grade ERP→CBSE for non-MCB schools (${APPLY ? "APPLY" : "DRY-RUN"})\n`);

  // 1. Find ERP-keyed schools — at least one mapping row whose grade is in
  //    ERP form AND whose label differs (i.e. it's a translation row).
  const erpSchoolRows = (await db.execute(sql`
    SELECT DISTINCT sc.id, sc.school_code, sc.school_name
      FROM school_grade_mappings m
      JOIN schools sc ON sc.id = m.school_id
     WHERE m.grade ~ '^Grade [0-9]+$'
  `)) as unknown as { id: string; school_code: string; school_name: string | null }[];

  // Filter by "has at least one translation row" (label ≠ grade).
  const erpKeyedSchools: typeof erpSchoolRows = [];
  for (const s of erpSchoolRows) {
    const has = (await db.execute(sql`
      SELECT 1 FROM school_grade_mappings
       WHERE school_id = ${s.id}
         AND grade ~ '^Grade [0-9]+$'
         AND lower(coalesce(school_given_grade_name,'')) != lower(grade)
       LIMIT 1
    `)) as unknown as unknown[];
    if (has.length > 0) erpKeyedSchools.push(s);
  }
  console.log(`  ${erpKeyedSchools.length} ERP-keyed schools to migrate:`);
  for (const s of erpKeyedSchools) console.log(`    ${s.school_code.padEnd(14)} ${s.school_name ?? "?"}`);

  // 2. Per school, fetch students whose grade is in ERP form and translate.
  let touched = 0;
  let skipped = 0;
  let unmapped = 0;

  for (const s of erpKeyedSchools) {
    const rows = (await db.execute(sql`
      SELECT id, grade, class FROM students
       WHERE school_id = ${s.id}
         AND grade ~ '^Grade [0-9]+$'
    `)) as unknown as { id: string; grade: string; class: string | null }[];

    if (rows.length === 0) {
      console.log(`    ${s.school_code}: 0 ERP students — skip`);
      continue;
    }

    let schoolTouched = 0;
    for (const r of rows) {
      const target = erpGradeToReal(r.grade);
      if (!target) {
        unmapped++;
        continue;
      }
      if (target === r.grade) {
        skipped++;
        continue;
      }
      if (APPLY) {
        // class mirrors grade only when it's also in ERP form. Leave
        // non-ERP class values untouched.
        const classTarget = r.class && /^Grade [0-9]+$/.test(r.class)
          ? erpGradeToReal(r.class) ?? r.class
          : r.class;
        await db.execute(sql`
          UPDATE students SET grade = ${target}, class = ${classTarget}
           WHERE id = ${r.id}
        `);
      }
      touched++;
      schoolTouched++;
    }
    console.log(`    ${s.school_code}: ${schoolTouched} converted`);
  }

  console.log(`\nDone. touched=${touched}  skipped=${skipped}  unmapped=${unmapped}`);
  if (!APPLY) console.log(`\nDRY-RUN — re-run with --apply to commit.`);
}

main().then(() => client.end()).catch((e) => { console.error(e); return client.end().then(() => process.exit(1)); });
