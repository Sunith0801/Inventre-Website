/* eslint-disable no-console */
/**
 * Populate `school_grade_mappings` with CBSE-keyed 1:1 rows for the 5
 * MCB schools. Needed because:
 *   1) Phase A3 deleted the 75 ERP-keyed translation rows.
 *   2) StudentEditor's grade dropdown reads from school_grade_mappings,
 *      so without rows for Class 1..12 the admin can't pick those
 *      grades for new students.
 *   3) Storefront session.ts now uses raw-to-raw map keys, so rows like
 *      {grade="Grade 10", label="Grade 10"} display correctly.
 *
 * Idempotent — only inserts grades not already present per school.
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
import { MCB_SCHOOL_CODES } from "../lib/mcb/mappings";

const url = process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const client = postgres(url, { max: 1 });
const db = drizzle(client, { schema });

const CBSE_GRADES = [
  "Nursery", "LKG", "UKG",
  "Grade 1", "Grade 2", "Grade 3", "Grade 4", "Grade 5", "Grade 6",
  "Grade 7", "Grade 8", "Grade 9", "Grade 10", "Grade 11", "Grade 12",
];

async function main() {
  console.log("\nPopulating school_grade_mappings for MCB schools with CBSE 1:1 rows\n");

  const mcbSchools = await db
    .select({ id: schools.id, code: schools.schoolCode, name: schools.schoolName })
    .from(schools)
    .where(sql`${schools.schoolCode} IN (${sql.join(
      MCB_SCHOOL_CODES.map((c) => sql`${c}`),
      sql`, `,
    )})`);

  let inserted = 0;
  let kept = 0;

  for (const s of mcbSchools) {
    const baseRowRes = (await db.execute(sql`
      SELECT COALESCE(MAX(row_idx), -1)::int AS m FROM school_grade_mappings WHERE school_id = ${s.id}
    `)) as unknown as { m: number }[];
    let nextRow = (baseRowRes[0]?.m ?? -1) + 1;
    for (const grade of CBSE_GRADES) {
      const result = (await db.execute(sql`
        INSERT INTO school_grade_mappings
          (school_id, row_idx, grade, school_given_grade_name, sections, raw)
        SELECT ${s.id}, ${nextRow}, ${grade}, ${grade}, NULL, NULL
         WHERE NOT EXISTS (
           SELECT 1 FROM school_grade_mappings
            WHERE school_id = ${s.id} AND lower(grade) = lower(${grade})
         )
        RETURNING id
      `)) as unknown as { id: string }[];
      if (result.length > 0) {
        inserted++;
        nextRow++;
      } else {
        kept++;
      }
    }
    console.log(`  ${s.name ?? s.code}: inserted ${inserted} so far, kept ${kept} existing`);
  }
  console.log(`\nDone. ${inserted} new rows, ${kept} preserved.\n`);
}

main().then(() => client.end()).catch((e) => { console.error(e); return client.end().then(() => process.exit(1)); });
