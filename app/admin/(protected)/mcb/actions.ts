"use server";

import { db } from "@/db/client";
import { guardians, parents, schools, studentGuardianLinks, students } from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { getCurrentUser } from "@/server/session";
import { logAdminActivity } from "@/server/activity";

/** Best-effort client IP for server actions (no Request object → read headers). */
async function clientIpFromHeaders(): Promise<string | null> {
  const h = await headers();
  const xff = h.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return h.get("x-real-ip") ?? null;
}
import {
  mcbBranchToSchoolCode,
  mcbBranchNeedsStudentLookup,
  mcbGenderToLabel,
  mcbGradeToCbse,
  targetedToMcbDisplay,
} from "@/lib/mcb/mappings";

type GrantResult = { ok: true } | { ok: false; error: string };

/**
 * Ops rule (2026-05-26): students whose enrolment number begins with "26"
 * are new admits for the 2026-27 academic year — at every school EXCEPT
 * the CAS family (CAS LR CBSE/CIE + CAS NIBM CBSE/CIE), which uses a
 * different enrolment-numbering convention. New admits get
 * `is_new_student = true` so the storefront routes them to the Magic-Box
 * catalog instead of the returning-student bookkit+uniform mix.
 *
 * Kept module-private because this file is "use server" — every export
 * from a server-actions module must be an async function. Non-async
 * helpers stay un-exported.
 */
function isNewStudentRule(
  enrollment: string | null | undefined,
  schoolCode: string | null | undefined
): boolean {
  if (!enrollment || !enrollment.startsWith("26")) return false;
  if (!schoolCode) return false;
  const sc = schoolCode.toUpperCase();
  // CAS and TTT schools don't ship Magic Boxes — every student there is
  // treated as returning so they see the full bookkit + uniform catalog
  // rather than an empty magic-box feed.
  if (sc.startsWith("CAS") || sc.startsWith("TTT")) return false;
  return true;
}

/**
 * Promote an MCB-cached student into the real `students` + `parents` tables
 * and flip `mcb_students.website_access=true`. After this, the parent can
 * OTP-log-in at /login and the student appears in /admin/students.
 */
export async function grantMcbAccess(formData: FormData): Promise<GrantResult> {
  const me = await getCurrentUser();
  if (!me || me.kind !== "admin") return { ok: false, error: "Not signed in" };

  const enrolmentNumber = String(formData.get("enrolment_number") || "").trim();
  const fullName = String(formData.get("full_name") || "").trim();
  const grade = String(formData.get("grade") || "").trim() || null;
  const section = String(formData.get("section") || "").trim() || null;
  const gender = String(formData.get("gender") || "").trim() || null;
  const mobile = String(formData.get("mobile") || "").trim();
  const email = String(formData.get("email") || "").trim() || null;
  const parentName = String(formData.get("parent_name") || "").trim() || null;
  const relationRaw = String(formData.get("relation") || "").trim();
  const relation = relationRaw || "Guardian";

  if (!enrolmentNumber) return { ok: false, error: "Missing enrolment number" };
  if (!fullName) return { ok: false, error: "Missing student name" };
  if (!mobile || !/^\d{10}$/.test(mobile)) {
    return { ok: false, error: "Mobile must be a 10-digit number" };
  }

  // Look up the MCB row to read school_name (the source of truth for which
  // branch this student belongs to).
  const mcbRowRes = await db.execute(sql`
    SELECT school_name FROM mcb_students WHERE enrolment_number = ${enrolmentNumber} LIMIT 1
  `);
  const mcbRow = (Array.isArray(mcbRowRes) ? mcbRowRes : (mcbRowRes as { rows?: unknown[] }).rows ?? [])[0] as
    | { school_name?: string }
    | undefined;
  const schoolName = mcbRow?.school_name;
  if (!schoolName) return { ok: false, error: "Student not found in MCB cache" };

  // Most branches map 1:1 to an Inventre school. The Crimson Anisha
  // campuses do not — one MCB branch spans CBSE, CIE and the pre-school —
  // so their school comes from the student's existing record, matched on
  // enrolment number. See lib/mcb/mappings.ts for why guessing is unsafe.
  let schoolCode: string | null;
  if (mcbBranchNeedsStudentLookup(schoolName)) {
    const [known] = await db
      .select({ code: schools.schoolCode })
      .from(students)
      .innerJoin(schools, eq(schools.id, students.schoolId))
      .where(eq(students.enrollmentNumber, enrolmentNumber))
      .limit(1);
    schoolCode = known?.code ?? null;
    if (!schoolCode) {
      return {
        ok: false,
        error:
          `${enrolmentNumber} has no existing Inventre record, and "${schoolName}" ` +
          `covers more than one school (CBSE / CIE / pre-school). MCB does not say ` +
          `which. Create the student against the right school first, then grant access.`,
      };
    }
  } else {
    schoolCode = mcbBranchToSchoolCode(schoolName);
    if (!schoolCode) {
      return { ok: false, error: `No school mapping for "${schoolName}"` };
    }
  }

  const [school] = await db
    .select({ id: schools.id })
    .from(schools)
    .where(eq(schools.schoolCode, schoolCode))
    .limit(1);
  if (!school) return { ok: false, error: `schools row missing for code ${schoolCode}` };

  const erpName = `MCB-${enrolmentNumber}`;

  await db.transaction(async (tx) => {
    // Find-or-create parent by phone. New rows are 'pending' + firstTimeLogin=true
    // so the first OTP login triggers the existing password-reset flow.
    let [parent] = await tx
      .select({ id: parents.id })
      .from(parents)
      .where(eq(parents.phone, mobile))
      .limit(1);
    if (!parent) {
      // status='active' so /api/auth/phone-status accepts the number;
      // firstTimeLogin=true gates them through /first-time OTP + password
      // setup before they can actually sign in.
      [parent] = await tx
        .insert(parents)
        .values({
          phone: mobile,
          name: parentName,
          email: email,
          status: "active",
          firstTimeLogin: true,
        })
        .returning({ id: parents.id });
    }

    // Upsert by (school_id, enrollment_number) — the natural key. Matching
    // by erpName previously caused a parallel `MCB-…` row when the same
    // student already existed via ERP/ADMIN import; the partial unique
    // index `students_school_enrolment_uq` makes that impossible now.
    const existing = await tx
      .select({ id: students.id })
      .from(students)
      .where(and(
        eq(students.enrollmentNumber, enrolmentNumber),
        eq(students.schoolId, school.id),
      ))
      .limit(1);

    const studentValues = {
      parentId: parent!.id,
      schoolId: school.id,
      name: fullName,
      firstName: fullName,
      enrollmentNumber: enrolmentNumber,
      schoolCode: schoolCode,
      grade: grade,
      section: section,
      gender: gender,
      studentMobileNumber: mobile,
      studentEmailId: email,
      enabled: true,
      status: "active" as const,
      isNewStudent: isNewStudentRule(enrolmentNumber, schoolCode),
      erpName: erpName,
      syncedAt: new Date(),
    };

    let studentId: string;
    if (existing[0]) {
      await tx.update(students).set(studentValues).where(eq(students.id, existing[0].id));
      studentId = existing[0].id;
    } else {
      const [inserted] = await tx
        .insert(students)
        .values(studentValues)
        .returning({ id: students.id });
      studentId = inserted!.id;
    }

    // Auto-create / reuse a guardians row keyed by mobile, then ensure a
    // student_guardian_links row joins this student to that guardian with
    // the supplied (or default "Guardian") relation. Re-granting after a
    // revoke is idempotent: we update the existing link in place.
    if (parentName || mobile) {
      const guardianErpName = `MCB-G-${mobile}`;
      let [guardian] = await tx
        .select({ id: guardians.id })
        .from(guardians)
        .where(eq(guardians.mobileNumber, mobile))
        .limit(1);
      if (!guardian) {
        [guardian] = await tx
          .insert(guardians)
          .values({
            erpName: guardianErpName,
            guardianName: parentName,
            mobileNumber: mobile,
            email: email,
            emailAddress: email,
          })
          .returning({ id: guardians.id });
      } else {
        // Keep the contact details fresh if MCB has newer info.
        await tx
          .update(guardians)
          .set({
            guardianName: parentName ?? sql`guardian_name`,
            email: email ?? sql`email`,
            emailAddress: email ?? sql`email_address`,
          })
          .where(eq(guardians.id, guardian.id));
      }

      // Look up the existing link by phone (10-digit normalised), NOT by
      // guardian_erp_name. The partial unique index
      // `student_guardian_links_unique_phone (student_id, right(10, phone_no))`
      // means a link already exists for this student+phone the moment the
      // student was created via an earlier ADMIN/ERP path (with
      // guardian_erp_name='ADMIN-…-G1'). Matching by erp_name would miss
      // that row and the subsequent INSERT would throw 23505.
      const [existingLink] = await tx
        .select({ id: studentGuardianLinks.id })
        .from(studentGuardianLinks)
        .where(
          and(
            eq(studentGuardianLinks.studentId, studentId),
            sql`right(regexp_replace(coalesce(${studentGuardianLinks.phoneNo}, ''), '\D', '', 'g'), 10) = ${mobile}`,
          )
        )
        .limit(1);
      if (existingLink) {
        // Re-point the existing link to the MCB-style guardian_erp_name so
        // future MCB-side lookups (and re-grants) find it directly.
        await tx
          .update(studentGuardianLinks)
          .set({
            guardianErpName,
            guardianName: parentName,
            relation,
            phoneNo: mobile,
            email,
          })
          .where(eq(studentGuardianLinks.id, existingLink.id));
      } else {
        await tx.insert(studentGuardianLinks).values({
          studentId,
          rowIdx: 0,
          guardianErpName,
          guardianName: parentName,
          relation,
          phoneNo: mobile,
          email,
        });
      }
    }

    // Ensure school_grade_mappings has a row for (this school, this grade)
    // so the storefront can render the MCB-friendly label (e.g. "Class 12")
    // instead of the internal Targeted vocabulary (e.g. "Grade 15") via
    // StudentBar's `schoolGivenGrade ?? grade` fallback. Idempotent — if a
    // row already exists for this (school, grade), we don't overwrite the
    // admin's existing label choice. WHERE NOT EXISTS rather than ON
    // CONFLICT because the underlying unique index is partial
    // (db/migrations/0023_school_grade_mappings_uq.sql).
    const displayLabel = targetedToMcbDisplay(grade);
    if (grade && displayLabel) {
      await tx.execute(sql`
        INSERT INTO school_grade_mappings
          (school_id, row_idx, grade, school_given_grade_name, sections, raw)
        SELECT ${school.id},
               COALESCE(
                 (SELECT MAX(row_idx) + 1 FROM school_grade_mappings WHERE school_id = ${school.id}),
                 0
               ),
               ${grade}, ${displayLabel}, NULL, NULL
         WHERE NOT EXISTS (
           SELECT 1 FROM school_grade_mappings
            WHERE school_id = ${school.id}
              AND lower(grade) = lower(${grade})
         )
      `);
    }

    await tx.execute(sql`
      UPDATE mcb_students
      SET website_access = true,
          website_access_at = now(),
          website_access_by = ${me.email}
      WHERE enrolment_number = ${enrolmentNumber}
    `);
  });

  // Audit trail — record WHO granted MyClassBoard website access against the
  // promoted student so it surfaces on the student's History tab.
  {
    const [stu] = await db
      .select({ id: students.id })
      .from(students)
      .where(eq(students.erpName, erpName))
      .limit(1);
    void logAdminActivity(me, {
      action: "student.mcb_access.grant",
      entityType: "student",
      entityId: stu?.id ?? null,
      summary: `Granted MyClassBoard website access (enrolment ${enrolmentNumber})`,
      remarks: fullName || null,
      ip: await clientIpFromHeaders(),
    });
  }

  revalidatePath("/admin/mcb");
  return { ok: true };
}

/**
 * Bulk-grant: take an array of enrolment numbers and grant each one with
 * defaults computed from `mcb_students.raw`. Skips rows already granted.
 * Returns counts so the UI can show "Granted N · Skipped M · Failed K".
 */
export async function bulkGrantMcbAccess(
  enrolmentNumbers: string[]
): Promise<{ granted: number; skipped: number; failed: number; errors: string[] }> {
  const me = await getCurrentUser();
  if (!me || me.kind !== "admin") {
    return { granted: 0, skipped: 0, failed: enrolmentNumbers.length, errors: ["Not signed in"] };
  }

  let granted = 0;
  let skipped = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const enrolment of enrolmentNumbers) {
    try {
      const rowRes = await db.execute(sql`
        SELECT enrolment_number, student_name, school_name, grade, section, website_access,
               raw->>'FullName' AS full_name,
               raw->>'FatherName' AS father_name,
               raw->>'MotherName' AS mother_name,
               raw->>'FatherPhone' AS father_phone,
               raw->>'MotherPhone' AS mother_phone,
               raw->>'FatherEmailID' AS father_email,
               raw->>'MotherEmailID' AS mother_email,
               raw->'Gender' AS gender_raw
        FROM mcb_students WHERE enrolment_number = ${enrolment} LIMIT 1
      `);
      const r = (Array.isArray(rowRes) ? rowRes : (rowRes as { rows?: unknown[] }).rows ?? [])[0] as
        | {
            enrolment_number: string;
            student_name: string | null;
            school_name: string | null;
            grade: string | null;
            section: string | null;
            website_access: boolean;
            full_name: string | null;
            father_name: string | null;
            mother_name: string | null;
            father_phone: string | null;
            mother_phone: string | null;
            father_email: string | null;
            mother_email: string | null;
            gender_raw: unknown;
          }
        | undefined;
      if (!r) {
        failed++;
        errors.push(`${enrolment}: not found in MCB cache`);
        continue;
      }
      if (r.website_access) {
        skipped++;
        continue;
      }
      const fatherMobile = (r.father_phone || "").replace(/\D/g, "").slice(-10);
      const motherMobile = (r.mother_phone || "").replace(/\D/g, "").slice(-10);
      const useFather = /^\d{10}$/.test(fatherMobile);
      const mobile = useFather ? fatherMobile : motherMobile;
      if (!mobile || !/^\d{10}$/.test(mobile)) {
        failed++;
        errors.push(`${enrolment}: no valid 10-digit mobile`);
        continue;
      }
      const guardianName = useFather
        ? (r.father_name || r.mother_name || "")
        : (r.mother_name || r.father_name || "");
      const relation = useFather && r.father_name
        ? "Father"
        : !useFather && r.mother_name
          ? "Mother"
          : "Guardian";
      const fd = new FormData();
      fd.set("enrolment_number", r.enrolment_number);
      fd.set("full_name", r.full_name || r.student_name || "");
      fd.set("grade", mcbGradeToCbse(r.grade) ?? "");
      fd.set("section", r.section ?? "");
      fd.set("gender", mcbGenderToLabel(r.gender_raw as boolean | string | null) ?? "");
      fd.set("mobile", mobile);
      fd.set("email", (useFather ? r.father_email : r.mother_email) || r.father_email || r.mother_email || "");
      fd.set("parent_name", guardianName);
      fd.set("relation", relation);
      const res = await grantMcbAccess(fd);
      if (res.ok) granted++;
      else {
        failed++;
        errors.push(`${enrolment}: ${res.error}`);
      }
    } catch (e: unknown) {
      failed++;
      errors.push(`${enrolment}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  revalidatePath("/admin/mcb");
  return { granted, skipped, failed, errors: errors.slice(0, 20) };
}

export async function revokeMcbAccess(formData: FormData): Promise<GrantResult> {
  const me = await getCurrentUser();
  if (!me || me.kind !== "admin") return { ok: false, error: "Not signed in" };
  const enrolmentNumber = String(formData.get("enrolment_number") || "").trim();
  if (!enrolmentNumber) return { ok: false, error: "Missing enrolment number" };

  const erpName = `MCB-${enrolmentNumber}`;
  await db.transaction(async (tx) => {
    await tx.update(students).set({ enabled: false }).where(eq(students.erpName, erpName));
    await tx.execute(sql`
      UPDATE mcb_students
      SET website_access = false,
          website_access_at = now(),
          website_access_by = ${me.email}
      WHERE enrolment_number = ${enrolmentNumber}
    `);
  });

  // Audit trail — record WHO revoked MyClassBoard website access.
  {
    const [stu] = await db
      .select({ id: students.id })
      .from(students)
      .where(eq(students.erpName, erpName))
      .limit(1);
    void logAdminActivity(me, {
      action: "student.mcb_access.revoke",
      entityType: "student",
      entityId: stu?.id ?? null,
      summary: `Revoked MyClassBoard website access (enrolment ${enrolmentNumber})`,
      ip: await clientIpFromHeaders(),
    });
  }

  revalidatePath("/admin/mcb");
  return { ok: true };
}
