import "server-only";
import { eq, sql, type SQL } from "drizzle-orm";
import { db } from "@/db/client";
import { schoolGradeMappings, students as studentsTable } from "@/db/schema";
import { normalizeGrade } from "@/lib/grade-filter";
import { erpGradeToReal } from "@/lib/grade-translate";

/**
 * Convert a raw grade label from ERP / a CSV / a school's local naming into
 * the canonical "Targeted Grade" vocabulary — the same set the admin
 * "Targeted grades" picker writes
 * (`components/admin/ProductEditTabs.tsx:367-373`):
 *
 *   Nursery, LKG, UKG, Grade 1 … Grade 12 (+ DSE variants)
 *
 * Both `students.grade` and `product_grades.grade` should hold values from
 * this set so the shop's exact-string filter
 * (`lib/repos/products.ts:listProductsForStudent`) matches cleanly.
 *
 * IMPORTANT: this helper assumes the input is an ERP uniform grade or a
 * school's local label, NOT a Targeted-vocab value. Callers that already
 * have a Targeted value (e.g. the admin picker) should not run their
 * input through here — "Grade 5" in Targeted means Class 5, but "Grade 5"
 * in ERP-uniform means Class 2 (Grade 5 = Class 2 via the +3 offset).
 *
 * Resolution order:
 *   1. Input matches a `school_grade_mappings.school_given_grade_name`
 *      for the school → translate to that row's uniform grade, then
 *      `erpGradeToReal`.
 *   2. Input is a known uniform grade ("Grade 1".."Grade 15", "Nursery",
 *      "LKG", "UKG", or any DSE variant) → `erpGradeToReal`.
 *   3. Else null.
 */

type SchoolGradeMap = {
  /** normalized school-given label → uniform grade (raw ERP value, e.g. "Grade 8") */
  bySchoolGiven: Map<string, string>;
};

const schoolMapCache = new Map<string, Promise<SchoolGradeMap>>();

async function loadSchoolGradeMap(schoolId: string): Promise<SchoolGradeMap> {
  const cached = schoolMapCache.get(schoolId);
  if (cached) return cached;
  const p = (async (): Promise<SchoolGradeMap> => {
    const rows = await db
      .select({
        grade: schoolGradeMappings.grade,
        schoolGivenGradeName: schoolGradeMappings.schoolGivenGradeName,
      })
      .from(schoolGradeMappings)
      .where(eq(schoolGradeMappings.schoolId, schoolId));

    const bySchoolGiven = new Map<string, string>();
    for (const r of rows) {
      if (!r.grade || !r.schoolGivenGradeName) continue;
      const nGiven = normalizeGrade(r.schoolGivenGradeName);
      if (!nGiven) continue;
      if (!bySchoolGiven.has(nGiven)) bySchoolGiven.set(nGiven, r.grade);
    }
    return { bySchoolGiven };
  })();
  schoolMapCache.set(schoolId, p);
  return p;
}

/** "Grade 1".."Grade 15" with optional DSE suffix, or one of the
 *  ERP pre-primary canonical tokens (Nursery / LKG / UKG). When the input
 *  matches this shape, it's an ERP-uniform value and we translate via
 *  `erpGradeToReal` without looking at the school's school-given list. */
function looksLikeErpUniform(raw: string): boolean {
  const s = raw.trim();
  if (/^grade\s+\d{1,2}(\s+\w+)?$/i.test(s)) return true;
  if (/^(nursery|lkg|ukg)$/i.test(s)) return true;
  return false;
}

/** Invalidate the in-process cache for a school. Call after admin edits to
 *  school_grade_mappings so subsequent imports see the new entries. */
export function invalidateSchoolGradeMap(schoolId: string): void {
  schoolMapCache.delete(schoolId);
}

/**
 * Resolve `raw` into the Targeted-Grade vocabulary for the given school.
 * Returns null when the input can't be placed.
 */
export async function toTargetedGrade(
  schoolId: string,
  raw: string | null | undefined
): Promise<string | null> {
  if (!raw) return null;
  const map = await loadSchoolGradeMap(schoolId);
  return resolveTargeted(map, raw);
}

/**
 * Batch variant for importers: load the school's mapping once, resolve
 * many synchronously.
 */
export async function makeTargetedGradeResolver(
  schoolId: string
): Promise<(raw: string | null | undefined) => string | null> {
  const map = await loadSchoolGradeMap(schoolId);
  return (raw) => resolveTargeted(map, raw);
}

function resolveTargeted(
  map: SchoolGradeMap,
  raw: string | null | undefined
): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // (1) ERP-uniform shape ("Grade N", "Nursery", "LKG", "UKG") — translate
  //     directly via the +3 offset table. Skip the school-given lookup so a
  //     school that names its Class 1 just "1" doesn't capture an incoming
  //     ERP "Grade 1" (which means Nursery).
  if (looksLikeErpUniform(trimmed)) {
    const real = erpGradeToReal(trimmed);
    if (real) return real;
  }

  // (2) Anything else — bare number, "Class N", "Std V", "JKG", "SKG", or
  //     any other school-local label — resolve through school_grade_mappings.
  const n = normalizeGrade(trimmed);
  if (!n) return null;
  const uniform = map.bySchoolGiven.get(n);
  if (uniform) {
    const real = erpGradeToReal(uniform);
    if (real) return real;
    return uniform;
  }

  return null;
}

// ─── Backwards-compatible shims ────────────────────────────────────────
// Older callers reached for `toUniformGrade` / `makeUniformGradeResolver`;
// keep them exported so audit-trail commits don't break. They now produce
// Targeted-vocab values. New code MUST use the targeted names.
export const toUniformGrade = toTargetedGrade;
export const makeUniformGradeResolver = makeTargetedGradeResolver;

/**
 * SQL fragment that resolves a student's grade to what the admin should
 * SEE in /admin/students. Three layers:
 *
 *   1. The school's `school_given_grade_name` from `school_grade_mappings`
 *      keyed on the student's *real* CBSE grade (e.g. TSUSC "Grade 1" → "1",
 *      SAMYU "Nursery" → "IK 1").
 *   2. The real CBSE grade itself.
 *   3. `students.grade` as a last resort (zero-data fallback).
 *
 * "Real CBSE grade" is derived per-row, not per-school, because different
 * schools — and even different students within the same school — have
 * inconsistent sync histories:
 *
 *   - For most ERP-only schools (CAS, QLPHP, SAMYU, SMS partial), the +3
 *     offset was applied at sync time to `students.grade` so `class` holds
 *     the real value (CASLRCBSE 26CAG10682: grade=Grade 2, class=Grade 5,
 *     real=Grade 5; QLPHP 25QLS0183: grade=Grade 7, class=Grade 10,
 *     real=Grade 10).
 *   - For YIPS, TSUSC, and most MCB-linked schools, `students.grade` is
 *     correct and `class` carries the raw ERP value instead (YIPS 100%
 *     stored-grade match; Sunith Kumar at TSUSC has stored=Grade 11 = real).
 *   - KLINK has both patterns mixed within one school (43% stored, 57%
 *     class), so any school-level switch would still be wrong for half its
 *     students.
 *
 * Per-row heuristic: pick whichever of `class` / `grade` matches the value
 * that the +3 translation of `erp_raw->>'grade'` says is real. If neither
 * matches (manually-corrected records like Sunith whose raw payload is
 * stale), fall back to `students.grade`.
 */
export function studentDisplayGradeSql(): SQL<string | null> {
  // Mirror of ERP_TO_REAL in lib/grade-translate.ts. Inline so the whole
  // resolution happens in a single SQL pass with no Postgres function
  // dependency. Returns NULL when erp_raw->>'grade' isn't recognised.
  const realFromRaw = sql`
    CASE ${studentsTable.erpRaw}->>'grade'
      WHEN 'Grade 1'  THEN 'Nursery'
      WHEN 'Grade 2'  THEN 'LKG'
      WHEN 'Grade 3'  THEN 'UKG'
      WHEN 'Grade 4'  THEN 'Grade 1'
      WHEN 'Grade 5'  THEN 'Grade 2'
      WHEN 'Grade 6'  THEN 'Grade 3'
      WHEN 'Grade 7'  THEN 'Grade 4'
      WHEN 'Grade 8'  THEN 'Grade 5'
      WHEN 'Grade 9'  THEN 'Grade 6'
      WHEN 'Grade 10' THEN 'Grade 7'
      WHEN 'Grade 11' THEN 'Grade 8'
      WHEN 'Grade 12' THEN 'Grade 9'
      WHEN 'Grade 13' THEN 'Grade 10'
      WHEN 'Grade 14' THEN 'Grade 11'
      WHEN 'Grade 15' THEN 'Grade 12'
      WHEN 'Nursery'  THEN 'Nursery'
      WHEN 'LKG'      THEN 'LKG'
      WHEN 'UKG'      THEN 'UKG'
      ELSE NULL
    END
  `;
  // Prefer the column that agrees with ERPNext; if neither does, take
  // students.grade (covers manual corrections + rows with no erp_raw).
  const realGrade = sql`
    CASE
      WHEN ${realFromRaw} IS NOT NULL AND ${studentsTable.class} = ${realFromRaw}
        THEN ${studentsTable.class}
      WHEN ${realFromRaw} IS NOT NULL AND ${studentsTable.grade} = ${realFromRaw}
        THEN ${studentsTable.grade}
      ELSE ${studentsTable.grade}
    END
  `;
  return sql<string | null>`COALESCE(
    (
      SELECT m.school_given_grade_name
        FROM school_grade_mappings m
       WHERE m.school_id = ${studentsTable.schoolId}
         AND lower(m.grade) = lower(${realGrade})
       LIMIT 1
    ),
    ${realGrade}
  )`;
}
