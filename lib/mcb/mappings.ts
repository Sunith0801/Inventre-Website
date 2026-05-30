/**
 * MyClassBoard → Inventre field mappings used by /admin/mcb when promoting
 * an MCB student into the real `students` + `parents` tables.
 *
 * Keep these tables explicit (not heuristic) — silent mis-attribution on
 * student-PII data is much worse than throwing on an unknown value.
 */
// canonicalGrade is intentionally not reused here — the MCB→Inventre
// offset (+3) differs from the generic catalog grade extractor.

/**
 * Exact-match MCB `BranchName` → existing `schools.school_code`.
 *
 * The five branches under our MCB token map to schools already seeded in
 * the `schools` table (see `select school_code, name from schools where
 * status='active'`). If MCB ever returns a new branch name we don't know,
 * return `null` so the grant action fails loudly instead of attaching the
 * student to the wrong row.
 */
const BRANCH_TO_SCHOOL_CODE: Record<string, string> = {
  "St. ANDREWS SCHOOL KEESARA": "SASKS",
  "St. ANDREWS HIGH SCHOOL SUCHITRA": "SASBP",
  "St. MICHAELS SCHOOL[ALWAL]": "SMSAW",
  "Winmore Academy Jakkur": "WMAJK",
  "Winmore Academy Whitefield": "WMAWF",
};

export function mcbBranchToSchoolCode(branchName: string | null | undefined): string | null {
  if (!branchName) return null;
  return BRANCH_TO_SCHOOL_CODE[branchName] ?? null;
}

export const MCB_SCHOOL_CODES = Object.values(BRANCH_TO_SCHOOL_CODE);

/**
 * MCB `ClassName` → canonical grade. MCB returns a mix of:
 *   - "Class 1" / "Grade 1"            (Arabic — handled by lib/grade.ts)
 *   - "CLASS VIII" / "Grade IX"        (Roman numerals — common)
 *   - "Class V" / "Class II"           (Roman, mixed-case)
 *   - "XII - Commerce" / "XI-Commerce" / "XII-MPC"  (stream variants for 11–12)
 *   - "Nursery" / "LKG" / "UKG"        (handled by lib/grade.ts)
 *
 * Strategy: try `canonicalGrade()` first (covers Arabic + pre-primary),
 * then fall back to Roman-numeral recognition.
 */
const ROMAN_TO_NUM: Record<string, number> = {
  I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6,
  VII: 7, VIII: 8, IX: 9, X: 10, XI: 11, XII: 12,
};

/** Parse an MCB grade string to a raw numeric N (Class N / Grade N) using
 *  either Arabic or Roman numerals. Returns null for pre-primary or
 *  unrecognised inputs. */
function mcbGradeToNumber(input: string): number | null {
  let m = input.match(/\b(?:class|grade|gr\.?)[\s\-_]*(\d{1,2})\b/i);
  if (m) return parseInt(m[1], 10);
  m = input.match(/\b(?:class|grade|gr\.?)[\s\-_]+(I{1,3}|IV|V|VI{0,3}|IX|X{1,2}I{0,2})\b/i);
  if (m) return ROMAN_TO_NUM[m[1].toUpperCase()] ?? null;
  // Bare leading Roman (e.g. "XII - Commerce", "XI-Commerce", "XII-MPC").
  m = input.match(/^\s*(I{1,3}|IV|V|VI{0,3}|IX|X{1,2}I{0,2})\b/i);
  if (m) return ROMAN_TO_NUM[m[1].toUpperCase()] ?? null;
  return null;
}

/**
 * MCB → Inventre canonical grade.
 *
 * The Inventre catalog stores grades in a "school-year" numbering that is
 * +3 ahead of MCB's academic-class numbering, with pre-primary occupying
 * the bottom three slots. This convention is also baked into the
 * `school_grade_mappings` table (which powers the storefront grade
 * dropdown, the recovery search, the magic-box, and admin /students/new),
 * so DO NOT change this to 1:1 without rewriting every row in that table
 * and re-mapping every existing students.grade value.
 *
 *   MCB Nursery → canonical "Grade 1"  (school displays as "Nursery")
 *   MCB LKG     → canonical "Grade 2"  (school displays as "LKG")
 *   MCB UKG     → canonical "Grade 3"  (school displays as "UKG")
 *   MCB Class 1 → canonical "Grade 4"  (school displays as "Grade 1")
 *   MCB Class 9 → canonical "Grade 12" (school displays as "Grade 9")
 *   MCB Class X → canonical "Grade 13" (school displays as "Grade 10")
 *   MCB XII     → canonical "Grade 15" (school displays as "Grade 12")
 *
 * The Grant Access admin dialog renders the canonical value but explains
 * what the school/parent will see — see GrantAccessButton.tsx.
 */
export function mcbGradeToCanonical(grade: string | null | undefined): string | null {
  if (!grade) return null;
  const s = grade.trim();
  if (/\bnursery\b/i.test(s) || /\bnur\b/i.test(s)) return "Grade 1";
  if (/\blkg\b/i.test(s)) return "Grade 2";
  if (/\bukg\b/i.test(s)) return "Grade 3";
  const n = mcbGradeToNumber(s);
  if (n == null) return null;
  return `Grade ${n + 3}`;
}

/**
 * MCB → CBSE/Real grade (1:1, no offset). This is the vocabulary
 * `product_grades.grade` uses, so storing this directly on
 * `students.grade` ensures the catalog query
 * (`WHERE pg.grade = students.grade`) returns the right products.
 *
 *   MCB Nursery → "Nursery"   (school displays "Nursery")
 *   MCB LKG     → "LKG"
 *   MCB UKG     → "UKG"
 *   MCB Class 1 → "Grade 1"
 *   MCB Class 9 → "Grade 9"
 *   MCB Class X → "Grade 10"
 *   MCB XII     → "Grade 12"
 *
 * Returns null on unrecognised input so callers can fail loudly.
 */
export function mcbGradeToCbse(grade: string | null | undefined): string | null {
  if (!grade) return null;
  const s = grade.trim();
  if (/\bnursery\b/i.test(s) || /\bnur\b/i.test(s)) return "Nursery";
  if (/\blkg\b/i.test(s)) return "LKG";
  if (/\bukg\b/i.test(s)) return "UKG";
  const n = mcbGradeToNumber(s);
  if (n == null) return null;
  return `Grade ${n}`;
}

/**
 * Inverse of `mcbGradeToCanonical` — Targeted grade → school-friendly
 * label that matches what MCB shows. Used to populate
 * `school_grade_mappings.schoolGivenGradeName` so parents see "Class 12"
 * on the storefront instead of the internal "Grade 15" vocabulary.
 *
 * Returns null when input is null/unrecognised — caller decides whether
 * to skip writing the mapping row.
 *
 *   "Grade 1"  → "Nursery"
 *   "Grade 2"  → "LKG"
 *   "Grade 3"  → "UKG"
 *   "Grade 4"  → "Class 1"
 *   "Grade 12" → "Class 9"
 *   "Grade 15" → "Class 12"
 */
export function targetedToMcbDisplay(grade: string | null | undefined): string | null {
  if (!grade) return null;
  const s = grade.trim();
  // 1:1 identity for the CBSE values now used end-to-end. Anything that
  // doesn't look like a known CBSE label returns null so the caller can
  // skip seeding a malformed mapping row (defensive — should never
  // happen after the Phase A cleanup).
  if (/^nursery$/i.test(s)) return "Nursery";
  if (/^lkg$/i.test(s)) return "LKG";
  if (/^ukg$/i.test(s)) return "UKG";
  const m = s.match(/^grade\s+(\d{1,2})$/i);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  if (n >= 1 && n <= 12) return `Grade ${n}`;
  return null;
}

/**
 * MCB `Gender` → "Male" | "Female".
 *
 * Convention verified against ~13k rows: boolean `true` is overwhelmingly
 * associated with male first names, `false` with female. Strings are also
 * accepted (`"Boy"`/`"Girl"`/`"M"`/`"F"`/`"Male"`/`"Female"`) for safety
 * if MCB changes the shape in a future API revision.
 */
export function mcbGenderToLabel(
  gender: boolean | string | null | undefined
): "Male" | "Female" | null {
  if (gender === true) return "Male";
  if (gender === false) return "Female";
  if (typeof gender === "string") {
    const g = gender.trim().toLowerCase();
    if (g === "male" || g === "m" || g === "boy") return "Male";
    if (g === "female" || g === "f" || g === "girl") return "Female";
  }
  return null;
}
