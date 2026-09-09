import { NextResponse } from "next/server";
import { z } from "zod";
import { eq, and, desc, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import {
  orders,
  orderItems,
  parents,
  schools,
  students,
  productVariants,
  products,
  paymentEntries,
} from "@/db/schema";
import { requirePermission, isResponse } from "@/lib/admin-guard";
import { generateOrderNumber } from "@/lib/repos/orders";
import { financialYearOf } from "@/lib/invoice-numbering";
import { placeOfSupply } from "@/lib/tax";
import {
  applyStockChange,
  getDefaultWarehouseId,
} from "@/lib/repos/inventory";
import { logAdminActivity } from "@/lib/activity";

export async function GET(req: Request) {
  const guard = await requirePermission("orders.read");
  if (isResponse(guard)) return guard;
  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const paymentStatus = url.searchParams.get("paymentStatus");
  const schoolId = url.searchParams.get("schoolId");
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "100", 10), 500);

  const conds = [];
  if (status) conds.push(eq(orders.status, status as never));
  if (paymentStatus) conds.push(eq(orders.paymentStatus, paymentStatus as never));
  if (schoolId) conds.push(eq(orders.schoolId, schoolId));
  if (guard.role === "school_admin") {
    if (!guard.schoolId)
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    conds.push(eq(orders.schoolId, guard.schoolId));
  }

  const rows = await db
    .select({
      order: orders,
      parentName: parents.name,
      parentPhone: parents.phone,
      schoolName: schools.name,
    })
    .from(orders)
    .innerJoin(parents, eq(parents.id, orders.parentId))
    .innerJoin(schools, eq(schools.id, orders.schoolId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(orders.createdAt))
    .limit(limit);

  return NextResponse.json({ orders: rows });
}

/**
 * Admin-create order (walk-in / phone / POS). Bypasses the online gateway;
 * the admin captures payment offline (cash, UPI, bank transfer) or marks
 * as pending.
 *
 * If `paymentStatus` is "paid", we:
 *   - mark the order confirmed
 *   - decrement bins via applyStockChange (shipment_out)
 *   - log a payment_entries row (audit trail of received cash)
 *
 * If pending, the order lives at status="placed" and ops finishes it later.
 */
const PostBody = z.object({
  parentId: z.string().uuid(),
  studentId: z.string().uuid().optional(),
  schoolId: z.string().uuid(),
  items: z
    .array(
      z.object({
        variantId: z.string().uuid(),
        qty: z.number().int().min(1),
      })
    )
    .min(1),
  shippingAddress: z.object({
    receiverName: z.string().min(1),
    receiverPhone: z.string().regex(/^\d{10}$/),
    line1: z.string().min(1),
    line2: z.string().optional(),
    city: z.string().min(1),
    state: z.string().min(1),
    pincode: z.string().regex(/^\d{6}$/),
  }),
  paymentMethod: z.enum([
    "cash",
    "upi",
    "card",
    "netbanking",
    "bank_transfer",
    "cheque",
    "other",
  ]),
  paymentStatus: z.enum(["paid", "pending"]).default("paid"),
  paymentReference: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export async function POST(req: Request) {
  const guard = await requirePermission("orders.write");
  if (isResponse(guard)) return guard;

  let body: z.infer<typeof PostBody>;
  try {
    body = PostBody.parse(await req.json());
  } catch (e) {
    const msg = e instanceof z.ZodError
      ? e.issues.map((i) => i.message).join("; ")
      : "Invalid request";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  // school_admin can only place orders within their school
  if (guard.role === "school_admin") {
    if (!guard.schoolId || guard.schoolId !== body.schoolId)
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Resolve parent / school / variants
  const [parent] = await db
    .select()
    .from(parents)
    .where(eq(parents.id, body.parentId))
    .limit(1);
  if (!parent) return NextResponse.json({ error: "Parent not found" }, { status: 404 });

  const [school] = await db
    .select()
    .from(schools)
    .where(eq(schools.id, body.schoolId))
    .limit(1);
  if (!school) return NextResponse.json({ error: "School not found" }, { status: 404 });

  let student: typeof students.$inferSelect | null = null;
  if (body.studentId) {
    const [s] = await db
      .select()
      .from(students)
      .where(and(eq(students.id, body.studentId), eq(students.parentId, body.parentId)))
      .limit(1);
    if (!s) return NextResponse.json({ error: "Student not found" }, { status: 404 });
    student = s;
  }

  const variantIds = body.items.map((i) => i.variantId);
  const variantRows = await db
    .select({
      variant: productVariants,
      product: products,
    })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(inArray(productVariants.id, variantIds));
  if (variantRows.length !== new Set(variantIds).size) {
    return NextResponse.json({ error: "Unknown variant" }, { status: 400 });
  }
  const variantById = new Map(variantRows.map((r) => [r.variant.id, r]));

  // Compute totals from the catalog base price (admin path is direct;
  // pricing rules / discounts are out of scope of the POS form).
  let subtotal = 0;
  const itemsWithPrice = body.items.map((it) => {
    const v = variantById.get(it.variantId);
    if (!v) throw new Error("missing variant");
    const unit = v.product.basePrice ?? 0;
    const total = unit * it.qty;
    subtotal += total;
    return {
      variantId: it.variantId,
      qty: it.qty,
      unitPrice: unit,
      total,
      name: v.product.name,
      size: v.variant.size,
      hsn: v.product.hsnCode ?? null,
    };
  });

  const orderNumber = await generateOrderNumber();
  const warehouseId = await getDefaultWarehouseId();
  const now = new Date();

  // Single transaction wraps order + items + (when paid) stock decrement +
  // payment ledger. A failure anywhere rolls back the entire write — no
  // orphan orders, no payment-without-stock drift.
  const { allocPaymentNumber } = await import("@/lib/numbering");
  let paidPaymentNumber: string | null = null;
  if (body.paymentStatus === "paid") {
    paidPaymentNumber = await allocPaymentNumber();
  }

  try {
    const created = await db.transaction(async (tx) => {
      const [draft] = await tx
        .insert(orders)
        .values({
          orderNumber,
          parentId: body.parentId,
          studentId: body.studentId ?? null,
          schoolId: body.schoolId,
          status: body.paymentStatus === "paid" ? "confirmed" : "placed",
          paymentStatus: body.paymentStatus,
          subtotal,
          tax: 0,
          shipping: 0,
          discount: 0,
          total: subtotal,
          shippingAddress: body.shippingAddress,
          notes: body.notes ?? null,
          placedAt: now,
          confirmedAt: body.paymentStatus === "paid" ? now : null,
          schoolNameSnapshot: school.name,
          warehouseId,
          financialYear: financialYearOf(),
          placeOfSupply: placeOfSupply(body.shippingAddress.pincode),
          gstCategory: "Unregistered",
        })
        .returning();

      await tx.insert(orderItems).values(
        itemsWithPrice.map((l) => ({
          orderId: draft.id,
          variantId: l.variantId,
          nameSnapshot: l.name,
          size: l.size,
          qty: l.qty,
          unitPrice: l.unitPrice,
          total: l.total,
          hsnCodeSnapshot: l.hsn,
        }))
      );

      if (body.paymentStatus === "paid") {
        for (const it of itemsWithPrice) {
          await applyStockChange({
            variantId: it.variantId,
            warehouseId,
            delta: -it.qty,
            reason: "shipment_out",
            refType: "order",
            refId: draft.id,
            createdBy: guard.id,
          });
        }

        await tx.insert(paymentEntries).values({
          paymentNumber: paidPaymentNumber!,
          direction: "received",
          method: body.paymentMethod,
          amount: subtotal,
          parentId: body.parentId,
          orderId: draft.id,
          referenceNumber: body.paymentReference ?? null,
          paymentDate: now.toISOString().slice(0, 10),
          notes: body.notes ?? null,
          createdBy: guard.id,
        });
      }

      return draft;
    });

    void logAdminActivity(guard, {
      action: "order.create",
      entityType: "order",
      entityId: created.id,
      summary: `Created order ${orderNumber} (${body.paymentStatus})`,
      req,
    });

    return NextResponse.json({ id: created.id, orderNumber });
  } catch (e) {
    return NextResponse.json(
      {
        error:
          e instanceof Error
            ? `Order creation failed: ${e.message}`
            : "Order creation failed",
      },
      { status: 409 }
    );
  }
}
