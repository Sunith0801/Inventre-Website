/* eslint-disable no-console */
/**
 * Reverse the +3 offset on `students.grade` for MCB-granted students that
 * got stored in ERP space instead of CBSE space.
 *
 * Why: the catalog query at lib/repos/products.ts joins
 *   product_grades.grade = students.grade
 * and product_grades.grade is in CBSE/Real space (Grade 3 = real Class 3
 * Bookkit, etc.) So a student whose stored grade is "Grade 6" (ERP for
 * Class 3) gets Class-6 products served — the bug Aniket (23KS0250)
 * surfaced.
 *
 * Predicate — only revert when:
 *   • The student row came in via MCB grant (`erp_name LIKE 'MCB-%'`)
 *   • mcb_students has a parseable MCB class N (Roman or Arabic)
 *   • Stored grade EXACTLY equals "Grade <N+3>" — i.e. matches what the
 *     old +3 formula produced. Anything else (manual edits, ERP imports
 *     that match raw, etc.) is left alone.
 *
 * For each match the script either prints the proposed change (default
 * dry-run) or writes it (`--apply`).
 *
 * Pre-primary stays untouched — "Nursery"/"LKG"/"UKG" are stored as-is
 * and already match the catalog convention.
 *
 *   npx tsx scripts/revert-mcb-grade-plus3.ts             # dry-run
 *   npx tsx scripts/revert-mcb-grade-plus3.ts --apply     # write
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

const ROMAN: Record<string, number> = {
  I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6,
  VII: 7, VIII: 8, IX: 9, X: 10, XI: 11, XII: 12,
};

function mcbToClassNum(raw: string | null): number | null {
  if (!raw) return null;
  const s = raw.trim();
  if (/\bnur|lkg|ukg\b/i.test(s)) return null;
  let m = s.match(/\b(?:class|grade|gr\.?)[\s\-_]*(\d{1,2})\b/i);
  if (m) return parseInt(m[1], 10);
  m = s.match(/\b(?:class|grade|gr\.?)[\s\-_]+(I{1,3}|IV|V|VI{0,3}|IX|X{1,2}I{0,2})\b/i);
  if (m) return ROMAN[m[1].toUpperCase()] ?? null;
  m = s.match(/^\s*(I{1,3}|IV|V|VI{0,3}|IX|X{1,2}I{0,2})\b/i);
  if (m) return ROMAN[m[1].toUpperCase()] ?? null;
  return null;
}

async function main() {
  console.log(`\nRevert ERP→CBSE grade for MCB-granted students  (${APPLY ? "APPLY" : "DRY-RUN"})\n`);

  const rows = (await db.execute(sql`
    SELECT s.id, s.enrollment_number AS enrol,
           COALESCE(s.first_name, s.erp_name) AS name,
           sc.school_name,
           s.grade AS stored,
           m.grade AS mcb_grade
      FROM students s
      JOIN mcb_students m ON m.enrolment_number = s.enrollment_number
      LEFT JOIN schools sc ON sc.id = s.school_id
     WHERE s.erp_name LIKE 'MCB-%'
       AND s.grade IS NOT NULL
       AND m.grade IS NOT NULL
     ORDER BY sc.school_name, s.enrollment_number
  `)) as unknown as {
    id: string;
    enrol: string;
    name: string;
    school_name: string;
    stored: string;
    mcb_grade: string;
  }[];

  const fixes: { id: string; enrol: string; name: string; school: string; from: string; to: string }[] = [];

  for (const r of rows) {
    const n = mcbToClassNum(r.mcb_grade);
    if (n == null) continue;          // pre-primary — leave alone
    const want = `Grade ${n}`;
    const stored = r.stored.trim();
    const ergMatch = stored === `Grade ${n + 3}`;
    if (stored === want) continue;    // already correct
    if (!ergMatch) continue;          // manual edit / other — skip
    fixes.push({
      id: r.id,
      enrol: r.enrol,
      name: r.name,
      school: r.school_name,
      from: stored,
      to: want,
    });
  }

  console.log(`  ${fixes.length} rows would change:\n`);
  const perSchool = new Map<string, number>();
  for (const f of fixes) perSchool.set(f.school, (perSchool.get(f.school) ?? 0) + 1);
  for (const [s, n] of perSchool) console.log(`    ${n.toString().padStart(4)}  ${s}`);

  console.log("\n  Sample (first 25):");
  for (const f of fixes.slice(0, 25)) {
    console.log(`    ${f.enrol}  ${f.name.padEnd(28)} ${f.school.padEnd(34)} ${f.from} → ${f.to}`);
  }
  if (fixes.length > 25) console.log(`    ... and ${fixes.length - 25} more`);

  if (!APPLY) {
    console.log(`\n  DRY-RUN — no writes. Re-run with --apply to commit.\n`);
    return;
  }

  console.log("\n  Applying…");
  for (const f of fixes) {
    await db.execute(sql`
      UPDATE students SET grade = ${f.to}, class = ${f.to}
       WHERE id = ${f.id}
    `);
  }
  console.log(`  Done. ${fixes.length} students.grade values reverted to CBSE.\n`);
}

main().then(() => client.end()).catch((e) => { console.error(e); return client.end().then(() => process.exit(1)); });
