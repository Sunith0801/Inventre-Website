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
  paymentEntries,
} from "@/db/schema";
import {
  computeInvoiceTotals,
  placeOfSupply,
  type GstTreatment,
  type TaxLine,
} from "@/lib/tax";
import { generateInvoiceNumber } from "@/server/invoice-numbering";

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
    const inv = existing[0];
    // The invoice was raised before the payment landed (admin "Generate
    // invoice" on an unpaid order, then CCAvenue settles and calls us again).
    // Clear the balance now — unless someone already reconciled it by hand
    // with a manual payment entry, which carries the right figure.
    if (order.paymentStatus === "paid" && inv.outstandingAmount > 0 && inv.status !== "cancelled") {
      const [manual] = await db
        .select({ id: paymentEntries.id })
        .from(paymentEntries)
        .where(and(eq(paymentEntries.invoiceId, inv.id), eq(paymentEntries.direction, "received")))
        .limit(1);
      if (!manual) {
        await db
          .update(invoices)
          .set({ outstandingAmount: 0, status: "paid", updatedAt: new Date() })
          .where(eq(invoices.id, inv.id));
      }
    }
    return {
      id: inv.id,
      invoiceNumber: inv.invoiceNumber,
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

  // Lines imported from ERPNext can have no local variant (an item_code with
  // no SKU here). The inner join above silently DROPS them, so an invoice
  // built now would under-bill the order. Refuse up front — before an
  // invoice number is allocated — rather than after the header is written.
  const [{ unmapped }] = await db
    .select({ unmapped: sql<number>`COUNT(*)::int` })
    .from(orderItems)
    .where(and(eq(orderItems.orderId, args.orderId), isNull(orderItems.variantId)));
  if (Number(unmapped) > 0) {
    throw new Error(
      `Cannot generate invoice: ${unmapped} order item(s) have no local SKU (ERP-imported). Resolve the catalog mapping first.`
    );
  }
  if (items.length === 0) {
    throw new Error("Cannot generate invoice: the order has no line items.");
  }

  const shipping = order.shippingAddress as {
    pincode: string;
    [k: string]: unknown;
  };
  const pincode = shipping?.pincode ?? "999999";

  // The product's own GST rate (set once on its Pricing step) beats the
  // 18% default, and "price includes GST" decides whether tax is
  // extracted from the paid amount or added on top. Before this, every
  // invoice added 18% on top of what the parent had already paid.
  const taxLines: TaxLine[] = items.map((r) => {
    const rate = r.product.gstRate != null ? Number(r.product.gstRate) : undefined;
    return {
      netAmountPaise: r.orderItem.total,
      hsnCode:
        r.orderItem.hsnCodeSnapshot ?? r.product.hsnCode ?? null,
      gstTreatment: (r.orderItem.gstTreatmentSnapshot ??
        r.product.gstTreatment ??
        "taxable") as GstTreatment,
      gstInclusive: r.product.gstInclusive ?? true,
      ...(rate != null ? { cgstRate: rate / 2, sgstRate: rate / 2, igstRate: rate } : {}),
    };
  });

  const totals = computeInvoiceTotals(taxLines, pincode);

  const { invoiceNumber, financialYear } = await generateInvoiceNumber(
    postingDate
  );

  // An invoice raised for an order that is already paid (the normal case:
  // CCAvenue finalize generates it right after marking the order paid) opens
  // with nothing owed. Only an unpaid order — an offline sale settled later
  // through a manual payment entry — opens with the full balance.
  const settled = order.paymentStatus === "paid";

  // Header, lines and the order's billed % commit together, so a failure
  // part-way can never leave an invoice header without its lines.
  const created = await db.transaction(async (tx) => {
    const [inv] = await tx
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
        outstandingAmount: settled ? 0 : totals.grandTotal,
        status: settled ? "paid" : "submitted",
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

    await tx.insert(invoiceItems).values(
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
    await tx
      .update(orders)
      .set({ billedPercent })
      .where(eq(orders.id, args.orderId));

    return inv;
  });

  return { id: created.id, invoiceNumber, alreadyExisted: false };
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
