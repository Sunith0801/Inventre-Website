import type { ReactNode } from "react";
import { eq, or, sql } from "drizzle-orm";
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
} from "@/db/schema";
import { OrderStatusForm } from "@/components/admin/OrderStatusForm";
import { OrderActions } from "@/components/admin/OrderActions";
import { DeleteOrderButton } from "@/components/admin/DeleteOrderButton";
import { RefreshCcaButton } from "@/components/admin/RefreshCcaButton";
import {
  PageHeader,
  Card,
  CardHeader,
  Badge,
  Money,
  Th,
  Td,
  Tr,
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

  return (
    <div>
      <PageHeader
        breadcrumb={[
          { label: "Orders", href: "/admin/orders" },
          { label: order.orderNumber },
        ]}
        title={order.orderNumber}
        description={
          <span className="flex flex-wrap items-center gap-3 text-[13px]">
            <span className="text-ink-500">
              Placed{" "}
              {new Date(order.createdAt).toLocaleString("en-IN", {
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </span>
            <Badge tone={statusTone(order.status)} dot size="sm">
              {order.status}
            </Badge>
            <Badge tone={statusTone(order.paymentStatus)} size="sm">
              {order.paymentStatus}
            </Badge>
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
          <div className="flex items-center gap-2">
            <OrderStatusForm orderId={order.id} status={order.status} />
            <DeleteOrderButton
              orderId={order.id}
              orderNumber={order.orderNumber}
            />
          </div>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-5">
          {/* Sub items — header row carries summary chips; bundle parents
              expose their children via a native <details> accordion so the
              page remains a pure server component (no JS state needed). */}
          <Card padded={false}>
            <CardHeader
              title="Sub items"
              description={`${items.length} line item${items.length === 1 ? "" : "s"} mirrored from ERPNext Sales Order${
                rawSubItems.length > 0
                  ? ` · ${rawSubItems.length} bundle child${rawSubItems.length === 1 ? "" : "ren"}`
                  : ""
              }`}
              className="px-5 pt-5"
            />
            <table className="w-full">
              <thead className="bg-cream-50/70">
                <tr>
                  <Th className="pl-5">Item</Th>
                  <Th>ERP code / size</Th>
                  <Th>HSN</Th>
                  <Th right>Qty</Th>
                  <Th right>Unit price</Th>
                  <Th right className="pr-5">Total</Th>
                </tr>
              </thead>
              <tbody className="[&>tr:nth-child(odd)]:bg-white [&>tr:nth-child(even)]:bg-cream-50/40">
                {items.map((it) => {
                  // Look up bundle children by the ERP item_code we
                  // snapshotted into `size` at import time. The ERPNext
                  // sub-items table joins on parent_item_code.
                  const children = subItemsByParent.get(it.size) ?? [];
                  const hasChildren = children.length > 0;
                  return (
                    <Tr key={it.id} className="align-top">
                      <Td className="pl-5">
                        {hasChildren ? (
                          <details className="group">
                            <summary className="flex items-start gap-2 cursor-pointer list-none -ml-1 select-none">
                              <span
                                className="mt-0.5 inline-flex h-5 w-5 items-center justify-center rounded-md bg-brand-50 text-brand-700 text-[12px] font-bold transition-transform group-open:rotate-90"
                                aria-hidden
                              >
                                ›
                              </span>
                              <span className="flex-1 min-w-0">
                                <span className="font-semibold text-ink-900 break-words">
                                  {it.nameSnapshot}
                                </span>
                                <span className="ml-2 inline-flex items-center rounded-full bg-brand-50 border border-brand-200/70 px-2 py-0.5 text-[10px] font-semibold text-brand-700">
                                  Bundle · {children.length} item{children.length === 1 ? "" : "s"}
                                </span>
                                {it.variantId === null && (
                                  <span className="ml-1.5 inline-flex items-center rounded-full bg-amber-50 border border-amber-200 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                                    unmapped SKU
                                  </span>
                                )}
                              </span>
                            </summary>
                            {/* Inline child list — indented, condensed,
                                without its own table so it visually nests
                                under the parent row. */}
                            <div className="mt-3 ml-6 rounded-lg border border-ink-100/80 bg-cream-50/60 overflow-hidden">
                              <div className="grid grid-cols-[minmax(0,1fr)_70px] gap-x-3 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-500 bg-cream-100/70">
                                <span>Child item (ERP code)</span>
                                <span className="text-right">Qty</span>
                              </div>
                              <ul className="divide-y divide-ink-100/70">
                                {children
                                  .slice()
                                  .sort((a, b) => (a.idx ?? 0) - (b.idx ?? 0))
                                  .map((c) => (
                                    <li
                                      key={c.item_code + "-" + (c.idx ?? 0)}
                                      className="grid grid-cols-[minmax(0,1fr)_70px] gap-x-3 px-3 py-1.5 text-[12px]"
                                    >
                                      <span className="font-mono text-ink-800 break-words">{c.item_code}</span>
                                      <span className="text-right tabular-nums text-ink-700">{c.qty}</span>
                                    </li>
                                  ))}
                              </ul>
                            </div>
                          </details>
                        ) : (
                          <span className="flex items-start gap-2">
                            <span className="mt-1.5 inline-block h-1.5 w-1.5 rounded-full bg-ink-300" aria-hidden />
                            <span className="flex-1 min-w-0">
                              <span className="font-medium text-ink-900 break-words">{it.nameSnapshot}</span>
                              {it.variantId === null && (
                                <span className="ml-2 inline-flex items-center rounded-full bg-amber-50 border border-amber-200 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                                  unmapped SKU
                                </span>
                              )}
                            </span>
                          </span>
                        )}
                      </Td>
                      <Td muted>
                        <span className="font-mono text-[12px] break-words">{it.size}</span>
                      </Td>
                      <Td muted>
                        <span className="font-mono text-[12px]">{it.hsnCodeSnapshot ?? "—"}</span>
                      </Td>
                      <Td right>
                        <span className="inline-flex items-center justify-center min-w-[28px] h-6 px-2 rounded-md bg-ink-50 text-ink-800 font-semibold tabular-nums">
                          {it.qty}
                        </span>
                      </Td>
                      <Td right>
                        <Money paise={it.unitPrice} />
                      </Td>
                      <Td right className="pr-5">
                        <Money paise={it.total} className="font-semibold" />
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-ink-200 bg-cream-50/60">
                  <td colSpan={5} className="py-3 pl-5 pr-4 text-right text-[12px] font-semibold uppercase tracking-wider text-ink-600">
                    Order total
                  </td>
                  <td className="py-3 px-5 text-right">
                    <Money
                      paise={order.total}
                      className="font-display text-[18px] font-extrabold text-ink-900"
                    />
                  </td>
                </tr>
              </tfoot>
            </table>
          </Card>

          {/* Shipping address — name on top, phone as a copy-friendly
              monospace chip, address block as one indented paragraph for
              quick scanning. */}
          <Card>
            <CardHeader title="Shipping address" />
            <div className="flex items-start gap-3">
              <div className="h-9 w-9 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center font-bold text-[14px] shrink-0">
                {(addr.receiverName ?? "?").slice(0, 1).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-ink-900 leading-tight">{addr.receiverName}</p>
                {addr.receiverPhone ? (
                  <p className="mt-0.5">
                    <span className="inline-flex items-center gap-1 rounded-md bg-ink-50 px-2 py-0.5 text-[12px] font-mono text-ink-800">
                      +91 {addr.receiverPhone}
                    </span>
                  </p>
                ) : null}
                <p className="mt-2 text-[13px] text-ink-700 leading-snug">
                  {addr.line1}
                  {addr.line2 ? `, ${addr.line2}` : ""}
                  <br />
                  <span className="text-ink-600">
                    {addr.city}, {addr.state} <span className="font-mono">{addr.pincode}</span>
                  </span>
                </p>
              </div>
            </div>
          </Card>

          {/* Payment Details — sectioned: a hero status pill at the top,
              then Transaction / Identifiers / Refund groups in a striped
              table. Reading from the local payments row populated by
              importSalesOrder. */}
          <Card padded={false}>
            <CardHeader
              title="Payment details"
              description={
                paymentRow
                  ? "All gateway fields captured from ERPNext at sync time"
                  : "No payment row recorded yet"
              }
              className="px-5 pt-5 pb-3"
              actions={paymentRow ? <RefreshCcaButton orderId={order.id} /> : undefined}
            />
            {paymentRow ? (
              <>
                {/* Hero strip: gateway · status · paid amount · mode */}
                <div className="px-5 pb-4 flex flex-wrap items-center gap-2">
                  <Badge tone={statusTone(paymentRow.status)} size="md" dot>
                    {paymentRow.status}
                  </Badge>
                  <Badge tone="brand" size="md">
                    {paymentRow.gatewayProvider ?? paymentRow.provider}
                  </Badge>
                  {(paymentRow.paymentMode ?? paymentRow.method) ? (
                    <Badge tone="info" size="md">
                      {paymentRow.paymentMode ?? paymentRow.method}
                    </Badge>
                  ) : null}
                  {paymentRow.paymentFlow ? (
                    <Badge tone="subtle" size="md">
                      {paymentRow.paymentFlow}
                    </Badge>
                  ) : null}
                  {paymentRow.paidAmount ? (
                    <span className="ml-auto font-display text-[15px] font-extrabold text-ink-900 tabular-nums">
                      {paymentRow.paidCurrency ?? "INR"} {paymentRow.paidAmount}
                    </span>
                  ) : null}
                </div>

                {/* Two columns of grouped fields */}
                <div className="grid sm:grid-cols-2 gap-x-5 border-t border-ink-100">
                  <PaymentSection title="Identifiers">
                    <PaymentRow label="CCAvenue tracking ID" value={gatewayTrackingId} mono />
                    <PaymentRow label="Gateway order ID" value={gatewayOrderId} mono />
                    <PaymentRow label="Provider payment ID" value={providerPaymentId} mono />
                    <PaymentRow label="Internal ref" value={internalPaymentReference} mono />
                    <PaymentRow label="Payment date" value={paymentDateDisplay} mono />
                  </PaymentSection>
                  <PaymentSection title="Refund & audit" className="border-l border-ink-100">
                    <PaymentRow
                      label="Refund status"
                      value={paymentRow.refundStatus}
                      tone={
                        paymentRow.refundStatus === "NOT_REQUESTED"
                          ? "subtle"
                          : paymentRow.refundStatus === "SUCCESS"
                          ? "violet"
                          : paymentRow.refundStatus === "FAILED"
                          ? "danger"
                          : "warning"
                      }
                    />
                    <PaymentRow label="Attempts" value={String(paymentRow.paymentAttemptCount ?? 0)} />
                    <PaymentRow label="Retries" value={String(paymentRow.paymentRetryCount ?? 0)} />
                    <PaymentRow
                      label="Finalised"
                      value={paymentRow.paymentFinalized ? "Yes" : "No"}
                      tone={paymentRow.paymentFinalized ? "success" : "warning"}
                    />
                  </PaymentSection>
                </div>

                {paymentRow.gatewayResponseMessage ? (
                  <div className="border-t border-ink-100 px-5 py-4">
                    <p className="text-[11px] font-semibold text-ink-500 uppercase tracking-wider mb-1">
                      Gateway response
                    </p>
                    <pre className="m-0 whitespace-pre-wrap break-all text-[12px] font-mono text-ink-700 bg-cream-50/70 border border-ink-100 rounded-md p-3">
                      {paymentRow.gatewayResponseMessage}
                    </pre>
                  </div>
                ) : null}
              </>
            ) : (
              <p className="px-5 pb-5 text-[13px] text-ink-500">
                No payment row exists for this order yet.
              </p>
            )}
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Actions" description="Generate downstream documents" />
            <OrderActions orderId={order.id} hasInvoice={!!existingInvoice} />
            {existingInvoice ? (
              <p className="mt-3 text-[12px] text-ink-500">
                Invoice:{" "}
                <a
                  href={`/admin/invoices/${existingInvoice.id}/print`}
                  className="font-mono font-semibold text-brand-700 hover:underline"
                >
                  {existingInvoice.invoiceNumber}
                </a>
              </p>
            ) : null}
          </Card>

          <Card>
            <CardHeader title="Customer" />
            <p className="font-semibold text-ink-900">
              {parent?.name ?? <span className="text-ink-400">— no name —</span>}
            </p>
            <p className="text-[13px] text-ink-700 font-mono">+91 {parent?.phone}</p>
            {parent?.email ? (
              <p className="text-[13px] text-ink-700">{parent.email}</p>
            ) : null}
            {student ? (
              <p className="mt-2 text-[12px] text-ink-500">
                For:{" "}
                <span className="font-semibold text-ink-800">{student.name}</span>
                {student.class ? ` · ${student.class}` : ""}
                {student.section ? ` · ${student.section}` : ""}
              </p>
            ) : null}
          </Card>

          <Card>
            <CardHeader title="School" />
            <p className="font-semibold text-ink-900">{school?.name ?? "—"}</p>
            {school?.city ? (
              <p className="text-[13px] text-ink-700">
                {school.city}, {school.state}
              </p>
            ) : null}
          </Card>
        </div>
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
        breadcrumb={[
          { label: "Orders", href: "/admin/orders" },
          { label: so.erp_name },
        ]}
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

// Section header + striped row helpers for the Payment Details card.
// All server-rendered; no client-state needed. Each PaymentRow renders
// a label / value pair, optionally as a status pill when `tone` is set.
function PaymentSection({
  title,
  children,
  className,
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`px-5 py-4 ${className ?? ""}`}>
      <p className="text-[10px] font-bold text-ink-500 uppercase tracking-[0.08em] mb-2">
        {title}
      </p>
      <dl className="divide-y divide-ink-100/70">{children}</dl>
    </div>
  );
}

function PaymentRow({
  label,
  value,
  mono,
  tone,
}: {
  label: string;
  value: string | null | undefined;
  mono?: boolean;
  tone?: "default" | "subtle" | "success" | "warning" | "danger" | "violet" | "info" | "brand";
}) {
  const shown = value === null || value === undefined || value === "" ? "—" : value;
  return (
    <div className="grid grid-cols-[150px_minmax(0,1fr)] gap-x-3 py-1.5 items-center">
      <dt className="text-[11px] font-semibold text-ink-500 uppercase tracking-wider">
        {label}
      </dt>
      <dd className="min-w-0">
        {tone ? (
          <Badge tone={tone} size="sm">
            {shown}
          </Badge>
        ) : (
          <span
            className={
              mono
                ? "text-[12px] font-mono text-ink-800 break-all"
                : "text-[13px] text-ink-800"
            }
          >
            {shown}
          </span>
        )}
      </dd>
    </div>
  );
}
