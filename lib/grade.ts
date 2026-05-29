/**
 * Canonical grade extraction from item code / item name.
 *
 * The ERP item feed (audit.inventre.online) ships a `custom_uniform_grade[]`
 * field that is unreliable — wrong values, missing values, sometimes the
 * wrong school's grade attached to a shared item. We re-derive grade from
 * the item code or name where it's encoded in the human-readable label
 * (e.g. "WM JK Grade 9 Bookkit", "Sparsh Grade 9", "Computer applications
 * by Sumita Arora Gr IX").
 *
 * Canonical grade tokens (string-equal to `students.grade` in DB):
 *   "Nursery", "LKG", "UKG", "Grade 1" … "Grade 12"
 */

export type CanonicalGrade =
  | "Nursery"
  | "LKG"
  | "UKG"
  | `Grade ${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12}`;

const ROMAN_TO_NUM: Record<string, number> = {
  I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6,
  VII: 7, VIII: 8, IX: 9, X: 10, XI: 11, XII: 12,
};

/** Return a canonical token, or null if no grade could be parsed. */
export function extractGrade(...candidates: (string | null | undefined)[]): CanonicalGrade | null {
  for (const raw of candidates) {
    const hit = parseOne(raw);
    if (hit) return hit;
  }
  return null;
}

function parseOne(raw: string | null | undefined): CanonicalGrade | null {
  if (!raw) return null;
  const s = ` ${raw} `; // pad so word boundaries work at the edges
  const lower = s.toLowerCase();

  // Pre-primary tokens — match standalone (avoid "Plug" → UG)
  if (/\b(nursery|nur)\b/i.test(s)) return "Nursery";
  if (/\blkg\b/i.test(lower)) return "LKG";
  if (/\bukg\b/i.test(lower)) return "UKG";
  // Bare KG is ambiguous; only accept when not preceded by L/U letters
  if (/(^|[^a-z])kg($|[^a-z])/i.test(lower) && !/[lu]kg/i.test(lower)) {
    // No canonical "KG" — most schools use LKG/UKG. Skip rather than guess.
    return null;
  }

  // "Grade 9", "Grade-9", "Grade9"
  let m = s.match(/\bgrade[\s\-_]*(\d{1,2})\b/i);
  if (m) return numToGrade(parseInt(m[1], 10));

  // "Class 9"
  m = s.match(/\bclass[\s\-_]*(\d{1,2})\b/i);
  if (m) return numToGrade(parseInt(m[1], 10));

  // "Gr 9" / "Gr-9" / "Gr.9" — short form. Require word boundary to avoid
  // false-positives on "Grade" itself (already handled) or random "Gr"
  // strings. Allow optional period.
  m = s.match(/\bgr\.?[\s\-_]+(\d{1,2})\b/i);
  if (m) return numToGrade(parseInt(m[1], 10));

  // "Gr IX" / "Gr.IX" — roman numerals (book titles often use these)
  m = s.match(/\bgr\.?[\s\-_]+(I{1,3}|IV|V|VI{0,3}|IX|X{1,2}I{0,2})\b/i);
  if (m) {
    const n = ROMAN_TO_NUM[m[1].toUpperCase()];
    if (n) return numToGrade(n);
  }

  return null;
}

function numToGrade(n: number): CanonicalGrade | null {
  if (n < 1 || n > 12) return null;
  return `Grade ${n}` as CanonicalGrade;
}

/**
 * Canonicalise an arbitrary grade string (e.g. an ERP value or admin input)
 * to the same vocabulary. Returns null when the input doesn't look like a
 * grade.
 */
export function canonicalGrade(input: string | null | undefined): CanonicalGrade | null {
  return extractGrade(input);
}
