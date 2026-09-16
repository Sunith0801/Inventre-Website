import Link from "next/link";
import type { ReactNode } from "react";
import { eq, or, sql, inArray } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db/client";
import {
  orders,
  orderItems,
  parents,
  schools,
  students,
  invoices,
  payments,
  productVariantAttributes,
  productAttributes,
  productAttributeValues,
} from "@/db/schema";
import { OrderStatusForm } from "@/components/admin/OrderStatusForm";
import { OrderShippingCard } from "@/components/admin/OrderShippingCard";
import { OrderActions } from "@/components/admin/OrderActions";
import { RecordHistory } from "@/components/admin/RecordHistory";
import { DeleteOrderButton } from "@/components/admin/DeleteOrderButton";
import { CancelOrderButton } from "@/components/admin/CancelOrderButton";
import { RefreshCcaButton } from "@/components/admin/RefreshCcaButton";
import { OrderTrackingCard } from "@/components/admin/OrderTrackingCard";
import {
  PageHeader,
  Card,
  CardHeader,
  Badge,
  Money,
  Th,
  Td,
  Tr,
  Stat,
  statusTone,
} from "@/components/admin/ui/primitives";

export const dynamic = "force-dynamic";

export default async function AdminOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const decoded = decodeURIComponent(id);
  const isUuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      decoded
    );
  // Accept either the orders.id UUID or the orders.order_number (e.g.
  // SAL-ORD-2026-27089) — the listing links by order_number, callers
  // may bookmark either form. When a slug matches one row on
  // `order_number` and a different row on `erp_so_name`, prefer the
  // local `order_number` match — that's the authoritative ID; the
  // erp_so_name fallback is only there for legacy data where the two
  // numbers diverged.
  const [order] = isUuid
    ? await db.select().from(orders).where(eq(orders.id, decoded)).limit(1)
    : await db
        .select()
        .from(orders)
        .where(or(eq(orders.orderNumber, decoded), eq(orders.erpSoName, decoded)))
        .orderBy(sql`CASE WHEN ${orders.orderNumber} = ${decoded} THEN 0 ELSE 1 END`)
        .limit(1);
  if (!order) {
    // Not a storefront order. Try the ERP mirror (poll-back) then the
    // legacy bulk ERPNext table — show a minimal read-only view.
    return await renderErpReadOnly(decoded);
  }

  // Fan all detail-page reads out in parallel — they're independent
  // (all keyed off `order.*`) so there's no reason to await them
  // sequentially. Before: ~6 round-trips × ~80ms each = ~500ms purely
  // on Drizzle latency. Now: max(individual queries) ≈ 80ms.
  const [parents_, schools_, students_, items, invoices_, payments_] =
    await Promise.all([
      db.select().from(parents).where(eq(parents.id, order.parentId)),
      db.select().from(schools).where(eq(schools.id, order.schoolId)),
      order.studentId
        ? db.select().from(students).where(eq(students.id, order.studentId))
        : Promise.resolve([null] as const),
      db.select().from(orderItems).where(eq(orderItems.orderId, order.id)),
      db
        .select({ id: invoices.id, invoiceNumber: invoices.invoiceNumber })
        .from(invoices)
        .where(eq(invoices.orderId, order.id))
        .limit(1),
      // Payment row carries every CCAvenue / payment-gateway field we
      // captured at import time. The detail page surfaces all of them so
      // ops can audit a payment without round-tripping to ERPNext.
      db
        .select()
        .from(payments)
        .where(eq(payments.orderId, order.id))
        .orderBy(payments.createdAt)
        .limit(1),
    ]);
  const [parent] = parents_;
  const [school] = schools_;
  const [student] = students_;
  const [existingInvoice] = invoices_;
  const [paymentRow] = payments_;

  // Resolve the COLOUR attribute per line item (size already shows in its
  // own column). order_items only stores `size`; colour lives in
  // product_variant_attributes, so join it here and expose a
  // variantId → "Blue" map for the item table. Any attribute whose name
  // reads like a colour axis (e.g. "CEL T-Shirt Color", "Uniform Colour")
  // is surfaced; size/other axes are left to the existing size column.
  const itemVariantIds = Array.from(
    new Set(
      items
        .map((it) => it.variantId)
        .filter((v): v is string =>
          !!v &&
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v),
        ),
    ),
  );
  const colourByVariant = new Map<string, string>();
  if (itemVariantIds.length > 0) {
    const attrRows = await db
      .select({
        variantId: productVariantAttributes.variantId,
        attrName: productAttributes.name,
        value: productAttributeValues.value,
      })
      .from(productVariantAttributes)
      .innerJoin(
        productAttributes,
        eq(productAttributes.id, productVariantAttributes.attributeId),
      )
      .innerJoin(
        productAttributeValues,
        eq(productAttributeValues.id, productVariantAttributes.valueId),
      )
      .where(inArray(productVariantAttributes.variantId, itemVariantIds));
    for (const r of attrRows) {
      if (/colou?r/i.test(r.attrName)) colourByVariant.set(r.variantId, r.value);
    }
  }

  // ERP-side payment fields — fall back to these when the local
  // payments row hasn't captured a value (older orders synced before
  // we started persisting every field, or import ordering quirks).
  const erpSO =
    ((order.erpRaw as { salesOrder?: Record<string, string | null> } | null)
      ?.salesOrder) ?? {};
  const pickFirst = (...vals: (string | null | undefined)[]): string | null => {
    for (const v of vals) {
      if (v != null && String(v).trim() !== "") return String(v);
    }
    return null;
  };
  const gatewayTrackingId = pickFirst(
    paymentRow?.gatewayTrackingId,
    erpSO.custom_gateway_tracking_id
  );
  const gatewayOrderId = pickFirst(
    paymentRow?.gatewayOrderId,
    erpSO.custom_gateway_order_id
  );
  const providerPaymentId = pickFirst(
    paymentRow?.providerPaymentId,
    erpSO.custom_gateway_order_id
  );
  const internalPaymentReference = pickFirst(
    paymentRow?.internalPaymentReference,
    erpSO.custom_internal_payment_reference
  );
  const paymentDateDisplay = pickFirst(
    paymentRow?.paymentDate,
    erpSO.custom_payment_date
  );

  const addr = order.shippingAddress as {
    receiverName: string;
    receiverPhone: string;
    line1: string;
    line2?: string;
    city: string;
    state: string;
    pincode: string;
  };

  // ERPNext stores child-item rows on the Sales Order header in
  // `custom_sub_items` (a "Sale Order Sub Items" doctype array). Each
  // entry points back to its parent line via `parent_item_code`. We
  // group them so the Sub items table can render an expandable
  // accordion under bundle parents (BookKits, Magic Boxes, etc.)
  // without round-tripping to ERPNext.
  type ErpSubItem = {
    item_code: string;
    qty: number;
    parent_item_code: string;
    idx?: number;
    status?: string;
  };
  const rawSubItems = (((order.erpRaw as { salesOrder?: { custom_sub_items?: unknown } } | null)
    ?.salesOrder?.custom_sub_items) ?? []) as ErpSubItem[];
  const subItemsByParent = new Map<string, ErpSubItem[]>();
  for (const s of rawSubItems) {
    if (!s?.parent_item_code) continue;
    const arr = subItemsByParent.get(s.parent_item_code) ?? [];
    arr.push(s);
    subItemsByParent.set(s.parent_item_code, arr);
  }
  // Fallback for orders not yet polled back from ERP (e.g. offline imports):
  // expand the local `bundle_selections` jsonb into the same child shape so
  // Magic Box / BookKit contents render even before erpRaw is populated.
  const localBundleChildren = (it: (typeof items)[number]): ErpSubItem[] => {
    const sels = Array.isArray(it.bundleSelections)
      ? (it.bundleSelections as { name?: string; size?: string; qty?: number; status?: string }[])
      : [];
    return sels.map((s, i) => ({
      item_code: [s?.name, s?.size].filter(Boolean).join(" · ") || "item",
      qty: typeof s?.qty === "number" ? s.qty : 1,
      parent_item_code: it.size,
      idx: i,
      status: typeof s?.status === "string" ? s.status : undefined,
    }));
  };
  const childrenFor = (it: (typeof items)[number]): ErpSubItem[] => {
    const erp = subItemsByParent.get(it.size) ?? [];
    return erp.length > 0 ? erp : localBundleChildren(it);
  };
  const totalChildren = items.reduce((n, it) => n + childrenFor(it).length, 0);

  const placed = new Date(order.placedAt ?? order.createdAt);
  const totalQty = items.reduce((n, it) => n + it.qty, 0);
  const anyHsn = items.some((it) => !!it.hsnCodeSnapshot);
  const paymentLabel = paymentRow?.paymentMode ?? paymentRow?.method ?? null;
  const fmtDay = (d: Date | string | null | undefined) =>
    d ? new Date(d).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" }) : "—";

  return (
    <div>
      <PageHeader
        eyebrow="Sales & Distribution"
        breadcrumb={[{ label: "Sales Orders", href: "/admin/orders" }, { label: order.orderNumber }]}
        title={order.orderNumber}
        description={
          <span className="flex flex-wrap items-center gap-2 text-[13px]">
            <span className="text-ink-500">
              Placed {placed.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true })}
            </span>
            <Badge tone={statusTone(order.status)} dot size="sm" className="capitalize">{order.status}</Badge>
            <Badge tone={statusTone(order.paymentStatus)} size="sm" className="capitalize">{order.paymentStatus}</Badge>
            {/* Audit-sync state. Post-fix we expect erpSoName === orderNumber
                on every paid order. The "Audit: <id>" variant is a canary
                that fires if drift ever re-emerges — should never show. */}
            {order.erpSoName == null ? (
              <Badge tone="default" size="sm">Audit pending</Badge>
            ) : order.erpSoName === order.orderNumber ? (
              <Badge tone="success" size="sm">Audit synced</Badge>
            ) : (
              <Badge tone="warning" size="sm">Audit: {order.erpSoName}</Badge>
            )}
          </span>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <OrderStatusForm orderId={order.id} status={order.status} />
            <CancelOrderButton orderId={order.id} orderNumber={order.orderNumber} status={order.status} />
            <DeleteOrderButton orderId={order.id} orderNumber={order.orderNumber} />
          </div>
        }
      />

      {/* The four numbers an operator asks for first. */}
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <Stat label="Order total" value={<Money paise={order.total} />} hint={`${items.length} line${items.length === 1 ? "" : "s"} · ${totalQty} unit${totalQty === 1 ? "" : "s"}`} />
        <Stat
          label="Payment"
          value={<span className="capitalize">{paymentRow?.status ?? order.paymentStatus}</span>}
          hint={[paymentRow?.gatewayProvider ?? paymentRow?.provider, paymentLabel].filter(Boolean).join(" · ") || "No gateway record"}
        />
        <Stat
          label="Invoice"
          value={existingInvoice ? <span className="font-mono text-[20px]">{existingInvoice.invoiceNumber}</span> : <span className="text-ink-300">—</span>}
          hint={existingInvoice ? "Generated" : "Not generated yet"}
        />
        <Stat
          label="Delivery"
          value={<span className="capitalize">{order.status}</span>}
          hint={`${order.deliveredAt ? `Delivered ${fmtDay(order.deliveredAt)}` : order.shippedAt ? `Shipped ${fmtDay(order.shippedAt)}` : order.confirmedAt ? `Confirmed ${fmtDay(order.confirmedAt)}` : "Awaiting confirmation"} · from audit ERP`}
        />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          {/* Items — bundle parents expose their children via a native
              <details> accordion so the page stays a pure server component. */}
          <Card padded={false} className="overflow-hidden">
            <div className="px-5 pt-5 lg:px-6">
              <CardHeader
                title="Items"
                description={`${items.length} line${items.length === 1 ? "" : "s"}${totalChildren > 0 ? ` · ${totalChildren} bundle item${totalChildren === 1 ? "" : "s"}` : ""}`}
                className="mb-3"
              />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr>
                    <Th>Item</Th>
                    <Th>ERP code / size</Th>
                    {anyHsn ? <Th>HSN</Th> : null}
                    <Th right>Qty</Th>
                    <Th right>Unit price</Th>
                    <Th right>Total</Th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it) => {
                    // Bundle children are keyed by the ERP item_code we
                    // snapshotted into `size` at import time.
                    const children = childrenFor(it);
                    const hasChildren = children.length > 0;
                    const colour = it.variantId ? colourByVariant.get(it.variantId) : undefined;
                    return (
                      <Tr key={it.id} className="align-top">
                        <Td>
                          {hasChildren ? (
                            <details className="group">
                              <summary className="flex cursor-pointer list-none items-start gap-2 select-none">
                                <span className="mt-0.5 inline-flex h-5 w-5 items-center justify-center rounded-md bg-brand-50 text-[12px] font-bold text-brand-700 transition-transform group-open:rotate-90" aria-hidden>›</span>
                                <span className="min-w-0 flex-1">
                                  <span className="font-semibold text-ink-900">{it.nameSnapshot}</span>
                                  <span className="ml-2 inline-flex items-center rounded-full border border-brand-200/70 bg-brand-50 px-2 py-0.5 text-[10.5px] font-semibold text-brand-700">
                                    Bundle · {children.length}
                                  </span>
                                  {it.variantId === null ? <span className="ml-1.5 inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10.5px] font-semibold text-amber-700">unmapped SKU</span> : null}
                                </span>
                              </summary>
                              <ul className="ml-7 mt-2 divide-y divide-ink-100/70 rounded-lg border border-ink-100/80 bg-cream-50/60 text-[12.5px]">
                                {children
                                  .slice()
                                  .sort((a, b) => (a.idx ?? 0) - (b.idx ?? 0))
                                  .map((c) => (
                                    <li key={c.item_code + "-" + (c.idx ?? 0)} className="flex items-center justify-between gap-3 px-3 py-1.5">
                                      <span className="min-w-0 font-mono text-ink-800">
                                        {c.item_code}
                                        {c.status ? (
                                          <Badge size="sm" className="ml-2" tone={/deliver/i.test(c.status) ? "success" : /pack/i.test(c.status) ? "info" : "warning"}>{c.status}</Badge>
                                        ) : null}
                                      </span>
                                      <span className="tabular-nums text-ink-600">× {c.qty}</span>
                                    </li>
                                  ))}
                              </ul>
                            </details>
                          ) : (
                            <span>
                              <span className="font-semibold text-ink-900">{it.nameSnapshot}</span>
                              {colour ? <span className="ml-2 inline-flex items-center rounded-full border border-ink-200 bg-ink-50 px-2 py-0.5 text-[10.5px] font-semibold text-ink-700">{colour}</span> : null}
                              {it.variantId === null ? <span className="ml-1.5 inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10.5px] font-semibold text-amber-700">unmapped SKU</span> : null}
                            </span>
                          )}
                        </Td>
                        <Td muted><span className="font-mono">{it.size}</span></Td>
                        {anyHsn ? <Td muted><span className="font-mono">{it.hsnCodeSnapshot ?? "—"}</span></Td> : null}
                        <Td right>{it.qty}</Td>
                        <Td right muted><Money paise={it.unitPrice} /></Td>
                        <Td right><Money paise={it.total} className="font-semibold" /></Td>
                      </Tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {/* Totals block — the arithmetic behind the number at the top. */}
            <div className="flex justify-end border-t border-ink-100/70 bg-cream-50/40 px-5 py-4 lg:px-6">
              <dl className="w-full max-w-[300px] space-y-1.5 text-[13px]">
                <div className="flex justify-between text-ink-600"><dt>Subtotal</dt><dd><Money paise={order.subtotal} /></dd></div>
                {order.discount > 0 ? <div className="flex justify-between text-ink-600"><dt>Discount</dt><dd className="text-emerald-700">− <Money paise={order.discount} /></dd></div> : null}
                <div className="flex justify-between text-ink-600"><dt>Delivery</dt><dd>{order.shipping > 0 ? <Money paise={order.shipping} /> : "Free"}</dd></div>
                {order.tax > 0 ? <div className="flex justify-between text-ink-600"><dt>Tax</dt><dd><Money paise={order.tax} /></dd></div> : null}
                <div className="flex justify-between border-t border-ink-200 pt-2 text-[15px] font-bold text-ink-900"><dt>Total</dt><dd><Money paise={order.total} /></dd></div>
              </dl>
            </div>
          </Card>

          {/* Delivery tracking — the audit ERP's shipments + carrier scans. */}
          <OrderTrackingCard parentId={order.parentId} orderNumber={order.orderNumber} />

          {/* Delivery address — inline edit; saving re-pushes to audit. */}
          <OrderShippingCard orderId={order.id} address={addr} accountPhone={parent?.phone ?? ""} />

          {/* Payment — the gateway record captured from ERPNext. */}
          <Card>
            <CardHeader
              title="Payment"
              description={paymentRow ? "Gateway fields as captured at sync; Refresh asks CCAvenue for the latest." : "No gateway record for this order."}
              actions={paymentRow ? <RefreshCcaButton orderId={order.id} /> : undefined}
            />
            {paymentRow ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={statusTone(paymentRow.status)} size="md" dot className="capitalize">{paymentRow.status}</Badge>
                  <Badge tone="brand" size="md">{paymentRow.gatewayProvider ?? paymentRow.provider}</Badge>
                  {paymentLabel ? <Badge tone="info" size="md">{paymentLabel}</Badge> : null}
                  {paymentRow.paymentFlow ? <Badge tone="subtle" size="md">{paymentRow.paymentFlow}</Badge> : null}
                  {paymentRow.paidAmount ? (
                    <span className="ml-auto text-[16px] font-bold tabular-nums text-ink-900">
                      {paymentRow.paidCurrency ?? "INR"} {paymentRow.paidAmount}
                    </span>
                  ) : null}
                </div>
                <dl className="mt-4 grid grid-cols-1 gap-x-8 gap-y-3 border-t border-ink-100/70 pt-4 text-[13px] sm:grid-cols-2">
                  <Fact label="CCAvenue tracking ID" value={gatewayTrackingId} mono />
                  <Fact label="Payment date" value={paymentDateDisplay} mono />
                  <Fact label="Gateway order ID" value={gatewayOrderId} mono />
                  <Fact label="Provider payment ID" value={providerPaymentId} mono />
                  <Fact label="Internal reference" value={internalPaymentReference} mono />
                  <Fact label="Attempts · retries" value={`${paymentRow.paymentAttemptCount ?? 0} · ${paymentRow.paymentRetryCount ?? 0}`} />
                  <Fact
                    label="Refund"
                    value={
                      <Badge size="sm" tone={paymentRow.refundStatus === "NOT_REQUESTED" ? "subtle" : paymentRow.refundStatus === "SUCCESS" ? "violet" : paymentRow.refundStatus === "FAILED" ? "danger" : "warning"}>
                        {(paymentRow.refundStatus ?? "—").replace(/_/g, " ").toLowerCase()}
                      </Badge>
                    }
                  />
                  <Fact label="Finalised" value={<Badge size="sm" tone={paymentRow.paymentFinalized ? "success" : "warning"}>{paymentRow.paymentFinalized ? "Yes" : "No"}</Badge>} />
                </dl>
                {paymentRow.gatewayResponseMessage ? (
                  <Fact label="Gateway response" value={paymentRow.gatewayResponseMessage} mono className="mt-4 border-t border-ink-100/70 pt-4" />
                ) : null}
              </>
            ) : null}
          </Card>
        </div>

        <div className="space-y-5">
          {/* Who — parent, the student it is for, and the school; each a link. */}
          <Card>
            <CardHeader title="Customer" />
            <div className="space-y-4 text-[13px]">
              <div>
                {parent ? (
                  <Link href={`/admin/customers/${parent.id}`} className="block text-[14px] font-semibold text-ink-900 hover:text-brand-700">
                    {parent.name?.trim() || <span className="text-ink-400">No name</span>}
                  </Link>
                ) : (
                  <span className="text-ink-400">No customer record</span>
                )}
                {parent?.phone ? <div className="font-mono text-ink-600">+91 {parent.phone}</div> : null}
                {parent?.email ? <div className="text-ink-600">{parent.email}</div> : null}
              </div>
              <div className="border-t border-ink-100/70 pt-3">
                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-500">Student</div>
                {student ? (
                  <>
                    <Link href={`/admin/students/${student.id}`} className="mt-1 block font-semibold text-ink-900 hover:text-brand-700">{student.name}</Link>
                    <div className="text-ink-600">
                      {student.enrollmentNumber ? <span className="font-mono">{student.enrollmentNumber}</span> : <span className="text-ink-400">No student ID</span>}
                      {student.grade ? ` · ${student.grade}` : ""}
                      {student.section ? ` · ${student.section}` : ""}
                    </div>
                  </>
                ) : (
                  <div className="mt-1 text-ink-400">Not linked to a student</div>
                )}
              </div>
              <div className="border-t border-ink-100/70 pt-3">
                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-500">School</div>
                {school ? (
                  <>
                    <Link href={`/admin/schools/${school.id}`} className="mt-1 block font-semibold text-ink-900 hover:text-brand-700">{school.name}</Link>
                    {school.city ? <div className="text-ink-600">{school.city}{school.state ? `, ${school.state}` : ""}</div> : null}
                  </>
                ) : (
                  <div className="mt-1 text-ink-400">—</div>
                )}
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader title="Invoice" description={existingInvoice ? "Opens the printable invoice." : "Generate the tax invoice for this order."} />
            <OrderActions orderId={order.id} hasInvoice={!!existingInvoice} />
            {existingInvoice ? (
              <p className="mt-3 text-[12.5px] text-ink-600">
                <Link href={`/admin/invoices/${existingInvoice.id}/print`} className="font-mono font-semibold text-brand-700 hover:text-brand-900">{existingInvoice.invoiceNumber}</Link>
              </p>
            ) : null}
          </Card>

          {order.notes ? (
            <Card>
              <CardHeader title="Notes" />
              <p className="whitespace-pre-wrap text-[13px] text-ink-700">{order.notes}</p>
            </Card>
          ) : null}
        </div>
      </div>

      {/* Record-level audit trail — every action on THIS order. */}
      <div className="mt-5">
        <RecordHistory entityType="order" entityId={order.id} title="Order history" />
      </div>
    </div>
  );
}

// Fallback view for orders that exist in the ERP mirror (poll-back) or
// the legacy bulk-sync table but not in the local `orders` table — i.e.
// historic orders we never owned in the storefront. Read-only card.
async function renderErpReadOnly(erpName: string) {
  type Row = {
    erp_name: string;
    customer: string | null;
    customer_name: string | null;
    contact_mobile: string | null;
    transaction_date: string | null;
    delivery_date: string | null;
    status: string | null;
    grand_total: number | null;
    per_delivered: number | null;
    school: string | null;
    grade: string | null;
    source: string;
  };
  // Legacy erp_sales_orders has a narrower schema (no customer_name,
  // contact_mobile, custom_student_*) — NULL-fill those columns in
  // the legacy branch so the UNION's column types align.
  const r = (
    await db.execute(sql`
      SELECT erp_name, customer, customer_name, contact_mobile,
             transaction_date::text AS transaction_date,
             delivery_date::text    AS delivery_date,
             status,
             grand_total, per_delivered,
             custom_student_school  AS school,
             custom_student_grade   AS grade,
             'mirror'               AS source
        FROM erp.sales_orders WHERE erp_name = ${erpName}
      UNION ALL
      SELECT erp_name, customer,
             NULL::text             AS customer_name,
             NULL::text             AS contact_mobile,
             transaction_date::text AS transaction_date,
             delivery_date::text    AS delivery_date,
             status,
             grand_total, per_delivered,
             NULL::text             AS school,
             NULL::text             AS grade,
             'legacy'               AS source
        FROM erp_sales_orders WHERE erp_name = ${erpName}
      LIMIT 1
    `)
  );
  const rows = (Array.isArray(r) ? r : ((r as { rows?: Row[] }).rows ?? [])) as Row[];
  const so = rows[0];
  if (!so) notFound();

  // Pull line items from whichever mirror has them.
  const itemsRes = await db.execute(sql`
    SELECT item_code, item_name, qty, rate, amount
      FROM erp.sales_order_items WHERE order_erp_name = ${erpName}
     ORDER BY id
  `);
  const itemRows = (Array.isArray(itemsRes)
    ? itemsRes
    : ((itemsRes as { rows?: unknown[] }).rows ?? [])) as Array<{
    item_code: string | null;
    item_name: string | null;
    qty: number | null;
    rate: number | null;
    amount: number | null;
  }>;

  const inr = (n: number | null) =>
    "₹" + Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 });

  return (
    <div>
      <PageHeader
        eyebrow="Sales & Distribution"
        breadcrumb={[{ label: "Sales Orders", href: "/admin/orders" }, { label: so.erp_name }]}
        title={so.erp_name}
        description={`Read-only — sourced from ${so.source === "mirror" ? "ERP poll-back" : "legacy ERPNext sync"} (no local storefront record).`}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-4">
        <Card>
          <CardHeader title="Status" />
          <Badge size="sm" tone={statusTone(so.status ?? "")}>{so.status ?? "—"}</Badge>
          <p className="mt-2 text-[13px] text-ink-700">
            Delivered: {Math.round(Number(so.per_delivered ?? 0))}%
          </p>
        </Card>
        <Card>
          <CardHeader title="Customer" />
          <p className="font-semibold text-ink-900">{so.customer_name ?? so.customer ?? "—"}</p>
          {so.contact_mobile ? (
            <p className="text-[13px] text-ink-700">{so.contact_mobile}</p>
          ) : null}
        </Card>
        <Card>
          <CardHeader title="School / Grade" />
          <p className="font-semibold text-ink-900">{so.school ?? "—"}</p>
          {so.grade ? <p className="text-[13px] text-ink-700">{so.grade}</p> : null}
        </Card>
      </div>

      <Card padded={false} className="mt-4">
        <CardHeader title={`Items (${itemRows.length})`} />
        <table className="w-full">
          <thead>
            <tr>
              <Th>Item</Th>
              <Th right>Qty</Th>
              <Th right>Rate</Th>
              <Th right>Amount</Th>
            </tr>
          </thead>
          <tbody>
            {itemRows.length === 0 ? (
              <Tr><Td muted>No item rows mirrored yet.</Td><Td /><Td /><Td /></Tr>
            ) : (
              itemRows.map((it, i) => (
                <Tr key={i}>
                  <Td>{it.item_name ?? it.item_code ?? "—"}</Td>
                  <Td right><span className="tabular-nums">{it.qty ?? "—"}</span></Td>
                  <Td right><span className="tabular-nums">{inr(it.rate)}</span></Td>
                  <Td right><span className="font-semibold tabular-nums">{inr(it.amount)}</span></Td>
                </Tr>
              ))
            )}
          </tbody>
        </table>
      </Card>

      <Card className="mt-4">
        <CardHeader title="Totals" />
        <div className="flex justify-between text-[14px]">
          <span>Grand total</span>
          <span className="font-semibold tabular-nums">{inr(so.grand_total)}</span>
        </div>
      </Card>
    </div>
  );
}

/** One label / value pair in a facts list. */
function Fact({
  label,
  value,
  mono,
  className,
}: {
  label: string;
  value: ReactNode;
  mono?: boolean;
  className?: string;
}) {
  const empty = value === null || value === undefined || value === "";
  return (
    <div className={className}>
      <dt className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-500">{label}</dt>
      <dd className={"mt-0.5 min-w-0 break-all text-ink-800 " + (mono ? "font-mono text-[12.5px]" : "")}>
        {empty ? <span className="text-ink-300">—</span> : value}
      </dd>
    </div>
  );
}
