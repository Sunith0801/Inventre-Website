import { notFound } from "next/navigation";
import { db } from "@/db/client";
import { grades, students } from "@/db/schema";
import { eq, sql, count } from "drizzle-orm";
import { PageHeader, Card, CardHeader, Badge } from "@/components/admin/ui/primitives";
import { GradeEditor } from "@/components/admin/GradeEditor";
import { RecordHistory } from "@/components/admin/RecordHistory";

export const dynamic = "force-dynamic";

export default async function GradeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [g] = await db.select().from(grades).where(eq(grades.id, id)).limit(1);
  if (!g) notFound();
  const [{ n }] = await db.select({ n: count() }).from(students).where(eq(students.grade, g.erpName ?? g.gradeName ?? ""));

  return (
    <div className="max-w-3xl">
      <PageHeader
        breadcrumb={[{ label: "Grades", href: "/admin/grades" }, { label: g.gradeName ?? g.erpName ?? "Grade" }]}
        eyebrow="Grade"
        title={g.gradeName ?? g.erpName ?? "Grade"}
        description={<span className="flex items-center gap-2"><Badge tone={g.status === "Active" ? "success" : "default"} dot size="sm">{g.status ?? "—"}</Badge><span className="text-ink-500">· {Number(n).toLocaleString()} student{Number(n) === 1 ? "" : "s"}</span></span>}
      />
      <Card>
        <CardHeader title="Edit grade" />
        <GradeEditor mode="edit" gradeId={id} initial={{ gradeName: g.gradeName ?? "", gradeCode: g.gradeCode ?? "", status: (g.status === "Inactive" ? "Inactive" : "Active") as "Active" | "Inactive" }} />
      </Card>
      <div className="mt-5">
        <RecordHistory entityType="grade" entityId={id} title="Grade history" />
      </div>
    </div>
  );
}
