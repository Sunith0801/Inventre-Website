import { NextResponse } from "next/server";
import { parseBody } from "@/server/parse-body";
import { z } from "zod";
import { eq, desc } from "drizzle-orm";
import { db } from "@/db/client";
import {
  purchaseInvoices,
  purchaseInvoiceItems,
  purchaseOrders,
  purchaseOrderItems,
  suppliers,
} from "@/db/schema";
import { isResponse, requirePermission } from "@/server/admin-guard";
import { logAdminActivity } from "@/server/activity";
import { nextNumber, financialYear, pad } from "@/server/numbering";

export async function GET() {
  const guard = await requirePermission("purchase-orders.read");
  if (isResponse(guard)) return guard;
  const rows = await db
    .select({
      invoice: purchaseInvoices,
      supplierName: suppliers.name,
      poNumber: purchaseOrders.poNumber,
    })
    .from(purchaseInvoices)
    .innerJoin(suppliers, eq(suppliers.id, purchaseInvoices.supplierId))
    .leftJoin(purchaseOrders, eq(purchaseOrders.id, purchaseInvoices.poId))
    .orderBy(desc(purchaseInvoices.postingDate))
    .limit(200);
  return NextResponse.json({ invoices: rows });
}

const Body = z.object({
  supplierId: z.string().uuid(),
  poId: z.string().uuid().nullable().optional(),
  receiptId: z.string().uuid().nullable().optional(),
  supplierInvoiceNumber: z.string().nullable().optional(),
  supplierInvoiceDate: z.string().nullable().optional(),
  postingDate: z.string(),
  dueDate: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  items: z
    .array(
      z.object({
        poItemId: z.string().uuid().nullable().optional(),
        description: z.string().min(1),
        qty: z.number().int().min(1),
        unitPrice: z.number().int().min(0), // paise
        taxAmount: z.number().int().min(0).default(0),
      })
    )
    .min(1),
});

export async function POST(req: Request) {
  const guard = await requirePermission("purchase-orders.write");
  if (isResponse(guard)) return guard;
  const parsed = await parseBody(req, Body);
  if (parsed instanceof NextResponse) return parsed;
  const body = parsed;

  const subtotal = body.items.reduce((s, it) => s + it.unitPrice * it.qty, 0);
  const taxTotal = body.items.reduce((s, it) => s + it.taxAmount, 0);
  const grandTotal = subtotal + taxTotal;

  const fy = financialYear(new Date(body.postingDate));
  const seq = await nextNumber("PIN", fy);
  const invoiceNumber = `PIN-${fy}-${pad(seq, 5)}`;

  const created = await db.transaction(async (tx) => {
    // If a poItemId is supplied for any line, resolve variantId from the PO line.
    const poItemIds = body.items
      .map((i) => i.poItemId)
      .filter((x): x is string => !!x);
    let poItemMap = new Map<string, typeof purchaseOrderItems.$inferSelect>();
    if (poItemIds.length) {
      const rows = await tx.select().from(purchaseOrderItems);
      poItemMap = new Map(rows.map((r) => [r.id, r]));
    }

    const [inv] = await tx
      .insert(purchaseInvoices)
      .values({
        invoiceNumber,
        supplierInvoiceNumber: body.supplierInvoiceNumber ?? null,
        supplierInvoiceDate: body.supplierInvoiceDate ?? null,
        supplierId: body.supplierId,
        poId: body.poId ?? null,
        receiptId: body.receiptId ?? null,
        postingDate: body.postingDate,
        dueDate: body.dueDate ?? null,
        subtotal,
        taxTotal,
        grandTotal,
        outstandingAmount: grandTotal,
        status: "submitted",
        notes: body.notes ?? null,
        createdBy: guard.id,
      })
      .returning();

    await tx.insert(purchaseInvoiceItems).values(
      body.items.map((it) => ({
        invoiceId: inv.id,
        poItemId: it.poItemId ?? null,
        variantId: it.poItemId ? poItemMap.get(it.poItemId)?.variantId ?? null : null,
        description: it.description,
        qty: it.qty,
        unitPrice: it.unitPrice,
        taxAmount: it.taxAmount,
        total: it.unitPrice * it.qty + it.taxAmount,
      }))
    );

    return inv;
  });

  void logAdminActivity(guard, {
    action: "purchase_invoice.create",
    entityType: "purchase_invoice",
    entityId: created.id,
    summary: `Created purchase invoice ${invoiceNumber}`,
    req,
  });

  return NextResponse.json({ id: created.id, invoiceNumber });
}
