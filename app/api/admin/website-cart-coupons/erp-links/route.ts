import { NextResponse } from "next/server";
import { ilike, or, and, isNotNull } from "drizzle-orm";
import { db } from "@/db/client";
import { schools, students } from "@/db/schema";
import { isResponse, requirePermission } from "@/lib/admin-guard";

/**
 * Resolve the ERPNext link fields on the Website Cart Coupon form
 * (school / student) by searching local mirror tables on `erp_name`.
 * Keeps the form's behavior identical to the ERP form: type-ahead that
 * looks up live records and returns the canonical ERP name string.
 */
export async function GET(req: Request) {
  const guard = await requirePermission("discounts.read");
  if (isResponse(guard)) return guard;
  const url = new URL(req.url);
  const kind = url.searchParams.get("kind") ?? "school";
  const q = (url.searchParams.get("q") ?? "").trim();
  const limit = Math.min(50, Number(url.searchParams.get("limit") ?? 25));

  if (kind === "school") {
    const rows = await db
      .select({ erpName: schools.erpName, name: schools.name })
      .from(schools)
      .where(
        and(
          isNotNull(schools.erpName),
          q
            ? or(
                ilike(schools.name, `%${q}%`),
                ilike(schools.erpName, `%${q}%`),
              )
            : undefined,
        ),
      )
      .limit(limit);
    return NextResponse.json({ results: rows });
  }

  if (kind === "student") {
    if (q.length < 2)
      return NextResponse.json({ results: [] });
    const rows = await db
      .select({
        erpName: students.erpName,
        firstName: students.firstName,
        lastName: students.lastName,
      })
      .from(students)
      .where(
        and(
          isNotNull(students.erpName),
          or(
            ilike(students.firstName, `%${q}%`),
            ilike(students.lastName, `%${q}%`),
            ilike(students.erpName, `%${q}%`),
          ),
        ),
      )
      .limit(limit);
    return NextResponse.json({ results: rows });
  }

  return NextResponse.json({ results: [] });
}
