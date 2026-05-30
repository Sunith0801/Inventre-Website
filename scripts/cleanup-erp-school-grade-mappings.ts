/* eslint-disable no-console */
/**
 * Phase A3 — delete the 75 ERP-keyed translation rows in
 * `school_grade_mappings` for the 5 MCB schools. Those rows shape
 * `Grade N (ERP) → CBSE label` and were a workaround for ERP-uniform
 * storage. Now that students.grade is CBSE, they actively mismatch
 * the data (`Grade 3 → "UKG"`).
 *
 * Pre-primary 1:1 rows (Nursery → Nursery, LKG → LKG, UKG → UKG) are
 * preserved.
 *
 *   npx tsx scripts/cleanup-erp-school-grade-mappings.ts           # dry-run
 *   npx tsx scripts/cleanup-erp-school-grade-mappings.ts --apply   # commit
 */
import { config } from "dotenv";
import path from "path";
config({ path: path.resolve(process.cwd(), ".env.local") });
config({ path: path.resolve(process.cwd(), ".env") });

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import * as schema from "../db/schema";
import { MCB_SCHOOL_CODES } from "../lib/mcb/mappings";

const APPLY = process.argv.includes("--apply");

const url = process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const client = postgres(url, { max: 1 });
const db = drizzle(client, { schema });

async function main() {
  console.log(`\nCleanup ERP-keyed school_grade_mappings (${APPLY ? "APPLY" : "DRY-RUN"})\n`);

  const rows = (await db.execute(sql`
    SELECT m.id, sc.school_name, m.grade, m.school_given_grade_name
      FROM school_grade_mappings m
      JOIN schools sc ON sc.id = m.school_id
     WHERE sc.school_code IN (${sql.join(
       MCB_SCHOOL_CODES.map((c) => sql`${c}`),
       sql`, `,
     )})
       AND m.grade ~ '^Grade [0-9]+$'
     ORDER BY sc.school_name, m.row_idx
  `)) as unknown as { id: string; school_name: string; grade: string; school_given_grade_name: string }[];

  console.log(`  ${rows.length} rows would be deleted:\n`);
  const perSchool = new Map<string, number>();
  for (const r of rows) perSchool.set(r.school_name, (perSchool.get(r.school_name) ?? 0) + 1);
  for (const [s, n] of perSchool) console.log(`    ${n.toString().padStart(4)}  ${s}`);
  console.log("\n  Sample:");
  for (const r of rows.slice(0, 8)) {
    console.log(`    ${r.school_name.padEnd(34)} ${r.grade.padEnd(10)} → "${r.school_given_grade_name}"`);
  }
  if (rows.length > 8) console.log(`    ... and ${rows.length - 8} more`);

  if (!APPLY) {
    console.log("\nDRY-RUN — re-run with --apply to commit.\n");
    return;
  }
  if (rows.length > 0) {
    await db.execute(sql`
      DELETE FROM school_grade_mappings
       WHERE id IN (${sql.join(rows.map((r) => sql`${r.id}`), sql`, `)})
    `);
  }
  console.log(`\nApplied — ${rows.length} rows deleted.\n`);
}

main().then(() => client.end()).catch((e) => { console.error(e); return client.end().then(() => process.exit(1)); });
