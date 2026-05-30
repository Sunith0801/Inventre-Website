/* eslint-disable no-console */
/**
 * Backfill `school_grade_mappings.schoolGivenGradeName` so the storefront
 * shows the MCB-friendly label ("Class 12") instead of the internal
 * Targeted-Grade vocabulary ("Grade 15") to parents.
 *
 * Why this exists:
 *   - `students.grade` stores Targeted Grade (Nursery, LKG, UKG, Grade 1–15)
 *     — this is the +3-offset MCB convention; `lib/repos/products.ts`
 *     joins `product_grades.grade = students.grade` so the value MUST
 *     stay Targeted.
 *   - The storefront's `StudentBar.tsx` prefers
 *     `s.schoolGivenGrade ?? s.grade` for display. That field comes from
 *     `school_grade_mappings.schoolGivenGradeName` keyed by
 *     (schoolId, grade).
 *   - For every MCB-served school × every Targeted grade currently in
 *     use, write a mapping row whose label is the simplified "Class N"
 *     form (`Nursery` / `LKG` / `UKG` for Grade 1/2/3).
 *
 * Idempotent: rows are inserted with ON CONFLICT (school_id,
 * lower(grade)) DO NOTHING, so any school-specific overrides admins
 * have already saved are preserved.
 *
 * Run with:
 *   DATABASE_URL="postgres://inventre:inventre_prod@localhost:6433/inventre" \
 *   DATABASE_DIRECT_URL="postgres://inventre:inventre_prod@localhost:55433/inventre" \
 *     npx tsx scripts/backfill-mcb-school-grade-labels.ts
 */

import { config } from "dotenv";
import path from "path";
config({ path: path.resolve(process.cwd(), ".env.local") });
config({ path: path.resolve(process.cwd(), ".env") });

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import { schools } from "../db/schema";
import * as schema from "../db/schema";
import { MCB_SCHOOL_CODES, targetedToMcbDisplay } from "../lib/mcb/mappings";

const url = process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_DIRECT_URL or DATABASE_URL is required");
const client = postgres(url, { max: 1 });
const db = drizzle(client, { schema });

async function main() {
  console.log("\nBackfilling school_grade_mappings for MCB-served schools\n");
  console.log(`MCB school codes: ${MCB_SCHOOL_CODES.join(", ")}`);

  const mcbSchools = await db
    .select({ id: schools.id, code: schools.schoolCode, name: schools.schoolName })
    .from(schools)
    .where(sql`${schools.schoolCode} IN (${sql.join(
      MCB_SCHOOL_CODES.map((c) => sql`${c}`),
      sql`, `,
    )})`);

  if (mcbSchools.length === 0) {
    console.log("No matching schools found — exiting.");
    return;
  }

  let inserted = 0;
  let skipped = 0;
  let unmappable = 0;

  for (const s of mcbSchools) {
    console.log(`\n  school: ${s.name ?? s.code} (${s.id})`);
    const gradeRows = (await db.execute(sql`
      SELECT DISTINCT grade FROM students
       WHERE school_id = ${s.id}
         AND grade IS NOT NULL
       ORDER BY grade
    `)) as unknown as { grade: string }[];

    if (gradeRows.length === 0) {
      console.log(`    no students with grade — skip`);
      continue;
    }

    // Highest row_idx so newly inserted rows sort after admin's existing edits.
    const baseRowRes = (await db.execute(sql`
      SELECT COALESCE(MAX(row_idx), -1)::int AS m FROM school_grade_mappings WHERE school_id = ${s.id}
    `)) as unknown as { m: number }[];
    let nextRow = (baseRowRes[0]?.m ?? -1) + 1;

    for (const { grade } of gradeRows) {
      const label = targetedToMcbDisplay(grade);
      if (!label) {
        console.log(`    ⚠ ${grade}: no targetedToMcbDisplay mapping — skip`);
        unmappable++;
        continue;
      }
      // Use WHERE NOT EXISTS instead of ON CONFLICT — the unique index is
      // partial (WHERE grade IS NOT NULL) and Postgres requires the
      // ON CONFLICT clause to match the partial predicate, which drizzle
      // can't easily express here.
      const result = (await db.execute(sql`
        INSERT INTO school_grade_mappings
          (school_id, row_idx, grade, school_given_grade_name, sections, raw)
        SELECT ${s.id}, ${nextRow}, ${grade}, ${label}, NULL, NULL
         WHERE NOT EXISTS (
           SELECT 1 FROM school_grade_mappings
            WHERE school_id = ${s.id}
              AND lower(grade) = lower(${grade})
         )
        RETURNING id
      `)) as unknown as { id: string }[];
      if (result.length > 0) {
        console.log(`    + ${grade} → "${label}"`);
        inserted++;
        nextRow++;
      } else {
        skipped++;
      }
    }
  }

  console.log(`\nDone. Inserted ${inserted}, skipped (already mapped) ${skipped}, unmappable ${unmappable}.\n`);
}

main()
  .then(() => client.end())
  .catch((e) => {
    console.error(e);
    return client.end().then(() => process.exit(1));
  });
