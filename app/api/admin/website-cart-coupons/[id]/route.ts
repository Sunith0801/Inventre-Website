import { NextResponse } from "next/server";
import { parseBody } from "@/lib/parse-body";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { websiteCartCoupons, schools, students } from "@/db/schema";
import { isResponse, requirePermission } from "@/lib/admin-guard";

const Body = z.object({
  couponCode: z.string().min(2).max(64).optional(),
  isActive: z.boolean().optional(),
  schoolErpName: z.string().nullable().optional(),
  studentErpName: z.string().nullable().optional(),
  grade: z.string().min(1).max(64).nullable().optional(),
  startDatetime: z.string().nullable().optional(),
  endDatetime: z.string().nullable().optional(),
  oneTimeUse: z.boolean().optional(),
  canUseMultipleTimes: z.boolean().optional(),
  discountType: z.enum(["Fixed", "Percentage"]).optional(),
  discount: z.number().nonnegative().optional(),
  maximumDiscountAmount: z.number().int().nonnegative().optional(),
});

export async function GET(
  _: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requirePermission("discounts.read");
  if (isResponse(guard)) return guard;
  const { id } = await params;
  const [row] = await db
    .select()
    .from(websiteCartCoupons)
    .where(eq(websiteCartCoupons.id, id))
    .limit(1);
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ coupon: row });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requirePermission("discounts.write");
  if (isResponse(guard)) return guard;
  const { id } = await params;
  const parsed = await parseBody(req, Body);
  if (parsed instanceof NextResponse) return parsed;
  const body = parsed;

  const [existing] = await db
    .select()
    .from(websiteCartCoupons)
    .where(eq(websiteCartCoupons.id, id))
    .limit(1);
  if (!existing)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Resolve FK changes
  const update: Record<string, unknown> = { updatedAt: new Date() };
  if (body.couponCode !== undefined) update.couponCode = body.couponCode;
  if (body.isActive !== undefined) update.isActive = body.isActive;
  if (body.startDatetime !== undefined)
    update.startDatetime = body.startDatetime ? new Date(body.startDatetime) : null;
  if (body.endDatetime !== undefined)
    update.endDatetime = body.endDatetime ? new Date(body.endDatetime) : null;
  if (body.oneTimeUse !== undefined) update.oneTimeUse = body.oneTimeUse;
  if (body.canUseMultipleTimes !== undefined)
    update.canUseMultipleTimes = body.canUseMultipleTimes;
  if (body.discountType !== undefined) update.discountType = body.discountType;
  if (body.discount !== undefined) update.discount = body.discount.toString();
  if (body.maximumDiscountAmount !== undefined)
    update.maximumDiscountAmount = body.maximumDiscountAmount;

  if (body.schoolErpName !== undefined) {
    update.schoolErpName = body.schoolErpName ?? null;
    if (body.schoolErpName) {
      const [s] = await db
        .select({ id: schools.id })
        .from(schools)
        .where(eq(schools.erpName, body.schoolErpName))
        .limit(1);
      update.schoolId = s?.id ?? null;
    } else {
      update.schoolId = null;
    }
  }
  if (body.grade !== undefined) update.grade = body.grade ?? null;
  // If school is being cleared, drop grade too (grade has no meaning without school).
  if (body.schoolErpName === null) update.grade = null;

  if (body.studentErpName !== undefined) {
    update.studentErpName = body.studentErpName ?? null;
    if (body.studentErpName) {
      const [s] = await db
        .select({ id: students.id })
        .from(students)
        .where(eq(students.erpName, body.studentErpName))
        .limit(1);
      update.studentId = s?.id ?? null;
    } else {
      update.studentId = null;
    }
  }

  // ERPNext mirror retired (erp.inventre.in dead). Edits are local-only
  // even for rows that carry erp_name from the original import — that
  // value is preserved as audit-trail of where the row originated.

  await db
    .update(websiteCartCoupons)
    .set(update)
    .where(eq(websiteCartCoupons.id, id));
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requirePermission("discounts.write");
  if (isResponse(guard)) return guard;
  const { id } = await params;
  const [existing] = await db
    .select()
    .from(websiteCartCoupons)
    .where(eq(websiteCartCoupons.id, id))
    .limit(1);
  if (!existing)
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  // ERPNext delete retired. Just drop the local row.
  await db.delete(websiteCartCoupons).where(eq(websiteCartCoupons.id, id));
  return NextResponse.json({ ok: true });
}
