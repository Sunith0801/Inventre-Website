import "server-only";
import crypto from "crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  orders,
  orderItems,
  payments,
  students,
  schools,
  parents,
  productVariants,
  products,
  webhookDeliveries,
  webhookEndpoints,
  erpOutboundQueue,
} from "@/db/schema";
import { getErpConfig, isErpBridgeConfigured } from "@/lib/erp-config";

export type ErpEventType =
  | "order.created"
  | "order.updated"
  | "order.cancelled"
  | "payment.updated"
  | "student.upserted"
  | "guardian.upserted"
  | "address.upserted";

/**
 * ERP bridge — non-blocking emitter that ships canonical ERPNext-shaped
 * envelopes to the ERP `/api/ecom/ingest` endpoint.
 *
 * Hooks (call from anywhere; never throws to the caller):
 *   void emitOrderEvent(orderId, "order.created");
 *   void emitOrderEvent(orderId, "order.updated");
 *   void emitOrderEvent(orderId, "payment.updated");
 *   void emitOrderEvent(orderId, "order.cancelled");
 *
 * Delivery is reused on the existing `webhook_deliveries` table so the
 * /admin/erp-sync page can render history + replays. Sequence numbers
 * come from a single global pg sequence — monotonic per aggregate is
 * trivially satisfied because nextval is globally monotonic.
 */

const ENDPOINT_NAME = "erp-bridge";

// All ERP env reads go through lib/erp-config. Never read process.env.ERP_*
// directly here so the staging↔prod switch stays a one-variable change.

async function nextSeq(): Promise<number> {
  await db.execute(sql`CREATE SEQUENCE IF NOT EXISTS erp_event_seq`);
  const result: any = await db.execute(
    sql`SELECT nextval('erp_event_seq') AS seq`
  );
  const rows = result.rows ?? result;
  const v = Array.isArray(rows) ? rows[0]?.seq : rows[0]?.seq;
  return Number(v);
}

async function ensureEndpoint(url: string, secret: string): Promise<string> {
  const [existing] = await db
    .select()
    .from(webhookEndpoints)
    .where(eq(webhookEndpoints.name, ENDPOINT_NAME))
    .limit(1);
  if (existing) {
    if (existing.url !== url) {
      await db
        .update(webhookEndpoints)
        .set({ url })
        .where(eq(webhookEndpoints.id, existing.id));
    }
    return existing.id;
  }
  const [created] = await db
    .insert(webhookEndpoints)
    .values({
      name: ENDPOINT_NAME,
      url,
      secret,
      events: [
        "order.created",
        "order.updated",
        "order.cancelled",
        "payment.updated",
      ],
      enabled: true,
    })
    .returning();
  return created.id;
}

function sign(secret: string, body: string): string {
  return crypto.createHmac("sha256", secret).update(body, "utf8").digest("hex");
}

function isoDate(d: Date | string | null | undefined): string {
  const dd = d instanceof Date ? d : d ? new Date(d) : new Date();
  return dd.toISOString().slice(0, 10);
}

/** Build the ERPNext-shaped `data` blob the ingest router expects. */
export async function buildErpOrderPayload(
  orderId: string
): Promise<{ order: Record<string, unknown> } | null> {
  const [order] = await db
    .select()
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);
  if (!order) return null;

  const rawItems = await db
    .select({
      item: orderItems,
      variant: productVariants,
      product: products,
    })
    .from(orderItems)
    .innerJoin(productVariants, eq(productVariants.id, orderItems.variantId))
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(eq(orderItems.orderId, orderId));

  const [parent] = await db
    .select()
    .from(parents)
    .where(eq(parents.id, order.parentId))
    .limit(1);

  const [student] = order.studentId
    ? await db
        .select()
        .from(students)
        .where(eq(students.id, order.studentId))
        .limit(1)
    : [null as any];

  const [school] = await db
    .select()
    .from(schools)
    .where(eq(schools.id, order.schoolId))
    .limit(1);

  // Multi-school baskets only attach the basket's payment row to the
  // PRIMARY order (see app/api/checkout/ccavenue/create-order/route.ts).
  // Siblings sharing the same orderGroupId have no payment row of their
  // own, so a naive WHERE order_id = sibling.id returns nothing and audit
  // ends up with empty `custom_payment_status` / `_mode` / `_flow` columns
  // — those rows are then hidden by audit's UI filters. Fall back to any
  // paid payment row in the same orderGroupId so siblings ship the
  // basket's payment metadata.
  let [payment] = await db
    .select()
    .from(payments)
    .where(eq(payments.orderId, orderId))
    .limit(1);
  if (!payment && order.orderGroupId) {
    const siblingPayments = await db
      .select({ p: payments })
      .from(payments)
      .innerJoin(orders, eq(orders.id, payments.orderId))
      .where(
        sql`${orders.orderGroupId} = ${order.orderGroupId} AND ${payments.status} = 'paid'`
      )
      .limit(1);
    payment = siblingPayments[0]?.p;
  }

  const addr: any = (order.shippingAddress as any) || {};
  const display = [
    addr.receiverName,
    addr.receiverPhone,
    addr.line1,
    addr.line2,
    addr.city,
    addr.state,
    addr.pincode,
  ]
    .filter(Boolean)
    .join(", ");

  const resolveItemCode = (
    variant: { id: string; erpName: string | null; sku: string | null },
    product: { erpName: string | null; itemCode: string | null }
  ): string =>
    variant.erpName ?? variant.sku ?? product.erpName ?? product.itemCode ?? variant.id;

  const items = rawItems.map(({ item, variant, product }) => ({
    item_code: resolveItemCode(variant, product),
    item_name: item.nameSnapshot,
    qty: item.qty,
    rate: item.unitPrice, // paise (ERP converts via rupees())
    amount: item.total, // paise
    uom: product.erpUom ?? "Nos",
    hsn: item.hsnCodeSnapshot ?? product.hsnCode ?? null,
  }));

  // Sub-items: every magic-box / bundle order_item carries its component
  // picks as JSONB on `order_items.bundle_selections`. The configurator
  // writes `{ variantId, name, size, qty, attributes }` per pick — we
  // resolve each variantId to its ERP item_code using the same fallback
  // chain as the parent line, then ship the full BOM so audit can
  // reconcile fulfilment against the variant-level picks the parent made.
  const componentVariantIds = new Set<string>();
  for (const { item } of rawItems) {
    const sels: any = item.bundleSelections;
    if (!Array.isArray(sels)) continue;
    for (const s of sels) {
      if (typeof s?.variantId === "string") componentVariantIds.add(s.variantId);
    }
  }

  const componentLookup = new Map<
    string,
    { item_code: string; item_name: string | null }
  >();
  if (componentVariantIds.size > 0) {
    const rows = await db
      .select({ variant: productVariants, product: products })
      .from(productVariants)
      .innerJoin(products, eq(products.id, productVariants.productId))
      .where(inArray(productVariants.id, Array.from(componentVariantIds)));
    for (const { variant, product } of rows) {
      componentLookup.set(variant.id, {
        item_code: resolveItemCode(variant, product),
        item_name: product.itemCode ?? product.erpName ?? null,
      });
    }
  }

  const subItems: any[] = [];
  for (const { item, variant, product } of rawItems) {
    const sels: any = item.bundleSelections;
    if (!Array.isArray(sels) || sels.length === 0) continue;
    const parentItemCode = resolveItemCode(variant, product);
    for (const s of sels) {
      const resolved = typeof s?.variantId === "string"
        ? componentLookup.get(s.variantId)
        : undefined;
      if (!resolved) {
        console.warn(
          `[erp-bridge] could not resolve variantId for bundle selection on order ${orderId}: ${JSON.stringify(s)}`
        );
        continue;
      }
      const attrs = Array.isArray(s?.attributes) ? s.attributes : [];
      const variantLabel = attrs
        .map((a: any) => a?.value)
        .filter((v: unknown) => typeof v === "string" && v.length > 0)
        .join(" · ");
      subItems.push({
        parent_item_code: parentItemCode,
        item_code: resolved.item_code,
        item_name: typeof s?.name === "string" ? s.name : resolved.item_name,
        qty: typeof s?.qty === "number" ? s.qty : 1,
        size: typeof s?.size === "string" && s.size.length > 0 ? s.size : null,
        variant_label: variantLabel.length > 0 ? variantLabel : null,
      });
    }
  }

  const hasMagicBox = rawItems.some(({ product }) => product.kind === "magic_box");

  const paymentBlock = payment
    ? {
        internal_reference:
          payment.internalPaymentReference ?? payment.gatewayOrderId ?? null,
        mode: payment.paymentMode ?? payment.method ?? "CCAvenue",
        flow: payment.paymentFlow ?? "ONLINE",
        status:
          payment.status === "paid"
            ? "SUCCESS"
            : (payment.status ?? "PENDING").toUpperCase(),
        paid_amount: payment.paidAmount
          ? Math.round(parseFloat(payment.paidAmount) * 100)
          : payment.status === "paid"
            ? payment.amount
            : 0,
      }
    : null;

  return {
    order: {
      id: order.id,
      order_number: order.orderNumber,
      status: order.status,
      payment_status: order.paymentStatus,
      transaction_date: isoDate(order.placedAt ?? order.createdAt),
      currency: "INR",
      subtotal: order.subtotal,
      tax: order.tax,
      total: order.total,
      school_code: school?.schoolCode ?? null,
      school_name: order.schoolNameSnapshot ?? school?.name ?? null,
      grade: order.gradeSnapshot ?? student?.grade ?? null,
      magic_box: hasMagicBox,
      customer: {
        name: parent
          ? `CUST-${(parent.customerCode ?? parent.id).slice(0, 32)}`
          : null,
        // Human-readable label for ERP's `so.customer_name`. Falls back
        // through student name → shipping receiver → parent name. ERP
        // is wired to prefer `display_name` over `name` for the label
        // column, so dashboards/labels no longer show the customer code.
        display_name:
          (student?.firstName as string | undefined) ??
          (addr.receiverName as string | undefined) ??
          (parent?.name as string | undefined) ??
          null,
        mobile: parent?.phone ?? null,
        email: parent?.email ?? null,
        group: parent?.customerGroup ?? "Student",
      },
      student: student
        ? {
            name:
              student.erpName ??
              student.enrollmentNumber ??
              `STU-${student.id.slice(0, 8)}`,
            enrollment_number: student.enrollmentNumber ?? null,
            school_code: student.schoolCode ?? school?.schoolCode ?? null,
            grade: student.grade ?? null,
          }
        : null,
      payment: paymentBlock,
      shipping_address: {
        display,
        // Structured fields so ERP can fan them into individual columns
        // for label printing — the `display` text is a fallback only.
        receiver_name: addr.receiverName ?? null,
        receiver_phone: addr.receiverPhone ?? null,
        line1: addr.line1 ?? null,
        line2: addr.line2 ?? null,
        city: addr.city ?? null,
        state: addr.state ?? null,
        pincode: addr.pincode ?? null,
      },
      items,
      sub_items: subItems,
      payment_schedule: [],
    },
  };
}

/** Low-level: POST a signed envelope to ERP ingest and record in webhook_deliveries. */
export async function postErpEvent(
  eventType: string,
  aggregate: string,
  data: Record<string, unknown>
): Promise<{ ok: boolean; status: number; body: string; deliveryId: number; erp_name?: string }> {
  const cfg = getErpConfig();
  if (!isErpBridgeConfigured(cfg)) {
    console.warn(
      `[erp-bridge] ingest URL / secret not set (target=${cfg.target}); skipping ERP emit`
    );
    return { ok: false, status: 0, body: "config missing", deliveryId: 0 };
  }
  const url = cfg.ingestUrl;
  const secret = cfg.webhookSecret;
  const seq = await nextSeq();
  const envelope = {
    event_id: crypto.randomUUID(),
    event_type: eventType,
    aggregate,
    seq,
    data,
  };
  const body = JSON.stringify(envelope);
  const signature = sign(secret, body);
  const endpointId = await ensureEndpoint(url, secret);

  const [delivery] = await db
    .insert(webhookDeliveries)
    .values({
      endpointId,
      event: eventType,
      payload: envelope as never,
      status: null,
    })
    .returning();

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Ecom-Signature": signature,
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    const respText = await res.text().catch(() => "");
    await db
      .update(webhookDeliveries)
      .set({
        status: res.status,
        responseBody: respText.slice(0, 4000),
        deliveredAt: res.ok ? new Date() : null,
        nextRetryAt: res.ok ? null : new Date(Date.now() + 60_000),
      })
      .where(eq(webhookDeliveries.id, delivery.id));
    await db
      .update(webhookEndpoints)
      .set({
        lastDeliveryAt: new Date(),
        lastStatus: res.status,
        lastError: res.ok ? null : `HTTP ${res.status}: ${respText.slice(0, 200)}`,
      })
      .where(eq(webhookEndpoints.id, endpointId));
    // ERP returns `{ "status": "applied", "erp_name": "SAL-ORD-..." }` on success.
    // Surface the erp_name so the drainer can pin it to orders.erp_so_name.
    let erp_name: string | undefined;
    if (res.ok) {
      try {
        const parsed = JSON.parse(respText) as { erp_name?: string };
        if (typeof parsed?.erp_name === "string") erp_name = parsed.erp_name;
      } catch {}
    }
    return { ok: res.ok, status: res.status, body: respText, deliveryId: delivery.id, erp_name };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    console.error("[erp-bridge] POST failed:", msg);
    await db
      .update(webhookDeliveries)
      .set({
        status: 0,
        responseBody: msg,
        nextRetryAt: new Date(Date.now() + 60_000),
      })
      .where(eq(webhookDeliveries.id, delivery.id));
    await db
      .update(webhookEndpoints)
      .set({ lastDeliveryAt: new Date(), lastStatus: 0, lastError: msg })
      .where(eq(webhookEndpoints.id, endpointId));
    return { ok: false, status: 0, body: msg, deliveryId: delivery.id };
  }
}

/**
 * High-level — buffered enqueue.
 *
 * Inserts one row into `erp_outbound_queue` with `scheduled_for = now() +
 * ERP_BUFFER_DELAY_SECONDS` (default 180 s). The drain worker picks it up
 * later and does the actual HTTP POST to ERP. Checkout returns immediately
 * even if ERP is down.
 *
 * Idempotency / coalescing is left to the receiver — ERP dedupes on the
 * envelope's event_id, which is minted at drain time, so a duplicate
 * enqueue is harmless.
 */
export async function enqueueOrderEvent(
  orderId: string,
  eventType: ErpEventType
): Promise<{ id: string } | null> {
  try {
    const cfg = getErpConfig();
    const delay = cfg.bufferDelaySeconds;
    const [row] = await db
      .insert(erpOutboundQueue)
      .values({
        orderId,
        eventType,
        scheduledFor: new Date(Date.now() + delay * 1000),
      })
      .returning({ id: erpOutboundQueue.id });
    return row ?? null;
  } catch (e) {
    // Never throw to the caller — checkout must continue even if the
    // queue write fails. Surface to logs for ops to notice.
    console.error(`[erp-bridge] enqueue ${eventType} ${orderId} failed:`, e);
    return null;
  }
}

/**
 * Legacy direct-emit (no buffer). Retained for the admin "Replay" path and
 * any one-off ops scripts that need to bypass the queue. New code should
 * call `enqueueOrderEvent` instead — the buffer is the whole point of the
 * new design.
 */
export async function emitOrderEvent(
  orderId: string,
  eventType: ErpEventType
): Promise<void> {
  try {
    const data = await buildErpOrderPayload(orderId);
    if (!data) return;
    await postErpEvent(eventType, `order:${orderId}`, data);
  } catch (e) {
    console.error(`[erp-bridge] ${eventType} ${orderId} failed:`, e);
  }
}

/** For the admin UI's "Resend" button. */
export async function replayDelivery(deliveryId: number): Promise<{ ok: boolean; status: number }> {
  const [d] = await db
    .select()
    .from(webhookDeliveries)
    .where(eq(webhookDeliveries.id, deliveryId))
    .limit(1);
  if (!d) return { ok: false, status: 0 };
  const env: any = d.payload;
  const r = await postErpEvent(env.event_type, env.aggregate, env.data);
  return { ok: r.ok, status: r.status };
}


// ─── Phase 5 §9: student/guardian/address standalone emit ────────────
// Storefront admin's create/update of a student, guardian, or address
// (outside the order flow) needs to land on the ERP. /api/ecom/ingest
// already accepts these event types; this just wires the emit path.

export async function buildStudentPayload(
  studentId: string
): Promise<{ student: Record<string, unknown> } | null> {
  const [s] = await db
    .select()
    .from(students)
    .where(eq(students.id, studentId))
    .limit(1);
  if (!s) return null;
  if (!s.erpName && !s.enrollmentNumber) return null;
  return {
    student: {
      erp_name: s.erpName,
      enrollment_number: s.enrollmentNumber,
      name: s.name,
      first_name: s.firstName,
      school_code: s.schoolCode,
      grade: s.grade,
      section: s.section,
      mobile: s.studentMobileNumber,
      email: s.studentEmailId,
      customer: s.customerLink,
    },
  };
}

export async function emitStudentEvent(studentId: string): Promise<void> {
  try {
    const data = await buildStudentPayload(studentId);
    if (!data) return;
    await postErpEvent("student.upserted", `student:${studentId}`, data);
  } catch (e) {
    console.error(`[erp-bridge] student.upserted ${studentId} failed:`, e);
  }
}

export async function buildGuardianPayload(
  linkId: string
): Promise<{ guardian: Record<string, unknown> } | null> {
  const out: any = await db.execute(sql`
    SELECT gl.id AS link_id, gl.guardian_erp_name, gl.guardian_name,
           gl.relation, gl.phone_no,
           s.erp_name AS stu_erp, s.enrollment_number AS stu_enroll
      FROM student_guardian_links gl
      JOIN students s ON s.id = gl.student_id
     WHERE gl.id = ${linkId}
     LIMIT 1
  `);
  const r = ((out?.rows ?? out ?? []) as any[])[0];
  if (!r) return null;
  if (!r.stu_erp && !r.stu_enroll) return null;
  return {
    guardian: {
      erp_name: r.guardian_erp_name,
      student_erp_name: r.stu_erp,
      student_enrollment_number: r.stu_enroll,
      name: r.guardian_name,
      relation: r.relation,
      phone_no: r.phone_no,
    },
  };
}

export async function emitGuardianEvent(linkId: string): Promise<void> {
  try {
    const data = await buildGuardianPayload(linkId);
    if (!data) return;
    await postErpEvent("guardian.upserted", `guardian:${linkId}`, data);
  } catch (e) {
    console.error(`[erp-bridge] guardian.upserted ${linkId} failed:`, e);
  }
}

export async function buildAddressPayload(
  addressId: string
): Promise<{ address: Record<string, unknown> } | null> {
  const out: any = await db.execute(sql`
    SELECT a.row_idx, a.address_type, a.kind, a.address_line_1,
           a.address_line_2, a.city, a.state, a.country, a.pincode,
           a.preferred,
           s.erp_name AS stu_erp, s.enrollment_number AS stu_enroll
      FROM student_addresses a
      JOIN students s ON s.id = a.student_id
     WHERE a.id = ${addressId}
     LIMIT 1
  `);
  const r = ((out?.rows ?? out ?? []) as any[])[0];
  if (!r) return null;
  if (!r.stu_erp && !r.stu_enroll) return null;
  return {
    address: {
      student_erp_name: r.stu_erp,
      student_enrollment_number: r.stu_enroll,
      row_idx: r.row_idx,
      address_type: r.address_type ?? r.kind,
      line1: r.address_line_1,
      line2: r.address_line_2,
      city: r.city,
      state: r.state,
      country: r.country ?? "India",
      pincode: r.pincode,
      preferred: r.preferred,
    },
  };
}

export async function emitAddressEvent(addressId: string): Promise<void> {
  try {
    const data = await buildAddressPayload(addressId);
    if (!data) return;
    await postErpEvent("address.upserted", `address:${addressId}`, data);
  } catch (e) {
    console.error(`[erp-bridge] address.upserted ${addressId} failed:`, e);
  }
}
