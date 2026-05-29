/**
 * Public dropdown data for the "forgot my mobile number" recovery flow.
 *
 * Mirrors /admin/students/new so parents see the school-given grade labels
 * (e.g. "Class I", "1st Std") instead of the canonical names
 * (e.g. "Grade 1"). Submitted value remains the canonical grade — that's
 * what students.grade stores and what /recover/search filters on.
 *
 *   GET → {
 *     schools: [{ code, name }],
 *     grades: [string],   // flat fallback if no school is selected
 *     gradesBySchool: {
 *       [schoolCode]: { value: string; label: string }[]
 *     },
 *   }
 */
import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { erpGradeToReal } from "@/lib/grade-translate";

function rows<T>(r: unknown): T[] {
  return r as unknown as T[];
}

export async function GET() {
  const schools = rows<{ code: string; name: string }>(
    await db.execute(sql`
      SELECT school_code AS code,
             COALESCE(NULLIF(school_name,''), NULLIF(name,''), school_code) AS name
      FROM schools
      WHERE status = 'active' AND school_code IS NOT NULL
      ORDER BY name
    `)
  );

  // Per-school mappings: canonical grade + school-given display label.
  // Same source the admin /students/new screen uses (school_grade_mappings).
  const mappings = rows<{
    school_code: string;
    grade: string;
    display_name: string | null;
    row_idx: number;
  }>(
    await db.execute(sql`
      SELECT s.school_code,
             m.grade,
             m.school_given_grade_name AS display_name,
             m.row_idx
      FROM school_grade_mappings m
      JOIN schools s ON s.id = m.school_id
      WHERE s.school_code IS NOT NULL AND m.grade IS NOT NULL AND m.grade <> ''
      ORDER BY s.school_code, m.row_idx
    `)
  );

  // Plus: any (school, grade) actually present in students but not in the
  // mappings table — added with no display label so something is still
  // selectable.
  const studentRows = rows<{ school_code: string; grade: string }>(
    await db.execute(sql`
      SELECT DISTINCT school_code, grade
      FROM students
      WHERE school_code IS NOT NULL AND school_code <> ''
        AND grade IS NOT NULL AND grade <> ''
    `)
  );

  const gradesBySchool: Record<string, { value: string; label: string }[]> = {};
  const seen: Record<string, Set<string>> = {};
  for (const m of mappings) {
    const code = m.school_code;
    // school_grade_mappings.grade is ERP-uniform vocab (Grade 1..15 with the
    // +3 offset). students.grade is Targeted vocab (Nursery/LKG/UKG/Grade
    // 1..12) — the admin StudentEditor translates on save. The recover
    // search filter compares against students.grade exactly, so the value
    // we submit from the picker must also be Targeted, otherwise the
    // dropdown's "Grade 12" silently posts "Grade 15" and finds nothing.
    const value = erpGradeToReal(m.grade) ?? m.grade;
    (gradesBySchool[code] ??= []).push({
      value,
      label: (m.display_name?.trim() || value),
    });
    (seen[code] ??= new Set()).add(value);
  }
  for (const r of studentRows) {
    if (seen[r.school_code]?.has(r.grade)) continue;
    (gradesBySchool[r.school_code] ??= []).push({
      value: r.grade,
      label: r.grade,
    });
    (seen[r.school_code] ??= new Set()).add(r.grade);
  }

  // Flat grade list (no-school-selected fallback). Canonical names only —
  // a single grade can have different display labels in different schools,
  // so there's no sensible label to pick without context.
  const grades = Array.from(
    new Set(studentRows.map((r) => r.grade))
  ).sort();

  return NextResponse.json({ schools, grades, gradesBySchool });
}
