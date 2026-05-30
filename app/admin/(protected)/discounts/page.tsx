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
} from "@/components/admin/ui/primitives";
import { BulkGenerateDialog } from "./BulkGenerateDialog";
import { BulkExtendDialog } from "./BulkExtendDialog";
import { redirect } from "next/navigation";
import { requireAnyPermission, isResponse } from "@/lib/admin-guard";

export const dynamic = "force-dynamic";

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
  }>;
}) {
  const guard = await requireAnyPermission("discounts.read", "discounts.write");
  if (isResponse(guard)) redirect("/admin/dashboard");

  const { q, status, type, school } = await searchParams;
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
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(websiteCartCoupons.updatedAt));

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

  const kpiRing = (key: StatusFilter | "all") =>
    (key === "all" && !hasAnyFilter) || (key !== "all" && status === key)
      ? "ring-2 ring-brand/40"
      : "";

  return (
    <div>
      <PageHeader
        eyebrow="Pricing & Tax"
        title="Website Cart Coupons"
        description="Mirrors ERPNext › Procurement › Website Cart Coupon. Edits round-trip to erp.inventre.in."
        actions={
          <div className="flex items-center gap-2">
            <Link
              href={`/api/admin/export/coupons?${new URLSearchParams({
                q: term,
                status: status ?? "",
                type: type ?? "",
                school: school ?? "",
              }).toString()}`}
              prefetch={false}
              title="Download filtered coupons as CSV (full details)"
            >
              <Button variant="secondary" icon={<Download className="h-3.5 w-3.5" />}>
                Export CSV
              </Button>
            </Link>
            <Link
              href={`/api/admin/export/coupons?codesOnly=1&${new URLSearchParams({
                q: term,
                status: status ?? "",
                type: type ?? "",
                school: school ?? "",
              }).toString()}`}
              prefetch={false}
              title="Download just the coupon codes (one per line)"
            >
              <Button variant="secondary" icon={<Download className="h-3.5 w-3.5" />}>
                Codes only
              </Button>
            </Link>
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

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <Link
          href={hrefWith({ status: "", type: "", school: "", q: "" })}
          className={`block rounded-2xl ${kpiRing("all")}`}
        >
          <Stat label="Total coupons" value={Number(totals.total).toLocaleString("en-IN")} iconTone="default" />
        </Link>
        <Link
          href={hrefWith({ status: "active" })}
          className={`block rounded-2xl ${kpiRing("active")}`}
        >
          <Stat label="Active" value={Number(totals.active).toLocaleString("en-IN")} iconTone="success" />
        </Link>
        <Link
          href={hrefWith({ status: "used" })}
          className={`block rounded-2xl ${kpiRing("used")}`}
        >
          <Stat label="Total redemptions" value={Number(totals.used).toLocaleString("en-IN")} iconTone="info" />
        </Link>
        <Link
          href={hrefWith({ status: "used" })}
          className={`block rounded-2xl ${kpiRing("used")}`}
        >
          <Stat label="Total saved" value={<Money paise={Number(totals.saved)} />} iconTone="brand" />
        </Link>
      </div>

      <form method="GET" className="mb-4">
        <Toolbar>
          <SearchInput
            name="q"
            defaultValue={term}
            placeholder="Search coupon code or ERP name…"
          />
          <select
            name="status"
            defaultValue={status ?? ""}
            className="h-9 px-2.5 rounded-lg border border-ink-200 text-[13px] bg-white"
          >
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="expired">Expired</option>
            <option value="scheduled">Scheduled</option>
            <option value="used">Used (≥1 redemption)</option>
          </select>
          <select
            name="type"
            defaultValue={type ?? ""}
            className="h-9 px-2.5 rounded-lg border border-ink-200 text-[13px] bg-white"
          >
            <option value="">All types</option>
            <option value="Fixed">Fixed</option>
            <option value="Percentage">Percentage</option>
          </select>
          <select
            name="school"
            defaultValue={school ?? ""}
            className="h-9 px-2.5 rounded-lg border border-ink-200 text-[13px] bg-white min-w-[180px]"
          >
            <option value="">All schools</option>
            {schoolOpts.map((s) => (
              <option key={s.erp_name} value={s.erp_name}>
                {s.name}
              </option>
            ))}
          </select>
          <Button type="submit" variant="secondary">
            Apply
          </Button>
          {hasAnyFilter ? (
            <Link
              href="/admin/discounts"
              className="text-[12.5px] text-ink-500 hover:text-ink-900 underline underline-offset-2"
            >
              Clear
            </Link>
          ) : null}
          <span className="ml-auto text-[12px] text-ink-500 tabular-nums">
            {rows.length.toLocaleString("en-IN")} of{" "}
            {Number(totals.total).toLocaleString("en-IN")}
          </span>
        </Toolbar>
      </form>

      <Card padded={false}>
        {rows.length === 0 ? (
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
                  <Th>Coupon code</Th>
                  <Th>School</Th>
                  <Th>Grade</Th>
                  <Th>Student</Th>
                  <Th>Type</Th>
                  <Th right>Value</Th>
                  <Th right>Cap</Th>
                  <Th>Window</Th>
                  <Th>Uses</Th>
                  <Th right>Saved</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const expired =
                    r.c.endDatetime && r.c.endDatetime < now ? true : false;
                  const notStarted =
                    r.c.startDatetime && r.c.startDatetime > now ? true : false;
                  const statusTone: "default" | "success" | "warning" | "danger" =
                    !r.c.isActive
                      ? "default"
                      : expired
                        ? "danger"
                        : notStarted
                          ? "warning"
                          : "success";
                  const statusLabel = !r.c.isActive
                    ? "Inactive"
                    : expired
                      ? "Expired"
                      : notStarted
                        ? "Scheduled"
                        : "Active";
                  const studentName = [r.studentFirstName, r.studentLastName]
                    .filter(Boolean)
                    .join(" ")
                    .trim();
                  return (
                    <Tr key={r.c.id}>
                      <Td>
                        <Link
                          href={`/admin/discounts/${r.c.id}`}
                          className="font-mono text-[12.5px] font-semibold text-ink-900 hover:text-brand"
                        >
                          {r.c.couponCode}
                        </Link>
                        {r.c.erpName && r.c.erpName !== r.c.couponCode ? (
                          <div className="text-[10px] text-ink-400 font-mono mt-0.5">
                            {r.c.erpName}
                          </div>
                        ) : null}
                      </Td>
                      <Td muted>
                        {r.schoolName ?? (
                          <span className="text-ink-400">— any —</span>
                        )}
                      </Td>
                      <Td muted>
                        {r.c.grade ?? (
                          <span className="text-ink-400">— any —</span>
                        )}
                      </Td>
                      <Td muted>
                        {studentName || (
                          <span className="text-ink-400">— any —</span>
                        )}
                      </Td>
                      <Td>
                        <Badge
                          tone={r.c.discountType === "Percentage" ? "info" : "brand"}
                          size="sm"
                        >
                          {r.c.discountType}
                        </Badge>
                      </Td>
                      <Td right>
                        <span className="font-semibold tabular-nums">
                          {r.c.discountType === "Percentage"
                            ? `${Number(r.c.discount)}%`
                            : `₹${Number(r.c.discount).toLocaleString("en-IN")}`}
                        </span>
                      </Td>
                      <Td right muted>
                        {r.c.discountType === "Percentage" &&
                        r.c.maximumDiscountAmount > 0
                          ? `₹${r.c.maximumDiscountAmount.toLocaleString("en-IN")}`
                          : "—"}
                      </Td>
                      <Td muted className="text-[11px] whitespace-nowrap">
                        {r.c.startDatetime || r.c.endDatetime ? (
                          <>
                            {r.c.startDatetime
                              ? new Date(r.c.startDatetime).toLocaleDateString("en-IN")
                              : "—"}
                            <span className="mx-1 text-ink-300">→</span>
                            {r.c.endDatetime
                              ? new Date(r.c.endDatetime).toLocaleDateString("en-IN")
                              : "—"}
                          </>
                        ) : (
                          <span className="text-ink-400">always</span>
                        )}
                      </Td>
                      <Td>
                        <span className="tabular-nums">{r.usageCount}</span>
                        {r.c.oneTimeUse ? (
                          <span className="ml-1 text-[10px] text-ink-400">/ 1</span>
                        ) : null}
                      </Td>
                      <Td right>
                        <Money paise={Number(r.totalSaved)} />
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
      </Card>
    </div>
  );
}
