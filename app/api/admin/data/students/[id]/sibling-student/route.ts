/**
 * POST /api/admin/data/students/[id]/sibling-student
 *
 * "Add a sibling" on the Relations tab now means "create a new student
 * under the same family". The new student inherits:
 *   - parent_id from the source student (the family link),
 *   - isVerified from the source (if a sibling is verified, this one is too),
 *   - schoolCode from the source by default (admin can override per-row),
 * and the source's full student_guardian_links roster is copied across so
 * the new student is reachable via the same set of guardian phones.
 *
 * Body:
 *   { fullName, gender, schoolCode?, grade?, section?, dateOfBirth? }
 *
 * enrollmentNumber and studentEmailId are intentionally left NULL —
 * those are added on the student's detail page once the admin has the
 * data. Both columns are nullable at the schema level.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { isResponse, requirePermission } from "@/lib/admin-guard";
import { logAdminActivity } from "@/lib/activity";
import { parseJson } from "@/lib/api-handler";
import { upsertGuardianLink } from "@/lib/repos/guardians";

const Body = z.object({
  fullName: z.string().min(1),
  gender: z.string().min(1),
  schoolCode: z.string().nullable().optional(),
  grade: z.string().nullable().optional(),
  section: z.string().nullable().optional(),
  dateOfBirth: z.string().nullable().optional(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requirePermission("students.write");
  if (isResponse(guard)) return guard;

  const { id: sourceStudentId } = await params;
  const body = await parseJson(req, Body);
  if (body instanceof NextResponse) return body;

  // Load the source student — supplies parent_id, default schoolCode,
  // and the guardian roster to copy.
  const [source] = await db
    .select()
    .from(schema.students)
    .where(eq(schema.students.id, sourceStudentId))
    .limit(1);
  if (!source) {
    return NextResponse.json({ error: "Source student not found" }, { status: 404 });
  }

  const schoolCode = body.schoolCode?.trim() || source.schoolCode || null;
  if (!schoolCode) {
    return NextResponse.json(
      { error: "School is required (source student has no school set)" },
      { status: 400 }
    );
  }
  const [school] = await db
    .select({ id: schema.schools.id })
    .from(schema.schools)
    .where(eq(schema.schools.schoolCode, schoolCode))
    .limit(1);
  if (!school) {
    return NextResponse.json(
      { error: `No school found for code "${schoolCode}"` },
      { status: 400 }
    );
  }

  // Best-effort name parse: first token → firstName, rest → lastName.
  // Always preserve the full trimmed string as students.name (notNull).
  const trimmed = body.fullName.trim();
  const tokens = trimmed.split(/\s+/);
  const firstName = tokens[0];
  const lastName = tokens.length > 1 ? tokens.slice(1).join(" ") : null;

  const grade = body.grade?.trim() || null;
  const section = body.section?.trim() || null;
  const dateOfBirth = body.dateOfBirth?.trim() || null;

  const [created] = await db
    .insert(schema.students)
    .values({
      schoolId: school.id,
      name: trimmed,
      // `class` is the shop-facing grade column read by lib/session.ts.
      // Keep it in sync with grade so the shop sees the new sibling
      // correctly without a separate update.
      class: grade,
      enabled: true,
      isNewStudent: false,
      isVerified: source.isVerified,
      schoolCode,
      firstName,
      lastName,
      grade,
      section,
      gender: body.gender,
      dateOfBirth,
      parentId: source.parentId,
    })
    .returning({ id: schema.students.id });

  // Copy the source's guardian-link rows onto the new sibling through
  // the phone-canonical helper. Each upsertGuardianLink call:
  //   • dedupes by (student, phone)
  //   • finds-or-creates the parents row by phone
  //   • attaches the new student to that parent
  //   • runs recomputeStudentParent
  // — so the roster transfer + family attachment + dedup all happen on
  // the canonical path. We only iterate distinct 10-digit phones from
  // the source (phoneless guardian rows aren't covered by the helper).
  if (source.parentId) {
    const sourceLinks = (await db.execute(sql`
      SELECT DISTINCT ON (right(regexp_replace(coalesce(phone_no, ''), '\D', '', 'g'), 10))
             right(regexp_replace(coalesce(phone_no, ''), '\D', '', 'g'), 10) AS n10,
             guardian_name, relation, email, guardian_erp_name
        FROM student_guardian_links
       WHERE student_id = ${sourceStudentId}
         AND length(right(regexp_replace(coalesce(phone_no, ''), '\D', '', 'g'), 10)) = 10
       ORDER BY right(regexp_replace(coalesce(phone_no, ''), '\D', '', 'g'), 10), row_idx ASC
    `)) as unknown as Array<{
      n10: string;
      guardian_name: string | null;
      relation: string | null;
      email: string | null;
      guardian_erp_name: string | null;
    }>;
    for (const link of sourceLinks) {
      await upsertGuardianLink({
        studentId: created.id,
        phone: link.n10,
        name: link.guardian_name,
        relation: link.relation,
        email: link.email,
        sourceGuardianErpName: link.guardian_erp_name,
      });
    }
  }

  void logAdminActivity(guard, {
    action: "student.sibling.add",
    entityType: "student",
    entityId: sourceStudentId,
    summary: `Added sibling ${trimmed}`,
    req,
  });

  return NextResponse.json({ id: created.id });
}
