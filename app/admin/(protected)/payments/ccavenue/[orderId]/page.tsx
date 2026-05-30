import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { eq, asc } from "drizzle-orm";
import {
  ArrowLeft,
  ExternalLink as ExternalLinkIcon,
  Receipt,
  ShieldCheck,
  AlertTriangle,
  Clock,
  CheckCircle2,
  XCircle,
  CreditCard,
  User,
} from "lucide-react";
import { db } from "@/db/client";
import { orders, payments, orderItems, parents, students } from "@/db/schema";
import { requireAnyPermission, isResponse } from "@/lib/admin-guard";
import {
  PageHeader,
  Card,
  CardHeader,
  Badge,
  statusTone,
  Money,
  Th,
  Td,
  Tr,
  EmptyState,
} from "@/components/admin/ui/primitives";

export const dynamic = "force-dynamic";

const STUCK_MINUTES = 15;

function absoluteTime(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const dd = typeof d === "string" ? new Date(d) : d;
  return dd.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function relativeOrAbsolute(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const dd = typeof d === "string" ? new Date(d) : d;
  const diffMs = Date.now() - dd.getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 60) return `${absoluteTime(dd)} · ${mins}m ago`;
  return absoluteTime(dd);
}

export default async function CCAvenuePaymentDetailPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const guard = await requireAnyPermission("payments-ccavenue.read", "payments-ccavenue.write");
  if (isResponse(guard)) redirect("/admin/dashboard");

  const { orderId } = await params;

  const [order] = await db
    .select()
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);
  if (!order) notFound();

  const [payment] = await db
    .select()
    .from(payments)
    .where(eq(payments.orderId, orderId))
    .limit(1);

  const [parent] = order.parentId
    ? await db.select().from(parents).where(eq(parents.id, order.parentId)).limit(1)
    : [null];

  const [student] = order.studentId
    ? await db.select().from(students).where(eq(students.id, order.studentId)).limit(1)
    : [null];

  const items = await db
    .select()
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId))
    .orderBy(asc(orderItems.nameSnapshot));

  const isStuck =
    !!payment &&
    payment.status === "pending" &&
    payment.paymentFinalized === false &&
    new Date(order.createdAt).getTime() <
      Date.now() - STUCK_MINUTES * 60_000;

  const paymentTone = statusTone(payment?.status ?? order.paymentStatus);
  const orderTone = statusTone(order.status);

  const shippingAddress = order.shippingAddress as {
    receiverName?: string;
    receiverPhone?: string;
    line1?: string;
    line2?: string;
    city?: string;
    state?: string;
    pincode?: string;
  } | null;

  const rawJson = payment?.raw ? JSON.stringify(payment.raw, null, 2) : null;

  return (
    <div>
      <PageHeader
        breadcrumb={[
          { label: "Accounting", href: "/admin/payments/ccavenue" },
          { label: "CCAvenue Payment Logs", href: "/admin/payments/ccavenue" },
          { label: order.orderNumber },
        ]}
        eyebrow="CCAvenue transaction"
        title={order.orderNumber}
        description={
          <span className="inline-flex items-center gap-2">
            Payment status{" "}
            <Badge size="sm" tone={paymentTone} dot>
              {payment?.status ?? order.paymentStatus}
            </Badge>
            <span className="text-ink-300">·</span>
            Order{" "}
            <Badge size="sm" tone={orderTone} dot>
              {order.status}
            </Badge>
            {isStuck ? (
              <>
                <span className="text-ink-300">·</span>
                <Badge size="sm" tone="warning">
                  stuck pending
                </Badge>
              </>
            ) : null}
          </span>
        }
        actions={
          <>
            <Link
              href="/admin/payments/ccavenue"
              className="inline-flex items-center gap-1.5 px-3 h-9 rounded-lg border border-ink-200 bg-white text-[13px] font-medium text-ink-700 hover:bg-cream-50"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Back to logs
            </Link>
            <Link
              href={`/admin/orders/${encodeURIComponent(order.orderNumber)}`}
              className="inline-flex items-center gap-1.5 px-3 h-9 rounded-lg border border-ink-200 bg-white text-[13px] font-medium text-ink-700 hover:bg-cream-50"
            >
              Open order <ExternalLinkIcon className="h-3.5 w-3.5" />
            </Link>
          </>
        }
      />

      {/* ── Stuck-pending callout ─────────────────────────────────────── */}
      {isStuck ? (
        <div className="mb-5 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3 text-[13px] text-amber-900">
          <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0 text-amber-600" />
          <div>
            <p className="font-bold">This checkout is stuck in pending.</p>
            <p className="mt-0.5">
              Created {relativeOrAbsolute(order.createdAt)} — no callback from
              CCAvenue has arrived. The customer likely closed the tab during
              payment, or the network dropped. There is no automatic timeout;
              follow up with the customer to retry, or cancel the order from
              the order detail page if it&apos;s no longer wanted.
            </p>
          </div>
        </div>
      ) : null}

      {/* ── Headline grid: amount + customer ─────────────────────────── */}
      <div className="grid md:grid-cols-2 gap-4 mb-5">
        <Card>
          <CardHeader
            title={
              <span className="inline-flex items-center gap-2">
                <Receipt className="h-4 w-4 text-ink-500" /> Amount
              </span>
            }
            description="As billed on this order — actual amount charged by CCAvenue may include gateway-side fees."
          />
          <dl className="mt-3 grid grid-cols-2 gap-y-1 text-[13px]">
            <dt className="text-ink-500">Subtotal</dt>
            <dd className="text-right tabular-nums text-ink-900">
              <Money paise={order.subtotal} />
            </dd>
            <dt className="text-ink-500">Tax</dt>
            <dd className="text-right tabular-nums text-ink-900">
              <Money paise={order.tax} />
            </dd>
            <dt className="text-ink-500">Shipping</dt>
            <dd className="text-right tabular-nums text-ink-900">
              <Money paise={order.shipping} />
            </dd>
            {order.discount > 0 ? (
              <>
                <dt className="text-ink-500">Discount</dt>
                <dd className="text-right tabular-nums text-emerald-700">
                  − <Money paise={order.discount} />
                </dd>
              </>
            ) : null}
            <dt className="pt-2 border-t border-ink-100 mt-2 font-semibold text-ink-900">
              Order total
            </dt>
            <dd className="pt-2 border-t border-ink-100 mt-2 text-right tabular-nums font-bold text-ink-900">
              <Money paise={order.total} />
            </dd>
            {payment?.paidAmount ? (
              <>
                <dt className="text-ink-500">Paid (gateway)</dt>
                <dd className="text-right tabular-nums text-emerald-700 font-semibold">
                  ₹{Number(payment.paidAmount).toLocaleString("en-IN", { maximumFractionDigits: 2 })}{" "}
                  <span className="text-[11px] text-ink-400">
                    {payment.paidCurrency ?? "INR"}
                  </span>
                </dd>
              </>
            ) : null}
            {order.refundedAmount > 0 ? (
              <>
                <dt className="text-ink-500">Refunded</dt>
                <dd className="text-right tabular-nums text-violet-700">
                  <Money paise={order.refundedAmount} />
                </dd>
              </>
            ) : null}
          </dl>
        </Card>

        <Card>
          <CardHeader
            title={
              <span className="inline-flex items-center gap-2">
                <User className="h-4 w-4 text-ink-500" /> Customer
              </span>
            }
          />
          <dl className="mt-3 space-y-1 text-[13px]">
            <KVRow label="Name" value={parent?.name ?? "—"} />
            <KVRow
              label="Phone"
              value={
                parent?.phone ? (
                  <span className="font-mono">{parent.phone}</span>
                ) : (
                  "—"
                )
              }
            />
            <KVRow label="Email" value={parent?.email ?? "—"} />
            <KVRow label="Student" value={student?.name ?? "—"} />
            <KVRow
              label="School (snapshot)"
              value={order.schoolNameSnapshot ?? "—"}
            />
            <KVRow
              label="Grade (snapshot)"
              value={order.gradeSnapshot ?? "—"}
            />
          </dl>
          {parent ? (
            <Link
              href={`/admin/customers/${parent.id}`}
              className="mt-3 inline-flex items-center gap-1 text-[12px] font-semibold text-blue-600 hover:underline"
            >
              Open customer record <ExternalLinkIcon className="h-3 w-3" />
            </Link>
          ) : null}
        </Card>
      </div>

      {/* ── Transaction details ──────────────────────────────────────── */}
      <Card className="mb-5">
        <CardHeader
          title={
            <span className="inline-flex items-center gap-2">
              <CreditCard className="h-4 w-4 text-ink-500" /> Transaction details
            </span>
          }
          description="Raw fields recorded against the payment row, mostly populated by the CCAvenue callback."
        />
        {payment ? (
          <div className="mt-3 grid sm:grid-cols-2 gap-x-8 gap-y-1 text-[13px]">
            <KVRow label="Provider" value={payment.provider} />
            <KVRow label="Gateway" value={payment.gatewayProvider} />
            <KVRow
              label="Payment mode"
              value={payment.paymentMode ?? "—"}
            />
            <KVRow label="Method" value={payment.method ?? "—"} />
            <KVRow
              label="Tracking ID"
              value={
                payment.gatewayTrackingId ? (
                  <span className="font-mono text-[12px]">
                    {payment.gatewayTrackingId}
                  </span>
                ) : (
                  "—"
                )
              }
            />
            <KVRow
              label="Internal ref"
              value={
                payment.internalPaymentReference ? (
                  <span className="font-mono text-[12px]">
                    {payment.internalPaymentReference}
                  </span>
                ) : (
                  "—"
                )
              }
            />
            <KVRow
              label="Gateway order ID"
              value={
                payment.gatewayOrderId ? (
                  <span className="font-mono text-[12px]">
                    {payment.gatewayOrderId}
                  </span>
                ) : (
                  "—"
                )
              }
            />
            <KVRow
              label="Provider payment ID"
              value={
                payment.providerPaymentId ? (
                  <span className="font-mono text-[12px]">
                    {payment.providerPaymentId}
                  </span>
                ) : (
                  "—"
                )
              }
            />
            <KVRow
              label="Currency"
              value={payment.paidCurrency ?? "INR"}
            />
            <KVRow
              label="Payment date (gateway)"
              value={payment.paymentDate ?? "—"}
            />
            <KVRow
              label="Attempt count"
              value={String(payment.paymentAttemptCount ?? 0)}
            />
            <KVRow
              label="Retry count"
              value={String(payment.paymentRetryCount ?? 0)}
            />
            <KVRow
              label="Finalized"
              value={
                payment.paymentFinalized ? (
                  <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Yes
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-amber-700 font-semibold">
                    <Clock className="h-3.5 w-3.5" /> No
                  </span>
                )
              }
            />
            <KVRow
              label="Refund status"
              value={
                payment.refundStatus === "NOT_REQUESTED" ? (
                  <span className="text-ink-500">Not requested</span>
                ) : (
                  <Badge size="sm" tone={statusTone(payment.refundStatus.toLowerCase())}>
                    {payment.refundStatus}
                  </Badge>
                )
              }
            />
            <KVRow
              label="Order submit error"
              value={
                payment.orderSubmitError ? (
                  <span className="inline-flex items-center gap-1 text-red-700 font-semibold">
                    <XCircle className="h-3.5 w-3.5" /> Yes
                  </span>
                ) : (
                  <span className="text-ink-500">No</span>
                )
              }
            />
            <div className="sm:col-span-2">
              <KVRow
                label="Gateway response"
                value={
                  payment.gatewayResponseMessage ? (
                    <span className="font-mono text-[12px] text-ink-700 break-all">
                      {payment.gatewayResponseMessage}
                    </span>
                  ) : (
                    "—"
                  )
                }
              />
            </div>
          </div>
        ) : (
          <p className="mt-3 text-[13px] text-ink-500">
            No payment row recorded for this order yet — this can happen if
            the order was created manually rather than via the storefront
            CCAvenue flow.
          </p>
        )}
      </Card>

      {/* ── Timeline ─────────────────────────────────────────────────── */}
      <Card className="mb-5">
        <CardHeader
          title={
            <span className="inline-flex items-center gap-2">
              <Clock className="h-4 w-4 text-ink-500" /> Timeline
            </span>
          }
          description="Order + payment lifecycle. The gateway-reported date is whatever CCAvenue stamped on its side."
        />
        <ol className="mt-3 relative border-l border-ink-100 pl-4 space-y-3 text-[13px]">
          <TimelineStep
            label="Order created"
            at={order.createdAt}
            tone="success"
          />
          <TimelineStep
            label="Payment row created"
            at={payment?.createdAt}
            tone="success"
          />
          <TimelineStep
            label="Payment date (gateway-reported)"
            value={payment?.paymentDate ?? null}
            tone={payment?.paymentDate ? "success" : "subtle"}
          />
          <TimelineStep
            label="Payment finalized"
            value={
              payment?.paymentFinalized
                ? "Yes"
                : payment
                  ? "Awaiting callback"
                  : "—"
            }
            tone={payment?.paymentFinalized ? "success" : "warning"}
          />
          <TimelineStep
            label="Order confirmed"
            at={order.confirmedAt}
            tone={order.confirmedAt ? "success" : "subtle"}
          />
          <TimelineStep
            label="Order packed"
            at={order.packedAt}
            tone={order.packedAt ? "success" : "subtle"}
          />
          <TimelineStep
            label="Order shipped"
            at={order.shippedAt}
            tone={order.shippedAt ? "success" : "subtle"}
          />
          <TimelineStep
            label="Order delivered"
            at={order.deliveredAt}
            tone={order.deliveredAt ? "success" : "subtle"}
          />
        </ol>
      </Card>

      {/* ── Items ────────────────────────────────────────────────────── */}
      <Card padded={false} className="mb-5">
        <div className="px-5 py-4 border-b border-ink-100">
          <CardHeader
            title={
              <span className="inline-flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-ink-500" /> Items in this order
              </span>
            }
            description={`${items.length} line item${items.length === 1 ? "" : "s"}`}
          />
        </div>
        {items.length === 0 ? (
          <EmptyState
            icon={Receipt}
            title="No items"
            description="This order has no item rows recorded."
          />
        ) : (
          <table className="w-full">
            <thead>
              <tr>
                <Th>Product</Th>
                <Th>Size</Th>
                <Th right>Qty</Th>
                <Th right>Unit price</Th>
                <Th right>Total</Th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <Tr key={it.id}>
                  <Td>{it.nameSnapshot}</Td>
                  <Td muted>{it.size}</Td>
                  <Td right>
                    <span className="tabular-nums">{it.qty}</span>
                  </Td>
                  <Td right>
                    <Money paise={it.unitPrice} />
                  </Td>
                  <Td right>
                    <Money paise={it.total} className="font-semibold" />
                  </Td>
                </Tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {/* ── Shipping address ─────────────────────────────────────────── */}
      {shippingAddress ? (
        <Card className="mb-5">
          <CardHeader title="Shipping address" />
          <div className="mt-2 text-[13px] text-ink-700 leading-relaxed">
            <p className="font-semibold text-ink-900">
              {shippingAddress.receiverName ?? "—"}
              {shippingAddress.receiverPhone ? (
                <span className="ml-2 font-mono text-[12px] text-ink-500">
                  {shippingAddress.receiverPhone}
                </span>
              ) : null}
            </p>
            <p>{shippingAddress.line1 ?? "—"}</p>
            {shippingAddress.line2 ? <p>{shippingAddress.line2}</p> : null}
            <p>
              {[shippingAddress.city, shippingAddress.state, shippingAddress.pincode]
                .filter(Boolean)
                .join(", ")}
            </p>
          </div>
        </Card>
      ) : null}

      {/* ── Raw gateway payload (collapsible) ────────────────────────── */}
      {rawJson ? (
        <Card>
          <details className="group">
            <summary className="flex items-center justify-between gap-2 cursor-pointer list-none">
              <span className="text-[13px] font-semibold text-ink-700">
                Raw gateway response
              </span>
              <span className="text-[11px] text-ink-500 group-open:hidden">
                Click to expand
              </span>
              <span className="text-[11px] text-ink-500 hidden group-open:inline">
                Click to collapse
              </span>
            </summary>
            <pre className="mt-3 max-h-96 overflow-auto rounded-lg bg-ink-900/95 text-ink-50 text-[11.5px] font-mono p-3 leading-relaxed">
              {rawJson}
            </pre>
          </details>
        </Card>
      ) : null}
    </div>
  );
}

function KVRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline gap-3 py-1 border-b border-ink-50 last:border-b-0">
      <dt className="text-[12px] text-ink-500 min-w-[140px]">{label}</dt>
      <dd className="text-[13px] text-ink-900 flex-1 break-all">{value}</dd>
    </div>
  );
}

function TimelineStep({
  label,
  at,
  value,
  tone,
}: {
  label: string;
  at?: Date | string | null;
  value?: string | null;
  tone: "success" | "warning" | "subtle";
}) {
  const dotCls =
    tone === "success"
      ? "bg-emerald-500"
      : tone === "warning"
        ? "bg-amber-500"
        : "bg-ink-200";
  const textCls =
    tone === "subtle" ? "text-ink-400" : "text-ink-700";
  const display = at != null ? absoluteTime(at) : (value ?? "—");
  return (
    <li className="relative">
      <span
        className={`absolute -left-[21px] top-1 h-2 w-2 rounded-full ${dotCls}`}
      />
      <div className="text-[12px] text-ink-500">{label}</div>
      <div className={`text-[13px] ${textCls}`}>{display}</div>
    </li>
  );
}
