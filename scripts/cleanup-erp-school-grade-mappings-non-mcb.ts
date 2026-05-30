/* eslint-disable no-console */
/**
 * Phase B — flip school_grade_mappings rows from ERP-keyed
 * (grade='Grade 1..15', label='Nursery|LKG|UKG|Grade 1..12') to CBSE-keyed
 * (grade='Nursery|LKG|UKG|Grade 1..12', label=preserved-as-school-label)
 * for every ERP-keyed non-MCB school.
 *
 * The school-given labels are preserved verbatim — for QLPHP the labels
 * are the CBSE form ("NURSERY", "LKG", "GRADE 1"), for TSUS Chennai
 * they're school-specific ("JKG"/"SKG"/"1"/"2"). Only the `grade` key
 * column flips; `school_given_grade_name` is unchanged.
 *
 * Method: DELETE old ERP-keyed row, INSERT new CBSE-keyed row with the
 * same label and row_idx. The partial unique index `(school_id,
 * lower(grade))` is satisfied because old and new keys live in disjoint
 * vocabularies (`Grade 1..15` vs `Nursery|LKG|UKG|Grade 1..12`).
 *
 *   npx tsx scripts/cleanup-erp-school-grade-mappings-non-mcb.ts
 *   npx tsx scripts/cleanup-erp-school-grade-mappings-non-mcb.ts --apply
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
  console.log(`\nPhase B — re-key school_grade_mappings for non-MCB ERP-keyed schools (${APPLY ? "APPLY" : "DRY-RUN"})\n`);

  // ERP-keyed = at least one mapping row with grade='Grade N' and label
  // differing from the grade key. Mirror of Phase A's predicate.
  const schools = (await db.execute(sql`
    SELECT DISTINCT sc.id, sc.school_code, sc.school_name
      FROM school_grade_mappings m
      JOIN schools sc ON sc.id = m.school_id
     WHERE m.grade ~ '^Grade [0-9]+$'
       AND lower(coalesce(m.school_given_grade_name,'')) != lower(m.grade)
  `)) as unknown as { id: string; school_code: string; school_name: string | null }[];

  console.log(`  ${schools.length} ERP-keyed schools to re-key:\n`);

  let totalFlipped = 0;
  let totalSkipped = 0;

  for (const s of schools) {
    const rows = (await db.execute(sql`
      SELECT id, row_idx, grade, school_given_grade_name AS label, sections, raw
        FROM school_grade_mappings
       WHERE school_id = ${s.id}
         AND grade ~ '^Grade [0-9]+$'
       ORDER BY row_idx
    `)) as unknown as {
      id: string;
      row_idx: number;
      grade: string;
      label: string | null;
      sections: string | null;
      raw: unknown;
    }[];

    let schoolFlipped = 0;
    for (const r of rows) {
      const target = erpGradeToReal(r.grade);
      if (!target || target === r.grade) {
        totalSkipped++;
        continue;
      }
      if (APPLY) {
        // Defend against an existing CBSE-keyed row with the same key.
        const collide = (await db.execute(sql`
          SELECT id FROM school_grade_mappings
           WHERE school_id = ${s.id} AND lower(grade) = lower(${target})
           LIMIT 1
        `)) as unknown as { id: string }[];
        if (collide.length > 0) {
          // CBSE-keyed row already exists — delete the ERP row, keep the
          // CBSE one. Whichever has the school-preferred label wins by
          // not being touched.
          await db.execute(sql`DELETE FROM school_grade_mappings WHERE id = ${r.id}`);
        } else {
          await db.execute(sql`DELETE FROM school_grade_mappings WHERE id = ${r.id}`);
          await db.execute(sql`
            INSERT INTO school_grade_mappings
              (school_id, row_idx, grade, school_given_grade_name, sections, raw)
            VALUES (${s.id}, ${r.row_idx}, ${target}, ${r.label}, ${r.sections}, ${JSON.stringify(r.raw)}::jsonb)
          `);
        }
      }
      schoolFlipped++;
      totalFlipped++;
    }
    console.log(`    ${s.school_code.padEnd(14)} ${schoolFlipped} re-keyed`);
  }

  console.log(`\nDone. flipped=${totalFlipped}  skipped=${totalSkipped}`);
  if (!APPLY) console.log(`\nDRY-RUN — re-run with --apply to commit.`);
}

main().then(() => client.end()).catch((e) => { console.error(e); return client.end().then(() => process.exit(1)); });
