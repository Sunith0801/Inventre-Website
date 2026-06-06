/* eslint-disable no-console */
/**
 * CAS NIBM CIE sheet-driven fixes (2026-06-06, third pass).
 *
 * From the CIE roster comparison: 134 / 142 already correct. The
 * remaining 13 actionable rows are hardcoded below.
 *
 * Set A (8 rows): real grade promotions inside CASNIBMCIE.
 *   - 4 AS LEVEL kids currently stored as Grade 8 → bump to Grade 11
 *   - 4 A LEVEL kids currently stored as Grade 9 → bump to Grade 12
 *
 * Set B (5 rows): school transfers CASNIBMCBSE → CASNIBMCIE for AS LEVEL
 *   students; grade is already Grade 11 (correct) so only school_id +
 *   school_code change.
 *
 *   DATABASE_URL=… DATABASE_DIRECT_URL=… \
 *     npx tsx scripts/backfill-cas-nibm-cie-from-sheet.ts [--apply]
 */

import { config } from "dotenv";
import path from "path";
config({ path: path.resolve(process.cwd(), ".env.deploy") });
config({ path: path.resolve(process.cwd(), ".env.local") });
config({ path: path.resolve(process.cwd(), ".env") });

import postgres from "postgres";

const APPLY = process.argv.includes("--apply");
const url = process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_DIRECT_URL or DATABASE_URL is required");
const sql = postgres(url, { max: 1 });

// Set A — grade bumps inside CASNIBMCIE.
const GRADE_BUMPS: Array<[enrol: string, target: string]> = [
  ["23CAG20359", "Grade 11"], // Dharm Bandhan Gupta (AS LEVEL)
  ["23CAG20335", "Grade 11"], // Rudransh Rahul Singh Bais
  ["24CAG20474", "Grade 11"], // Shabbir Moiz Poonawala
  ["22CAG20052", "Grade 11"], // Shlok Pawar
  ["24CAG20355", "Grade 12"], // Abdul Husain Yousuf Qutbi (A LEVEL)
  ["22CAG20061", "Grade 12"], // Aditya Dhameer Lodge
  ["22CAG20059", "Grade 12"], // Ishaan Chetan Shah
  ["22CAG20057", "Grade 12"], // Minik Valerian Schauf
];

// Set B — school transfers (grade stays Grade 11).
const SCHOOL_MOVES: string[] = [
  "22CAG20050", // Alefiya Aliasgar Sapatwala
  "22CAG20051", // Gaurang Joshi
  "25CAG20329", // Harnidh Kaur Khanduja
  "24CAG20668", // Maisha Sanjay Thakore
  "22CAG20054", // Mehak Grewal
];

async function main() {
  console.log(APPLY ? "▶ APPLY mode" : "▶ DRY-RUN mode");

  const sch = (await sql`SELECT id::text, school_code FROM schools WHERE school_code = 'CASNIBMCIE'`) as unknown as { id: string; school_code: string }[];
  if (!sch.length) throw new Error("CASNIBMCIE school not found");
  const cieId = sch[0].id;

  // ── Set A — grade bumps ──────────────────────────────────────────
  console.log("\n=== 8 grade bumps inside CASNIBMCIE ===");
  let bumps = 0, bumpsAlready = 0;
  for (const [enrol, target] of GRADE_BUMPS) {
    const cur = (await sql`SELECT school_code, grade, class FROM students WHERE enrollment_number = ${enrol}`) as unknown as { school_code: string | null; grade: string | null; class: string | null }[];
    if (!cur.length) { console.log(`  ✗ ${enrol} — not in DB`); continue; }
    const c = cur[0];
    if (c.grade === target && c.class === target) {
      console.log(`  · ${enrol} — already ${target}`); bumpsAlready++; continue;
    }
    console.log(`  ${APPLY ? "✓" : "→"} ${enrol} [${c.school_code}] grade ${JSON.stringify(c.grade)}→${JSON.stringify(target)}, class ${JSON.stringify(c.class)}→${JSON.stringify(target)}`);
    if (APPLY) {
      await sql`UPDATE students SET grade = ${target}, class = ${target} WHERE enrollment_number = ${enrol}`;
    }
    bumps++;
  }

  // ── Set B — school transfers (Grade 11 already correct, only school changes) ─
  console.log("\n=== 5 school transfers CASNIBMCBSE → CASNIBMCIE ===");
  let moves = 0, movesAlready = 0;
  for (const enrol of SCHOOL_MOVES) {
    const cur = (await sql`SELECT school_id::text, school_code, grade, class FROM students WHERE enrollment_number = ${enrol}`) as unknown as { school_id: string; school_code: string | null; grade: string | null; class: string | null }[];
    if (!cur.length) { console.log(`  ✗ ${enrol} — not in DB`); continue; }
    const c = cur[0];
    if (c.school_id === cieId && c.school_code === "CASNIBMCIE") {
      console.log(`  · ${enrol} — already in CASNIBMCIE`); movesAlready++; continue;
    }
    console.log(`  ${APPLY ? "✓" : "→"} ${enrol} school ${c.school_code}→CASNIBMCIE (grade stays ${JSON.stringify(c.grade)})`);
    if (APPLY) {
      await sql`UPDATE students SET school_id = ${cieId}::uuid, school_code = 'CASNIBMCIE' WHERE enrollment_number = ${enrol}`;
    }
    moves++;
  }

  console.log("\n─── Summary ───");
  console.log(`grade bumps  ${APPLY ? "applied" : "planned"}: ${bumps}   already-correct: ${bumpsAlready}`);
  console.log(`school moves ${APPLY ? "applied" : "planned"}: ${moves}   already-correct: ${movesAlready}`);
  if (!APPLY) console.log("\n(dry-run — re-run with --apply to commit)");

  await sql.end({ timeout: 5 });
}
main().catch((e) => { console.error(e); process.exit(1); });
