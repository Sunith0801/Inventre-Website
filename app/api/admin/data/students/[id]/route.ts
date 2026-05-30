import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { isResponse, requirePermission } from "@/lib/admin-guard";
import { parseJson } from "@/lib/api-handler";
import { emitStudentEvent } from "@/lib/erp-bridge";
import { invalidateCatalog } from "@/lib/cache";
import { phone10NullableSchema } from "@/lib/phone";

const Patch = z.object({
  enabled: z.boolean().optional(),
  isNewStudent: z.boolean().optional(),
  isVerified: z.boolean().optional(),
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
  shoeSize: z.string().nullable().optional(),
  shirtSize: z.string().nullable().optional(),
  trouserSize: z.string().nullable().optional(),
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

  // Start with a blind copy of supplied ERP-mirror fields.
  const update: Record<string, unknown> = { syncedAt: new Date() };
  for (const [k, v] of Object.entries(body)) if (v !== undefined) update[k] = v;

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

  await db.update(schema.students).set(update).where(eq(schema.students.id, id));

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

  // When an admin un-verifies a student (isVerified=false), treat it as
  // "this account needs to go through first-time setup again": reset the
  // linked parent's first_time_login flag and clear their password so the
  // next sign-in forces OTP-verify + create-password.
  if (body.isVerified === false) {
    const [stu] = await db
      .select({ parentId: schema.students.parentId })
      .from(schema.students)
      .where(eq(schema.students.id, id))
      .limit(1);
    if (stu?.parentId) {
      await db
        .update(schema.parents)
        .set({ firstTimeLogin: true, passwordHash: null })
        .where(eq(schema.parents.id, stu.parentId));
    }
  }

  revalidatePath("/admin/students");
  revalidatePath(`/admin/students/${id}`);
  void emitStudentEvent(id);

  return NextResponse.json({ ok: true });
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePermission("students.write");
  if (isResponse(guard)) return guard;
  const { id } = await params;
  await db.delete(schema.students).where(eq(schema.students.id, id));

  revalidatePath("/admin/students");
  revalidatePath(`/admin/students/${id}`);

  return NextResponse.json({ ok: true });
}
