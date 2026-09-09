import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { eq, ilike, or, and, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { students, schools } from "@/db/schema";
import { requirePermission, isResponse } from "@/lib/admin-guard";
import { parseJson } from "@/lib/api-handler";
import { invalidateCatalog } from "@/lib/cache";
import { logActivity } from "@/lib/activity";

/**
 * Bulk-set students.enabled across every row that matches the current
 * /admin/students filter set — the mass website-access switch. `enabled`
 * is the same field the per-student "Enabled" checkbox writes, and the
 * storefront student picker (lib/session.ts) only ever selects
 * `enabled = true AND status = 'active'`, so flipping it to false takes a
 * student off the website; ticking it back re-admits exactly that one.
 *
 * Filter contract is identical to `GET /api/admin/students` so the client
 * can post the same query-string params it already builds.
 *
 *   POST { enabled: boolean, filters: { q?, schoolCode?, grade?,
 *          enabled?, verified?, newStudent?, recent? } }
 *   → { updated: number }
 *
 * school_admin is locked to their own school regardless of the filter
 * payload, mirroring the GET handler.
 */
const Body = z.object({
  enabled: z.boolean(),
  filters: z
    .object({
      q: z.string().optional(),
      schoolCode: z.string().optional(),
      grade: z.string().optional(),
      enabled: z.string().optional(),
      verified: z.string().optional(),
      newStudent: z.string().optional(),
      recent: z.string().optional(),
    })
    .default({}),
});

export async function POST(req: NextRequest) {
  const guard = await requirePermission("students.write");
  if (isResponse(guard)) return guard;
  const parsed = await parseJson(req, Body);
  if (parsed instanceof NextResponse) return parsed;

  const f = parsed.filters;
  const adminSchoolId = guard.role === "school_admin" ? guard.schoolId : null;
  let effectiveSchoolCode = f.schoolCode || null;
  if (adminSchoolId && !effectiveSchoolCode) {
    const [row] = await db
      .select({ code: schools.schoolCode })
      .from(schools)
      .where(eq(schools.id, adminSchoolId))
      .limit(1);
    effectiveSchoolCode = row?.code ?? null;
  }

  const conds = [];
  if (f.q) {
    const q = f.q;
    conds.push(
      or(
        ilike(students.firstName, `%${q}%`),
        ilike(students.enrollmentNumber, `%${q}%`),
        ilike(students.erpName, `%${q}%`),
        ilike(students.studentEmailId, `%${q}%`),
        ilike(students.studentMobileNumber, `%${q}%`),
        sql`EXISTS (
          SELECT 1 FROM school_grade_mappings m
           WHERE m.school_id = ${students.schoolId}
             AND lower(m.grade) = lower(${students.grade})
             AND m.school_given_grade_name ILIKE ${"%" + q + "%"}
        )`,
        sql`EXISTS (
          SELECT 1 FROM mcb_students mr
           WHERE mr.enrolment_number = ${students.enrollmentNumber}
             AND (mr.raw->>'StudentReferencesCode' ILIKE ${"%" + q + "%"}
                  OR mr.raw->>'AdmissionNo' ILIKE ${"%" + q + "%"})
        )`,
      )!,
    );
  }
  if (effectiveSchoolCode) conds.push(eq(students.schoolCode, effectiveSchoolCode));
  if (adminSchoolId && !effectiveSchoolCode) conds.push(eq(students.schoolId, adminSchoolId));
  if (f.grade) conds.push(eq(students.grade, f.grade));
  if (f.enabled === "1") conds.push(eq(students.enabled, true));
  if (f.enabled === "0") conds.push(eq(students.enabled, false));
  if (f.verified === "1") conds.push(eq(students.isVerified, true));
  if (f.verified === "0") conds.push(eq(students.isVerified, false));
  if (f.newStudent === "1") conds.push(eq(students.isNewStudent, true));
  if (f.newStudent === "0") conds.push(eq(students.isNewStudent, false));
  const recentDays: Record<string, number> = { "1d": 1, "7d": 7, "30d": 30, "90d": 90 };
  if (f.recent && f.recent in recentDays) {
    const days = recentDays[f.recent];
    conds.push(sql`${students.syncedAt} > now() - (${days}::int * INTERVAL '1 day')`);
  }

  // Only touch rows that actually change value, so `updated` is a true
  // count of flipped students and a re-run over the same filter set is a
  // cheap no-op rather than 24k pointless row versions.
  conds.push(eq(students.enabled, !parsed.enabled));

  // No empty-filter guard — disabling *everything* is the intended
  // headline use (site-wide lockout). The UI confirm shows the exact
  // count and demands a typed CONFIRM past 1000 rows.
  // school_admin stays scoped to their school via adminSchoolId above.
  const where = conds.length ? and(...conds) : undefined;

  // syncedAt is deliberately NOT bumped: it means "last seen from MCB/ERP"
  // and the /admin/students "recent" filter reads it. An access flip is an
  // Inventre-side decision, not a fresh sync.
  const result = await db
    .update(students)
    .set(
      // Enabling clears the site-closure mark for the same reason the
      // per-student checkbox does — a filtered re-admit is deliberate and
      // must not be re-restored when the master switch re-opens.
      parsed.enabled
        ? { enabled: true, disabledByClosure: false }
        : { enabled: false },
    )
    .where(where)
    .returning({ id: students.id });

  await invalidateCatalog();
  revalidatePath("/admin/students");

  await logActivity({
    actorId: guard.id,
    actorEmail: guard.email,
    action: "student.bulk_set_enabled",
    entityType: "student",
    entityId: null,
    summary: `Bulk ${parsed.enabled ? "enabled" : "disabled"} website access for ${result.length} students`,
    diff: { enabled: parsed.enabled, filters: f, count: result.length },
  });

  return NextResponse.json({ updated: result.length });
}
