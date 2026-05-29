import Link from "next/link";
import { db } from "@/db/client";
import { schools, students, schoolCoordinators } from "@/db/schema";
import { eq, sql, ilike, or, and } from "drizzle-orm";
import { Building2, Plus } from "lucide-react";
import {
  PageHeader, Card, Th, Td, Tr, Badge, EmptyState, SearchInput, Toolbar, FilterChips, Button,
} from "@/components/admin/ui/primitives";

export const dynamic = "force-dynamic";

const STATUS_OPTIONS = [
  { value: null, label: "All" },
  { value: "Active", label: "Active" },
  { value: "Inactive", label: "Inactive" },
];

export default async function SchoolsListPage({
  searchParams,
}: { searchParams: Promise<{ q?: string; status?: string }> }) {
  const { q, status } = await searchParams;
  const conds = [];
  if (q) conds.push(or(
    ilike(schools.schoolName, `%${q}%`),
    ilike(schools.schoolCode, `%${q}%`),
    ilike(schools.branchName, `%${q}%`),
    ilike(schools.erpName, `%${q}%`),
  )!);
  if (status) conds.push(eq(schools.status, status as "active" | "onboarding" | "paused"));

  const rows = await db
    .select({
      id: schools.id,
      erpName: schools.erpName,
      schoolCode: schools.schoolCode,
      schoolName: schools.schoolName,
      branchName: schools.branchName,
      status: schools.status,
      city: schools.city,
      state: schools.state,
      studentCount: sql<number>`(SELECT COUNT(*) FROM students WHERE school_code = ${schools.schoolCode})::int`,
      coordCount: sql<number>`(SELECT COUNT(*) FROM school_coordinators WHERE school_id = ${schools.id})::int`,
    })
    .from(schools)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(schools.schoolName);

  return (
    <div>
      <PageHeader
        eyebrow="Network"
        title="Schools"
        description={`${rows.length} school${rows.length === 1 ? "" : "s"}`}
        actions={
          <Link href="/admin/schools/new">
            <Button variant="primary" icon={<Plus className="h-3.5 w-3.5" />}>Add school</Button>
          </Link>
        }
      />
      <form method="GET">
        <Toolbar>
          <SearchInput defaultValue={q ?? ""} placeholder="Search by code, name, branch…" />
          <FilterChips
            options={STATUS_OPTIONS}
            value={status ?? null}
            baseHref="/admin/schools"
            paramName="status"
          />
          <Button type="submit" variant="secondary">Apply</Button>
        </Toolbar>
      </form>

      <Card padded={false}>
        {rows.length === 0 ? (
          <EmptyState icon={Building2} title="No schools yet" description="Click 'Add school' to create the first one." />
        ) : (
          <table className="w-full">
            <thead><tr>
              <Th>ID</Th>
              <Th>Code</Th>
              <Th>School Name</Th>
              <Th>Branch</Th>
              <Th>Status</Th>
              <Th>City</Th>
              <Th right>Coordinators</Th>
              <Th right>Students</Th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <Tr key={r.id}>
                  <Td><Link href={`/admin/schools/${r.id}`} className="font-mono text-[12px] text-ink-700 hover:text-brand-700">{r.erpName}</Link></Td>
                  <Td><span className="font-mono text-[11px] text-ink-600">{r.schoolCode ?? "—"}</span></Td>
                  <Td>
                    <Link href={`/admin/schools/${r.id}`} className="font-semibold text-ink-900 hover:text-brand-700">{r.schoolName ?? r.erpName}</Link>
                  </Td>
                  <Td muted>{r.branchName ?? "—"}</Td>
                  <Td>
                    <Badge tone={r.status === "active" ? "success" : "default"} dot size="sm">{r.status ?? "—"}</Badge>
                  </Td>
                  <Td muted>{r.city ?? "—"}</Td>
                  <Td right><span className="tabular-nums">{r.coordCount}</span></Td>
                  <Td right><span className="tabular-nums font-semibold">{r.studentCount}</span></Td>
                </Tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
