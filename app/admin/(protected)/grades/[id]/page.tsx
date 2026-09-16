import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db/client";
import { grades, students } from "@/db/schema";
import { eq, count } from "drizzle-orm";
import { PageHeader, Card, CardHeader, Badge, Stat } from "@/components/admin/ui/primitives";
import { GradeEditor } from "@/components/admin/GradeEditor";
import { RecordHistory } from "@/components/admin/RecordHistory";

export const dynamic = "force-dynamic";

export default async function GradeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [g] = await db.select().from(grades).where(eq(grades.id, id)).limit(1);
  if (!g) notFound();
  const gradeKey = g.erpName ?? g.gradeName ?? "";
  const [{ n }] = await db.select({ n: count() }).from(students).where(eq(students.grade, gradeKey));
  const studentCount = Number(n);
  const title = g.gradeName ?? g.erpName ?? "Grade";

  return (
    <div className="max-w-4xl">
      <PageHeader
        eyebrow="Catalog"
        breadcrumb={[{ label: "Grades", href: "/admin/grades" }, { label: title }]}
        title={title}
        description={
          <span className="mt-1 flex flex-wrap items-center gap-3 text-[13px]">
            <Badge tone={g.status === "Active" ? "success" : "default"} dot size="sm">{g.status ?? "—"}</Badge>
            {g.erpName && g.erpName !== g.gradeName ? <span className="font-mono text-[12px] text-ink-500">{g.erpName}</span> : null}
          </span>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:gap-4">
        <Link href={gradeKey ? `/admin/students?grade=${encodeURIComponent(gradeKey)}` : "/admin/students"} className="block rounded-2xl transition-shadow hover:shadow-md">
          <Stat label="Students" value={studentCount.toLocaleString("en-IN")} hint="Open in Students →" />
        </Link>
        <Stat label="Grade code" value={<span className="font-mono text-[20px]">{g.gradeCode ?? <span className="text-ink-300">—</span>}</span>} />
      </div>

      <Card>
        <CardHeader title="Grade details" />
        <GradeEditor mode="edit" gradeId={id} initial={{ gradeName: g.gradeName ?? "", gradeCode: g.gradeCode ?? "", status: (g.status === "Inactive" ? "Inactive" : "Active") as "Active" | "Inactive" }} />
      </Card>
      <div className="mt-5">
        <RecordHistory entityType="grade" entityId={id} title="Grade history" />
      </div>
    </div>
  );
}
