import Link from "next/link";
import { db } from "@/db/client";
import { guardians } from "@/db/schema";
import { ilike, or, sql, and, count } from "drizzle-orm";
import { Users, Plus } from "lucide-react";
import {
  PageHeader, Card, Th, Td, Tr, EmptyState, SearchInput, Toolbar, Button,
} from "@/components/admin/ui/primitives";
import { Pagination, PerPagePicker } from "@/components/admin/ui/pagination";
import { GuardianMergeBanner } from "@/components/admin/GuardianMergeBanner";
import { redirect } from "next/navigation";
import { requireAnyPermission, isResponse } from "@/server/admin-guard";
import { AutoSubmitForm } from "@/components/admin/AutoSubmitForm";
import { DEFAULT_PER_PAGE, PER_PAGE_OPTIONS, pageMeta, readPaging, withPaging } from "@/lib/admin-paging";

export const dynamic = "force-dynamic";

const BASE = "/admin/guardians";

const fmtDob = (d: string | null) => {
  if (!d) return null;
  const t = new Date(d);
  return Number.isNaN(t.getTime()) ? d : t.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};

/**
 * Guardians are the ERPNext "Guardian" master — the father/mother/guardian
 * rows synced from the ERP and linked to students. One row per guardian;
 * the row opens the record (contact details + linked students).
 */
export default async function ErpGuardiansPage({
  searchParams,
}: { searchParams: Promise<{ q?: string; page?: string; perPage?: string }> }) {
  const guard = await requireAnyPermission("guardians.read", "guardians.write");
  if (isResponse(guard)) redirect("/admin/dashboard");

  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const paging = readPaging(sp);

  const where = q
    ? or(
        ilike(guardians.guardianName, `%${q}%`),
        ilike(guardians.mobileNumber, `%${q}%`),
        ilike(guardians.emailAddress, `%${q}%`),
        ilike(guardians.erpName, `%${q}%`),
      )
    : undefined;

  const [rows, totalRow, dupRowsRes] = await Promise.all([
    db.select({
      id: guardians.id,
      erpName: guardians.erpName,
      guardianName: guardians.guardianName,
      mobileNumber: guardians.mobileNumber,
      email: guardians.emailAddress,
      alternateNumber: guardians.alternateNumber,
      dateOfBirth: guardians.dateOfBirth,
      linkedStudents: sql<number>`(SELECT COUNT(*) FROM student_guardian_links WHERE guardian_erp_name = ${guardians.erpName})::int`,
    }).from(guardians).where(where).orderBy(guardians.erpName).limit(paging.perPage).offset(paging.offset),
    db.select({ n: count() }).from(guardians).where(where),
    // Duplicate-mobile groups across the whole `guardians` table — not
    // scoped to the current search/filter, because the user needs to see
    // every household-level conflict regardless of how they're paging.
    // Capped at 30 groups for first paint so a catastrophically dirty
    // catalog can't blow up the page render.
    db.execute(sql`
      WITH dup AS (
        SELECT right(regexp_replace(coalesce(mobile_number, ''), '\D', '', 'g'), 10) AS phone,
               COUNT(*) AS n
          FROM guardians
         WHERE coalesce(mobile_number, '') <> ''
         GROUP BY 1
        HAVING COUNT(*) > 1 AND LENGTH(right(regexp_replace(coalesce(mobile_number, ''), '\D', '', 'g'), 10)) = 10
      )
      SELECT d.phone,
             d.n AS count,
             json_agg(
               json_build_object(
                 'erpName', g.erp_name,
                 'guardianName', g.guardian_name,
                 'linkCount', (SELECT COUNT(*) FROM student_guardian_links sgl WHERE sgl.guardian_erp_name = g.erp_name)::int,
                 'syncedAt', g.synced_at
               ) ORDER BY (SELECT COUNT(*) FROM student_guardian_links sgl WHERE sgl.guardian_erp_name = g.erp_name) DESC, g.synced_at ASC NULLS LAST
             ) AS rows
        FROM dup d
        JOIN guardians g
          ON right(regexp_replace(coalesce(g.mobile_number, ''), '\D', '', 'g'), 10) = d.phone
       GROUP BY d.phone, d.n
       ORDER BY d.n DESC, d.phone
       LIMIT 30
    `),
  ]);
  const total = Number(totalRow[0]?.n ?? 0);
  const { pages, from, to } = pageMeta(total, paging);
  const dupGroups = (((dupRowsRes as { rows?: unknown[] }).rows ?? (dupRowsRes as unknown as unknown[])) as Array<{
    phone: string;
    count: number;
    rows: Array<{
      erpName: string | null;
      guardianName: string | null;
      linkCount: number;
      syncedAt: string | null;
    }>;
  }>);

  const hrefBase = q ? `${BASE}?q=${encodeURIComponent(q)}` : BASE;
  if (paging.page > pages) redirect(withPaging(hrefBase, pages, paging.perPage));

  return (
    <div>
      <PageHeader
        eyebrow="Customer Relationship (CRM)"
        title="Guardians"
        description={`${total.toLocaleString("en-IN")} guardian${total === 1 ? "" : "s"}${q ? " matching your search" : ""}`}
        actions={
          <Link href="/admin/guardians/new">
            <Button variant="primary" icon={<Plus className="h-3.5 w-3.5" />}>Add guardian</Button>
          </Link>
        }
      />
      <AutoSubmitForm action={BASE}>
        <Toolbar>
          <SearchInput defaultValue={q} placeholder="Search name, mobile, email or ERP id…" />
          {paging.perPage !== DEFAULT_PER_PAGE ? <input type="hidden" name="perPage" value={paging.perPage} /> : null}
          {q ? (
            <Link href={BASE} className="text-[12.5px] text-ink-500 hover:text-ink-900">
              Clear
            </Link>
          ) : null}
        </Toolbar>
      </AutoSubmitForm>
      <GuardianMergeBanner groups={dupGroups} />
      <Card padded={false} className="overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState icon={Users} title={q ? `No guardians match "${q}"` : "No guardians yet"} description={q ? "Try a broader search." : "Click 'Add guardian' to create the first one."} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr>
                <Th>Guardian</Th>
                <Th>Mobile</Th>
                <Th>Alternate</Th>
                <Th>Email</Th>
                <Th>Date of birth</Th>
                <Th right>Students</Th>
              </tr></thead>
              <tbody>{rows.map((g) => (
                <Tr key={g.id}>
                  <Td>
                    <Link href={`/admin/guardians/${g.id}`} className="group/name block">
                      <span className="block font-semibold text-ink-900 group-hover/name:text-brand-700">{g.guardianName ?? "—"}</span>
                      <span className="mt-0.5 block font-mono text-[11.5px] font-normal text-ink-500">{g.erpName}</span>
                    </Link>
                  </Td>
                  <Td muted><span className="font-mono">{g.mobileNumber ?? "—"}</span></Td>
                  <Td muted><span className="font-mono">{g.alternateNumber ?? "—"}</span></Td>
                  <Td muted>{g.email ?? "—"}</Td>
                  <Td muted>{fmtDob(g.dateOfBirth) ?? "—"}</Td>
                  <Td right>{g.linkedStudents || <span className="text-ink-300">0</span>}</Td>
                </Tr>
              ))}</tbody>
            </table>
          </div>
        )}
        {total > 0 ? (
          <Pagination
            page={paging.page}
            pages={pages}
            from={from}
            to={to}
            total={total}
            noun="guardian"
            hrefFor={(p) => withPaging(hrefBase, p, paging.perPage)}
          >
            <PerPagePicker value={paging.perPage} options={PER_PAGE_OPTIONS} hrefFor={(pp) => withPaging(hrefBase, 1, pp)} />
          </Pagination>
        ) : null}
      </Card>
    </div>
  );
}
