import Link from "next/link";
import { db } from "@/db/client";
import { students, schools, grades } from "@/db/schema";
import { ilike, or, eq, and, count, asc } from "drizzle-orm";
import { Plus, Upload } from "lucide-react";
import { PageHeader, Button } from "@/components/admin/ui/primitives";
import { getCurrentUser } from "@/lib/session";
import { StudentsBrowser } from "./StudentsBrowser";
import { STUDENTS_PAGE_SIZE } from "./_constants";

export const dynamic = "force-dynamic";

export default async function ErpStudentsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; schoolCode?: string; grade?: string; enabled?: string; verified?: string; newStudent?: string }>;
}) {
  const [{ q, page: pageRaw, schoolCode: schoolCodeParam, grade, enabled, verified, newStudent }, me] = await Promise.all([
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

  const [rows, totalRow, schoolList, gradeList] = await Promise.all([
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
    }).from(students).where(conds.length ? and(...conds) : undefined).orderBy(asc(students.enrollmentNumber)).limit(STUDENTS_PAGE_SIZE).offset(offset),
    db.select({ n: count() }).from(students).where(conds.length ? and(...conds) : undefined),
    db.select({ code: schools.schoolCode, name: schools.schoolName }).from(schools).orderBy(asc(schools.schoolName)),
    db.select({ name: grades.erpName }).from(grades).orderBy(asc(grades.erpName)),
  ]);
  const total = Number(totalRow[0]?.n ?? 0);
  const lastPage = Math.max(1, Math.ceil(total / STUDENTS_PAGE_SIZE));

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
            page,
          },
        }}
        schoolList={schoolList}
        gradeList={gradeList}
        lockedSchoolCode={adminSchoolId ? (effectiveSchoolCode ?? null) : null}
      />
    </div>
  );
}
