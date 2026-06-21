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
 * The grade to SHOW for a student, anywhere in the app/admin.
 *
 * This is simply `students.grade` — the canonical grade. It is the value the
 * storefront catalog filters on (an exact match against `product_grades.grade`,
 * verified correct for ~100% of active students at every school), so it is by
 * definition the grade the parent shopped on and the one we must display.
 *
 * DELIBERATELY no ERPNext derivation: we do NOT translate `erp_raw->>'grade'`
 * by the ±3 ERP offset, do NOT prefer `students.class` (the ERP-uniform /
 * academic number, which is offset from the real grade at most schools), and
 * do NOT relabel through `school_grade_mappings`. Those layers produced the
 * wrong grades that were showing across the admin (e.g. QLPHP/SAMYU students
 * displaying the offset value). Clean data only — `students.grade`.
 *
 * Kept as a helper (rather than inlining `students.grade`) so there is a single
 * named source of truth for "the grade to display" and every call site reads
 * the same value.
 */
export function studentDisplayGradeSql(): SQL<string | null> {
  return sql<string | null>`${studentsTable.grade}`;
}
