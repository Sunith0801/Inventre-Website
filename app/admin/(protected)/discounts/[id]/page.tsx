import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db/client";
import {
  websiteCartCoupons,
  websiteCartCouponUsages,
  orders,
  students,
  schools,
} from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import {
  PageHeader,
  Card,
  CardHeader,
  Stat,
  Money,
  Th,
  Td,
  Tr,
} from "@/components/admin/ui/primitives";
import {
  WebsiteCartCouponForm,
  type CouponInitial,
} from "@/components/admin/WebsiteCartCouponForm";

export const dynamic = "force-dynamic";

// IST formatter mirrors what /admin/orders uses.
const IST_FMT = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  year: "numeric",
  month: "short",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
function fmtIst(d: Date | null | undefined): string {
  return d ? IST_FMT.format(d) : "—";
}

export default async function EditDiscountPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [c] = await db
    .select()
    .from(websiteCartCoupons)
    .where(eq(websiteCartCoupons.id, id))
    .limit(1);
  if (!c) notFound();

  const initial: CouponInitial = {
    id: c.id,
    erpName: c.erpName,
    couponCode: c.couponCode,
    isActive: c.isActive,
    schoolErpName: c.schoolErpName,
    studentErpName: c.studentErpName,
    grade: c.grade,
    startDatetime: c.startDatetime ? c.startDatetime.toISOString() : null,
    endDatetime: c.endDatetime ? c.endDatetime.toISOString() : null,
    oneTimeUse: c.oneTimeUse,
    canUseMultipleTimes: c.canUseMultipleTimes,
    discountType: c.discountType,
    discount: Number(c.discount),
    maximumDiscountAmount: c.maximumDiscountAmount,
  };

  // Redemption audit. Joins through orders → students → schools so each
  // row carries the school, student name, enrollment number, IST timestamp
  // and links to the order detail page. Legacy ERP-only rows (where
  // orderId is null — populated by scripts/import-coupon-usages.ts) keep
  // showing the customerName / erpSalesOrder / transactionDate columns.
  const usages = await db
    .select({
      id: websiteCartCouponUsages.id,
      amountSaved: websiteCartCouponUsages.amountSaved,
      transactionDate: websiteCartCouponUsages.transactionDate,
      createdAt: websiteCartCouponUsages.createdAt,
      erpSalesOrder: websiteCartCouponUsages.erpSalesOrder,
      customerName: websiteCartCouponUsages.customerName,
      legacyOrderAmount: websiteCartCouponUsages.orderAmount,
      orderId: orders.id,
      orderNumber: orders.orderNumber,
      orderTotal: orders.total,
      orderPlacedAt: orders.placedAt,
      orderPaymentStatus: orders.paymentStatus,
      studentName: students.name,
      studentFirstName: students.firstName,
      studentLastName: students.lastName,
      enrollmentNumber: students.enrollmentNumber,
      schoolName: schools.name,
      schoolCode: schools.schoolCode,
    })
    .from(websiteCartCouponUsages)
    .leftJoin(orders, eq(orders.id, websiteCartCouponUsages.orderId))
    .leftJoin(students, eq(students.id, orders.studentId))
    .leftJoin(schools, eq(schools.id, orders.schoolId))
    .where(eq(websiteCartCouponUsages.couponId, c.id))
    .orderBy(desc(websiteCartCouponUsages.createdAt));

  const totalUsage = usages.length;
  const totalDiscount = usages.reduce((s, u) => s + (u.amountSaved ?? 0), 0);

  return (
    <div>
      <PageHeader
        breadcrumb={[{ label: "Discounts & Promotions", href: "/admin/discounts" }, { label: c.couponCode }]}
        eyebrow="Pricing & Tax"
        title={c.couponCode}
        description={`${c.discountType === "Percentage" ? `${Number(c.discount)}% off` : `₹${Number(c.discount).toLocaleString("en-IN")} off`} · ${c.isActive ? "active" : "inactive"}${c.erpName ? ` · ERPNext ${c.erpName}` : " · not yet in ERPNext"}`}
      />

      {/* Form on the left, redemption totals beside it — one screen, no scrolling
          past four stacked sections to find out whether it was ever used. */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_260px]">
        <Card>
          <WebsiteCartCouponForm mode="edit" initial={initial} />
        </Card>
        <div className="grid grid-cols-2 gap-3 self-start xl:grid-cols-1">
          <Stat label="Redemptions" value={totalUsage.toLocaleString("en-IN")} />
          <Stat label="Discount given" value={<Money paise={totalDiscount} />} />
        </div>
      </div>

      {usages.length > 0 ? (
        <Card padded={false} className="mt-5 overflow-hidden">
          <div className="px-5 pt-5 lg:px-6">
            <CardHeader title="Redemptions" description={`${totalUsage} order${totalUsage === 1 ? "" : "s"} used this coupon`} className="mb-3" />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <Th>Order</Th>
                  <Th>School</Th>
                  <Th>Student</Th>
                  <Th>Used at (IST)</Th>
                  <Th right>Order amount</Th>
                  <Th right>Saved</Th>
                </tr>
              </thead>
              <tbody>
                {usages.map((u) => {
                  const studentName =
                    [u.studentFirstName, u.studentLastName].filter(Boolean).join(" ").trim() ||
                    u.studentName ||
                    u.customerName ||
                    "—";
                  const orderLink = u.orderId ? `/admin/orders/${u.orderId}` : null;
                  const orderLabel = u.orderNumber ?? u.erpSalesOrder ?? "—";
                  const usedAt = u.createdAt ?? u.orderPlacedAt ?? null;
                  const orderAmount = u.orderTotal ?? u.legacyOrderAmount ?? 0;
                  return (
                    <Tr key={u.id}>
                      <Td>
                        {orderLink ? (
                          <Link href={orderLink} className="font-mono font-semibold text-ink-900 hover:text-brand-700">
                            {orderLabel}
                          </Link>
                        ) : (
                          <span className="font-mono font-semibold text-ink-700">{orderLabel}</span>
                        )}
                        {u.orderPaymentStatus && u.orderPaymentStatus !== "paid" ? (
                          <span className="ml-1.5 text-[10px] uppercase text-amber-700">({u.orderPaymentStatus})</span>
                        ) : null}
                      </Td>
                      <Td muted>{u.schoolName ?? <span className="text-ink-300">—</span>}</Td>
                      <Td muted>
                        {studentName}
                        {u.enrollmentNumber ? <span className="block font-mono text-[11.5px]">{u.enrollmentNumber}</span> : null}
                      </Td>
                      <Td muted className="whitespace-nowrap">{fmtIst(usedAt)}</Td>
                      <Td right><Money paise={orderAmount} /></Td>
                      <Td right><span className="font-semibold text-emerald-700"><Money paise={u.amountSaved ?? 0} /></span></Td>
                    </Tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
