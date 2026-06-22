/* eslint-disable no-console */
/**
 * Focused-mode backfill for the two long-tail steps (09-addresses,
 * 10-orders). Instead of paginating through all ~30k ERP rows and
 * dereferencing each row's Customer via a per-row erpGetDoc, this script:
 *
 *   1. Pre-fetches every ERP Customer (≤ cutover) in one bulk pass
 *      → builds erpCustomerName → localParent map in memory.
 *   2. Streams the missing-SO names against local orders.orderNumber
 *      and fetches detail ONLY for the ones we don't already have.
 *   3. Streams ERP Address names, fetches detail, looks up customer
 *      in the in-memory map (no per-row Customer fetch).
 *
 * Net effect: orders step goes from ~16k full fetches to ~300 targeted
 * fetches, addresses step keeps full doc fetches but drops the second
 * per-row API call. ETA falls from ~80 min to ~20 min for the same end
 * state — same cutover guards, same upsert logic.
 *
 *   npx tsx scripts/migrate-from-erp/_backfill-missing.ts [--orders-only|--addresses-only]
 */

import crypto from "crypto";
import { erpListPages, erpGetDoc } from "./_client";
import {
  db,
  shutdown,
  ensureCheckpointTable,
  logMigrationError,
  CUTOVER_DATE,
  CUTOVER_ISO,
} from "./_db";
import {
  orders,
  orderItems,
  payments,
  parents,
  schools,
  productVariants,
  addresses,
} from "../../db/schema";
import { and, eq } from "drizzle-orm";

// ── Helpers ──────────────────────────────────────────────────────────

function normalizePhone(p?: string | null): string | null {
  if (!p) return null;
  const d = p.replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : null;
}

function syntheticPhone(erpName: string): string {
  const h = crypto.createHash("md5").update(erpName).digest("hex");
  const num = parseInt(h.slice(0, 12), 16) % 100_000_000;
  return `90${String(num).padStart(8, "0")}`;
}

function financialYearOf(date: Date = new Date()): string {
  const m = date.getMonth() + 1;
  const y = date.getFullYear();
  return m >= 4
    ? `${String(y).slice(-2)}-${String(y + 1).slice(-2)}`
    : `${String(y - 1).slice(-2)}-${String(y).slice(-2)}`;
}

const STATUS_MAP: Record<string, "placed" | "confirmed" | "delivered" | "cancelled" | "returned"> = {
  Draft: "placed",
  "To Pay": "placed",
  "On Hold": "placed",
  "To Deliver and Bill": "confirmed",
  "To Bill": "shipped" as never,
  "To Deliver": "confirmed",
  Completed: "delivered",
  Cancelled: "cancelled",
  Closed: "delivered",
  Returned: "returned",
};

type ParentRow = { id: string; phone: string; name: string | null; createdAt: Date | null };

type SO = {
  name: string;
  creation?: string;
  customer: string;
  transaction_date: string;
  status: string;
  order_type: string;
  net_total: number;
  total_taxes_and_charges?: number;
  grand_total: number;
  delivery_status?: string;
  billing_status?: string;
  per_delivered?: number;
  per_billed?: number;
  custom_student_school?: string;
  custom_student_grade?: string;
  custom_pin_code?: string;
  place_of_supply?: string;
  gst_category?: string;
  custom_payment_flow?: string;
  custom_gateway_provider?: string;
  custom_gateway_order_id?: string;
  custom_internal_payment_reference?: string;
  custom_payment_mode?: string;
  custom_payment_status?: string;
  custom_payment_date?: string;
  custom_paid_currency?: string;
  custom_paid_amount?: string;
  custom_gateway_tracking_id?: string;
  custom_gateway_response_message?: string;
  custom_refund_status?: string;
  custom_payment_attempt_count?: number;
  custom_payment_retry_count?: number;
  custom_payment_finalized?: number;
  custom_checkout_notification_sent?: string;
  custom_is_replacement_so?: number;
  custom_magic_box?: number;
  items?: { item_code: string; item_name: string; qty: number; rate: number; amount: number; gst_hsn_code?: string; gst_treatment?: string }[];
};

type Address = {
  name: string;
  address_title?: string;
  address_type?: string;
  address_line1?: string;
  address_line2?: string;
  city?: string;
  state?: string;
  country?: string;
  pincode?: string;
  phone?: string;
  gstin?: string;
  links?: { link_doctype: string; link_name: string }[];
};

// ── Pre-fetch maps ───────────────────────────────────────────────────

/**
 * Build the canonical ERP-customer-name → local-parent map.
 * Real phones map directly; phoneless ERP customers map via the
 * deterministic synthetic-phone hash (same scheme as 08b-customers).
 */
async function buildCustomerToParentMap(): Promise<Map<string, ParentRow>> {
  console.log(`\n[focus] phase 1 — pre-fetching ERP customers + local parents…`);
  const erpCustByName = new Map<string, string | null>();
  let custCount = 0;
  for await (const page of erpListPages<{ name: string; mobile_no?: string }>("Customer", {
    fields: ["name", "mobile_no"],
    pageSize: 500,
    cutoffIso: CUTOVER_ISO,
    cutoffField: "modified",
  })) {
    for (const c of page) {
      erpCustByName.set(c.name, normalizePhone(c.mobile_no));
      custCount++;
    }
    if (custCount % 2000 === 0) console.log(`  customers seen: ${custCount}`);
  }
  console.log(`  total ERP customers (≤ cutover): ${custCount}`);

  const localParents = (await db
    .select({ id: parents.id, phone: parents.phone, name: parents.name, createdAt: parents.createdAt })
    .from(parents)) as ParentRow[];
  const parentByPhone = new Map<string, ParentRow>();
  for (const p of localParents) parentByPhone.set(p.phone, p);
  console.log(`  local parents: ${localParents.length}`);

  const custToParent = new Map<string, ParentRow>();
  let mappedReal = 0, mappedSynthetic = 0;
  for (const [custName, phone] of erpCustByName) {
    const real = phone;
    const lookupPhone = real ?? syntheticPhone(custName);
    const parent = parentByPhone.get(lookupPhone);
    if (parent) {
      custToParent.set(custName, parent);
      if (real) mappedReal++; else mappedSynthetic++;
    }
  }
  console.log(`  customer→parent map size: ${custToParent.size} (real-phone=${mappedReal}, synthetic=${mappedSynthetic})\n`);
  return custToParent;
}

// ── Orders (focused) ─────────────────────────────────────────────────

async function backfillMissingOrders(custToParent: Map<string, ParentRow>): Promise<void> {
  console.log(`[focus] phase 2 — orders: diffing local vs ERP…`);
  const localRows = await db.select({ n: orders.orderNumber }).from(orders);
  const localOrderNumbers = new Set(localRows.map((r) => r.n));

  const missing: string[] = [];
  let erpSeen = 0;
  for await (const page of erpListPages<{ name: string }>("Sales Order", {
    fields: ["name"],
    filters: [["order_type", "=", "Shopping Cart"], ["docstatus", "=", 1]],
    pageSize: 500,
    cutoffIso: CUTOVER_ISO,
    cutoffField: "creation",
  })) {
    for (const stub of page) {
      erpSeen++;
      if (!localOrderNumbers.has(stub.name)) missing.push(stub.name);
    }
  }
  console.log(`  ERP SOs (≤ cutover): ${erpSeen}  local: ${localOrderNumbers.size}  missing: ${missing.length}\n`);

  let inserted = 0, skipped = 0, errored = 0;
  for (const soName of missing) {
    try {
      const so = await erpGetDoc<SO>("Sales Order", soName);

      // Defence in depth — should already be filtered out by the ERP-side
      // cutoffField on the list query, but cheap to re-check.
      if (so.creation && new Date(so.creation) >= CUTOVER_DATE) {
        skipped++;
        await logMigrationError("focused-orders", "Sales Order", so.name, `creation >= cutover (${so.creation})`);
        continue;
      }

      const parent = custToParent.get(so.customer);
      if (!parent) {
        skipped++;
        await logMigrationError("focused-orders", "Sales Order", so.name, `no local parent for ERP customer "${so.customer}"`);
        continue;
      }

      // Resolve school: prefer custom_student_school name match, else first school as fallback.
      let schoolId: string | null = null;
      if (so.custom_student_school) {
        const sch = await db.select().from(schools).where(eq(schools.name, so.custom_student_school)).limit(1);
        schoolId = sch[0]?.id ?? null;
      }
      if (!schoolId) {
        const [first] = await db.select().from(schools).limit(1);
        schoolId = first?.id ?? null;
      }
      if (!schoolId) {
        skipped++;
        await logMigrationError("focused-orders", "Sales Order", so.name, "no school to assign");
        continue;
      }

      // Idempotency on re-run
      const existing = await db.select().from(orders).where(eq(orders.orderNumber, so.name)).limit(1);
      if (existing[0]) { skipped++; continue; }

      const subtotalP = Math.round(so.net_total * 100);
      const taxP = Math.round((so.total_taxes_and_charges ?? 0) * 100);
      const totalP = Math.round(so.grand_total * 100);
      const status = STATUS_MAP[so.status] ?? "placed";
      const paymentStatus =
        so.custom_payment_status === "SUCCESS" ? "paid"
        : so.custom_payment_status === "FAILURE" ? "failed"
        : "pending";

      const shippingAddress = {
        line1: "Imported address",
        city: "—",
        state: "—",
        pincode: so.custom_pin_code ?? "000000",
        receiverName: parent.name ?? "—",
        receiverPhone: parent.phone,
      };

      const [created] = await db.insert(orders).values({
        orderNumber: so.name,
        parentId: parent.id,
        schoolId,
        status,
        paymentStatus,
        subtotal: subtotalP,
        tax: taxP,
        shipping: 0,
        discount: 0,
        total: totalP,
        shippingAddress,
        placedAt: new Date(so.transaction_date),
        confirmedAt: paymentStatus === "paid" ? new Date(so.transaction_date) : null,
        schoolNameSnapshot: so.custom_student_school ?? null,
        financialYear: financialYearOf(new Date(so.transaction_date)),
        placeOfSupply: so.place_of_supply ?? null,
        gstCategory: so.gst_category ?? "Unregistered",
        isReplacement: !!so.custom_is_replacement_so,
        deliveredPercent: Math.round(so.per_delivered ?? 0),
        billedPercent: Math.round(so.per_billed ?? 0),
        tags: so.custom_magic_box ? ["magic_box"] : null,
        createdAt: new Date(so.transaction_date),
      }).returning();

      if (so.items?.length) {
        const lines = await Promise.all(
          so.items.map(async (it) => {
            const v = await db.select().from(productVariants).where(eq(productVariants.sku, it.item_code)).limit(1);
            return {
              orderId: created.id,
              variantId: v[0]?.id ?? null,
              nameSnapshot: it.item_name,
              imageSnapshot: null,
              size: "—",
              qty: it.qty,
              unitPrice: Math.round(it.rate * 100),
              total: Math.round(it.amount * 100),
              hsnCodeSnapshot: it.gst_hsn_code ?? null,
              gstTreatmentSnapshot: (it.gst_treatment === "Nil-Rated" ? "nil_rated" : it.gst_treatment === "Taxable" ? "taxable" : null) as "nil_rated" | "taxable" | null,
            };
          })
        );
        const validLines = lines.filter((l) => l.variantId !== null) as Array<{
          orderId: string; variantId: string; nameSnapshot: string; imageSnapshot: null;
          size: string; qty: number; unitPrice: number; total: number;
          hsnCodeSnapshot: string | null; gstTreatmentSnapshot: "nil_rated" | "taxable" | null;
        }>;
        if (validLines.length) await db.insert(orderItems).values(validLines);
      }

      await db.insert(payments).values({
        orderId: created.id,
        provider: (so.custom_gateway_provider ?? "CCAVENUE").toLowerCase(),
        providerPaymentId: so.custom_gateway_order_id ?? null,
        amount: totalP,
        status: paymentStatus,
        method: so.custom_payment_mode ?? null,
        paymentFlow: so.custom_payment_flow ?? "ONLINE",
        gatewayProvider: so.custom_gateway_provider ?? "CCAVENUE",
        gatewayOrderId: so.custom_gateway_order_id ?? null,
        internalPaymentReference: so.custom_internal_payment_reference ?? null,
        paymentMode: so.custom_payment_mode ?? null,
        paymentDate: so.custom_payment_date ?? null,
        paidCurrency: so.custom_paid_currency ?? "INR",
        paidAmount: so.custom_paid_amount ?? null,
        refundStatus: so.custom_refund_status ?? "NOT_REQUESTED",
        gatewayTrackingId: so.custom_gateway_tracking_id ?? null,
        gatewayResponseMessage: so.custom_gateway_response_message ?? null,
        paymentAttemptCount: so.custom_payment_attempt_count ?? 0,
        paymentRetryCount: so.custom_payment_retry_count ?? 0,
        paymentFinalized: !!so.custom_payment_finalized,
        checkoutNotificationSent: so.custom_checkout_notification_sent ?? null,
      });

      inserted++;
      if (inserted % 25 === 0) console.log(`  orders progress: ${inserted}/${missing.length} inserted (${skipped} skipped)`);
    } catch (e) {
      errored++;
      await logMigrationError("focused-orders", "Sales Order", soName, e instanceof Error ? e.message : String(e));
    }
  }
  console.log(`  orders done: ${inserted} inserted, ${skipped} skipped, ${errored} errored (of ${missing.length} candidates)\n`);
}

// ── Addresses (focused) ──────────────────────────────────────────────

async function backfillMissingAddresses(custToParent: Map<string, ParentRow>): Promise<void> {
  console.log(`[focus] phase 3 — addresses…`);
  let processed = 0, inserted = 0, skipped = 0, errored = 0;

  for await (const page of erpListPages<{ name: string }>("Address", {
    fields: ["name"],
    pageSize: 200,
    cutoffIso: CUTOVER_ISO,
    cutoffField: "modified",
  })) {
    for (const stub of page) {
      try {
        const addr = await erpGetDoc<Address>("Address", stub.name);
        const customerLink = addr.links?.find((l) => l.link_doctype === "Customer");
        if (!customerLink) { skipped++; processed++; continue; }
        const parent = custToParent.get(customerLink.link_name);
        if (!parent) { skipped++; processed++; continue; }

        const addressType =
          (addr.address_type ?? "shipping").toLowerCase() === "billing" ? "billing" : "shipping";
        const line1 = addr.address_line1 ?? "—";
        const pincode = addr.pincode ?? "000000";

        const existing = await db.select().from(addresses).where(
          and(
            eq(addresses.parentId, parent.id),
            eq(addresses.line1, line1),
            eq(addresses.pincode, pincode),
            eq(addresses.addressType, addressType)
          )
        ).limit(1);
        if (existing[0]) {
          if (existing[0].createdAt && existing[0].createdAt >= CUTOVER_DATE) skipped++;
          else skipped++;
          processed++;
          continue;
        }

        await db.insert(addresses).values({
          parentId: parent.id,
          addressTitle: addr.address_title ?? null,
          addressType,
          receiverName: addr.address_title ?? parent.name ?? "Customer",
          receiverPhone: normalizePhone(addr.phone) ?? parent.phone,
          line1,
          line2: addr.address_line2 ?? null,
          city: addr.city ?? "—",
          state: addr.state ?? "—",
          pincode,
          country: addr.country ?? "India",
          gstin: addr.gstin ?? null,
        });
        inserted++;
        processed++;
        if (processed % 200 === 0) console.log(`  addresses progress: ${processed} processed (${inserted} new, ${skipped} skipped)`);
      } catch (e) {
        errored++;
        await logMigrationError("focused-addresses", "Address", stub.name, e instanceof Error ? e.message : String(e));
      }
    }
  }
  console.log(`  addresses done: ${inserted} inserted, ${skipped} skipped, ${errored} errored (${processed} processed)\n`);
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  await ensureCheckpointTable();

  const args = process.argv.slice(2);
  const ordersOnly = args.includes("--orders-only");
  const addressesOnly = args.includes("--addresses-only");

  const t0 = Date.now();
  const custMap = await buildCustomerToParentMap();

  if (!addressesOnly) await backfillMissingOrders(custMap);
  if (!ordersOnly)    await backfillMissingAddresses(custMap);

  console.log(`[focus] ✓ done in ${((Date.now() - t0) / 60000).toFixed(1)} min`);
  await shutdown();
}

main().catch(async (e) => {
  console.error(e);
  await shutdown();
  process.exit(1);
});
