import { NextResponse } from "next/server";
import { parseBody } from "@/server/parse-body";
import { z } from "zod";
import { eq, desc, sql, ilike, or, and, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import {
  websiteCartCoupons,
  websiteCartCouponUsages,
  schools,
  students,
} from "@/db/schema";
import { isResponse, requirePermission } from "@/server/admin-guard";
import { logAdminActivity } from "@/server/activity";

const Body = z.object({
  couponCode: z.string().min(2).max(64),
  isActive: z.boolean().default(true),
  schoolErpName: z.string().nullable().optional(),
  studentErpName: z.string().nullable().optional(),
  /** Local-only optional scope; requires schoolErpName to be set. */
  grade: z.string().min(1).max(64).nullable().optional(),
  startDatetime: z.string().nullable().optional(),
  endDatetime: z.string().nullable().optional(),
  oneTimeUse: z.boolean().default(true),
  canUseMultipleTimes: z.boolean().default(false),
  discountType: z.enum(["Fixed", "Percentage"]),
  discount: z.number().nonnegative(),
  maximumDiscountAmount: z.number().int().nonnegative().default(0),
  /** Retired. Kept for request-body compatibility with old clients but the
   *  legacy ERPNext at erp.inventre.in is decommissioned, so this flag is
   *  ignored. Coupons are local-only now. */
  syncToErp: z.boolean().default(false).optional(),
});

export async function GET(req: Request) {
  const guard = await requirePermission("discounts.read");
  if (isResponse(guard)) return guard;

  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  const where = q
    ? or(
        ilike(websiteCartCoupons.couponCode, `%${q}%`),
        ilike(websiteCartCoupons.schoolErpName, `%${q}%`),
        ilike(websiteCartCoupons.studentErpName, `%${q}%`),
      )
    : undefined;

  const base = await db
    .select({
      c: websiteCartCoupons,
      schoolName: schools.name,
      studentName: students.name,
    })
    .from(websiteCartCoupons)
    .leftJoin(schools, eq(schools.id, websiteCartCoupons.schoolId))
    .leftJoin(students, eq(students.id, websiteCartCoupons.studentId))
    .where(where)
    .orderBy(desc(websiteCartCoupons.updatedAt))
    .limit(500);

  // Fetch usage aggregates separately — drizzle's prepared-statement builder
  // crashes on correlated subqueries or groupBy over a wide table here.
  const couponIds = base.map((r) => r.c.id);
  const usageRows = couponIds.length
    ? await db
        .select({
          couponId: websiteCartCouponUsages.couponId,
          usageCount: sql<number>`COUNT(*)::int`,
          totalSaved: sql<number>`COALESCE(SUM(${websiteCartCouponUsages.amountSaved}), 0)::bigint`,
        })
        .from(websiteCartCouponUsages)
        .where(inArray(websiteCartCouponUsages.couponId, couponIds))
        .groupBy(websiteCartCouponUsages.couponId)
    : [];
  const usageById = new Map(usageRows.map((u) => [u.couponId, u]));
  const rows = base.map((r) => ({
    ...r,
    usageCount: Number(usageById.get(r.c.id)?.usageCount ?? 0),
    totalSaved: Number(usageById.get(r.c.id)?.totalSaved ?? 0),
  }));

  return NextResponse.json({ coupons: rows });
}

export async function POST(req: Request) {
  const guard = await requirePermission("discounts.write");
  if (isResponse(guard)) return guard;
  const parsed = await parseBody(req, Body);
  if (parsed instanceof NextResponse) return parsed;
  const body = parsed;
  if (body.grade && !body.schoolErpName)
    return NextResponse.json(
      { error: "Grade requires a school to be selected" },
      { status: 400 },
    );

  // Resolve local FKs from ERP name strings when possible.
  let schoolId: string | null = null;
  if (body.schoolErpName) {
    const [s] = await db
      .select({ id: schools.id })
      .from(schools)
      .where(eq(schools.erpName, body.schoolErpName))
      .limit(1);
    schoolId = s?.id ?? null;
  }
  let studentId: string | null = null;
  if (body.studentErpName) {
    const [s] = await db
      .select({ id: students.id })
      .from(students)
      .where(eq(students.erpName, body.studentErpName))
      .limit(1);
    studentId = s?.id ?? null;
  }

  // Legacy ERPNext at erp.inventre.in is decommissioned — coupons created
  // through the admin are now local-only. erpName stays null on new rows;
  // legacy rows that were originally imported from ERP retain their value
  // and are still readable. Reviving sync (if a new ERP comes online)
  // would happen in a separate route + outbound queue, not inline here.
  const erpName: string | null = null;

  const [created] = await db
    .insert(websiteCartCoupons)
    .values({
      erpName,
      couponCode: body.couponCode,
      isActive: body.isActive,
      schoolErpName: body.schoolErpName ?? null,
      schoolId,
      studentErpName: body.studentErpName ?? null,
      studentId,
      grade: body.grade ?? null,
      startDatetime: body.startDatetime ? new Date(body.startDatetime) : null,
      endDatetime: body.endDatetime ? new Date(body.endDatetime) : null,
      oneTimeUse: body.oneTimeUse,
      canUseMultipleTimes: body.canUseMultipleTimes,
      discountType: body.discountType,
      discount: body.discount.toString(),
      maximumDiscountAmount: body.maximumDiscountAmount,
    })
    .returning();
  void logAdminActivity(guard, {
    action: "coupon.create",
    entityType: "coupon",
    entityId: created.id,
    summary: `Created coupon ${created.couponCode}`,
    req,
  });
  return NextResponse.json({ coupon: created });
}

// erpDt() helper removed — only the ERPNext push needed the
// "YYYY-MM-DD HH:mm:ss" reformat, and that path is retired.
