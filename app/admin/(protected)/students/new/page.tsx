import { db } from "@/db/client";
import { schools, grades, schoolGradeMappings } from "@/db/schema";
import { asc } from "drizzle-orm";
import { PageHeader, Card } from "@/components/admin/ui/primitives";
import { StudentEditor } from "@/components/admin/StudentEditor";

export const dynamic = "force-dynamic";

export default async function NewStudentPage() {
  const [schoolList, gradeList, mappingRows] = await Promise.all([
    db
      .select({
        id: schools.id,
        code: schools.schoolCode,
        name: schools.schoolName,
      })
      .from(schools)
      .orderBy(asc(schools.schoolName)),
    db
      .select({ name: grades.gradeName, erpName: grades.erpName })
      .from(grades)
      .orderBy(asc(grades.gradeName)),
    db
      .select({
        schoolId: schoolGradeMappings.schoolId,
        grade: schoolGradeMappings.grade,
        displayName: schoolGradeMappings.schoolGivenGradeName,
        sections: schoolGradeMappings.sections,
        rowIdx: schoolGradeMappings.rowIdx,
      })
      .from(schoolGradeMappings)
      .orderBy(asc(schoolGradeMappings.rowIdx)),
  ]);

  // Group grade-section mappings by school code (the form value the
  // StudentEditor stores). Same school can have multiple mapping rows for the
  // same canonical grade if the school splits sections across rows — we just
  // pick the first one we encounter (the row_idx ordering above gives the
  // school's preferred order).
  const idToCode = new Map(schoolList.map((s) => [s.id, s.code]));
  const gradesBySchool: Record<
    string,
    { grade: string; displayName: string | null; sections: string | null }[]
  > = {};
  for (const m of mappingRows) {
    if (!m.grade) continue;
    const code = idToCode.get(m.schoolId);
    if (!code) continue;
    (gradesBySchool[code] ??= []).push({
      grade: m.grade,
      displayName: m.displayName,
      sections: m.sections,
    });
  }

  return (
    <div className="max-w-5xl">
      <PageHeader
        breadcrumb={[{ label: "Students", href: "/admin/students" }, { label: "New student" }]}
        eyebrow="Student"
        title="Create a new student"
        description="Identity and personal details. Address, guardians and siblings can be added on the detail page after creation."
      />
      <Card>
        <StudentEditor
          mode="create"
          schoolCodes={schoolList.filter((s) => s.code).map((s) => ({ code: s.code!, name: s.name }))}
          gradeOptions={gradeList.map((g) => g.erpName ?? g.name ?? "").filter(Boolean)}
          gradesBySchool={gradesBySchool}
        />
      </Card>
    </div>
  );
}
