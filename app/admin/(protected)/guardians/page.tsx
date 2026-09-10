import Link from "next/link";
import { db } from "@/db/client";
import { guardians, studentGuardianLinks } from "@/db/schema";
import { ilike, or, sql, and, count } from "drizzle-orm";
import { Users, Plus } from "lucide-react";
import {
  PageHeader, Card, Th, Td, Tr, EmptyState, SearchInput, Toolbar, Button,
} from "@/components/admin/ui/primitives";
import { GuardianMergeBanner } from "@/components/admin/GuardianMergeBanner";
import { redirect } from "next/navigation";
import { requireAnyPermission, isResponse } from "@/server/admin-guard";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

export default async function ErpGuardiansPage({
  searchParams,
}: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const guard = await requireAnyPermission("guardians.read", "guardians.write");
  if (isResponse(guard)) redirect("/admin/dashboard");

  const { q, page: pageRaw } = await searchParams;
  const page = Math.max(1, Number(pageRaw ?? "1") || 1);
  const offset = (page - 1) * PAGE_SIZE;

  const conds = [];
  if (q) conds.push(or(
    ilike(guardians.guardianName, `%${q}%`),
    ilike(guardians.mobileNumber, `%${q}%`),
    ilike(guardians.emailAddress, `%${q}%`),
    ilike(guardians.erpName, `%${q}%`),
  )!);

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
    }).from(guardians).where(conds.length ? and(...conds) : undefined).orderBy(guardians.erpName).limit(PAGE_SIZE).offset(offset),
    db.select({ n: count() }).from(guardians).where(conds.length ? and(...conds) : undefined),
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
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
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

  const qs = (p: number) => {
    const sp = new URLSearchParams();
    if (q) sp.set("q", q);
    sp.set("page", String(p));
    return "?" + sp.toString();
  };

  return (
    <div>
      <PageHeader
        eyebrow="People"
        title="Guardians"
        description={`${total.toLocaleString()} guardian${total === 1 ? "" : "s"} · page ${page} / ${lastPage}`}
        actions={
          <Link href="/admin/guardians/new">
            <Button variant="primary" icon={<Plus className="h-3.5 w-3.5" />}>Add guardian</Button>
          </Link>
        }
      />
      <form method="GET">
        <Toolbar>
          <SearchInput defaultValue={q ?? ""} placeholder="Search by name, mobile, email, ERP id…" />
          <Button type="submit" variant="secondary">Apply</Button>
        </Toolbar>
      </form>
      <GuardianMergeBanner groups={dupGroups} />
      <Card padded={false}>
        {rows.length === 0 ? (
          <EmptyState icon={Users} title={q ? `No guardians match "${q}"` : "No guardians yet"} description={q ? "Try a broader search." : "Click 'Add guardian' to create the first one."} />
        ) : (
          <>
            <table className="w-full text-[13px]">
              <thead><tr>
                <Th>ID</Th>
                <Th>Guardian Name</Th>
                <Th>Mobile</Th>
                <Th>Email</Th>
                <Th>Alternate</Th>
                <Th>DOB</Th>
                <Th right>Linked students</Th>
              </tr></thead>
              <tbody>{rows.map((g) => (
                <Tr key={g.id}>
                  <Td><Link href={`/admin/guardians/${g.id}`} className="font-mono text-[11px] text-ink-700 hover:text-brand-700">{g.erpName}</Link></Td>
                  <Td><Link href={`/admin/guardians/${g.id}`} className="font-semibold text-ink-900 hover:text-brand-700">{g.guardianName ?? "—"}</Link></Td>
                  <Td muted><span className="font-mono text-[12px]">{g.mobileNumber ?? "—"}</span></Td>
                  <Td muted>{g.email ?? "—"}</Td>
                  <Td muted><span className="font-mono text-[12px]">{g.alternateNumber ?? "—"}</span></Td>
                  <Td muted>{g.dateOfBirth ?? "—"}</Td>
                  <Td right><span className="tabular-nums">{g.linkedStudents}</span></Td>
                </Tr>
              ))}</tbody>
            </table>
            <div className="flex items-center justify-between p-3 border-t border-ink-100/70 text-[12px]">
              <span className="text-ink-500">Showing {offset + 1}-{Math.min(offset + rows.length, total)} of {total.toLocaleString()}</span>
              <div className="flex items-center gap-2">
                {page > 1 ? <Link href={qs(page - 1)} className="px-3 py-1.5 border border-ink-200 rounded-lg hover:bg-cream-50">‹ Prev</Link> : null}
                {page < lastPage ? <Link href={qs(page + 1)} className="px-3 py-1.5 border border-ink-200 rounded-lg hover:bg-cream-50">Next ›</Link> : null}
              </div>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
