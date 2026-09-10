import "server-only";
import { inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { productGrades } from "@/db/schema";

/**
 * Normalize grade strings so a student's `class` field ("5", "Grade 5",
 * "Class 5", "V") matches whatever's stored in product_grades.grade.
 *
 * Canonical form: bare integer string ("5") for numeric grades,
 * lowercase trimmed otherwise ("nursery", "kg", "ukg").
 */
export function normalizeGrade(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const t = raw.trim().toLowerCase();
  if (!t) return null;
  // Strip "grade" / "class" / "std" prefix
  const stripped = t.replace(/^(grade|class|std\.?|standard)\s+/i, "").trim();
  // Roman numerals → digits (i..xii)
  const roman: Record<string, string> = {
    i: "1", ii: "2", iii: "3", iv: "4", v: "5",
    vi: "6", vii: "7", viii: "8", ix: "9", x: "10",
    xi: "11", xii: "12",
  };
  if (roman[stripped]) return roman[stripped];
  // Numeric → bare integer
  const n = parseInt(stripped, 10);
  if (!Number.isNaN(n) && String(n) === stripped) return String(n);
  return stripped;
}

type Identified = { id: string };

/**
 * Filter a product list to those allowed for a given grade. A product with
 * NO product_grades rows is treated as universal (visible to all grades);
 * a product with rows must explicitly include the grade.
 */
export async function filterProductsByGrade<T extends Identified>(
  products: T[],
  grade: string
): Promise<T[]> {
  if (products.length === 0) return products;
  const target = normalizeGrade(grade);
  if (!target) return products;

  const ids = products.map((p) => p.id);
  const rows = await db
    .select({
      productId: productGrades.productId,
      grade: productGrades.grade,
    })
    .from(productGrades)
    .where(inArray(productGrades.productId, ids));

  const allowed = new Map<string, Set<string>>();
  for (const r of rows) {
    const set = allowed.get(r.productId) ?? new Set<string>();
    set.add(normalizeGrade(r.grade) ?? r.grade);
    allowed.set(r.productId, set);
  }

  return products.filter((p) => {
    const grades = allowed.get(p.id);
    return !grades || grades.has(target);
  });
}
