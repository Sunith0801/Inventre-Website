/* eslint-disable no-console */
/**
 * One-shot (idempotent) backfill: rewrite students.grade into the
 * Targeted-Grade vocabulary (Nursery / LKG / UKG / Grade 1..12) so the
 * shop's exact-string join against product_grades lines up with
 * student-facing labels.
 *
 * For each school with rows in school_grade_mappings:
 *   - Build a school-given-name → uniform-grade map.
 *   - For every student in that school, try to resolve `grade` (then
 *     `class` as fallback) to a Targeted-Grade value via:
 *       (1) ERP-uniform shape ("Grade N" / Nursery / LKG / UKG) →
 *           translated via the +3 offset table (inlined erpGradeToReal).
 *       (2) Matches a school_given_grade_name → translate to uniform,
 *           then via (1).
 *   - Already-Targeted rows are left alone. Unresolvable rows are logged.
 *
 * Re-runs are no-ops on already-correct rows.
 *
 * Usage:
 *   tsx scripts/backfill-student-targeted-grade.ts            # dry run
 *   tsx scripts/backfill-student-targeted-grade.ts --apply    # write
 */

import { config } from "dotenv";
import path from "path";
config({ path: path.resolve(process.cwd(), ".env.local") });
config({ path: path.resolve(process.cwd(), ".env") });

import { db } from "../db/client";
import { schools, students, schoolGradeMappings } from "../db/schema";
import { eq } from "drizzle-orm";

// Inlined from lib/grade-filter.ts (avoids Next.js's "server-only" marker
// when running via plain tsx).
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

// Inlined from lib/grade-translate.ts.
const ERP_TO_REAL: Record<string, string> = {
  "Grade 1": "Nursery",
  "Grade 2": "LKG",
  "Grade 3": "UKG",
  "Grade 4": "Grade 1",
  "Grade 5": "Grade 2",
  "Grade 6": "Grade 3",
  "Grade 7": "Grade 4",
  "Grade 8": "Grade 5",
  "Grade 9": "Grade 6",
  "Grade 10": "Grade 7",
  "Grade 11": "Grade 8",
  "Grade 12": "Grade 9",
  "Grade 13": "Grade 10",
  "Grade 14": "Grade 11",
  "Grade 15": "Grade 12",
  Nursery: "Nursery",
  LKG: "LKG",
  UKG: "UKG",
};

const TARGETED_VOCAB = new Set(Object.values(ERP_TO_REAL));

function looksLikeErpUniform(raw: string): boolean {
  const s = raw.trim();
  if (/^grade\s+\d{1,2}(\s+\w+)?$/i.test(s)) return true;
  if (/^(nursery|lkg|ukg)$/i.test(s)) return true;
  return false;
}

function erpGradeToReal(raw: string): string | null {
  const trimmed = raw.trim();
  if (ERP_TO_REAL[trimmed]) return ERP_TO_REAL[trimmed];
  const m = trimmed.match(/^grade[\s\-_]*(\d{1,2})$/i);
  if (m) return ERP_TO_REAL[`Grade ${parseInt(m[1], 10)}`] ?? null;
  const sm = trimmed.match(/^grade[\s\-_]*(\d{1,2})\b/i);
  if (sm) return ERP_TO_REAL[`Grade ${parseInt(sm[1], 10)}`] ?? null;
  return null;
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

    const bySchoolGiven = new Map<string, string>();
    for (const m of mappings) {
      if (!m.grade || !m.schoolGivenGradeName) continue;
      const nGiven = normalizeGrade(m.schoolGivenGradeName);
      if (!nGiven) continue;
      if (!bySchoolGiven.has(nGiven)) bySchoolGiven.set(nGiven, m.grade);
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
      let target: string | null = null;
      for (const candidate of [s.grade, s.class]) {
        if (!candidate) continue;
        if (looksLikeErpUniform(candidate)) {
          target = erpGradeToReal(candidate);
          if (target) break;
        }
        const n = normalizeGrade(candidate);
        if (!n) continue;
        const uniform = bySchoolGiven.get(n);
        if (uniform) {
          target = erpGradeToReal(uniform) ?? uniform;
          if (target) break;
        }
      }

      if (!target) {
        schoolUnmapped++;
        console.log(
          `  [unmapped] ${school.name} · ${s.name} (id=${s.id}) grade=${JSON.stringify(s.grade)} class=${JSON.stringify(s.class)}`
        );
        continue;
      }

      if (target === s.grade) {
        schoolCorrect++;
        continue;
      }

      // Already-correct guard: if grade is in TARGETED_VOCAB and the
      // candidate resolves to the same vocab, leave it. But our `target`
      // was just computed from `grade ?? class`, so if `grade` was already
      // a targeted value and resolves to itself, target === s.grade above
      // handles it. The only remaining case is `grade` is already a
      // targeted value that differs from the resolved one — leave it
      // because the admin / a prior backfill likely set it intentionally.
      if (s.grade && TARGETED_VOCAB.has(s.grade) && !looksLikeErpUniform(s.grade)) {
        // Skip — keep the existing targeted value untouched.
        schoolCorrect++;
        continue;
      }

      schoolUpdated++;
      console.log(
        `  ${APPLY ? "[update]" : "[dry-run]"} ${school.name} · ${s.name} (id=${s.id}) ${JSON.stringify(s.grade)} → ${JSON.stringify(target)}`
      );
      if (APPLY) {
        await db
          .update(students)
          .set({ grade: target })
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
  if (APPLY) {
    console.log(
      "\n⚠  Restart the deploy app to flush Next.js unstable_cache:\n" +
        "   docker restart inventre-deploy-app"
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
