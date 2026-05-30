/* eslint-disable no-console */
/**
 * Sync students.grade to whatever mcb_students.grade currently says
 * (via mcbGradeToCbse), for every MCB-granted student where the two
 * have drifted apart. Policy: MCB is source of truth.
 *
 *   npx tsx scripts/sync-students-grade-from-mcb.ts           # dry-run
 *   npx tsx scripts/sync-students-grade-from-mcb.ts --apply
 */
import { config } from "dotenv";
import path from "path";
config({ path: path.resolve(process.cwd(), ".env.local") });
config({ path: path.resolve(process.cwd(), ".env") });

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import * as schema from "../db/schema";
import { mcbGradeToCbse } from "../lib/mcb/mappings";

const APPLY = process.argv.includes("--apply");

const url = process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const client = postgres(url, { max: 1 });
const db = drizzle(client, { schema });

async function main() {
  console.log(`\nSync students.grade ← mcb_students.grade (MCB as truth)  (${APPLY ? "APPLY" : "DRY-RUN"})\n`);

  const rows = (await db.execute(sql`
    SELECT s.id, s.school_code, s.enrollment_number, s.first_name,
           s.grade AS stored, m.grade AS mcb_grade
      FROM students s
      JOIN mcb_students m ON m.enrolment_number = s.enrollment_number
     WHERE m.website_access = true
       AND m.grade IS NOT NULL
       AND s.grade IS NOT NULL
  `)) as unknown as {
    id: string;
    school_code: string;
    enrollment_number: string;
    first_name: string | null;
    stored: string;
    mcb_grade: string;
  }[];

  let touched = 0;
  let aligned = 0;
  let unparseable = 0;
  const diffs: { school: string; enrol: string; name: string; from: string; to: string; mcb_raw: string }[] = [];

  for (const r of rows) {
    const target = mcbGradeToCbse(r.mcb_grade);
    if (!target) {
      unparseable++;
      continue;
    }
    if (target === r.stored) {
      aligned++;
      continue;
    }
    diffs.push({
      school: r.school_code,
      enrol: r.enrollment_number,
      name: r.first_name ?? r.id,
      from: r.stored,
      to: target,
      mcb_raw: r.mcb_grade,
    });
    if (APPLY) {
      await db.execute(sql`UPDATE students SET grade = ${target}, class = ${target} WHERE id = ${r.id}`);
    }
    touched++;
  }

  console.log(`  total granted-and-comparable: ${rows.length}`);
  console.log(`  already aligned:              ${aligned}`);
  console.log(`  unparseable MCB grade:        ${unparseable}`);
  console.log(`  to be updated:                ${touched}\n`);

  if (diffs.length > 0) {
    console.log(`  Diff (first 40):`);
    for (const d of diffs.slice(0, 40)) {
      console.log(`    ${d.school.padEnd(7)} ${d.enrol.padEnd(12)} ${(d.name||"").padEnd(28)} ${d.from.padEnd(10)} → ${d.to.padEnd(10)}  (mcb="${d.mcb_raw}")`);
    }
    if (diffs.length > 40) console.log(`    ... and ${diffs.length - 40} more`);
  }

  if (!APPLY) console.log(`\nDRY-RUN — re-run with --apply to commit.`);
  else console.log(`\nApplied. ${touched} students.grade updated.`);
}

main().then(() => client.end()).catch((e) => { console.error(e); return client.end().then(() => process.exit(1)); });
