import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db/client";
import {
  schools, schoolGradeMappings, schoolCoordinators, schoolUniformMappings, students,
  productGrades,
} from "@/db/schema";
import { eq, sql, asc } from "drizzle-orm";
import {
  PageHeader, Card, CardHeader, Badge, Th, Td, Tr, EmptyState,
} from "@/components/admin/ui/primitives";
import { SchoolEditor, CoordinatorEditor } from "@/components/admin/SchoolEditor";
import { SchoolGradeMappingEditor, UniformMappingEditor } from "@/components/admin/ChildTableEditors";

export const dynamic = "force-dynamic";

type Tab = "details" | "coordinators" | "grades" | "skuMapping" | "students" | "dashboard";

function tabHref(id: string, tab: Tab) {
  return `/admin/schools/${id}?tab=${tab}`;
}

export default async function SchoolDetailPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: Tab }>;
}) {
  const { id } = await params;
  const { tab = "details" } = await searchParams;

  const [school] = await db.select().from(schools).where(eq(schools.id, id)).limit(1);
  if (!school) notFound();

  const [gradeRows, coordinators, uniformMaps, studentRows, studentCount] = await Promise.all([
    db.select().from(schoolGradeMappings).where(eq(schoolGradeMappings.schoolId, id)).orderBy(asc(schoolGradeMappings.rowIdx)),
    db.select().from(schoolCoordinators).where(eq(schoolCoordinators.schoolId, id)).orderBy(asc(schoolCoordinators.rowIdx)),
    db.select().from(schoolUniformMappings).where(eq(schoolUniformMappings.schoolId, id)).orderBy(asc(schoolUniformMappings.rowIdx)),
    school.schoolCode
      ? db.select({ id: students.id, enrollmentNumber: students.enrollmentNumber, firstName: students.firstName, grade: students.grade, section: students.section, enabled: students.enabled, isVerified: students.isVerified, joiningDate: students.joiningDate })
          .from(students).where(eq(students.schoolCode, school.schoolCode)).orderBy(asc(students.enrollmentNumber)).limit(50)
      : Promise.resolve([] as { id: string; enrollmentNumber: string | null; firstName: string | null; grade: string | null; section: string | null; enabled: boolean; isVerified: boolean; joiningDate: string | null }[]),
    school.schoolCode
      ? db.select({ n: sql<number>`COUNT(*)::int` }).from(students).where(eq(students.schoolCode, school.schoolCode))
      : Promise.resolve([{ n: 0 }] as { n: number }[]),
  ]);

  const totalStudents = studentCount[0]?.n ?? 0;

  // Standard grade list for the Grades tab dropdown.
  const standardGrades = (
    await db.selectDistinct({ grade: productGrades.grade }).from(productGrades)
  )
    .map((g) => g.grade)
    .sort((a, b) => {
      const na = parseInt(a.match(/\d+/)?.[0] ?? ""),
        nb = parseInt(b.match(/\d+/)?.[0] ?? "");
      if (!isNaN(na) && !isNaN(nb) && na !== nb) return na - nb;
      return a.localeCompare(b);
    });

  return (
    <div className="max-w-6xl">
      <PageHeader
        breadcrumb={[
          { label: "Schools", href: "/admin/schools" },
          { label: school.schoolName ?? school.erpName ?? "School" },
        ]}
        eyebrow="School"
        title={school.schoolName ?? school.erpName ?? "School"}
        description={
          <span className="flex items-center gap-2 flex-wrap">
            <Badge tone={school.status === "active" ? "success" : "default"} dot size="sm">{school.status ?? "—"}</Badge>
            <span className="font-mono text-[11px] text-ink-500">{school.schoolCode ?? "—"}</span>
            <span className="text-ink-500">· {school.branchName ?? "—"}</span>
          </span>
        }
      />

      <div className="flex items-center gap-1 mb-5 border-b border-ink-100/70 overflow-x-auto">
        {([
          { id: "details" as const, label: "Details" },
          { id: "dashboard" as const, label: "Dashboard" },
          { id: "coordinators" as const, label: `Coordinators (${coordinators.length})` },
          { id: "grades" as const, label: `Grades (${gradeRows.length})` },
          { id: "skuMapping" as const, label: `SKU Mapping (${uniformMaps.length})` },
          { id: "students" as const, label: `Students (${totalStudents})` },
        ]).map((t) => (
          <Link key={t.id} href={tabHref(id, t.id)}
            className={`px-3 py-2 text-[13px] -mb-px border-b-2 whitespace-nowrap ${tab === t.id ? "border-brand-600 text-ink-900 font-semibold" : "border-transparent text-ink-500 hover:text-ink-800"}`}>
            {t.label}
          </Link>
        ))}
      </div>

      {tab === "details" && (
        <Card>
          <CardHeader title="School details" description="All fields are editable. Coordinators live on their own tab." />
          <SchoolEditor
            mode="edit"
            schoolId={id}
            initial={{
              schoolCode: school.schoolCode ?? "",
              schoolName: school.schoolName ?? "",
              branchName: school.branchName ?? "",
              websiteUrl: school.websiteUrl ?? "",
              status: (school.status === "active" ? "Active" : "Inactive") as "Active" | "Inactive",
              schoolLogoUrl: school.schoolLogoUrl ?? "",
              street: school.street ?? "",
              city: school.city ?? "",
              state: school.state ?? "",
              country: school.country ?? "",
              pincode: school.pincode ?? "",
              uniformDetailsCheckbox: school.uniformDetailsCheckbox,
              booksDetailsCheckbox: school.booksDetailsCheckbox,
            }}
          />
        </Card>
      )}

      {tab === "dashboard" && (
        <Card>
          <CardHeader title="All-time summary" />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-[13px]">
            <Stat label="Total Students" value={totalStudents} />
            <Stat label="Coordinators" value={coordinators.length} />
            <Stat label="Grades configured" value={gradeRows.length} />
            <Stat label="Uniform mappings" value={uniformMaps.length} />
          </div>
        </Card>
      )}

      {tab === "coordinators" && (
        <Card>
          <CardHeader title="School coordinators" description="Add the people you contact at this school. Type into the bottom row and click Add. Click the trash icon to remove a row." />
          <CoordinatorEditor schoolId={id} initial={coordinators.map((c) => ({ id: c.id, rowIdx: c.rowIdx, pocName: c.pocName, email: c.email, contactNumber: c.contactNumber, alternateNumber: c.alternateNumber, role: c.role }))} />
        </Card>
      )}

      {tab === "grades" && (
        <Card>
          <CardHeader title="Grade × section mappings" description="Configure which grades this school runs and the section labels they use. Type into the bottom row and click Add to insert; trash icon to remove." />
          <SchoolGradeMappingEditor schoolId={id} standardGrades={standardGrades} initial={gradeRows.map((g) => ({ id: g.id, rowIdx: g.rowIdx, grade: g.grade, schoolGivenGradeName: g.schoolGivenGradeName, sections: g.sections }))} />
        </Card>
      )}

      {tab === "skuMapping" && (
        <Card>
          <CardHeader title="Uniform SKU mappings" description="Maps each grade × section × house combination at this school. Used by item-attribute resolution and pricing." />
          <UniformMappingEditor schoolId={id} initial={uniformMaps.map((u) => ({ id: u.id, rowIdx: u.rowIdx, grade: u.grade, organisationGivenGrade: u.organisationGivenGrade, sections: u.sections, organisationGivenSection: u.organisationGivenSection, houseName: u.houseName }))} />
        </Card>
      )}

      {tab === "students" && (
        <Card padded={false}>
          {studentRows.length === 0 ? (
            <EmptyState title="No students" description={totalStudents === 0 ? "Add students from the Students page." : "Open the full students list."} />
          ) : (
            <>
              <table className="w-full text-[13px]">
                <thead><tr><Th>Enrollment</Th><Th>First Name</Th><Th>Grade</Th><Th>Section</Th><Th>Joining Date</Th><Th>Status</Th></tr></thead>
                <tbody>{studentRows.map((s) => (
                  <Tr key={s.id}>
                    <Td><Link href={`/admin/students/${s.id}`} className="font-mono text-[11px] text-ink-700 hover:text-brand-700">{s.enrollmentNumber ?? "—"}</Link></Td>
                    <Td>{s.firstName ?? "—"}</Td>
                    <Td muted>{s.grade ?? "—"}</Td>
                    <Td muted>{s.section ?? "—"}</Td>
                    <Td muted>{s.joiningDate ?? "—"}</Td>
                    <Td><Badge tone={s.enabled ? "success" : "default"} size="sm">{s.enabled ? "Enabled" : "Disabled"}</Badge></Td>
                  </Tr>
                ))}</tbody>
              </table>
              {totalStudents > studentRows.length ? (
                <div className="p-3 text-[12px] text-ink-500 border-t border-ink-100/70">
                  Showing first {studentRows.length} of {totalStudents}. Open the <Link href={`/admin/students?schoolCode=${school.schoolCode}`} className="text-brand-700 hover:underline">full students list</Link>.
                </div>
              ) : null}
            </>
          )}
        </Card>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="p-4 rounded-xl bg-cream-50/50 border border-ink-100/70">
      <div className="text-[11px] uppercase tracking-wide text-ink-500 mb-1">{label}</div>
      <div className="text-2xl font-semibold tabular-nums text-ink-900">{value}</div>
    </div>
  );
}
