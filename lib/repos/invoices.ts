import "server-only";
import { eq, and, desc, sql, isNull, or, ilike, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import {
  invoices,
  invoiceItems,
  orders,
  orderItems,
  productVariants,
  products,
  parents,
} from "@/db/schema";
import {
  computeInvoiceTotals,
  placeOfSupply,
  type GstTreatment,
  type TaxLine,
} from "../tax";
import { generateInvoiceNumber } from "../invoice-numbering";

/**
 * Build an invoice from an order, snapshotting all line items + addresses + tax.
 * Idempotent at the (orderId, isReturn=false) level — running twice for the
 * same order returns the first invoice instead of creating a duplicate.
 */
export async function generateInvoiceForOrder(args: {
  orderId: string;
  postingDate?: Date;
}): Promise<{ id: string; invoiceNumber: string; alreadyExisted: boolean }> {
  const postingDate = args.postingDate ?? new Date();

  const [order] = await db
    .select()
    .from(orders)
    .where(eq(orders.id, args.orderId))
    .limit(1);
  if (!order) throw new Error("Order not found");

  // Idempotency
  const existing = await db
    .select()
    .from(invoices)
    .where(
      and(eq(invoices.orderId, args.orderId), eq(invoices.isReturn, false))
    )
    .limit(1);
  if (existing.length > 0) {
    return {
      id: existing[0].id,
      invoiceNumber: existing[0].invoiceNumber,
      alreadyExisted: true,
    };
  }

  // Order items joined with product to get HSN + GST treatment
  const items = await db
    .select({
      orderItem: orderItems,
      product: products,
    })
    .from(orderItems)
    .innerJoin(productVariants, eq(productVariants.id, orderItems.variantId))
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(eq(orderItems.orderId, args.orderId));

  const shipping = order.shippingAddress as {
    pincode: string;
    [k: string]: unknown;
  };
  const pincode = shipping?.pincode ?? "999999";

  const taxLines: TaxLine[] = items.map((r) => ({
    netAmountPaise: r.orderItem.total,
    hsnCode:
      r.orderItem.hsnCodeSnapshot ?? r.product.hsnCode ?? null,
    gstTreatment: (r.orderItem.gstTreatmentSnapshot ??
      r.product.gstTreatment ??
      "taxable") as GstTreatment,
  }));

  const totals = computeInvoiceTotals(taxLines, pincode);

  const { invoiceNumber, financialYear } = await generateInvoiceNumber(
    postingDate
  );

  const [inv] = await db
    .insert(invoices)
    .values({
      invoiceNumber,
      financialYear,
      orderId: args.orderId,
      parentId: order.parentId,
      postingDate: postingDate.toISOString().slice(0, 10),
      dueDate: postingDate.toISOString().slice(0, 10),
      netTotal: totals.netTotal,
      cgstTotal: totals.cgstTotal,
      sgstTotal: totals.sgstTotal,
      igstTotal: totals.igstTotal,
      taxTotal: totals.taxTotal,
      roundingAdjustment: totals.roundingAdjustment,
      grandTotal: totals.grandTotal,
      outstandingAmount: totals.grandTotal,
      status: "submitted",
      isReturn: false,
      billingAddress: (order.billingAddress as object) ?? (order.shippingAddress as object),
      shippingAddress: order.shippingAddress as object,
      placeOfSupply: placeOfSupply(pincode),
      taxBreakdown: {
        cgst: totals.cgstTotal,
        sgst: totals.sgstTotal,
        igst: totals.igstTotal,
      },
    })
    .returning();

  // Order items imported from ERPNext can have a NULL variant_id when
  // the ERP item_code didn't match a local product variant; invoice_items
  // requires a non-null variant. We can't invoice those lines through
  // this flow — fail loudly rather than silently dropping them.
  const unmappedInvoiceLines = items.filter((r) => r.orderItem.variantId === null);
  if (unmappedInvoiceLines.length > 0) {
    throw new Error(
      `Cannot generate invoice: ${unmappedInvoiceLines.length} order item(s) have no local SKU (ERP-imported). Resolve the catalog mapping first.`
    );
  }
  await db.insert(invoiceItems).values(
    items.map((r, idx) => {
      const c = totals.lines[idx];
      return {
        invoiceId: inv.id,
        orderItemId: r.orderItem.id,
        variantId: r.orderItem.variantId as string,
        hsnCode: r.orderItem.hsnCodeSnapshot ?? r.product.hsnCode ?? null,
        itemNameSnapshot: r.orderItem.nameSnapshot,
        qty: r.orderItem.qty,
        unitPrice: r.orderItem.unitPrice,
        netAmount: r.orderItem.total,
        taxableAmount: r.orderItem.total,
        cgstRate: c.cgstRate.toString(),
        sgstRate: c.sgstRate.toString(),
        igstRate: c.igstRate.toString(),
        cgstAmount: c.cgstAmount,
        sgstAmount: c.sgstAmount,
        igstAmount: c.igstAmount,
        totalAmount: c.lineTotal,
        gstTreatment: (r.orderItem.gstTreatmentSnapshot ??
          r.product.gstTreatment ??
          "taxable") as GstTreatment,
      };
    })
  );

  // Audit §3.4 — recompute order.billedPercent
  const billedPercent =
    order.total === 0 ? 0 : Math.min(100, Math.round((totals.grandTotal / order.total) * 100));
  await db
    .update(orders)
    .set({ billedPercent })
    .where(eq(orders.id, args.orderId));

  return { id: inv.id, invoiceNumber, alreadyExisted: false };
}

/** Generate a credit note (negative invoice) for a return. */
export async function generateCreditNote(args: {
  parentInvoiceId: string;
  returnedItems: { invoiceItemId: string; qty: number }[];
  postingDate?: Date;
}): Promise<{ id: string; invoiceNumber: string }> {
  const postingDate = args.postingDate ?? new Date();
  const [parent] = await db
    .select()
    .from(invoices)
    .where(eq(invoices.id, args.parentInvoiceId))
    .limit(1);
  if (!parent) throw new Error("Original invoice not found");

  const itemRows = await db
    .select()
    .from(invoiceItems)
    .where(eq(invoiceItems.invoiceId, args.parentInvoiceId));

  const itemById = new Map(itemRows.map((r) => [r.id, r]));

  // Sum previously-credited qty per source invoice item across all
  // child credit notes of this invoice. invoiceItems.qty is negative on
  // credit notes; sum its absolute value per orderItemId.
  const priorCreditNotes = await db
    .select({ id: invoices.id })
    .from(invoices)
    .where(
      and(
        eq(invoices.parentInvoiceId, args.parentInvoiceId),
        eq(invoices.isReturn, true)
      )
    );
  const priorByOrderItemId = new Map<string, number>();
  if (priorCreditNotes.length > 0) {
    const priorItems = await db
      .select()
      .from(invoiceItems)
      .where(
        inArray(
          invoiceItems.invoiceId,
          priorCreditNotes.map((p) => p.id)
        )
      );
    for (const p of priorItems) {
      if (!p.orderItemId) continue;
      const prev = priorByOrderItemId.get(p.orderItemId) ?? 0;
      priorByOrderItemId.set(p.orderItemId, prev + Math.abs(p.qty));
    }
  }

  let netTotal = 0,
    cgstTotal = 0,
    sgstTotal = 0,
    igstTotal = 0;
  const creditLines: {
    src: typeof itemRows[number];
    qty: number;
    perLine: { net: number; cgst: number; sgst: number; igst: number; total: number };
  }[] = [];

  for (const r of args.returnedItems) {
    const orig = itemById.get(r.invoiceItemId);
    if (!orig) continue;
    if (r.qty <= 0) {
      throw new Error(
        `Credit note qty must be positive for invoice item ${r.invoiceItemId}`
      );
    }
    const alreadyCredited = orig.orderItemId
      ? priorByOrderItemId.get(orig.orderItemId) ?? 0
      : 0;
    const remaining = orig.qty - alreadyCredited;
    if (r.qty > remaining) {
      throw new Error(
        `Credit qty ${r.qty} exceeds remaining ${remaining} on invoice item ${r.invoiceItemId} (invoiced ${orig.qty}, already credited ${alreadyCredited})`
      );
    }
    const ratio = r.qty / orig.qty;
    const net = Math.round(orig.netAmount * ratio);
    const cgst = Math.round(orig.cgstAmount * ratio);
    const sgst = Math.round(orig.sgstAmount * ratio);
    const igst = Math.round(orig.igstAmount * ratio);
    const lineTotal = Math.round(orig.totalAmount * ratio);
    netTotal += net;
    cgstTotal += cgst;
    sgstTotal += sgst;
    igstTotal += igst;
    creditLines.push({
      src: orig,
      qty: r.qty,
      perLine: { net, cgst, sgst, igst, total: lineTotal },
    });
  }

  const taxTotal = cgstTotal + sgstTotal + igstTotal;
  const grandTotal = Math.round((netTotal + taxTotal) / 100) * 100;

  // Snapshot invariants — guard against rounding drift or sign confusion that
  // would put a credit note out of sync with its source invoice.
  if (netTotal < 0 || cgstTotal < 0 || sgstTotal < 0 || igstTotal < 0) {
    throw new Error(
      `Credit note invariant: component totals must be non-negative before negation (net=${netTotal}, cgst=${cgstTotal}, sgst=${sgstTotal}, igst=${igstTotal})`
    );
  }
  const sumOfLineNets = creditLines.reduce((s, l) => s + l.perLine.net, 0);
  if (sumOfLineNets !== netTotal) {
    throw new Error(
      `Credit note invariant: line nets sum to ${sumOfLineNets}, header netTotal=${netTotal}`
    );
  }
  if (grandTotal > parent.grandTotal) {
    throw new Error(
      `Credit note invariant: grandTotal ${grandTotal} exceeds parent invoice grandTotal ${parent.grandTotal}`
    );
  }

  const { invoiceNumber, financialYear } = await generateInvoiceNumber(
    postingDate
  );

  const [credit] = await db
    .insert(invoices)
    .values({
      invoiceNumber,
      financialYear,
      orderId: parent.orderId,
      parentId: parent.parentId,
      postingDate: postingDate.toISOString().slice(0, 10),
      dueDate: postingDate.toISOString().slice(0, 10),
      netTotal: -netTotal,
      cgstTotal: -cgstTotal,
      sgstTotal: -sgstTotal,
      igstTotal: -igstTotal,
      taxTotal: -taxTotal,
      grandTotal: -grandTotal,
      outstandingAmount: 0,
      status: "submitted",
      isReturn: true,
      parentInvoiceId: parent.id,
      billingAddress: parent.billingAddress as object,
      shippingAddress: parent.shippingAddress as object,
      placeOfSupply: parent.placeOfSupply,
    })
    .returning();

  await db.insert(invoiceItems).values(
    creditLines.map(({ src, qty, perLine }) => {
      const ratio = qty / src.qty;
      return {
        invoiceId: credit.id,
        orderItemId: src.orderItemId,
        variantId: src.variantId,
        hsnCode: src.hsnCode,
        itemNameSnapshot: src.itemNameSnapshot,
        qty: -qty,
        unitPrice: src.unitPrice,
        netAmount: -perLine.net,
        taxableAmount: -Math.round(src.taxableAmount * ratio),
        cgstRate: src.cgstRate,
        sgstRate: src.sgstRate,
        igstRate: src.igstRate,
        cgstAmount: -perLine.cgst,
        sgstAmount: -perLine.sgst,
        igstAmount: -perLine.igst,
        totalAmount: -perLine.total,
        gstTreatment: src.gstTreatment,
      };
    })
  );

  return { id: credit.id, invoiceNumber };
}

export async function listInvoices(filter: {
  status?: string;
  parentId?: string;
  fy?: string;
  q?: string;
  limit?: number;
  schoolId?: string;
} = {}) {
  const conditions = [];
  if (filter.status) conditions.push(eq(invoices.status, filter.status as never));
  if (filter.parentId) conditions.push(eq(invoices.parentId, filter.parentId));
  if (filter.fy) conditions.push(eq(invoices.financialYear, filter.fy));
  if (filter.schoolId) conditions.push(eq(orders.schoolId, filter.schoolId));
  if (filter.q) {
    const q = `%${filter.q}%`;
    conditions.push(
      or(
        ilike(invoices.invoiceNumber, q),
        ilike(parents.name, q),
        ilike(parents.phone, q)
      )!
    );
  }

  return db
    .select({
      invoice: invoices,
      parentName: parents.name,
      parentPhone: parents.phone,
    })
    .from(invoices)
    .innerJoin(parents, eq(parents.id, invoices.parentId))
    .innerJoin(orders, eq(orders.id, invoices.orderId))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(invoices.postingDate))
    .limit(filter.limit ?? 100);
}

export async function getInvoiceDetail(id: string, opts: { schoolId?: string } = {}) {
  const [row] = await db
    .select({ inv: invoices, orderSchoolId: orders.schoolId })
    .from(invoices)
    .innerJoin(orders, eq(orders.id, invoices.orderId))
    .where(eq(invoices.id, id))
    .limit(1);
  if (!row) return null;
  if (opts.schoolId && row.orderSchoolId !== opts.schoolId) return null;
  const items = await db
    .select()
    .from(invoiceItems)
    .where(eq(invoiceItems.invoiceId, id));
  return { invoice: row.inv, items };
}
