import { NextResponse, type NextRequest } from "next/server";
import { eq, ilike, or, and, asc, sql } from "drizzle-orm";
import * as XLSX from "xlsx";
import { db } from "@/db/client";
import { students, parents, schools } from "@/db/schema";
import { requirePermission, isResponse } from "@/server/admin-guard";

export const dynamic = "force-dynamic";

// Excel (.xlsx) export of /admin/students. Honours exactly the same filter
// contract as GET /api/admin/students (q / schoolCode / grade / enabled /
// verified / newStudent / recent) but emits EVERY matching row instead of one
// PAGE_SIZE slice — the point of an export is to escape the pagination the
// on-screen table imposes.
//
// Columns are deliberately narrow (Student ID, Name, School, Grade, Parent
// number, New/Existing) — this is the roster sheet schools ask for, not a
// dump of the admin table.

// Hard cap so a mis-filtered export can't try to stream the whole student
// master into one workbook.
const MAX_ROWS = 50_000;

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

  const rows = await db
    .select({
      enrollmentNumber: students.enrollmentNumber,
      // Some students carry TWO identifiers: the ERP enrolment number and the
      // school-side reference / admission code from MCB (e.g. AW250526 at the
      // SMS / SAS schools). When both exist the school recognises the
      // reference code, so that's what the Student ID column carries.
      referenceCode: sql<string | null>`(
        SELECT COALESCE(mr.raw->>'StudentReferencesCode', mr.raw->>'AdmissionNo')
          FROM mcb_students mr
         WHERE mr.enrolment_number = ${students.enrollmentNumber}
         LIMIT 1
      )`,
      erpName: students.erpName,
      firstName: students.firstName,
      lastName: students.lastName,
      grade: students.grade,
      section: students.section,
      schoolCode: students.schoolCode,
      schoolName: schools.name,
      isNewStudent: students.isNewStudent,
      parentPhone: parents.phone,
    })
    .from(students)
    .leftJoin(parents, eq(parents.id, students.parentId))
    .leftJoin(schools, eq(schools.id, students.schoolId))
    .where(where)
    .orderBy(
      asc(students.schoolCode),
      asc(students.grade),
      asc(students.enrollmentNumber),
    )
    .limit(MAX_ROWS);

  const header = [
    "Student ID",
    "Student Name",
    "School",
    "Grade",
    "Parent Number",
    "New / Existing",
  ];
  const aoa: (string | number)[][] = [header];
  for (const r of rows) {
    const studentId = r.referenceCode || r.enrollmentNumber || "";
    const name = [r.firstName, r.lastName].filter(Boolean).join(" ") || r.erpName || "";
    const school = r.schoolName
      ? r.schoolCode
        ? `${r.schoolCode} — ${r.schoolName}`
        : r.schoolName
      : (r.schoolCode ?? "");
    aoa.push([
      studentId,
      name,
      school,
      r.grade ?? "",
      r.parentPhone ?? "",
      r.isNewStudent ? "New" : "Existing",
    ]);
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [{ wch: 18 }, { wch: 28 }, { wch: 30 }, { wch: 10 }, { wch: 16 }, { wch: 14 }];
  if (aoa.length > 1) {
    ws["!autofilter"] = {
      ref: XLSX.utils.encode_range({
        s: { r: 0, c: 0 },
        e: { r: aoa.length - 1, c: header.length - 1 },
      }),
    };
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Students");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

  const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
  const parts = ["students"];
  if (schoolCode) parts.push(schoolCode);
  if (grade) parts.push(grade.replace(/\s+/g, "-"));
  if (newStudent === "1") parts.push("new");
  if (newStudent === "0") parts.push("existing");
  if (q || enabled || verified || recent) parts.push("filtered");
  parts.push(today);
  const filename = `${parts.join("_")}.xlsx`;

  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
