import { NextResponse } from "next/server";
import { requirePermission, isResponse } from "@/lib/admin-guard";

/**
 * Sample CSV the admin downloads, fills, and re-uploads via the import
 * page. Headers must match the keys the import route's Zod schema expects
 * (camelCase) so the parser at /admin/students/import can post them
 * straight through without renaming.
 *
 * Grade column: type the **actual** grade you want shown — Nursery, LKG,
 * UKG, or "Grade 1" through "Grade 12". The import route stores the cell
 * verbatim (no ERP→Real -3 shift). One non-numeric example below to make
 * that obvious.
 */

const HEADERS = [
  "schoolCode",
  "enrollmentNumber",
  "firstName",
  "middleName",
  "lastName",
  "grade",
  "section",
  "gender",
  "studentEmail",
  "studentMobile",
  "dateOfBirth",
  "guardianName",
  "guardianMobile",
  "guardianEmail",
  "guardianRelation",
] as const;

const EXAMPLES: Record<(typeof HEADERS)[number], string>[] = [
  {
    schoolCode: "SMSAW",
    enrollmentNumber: "26SMS9999",
    firstName: "Aanya",
    middleName: "",
    lastName: "Sharma",
    grade: "Grade 5",
    section: "A",
    gender: "Female",
    studentEmail: "",
    studentMobile: "",
    dateOfBirth: "2015-06-12",
    guardianName: "Ravi Sharma",
    guardianMobile: "9876543210",
    guardianEmail: "ravi.sharma@example.com",
    guardianRelation: "Father",
  },
  {
    schoolCode: "KLINK",
    enrollmentNumber: "26KLI9999",
    firstName: "Rohan",
    middleName: "K",
    lastName: "Patel",
    // Non-numeric grade — proves the importer doesn't try to "convert" it.
    grade: "UKG",
    section: "B",
    gender: "Male",
    studentEmail: "",
    studentMobile: "",
    dateOfBirth: "",
    guardianName: "Meera Patel",
    guardianMobile: "9123456780",
    guardianEmail: "",
    guardianRelation: "Mother",
  },
];

function csvEscape(s: string): string {
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export async function GET() {
  const guard = await requirePermission("students.read");
  if (isResponse(guard)) return guard;

  const lines = [HEADERS.join(",")];
  for (const row of EXAMPLES) {
    lines.push(HEADERS.map((h) => csvEscape(row[h] ?? "")).join(","));
  }
  const csv = lines.join("\n") + "\n";

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition":
        'attachment; filename="students-bulk-import-template.csv"',
    },
  });
}
