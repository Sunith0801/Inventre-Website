import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  parents,
  students,
  schools,
} from "@/db/schema";
import { requirePermission, isResponse } from "@/lib/admin-guard";
import { upsertGuardianLink } from "@/lib/repos/guardians";
import { last10 } from "@/lib/phone";

/**
 * Bulk-import students from a CSV/Excel upload. Mirrors the fields the
 * one-off admin Student editor exposes so the resulting rows look
 * identical to a manually-created student — same columns set, same
 * verification flags, same guardian link.
 *
 * The frontend (admin/students/import page) parses the file (CSV or
 * XLSX) and POSTs row objects here. The school is resolved per row from
 * the `schoolCode` column so a single upload can mix grades and schools
 * (super-admin); a school_admin can only insert into their own school.
 *
 * The imported parent is set up so they can sign in immediately:
 *   - parents.first_time_login = true (default — triggers OTP + set-password)
 *   - students.enabled = true, is_verified = true, is_new_student = true
 *
 * Returns counts + a per-row error list so the admin can fix bad rows
 * and retry without losing the good ones.
 */

const ROW_LIMIT = 2000;

const Row = z.object({
  schoolCode: z.string().min(1, "schoolCode is required"),
  enrollmentNumber: z.string().min(1, "enrollmentNumber is required"),
  firstName: z.string().min(1, "firstName is required"),
  middleName: z.string().optional().nullable(),
  lastName: z.string().optional().nullable(),
  grade: z.string().min(1, "grade is required"),
  section: z.string().optional().nullable(),
  gender: z.string().optional().nullable(),
  studentEmail: z.string().optional().nullable(),
  studentMobile: z.string().optional().nullable(),
  dateOfBirth: z.string().optional().nullable(),
  guardianName: z.string().min(1, "guardianName is required"),
  guardianMobile: z.string().min(1, "guardianMobile is required"),
  guardianEmail: z.string().optional().nullable(),
  guardianRelation: z.string().optional().nullable(),
});
type ImportRow = z.infer<typeof Row>;

const Body = z.object({
  rows: z.array(z.unknown()).min(1).max(ROW_LIMIT),
});

type RowError = { row: number; message: string; data?: unknown };

export async function POST(req: Request) {
  const guard = await requirePermission("students.write");
  if (isResponse(guard)) return guard;

  let raw;
  try {
    raw = Body.parse(await req.json());
  } catch (e) {
    return NextResponse.json(
      { error: "Invalid request body", details: e instanceof Error ? e.message : "" },
      { status: 400 }
    );
  }

  const errors: RowError[] = [];
  const validRows: { idx: number; row: ImportRow }[] = [];
  raw.rows.forEach((r, i) => {
    const parsed = Row.safeParse(r);
    if (!parsed.success) {
      errors.push({
        row: i + 2, // human row number — +1 for zero-index, +1 for header
        message: parsed.error.issues
          .map((iss) => `${iss.path.join(".")}: ${iss.message}`)
          .join("; "),
        data: r,
      });
      return;
    }
    validRows.push({ idx: i + 2, row: parsed.data });
  });

  // Pre-resolve all distinct schools (one DB hit each instead of per row).
  const distinctSchoolCodes = Array.from(
    new Set(validRows.map((v) => v.row.schoolCode.trim()))
  );
  const schoolRows = await db
    .select({
      id: schools.id,
      schoolCode: schools.schoolCode,
    })
    .from(schools)
    .where(inArray(schools.schoolCode, distinctSchoolCodes));
  const schoolByCode = new Map(schoolRows.map((s) => [s.schoolCode!, s.id]));

  let inserted = 0;
  let skipped = 0;

  for (const { idx, row } of validRows) {
    try {
      const sc = row.schoolCode.trim();
      const schoolId = schoolByCode.get(sc);
      if (!schoolId) {
        errors.push({ row: idx, message: `Unknown schoolCode "${sc}"` });
        continue;
      }

      // school_admin can only import into their own school
      if (guard.role === "school_admin" && guard.schoolId !== schoolId) {
        errors.push({ row: idx, message: `school_admin cannot import into "${sc}"` });
        continue;
      }

      const guardianPhone = last10(row.guardianMobile);
      if (!guardianPhone) {
        errors.push({
          row: idx,
          message: `guardianMobile must be a 10-digit number (got "${row.guardianMobile}")`,
        });
        continue;
      }

      const enrollment = row.enrollmentNumber.trim();

      // Skip duplicates by (schoolCode, enrollmentNumber). Same rule the
      // ERP-sync adoption path uses, so re-running the import is safe.
      //
      // Hardened (2026-06-06): also match a STRAY-CHAR variant of the
      // enrollment. Real example: ERP imported "26CAG20012)" (trailing
      // paren) on May 18; a clean re-import later passed "26CAG20012",
      // didn't match the exact string, and inserted a duplicate row that
      // the (school_id, enrollment_number) unique index couldn't catch
      // because the two strings literally differ. Normalising via
      // regexp_replace catches paren / space / period / comma typos.
      const enrolNormalized = enrollment.replace(/[^A-Za-z0-9]/g, "");
      const [dupe] = await db
        .select({ id: students.id, name: students.name, enrollmentNumber: students.enrollmentNumber })
        .from(students)
        .where(
          and(
            eq(students.schoolCode, sc),
            sql`regexp_replace(${students.enrollmentNumber}, '[^A-Za-z0-9]', '', 'g') = ${enrolNormalized}`,
          )
        )
        .limit(1);
      if (dupe) {
        // If the stored enrollment was a typo variant (e.g. trailing
        // paren), heal it in place to the clean value the admin uploaded.
        if (dupe.enrollmentNumber !== enrollment) {
          await db.update(students)
            .set({ enrollmentNumber: enrollment })
            .where(eq(students.id, dupe.id));
        }
        skipped++;
        continue;
      }

      // Upsert the parent by normalised 10-digit phone.
      let [parent] = await db
        .select()
        .from(parents)
        .where(eq(parents.phone, guardianPhone))
        .limit(1);
      if (!parent) {
        [parent] = await db
          .insert(parents)
          .values({
            phone: guardianPhone,
            name: row.guardianName.trim(),
            email: row.guardianEmail?.trim() || null,
            status: "active",
            firstTimeLogin: true, // OTP + set-password on first sign-in
          })
          .returning();
      } else if (!parent.name && row.guardianName) {
        await db
          .update(parents)
          .set({ name: row.guardianName.trim() })
          .where(eq(parents.id, parent.id));
      }

      // Compose display name from parts (matches admin Student create path).
      const displayName = [row.firstName, row.middleName, row.lastName]
        .filter((p): p is string => !!p && p.trim().length > 0)
        .map((p) => p.trim())
        .join(" ");

      // students.erp_name is NOT NULL. Generate a synthetic key for
      // admin-imported rows so they don't collide with ERP-sync rows.
      // Format mirrors the ERP convention (`{enrollment}-{name}`) prefixed
      // with `ADMIN-` so the sync path can recognise & adopt the row.
      const erpName = `ADMIN-${sc}-${enrollment}-${displayName.slice(0, 40)}`;

      // Grade is stored exactly as the sheet says — no ERP→Real (-3) shift.
      // Per ops directive 2026-06-06: admins type the actual grade they want
      // shown (Nursery, LKG, UKG, Grade 1 … Grade 12) and that string lands
      // verbatim in both `students.grade` and `students.class`. The storefront
      // grade filter normalises both sides via `normalizeGrade()`, so a
      // sheet that says "Grade 5" matches `product_grades.grade = "Grade 5"`
      // directly. Data-entry discipline now lives with the sheet author.
      const grade = row.grade.trim();

      await db.insert(students).values({
        erpName,
        parentId: parent.id,
        schoolId,
        schoolCode: sc,
        enrollmentNumber: enrollment,
        firstName: row.firstName.trim(),
        middleName: row.middleName?.trim() || null,
        lastName: row.lastName?.trim() || null,
        name: displayName,
        class: row.grade.trim(),
        grade,
        section: row.section?.trim() || null,
        gender: row.gender?.trim() || null,
        studentEmailId: row.studentEmail?.trim() || null,
        studentMobileNumber: last10(row.studentMobile),
        dateOfBirth: row.dateOfBirth?.trim() || null,
        status: "active",
        enabled: true,
        isVerified: true,
        verifiedAt: new Date(),
        isNewStudent: true,
      });

      // Add a guardian link so the parent can recover this student
      // through the "Find your child" recovery flow and so the cart
      // grouping picks the right family.
      const [studentRow] = await db
        .select({ id: students.id })
        .from(students)
        .where(
          and(
            eq(students.schoolCode, sc),
            eq(students.enrollmentNumber, enrollment)
          )
        )
        .limit(1);
      if (studentRow) {
        // Phone is the canonical guardian key — see lib/repos/guardians.
        // upsertGuardianLink dedupes across re-imports and auto-attaches
        // the student to an existing parent if one exists on this phone.
        await upsertGuardianLink({
          studentId: studentRow.id,
          phone: guardianPhone,
          name: row.guardianName.trim(),
          relation: row.guardianRelation?.trim() || "Father",
          email: row.guardianEmail?.trim() || null,
          sourceGuardianErpName: `ADMIN-${sc}-${enrollment}-G1`,
        });
      }

      inserted++;
    } catch (e) {
      errors.push({
        row: idx,
        message: e instanceof Error ? e.message : String(e),
        data: row,
      });
    }
  }

  return NextResponse.json({
    inserted,
    skipped,
    failed: errors.length,
    errors: errors.slice(0, 100),
  });
}
