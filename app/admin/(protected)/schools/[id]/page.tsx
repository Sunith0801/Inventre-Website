import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db/client";
import {
  schools, schoolGradeMappings, schoolCoordinators, schoolUniformMappings, students,
  productGrades,
} from "@/db/schema";
import { eq, sql, asc } from "drizzle-orm";
import { MapPin, Globe } from "lucide-react";
import {
  PageHeader, Card, CardHeader, Badge, Th, Td, Tr, EmptyState, Stat, Button,
} from "@/components/admin/ui/primitives";
import { Tabs, resolveTab } from "@/components/admin/ui/tabs";
import { SchoolEditor, CoordinatorEditor } from "@/components/admin/SchoolEditor";
import { SchoolGradeMappingEditor, UniformMappingEditor } from "@/components/admin/ChildTableEditors";
import { RecordHistory } from "@/components/admin/RecordHistory";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = { active: "Active", onboarding: "Onboarding", paused: "Inactive" };

export default async function SchoolDetailPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;

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

  const TABS = [
    { key: "details", label: "Details" },
    { key: "coordinators", label: "Coordinators", count: coordinators.length },
    { key: "grades", label: "Grades", count: gradeRows.length },
    { key: "skuMapping", label: "Uniform SKUs", count: uniformMaps.length },
    { key: "students", label: "Students", count: totalStudents },
  ];
  const tab = resolveTab(sp.tab, TABS);
  const title = school.schoolName ?? school.erpName ?? "School";
  const studentsHref = `/admin/students?schoolCode=${encodeURIComponent(school.schoolCode ?? "")}`;
  const place = [school.city, school.state].filter(Boolean).join(", ");

  return (
    <div>
      <PageHeader
        eyebrow="Catalog"
        breadcrumb={[{ label: "Schools", href: "/admin/schools" }, { label: title }]}
        title={title}
        description={
          <span className="mt-1 flex flex-wrap items-center gap-3 text-[13px]">
            <Badge tone={school.status === "active" ? "success" : school.status === "onboarding" ? "warning" : "default"} dot size="sm">
              {STATUS_LABEL[school.status ?? ""] ?? school.status ?? "—"}
            </Badge>
            <span className="font-mono text-[12px] text-ink-600">{school.schoolCode ?? "—"}</span>
            {school.branchName ? <span className="text-ink-600">{school.branchName}</span> : null}
            {place ? (
              <span className="inline-flex items-center gap-1 text-ink-600">
                <MapPin className="h-3.5 w-3.5" /> {place}
              </span>
            ) : null}
            {school.websiteUrl ? (
              <a href={school.websiteUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-ink-600 hover:text-brand-700">
                <Globe className="h-3.5 w-3.5" /> Website
              </a>
            ) : null}
          </span>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <Link href={studentsHref} className="block rounded-2xl transition-shadow hover:shadow-md">
          <Stat label="Students" value={totalStudents.toLocaleString("en-IN")} hint="Open in Students →" />
        </Link>
        <Link href={`/admin/schools/${id}?tab=coordinators`} className="block rounded-2xl transition-shadow hover:shadow-md">
          <Stat label="Coordinators" value={coordinators.length} />
        </Link>
        <Link href={`/admin/schools/${id}?tab=grades`} className="block rounded-2xl transition-shadow hover:shadow-md">
          <Stat label="Grades mapped" value={gradeRows.length} />
        </Link>
        <Link href={`/admin/schools/${id}?tab=skuMapping`} className="block rounded-2xl transition-shadow hover:shadow-md">
          <Stat label="Uniform SKUs" value={uniformMaps.length} />
        </Link>
      </div>

      <Tabs tabs={TABS} active={tab} hrefFor={(k) => `/admin/schools/${id}?tab=${k}`} className="mb-5" />

      {tab === "details" && (
        <Card>
          <CardHeader title="School details" description="Master record synced with ERPNext." />
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

      {tab === "coordinators" && (
        <Card padded={false} className="overflow-hidden">
          <div className="px-5 pt-5 lg:px-6">
            <CardHeader title="Coordinators" description="The school's points of contact for orders and deliveries." className="mb-3" />
          </div>
          <CoordinatorEditor schoolId={id} initial={coordinators.map((c) => ({ id: c.id, rowIdx: c.rowIdx, pocName: c.pocName, email: c.email, contactNumber: c.contactNumber, alternateNumber: c.alternateNumber, role: c.role }))} />
        </Card>
      )}

      {tab === "grades" && (
        <Card>
          <CardHeader title="Grade mappings" description="How the school names each grade, and which sections it runs. Parents see the school's name." />
          <SchoolGradeMappingEditor schoolId={id} standardGrades={standardGrades} initial={gradeRows.map((g) => ({ id: g.id, rowIdx: g.rowIdx, grade: g.grade, schoolGivenGradeName: g.schoolGivenGradeName, sections: g.sections }))} />
        </Card>
      )}

      {tab === "skuMapping" && (
        <Card>
          <CardHeader title="Uniform SKU mappings" description="Grade and section groups that share a uniform SKU." />
          <UniformMappingEditor schoolId={id} initial={uniformMaps.map((u) => ({ id: u.id, rowIdx: u.rowIdx, grade: u.grade, organisationGivenGrade: u.organisationGivenGrade, sections: u.sections, organisationGivenSection: u.organisationGivenSection, houseName: u.houseName }))} />
        </Card>
      )}

      {tab === "students" && (
        <Card padded={false} className="overflow-hidden">
          <div className="px-5 pt-5 lg:px-6">
            <CardHeader
              title="Students"
              description={totalStudents > studentRows.length ? `First ${studentRows.length} of ${totalStudents.toLocaleString("en-IN")}` : `${totalStudents} student${totalStudents === 1 ? "" : "s"}`}
              className="mb-3"
              actions={
                totalStudents > 0 ? (
                  <Link href={studentsHref}><Button variant="secondary" size="sm">Open in Students</Button></Link>
                ) : null
              }
            />
          </div>
          {studentRows.length === 0 ? (
            <EmptyState title="No students" description="Students appear here once they are synced or added for this school." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead><tr><Th>Student</Th><Th>Class</Th><Th>Joined</Th><Th>Verified</Th><Th>Status</Th></tr></thead>
                <tbody>{studentRows.map((s) => (
                  <Tr key={s.id}>
                    <Td>
                      <Link href={`/admin/students/${s.id}`} className="group/name block">
                        <span className="block font-semibold text-ink-900 group-hover/name:text-brand-700">{s.firstName ?? "—"}</span>
                        <span className="mt-0.5 block font-mono text-[11.5px] font-normal text-ink-500">{s.enrollmentNumber ?? "—"}</span>
                      </Link>
                    </Td>
                    <Td muted>{s.grade ?? "—"}{s.section ? ` · ${s.section}` : ""}</Td>
                    <Td muted>{s.joiningDate ?? "—"}</Td>
                    <Td>{s.isVerified ? <Badge tone="info" size="sm">Verified</Badge> : <span className="text-ink-300">—</span>}</Td>
                    <Td><Badge tone={s.enabled ? "success" : "default"} dot size="sm">{s.enabled ? "Enabled" : "Disabled"}</Badge></Td>
                  </Tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      <div className="mt-5">
        <RecordHistory entityType="school" entityId={id} title="School history" />
      </div>
    </div>
  );
}
