import Link from "next/link";
import { db } from "@/db/client";
import { students, schools, grades, parents } from "@/db/schema";
import { ilike, or, eq, and, count, asc, sql } from "drizzle-orm";
import { Plus, Upload } from "lucide-react";
import { PageHeader, Button } from "@/components/admin/ui/primitives";
import { getCurrentUser } from "@/lib/session";
import { StudentsBrowser } from "./StudentsBrowser";
import { STUDENTS_PAGE_SIZE } from "./_constants";
import { redirect } from "next/navigation";
import { requireAnyPermission, isResponse } from "@/lib/admin-guard";

export const dynamic = "force-dynamic";

export default async function ErpStudentsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; schoolCode?: string; grade?: string; enabled?: string; verified?: string; newStudent?: string; recent?: string }>;
}) {
  const guard = await requireAnyPermission("students.read", "students.write");
  if (isResponse(guard)) redirect("/admin/dashboard");

  const [{ q, page: pageRaw, schoolCode: schoolCodeParam, grade, enabled, verified, newStudent, recent }, me] = await Promise.all([
    searchParams,
    getCurrentUser(),
  ]);

  const adminSchoolId = me?.kind === "admin" && me.role === "school_admin" ? me.schoolId : null;
  let effectiveSchoolCode = schoolCodeParam ?? null;
  if (adminSchoolId && !effectiveSchoolCode) {
    const [row] = await db.select({ code: schools.schoolCode }).from(schools).where(eq(schools.id, adminSchoolId)).limit(1);
    effectiveSchoolCode = row?.code ?? null;
  }
  const schoolCode = effectiveSchoolCode ?? undefined;
  const page = Math.max(1, Number(pageRaw ?? "1") || 1);
  const offset = (page - 1) * STUDENTS_PAGE_SIZE;

  const conds = [];
  if (q) conds.push(or(
    ilike(students.firstName, `%${q}%`),
    ilike(students.enrollmentNumber, `%${q}%`),
    ilike(students.erpName, `%${q}%`),
    ilike(students.studentEmailId, `%${q}%`),
    ilike(students.studentMobileNumber, `%${q}%`),
    // Match by the school's friendly grade label so e.g. "Class 12" finds
    // students whose stored students.grade is "Grade 15".
    sql`EXISTS (
      SELECT 1 FROM school_grade_mappings m
       WHERE m.school_id = ${students.schoolId}
         AND lower(m.grade) = lower(${students.grade})
         AND m.school_given_grade_name ILIKE ${"%" + q + "%"}
    )`,
    // Match by the MCB-cached "reference / admission" code so searches
    // like "AW250526" find the canonical merged row (25SMS0519). The
    // MCB dashboard displays this ref code for some schools, so it's
    // what admins copy from there into search.
    sql`EXISTS (
      SELECT 1 FROM mcb_students mr
       WHERE mr.enrolment_number = ${students.enrollmentNumber}
         AND (mr.raw->>'StudentReferencesCode' ILIKE ${"%" + q + "%"}
              OR mr.raw->>'AdmissionNo' ILIKE ${"%" + q + "%"})
    )`,
  )!);
  if (schoolCode) conds.push(eq(students.schoolCode, schoolCode));
  if (adminSchoolId && !schoolCode) conds.push(eq(students.schoolId, adminSchoolId));
  if (grade) conds.push(eq(students.grade, grade));
  if (enabled === "1") conds.push(eq(students.enabled, true));
  if (enabled === "0") conds.push(eq(students.enabled, false));
  if (verified === "1") conds.push(eq(students.isVerified, true));
  if (verified === "0") conds.push(eq(students.isVerified, false));
  if (newStudent === "1") conds.push(eq(students.isNewStudent, true));
  if (newStudent === "0") conds.push(eq(students.isNewStudent, false));
  // Quick "recent activity" filter: narrows to rows whose synced_at is
  // within the last N days. Useful for sweeping just-granted MCB
  // students (synced_at bumps on every grant).
  const recentDays: Record<string, number> = { "1d": 1, "7d": 7, "30d": 30, "90d": 90 };
  if (recent && recent in recentDays) {
    const days = recentDays[recent];
    conds.push(sql`${students.syncedAt} > now() - (${days}::int * INTERVAL '1 day')`);
  }

  const [baseRows, totalRow, schoolList, gradeBySchoolRows] = await Promise.all([
    db.select({
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
    }).from(students)
      .leftJoin(parents, eq(parents.id, students.parentId))
      .where(conds.length ? and(...conds) : undefined)
      // synced_at bumps to now() on every MCB grant — keeps just-granted
      // students at the top of page 1 so admins can verify the grant
      // landed without searching. Legacy rows without a sync timestamp
      // sort last; within the same tier we fall back to alphabetical.
      .orderBy(sql`${students.syncedAt} DESC NULLS LAST`, asc(students.enrollmentNumber))
      .limit(STUDENTS_PAGE_SIZE)
      .offset(offset),
    db.select({ n: count() }).from(students).where(conds.length ? and(...conds) : undefined),
    db.select({ code: schools.schoolCode, name: schools.schoolName }).from(schools).orderBy(asc(schools.schoolName)),
    // Grade list: when a school is selected, narrow to grades that have
    // actual students at THAT school. Without a school, fall back to the
    // canonical registry. Canonical sort (Nursery → LKG → UKG → 1..12).
    // Single fetch of grades-by-school so the client can swap on
    // school-filter change without an RSC round-trip.
    db.execute(sql`
      SELECT name, school_code FROM (
        SELECT DISTINCT s.grade AS name, s.school_code,
               CASE
                 WHEN s.grade = 'Nursery' THEN 0
                 WHEN s.grade = 'LKG'     THEN 1
                 WHEN s.grade = 'UKG'     THEN 2
                 ELSE 2 + COALESCE(NULLIF(regexp_replace(s.grade, '\\D', '', 'g'), '')::int, 99)
               END AS idx
          FROM students s
         WHERE s.grade IS NOT NULL AND s.enabled = true AND s.school_code IS NOT NULL
      ) t ORDER BY school_code, idx
    `).then((res) => (Array.isArray(res) ? res : (res as { rows?: unknown[] }).rows ?? []) as { name: string; school_code: string }[]),
  ]);
  const total = Number(totalRow[0]?.n ?? 0);
  const lastPage = Math.max(1, Math.ceil(total / STUDENTS_PAGE_SIZE));
  // Flag MCB-granted enrolments (raw — mcb_students not in drizzle schema).
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

  // Bucket grade-by-school for the client-side dropdown swap.
  const gradesBySchool: Record<string, string[]> = {};
  const allGradesSet = new Set<string>();
  for (const r of gradeBySchoolRows) {
    if (!r.school_code || !r.name) continue;
    (gradesBySchool[r.school_code] ??= []).push(r.name);
    allGradesSet.add(r.name);
  }
  const canonIdx = (g: string) =>
    g === "Nursery" ? 0 : g === "LKG" ? 1 : g === "UKG" ? 2 : 2 + (parseInt(g.match(/\d+/)?.[0] ?? "99", 10) || 99);
  const gradeList = Array.from(allGradesSet)
    .sort((a, b) => canonIdx(a) - canonIdx(b))
    .map((name) => ({ name }));

  return (
    <div>
      <PageHeader
        eyebrow="People"
        title="Students"
        description={`${total.toLocaleString()} student${total === 1 ? "" : "s"} matching current filters`}
        actions={
          <div className="flex items-center gap-2">
            <Link href="/admin/students/import">
              <Button variant="secondary" icon={<Upload className="h-3.5 w-3.5" />}>Bulk import</Button>
            </Link>
            <Link href="/admin/students/new">
              <Button variant="primary" icon={<Plus className="h-3.5 w-3.5" />}>Add student</Button>
            </Link>
          </div>
        }
      />
      <StudentsBrowser
        initial={{
          rows,
          total,
          page,
          lastPage,
          filters: {
            q: q ?? "",
            schoolCode: schoolCode ?? "",
            grade: grade ?? "",
            enabled: enabled ?? "",
            verified: verified ?? "",
            newStudent: newStudent ?? "",
            recent: recent ?? "",
            page,
          },
        }}
        schoolList={schoolList}
        gradeList={gradeList}
        gradesBySchool={gradesBySchool}
        lockedSchoolCode={adminSchoolId ? (effectiveSchoolCode ?? null) : null}
      />
    </div>
  );
}
