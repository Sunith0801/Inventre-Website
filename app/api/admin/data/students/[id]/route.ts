import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { isResponse, requirePermission } from "@/server/admin-guard";
import { logAdminActivity, diffFields } from "@/server/activity";
import { parseJson } from "@/server/api-handler";
import { emitStudentEvent } from "@/server/erp-bridge";
import { invalidateCatalog } from "@/server/cache";
import { phone10NullableSchema } from "@/lib/phone";

const Patch = z.object({
  enabled: z.boolean().optional(),
  isNewStudent: z.boolean().optional(),
  schoolCode: z.string().min(1).optional(),
  enrollmentNumber: z.string().min(1).optional(),
  firstName: z.string().min(1).optional(),
  middleName: z.string().nullable().optional(),
  lastName: z.string().nullable().optional(),
  grade: z.string().nullable().optional(),
  section: z.string().nullable().optional(),
  joiningDate: z.string().nullable().optional(),
  houseColor: z.string().nullable().optional(),
  medium: z.string().nullable().optional(),
  curriculum: z.string().nullable().optional(),
  studentEmailId: z.string().min(1).optional(),
  studentMobileNumber: phone10NullableSchema.optional(),
  dateOfBirth: z.string().nullable().optional(),
  bloodGroup: z.string().nullable().optional(),
  gender: z.string().min(1).optional(),
  nationality: z.string().nullable().optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePermission("students.write");
  if (isResponse(guard)) return guard;
  const { id } = await params;
  const body = await parseJson(req, Patch);
  if (body instanceof NextResponse) return body;

  // Snapshot the row before applying the update so the activity log can
  // record per-field Old → New changes.
  const [before] = await db
    .select()
    .from(schema.students)
    .where(eq(schema.students.id, id))
    .limit(1);

  // Start with a blind copy of supplied ERP-mirror fields.
  const update: Record<string, unknown> = { syncedAt: new Date() };
  for (const [k, v] of Object.entries(body)) if (v !== undefined) update[k] = v;

  // Re-admitting a student by hand during a site-wide closure is a
  // deliberate exception, so drop the closure mark: when the store
  // re-opens, this row must not be "restored" a second time, and if a
  // later closure runs it should be marked fresh. See lib/site-access.ts.
  if (body.enabled === true) update.disabledByClosure = false;

  // The shop reads from a *different* set of columns than the admin editor
  // writes to:
  //   students.schoolId  ← derived from students.schoolCode
  //   students.name      ← derived from firstName + middleName + lastName
  //   students.class     ← duplicated from grade
  // Without these dual-writes, admin edits silently fail to reflect on the
  // shop (lib/session.ts:getCurrentUser uses the shop-facing columns).
  if (body.schoolCode !== undefined) {
    const [school] = await db
      .select({ id: schema.schools.id })
      .from(schema.schools)
      .where(eq(schema.schools.schoolCode, body.schoolCode))
      .limit(1);
    if (!school) {
      return NextResponse.json(
        { error: `No school found for code "${body.schoolCode}"` },
        { status: 400 },
      );
    }
    update.schoolId = school.id;
  }
  if (
    body.firstName !== undefined ||
    body.middleName !== undefined ||
    body.lastName !== undefined
  ) {
    // Recompute the composed `name` from the current row + supplied parts so
    // a PATCH that only updates lastName still yields a coherent full name.
    const [existing] = await db
      .select({
        firstName: schema.students.firstName,
        middleName: schema.students.middleName,
        lastName: schema.students.lastName,
      })
      .from(schema.students)
      .where(eq(schema.students.id, id))
      .limit(1);
    const first = body.firstName ?? existing?.firstName ?? "";
    const middle = body.middleName ?? existing?.middleName ?? "";
    const last = body.lastName ?? existing?.lastName ?? "";
    const composed = [first, middle, last]
      .filter((p): p is string => !!p && p.trim().length > 0)
      .join(" ")
      .trim();
    if (composed) update.name = composed;
  }
  if (body.grade !== undefined) {
    // The new admin picker emits Targeted-Grade values directly
    // (Nursery / LKG / UKG / Grade 1..12) — same vocab as products.
    // students.grade and students.class both hold the Targeted value so
    // the storefront filter (which joins on students.grade) and any
    // display that still reads `class` stay in sync.
    update.grade = body.grade;
    update.class = body.grade;
  }

  try {
    await db.update(schema.students).set(update).where(eq(schema.students.id, id));
  } catch (e) {
    // Postgres unique_violation (23505) on the partial unique index
    // students_school_enrolment_uq (school_id, enrollment_number). Fires
    // when the admin changes the school (or enrolment number) to a
    // combination already held by another student at that school — most
    // commonly when moving a student into a school where the same
    // enrolment number already belongs to a different child.
    const err = e as { code?: string; constraint?: string; message?: string };
    if (err?.code === "23505") {
      const isEnrolment =
        err.constraint === "students_school_enrolment_uq" ||
        /enrol/i.test(err.message ?? "");
      const msg = isEnrolment
        ? `Another student at this school already has enrolment number ${body.enrollmentNumber ?? "—"}. Use a different enrolment number, or pick a different school.`
        : "This change conflicts with an existing student record.";
      return NextResponse.json(
        {
          error: msg,
          details: isEnrolment
            ? [{ path: "enrollmentNumber", message: msg }]
            : undefined,
        },
        { status: 409 },
      );
    }
    // Anything else — surface the message instead of dropping a bare 500.
    return NextResponse.json(
      { error: err?.message ?? "Save failed" },
      { status: 500 },
    );
  }

  // Storefront surfaces filter products by the student's school, grade
  // and is_new_student flag. Flush every cache layer that surfaces those
  // — Redis catalog keys + Next.js router cache for the parent shop AND
  // the admin catalog preview — so the next request sees the new state.
  // School changes additionally invalidate the parent's cart on the next
  // read (lib/repos/cart.ts now drops items from the old school).
  if (
    body.grade !== undefined ||
    body.isNewStudent !== undefined ||
    body.schoolCode !== undefined
  ) {
    await invalidateCatalog();
  }

  // Verification is owned by the customer flows (register / first-time
  // sign-in). Admins can see it but never set or clear it here.

  revalidatePath("/admin/students");
  revalidatePath(`/admin/students/${id}`);
  void emitStudentEvent(id);

  if (before) {
    // Exclude the bookkeeping syncedAt timestamp from the diff so it
    // doesn't show up as a change on every save. Also drop `class` — it's an
    // internal mirror of `grade` (set together above), so logging it would
    // duplicate the Grade row with an identical Old → New.
    const { syncedAt: _syncedAt, class: _class, ...afterForDiff } = update;
    const changes = diffFields(
      before as unknown as Record<string, unknown>,
      afterForDiff,
      {
        enabled: "Enabled",
        isNewStudent: "New student",
        schoolCode: "School code",
        schoolId: "School",
        enrollmentNumber: "Enrollment number",
        firstName: "First name",
        middleName: "Middle name",
        lastName: "Last name",
        name: "Name",
        grade: "Grade",
        section: "Section",
        joiningDate: "Joining date",
        houseColor: "House colour",
        medium: "Medium",
        curriculum: "Curriculum",
        studentEmailId: "Student email",
        studentMobileNumber: "Student mobile",
        dateOfBirth: "Date of birth",
        bloodGroup: "Blood group",
        gender: "Gender",
        nationality: "Nationality",
      }
    );
    if (changes.length > 0) {
      void logAdminActivity(guard, {
        action: "student.update",
        entityType: "student",
        entityId: id,
        summary: `Updated ${changes.map((c) => c.label ?? c.field).join(", ")}`,
        changes,
        req,
      });
    }
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePermission("students.write");
  if (isResponse(guard)) return guard;
  const { id } = await params;

  // Capture an identifying field before the row is gone.
  const [before] = await db
    .select({ name: schema.students.name, enrollmentNumber: schema.students.enrollmentNumber })
    .from(schema.students)
    .where(eq(schema.students.id, id))
    .limit(1);

  await db.delete(schema.students).where(eq(schema.students.id, id));

  revalidatePath("/admin/students");
  revalidatePath(`/admin/students/${id}`);

  void logAdminActivity(guard, {
    action: "student.delete",
    entityType: "student",
    entityId: id,
    summary: `Deleted student ${before?.name ?? before?.enrollmentNumber ?? id}`,
    req,
  });

  return NextResponse.json({ ok: true });
}
