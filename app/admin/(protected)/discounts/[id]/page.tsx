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
  Stat,
  Money,
  Th,
  Td,
  Tr,
  EmptyState,
} from "@/components/admin/ui/primitives";
import { Receipt } from "lucide-react";
import {
  WebsiteCartCouponForm,
  type CouponInitial,
} from "@/components/admin/WebsiteCartCouponForm";
import { RecordHistory } from "@/components/admin/RecordHistory";

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
    <div className="max-w-6xl">
      <PageHeader
        breadcrumb={[
          { label: "Discounts", href: "/admin/discounts" },
          { label: c.couponCode },
        ]}
        title={c.couponCode}
        description="Edits round-trip to ERPNext."
      />
      <Card>
        <WebsiteCartCouponForm mode="edit" initial={initial} />
      </Card>

      <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Stat
          label="Total redemptions"
          value={totalUsage.toLocaleString("en-IN")}
          iconTone="info"
        />
        <Stat
          label="Total discount given"
          value={<Money paise={totalDiscount} />}
          iconTone="success"
        />
      </div>

      <Card padded={false} className="mt-3">
        {usages.length === 0 ? (
          <EmptyState
            icon={Receipt}
            title="No redemptions yet"
            description="No paid orders reference this coupon. Usage rows are written when CCAvenue confirms payment success."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr>
                  <Th>Order #</Th>
                  <Th>School</Th>
                  <Th>Student</Th>
                  <Th>Enrollment</Th>
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
                  const orderLink = u.orderId
                    ? `/admin/orders/${u.orderId}`
                    : null;
                  const orderLabel =
                    u.orderNumber ?? u.erpSalesOrder ?? "—";
                  const usedAt = u.createdAt ?? u.orderPlacedAt ?? null;
                  const orderAmount = u.orderTotal ?? u.legacyOrderAmount ?? 0;
                  return (
                    <Tr key={u.id}>
                      <Td>
                        {orderLink ? (
                          <Link
                            href={orderLink}
                            className="font-mono text-[12.5px] font-semibold text-ink-900 hover:text-brand"
                          >
                            {orderLabel}
                          </Link>
                        ) : (
                          <span className="font-mono text-[12.5px] font-semibold text-ink-700">
                            {orderLabel}
                          </span>
                        )}
                        {u.orderPaymentStatus &&
                        u.orderPaymentStatus !== "paid" ? (
                          <span className="ml-1.5 text-[10px] uppercase text-amber-700">
                            ({u.orderPaymentStatus})
                          </span>
                        ) : null}
                      </Td>
                      <Td muted>
                        {u.schoolName ?? <span className="text-ink-400">—</span>}
                        {u.schoolCode ? (
                          <div className="text-[10px] text-ink-400 font-mono mt-0.5">
                            {u.schoolCode}
                          </div>
                        ) : null}
                      </Td>
                      <Td muted>{studentName}</Td>
                      <Td muted>
                        {u.enrollmentNumber ? (
                          <span className="font-mono text-[11.5px]">
                            {u.enrollmentNumber}
                          </span>
                        ) : (
                          <span className="text-ink-400">—</span>
                        )}
                      </Td>
                      <Td muted className="whitespace-nowrap">
                        {fmtIst(usedAt)}
                      </Td>
                      <Td right>
                        <Money paise={orderAmount} />
                      </Td>
                      <Td right>
                        <span className="text-emerald-700 font-semibold">
                          <Money paise={u.amountSaved ?? 0} />
                        </span>
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="mt-5">
        <RecordHistory entityType="coupon" entityId={id} title="Coupon history" />
      </div>
    </div>
  );
}
