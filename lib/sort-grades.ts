/**
 * Natural-order comparator for grade strings.
 *
 * Default string sort gives "Grade 1, Grade 10, Grade 11, ..., Grade 2, Grade 3"
 * — confusing for admin. This puts them in the order a teacher would expect:
 *
 *   1. Pre-school: Nursery → Pre-K → LKG → UKG / KG / Kindergarten → PP1/PP2
 *   2. Grade N ordered by N. Suffixed variants (e.g. "Grade 12 DSE") sort
 *      after the plain form.
 *   3. Everything else, alphabetical.
 *
 * Comparison is case-insensitive and whitespace-tolerant. Safe to use on
 * both `grades.gradeName` master strings and free-text `product_grades.grade`
 * values, since the buckets cover both shapes.
 */

const PRE_SCHOOL_ORDER = [
  "nursery",
  "pre-k",
  "pre k",
  "prek",
  "lkg",
  "ukg",
  "kg",
  "kindergarten",
  "pp1",
  "pp2",
];

function normalize(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, " ");
}

function preSchoolIndex(name: string): number {
  const n = normalize(name).replace(/[\s-]/g, "");
  for (let i = 0; i < PRE_SCHOOL_ORDER.length; i++) {
    const k = PRE_SCHOOL_ORDER[i].replace(/[\s-]/g, "");
    if (n === k) return i;
  }
  return -1;
}

type Key = readonly [bucket: number, primary: number, secondary: number, fallback: string];

function gradeSortKey(name: string): Key {
  const lower = normalize(name);

  // Tier 0 — pre-school.
  const pre = preSchoolIndex(name);
  if (pre !== -1) return [0, pre, 0, lower];

  // Tier 1 — "Grade N" with optional suffix like "DSE".
  const m = lower.match(/^grade\s+(\d+)(.*)$/);
  if (m) {
    const n = parseInt(m[1], 10);
    const suffix = m[2].trim();
    // Suffix-less form sorts before suffixed: ("Grade 12", "") before
    // ("Grade 12", "dse"). Secondary key 0 vs 1 plus the suffix string
    // keeps multi-suffix ordering stable.
    return [1, n, suffix ? 1 : 0, lower];
  }

  // Tier 2 — everything else, alphabetical.
  return [2, 0, 0, lower];
}

export function compareGrades(a: string, b: string): number {
  const ka = gradeSortKey(a);
  const kb = gradeSortKey(b);
  if (ka[0] !== kb[0]) return ka[0] - kb[0];
  if (ka[1] !== kb[1]) return ka[1] - kb[1];
  if (ka[2] !== kb[2]) return ka[2] - kb[2];
  return ka[3] < kb[3] ? -1 : ka[3] > kb[3] ? 1 : 0;
}

/** Convenience wrapper for sorting arrays of objects by a grade field. */
export function sortByGrade<T>(arr: T[], getGrade: (item: T) => string): T[] {
  return [...arr].sort((a, b) => compareGrades(getGrade(a), getGrade(b)));
}
