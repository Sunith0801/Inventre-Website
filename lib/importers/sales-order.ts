import "server-only";
import { eq, and } from "drizzle-orm";
import { db } from "@/db/client";
import {
  orders,
  orderItems,
  parents,
  schools,
  productVariants,
  products,
} from "@/db/schema";
import type { DocTypeImporter, ImportRow } from "./_types";
import { pickField, pickInt } from "./_types";
import { allocOrderNumber } from "@/lib/numbering";
import { financialYearOf } from "@/lib/invoice-numbering";
import { placeOfSupply } from "@/lib/tax";

/**
 * Open Sales Order importer.
 *
 * Maps ERPNext Sales Order export → orders + orderItems. Filters to OPEN
 * orders only (status in Draft / To Deliver / To Bill / Submitted) so we
 * don't re-import history that's already invoiced. Lines are looked up by
 * `item_code` against product_variants.sku — anything we can't resolve is
 * skipped with a clear error.
 *
 * Idempotency: keyed on the original ERP order name passed as
 * `erp_so_name` → stored in `orders.notes` first line.
 *
 * Required headers (one per line for SO header):
 *   - name (ERP SO name, e.g. SO-2024-12345)
 *   - status (only ERP "Draft", "To Deliver and Bill", "To Bill", "To Deliver")
 *   - customer (ERP Customer name OR phone in mobile_no column)
 *   - mobile_no (parent's phone — preferred matcher)
 *   - school_name OR custom_student_school
 *   - transaction_date
 *   - item_code, qty, rate (line — repeated per row; group by `name`)
 */

type Stage = {
  erpName: string;
  status: string;
  customerKey: string;
  schoolName: string | null;
  studentGrade: string | null;
  txnDate: string;
  pincode: string | null;
  receiverName: string | null;
  receiverPhone: string | null;
  line1: string | null;
  city: string | null;
  state: string | null;
  lines: { itemCode: string; qty: number; rate: number }[];
};

const stageBuf = new Map<string, Stage>();

function reset() {
  stageBuf.clear();
}

const ACCEPTABLE_STATUSES = new Set(
  ["draft", "to deliver", "to deliver and bill", "to bill", "submitted"].map((s) =>
    s.toLowerCase()
  )
);

export const salesOrderImporter: DocTypeImporter = {
  doctype: "Sales Order (open)",
  filenameHints: ["sales_order", "sales-order", "salesorder", "so_export"],
  signatureHeaders: ["name", "transaction_date", "customer"],

  async processOne(row: ImportRow) {
    const erpName = pickField(row, "name", "Name");
    const status = (pickField(row, "status", "Status") ?? "").toLowerCase().trim();
    const itemCode = pickField(row, "item_code", "Item Code", "sku");

    if (!erpName) return { result: "skipped", error: "missing ERP SO name" };

    // Header-only row (first time we see this name)
    if (!stageBuf.has(erpName)) {
      if (!ACCEPTABLE_STATUSES.has(status)) {
        return { result: "skipped", error: `closed status: ${status}` };
      }
      stageBuf.set(erpName, {
        erpName,
        status,
        customerKey:
          pickField(row, "mobile_no", "Mobile No") ??
          pickField(row, "customer", "Customer") ??
          "",
        schoolName: pickField(row, "school_name", "custom_student_school"),
        studentGrade: pickField(row, "custom_student_grade", "grade"),
        txnDate:
          pickField(row, "transaction_date", "Transaction Date") ??
          new Date().toISOString().slice(0, 10),
        pincode: pickField(row, "pincode", "shipping_pincode"),
        receiverName: pickField(row, "receiver_name", "shipping_name"),
        receiverPhone: pickField(row, "receiver_phone", "shipping_phone"),
        line1: pickField(row, "shipping_address_line1", "address_line1"),
        city: pickField(row, "shipping_city", "city"),
        state: pickField(row, "shipping_state", "state"),
        lines: [],
      });
    }

    const stage = stageBuf.get(erpName)!;

    if (itemCode) {
      const qty = pickInt(row, "qty", "Qty") ?? 1;
      const rateRupees = pickInt(row, "rate", "Rate") ?? 0;
      stage.lines.push({
        itemCode,
        qty,
        rate: rateRupees * 100, // store paise
      });
    }

    // The importer drives this row-by-row; we flush at finalize() — but the
    // shared interface only has processOne. So flush opportunistically when
    // the buffer has accumulated AND a ready signal is given via no item_code
    // (header-only second pass) OR drain at end via finalize hack: we flush
    // only when an explicit `final_row` field is set OR when the last row.
    // Simplest: flush every time and let idempotency dedupe.
    if (stage.lines.length === 0) return { result: "skipped" };
    return await flush(erpName);
  },
};

async function flush(erpName: string): Promise<{ result: "new" | "updated" | "skipped" | "error"; error?: string }> {
  const stage = stageBuf.get(erpName);
  if (!stage) return { result: "skipped" };

  // Idempotency check — does an order with this erpName already exist?
  // Stored in notes first line: `erp_so:<erpName>`
  const existing = await db
    .select({ id: orders.id })
    .from(orders)
    .where(eq(orders.notes, `erp_so:${erpName}`))
    .limit(1);
  if (existing[0]) {
    stageBuf.delete(erpName);
    return { result: "skipped", error: "already imported" };
  }

  // Resolve parent
  const phoneNorm = (stage.customerKey ?? "").replace(/\D/g, "").slice(-10);
  if (!phoneNorm || phoneNorm.length !== 10) {
    return { result: "error", error: `cannot resolve parent for SO ${erpName}` };
  }
  const [parent] = await db
    .select()
    .from(parents)
    .where(eq(parents.phone, phoneNorm))
    .limit(1);
  if (!parent) {
    return {
      result: "error",
      error: `parent not found for phone ${phoneNorm} (import customers first)`,
    };
  }

  // Resolve school by name
  let schoolId: string | null = null;
  if (stage.schoolName) {
    const [s] = await db
      .select({ id: schools.id })
      .from(schools)
      .where(eq(schools.name, stage.schoolName))
      .limit(1);
    schoolId = s?.id ?? null;
  }
  if (!schoolId) {
    return {
      result: "error",
      error: `school '${stage.schoolName}' not found (import schools first)`,
    };
  }

  // Resolve variants by SKU = itemCode
  const resolved: { variantId: string; productName: string; size: string; qty: number; rate: number; hsn: string | null }[] = [];
  for (const l of stage.lines) {
    const [v] = await db
      .select({
        variant: productVariants,
        product: products,
      })
      .from(productVariants)
      .innerJoin(products, eq(products.id, productVariants.productId))
      .where(eq(productVariants.sku, l.itemCode))
      .limit(1);
    if (!v) {
      return {
        result: "error",
        error: `variant SKU ${l.itemCode} not found (import items first)`,
      };
    }
    resolved.push({
      variantId: v.variant.id,
      productName: v.product.name,
      size: v.variant.size,
      qty: l.qty,
      rate: l.rate,
      hsn: v.product.hsnCode ?? null,
    });
  }

  const subtotal = resolved.reduce((s, r) => s + r.rate * r.qty, 0);
  const orderNumber = await allocOrderNumber(new Date(stage.txnDate));
  const shippingAddress = {
    receiverName: stage.receiverName ?? parent.name ?? "",
    receiverPhone: stage.receiverPhone ?? parent.phone,
    line1: stage.line1 ?? "(imported)",
    city: stage.city ?? "(imported)",
    state: stage.state ?? "(imported)",
    pincode: stage.pincode ?? "000000",
  };

  await db.transaction(async (tx) => {
    const [draft] = await tx
      .insert(orders)
      .values({
        orderNumber,
        parentId: parent.id,
        schoolId,
        status: "placed", // imported as open
        paymentStatus: "pending",
        subtotal,
        tax: 0,
        shipping: 0,
        discount: 0,
        total: subtotal,
        shippingAddress,
        notes: `erp_so:${erpName}`,
        placedAt: new Date(stage.txnDate),
        schoolNameSnapshot: stage.schoolName,
        financialYear: financialYearOf(new Date(stage.txnDate)),
        placeOfSupply:
          stage.pincode != null ? placeOfSupply(stage.pincode) : null,
        gstCategory: "Unregistered",
      })
      .returning();
    await tx.insert(orderItems).values(
      resolved.map((r) => ({
        orderId: draft.id,
        variantId: r.variantId,
        nameSnapshot: r.productName,
        size: r.size,
        qty: r.qty,
        unitPrice: r.rate,
        total: r.rate * r.qty,
        hsnCodeSnapshot: r.hsn,
      }))
    );
  });

  stageBuf.delete(erpName);
  return { result: "new" };
}

export const __resetSalesOrderImporter = reset;
