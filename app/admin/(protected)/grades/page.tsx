import Link from "next/link";
import { db } from "@/db/client";
import { grades } from "@/db/schema";
import { ilike, or, eq, sql, and } from "drizzle-orm";
import { GraduationCap, Plus } from "lucide-react";
import {
  PageHeader, Card, Th, Td, Tr, Badge, EmptyState, SearchInput, Toolbar, Button, FilterSelect,
} from "@/components/admin/ui/primitives";
import { redirect } from "next/navigation";
import { requireAnyPermission, isResponse } from "@/server/admin-guard";
import { AutoSubmitForm } from "@/components/admin/AutoSubmitForm";

export const dynamic = "force-dynamic";

const BASE = "/admin/grades";

// Nursery → LKG → UKG → Grade 1 … Grade 12; anything unparseable sorts last.
const gradeIdx = (name: string | null) => {
  const g = (name ?? "").trim();
  if (/^nursery/i.test(g)) return 0;
  if (/^lkg/i.test(g)) return 1;
  if (/^ukg/i.test(g)) return 2;
  const n = parseInt(g.match(/\d+/)?.[0] ?? "", 10);
  return Number.isNaN(n) ? 99 : 2 + n;
};

export default async function GradesListPage({
  searchParams,
}: { searchParams: Promise<{ q?: string; status?: string }> }) {
  const guard = await requireAnyPermission("grades.read", "grades.write");
  if (isResponse(guard)) redirect("/admin/dashboard");

  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const status = sp.status === "Active" || sp.status === "Inactive" ? sp.status : "";
  const conds = [];
  if (q) conds.push(or(
    ilike(grades.gradeName, `%${q}%`),
    ilike(grades.erpName, `%${q}%`),
    ilike(grades.gradeCode, `%${q}%`),
  )!);
  if (status) conds.push(eq(grades.status, status));

  const rows = (
    await db
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
  ).sort((a, b) => gradeIdx(a.gradeName ?? a.erpName) - gradeIdx(b.gradeName ?? b.erpName) || (a.gradeName ?? "").localeCompare(b.gradeName ?? ""));

  const hasFilter = !!(q || status);

  return (
    <div>
      <PageHeader
        eyebrow="Catalog"
        title="Grades"
        description={`${rows.length} grade${rows.length === 1 ? "" : "s"}${hasFilter ? " in this filter" : ""}`}
        actions={
          <Link href="/admin/grades/new">
            <Button variant="primary" icon={<Plus className="h-3.5 w-3.5" />}>Add grade</Button>
          </Link>
        }
      />
      <AutoSubmitForm action={BASE}>
        <Toolbar>
          <SearchInput defaultValue={q} placeholder="Search by name or code…" />
          <FilterSelect label="Status" name="status" defaultValue={status}>
            <option value="Active">Active</option>
            <option value="Inactive">Inactive</option>
          </FilterSelect>
          {hasFilter ? (
            <Link href={BASE} className="text-[12.5px] text-ink-500 hover:text-ink-900">Clear</Link>
          ) : null}
        </Toolbar>
      </AutoSubmitForm>
      <Card padded={false} className="overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState icon={GraduationCap} title={hasFilter ? "No grades match" : "No grades yet"} description={hasFilter ? "Try a different name or clear the filter." : "Click 'Add grade' to create the first one."} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr><Th>Grade</Th><Th>Grade code</Th><Th>Status</Th><Th right>Students</Th></tr></thead>
              <tbody>{rows.map((r) => (
                <Tr key={r.id}>
                  <Td>
                    <Link href={`/admin/grades/${r.id}`} className="group/name block">
                      <span className="block font-semibold text-ink-900 group-hover/name:text-brand-700">{r.gradeName ?? r.erpName}</span>
                      {r.erpName && r.erpName !== r.gradeName ? (
                        <span className="mt-0.5 block font-mono text-[11.5px] font-normal text-ink-500">{r.erpName}</span>
                      ) : null}
                    </Link>
                  </Td>
                  <Td muted><span className="font-mono">{r.gradeCode ?? "—"}</span></Td>
                  <Td><Badge tone={r.status === "Active" ? "success" : "default"} dot size="sm">{r.status ?? "—"}</Badge></Td>
                  <Td right>{r.studentCount ? r.studentCount.toLocaleString("en-IN") : <span className="text-ink-300">0</span>}</Td>
                </Tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
