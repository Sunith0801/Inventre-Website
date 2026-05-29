"use server";

import { db } from "@/db/client";
import { guardians, parents, schools, studentGuardianLinks, students } from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/session";
import {
  mcbBranchToSchoolCode,
  mcbGenderToLabel,
  mcbGradeToCanonical,
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
  return !schoolCode.toUpperCase().startsWith("CAS");
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

  const schoolCode = mcbBranchToSchoolCode(schoolName);
  if (!schoolCode) {
    return { ok: false, error: `No school mapping for "${schoolName}"` };
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

    // Upsert student by erpName (unique). Re-granting after a revoke flips
    // enabled back on instead of failing with a duplicate-key error.
    const existing = await tx
      .select({ id: students.id })
      .from(students)
      .where(eq(students.erpName, erpName))
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

      const [existingLink] = await tx
        .select({ id: studentGuardianLinks.id })
        .from(studentGuardianLinks)
        .where(
          and(
            eq(studentGuardianLinks.studentId, studentId),
            eq(studentGuardianLinks.guardianErpName, guardianErpName)
          )
        )
        .limit(1);
      if (existingLink) {
        await tx
          .update(studentGuardianLinks)
          .set({
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

    await tx.execute(sql`
      UPDATE mcb_students
      SET website_access = true,
          website_access_at = now(),
          website_access_by = ${me.email}
      WHERE enrolment_number = ${enrolmentNumber}
    `);
  });

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
      fd.set("grade", mcbGradeToCanonical(r.grade) ?? "");
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
  revalidatePath("/admin/mcb");
  return { ok: true };
}
