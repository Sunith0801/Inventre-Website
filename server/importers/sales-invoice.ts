import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { invoices, orders, parents } from "@/db/schema";
import type { DocTypeImporter, ImportRow } from "@/server/importers/_types";
import { pickField, pickInt } from "@/server/importers/_types";

function fyOf(d: string | Date): string {
  const dt = d instanceof Date ? d : new Date(d);
  const m = dt.getMonth() + 1;
  const y = dt.getFullYear();
  return m >= 4
    ? `${String(y).slice(-2)}-${String(y + 1).slice(-2)}`
    : `${String(y - 1).slice(-2)}-${String(y).slice(-2)}`;
}

const STATUS_MAP: Record<string, "draft" | "submitted" | "paid" | "overdue" | "cancelled"> = {
  Draft: "draft",
  Submitted: "submitted",
  Paid: "paid",
  Overdue: "overdue",
  Cancelled: "cancelled",
  Return: "submitted",
  Unpaid: "submitted",
  "Partly Paid": "submitted",
  "Credit Note Issued": "submitted",
};

export const salesInvoiceImporter: DocTypeImporter = {
  doctype: "Sales Invoice",
  filenameHints: ["sales_invoice", "sales-invoice", "invoice", "invoices"],
  signatureHeaders: ["customer", "posting_date", "grand_total"],

  async processOne(row: ImportRow) {
    const invoiceNumber = pickField(row, "name", "Invoice #", "Invoice Number");
    if (!invoiceNumber) return { result: "skipped", error: "missing invoice name" };

    // Idempotency
    const existing = await db.select().from(invoices).where(eq(invoices.invoiceNumber, invoiceNumber)).limit(1);
    if (existing[0]) return { result: "skipped", error: "already imported" };

    const linkedSO = pickField(row, "sales_order", "Sales Order", "against_sales_order");
    if (!linkedSO) return { result: "skipped", error: "no linked Sales Order column" };

    const o = await db.select().from(orders).where(eq(orders.orderNumber, linkedSO)).limit(1);
    if (!o[0]) return { result: "skipped", error: `linked order ${linkedSO} not found` };

    const postingDate = pickField(row, "posting_date", "Posting Date") ?? new Date().toISOString().slice(0, 10);
    const dueDate = pickField(row, "due_date", "Due Date") ?? postingDate;

    const netP = (pickInt(row, "net_total", "Net Total") ?? 0) * 100;
    const taxP = (pickInt(row, "total_taxes_and_charges", "Tax") ?? 0) * 100;
    const grandP = (pickInt(row, "grand_total", "Grand Total") ?? 0) * 100;
    const outstandingP = (pickInt(row, "outstanding_amount", "Outstanding") ?? 0) * 100;
    const status = pickField(row, "status", "Status") ?? "Submitted";
    const isReturn = pickField(row, "is_return", "Is Return") === "1";

    await db.insert(invoices).values({
      invoiceNumber,
      financialYear: fyOf(postingDate),
      orderId: o[0].id,
      parentId: o[0].parentId,
      postingDate,
      dueDate,
      netTotal: netP,
      taxTotal: taxP,
      grandTotal: grandP,
      outstandingAmount: outstandingP,
      status: STATUS_MAP[status] ?? "submitted",
      isReturn,
      billingAddress: o[0].shippingAddress as object,
      shippingAddress: o[0].shippingAddress as object,
      placeOfSupply: pickField(row, "place_of_supply", "Place of Supply"),
      gstCategory: pickField(row, "gst_category", "GST Category") ?? "Unregistered",
    });

    return { result: "new" };
  },
};
