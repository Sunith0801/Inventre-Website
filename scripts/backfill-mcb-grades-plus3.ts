/* eslint-disable no-console */
/**
 * One-shot fix for MCB-granted students whose `students.grade` was written
 * with the broken 1:1 mapping deployed briefly on 2026-05-28. Restores the
 * +3 catalog-grade convention used by school_grade_mappings + storefront.
 *
 * Touches only rows where:
 *   - students.erp_name LIKE 'MCB-%' (MCB grant origin)
 *   - mcb_students.enrolment_number joins cleanly
 *   - current students.grade exactly equals what the *1:1* mapping would
 *     have produced for that MCB grade
 *   - the +3 mapping would produce a different value
 *
 * That predicate skips any record an admin manually edited, since a
 * manual edit will diverge from both function outputs.
 *
 *   npx tsx scripts/backfill-mcb-grades-plus3.ts           # dry-run
 *   npx tsx scripts/backfill-mcb-grades-plus3.ts --apply   # write
 */
import { config } from "dotenv";
import path from "path";
config({ path: path.resolve(process.cwd(), ".env.local") });
config({ path: path.resolve(process.cwd(), ".env") });

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import { mcbGradeToCanonical } from "@/lib/mcb/mappings";

const url = process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const client = postgres(url, { max: 3 });
const db = drizzle(client);

// Local copy of the broken 1:1 form, kept only to identify rows it produced.
const ROMAN: Record<string, number> = {
  I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6,
  VII: 7, VIII: 8, IX: 9, X: 10, XI: 11, XII: 12,
};
function broken1to1(input: string | null | undefined): string | null {
  if (!input) return null;
  const s = input.trim();
  if (/\bnursery\b/i.test(s) || /\bnur\b/i.test(s)) return "Nursery";
  if (/\blkg\b/i.test(s)) return "LKG";
  if (/\bukg\b/i.test(s)) return "UKG";
  let m = s.match(/\b(?:class|grade|gr\.?)[\s\-_]*(\d{1,2})\b/i);
  if (m) return `Grade ${parseInt(m[1], 10)}`;
  m = s.match(/\b(?:class|grade|gr\.?)[\s\-_]+(I{1,3}|IV|V|VI{0,3}|IX|X{1,2}I{0,2})\b/i);
  if (m) return `Grade ${ROMAN[m[1].toUpperCase()]}`;
  m = s.match(/^\s*(I{1,3}|IV|V|VI{0,3}|IX|X{1,2}I{0,2})\b/i);
  if (m) return `Grade ${ROMAN[m[1].toUpperCase()]}`;
  return null;
}

type Row = {
  id: string;
  enrollment_number: string;
  name: string;
  current: string | null;
  mcb_grade: string | null;
};

async function main() {
  const apply = process.argv.includes("--apply");

  const rows = (await db.execute(sql`
    SELECT st.id, st.enrollment_number, st.name,
           st.grade AS current,
           m.grade  AS mcb_grade
    FROM students st
    JOIN mcb_students m ON m.enrolment_number = st.enrollment_number
    WHERE st.erp_name LIKE 'MCB-%'
  `)) as unknown as Row[];

  const updates: { id: string; from: string; to: string; mcb: string; name: string; enrol: string }[] = [];
  for (const r of rows) {
    if (!r.mcb_grade || !r.current) continue;
    const oneToOne = broken1to1(r.mcb_grade);
    const plus3 = mcbGradeToCanonical(r.mcb_grade);
    if (!oneToOne || !plus3) continue;
    if (oneToOne === plus3) continue;       // ambiguous — leave alone
    if (r.current !== oneToOne) continue;   // not damaged (or manually edited)
    updates.push({
      id: r.id,
      from: r.current,
      to: plus3,
      mcb: r.mcb_grade,
      name: r.name,
      enrol: r.enrollment_number,
    });
  }

  console.log(`Scanned ${rows.length} MCB-granted students; ${updates.length} need backfill.`);
  for (const u of updates) {
    console.log(`  ${u.enrol}  ${u.name.padEnd(40).slice(0, 40)}  MCB="${u.mcb}"  ${u.from} → ${u.to}`);
  }

  if (!apply) {
    console.log("\nDry-run only. Re-run with --apply to write.");
    await client.end();
    return;
  }

  let written = 0;
  for (const u of updates) {
    await db.execute(sql`UPDATE students SET grade = ${u.to} WHERE id = ${u.id}::uuid`);
    written++;
  }
  console.log(`\nApplied ${written} grade updates.`);
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
