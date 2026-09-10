import Link from "next/link";
import { db } from "@/db/client";
import { schools, students, schoolCoordinators } from "@/db/schema";
import { eq, sql, ilike, or, and } from "drizzle-orm";
import { Building2, Plus } from "lucide-react";
import {
  PageHeader, Card, Td, Tr, Badge, EmptyState, SearchInput, Toolbar, FilterChips, Button,
} from "@/components/admin/ui/primitives";
import { redirect } from "next/navigation";
import { requireAnyPermission, isResponse, hasPermission } from "@/server/admin-guard";
import { SchoolRowActions } from "@/components/admin/SchoolRowActions";

export const dynamic = "force-dynamic";

// The school_status enum is `active | onboarding | paused`. URL values
// must match the enum exactly — labels are just for display.
const STATUS_OPTIONS = [
  { value: null, label: "All" },
  { value: "active", label: "Active" },
  { value: "onboarding", label: "Onboarding" },
  { value: "paused", label: "Inactive" },
];

export default async function SchoolsListPage({
  searchParams,
}: { searchParams: Promise<{ q?: string; status?: string }> }) {
  const guard = await requireAnyPermission("schools.read", "schools.write");
  if (isResponse(guard)) redirect("/admin/dashboard");
  const canWrite = hasPermission(guard, "schools.write");

  const { q, status } = await searchParams;
  const conds = [];
  if (q) conds.push(or(
    ilike(schools.schoolName, `%${q}%`),
    ilike(schools.schoolCode, `%${q}%`),
    ilike(schools.branchName, `%${q}%`),
    ilike(schools.erpName, `%${q}%`),
  )!);
  // Guard against stale/bookmarked URLs with old capitalised labels
  // ("Active"/"Inactive") — silently drop unknown values instead of
  // throwing a Postgres enum error.
  const validStatuses = ["active", "onboarding", "paused"] as const;
  type SchoolStatus = (typeof validStatuses)[number];
  const normStatus =
    status && (validStatuses as readonly string[]).includes(status)
      ? (status as SchoolStatus)
      : null;
  if (normStatus) conds.push(eq(schools.status, normStatus));

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
      // Drizzle's `sql` template drops the table qualifier when interpolating
      // a column, so `${schools.schoolCode}` becomes a bare `"school_code"`
      // that Postgres resolves to the INNER `students.school_code` — turning
      // the WHERE into a self-comparison that matches every row. Qualify the
      // outer ref explicitly to keep these correlated subqueries correct.
      studentCount: sql<number>`(SELECT COUNT(*) FROM students st WHERE st.school_code = "schools"."school_code")::int`,
      coordCount: sql<number>`(SELECT COUNT(*) FROM school_coordinators sc WHERE sc.school_id = "schools"."id")::int`,
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
          <table className="w-full text-[13.5px] border-collapse">
            <thead className="bg-gradient-to-r from-brand-50 via-cream-50 to-brand-50 border-b border-ink-200"><tr>
              <th className="px-3 py-3 text-left text-[12px] font-bold uppercase tracking-wider text-ink-800">ID</th>
              <th className="px-3 py-3 text-left text-[12px] font-bold uppercase tracking-wider text-ink-800">Code</th>
              <th className="px-3 py-3 text-left text-[12px] font-bold uppercase tracking-wider text-ink-800">School Name</th>
              <th className="px-3 py-3 text-left text-[12px] font-bold uppercase tracking-wider text-ink-800">Branch</th>
              <th className="px-3 py-3 text-left text-[12px] font-bold uppercase tracking-wider text-ink-800">Status</th>
              <th className="px-3 py-3 text-left text-[12px] font-bold uppercase tracking-wider text-ink-800">City</th>
              <th className="px-3 py-3 text-right text-[12px] font-bold uppercase tracking-wider text-ink-800">Coordinators</th>
              <th className="px-3 py-3 text-right text-[12px] font-bold uppercase tracking-wider text-ink-800">Students</th>
              {canWrite ? <th className="px-3 py-3 text-right text-[12px] font-bold uppercase tracking-wider text-ink-800">Actions</th> : null}
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <Tr key={r.id}>
                  <Td><Link href={`/admin/schools/${r.id}`} className="font-mono text-[12px] font-semibold text-ink-800 hover:text-brand-700">{r.erpName}</Link></Td>
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
                  {canWrite ? (
                    <Td right>
                      <SchoolRowActions schoolId={r.id} schoolLabel={r.schoolName ?? r.erpName ?? "this school"} />
                    </Td>
                  ) : null}
                </Tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
