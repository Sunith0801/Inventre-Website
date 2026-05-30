/* eslint-disable no-console */
/**
 * Phase A1 — rewrite `students.grade` + `students.class` from ERP-uniform
 * (Grade 13/14/15) to CBSE (Grade 10/11/12). Affects ~28 stragglers
 * that the MCB revert pass didn't catch (these were stored ERP by
 * older ERP import paths).
 *
 *   npx tsx scripts/cleanup-erp-student-grade.ts            # dry-run
 *   npx tsx scripts/cleanup-erp-student-grade.ts --apply    # commit
 */
import { config } from "dotenv";
import path from "path";
config({ path: path.resolve(process.cwd(), ".env.local") });
config({ path: path.resolve(process.cwd(), ".env") });

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import * as schema from "../db/schema";

const APPLY = process.argv.includes("--apply");

const url = process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const client = postgres(url, { max: 1 });
const db = drizzle(client, { schema });

const MAP: Record<string, string> = {
  "Grade 13": "Grade 10",
  "Grade 14": "Grade 11",
  "Grade 15": "Grade 12",
};

async function main() {
  console.log(`\nCleanup ERP-uniform student grades (${APPLY ? "APPLY" : "DRY-RUN"})\n`);

  for (const [from, to] of Object.entries(MAP)) {
    const rows = (await db.execute(sql`
      SELECT id, enrollment_number, first_name FROM students WHERE grade = ${from}
    `)) as unknown as { id: string; enrollment_number: string | null; first_name: string | null }[];
    console.log(`  ${from} → ${to}: ${rows.length} students`);
    for (const r of rows.slice(0, 5)) {
      console.log(`    ${r.enrollment_number ?? "—"}  ${r.first_name ?? r.id}`);
    }
    if (rows.length > 5) console.log(`    ... and ${rows.length - 5} more`);
    if (APPLY && rows.length > 0) {
      await db.execute(sql`UPDATE students SET grade = ${to}, class = ${to} WHERE grade = ${from}`);
    }
  }

  console.log(APPLY ? "\nApplied.\n" : "\nDRY-RUN — re-run with --apply to commit.\n");
}

main().then(() => client.end()).catch((e) => { console.error(e); return client.end().then(() => process.exit(1)); });
