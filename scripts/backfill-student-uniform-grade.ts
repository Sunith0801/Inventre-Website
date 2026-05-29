/* eslint-disable no-console */
/**
 * One-shot (idempotent) backfill: ensure every students.grade holds the
 * school's uniform/catalog grade, so the shop API's join against
 * product_grades works.
 *
 * For each school with rows in school_grade_mappings:
 *   - Build a normalize-tolerant map { school-given-name | uniform-grade } → uniform-grade
 *   - For every student in that school whose `grade` is NULL or matches a
 *     school-given label, rewrite `grade` to the mapped uniform value.
 *   - Students whose grade is already a known uniform value are left alone.
 *   - Students whose grade doesn't match anything are logged and left alone.
 *
 * Re-runs are no-ops on already-correct rows.
 *
 * Usage:
 *   tsx scripts/backfill-student-uniform-grade.ts            # dry run
 *   tsx scripts/backfill-student-uniform-grade.ts --apply    # actually write
 */

import { config } from "dotenv";
import path from "path";
config({ path: path.resolve(process.cwd(), ".env.local") });
config({ path: path.resolve(process.cwd(), ".env") });

import { db } from "../db/client";
import { schools, students, schoolGradeMappings } from "../db/schema";
import { eq } from "drizzle-orm";

// Inlined from lib/grade-filter.ts to avoid Next.js's server-only marker
// when running via plain tsx.
function normalizeGrade(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const t = raw.trim().toLowerCase();
  if (!t) return null;
  const stripped = t.replace(/^(grade|class|std\.?|standard)\s+/i, "").trim();
  const roman: Record<string, string> = {
    i: "1", ii: "2", iii: "3", iv: "4", v: "5",
    vi: "6", vii: "7", viii: "8", ix: "9", x: "10",
    xi: "11", xii: "12",
  };
  if (roman[stripped]) return roman[stripped];
  const n = parseInt(stripped, 10);
  if (!Number.isNaN(n) && String(n) === stripped) return String(n);
  return stripped;
}

const APPLY = process.argv.includes("--apply");

async function main() {
  const allSchools = await db
    .select({ id: schools.id, name: schools.name })
    .from(schools);

  let totalUpdated = 0;
  let totalUnmapped = 0;
  let totalAlreadyCorrect = 0;

  for (const school of allSchools) {
    const mappings = await db
      .select({
        grade: schoolGradeMappings.grade,
        schoolGivenGradeName: schoolGradeMappings.schoolGivenGradeName,
      })
      .from(schoolGradeMappings)
      .where(eq(schoolGradeMappings.schoolId, school.id));

    if (mappings.length === 0) continue;

    const toUniform = new Map<string, string>();
    const uniformGrades = new Set<string>();
    for (const m of mappings) {
      if (!m.grade) continue;
      uniformGrades.add(m.grade);
      const nGrade = normalizeGrade(m.grade);
      if (nGrade) toUniform.set(nGrade, m.grade);
      if (m.schoolGivenGradeName) {
        const nGiven = normalizeGrade(m.schoolGivenGradeName);
        if (nGiven && !toUniform.has(nGiven)) toUniform.set(nGiven, m.grade);
      }
    }

    const studentRows = await db
      .select({
        id: students.id,
        name: students.name,
        grade: students.grade,
        class: students.class,
      })
      .from(students)
      .where(eq(students.schoolId, school.id));

    let schoolUpdated = 0;
    let schoolUnmapped = 0;
    let schoolCorrect = 0;

    for (const s of studentRows) {
      const currentNormalized = normalizeGrade(s.grade);
      const currentMatches =
        s.grade && currentNormalized && toUniform.get(currentNormalized) === s.grade;
      if (currentMatches) {
        schoolCorrect++;
        continue;
      }

      const candidates = [s.grade, s.class];
      let resolved: string | null = null;
      for (const c of candidates) {
        const n = normalizeGrade(c);
        if (!n) continue;
        const hit = toUniform.get(n);
        if (hit) {
          resolved = hit;
          break;
        }
      }

      if (!resolved) {
        schoolUnmapped++;
        console.log(
          `  [unmapped] ${school.name} · ${s.name} (id=${s.id}) grade=${JSON.stringify(s.grade)} class=${JSON.stringify(s.class)}`
        );
        continue;
      }

      if (resolved === s.grade) {
        schoolCorrect++;
        continue;
      }

      schoolUpdated++;
      console.log(
        `  ${APPLY ? "[update]" : "[dry-run]"} ${school.name} · ${s.name} (id=${s.id}) ${JSON.stringify(s.grade)} → ${JSON.stringify(resolved)}`
      );
      if (APPLY) {
        await db
          .update(students)
          .set({ grade: resolved })
          .where(eq(students.id, s.id));
      }
    }

    if (schoolUpdated || schoolUnmapped) {
      console.log(
        `${school.name}: ${schoolUpdated} to-update, ${schoolUnmapped} unmapped, ${schoolCorrect} already correct`
      );
    }
    totalUpdated += schoolUpdated;
    totalUnmapped += schoolUnmapped;
    totalAlreadyCorrect += schoolCorrect;
  }

  console.log("\n=== summary ===");
  console.log(`mode:            ${APPLY ? "APPLY" : "DRY-RUN"}`);
  console.log(`updated:         ${totalUpdated}`);
  console.log(`unmapped:        ${totalUnmapped}`);
  console.log(`already correct: ${totalAlreadyCorrect}`);
  if (!APPLY) console.log("\nrerun with --apply to write changes.");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
