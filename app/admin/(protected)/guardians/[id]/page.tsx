import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db/client";
import { guardians, studentGuardianLinks, students, schools } from "@/db/schema";
import { eq, asc } from "drizzle-orm";
import { Phone, Mail, GraduationCap } from "lucide-react";
import {
  PageHeader, Card, CardHeader, Th, Td, Tr, EmptyState, Badge,
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

  const linked = g.erpName
    ? await db
        .select({
          linkId: studentGuardianLinks.id,
          relation: studentGuardianLinks.relation,
          studentId: students.id,
          enrollment: students.enrollmentNumber,
          firstName: students.firstName,
          grade: students.grade,
          section: students.section,
          schoolName: schools.schoolName,
          schoolCode: students.schoolCode,
          enabled: students.enabled,
        })
        .from(studentGuardianLinks)
        .innerJoin(students, eq(students.id, studentGuardianLinks.studentId))
        .leftJoin(schools, eq(schools.id, students.schoolId))
        .where(eq(studentGuardianLinks.guardianErpName, g.erpName))
        .orderBy(asc(students.enrollmentNumber))
    : [];

  const title = g.guardianName ?? "Guardian";

  return (
    <div>
      <PageHeader
        eyebrow="Customer Relationship (CRM)"
        breadcrumb={[{ label: "Guardians", href: "/admin/guardians" }, { label: title }]}
        title={title}
        description={
          <span className="mt-1 flex flex-wrap items-center gap-3 text-[13px]">
            {g.mobileNumber ? (
              <span className="inline-flex items-center gap-1 font-medium text-ink-700">
                <Phone className="h-3.5 w-3.5" /> <span className="font-mono">{g.mobileNumber}</span>
              </span>
            ) : null}
            {g.emailAddress ? (
              <span className="inline-flex items-center gap-1 font-medium text-ink-700">
                <Mail className="h-3.5 w-3.5" /> {g.emailAddress}
              </span>
            ) : null}
            {g.erpName ? <span className="font-mono text-[12px] text-ink-500">{g.erpName}</span> : null}
          </span>
        }
      />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-5">
        <Card className="xl:col-span-2">
          <CardHeader title="Contact details" description="Synced from ERPNext; edits here are pushed back on save." />
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

        <Card padded={false} className="overflow-hidden xl:col-span-3">
          <div className="px-5 pt-5 lg:px-6">
            <CardHeader title="Students" description={`${linked.length} linked to this guardian`} className="mb-3" />
          </div>
          {linked.length === 0 ? (
            <EmptyState icon={GraduationCap} title="No linked students" description="Open a student → Family tab to link this guardian." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead><tr><Th>Student</Th><Th>Class</Th><Th>School</Th><Th>Relation</Th><Th>Status</Th></tr></thead>
                <tbody>{linked.map((s) => (
                  <Tr key={s.linkId}>
                    <Td>
                      <Link href={`/admin/students/${s.studentId}`} className="group/name block">
                        <span className="block font-semibold text-ink-900 group-hover/name:text-brand-700">{s.firstName ?? "—"}</span>
                        <span className="mt-0.5 block font-mono text-[11.5px] font-normal text-ink-500">{s.enrollment ?? "—"}</span>
                      </Link>
                    </Td>
                    <Td muted>{s.grade ?? "—"}{s.section ? ` · ${s.section}` : ""}</Td>
                    <Td muted>{s.schoolName ?? s.schoolCode ?? "—"}</Td>
                    <Td muted>{s.relation ?? "—"}</Td>
                    <Td><Badge tone={s.enabled ? "success" : "default"} dot size="sm">{s.enabled ? "Enabled" : "Disabled"}</Badge></Td>
                  </Tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <div className="mt-5">
        <RecordHistory entityType="guardian" entityId={id} title="Guardian history" />
      </div>
    </div>
  );
}
