import Link from "next/link";
import { redirect } from "next/navigation";
import { Users, Plus } from "lucide-react";
import { db } from "@/db/client";
import { parents, students, schools, orders } from "@/db/schema";
import { and, asc, count, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { requireAnyPermission, isResponse } from "@/server/admin-guard";
import {
  PageHeader,
  Card,
  Toolbar,
  SearchInput,
  Button,
  Badge,
  Money,
  EmptyState,
  Th,
  Td,
  Tr,
  FilterSelect,
} from "@/components/admin/ui/primitives";
import { Pagination, PerPagePicker } from "@/components/admin/ui/pagination";
import { AutoSubmitForm } from "@/components/admin/AutoSubmitForm";
import { DEFAULT_PER_PAGE, PER_PAGE_OPTIONS, pageMeta, readPaging, withPaging } from "@/lib/admin-paging";

export const dynamic = "force-dynamic";

const BASE = "/admin/customers";

const IST = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" });
const fmtDate = (d: Date | string | null | undefined) => (d ? IST.format(new Date(d)) : null);

/**
 * Customers are the parent accounts that sign in and shop — one row per
 * `parents` record. The row links to the customer record (students,
 * addresses, orders). Searching is by name, mobile or email; the school
 * filter narrows to families with a student at that school.
 */
export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; school?: string; status?: string; page?: string; perPage?: string }>;
}) {
  const guard = await requireAnyPermission("customers.read", "customers.write");
  if (isResponse(guard)) redirect("/admin/dashboard");

  const sp = await searchParams;
  const term = (sp.q ?? "").trim();
  const status = sp.status === "active" || sp.status === "blocked" ? sp.status : "";
  const paging = readPaging(sp);
  // A school admin only ever sees their own school's families.
  const schoolId = guard.role === "school_admin" ? (guard.schoolId ?? "") : (sp.school ?? "");

  const conds: SQL[] = [];
  if (term) {
    conds.push(or(ilike(parents.name, `%${term}%`), ilike(parents.phone, `%${term}%`), ilike(parents.email, `%${term}%`))!);
  }
  if (status) conds.push(eq(parents.status, status));
  if (schoolId) {
    const scoped = await db.selectDistinct({ id: students.parentId }).from(students).where(eq(students.schoolId, schoolId));
    const ids = scoped.map((r) => r.id).filter((id): id is string => id !== null);
    conds.push(ids.length ? inArray(parents.id, ids) : eq(parents.id, "00000000-0000-0000-0000-000000000000"));
  }
  const where = conds.length ? and(...conds) : undefined;

  // Order figures come straight from `orders` — the `parents.total_*`
  // counters were never maintained (0 on every row in production).
  const o = db
    .select({
      parentId: orders.parentId,
      orderCount: sql<number>`count(*) FILTER (WHERE ${orders.status} <> 'cancelled')::int`.as("o_order_count"),
      paidValue: sql<number>`COALESCE(SUM(${orders.total}) FILTER (WHERE ${orders.paymentStatus} = 'paid'), 0)::bigint`.as("o_paid_value"),
      lastOrderAt: sql<string | null>`MAX(${orders.createdAt})`.as("o_last_order_at"),
    })
    .from(orders)
    .groupBy(orders.parentId)
    .as("o");

  const [rows, totalRows, schoolList] = await Promise.all([
    db
      .select({
        id: parents.id,
        name: parents.name,
        phone: parents.phone,
        email: parents.email,
        status: parents.status,
        totalOrderCount: sql<number>`COALESCE(${o.orderCount}, 0)`,
        totalLifetimeValue: sql<number>`COALESCE(${o.paidValue}, 0)`,
        lastOrderAt: o.lastOrderAt,
        lastLoginAt: parents.lastLoginAt,
        createdAt: parents.createdAt,
      })
      .from(parents)
      .leftJoin(o, eq(o.parentId, parents.id))
      .where(where)
      // Most recently ordering families first; id breaks ties so paging is stable.
      .orderBy(sql`${o.lastOrderAt} DESC NULLS LAST`, desc(parents.createdAt), asc(parents.id))
      .limit(paging.perPage)
      .offset(paging.offset),
    db.select({ total: count() }).from(parents).where(where),
    db.select({ id: schools.id, name: schools.name }).from(schools).where(eq(schools.status, "active")).orderBy(asc(schools.name)),
  ]);
  const total = totalRows[0]?.total ?? 0;
  const { pages, from, to } = pageMeta(total, paging);

  const hrefWith = (over: Record<string, string> = {}) => {
    const u = new URLSearchParams();
    const base: Record<string, string> = { q: term, school: guard.role === "school_admin" ? "" : schoolId, status, ...over };
    for (const [k, v] of Object.entries(base)) if (v) u.set(k, v);
    const qs = u.toString();
    return qs ? `${BASE}?${qs}` : BASE;
  };
  if (paging.page > pages) redirect(withPaging(hrefWith(), pages, paging.perPage));

  // Students per family on this page: "2 students · St. Andrews".
  const ids = rows.map((r) => r.id);
  const kids = ids.length
    ? await db
        .select({ parentId: students.parentId, name: students.name, schoolName: schools.name })
        .from(students)
        .leftJoin(schools, eq(schools.id, students.schoolId))
        .where(and(inArray(students.parentId, ids), eq(students.status, "active")))
    : [];
  const kidsByParent = new Map<string, { count: number; schools: string[] }>();
  for (const k of kids) {
    if (!k.parentId) continue;
    const cur = kidsByParent.get(k.parentId) ?? { count: 0, schools: [] };
    cur.count += 1;
    if (k.schoolName && !cur.schools.includes(k.schoolName)) cur.schools.push(k.schoolName);
    kidsByParent.set(k.parentId, cur);
  }

  const hasFilter = !!(term || status || (guard.role !== "school_admin" && schoolId));

  return (
    <div>
      <PageHeader
        eyebrow="Customer Relationship (CRM)"
        title="Customers (Parents)"
        description={`${total.toLocaleString("en-IN")} parent account${total === 1 ? "" : "s"}${hasFilter ? " in this filter" : ""}`}
        actions={
          <Link href="/admin/customers/new">
            <Button variant="primary" icon={<Plus className="h-3.5 w-3.5" />}>Add customer</Button>
          </Link>
        }
      />

      <AutoSubmitForm action={BASE}>
        <Toolbar>
          <SearchInput name="q" defaultValue={term} placeholder="Search name, mobile or email…" />
          {guard.role !== "school_admin" ? (
            <FilterSelect label="School" className="min-w-[220px]" name="school" defaultValue={schoolId}>
              {schoolList.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </FilterSelect>
          ) : null}
          <FilterSelect label="Status" name="status" defaultValue={status}>
            <option value="active">Active</option>
            <option value="blocked">Blocked</option>
          </FilterSelect>
          {paging.perPage !== DEFAULT_PER_PAGE ? <input type="hidden" name="perPage" value={paging.perPage} /> : null}
          {hasFilter ? (
            <Link href={BASE} className="text-[12.5px] text-ink-500 hover:text-ink-900 underline underline-offset-2">
              Clear
            </Link>
          ) : null}
        </Toolbar>
      </AutoSubmitForm>

      <Card padded={false} className="overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState
            icon={Users}
            title={hasFilter ? "No customers match" : "No customers yet"}
            description={hasFilter ? "Try a different name, mobile or email, or clear the filters." : "Parent accounts appear here once a family signs in or is granted access."}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <Th>Customer</Th>
                  <Th>Mobile</Th>
                  <Th>Students</Th>
                  <Th right>Orders</Th>
                  <Th right>Lifetime value</Th>
                  <Th>Last order</Th>
                  <Th>Last sign-in</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const k = kidsByParent.get(r.id);
                  return (
                    <Tr key={r.id}>
                      <Td>
                        <Link href={`/admin/customers/${r.id}`} className="group/name block">
                          <span className="block font-semibold text-ink-900 group-hover/name:text-brand-700">{r.name?.trim() || r.phone}</span>
                          {r.email ? <span className="mt-0.5 block text-[12px] text-ink-500">{r.email}</span> : null}
                        </Link>
                      </Td>
                      <Td muted><span className="font-mono">{r.phone}</span></Td>
                      <Td muted>
                        {k ? (
                          <>
                            <span className="text-ink-800">{k.count} student{k.count === 1 ? "" : "s"}</span>
                            {k.schools.length ? <span className="block text-[12px] text-ink-500">{k.schools.join(" · ")}</span> : null}
                          </>
                        ) : (
                          <span className="text-ink-300">—</span>
                        )}
                      </Td>
                      <Td right>{Number(r.totalOrderCount) || <span className="text-ink-300">0</span>}</Td>
                      <Td right><Money paise={Number(r.totalLifetimeValue)} className={Number(r.totalLifetimeValue) ? "font-semibold" : "text-ink-300"} /></Td>
                      <Td muted>{fmtDate(r.lastOrderAt) ?? <span className="text-ink-300">—</span>}</Td>
                      <Td muted>{fmtDate(r.lastLoginAt) ?? <span className="text-ink-300">Never</span>}</Td>
                      <Td>
                        <Badge tone={r.status === "active" ? "success" : "danger"} dot size="sm">{r.status}</Badge>
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
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
            noun="customer"
            hrefFor={(p) => withPaging(hrefWith(), p, paging.perPage)}
          >
            <PerPagePicker value={paging.perPage} options={PER_PAGE_OPTIONS} hrefFor={(pp) => withPaging(hrefWith(), 1, pp)} />
          </Pagination>
        ) : null}
      </Card>
    </div>
  );
}
