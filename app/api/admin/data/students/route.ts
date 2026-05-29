import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { requireAdmin, isResponse } from "@/lib/admin-guard";
import { parseJson } from "@/lib/api-handler";
import { emitStudentEvent } from "@/lib/erp-bridge";
import { invalidateCatalog } from "@/lib/cache";
import { phone10NullableSchema } from "@/lib/phone";

const Body = z.object({
  enabled: z.boolean().optional(),
  isNewStudent: z.boolean().optional(),
  isVerified: z.boolean().optional(),
  schoolCode: z.string().min(1),
  enrollmentNumber: z.string().min(1),
  firstName: z.string().min(1),
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
  studentEmailId: z.string().nullable().optional(),
  studentMobileNumber: phone10NullableSchema.optional(),
  dateOfBirth: z.string().nullable().optional(),
  bloodGroup: z.string().nullable().optional(),
  gender: z.string().min(1),
  nationality: z.string().nullable().optional(),
});

export async function POST(req: Request) {
  const guard = await requireAdmin("super", "ops");
  if (isResponse(guard)) return guard;
  const body = await parseJson(req, Body);
  if (body instanceof NextResponse) return body;

  // students.schoolId / students.name are NOT NULL. Resolve the school by its
  // ERP school code and compose a display name from the name parts.
  const [school] = await db
    .select({ id: schema.schools.id })
    .from(schema.schools)
    .where(eq(schema.schools.schoolCode, body.schoolCode))
    .limit(1);
  if (!school) {
    return NextResponse.json(
      { error: `No school found for code "${body.schoolCode}"` },
      { status: 400 }
    );
  }
  const name =
    [body.firstName, body.middleName, body.lastName]
      .filter((p): p is string => !!p && p.trim().length > 0)
      .join(" ")
      .trim() || body.firstName;

  // The admin picker emits Targeted-Grade values directly (Nursery / LKG
  // / UKG / Grade 1..12). Keep `grade` and `class` in lockstep so the
  // storefront filter (which joins on `grade`) and any legacy surface
  // reading `class` agree.
  const grade = body.grade ?? null;

  const [created] = await db
    .insert(schema.students)
    .values({
      schoolId: school.id,
      name,
      class: grade,
      enabled: body.enabled ?? true,
      isNewStudent: body.isNewStudent ?? false,
      isVerified: body.isVerified ?? false,
      schoolCode: body.schoolCode,
      enrollmentNumber: body.enrollmentNumber,
      firstName: body.firstName,
      middleName: body.middleName ?? null,
      lastName: body.lastName ?? null,
      grade,
      section: body.section ?? null,
      joiningDate: body.joiningDate ?? null,
      houseColor: body.houseColor ?? null,
      medium: body.medium ?? null,
      curriculum: body.curriculum ?? null,
      shoeSize: body.shoeSize ?? null,
      shirtSize: body.shirtSize ?? null,
      trouserSize: body.trouserSize ?? null,
      studentEmailId: body.studentEmailId ?? null,
      studentMobileNumber: body.studentMobileNumber ?? null,
      dateOfBirth: body.dateOfBirth ?? null,
      bloodGroup: body.bloodGroup ?? null,
      gender: body.gender,
      nationality: body.nationality ?? null,
    })
    .returning({ id: schema.students.id });

  // Bust the App Router cache so /admin/students (list) and the new
  // detail page render the fresh row without requiring a manual reload.
  revalidatePath("/admin/students");
  revalidatePath(`/admin/students/${created.id}`);
  // Bust storefront + admin-catalog caches so the parent shop reflects
  // the new student immediately.
  await invalidateCatalog();

  void emitStudentEvent(created.id);
  return NextResponse.json({ id: created.id });
}
