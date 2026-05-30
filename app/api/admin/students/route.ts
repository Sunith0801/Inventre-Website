import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

// Translate Zod's terse default messages into something an admin can act on.
function humaniseZod(path: string, message: string): string {
  if (message === "Required") {
    if (path === "name") return "Enter the student's full name.";
    if (path === "schoolId") return "Choose the student's school.";
    return "This field is required.";
  }
  if (message.includes("Invalid uuid"))
    return "Choose a valid school from the list.";
  if (message.includes("Invalid email"))
    return "Enter a valid email address.";
  return message;
}
import { eq, ilike, or, and, count, asc, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { students, parents, schools } from "@/db/schema";
import { requirePermission, isResponse, assertSchoolAccess } from "@/lib/admin-guard";
import { logActivity } from "@/lib/activity";

const Body = z.object({
  // Student
  name: z.string().min(1),
  schoolId: z.string().uuid(),
  class: z.string().nullable().optional(),
  section: z.string().nullable().optional(),
  enrollmentNumber: z.string().nullable().optional(),
  // Guardian — optional. If guardianPhone is supplied, guardianName must be
  // too (validated below) and the phone must be 10 digits.
  guardianName: z.string().min(1).nullable().optional(),
  guardianPhone: z
    .string()
    .regex(/^\d{10}$/, "Mobile must be 10 digits")
    .nullable()
    .optional(),
  guardianEmail: z.string().email().nullable().optional(),
  guardianNotes: z.string().nullable().optional(),
});

export async function POST(req: Request) {
  const guard = await requirePermission("students.write");
  if (isResponse(guard)) return guard;

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch (e) {
    if (e instanceof z.ZodError) {
      // Structured per-field errors so the client can highlight inputs inline.
      const fields: Record<string, string> = {};
      for (const issue of e.issues) {
        const path = issue.path.join(".");
        if (path && !fields[path]) fields[path] = humaniseZod(path, issue.message);
      }
      return NextResponse.json(
        { error: "Please fix the highlighted fields.", fields },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const denied = assertSchoolAccess(guard, body.schoolId);
  if (denied) return denied;

  // Guardian is optional. Treat "any guardian field present" as a request to
  // attach a guardian — and in that case require name + phone together.
  const wantsGuardian = Boolean(
    body.guardianPhone || body.guardianName || body.guardianEmail || body.guardianNotes,
  );
  if (wantsGuardian) {
    if (!body.guardianName)
      return NextResponse.json(
        {
          error: "Please fix the highlighted fields.",
          fields: { guardianName: "Guardian name is required when guardian details are provided." },
        },
        { status: 400 },
      );
    if (!body.guardianPhone)
      return NextResponse.json(
        {
          error: "Please fix the highlighted fields.",
          fields: { guardianPhone: "Guardian mobile is required when guardian details are provided." },
        },
        { status: 400 },
      );
  }

  // 1) Find or create parent (guardian) by phone — upsert semantics. Only
  //    runs when the admin actually supplied guardian details.
  let parent: typeof parents.$inferSelect | undefined;
  let parentCreated = false;
  if (wantsGuardian && body.guardianPhone) {
    [parent] = await db
      .select()
      .from(parents)
      .where(eq(parents.phone, body.guardianPhone))
      .limit(1);

    if (!parent) {
      const { generateCustomerCode } = await import("@/lib/customer-numbering");
      const customerCode = await generateCustomerCode();
      [parent] = await db
        .insert(parents)
        .values({
          phone: body.guardianPhone,
          name: body.guardianName!,
          email: body.guardianEmail ?? null,
          notes: body.guardianNotes ?? null,
          customerCode,
          status: "active",
        })
        .returning();
      parentCreated = true;
    } else {
      const patch: Record<string, unknown> = {};
      if (!parent.name && body.guardianName) patch.name = body.guardianName;
      if (!parent.email && body.guardianEmail) patch.email = body.guardianEmail;
      if (Object.keys(patch).length > 0) {
        await db.update(parents).set(patch).where(eq(parents.id, parent.id));
      }
    }
  }

  // 2) Create the student, linked to the parent only if one was created/found.
  const [student] = await db
    .insert(students)
    .values({
      parentId: parent?.id ?? null,
      schoolId: body.schoolId,
      name: body.name,
      class: body.class ?? null,
      section: body.section ?? null,
      enrollmentNumber: body.enrollmentNumber ?? null,
      status: "active",
    })
    .returning();

  // 3) Audit-log the action so it shows up in /admin/activity.
  await logActivity({
    actorId: guard.id,
    actorEmail: guard.email,
    action: "student.create",
    entityType: "student",
    entityId: student.id,
    summary: parent
      ? `Created student "${student.name}" with guardian ${body.guardianName} (${body.guardianPhone})${parentCreated ? " (new parent)" : " (existing parent)"}`
      : `Created student "${student.name}" (no guardian)`,
    diff: { studentId: student.id, parentId: parent?.id ?? null, parentCreated },
  });

  return NextResponse.json({
    studentId: student.id,
    parentId: parent?.id ?? null,
    parentCreated,
    parentPhone: parent?.phone ?? null,
  });
}

const PAGE_SIZE = 150;

/**
 * GET — paginated student list for the /admin/students browser. Mirrors the
 * filter contract that page.tsx used to apply server-side, so the client
 * component can refetch rows on debounced input changes without re-rendering
 * the surrounding page.
 */
export async function GET(req: NextRequest) {
  const guard = await requirePermission("students.read");
  if (isResponse(guard)) return guard;

  const sp = req.nextUrl.searchParams;
  const q = sp.get("q") ?? undefined;
  const schoolCodeParam = sp.get("schoolCode") ?? undefined;
  const grade = sp.get("grade") ?? undefined;
  const enabled = sp.get("enabled") ?? undefined;
  const verified = sp.get("verified") ?? undefined;
  const newStudent = sp.get("newStudent") ?? undefined;
  const recent = sp.get("recent") ?? undefined;
  const page = Math.max(1, Number(sp.get("page") ?? "1") || 1);
  const offset = (page - 1) * PAGE_SIZE;

  // school_admin: always scoped to their school, schoolCode param is advisory.
  const adminSchoolId = guard.role === "school_admin" ? guard.schoolId : null;
  let effectiveSchoolCode = schoolCodeParam ?? null;
  if (adminSchoolId && !effectiveSchoolCode) {
    const [row] = await db
      .select({ code: schools.schoolCode })
      .from(schools)
      .where(eq(schools.id, adminSchoolId))
      .limit(1);
    effectiveSchoolCode = row?.code ?? null;
  }
  const schoolCode = effectiveSchoolCode ?? undefined;

  const conds = [];
  if (q)
    conds.push(
      or(
        ilike(students.firstName, `%${q}%`),
        ilike(students.enrollmentNumber, `%${q}%`),
        ilike(students.erpName, `%${q}%`),
        ilike(students.studentEmailId, `%${q}%`),
        ilike(students.studentMobileNumber, `%${q}%`),
        // Match by the school's friendly grade label so e.g. "Class 12"
        // finds students whose stored students.grade is "Grade 15".
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
  if (schoolCode) conds.push(eq(students.schoolCode, schoolCode));
  if (adminSchoolId && !schoolCode) conds.push(eq(students.schoolId, adminSchoolId));
  if (grade) conds.push(eq(students.grade, grade));
  if (enabled === "1") conds.push(eq(students.enabled, true));
  if (enabled === "0") conds.push(eq(students.enabled, false));
  if (verified === "1") conds.push(eq(students.isVerified, true));
  if (verified === "0") conds.push(eq(students.isVerified, false));
  if (newStudent === "1") conds.push(eq(students.isNewStudent, true));
  if (newStudent === "0") conds.push(eq(students.isNewStudent, false));
  const recentDays: Record<string, number> = { "1d": 1, "7d": 7, "30d": 30, "90d": 90 };
  if (recent && recent in recentDays) {
    const days = recentDays[recent];
    conds.push(sql`${students.syncedAt} > now() - (${days}::int * INTERVAL '1 day')`);
  }

  const where = conds.length ? and(...conds) : undefined;

  const [baseRows, totalRow] = await Promise.all([
    db
      .select({
        id: students.id,
        erpName: students.erpName,
        enabled: students.enabled,
        enrollmentNumber: students.enrollmentNumber,
        firstName: students.firstName,
        lastName: students.lastName,
        grade: students.grade,
        section: students.section,
        schoolCode: students.schoolCode,
        isVerified: students.isVerified,
        isNewStudent: students.isNewStudent,
        joiningDate: students.joiningDate,
        verifiedAt: students.verifiedAt,
        parentPhone: parents.phone,
        parentLastLoginAt: parents.lastLoginAt,
      })
      .from(students)
      .leftJoin(parents, eq(parents.id, students.parentId))
      .where(where)
      .orderBy(sql`${students.syncedAt} DESC NULLS LAST`, asc(students.enrollmentNumber))
      .limit(PAGE_SIZE)
      .offset(offset),
    db.select({ n: count() }).from(students).where(where),
  ]);

  // Flag which of the visible enrolments has an MCB grant (raw query —
  // mcb_students isn't in the drizzle schema).
  const enrolNos = baseRows
    .map((r) => r.enrollmentNumber)
    .filter((e): e is string => !!e);
  const grantedSet = new Set<string>();
  const refCodeMap = new Map<string, string>();
  if (enrolNos.length > 0) {
    const mcbRows = (await db.execute(sql`
      SELECT enrolment_number,
             website_access,
             COALESCE(raw->>'StudentReferencesCode', raw->>'AdmissionNo') AS ref_code
        FROM mcb_students
       WHERE enrolment_number IN (${sql.join(
         enrolNos.map((e) => sql`${e}`),
         sql`, `,
       )})
    `)) as unknown as { enrolment_number: string; website_access: boolean | null; ref_code: string | null }[];
    for (const m of mcbRows) {
      if (m.website_access) grantedSet.add(m.enrolment_number);
      if (m.ref_code) refCodeMap.set(m.enrolment_number, m.ref_code);
    }
  }
  const rows = baseRows.map((r) => ({
    ...r,
    mcbAccessGranted: r.enrollmentNumber ? grantedSet.has(r.enrollmentNumber) : false,
    referenceCode: r.enrollmentNumber ? refCodeMap.get(r.enrollmentNumber) ?? null : null,
  }));

  const total = Number(totalRow[0]?.n ?? 0);
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return NextResponse.json({
    rows,
    total,
    page,
    lastPage,
    pageSize: PAGE_SIZE,
  });
}
