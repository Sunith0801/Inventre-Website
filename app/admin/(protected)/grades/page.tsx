import Link from "next/link";
import { db } from "@/db/client";
import { grades, students } from "@/db/schema";
import { ilike, or, eq, sql, and } from "drizzle-orm";
import { GraduationCap, Plus } from "lucide-react";
import {
  PageHeader, Card, Th, Td, Tr, Badge, EmptyState, SearchInput, Toolbar, FilterChips, Button,
} from "@/components/admin/ui/primitives";

export const dynamic = "force-dynamic";

const STATUS_OPTIONS = [
  { value: null, label: "All" },
  { value: "Active", label: "Active" },
  { value: "Inactive", label: "Inactive" },
];

export default async function GradesListPage({
  searchParams,
}: { searchParams: Promise<{ q?: string; status?: string }> }) {
  const { q, status } = await searchParams;
  const conds = [];
  if (q) conds.push(or(
    ilike(grades.gradeName, `%${q}%`),
    ilike(grades.erpName, `%${q}%`),
    ilike(grades.gradeCode, `%${q}%`),
  )!);
  if (status) conds.push(eq(grades.status, status));

  const rows = await db
    .select({
      id: grades.id,
      erpName: grades.erpName,
      gradeName: grades.gradeName,
      gradeCode: grades.gradeCode,
      status: grades.status,
      studentCount: sql<number>`(SELECT COUNT(*) FROM students WHERE grade = ${grades.erpName})::int`,
    })
    .from(grades)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(grades.gradeName);

  return (
    <div>
      <PageHeader
        eyebrow="Academic"
        title="Grades"
        description={`${rows.length} grade${rows.length === 1 ? "" : "s"}`}
        actions={
          <Link href="/admin/grades/new">
            <Button variant="primary" icon={<Plus className="h-3.5 w-3.5" />}>Add grade</Button>
          </Link>
        }
      />
      <form method="GET">
        <Toolbar>
          <SearchInput defaultValue={q ?? ""} placeholder="Search by name or code…" />
          <FilterChips options={STATUS_OPTIONS} value={status ?? null} baseHref="/admin/grades" paramName="status" />
          <Button type="submit" variant="secondary">Apply</Button>
        </Toolbar>
      </form>
      <Card padded={false}>
        {rows.length === 0 ? (
          <EmptyState icon={GraduationCap} title="No grades yet" description="Click 'Add grade' to create the first one." />
        ) : (
          <table className="w-full">
            <thead><tr><Th>Grade Name</Th><Th>Grade Code</Th><Th>Status</Th><Th right>Students</Th></tr></thead>
            <tbody>{rows.map((r) => (
              <Tr key={r.id}>
                <Td><Link href={`/admin/grades/${r.id}`} className="font-semibold text-ink-900 hover:text-brand-700">{r.gradeName ?? r.erpName}</Link></Td>
                <Td muted><span className="font-mono text-[11px]">{r.gradeCode ?? "—"}</span></Td>
                <Td><Badge tone={r.status === "Active" ? "success" : "default"} dot size="sm">{r.status ?? "—"}</Badge></Td>
                <Td right><span className="tabular-nums font-semibold">{r.studentCount}</span></Td>
              </Tr>
            ))}</tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
