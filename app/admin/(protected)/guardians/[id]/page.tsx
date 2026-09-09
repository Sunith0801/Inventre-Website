import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db/client";
import { guardians, studentGuardianLinks, students } from "@/db/schema";
import { eq, asc } from "drizzle-orm";
import {
  PageHeader, Card, CardHeader, Th, Td, Tr, EmptyState,
} from "@/components/admin/ui/primitives";
import { GuardianEditor } from "@/components/admin/GuardianEditor";
import { RecordHistory } from "@/components/admin/RecordHistory";

export const dynamic = "force-dynamic";

export default async function GuardianDetailPage({
  params,
}: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [g] = await db.select().from(guardians).where(eq(guardians.id, id)).limit(1);
  if (!g) notFound();

  const linkedRaw = g.erpName
    ? await db
        .select({
          linkId: studentGuardianLinks.id,
          relation: studentGuardianLinks.relation,
          studentId: students.id,
          enrollment: students.enrollmentNumber,
          firstName: students.firstName,
          grade: students.grade,
          section: students.section,
          schoolCode: students.schoolCode,
        })
        .from(studentGuardianLinks)
        .innerJoin(students, eq(students.id, studentGuardianLinks.studentId))
        .where(eq(studentGuardianLinks.guardianErpName, g.erpName))
        .orderBy(asc(students.enrollmentNumber))
    : [];

  return (
    <div className="max-w-4xl">
      <PageHeader
        breadcrumb={[
          { label: "Guardians", href: "/admin/guardians" },
          { label: g.guardianName ?? "Guardian" },
        ]}
        eyebrow="Guardian"
        title={g.guardianName ?? "Guardian"}
        description={g.erpName ? <span className="font-mono text-[11px] text-ink-500">{g.erpName}</span> : null}
      />

      <Card className="mb-5">
        <CardHeader title="Contact details" description="Edit inline. Delete is destructive — student-guardian links by name remain, but the guardian master record will be gone." />
        <GuardianEditor
          mode="edit"
          guardianId={id}
          initial={{
            guardianName: g.guardianName ?? "",
            emailAddress: g.emailAddress ?? "",
            mobileNumber: g.mobileNumber ?? "",
            email: g.email ?? "",
            alternateNumber: g.alternateNumber ?? "",
            dateOfBirth: g.dateOfBirth ?? "",
          }}
        />
      </Card>

      <Card>
        <CardHeader title={`Linked students (${linkedRaw.length})`} description="Children or wards linked via the student's Relations tab." />
        {linkedRaw.length === 0 ? (
          <EmptyState title="No linked students" description="Open a student → Relations tab to link this guardian." />
        ) : (
          <table className="w-full text-[13px]">
            <thead><tr><Th>Enrollment</Th><Th>First Name</Th><Th>Grade</Th><Th>Section</Th><Th>School</Th><Th>Relation</Th></tr></thead>
            <tbody>{linkedRaw.map((s) => (
              <Tr key={s.linkId}>
                <Td><Link href={`/admin/students/${s.studentId}`} className="font-mono text-[11px] text-ink-700 hover:text-brand-700">{s.enrollment ?? "—"}</Link></Td>
                <Td><Link href={`/admin/students/${s.studentId}`} className="font-semibold text-ink-900 hover:text-brand-700">{s.firstName ?? "—"}</Link></Td>
                <Td muted>{s.grade ?? "—"}</Td>
                <Td muted>{s.section ?? "—"}</Td>
                <Td muted><span className="font-mono text-[11px]">{s.schoolCode ?? "—"}</span></Td>
                <Td>{s.relation ?? "—"}</Td>
              </Tr>
            ))}</tbody>
          </table>
        )}
      </Card>

      <div className="mt-5">
        <RecordHistory entityType="guardian" entityId={id} title="Guardian history" />
      </div>
    </div>
  );
}
