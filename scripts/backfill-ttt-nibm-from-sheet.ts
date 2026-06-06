/* eslint-disable no-console */
/**
 * TTT NIBM sheet-driven fixes (2026-06-06, second pass after CAS NIBM).
 *
 * The TTT NIBM roster comparison found:
 *   - 85 / 90 already correct
 *   - 4 students promoted Nursery → LKG inside TTTNIBM (Tandale twins,
 *     Sayyad twins) — straight UPDATE.
 *   - 1 student (25CAG20663 Turki Algahuri Aiman) currently in our DB as
 *     CASNIBMCBSE Grade 1; the sheet says TTTNIBM UKG. Per the user this
 *     row is wrong in our DB — move him back to TTTNIBM and re-grade to
 *     UKG. This is an UPDATE of school_id + school_code + grade + class.
 *
 * Idempotent: re-running sees the converged state and does nothing.
 *
 *   DATABASE_URL="postgres://inventre:inventre_prod@localhost:6433/inventre" \
 *   DATABASE_DIRECT_URL="postgres://inventre:inventre_prod@localhost:55433/inventre" \
 *     npx tsx scripts/backfill-ttt-nibm-from-sheet.ts [--apply]
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

const LKG_BUMPS: Array<[enrol: string, grade: string]> = [
  ["25CAG20605", "LKG"], // Shrivansh Sumit Tandale
  ["25CAG20604", "LKG"], // Shriyansh Sumit Tandale
  ["25CAG20265", "LKG"], // Taeen Afroj Sayyad
  ["25CAG20264", "LKG"], // Tanaz Afroj Sayyad
];

async function main() {
  console.log(APPLY ? "▶ APPLY mode" : "▶ DRY-RUN mode");

  // Resolve TTTNIBM school_id.
  const sch = (await sql`SELECT id::text FROM schools WHERE school_code = 'TTTNIBM'`) as unknown as { id: string }[];
  if (!sch.length) throw new Error("TTTNIBM not found in schools");
  const tttId = sch[0].id;

  // ── Pass 1: 4 in-TTT Nursery → LKG bumps ──────────────────────────
  console.log("\n=== 4 Nursery → LKG bumps inside TTTNIBM ===");
  let bumps = 0, bumpsAlready = 0;
  for (const [enrol, target] of LKG_BUMPS) {
    const cur = (await sql`SELECT grade, class, school_code FROM students WHERE enrollment_number = ${enrol}`) as unknown as { grade: string | null; class: string | null; school_code: string | null }[];
    if (!cur.length) {
      console.log(`  ✗ ${enrol} — not in DB (skipped)`);
      continue;
    }
    const c = cur[0];
    if (c.grade === target && c.class === target) {
      console.log(`  · ${enrol} — already ${target}`);
      bumpsAlready++;
      continue;
    }
    console.log(`  ${APPLY ? "✓" : "→"} ${enrol} [${c.school_code}] grade ${JSON.stringify(c.grade)}→${JSON.stringify(target)}, class ${JSON.stringify(c.class)}→${JSON.stringify(target)}`);
    if (APPLY) {
      await sql`UPDATE students SET grade = ${target}, class = ${target} WHERE enrollment_number = ${enrol}`;
    }
    bumps++;
  }

  // ── Pass 2: Turki Algahuri — move CASNIBMCBSE Grade 1 → TTTNIBM UKG ─
  console.log("\n=== 25CAG20663 Turki Algahuri Aiman — move to TTTNIBM UKG ===");
  const turki = (await sql`
    SELECT school_id::text, school_code, grade, class FROM students WHERE enrollment_number = '25CAG20663'
  `) as unknown as { school_id: string; school_code: string | null; grade: string | null; class: string | null }[];
  let turkiDone = false;
  if (!turki.length) {
    console.log("  ✗ 25CAG20663 not in DB");
  } else {
    const t = turki[0];
    if (t.school_id === tttId && t.school_code === "TTTNIBM" && t.grade === "UKG" && t.class === "UKG") {
      console.log("  · 25CAG20663 — already TTTNIBM UKG");
      turkiDone = true;
    } else {
      console.log(`  ${APPLY ? "✓" : "→"} 25CAG20663 school ${t.school_code}→TTTNIBM, grade ${JSON.stringify(t.grade)}→"UKG", class ${JSON.stringify(t.class)}→"UKG"`);
      if (APPLY) {
        await sql`
          UPDATE students
             SET school_id = ${tttId}::uuid,
                 school_code = 'TTTNIBM',
                 grade = 'UKG',
                 class = 'UKG'
           WHERE enrollment_number = '25CAG20663'
        `;
      }
      turkiDone = true;
    }
  }

  console.log("\n─── Summary ───");
  console.log(`Nursery→LKG bumps ${APPLY ? "applied" : "planned"}: ${bumps}`);
  console.log(`bumps already-correct:           ${bumpsAlready}`);
  console.log(`Turki ${APPLY ? "moved" : "planned"}: ${turkiDone ? "yes" : "no"}`);
  if (!APPLY) console.log("\n(dry-run — re-run with --apply to commit)");

  await sql.end({ timeout: 5 });
}
main().catch((e) => { console.error(e); process.exit(1); });
