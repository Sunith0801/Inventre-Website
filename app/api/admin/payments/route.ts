import { NextResponse } from "next/server";
import { parseBody } from "@/lib/parse-body";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  paymentEntries,
  invoices,
  orders,
  purchaseInvoices,
} from "@/db/schema";
import { requirePermission, isResponse } from "@/lib/admin-guard";
import { allocPaymentNumber } from "@/lib/numbering";

const Body = z.object({
  direction: z.enum(["received", "paid"]),
  method: z.enum([
    "cash",
    "upi",
    "card",
    "netbanking",
    "wallet",
    "ccavenue",
    "bank_transfer",
    "cheque",
    "other",
  ]),
  amount: z.number().int().min(1), // paise
  parentId: z.string().uuid().nullable().optional(),
  supplierId: z.string().uuid().nullable().optional(),
  invoiceId: z.string().uuid().nullable().optional(),
  orderId: z.string().uuid().nullable().optional(),
  poId: z.string().uuid().nullable().optional(),
  referenceNumber: z.string().nullable().optional(),
  paymentDate: z.string(),
  notes: z.string().nullable().optional(),
});

export async function POST(req: Request) {
  const guard = await requirePermission("payments.write");
  if (isResponse(guard)) return guard;
  const parsed = await parseBody(req, Body);
  if (parsed instanceof NextResponse) return parsed;
  const body = parsed;
  const paymentNumber = await allocPaymentNumber();

  const reconcile: {
    invoiceId?: string;
    invoiceStatus?: string;
    invoiceOutstanding?: number;
    orderId?: string;
    orderPaymentStatus?: string;
    purchaseInvoiceId?: string;
  } = {};

  const [created] = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(paymentEntries)
      .values({
        paymentNumber,
        direction: body.direction,
        method: body.method,
        amount: body.amount,
        parentId: body.parentId ?? null,
        supplierId: body.supplierId ?? null,
        invoiceId: body.invoiceId ?? null,
        orderId: body.orderId ?? null,
        poId: body.poId ?? null,
        referenceNumber: body.referenceNumber ?? null,
        paymentDate: body.paymentDate,
        notes: body.notes ?? null,
        createdBy: guard.id,
      })
      .returning();

    // ── Reconcile against the linked invoice (customer side) ─────
    if (body.direction === "received" && body.invoiceId) {
      const [inv] = await tx
        .select()
        .from(invoices)
        .where(eq(invoices.id, body.invoiceId))
        .limit(1);
      if (inv) {
        const newOutstanding = Math.max(
          0,
          inv.outstandingAmount - body.amount
        );
        const newStatus =
          newOutstanding === 0
            ? "paid"
            : newOutstanding < inv.grandTotal
            ? "partly_paid"
            : inv.status;
        await tx
          .update(invoices)
          .set({
            outstandingAmount: newOutstanding,
            status: newStatus as never,
            updatedAt: new Date(),
          })
          .where(eq(invoices.id, body.invoiceId));
        reconcile.invoiceId = body.invoiceId;
        reconcile.invoiceStatus = newStatus;
        reconcile.invoiceOutstanding = newOutstanding;
      }
    }

    // ── Flip the linked SO paymentStatus (without an invoice) ───
    if (body.direction === "received" && body.orderId) {
      const [ord] = await tx
        .select()
        .from(orders)
        .where(eq(orders.id, body.orderId))
        .limit(1);
      if (ord) {
        // Sum prior received payments + this one
        const [s] = await tx
          .select({
            paid: sql<number>`COALESCE(SUM(${paymentEntries.amount}), 0)::bigint`,
          })
          .from(paymentEntries)
          .where(
            sql`${paymentEntries.orderId} = ${body.orderId} AND ${paymentEntries.direction} = 'received'`
          );
        const totalPaid = Number(s?.paid ?? 0);
        const newStatus =
          totalPaid >= ord.total
            ? "paid"
            : totalPaid > 0
            ? "partly_paid"
            : ord.paymentStatus;
        await tx
          .update(orders)
          .set({ paymentStatus: newStatus as never })
          .where(eq(orders.id, body.orderId));
        reconcile.orderId = body.orderId;
        reconcile.orderPaymentStatus = newStatus;
      }
    }

    // ── Reconcile against a supplier (purchase) invoice ─────────
    if (body.direction === "paid" && body.invoiceId) {
      // body.invoiceId is overloaded — try purchase_invoices first
      const [pinv] = await tx
        .select()
        .from(purchaseInvoices)
        .where(eq(purchaseInvoices.id, body.invoiceId))
        .limit(1);
      if (pinv) {
        const newOutstanding = Math.max(
          0,
          pinv.outstandingAmount - body.amount
        );
        const newStatus =
          newOutstanding === 0
            ? "paid"
            : newOutstanding < pinv.grandTotal
            ? "partly_paid"
            : pinv.status;
        await tx
          .update(purchaseInvoices)
          .set({
            outstandingAmount: newOutstanding,
            status: newStatus as never,
            updatedAt: new Date(),
          })
          .where(eq(purchaseInvoices.id, body.invoiceId));
        reconcile.purchaseInvoiceId = body.invoiceId;
      }
    }

    return [row];
  });

  return NextResponse.json({
    id: created.id,
    paymentNumber,
    reconcile,
  });
}
