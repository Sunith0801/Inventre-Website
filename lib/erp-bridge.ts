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
  returns,
  returnItems,
  missingItemClaims,
  missingItemClaimItems,
  concerns,
} from "@/db/schema";
import { getErpConfig, isErpBridgeConfigured } from "@/lib/erp-config";

export type ErpEventType =
  | "order.created"
  | "order.updated"
  | "order.cancelled"
  // Hard delete: admin removed the order entirely. Audit's ingest should
  // DELETE the Sales Order (+ children), not just cancel it. Only ever
  // direct-emitted from the admin DELETE route — never enqueued (the
  // buffered drain couldn't build an envelope for a row that's gone, and
  // erp_outbound_queue's CHECK constraint doesn't list it).
  | "order.deleted"
  | "payment.updated"
  | "student.upserted"
  | "guardian.upserted"
  | "address.upserted"
  // Customer-raised exchange flow (gated to EXCHANGE_TESTER_PHONES today).
  // Emitted on creation; the audit-side DocType "Exchange Request" is
  // the inbound target. Status flips come back via the inbound webhook
  // receiver at /api/erp/webhooks/exchange.
  | "exchange.requested"
  // Missing-item claim — customer never received the item, just needs
  // a fresh dispatch. No reverse logistics. Same gating as exchange.
  | "missing.requested"
  // Parent concern-portal ticket (payment / delivery / customer-care).
  // Pushed to the Audit call-centre Admin Panel; status flips return via
  // /api/erp/webhooks (audit-side ingest is specced separately). Emit is
  // best-effort — the durable record is the local `concerns` row.
  | "concern.created";

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

// The event sequence only needs to be created once per process, not on every
// emit. Issuing `CREATE SEQUENCE IF NOT EXISTS` per call took a catalog lock
// that serialized concurrent emitters (and spammed NOTICE logs). Cache the
// ensure-promise so the DDL runs at most once; concurrent first-callers all
// await the same promise.
let eventSeqEnsured: Promise<void> | null = null;
function ensureEventSeq(): Promise<void> {
  if (!eventSeqEnsured) {
    eventSeqEnsured = db
      .execute(sql`CREATE SEQUENCE IF NOT EXISTS erp_event_seq`)
      .then(() => undefined)
      .catch((e) => {
        // Reset on failure so the next call retries rather than caching a reject.
        eventSeqEnsured = null;
        throw e;
      });
  }
  return eventSeqEnsured;
}

async function nextSeq(): Promise<number> {
  await ensureEventSeq();
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
        "order.deleted",
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

/**
 * Full ISO-8601 timestamp WITH timezone (UTC "Z"), e.g. "2026-06-01T01:59:00.000Z".
 * Unlike `isoDate` (date-only, for ERPNext's date-typed `transaction_date`),
 * this preserves the actual time-of-day so audit can record the order's real
 * placed moment. Returns null when no timestamp is available so the payload
 * key is explicitly null rather than silently "now".
 */
function isoTimestamp(d: Date | string | null | undefined): string | null {
  if (d == null) return null;
  const dd = d instanceof Date ? d : new Date(d);
  return Number.isNaN(dd.getTime()) ? null : dd.toISOString();
}

// Fallback grade source when students.grade/class is missing: a Magic Box's
// item name encodes the grade (e.g. "SMS GRADE 5 MAGIC BOX GIRLS"). Mirrors
// audit's _magic_box_grade. Returns a canonical "Grade N" / "LKG" / "UKG" /
// "Nursery" only when the order's magic-box line(s) agree on one grade; null
// when there's no magic box or they disagree (ambiguous — never guess).
const MB_GRADE_NUM = /grade\s*([0-9]+)/i;
const MB_GRADE_KG = /\b(UKG|LKG|nursery)\b/i;
function deriveMagicBoxGrade(
  rows: Array<{
    item: { nameSnapshot: string | null };
    product: { kind: string | null };
  }>
): string | null {
  const grades = new Set<string>();
  for (const { item, product } of rows) {
    if (product.kind !== "magic_box") continue;
    const nm = item.nameSnapshot ?? "";
    const m = MB_GRADE_NUM.exec(nm);
    if (m) {
      grades.add(`Grade ${parseInt(m[1], 10)}`);
      continue;
    }
    const k = MB_GRADE_KG.exec(nm);
    if (k) {
      const tok = k[1].toLowerCase();
      grades.add(tok === "nursery" ? "Nursery" : tok.toUpperCase());
    }
  }
  return grades.size === 1 ? [...grades][0] : null;
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
  // Legacy bundle_selections rows (pre-UUID-discipline) sometimes carry an
  // item SKU string in `variantId` instead of a UUID. Passing those into
  // `inArray(productVariants.id, …)` triggers a Postgres uuid-parse error
  // and kills the whole drain attempt. Filter to well-formed UUIDs here;
  // legacy entries are handled by the existing "could not resolve" warn
  // below and just omit the sub-item from the envelope.
  const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const componentVariantIds = new Set<string>();
  for (const { item } of rawItems) {
    const sels: any = item.bundleSelections;
    if (!Array.isArray(sels)) continue;
    for (const s of sels) {
      if (typeof s?.variantId === "string" && UUID_RE.test(s.variantId)) {
        componentVariantIds.add(s.variantId);
      }
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

  // Resolve the grade to send to audit. Rule (verified 2026-06-21 against
  // prod DB + the storefront catalog path):
  //  - `students.grade` IS the canonical grade for EVERY school, with no
  //    exceptions. The storefront catalog filters products by an exact match
  //    `product_grades.grade = students.grade` (app/api/shop/products
  //    -> lib/repos/products.ts:listProductsForStudent), and `students.grade`
  //    resolves to a real catalog row for ~100% of active students at every
  //    school — QLPHP included (1344/1344). So whatever the parent saw in the
  //    shop is exactly `students.grade`, and that is what audit must mirror.
  //  - NO QLPHP -> class special-case. `students.class` is the ERP-uniform /
  //    academic number (offset from the real grade — e.g. QLPHP class is
  //    mostly grade+1) and is wrong as a catalog/real grade at every school
  //    (class != grade for the majority of students at most schools).
  //  - CRITICAL: never fall back to order.gradeSnapshot. gradeSnapshot is set
  //    from mixed, unreliable sources (student.class, the ERP custom_student_
  //    grade offset, a checkout-time gradeClass) and matches neither grade nor
  //    class for a large fraction of orders, so it silently lands wrong grades
  //    in audit (which stores order.grade verbatim).
  //  - When students.grade is missing (or the order has no linked student),
  //    derive from the Magic Box line name, which encodes "Grade N" in the
  //    catalog vocabulary; otherwise send null so a missing grade is visibly
  //    missing rather than silently wrong.
  //  See [[audit-grade-from-students-grade-not-snapshot]].
  const realStudentGrade = student?.grade ?? null;
  const resolvedGrade = realStudentGrade ?? deriveMagicBoxGrade(rawItems) ?? null;

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
      // Full timestamp of when the order was actually placed (date-only
      // `transaction_date` above loses the time-of-day). `placedAt` is the
      // real checkout moment; fall back to row creation if it was never
      // stamped. ISO-8601 UTC, e.g. "2026-06-01T01:59:00.000Z".
      placed_at: isoTimestamp(order.placedAt ?? order.createdAt),
      currency: "INR",
      subtotal: order.subtotal,
      tax: order.tax,
      total: order.total,
      school_code: school?.schoolCode ?? null,
      school_name: order.schoolNameSnapshot ?? school?.name ?? null,
      // Corrected real grade (see resolvedGrade above). Audit stores this
      // verbatim as custom_student_grade — it must NOT carry the gradeSnapshot
      // ±3 offset.
      grade: resolvedGrade,
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
            // Use the corrected grade too, so the student-master mirror in
            // audit never carries the offset value either.
            grade: resolvedGrade,
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

/**
 * Resolve a student's reference / admission code — the same "ref" rendered on
 * /admin/students. It lives on the MCB mirror (`mcb_students.raw`), keyed by
 * enrolment number, NOT on the students table, so this is a raw lookup.
 * Returns null when the student has no enrolment number or no MCB row / ref.
 */
async function getStudentReferenceCode(
  enrollmentNumber: string | null | undefined
): Promise<string | null> {
  if (!enrollmentNumber) return null;
  try {
    const res = await db.execute(sql`
      SELECT COALESCE(raw->>'StudentReferencesCode', raw->>'AdmissionNo') AS ref_code
        FROM mcb_students
       WHERE enrolment_number = ${enrollmentNumber}
       LIMIT 1
    `);
    const rows = (Array.isArray(res) ? res : (res as { rows?: unknown[] }).rows ?? []) as {
      ref_code: string | null;
    }[];
    return rows[0]?.ref_code ?? null;
  } catch (e) {
    // Never let a ref lookup failure sink the whole student emit — the
    // mcb_students table isn't guaranteed present in every environment.
    console.warn(
      `[erp-bridge] reference_code lookup failed for ${enrollmentNumber}:`,
      e instanceof Error ? e.message.slice(0, 200) : e
    );
    return null;
  }
}

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
  const referenceCode = await getStudentReferenceCode(s.enrollmentNumber);
  return {
    student: {
      erp_name: s.erpName,
      enrollment_number: s.enrollmentNumber,
      // Student reference / admission code (the "ref" on /admin/students).
      // Null when the student has no MCB-mirrored ref. Existing fields below
      // (enrollment_number, grade, school_code, section) are the authoritative
      // students-table columns.
      reference_code: referenceCode,
      name: s.name,
      first_name: s.firstName,
      school_code: s.schoolCode,
      // Canonical grade = students.grade for EVERY school (verified against the
      // storefront catalog: product_grades.grade = students.grade is an exact
      // match for ~100% of active students, QLPHP included). Audit uses the
      // student master as the grade source of truth and re-stamps Sales Orders
      // from it (ingest._apply_student), so this must be the catalog grade —
      // never students.class (the ERP-uniform/offset value) and never the
      // gradeSnapshot. Mirror of buildErpOrderPayload. See
      // [[audit-grade-from-students-grade-not-snapshot]].
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

// ─── Customer-raised exchange flow ──────────────────────────────────
//
// Phase 1 (tester-gated, see lib/exchange-gate.ts). Exchange events
// don't go through the outbound buffer queue — the row in `returns` is
// the durable record, so a failed emit can be replayed from
// /admin/erp-sync. Direct emit keeps the parent's submit-to-confirmation
// turnaround under a second.

export async function buildExchangePayload(
  returnId: string
): Promise<{ exchange: Record<string, unknown> } | null> {
  const [ret] = await db
    .select()
    .from(returns)
    .where(eq(returns.id, returnId))
    .limit(1);
  if (!ret) return null;
  if (ret.kind !== "exchange") return null;

  const [order] = await db
    .select()
    .from(orders)
    .where(eq(orders.id, ret.orderId))
    .limit(1);
  if (!order) return null;

  const [parent] = ret.parentId
    ? await db.select().from(parents).where(eq(parents.id, ret.parentId)).limit(1)
    : [null as any];

  const lineRows = await db
    .select({
      ri: returnItems,
      oi: orderItems,
      variant: productVariants,
      product: products,
    })
    .from(returnItems)
    .innerJoin(orderItems, eq(orderItems.id, returnItems.orderItemId))
    .innerJoin(productVariants, eq(productVariants.id, returnItems.variantId))
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(eq(returnItems.returnId, returnId));

  const resolveItemCode = (
    variant: { id: string; erpName: string | null; sku: string | null },
    product: { erpName: string | null; itemCode: string | null }
  ): string =>
    variant.erpName ?? variant.sku ?? product.erpName ?? product.itemCode ?? variant.id;

  // Per-item enrichment: each return_items row may carry its own reason
  // bundle (post-0057). We surface every field so audit can render
  // per-component cards without having to fall back to the head-row.
  // For each row that has its own requested_variant_id, we resolve it to
  // a small lookup so audit doesn't have to fetch separately.
  const perItemRequestedVariantIds = Array.from(
    new Set(
      lineRows
        .map(({ ri }) => (ri as { requestedVariantId?: string | null }).requestedVariantId ?? null)
        .filter((v): v is string => !!v),
    ),
  );
  const perItemVariantLookup = new Map<string, Record<string, unknown>>();
  if (perItemRequestedVariantIds.length > 0) {
    const rvRows = await db
      .select({ variant: productVariants, product: products })
      .from(productVariants)
      .innerJoin(products, eq(products.id, productVariants.productId))
      .where(inArray(productVariants.id, perItemRequestedVariantIds));
    for (const { variant: v, product: p } of rvRows) {
      perItemVariantLookup.set(v.id, {
        variant_id: v.id,
        item_code: resolveItemCode(v, p),
        item_name: p.name,
        size: v.size,
        sku: v.sku,
        image_url: v.imageUrl ?? null,
      });
    }
  }

  // items[] stays in the legacy shape so audit-dev's ingest schema
  // accepts it unchanged. Per-item enrichment lives in a sibling
  // `per_item_details` array (parallel index) for audit-side consumers
  // that have been updated to read it. Old audit ignores it.
  const items = lineRows.map(({ ri, oi, variant, product }) => ({
    order_item_id: oi.id,
    item_code: resolveItemCode(variant, product),
    item_name: oi.nameSnapshot,
    delivered_size: variant.size ?? null,
    qty: ri.qty,
    condition: ri.condition ?? null,
    line_reason: ri.reason ?? null,
  }));
  const perItemDetails = lineRows.map(({ ri, oi }) => {
    const r = ri as {
      subReason?: string | null;
      damageLocation?: string | null;
      replacementMode?: string | null;
      requestedVariantId?: string | null;
      requestedComponentPath?: Record<string, unknown> | null;
      notes?: string | null;
    };
    return {
      order_item_id: oi.id,
      sub_reason: r.subReason ?? null,
      damage_location: r.damageLocation ?? null,
      replacement_mode: r.replacementMode ?? null,
      requested_variant: r.requestedVariantId
        ? perItemVariantLookup.get(r.requestedVariantId) ?? null
        : null,
      requested_component_path: r.requestedComponentPath ?? null,
      notes: r.notes ?? null,
    };
  });

  const photos = Array.isArray(ret.photos) ? ret.photos : [];

  // Phase-2 enrichment: surface the requested variant's attributes
  // so audit + school staff can see EXACTLY what to hand over without
  // looking it up. Best-effort — null if the variant has been archived
  // since the customer submitted (we keep the row going regardless).
  let requestedVariant: Record<string, unknown> | null = null;
  if (ret.requestedVariantId) {
    const [rv] = await db
      .select({ variant: productVariants, product: products })
      .from(productVariants)
      .innerJoin(products, eq(products.id, productVariants.productId))
      .where(eq(productVariants.id, ret.requestedVariantId))
      .limit(1);
    if (rv) {
      requestedVariant = {
        variant_id: rv.variant.id,
        item_code: resolveItemCode(rv.variant, rv.product),
        item_name: rv.product.name,
        size: rv.variant.size,
        sku: rv.variant.sku,
        // Variant image — products has its primary image in the
        // `product_images` join table which is too heavy to fetch
        // inline here. Audit-side gets the variant override or null
        // and renders a placeholder when absent.
        image_url: rv.variant.imageUrl ?? null,
      };
    }
  }

  // Enrich requestedComponentPath with the resolved component item_code
  // + display fields. For kit / Magic Box exchanges, the operational
  // truth is "swap THIS component, not the whole box" — so the audit
  // side needs the component's SKU + name to spawn the right
  // packing_unit and surface the right item in the warehouse + school
  // views. Without this enrichment, the audit side defaults to the
  // kit's item_code (sending the warehouse to pack the entire box).
  let enrichedComponentPath: Record<string, unknown> | null = null;
  const rcp = ret.requestedComponentPath as
    | { variantId?: string; componentName?: string | null;
        attributes?: Array<{ name: string; value: string }>; }
    | null;
  if (rcp) {
    enrichedComponentPath = {
      variant_id: rcp.variantId ?? null,
      component_name: rcp.componentName ?? null,
      attributes: rcp.attributes ?? [],
    };
    if (rcp.variantId) {
      const [cp] = await db
        .select({ variant: productVariants, product: products })
        .from(productVariants)
        .innerJoin(products, eq(products.id, productVariants.productId))
        .where(eq(productVariants.id, rcp.variantId))
        .limit(1);
      if (cp) {
        Object.assign(enrichedComponentPath, {
          item_code: resolveItemCode(cp.variant, cp.product),
          item_name: cp.product.name,
          size: cp.variant.size,
          sku: cp.variant.sku,
          image_url: cp.variant.imageUrl ?? null,
        });
      }
    }
  }

  // CUST- prefix: parent.customerCode already starts with "CUST-" in
  // every row written by our customer-number minter; the earlier code
  // double-prefixed when it shouldn't. Pass-through when it already
  // starts with the prefix, mint otherwise (legacy / orphan rows).
  let customerCode: string | null = null;
  if (parent) {
    const code = parent.customerCode ?? parent.id;
    customerCode = code.startsWith("CUST-") ? code.slice(0, 64) : `CUST-${code.slice(0, 32)}`;
  }

  return {
    exchange: {
      id: ret.id,
      return_number: ret.returnNumber,
      kind: ret.kind,
      status: ret.status,
      reason: ret.reason,
      sub_reason: ret.subReason ?? null,
      notes: ret.notes,
      damage_location: ret.damageLocation ?? null,
      pickup_date: ret.pickupDate, // 'YYYY-MM-DD' or null
      requested_at: isoDate(ret.createdAt),
      requested_variant: requestedVariant,
      requested_component_path: enrichedComponentPath,
      // Honest record of what the customer chose. Audit reads
      // `raw.replacement_mode` to render the right "Customer wants" copy
      // — no silent inference, no hardcoded "fresh piece" text.
      replacement_mode: (ret as { replacementMode?: string | null }).replacementMode ?? null,
      order: {
        id: order.id,
        order_number: order.orderNumber,
        erp_so_name: order.erpSoName ?? null,
      },
      customer: parent
        ? {
            name: customerCode,
            display_name: parent.name ?? null,
            mobile: parent.phone ?? null,
            email: parent.email ?? null,
          }
        : null,
      items,
      // Optional per-item enrichment (parallel to items[] by index).
      // Old audit ingests ignore this key; updated ones can read it to
      // render per-component reasons. Migration 0057 backed.
      per_item_details: perItemDetails,
      photos,
    },
  };
}

/**
 * Push a parent concern-portal ticket to the Audit call-centre Admin Panel.
 * Best-effort: the durable record is the local `concerns` row, so a failed
 * emit (e.g. audit ingest not yet built) just logs. `order` is sent as the
 * SO reference (so the call-centre lands on the right order) when present.
 */
export async function emitConcernEvent(
  concernId: string,
  eventType: Extract<ErpEventType, `concern.${string}`>
): Promise<void> {
  try {
    const [c] = await db
      .select()
      .from(concerns)
      .where(eq(concerns.id, concernId))
      .limit(1);
    if (!c) return;
    const [order] = c.orderId
      ? await db.select().from(orders).where(eq(orders.id, c.orderId)).limit(1)
      : [null as never];
    const [parent] = c.parentId
      ? await db.select().from(parents).where(eq(parents.id, c.parentId)).limit(1)
      : [null as never];
    const data = {
      concern: {
        id: c.id,
        concern_number: c.concernNumber,
        category: c.category,
        sub_type: c.subType ?? null,
        team: c.team ?? null, // routing hint for the audit dashboard tabs
        description: c.description,
        details: c.details ?? null,
        contact_name: c.contactName ?? null,
        contact_phone: c.contactPhone,
        status: c.status,
        photos: c.photos ?? [],
        created_at: isoTimestamp(c.createdAt),
        order: order
          ? {
              id: order.id,
              order_number: order.orderNumber,
              erp_so_name: order.erpSoName ?? null,
            }
          : null,
        customer: parent
          ? {
              display_name: parent.name ?? null,
              mobile: parent.phone ?? null,
              email: parent.email ?? null,
            }
          : null,
      },
    };
    await postErpEvent(eventType, `concern:${concernId}`, data);
  } catch (e) {
    console.error(`[erp-bridge] ${eventType} ${concernId} failed:`, e);
  }
}

export async function emitExchangeEvent(
  returnId: string,
  eventType: Extract<ErpEventType, `exchange.${string}`>
): Promise<void> {
  try {
    const data = await buildExchangePayload(returnId);
    if (!data) return;
    await postErpEvent(eventType, `exchange:${returnId}`, data);
  } catch (e) {
    console.error(`[erp-bridge] ${eventType} ${returnId} failed:`, e);
  }
}

// ─── Missing-item claim payload + emit ──────────────────────────────

export async function buildMissingClaimPayload(
  claimId: string
): Promise<{ claim: Record<string, unknown> } | null> {
  const [cl] = await db
    .select()
    .from(missingItemClaims)
    .where(eq(missingItemClaims.id, claimId))
    .limit(1);
  if (!cl) return null;

  const [order] = await db
    .select()
    .from(orders)
    .where(eq(orders.id, cl.orderId))
    .limit(1);
  if (!order) return null;

  const [parent] = cl.parentId
    ? await db.select().from(parents).where(eq(parents.id, cl.parentId)).limit(1)
    : [null as any];

  // Lines + enriched component info (mirror of buildExchangePayload's
  // approach so the audit side gets resolved item_codes for any
  // component-level claims).
  const lineRows = await db
    .select()
    .from(missingItemClaimItems)
    .where(eq(missingItemClaimItems.claimId, claimId));

  const lines = await Promise.all(
    lineRows.map(async (li) => {
      // Pull the order_item to surface what was originally bought.
      const [oi] = await db
        .select({ oi: orderItems, variant: productVariants, product: products })
        .from(orderItems)
        .leftJoin(productVariants, eq(productVariants.id, orderItems.variantId))
        .leftJoin(products, eq(products.id, productVariants.productId))
        .where(eq(orderItems.id, li.orderItemId))
        .limit(1);

      const baseLineItemCode = oi && oi.variant && oi.product
        ? oi.variant.erpName ?? oi.variant.sku ?? oi.product.erpName ?? oi.product.itemCode ?? oi.variant.id
        : null;

      // Enrich missing_component_path if the customer drilled into a kit.
      let enrichedPath: Record<string, unknown> | null = null;
      const mcp = li.missingComponentPath as
        | { variantId?: string; componentName?: string | null;
            attributes?: Array<{ name: string; value: string }>; }
        | null;
      if (mcp) {
        enrichedPath = {
          variant_id: mcp.variantId ?? null,
          component_name: mcp.componentName ?? null,
          attributes: mcp.attributes ?? [],
        };
        if (mcp.variantId) {
          const [cp] = await db
            .select({ variant: productVariants, product: products })
            .from(productVariants)
            .innerJoin(products, eq(products.id, productVariants.productId))
            .where(eq(productVariants.id, mcp.variantId))
            .limit(1);
          if (cp) {
            Object.assign(enrichedPath, {
              item_code: cp.variant.erpName ?? cp.variant.sku ?? cp.product.erpName ?? cp.product.itemCode ?? cp.variant.id,
              item_name: cp.product.name,
              size: cp.variant.size,
              sku: cp.variant.sku,
              image_url: cp.variant.imageUrl ?? null,
            });
          }
        }
      }

      return {
        order_item_id: li.orderItemId,
        item_code: baseLineItemCode,
        item_name: oi?.oi.nameSnapshot ?? null,
        qty_short: li.qtyShort,
        missing_component_path: enrichedPath,
        notes: li.notes,
      };
    })
  );

  // CUST- prefix (same logic as exchange payload).
  let customerCode: string | null = null;
  if (parent) {
    const code = parent.customerCode ?? parent.id;
    customerCode = code.startsWith("CUST-") ? code.slice(0, 64) : `CUST-${code.slice(0, 32)}`;
  }

  return {
    claim: {
      id: cl.id,
      claim_number: cl.claimNumber,
      status: cl.status,
      notes: cl.notes,
      pickup_date: cl.pickupDate,
      requested_at: isoDate(cl.createdAt),
      order: {
        id: order.id,
        order_number: order.orderNumber,
        erp_so_name: order.erpSoName ?? null,
      },
      customer: {
        name: customerCode,
        display_name: parent ? `${parent.firstName ?? ""} ${parent.lastName ?? ""}`.trim() || null : null,
        mobile: parent?.phone ?? null,
      },
      items: lines,
      photos: Array.isArray(cl.photos) ? cl.photos : [],
    },
  };
}

export async function emitMissingClaimEvent(
  claimId: string,
  eventType: Extract<ErpEventType, `missing.${string}`>
): Promise<void> {
  try {
    const data = await buildMissingClaimPayload(claimId);
    if (!data) return;
    await postErpEvent(eventType, `missing:${claimId}`, data);
  } catch (e) {
    console.error(`[erp-bridge] ${eventType} ${claimId} failed:`, e);
  }
}
