import Link from "next/link";
import { db } from "@/db/client";
import { websiteCartCoupons, schools, students } from "@/db/schema";
import { and, eq, ilike, or, sql, desc, asc, gt, lt, gte, isNotNull, type SQL } from "drizzle-orm";
import { Tag, Plus, Download } from "lucide-react";
import {
  PageHeader,
  Card,
  Th,
  Td,
  Tr,
  Badge,
  Money,
  EmptyState,
  Button,
  Stat,
  Toolbar,
  SearchInput,
  FilterSelect,
  Menu,
} from "@/components/admin/ui/primitives";
import { BulkGenerateDialog } from "./BulkGenerateDialog";
import { BulkExtendDialog } from "./BulkExtendDialog";
import { redirect } from "next/navigation";
import { requireAnyPermission, isResponse } from "@/server/admin-guard";
import { Pagination, PerPagePicker } from "@/components/admin/ui/pagination";
import {
  DEFAULT_PER_PAGE,
  PER_PAGE_OPTIONS,
  pageMeta,
  readPaging,
  withPaging,
} from "@/lib/admin-paging";

import { AutoSubmitForm } from "@/components/admin/AutoSubmitForm";

export const dynamic = "force-dynamic";

const fmtDay = (d: Date) => d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

type StatusFilter = "" | "active" | "inactive" | "expired" | "scheduled" | "used";
type TypeFilter = "" | "Fixed" | "Percentage";

export default async function DiscountsPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    status?: StatusFilter;
    type?: TypeFilter;
    school?: string;
    page?: string;
    perPage?: string;
  }>;
}) {
  const guard = await requireAnyPermission("discounts.read", "discounts.write");
  if (isResponse(guard)) redirect("/admin/dashboard");

  const sp = await searchParams;
  const { q, status, type, school } = sp;
  const paging = readPaging(sp);
  const term = (q ?? "").trim();
  const now = new Date();

  // ─── Build filter predicate ───────────────────────────────────────
  const where: SQL[] = [];
  if (term) {
    where.push(
      or(
        ilike(websiteCartCoupons.couponCode, `%${term}%`),
        ilike(websiteCartCoupons.erpName, `%${term}%`),
      )!,
    );
  }
  if (status === "active") {
    where.push(eq(websiteCartCoupons.isActive, true));
    where.push(
      or(
        sql`${websiteCartCoupons.startDatetime} IS NULL`,
        lt(websiteCartCoupons.startDatetime, now),
      )!,
    );
    where.push(
      or(
        sql`${websiteCartCoupons.endDatetime} IS NULL`,
        gt(websiteCartCoupons.endDatetime, now),
      )!,
    );
  } else if (status === "inactive") {
    where.push(eq(websiteCartCoupons.isActive, false));
  } else if (status === "expired") {
    where.push(isNotNull(websiteCartCoupons.endDatetime));
    where.push(lt(websiteCartCoupons.endDatetime, now));
  } else if (status === "scheduled") {
    where.push(isNotNull(websiteCartCoupons.startDatetime));
    where.push(gte(websiteCartCoupons.startDatetime, now));
  } else if (status === "used") {
    where.push(gt(websiteCartCoupons.usedCount, 0));
  }
  if (type === "Fixed" || type === "Percentage") {
    where.push(eq(websiteCartCoupons.discountType, type));
  }
  if (school) {
    where.push(eq(websiteCartCoupons.schoolErpName, school));
  }

  // One page of coupons plus the filtered count. This used to render every
  // matching coupon in one response (~9 s to open).
  const whereExpr = where.length ? and(...where) : undefined;
  const rows = await db
    .select({
      c: websiteCartCoupons,
      schoolName: schools.name,
      studentFirstName: students.firstName,
      studentLastName: students.lastName,
      usageCount: sql<number>`(
        SELECT COUNT(*) FROM website_cart_coupon_usages u
        WHERE u.coupon_id = ${websiteCartCoupons.id}
      )::int`,
      totalSaved: sql<number>`(
        SELECT COALESCE(SUM(amount_saved), 0) FROM website_cart_coupon_usages u
        WHERE u.coupon_id = ${websiteCartCoupons.id}
      )::bigint`,
    })
    .from(websiteCartCoupons)
    .leftJoin(schools, eq(schools.id, websiteCartCoupons.schoolId))
    .leftJoin(students, eq(students.id, websiteCartCoupons.studentId))
    .where(whereExpr)
    // id breaks updatedAt ties so a coupon cannot appear on two pages.
    .orderBy(desc(websiteCartCoupons.updatedAt), desc(websiteCartCoupons.id))
    .limit(paging.perPage)
    .offset(paging.offset);
  const matching = await db.$count(websiteCartCoupons, whereExpr);

  // ─── Global KPIs (always show the unfiltered totals) ──────────────
  const [totals] = await db.execute<{
    total: number;
    active: number;
    used: number;
    saved: string;
  }>(sql`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (
        WHERE c.is_active
          AND (c.start_datetime IS NULL OR c.start_datetime < NOW())
          AND (c.end_datetime   IS NULL OR c.end_datetime   > NOW())
      )::int AS active,
      COALESCE(SUM(u.n), 0)::int AS used,
      COALESCE(SUM(u.saved), 0)::bigint AS saved
    FROM website_cart_coupons c
    LEFT JOIN (
      SELECT coupon_id,
             COUNT(*) AS n,
             SUM(amount_saved) AS saved
      FROM website_cart_coupon_usages
      GROUP BY coupon_id
    ) u ON u.coupon_id = c.id
  `) as unknown as [{ total: number; active: number; used: number; saved: string }];

  // ─── School dropdown options (only schools that have ≥1 coupon) ───
  const schoolOpts = (await db.execute<{ erp_name: string; name: string }>(sql`
    SELECT DISTINCT c.school_erp_name AS erp_name,
                    COALESCE(s.name, c.school_erp_name) AS name
    FROM website_cart_coupons c
    LEFT JOIN schools s ON s.id = c.school_id
    WHERE c.school_erp_name IS NOT NULL
    ORDER BY name
  `)) as unknown as { erp_name: string; name: string }[];

  // ─── All active schools (for the bulk-generate dialog) ────────────
  // Bulk generate needs to target schools that may never have had a
  // coupon yet, so this list is wider than schoolOpts above.
  const allActiveSchools = await db
    .select({ erpName: schools.erpName, name: schools.name })
    .from(schools)
    .where(and(eq(schools.status, "active"), isNotNull(schools.erpName)))
    .orderBy(asc(schools.name));
  const allActiveSchoolOptions = allActiveSchools
    .filter((s): s is { erpName: string; name: string } => !!s.erpName)
    .map((s) => ({ erpName: s.erpName, name: s.name }));

  // Build href that overrides a single filter while preserving the rest.
  const hrefWith = (override: Record<string, string>) => {
    const sp = new URLSearchParams();
    const base: Record<string, string> = {
      q: term,
      status: status ?? "",
      type: type ?? "",
      school: school ?? "",
      ...override,
    };
    for (const [k, v] of Object.entries(base)) if (v) sp.set(k, v);
    const qs = sp.toString();
    return qs ? `/admin/discounts?${qs}` : "/admin/discounts";
  };

  const hasAnyFilter = !!(term || status || type || school);

  const { pages, from, to } = pageMeta(matching, paging);
  if (paging.page > pages) redirect(withPaging(hrefWith({}), pages, paging.perPage));

  const kpiRing = (key: StatusFilter | "all") =>
    (key === "all" && !hasAnyFilter) || (key !== "all" && status === key)
      ? "ring-2 ring-brand/40"
      : "";

  const exportQs = new URLSearchParams({ q: term, status: status ?? "", type: type ?? "", school: school ?? "" }).toString();

  return (
    <div>
      <PageHeader
        eyebrow="Pricing & Tax"
        title="Discounts & Promotions"
        description="Website cart coupons, mirrored to ERPNext on save."
        actions={
          <div className="flex items-center gap-2">
            <Menu
              label="Export"
              trigger={
                <span className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-ink-200 bg-white px-3.5 text-[13px] font-semibold text-ink-800 transition-colors hover:border-ink-300 hover:bg-cream-100">
                  <Download className="h-3.5 w-3.5" /> Export
                </span>
              }
              items={[
                { label: "Coupons as CSV (full details)", href: `/api/admin/export/coupons?${exportQs}` },
                { label: "Codes only (one per line)", href: `/api/admin/export/coupons?codesOnly=1&${exportQs}` },
              ]}
            />
            <BulkExtendDialog
              schools={schoolOpts.map((s) => ({
                erpName: s.erp_name,
                name: s.name,
              }))}
            />
            <BulkGenerateDialog schools={allActiveSchoolOptions} />
            <Link href="/admin/discounts/new">
              <Button icon={<Plus className="h-3.5 w-3.5" />} variant="primary">
                New coupon
              </Button>
            </Link>
          </div>
        }
      />

      {/* The four numbers are also filters: Active and Used narrow the list. */}
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Link href="/admin/discounts" className={`block rounded-2xl ${kpiRing("all")}`}>
          <Stat label="Total coupons" value={Number(totals.total).toLocaleString("en-IN")} />
        </Link>
        <Link href={hrefWith({ status: "active" })} className={`block rounded-2xl ${kpiRing("active")}`}>
          <Stat label="Active now" value={Number(totals.active).toLocaleString("en-IN")} />
        </Link>
        <Link href={hrefWith({ status: "used" })} className={`block rounded-2xl ${kpiRing("used")}`}>
          <Stat label="Redemptions" value={Number(totals.used).toLocaleString("en-IN")} />
        </Link>
        <Link href={hrefWith({ status: "used" })} className={`block rounded-2xl ${kpiRing("used")}`}>
          <Stat label="Discount given" value={<Money paise={Number(totals.saved)} />} />
        </Link>
      </div>

      <AutoSubmitForm action="/admin/discounts" className="mb-4">
        <Toolbar>
          <SearchInput
            name="q"
            defaultValue={term}
            placeholder="Search coupon code or ERP name…"
          />
          <FilterSelect label="Status" name="status" defaultValue={status ?? ""}>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="expired">Expired</option>
            <option value="scheduled">Scheduled</option>
            <option value="used">Used (≥1 redemption)</option>
          </FilterSelect>
          <FilterSelect label="Type" name="type" defaultValue={type ?? ""}>
            <option value="Fixed">Fixed</option>
            <option value="Percentage">Percentage</option>
          </FilterSelect>
          <FilterSelect label="School" className="min-w-[200px]" name="school" defaultValue={school ?? ""}>
            {schoolOpts.map((s) => (
              <option key={s.erp_name} value={s.erp_name}>
                {s.name}
              </option>
            ))}
          </FilterSelect>
          {/* Applying a filter restarts at page 1 but keeps the chosen page size. */}
          {paging.perPage !== DEFAULT_PER_PAGE ? (
            <input type="hidden" name="perPage" value={paging.perPage} />
          ) : null}
          {hasAnyFilter ? (
            <Link href="/admin/discounts" className="text-[12.5px] text-ink-500 hover:text-ink-900">
              Clear
            </Link>
          ) : null}
        </Toolbar>
      </AutoSubmitForm>

      <Card padded={false}>
        {matching === 0 ? (
          <EmptyState
            icon={Tag}
            title={hasAnyFilter ? "No coupons match these filters" : "No coupons yet"}
            description={
              hasAnyFilter
                ? "Try clearing one of the filters above."
                : "Create your first Website Cart Coupon — it'll sync to ERPNext on save."
            }
            action={
              hasAnyFilter ? (
                <Link href="/admin/discounts">
                  <Button variant="secondary">Clear filters</Button>
                </Link>
              ) : (
                <Link href="/admin/discounts/new">
                  <Button icon={<Plus className="h-3.5 w-3.5" />}>New coupon</Button>
                </Link>
              )
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <Th>Coupon</Th>
                  <Th>Applies to</Th>
                  <Th right>Discount</Th>
                  <Th>Valid</Th>
                  <Th right>Uses</Th>
                  <Th right>Saved</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const expired = r.c.endDatetime && r.c.endDatetime < now ? true : false;
                  const notStarted = r.c.startDatetime && r.c.startDatetime > now ? true : false;
                  const statusTone: "default" | "success" | "warning" | "danger" =
                    !r.c.isActive ? "default" : expired ? "danger" : notStarted ? "warning" : "success";
                  const statusLabel = !r.c.isActive ? "Inactive" : expired ? "Expired" : notStarted ? "Scheduled" : "Active";
                  const studentName = [r.studentFirstName, r.studentLastName].filter(Boolean).join(" ").trim();
                  const scope = [r.schoolName, r.c.grade, studentName].filter(Boolean);
                  return (
                    <Tr key={r.c.id}>
                      <Td>
                        <Link
                          href={`/admin/discounts/${r.c.id}`}
                          className="font-mono font-semibold text-ink-900 hover:text-brand-700"
                        >
                          {r.c.couponCode}
                        </Link>
                      </Td>
                      <Td muted>
                        {scope.length === 0 ? (
                          <span className="text-ink-400">Everyone</span>
                        ) : (
                          <>
                            <span className="text-ink-800">{r.schoolName ?? "Any school"}</span>
                            {r.c.grade || studentName ? (
                              <span className="block text-[12px]">
                                {[r.c.grade, studentName].filter(Boolean).join(" · ")}
                              </span>
                            ) : null}
                          </>
                        )}
                      </Td>
                      <Td right>
                        <span className="font-semibold">
                          {r.c.discountType === "Percentage"
                            ? `${Number(r.c.discount)}%`
                            : `₹${Number(r.c.discount).toLocaleString("en-IN")}`}
                        </span>
                        {/* The maximum-discount cap only applies to percentage coupons. */}
                        {r.c.discountType === "Percentage" && r.c.maximumDiscountAmount > 0 ? (
                          <span className="block text-[11.5px] font-normal text-ink-500">
                            up to ₹{r.c.maximumDiscountAmount.toLocaleString("en-IN")}
                          </span>
                        ) : null}
                      </Td>
                      <Td muted className="whitespace-nowrap">
                        {r.c.startDatetime || r.c.endDatetime ? (
                          <>
                            {r.c.startDatetime ? fmtDay(r.c.startDatetime) : "—"}
                            <span className="mx-1 text-ink-300">→</span>
                            {r.c.endDatetime ? fmtDay(r.c.endDatetime) : "—"}
                          </>
                        ) : (
                          <span className="text-ink-400">No end date</span>
                        )}
                      </Td>
                      <Td right>
                        {r.usageCount || <span className="text-ink-300">0</span>}
                        {r.c.oneTimeUse ? <span className="text-[11px] text-ink-400"> / 1</span> : null}
                      </Td>
                      <Td right>
                        <Money paise={Number(r.totalSaved)} className={Number(r.totalSaved) ? "font-semibold" : "text-ink-300"} />
                      </Td>
                      <Td>
                        <Badge tone={statusTone} dot size="sm">
                          {statusLabel}
                        </Badge>
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {matching > 0 ? (
          <Pagination
            page={paging.page}
            pages={pages}
            from={from}
            to={to}
            total={matching}
            noun="coupon"
            hrefFor={(p) => withPaging(hrefWith({}), p, paging.perPage)}
          >
            <PerPagePicker
              value={paging.perPage}
              options={PER_PAGE_OPTIONS}
              hrefFor={(pp) => withPaging(hrefWith({}), 1, pp)}
            />
          </Pagination>
        ) : null}
      </Card>
    </div>
  );
}
