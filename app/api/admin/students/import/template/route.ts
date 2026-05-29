import { NextResponse } from "next/server";
import { requireAdmin, isResponse } from "@/lib/admin-guard";

/**
 * Sample CSV the admin downloads, fills, and re-uploads via the import
 * page. Headers must match the keys the import route's Zod schema expects
 * (camelCase) so the parser at /admin/students/import can post them
 * straight through without renaming.
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
    grade: "Grade 3",
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
  const guard = await requireAdmin("super", "school_admin");
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
