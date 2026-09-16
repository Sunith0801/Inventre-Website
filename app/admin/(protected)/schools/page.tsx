import Link from "next/link";
import { db } from "@/db/client";
import { schools } from "@/db/schema";
import { eq, sql, ilike, or, and } from "drizzle-orm";
import { Building2, Plus } from "lucide-react";
import {
  PageHeader, Card, Th, Td, Tr, Badge, EmptyState, SearchInput, Toolbar, Button, FilterSelect,
} from "@/components/admin/ui/primitives";
import { redirect } from "next/navigation";
import { requireAnyPermission, isResponse, hasPermission } from "@/server/admin-guard";
import { SchoolRowActions } from "@/components/admin/SchoolRowActions";
import { AutoSubmitForm } from "@/components/admin/AutoSubmitForm";

export const dynamic = "force-dynamic";

const BASE = "/admin/schools";

// The school_status enum is `active | onboarding | paused`. URL values
// must match the enum exactly — labels are just for display.
const STATUSES = ["active", "onboarding", "paused"] as const;
type SchoolStatus = (typeof STATUSES)[number];
const STATUS_LABEL: Record<SchoolStatus, string> = { active: "Active", onboarding: "Onboarding", paused: "Inactive" };
const STATUS_TONE: Record<SchoolStatus, "success" | "warning" | "default"> = { active: "success", onboarding: "warning", paused: "default" };

export default async function SchoolsListPage({
  searchParams,
}: { searchParams: Promise<{ q?: string; status?: string }> }) {
  const guard = await requireAnyPermission("schools.read", "schools.write");
  if (isResponse(guard)) redirect("/admin/dashboard");
  const canWrite = hasPermission(guard, "schools.write");

  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  // Guard against stale/bookmarked URLs with old capitalised labels —
  // silently drop unknown values instead of throwing a Postgres enum error.
  const status = (STATUSES as readonly string[]).includes(sp.status ?? "") ? (sp.status as SchoolStatus) : "";

  const conds = [];
  if (q) conds.push(or(
    ilike(schools.schoolName, `%${q}%`),
    ilike(schools.schoolCode, `%${q}%`),
    ilike(schools.branchName, `%${q}%`),
    ilike(schools.erpName, `%${q}%`),
  )!);
  if (status) conds.push(eq(schools.status, status));

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

  const hasFilter = !!(q || status);

  return (
    <div>
      <PageHeader
        eyebrow="Catalog"
        title="Schools"
        description={`${rows.length} school${rows.length === 1 ? "" : "s"}${hasFilter ? " in this filter" : ""}`}
        actions={
          <Link href="/admin/schools/new">
            <Button variant="primary" icon={<Plus className="h-3.5 w-3.5" />}>Add school</Button>
          </Link>
        }
      />
      <AutoSubmitForm action={BASE}>
        <Toolbar>
          <SearchInput defaultValue={q} placeholder="Search by name, code or branch…" />
          <FilterSelect label="Status" name="status" defaultValue={status}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>{STATUS_LABEL[s]}</option>
            ))}
          </FilterSelect>
          {hasFilter ? (
            <Link href={BASE} className="text-[12.5px] text-ink-500 hover:text-ink-900">Clear</Link>
          ) : null}
        </Toolbar>
      </AutoSubmitForm>

      <Card padded={false} className="overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState icon={Building2} title={hasFilter ? "No schools match" : "No schools yet"} description={hasFilter ? "Try a different name or clear the filter." : "Click 'Add school' to create the first one."} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr>
                <Th>School</Th>
                <Th>Code</Th>
                <Th>Branch</Th>
                <Th>City</Th>
                <Th>Status</Th>
                <Th right>Coordinators</Th>
                <Th right>Students</Th>
                {canWrite ? <Th right><span className="sr-only">Actions</span></Th> : null}
              </tr></thead>
              <tbody>
                {rows.map((r) => {
                  const st = (r.status ?? "paused") as SchoolStatus;
                  return (
                    <Tr key={r.id}>
                      <Td>
                        <Link href={`/admin/schools/${r.id}`} className="font-semibold text-ink-900 hover:text-brand-700">
                          {r.schoolName ?? r.erpName}
                        </Link>
                      </Td>
                      <Td muted><span className="font-mono">{r.schoolCode ?? "—"}</span></Td>
                      <Td muted>{r.branchName ?? "—"}</Td>
                      <Td muted>{r.city ?? "—"}</Td>
                      <Td>
                        <Badge tone={STATUS_TONE[st] ?? "default"} dot size="sm">{STATUS_LABEL[st] ?? r.status ?? "—"}</Badge>
                      </Td>
                      <Td right>{r.coordCount || <span className="text-ink-300">0</span>}</Td>
                      <Td right>
                        <Link href={`/admin/students?schoolCode=${encodeURIComponent(r.schoolCode ?? "")}`} className="font-semibold text-ink-900 hover:text-brand-700">
                          {r.studentCount.toLocaleString("en-IN")}
                        </Link>
                      </Td>
                      {canWrite ? (
                        <Td right>
                          <SchoolRowActions schoolId={r.id} schoolLabel={r.schoolName ?? r.erpName ?? "this school"} />
                        </Td>
                      ) : null}
                    </Tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
