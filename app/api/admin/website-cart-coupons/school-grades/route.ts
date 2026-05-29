import { NextResponse } from "next/server";
import { eq, asc } from "drizzle-orm";
import { db } from "@/db/client";
import { schools, schoolGradeMappings } from "@/db/schema";
import { requireAdmin, isResponse } from "@/lib/admin-guard";

/**
 * List the grades a given school serves (read from the ERP-synced
 * `school_grade_mappings` mirror). Used by the Website Cart Coupon form
 * to populate its Grade dropdown after a school is picked.
 */
export async function GET(req: Request) {
  const guard = await requireAdmin("super", "ops");
  if (isResponse(guard)) return guard;

  const erpName = new URL(req.url).searchParams.get("school")?.trim();
  if (!erpName) return NextResponse.json({ grades: [] });

  const [s] = await db
    .select({ id: schools.id })
    .from(schools)
    .where(eq(schools.erpName, erpName))
    .limit(1);
  if (!s) return NextResponse.json({ grades: [] });

  const rows = await db
    .select({
      grade: schoolGradeMappings.grade,
      schoolGiven: schoolGradeMappings.schoolGivenGradeName,
    })
    .from(schoolGradeMappings)
    .where(eq(schoolGradeMappings.schoolId, s.id))
    .orderBy(asc(schoolGradeMappings.rowIdx));

  // De-dupe by grade — same grade can appear under multiple sections.
  const seen = new Set<string>();
  const grades = rows
    .filter((r) => r.grade && !seen.has(r.grade) && (seen.add(r.grade), true))
    .map((r) => ({ grade: r.grade as string, schoolGiven: r.schoolGiven }));

  return NextResponse.json({ grades });
}
