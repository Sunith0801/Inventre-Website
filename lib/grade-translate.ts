/**
 * ERPNext internally numbers grades with a +3 offset over the real (CBSE)
 * grade. The students table imported from ERP-Education stores the internal
 * value; product / BOM tables use the natural numbering. This module
 * translates between them.
 *
 *   ERP Grade 1  ↔ Nursery
 *   ERP Grade 2  ↔ LKG
 *   ERP Grade 3  ↔ UKG
 *   ERP Grade 4  ↔ Grade 1
 *   …
 *   ERP Grade 12 ↔ Grade 9   ← e.g. Mahendra Teja
 *   ERP Grade 15 ↔ Grade 12
 *
 * Anything outside the table returns null — caller decides how to handle.
 */

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
  // Pre-primary already-real values pass through:
  Nursery: "Nursery",
  LKG: "LKG",
  UKG: "UKG",
};

/**
 * Translate an ERP-internal grade label to the human-facing CBSE label that
 * matches BOM / item-organization naming. Returns null when the input is
 * unrecognised so callers can fail loudly.
 */
export function erpGradeToReal(erpGrade: string | null | undefined): string | null {
  if (!erpGrade) return null;
  const trimmed = erpGrade.trim();
  if (ERP_TO_REAL[trimmed]) return ERP_TO_REAL[trimmed];

  // Normalise case + dashes
  const m = trimmed.match(/^grade[\s\-_]*(\d{1,2})$/i);
  if (m) {
    const key = `Grade ${parseInt(m[1], 10)}`;
    return ERP_TO_REAL[key] ?? null;
  }
  // Trailing-suffix forms like "Grade 13 DSE", "Grade 12 (Sports)", "Grade 11 Honors".
  // students.class occasionally carries a specialisation tag; for shop catalog
  // scoping we only need the numeric grade. The suffix is dropped.
  const sm = trimmed.match(/^grade[\s\-_]*(\d{1,2})\b/i);
  if (sm) {
    const key = `Grade ${parseInt(sm[1], 10)}`;
    return ERP_TO_REAL[key] ?? null;
  }
  return null;
}
