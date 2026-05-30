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

  // The recovery flow is "parent searching for their child" — so the
  // dropdown should only offer grades that ACTUALLY have students at
  // the picked school. We build the per-school grade set from
  // student_rows first, then attach the school's preferred label from
  // school_grade_mappings if available.
  const labelLookup = new Map<string, string>();
  for (const m of mappings) {
    labelLookup.set(`${m.school_code}::${m.grade}`, m.display_name?.trim() || m.grade);
  }
  const gradesBySchool: Record<string, { value: string; label: string }[]> = {};
  for (const r of studentRows) {
    const value = r.grade;
    const label = labelLookup.get(`${r.school_code}::${value}`) ?? value;
    (gradesBySchool[r.school_code] ??= []).push({ value, label });
  }
  // Canonical sort within each school.
  const canonicalIdx = (g: string) =>
    g === "Nursery" ? 0 : g === "LKG" ? 1 : g === "UKG" ? 2
      : 2 + (parseInt(g.match(/\d+/)?.[0] ?? "99", 10) || 99);
  for (const code of Object.keys(gradesBySchool)) {
    gradesBySchool[code].sort((a, b) => canonicalIdx(a.value) - canonicalIdx(b.value));
  }

  // Flat grade list (no-school-selected fallback). Canonical names only —
  // a single grade can have different display labels in different schools,
  // so there's no sensible label to pick without context.
  const grades = Array.from(
    new Set(studentRows.map((r) => r.grade))
  ).sort();

  return NextResponse.json({ schools, grades, gradesBySchool });
}
