/* eslint-disable no-console */
/**
 * Migrate ERPNext Sales Orders (order_type='Shopping Cart', docstatus=1)
 * into `orders` + `orderItems` + `payments`.
 *
 * Populates the audit §4.1 structured payment fields directly from the SO's
 * custom_payment_* fields.
 *
 *   npx tsx scripts/migrate-from-erp/10-orders.ts [--sample=N]
 */

import crypto from "crypto";
import { erpListPages, erpGetDoc } from "./_client";
import {
  db,
  shutdown,
  ensureCheckpointTable,
  writeCheckpoint,
  logMigrationError,
  CUTOVER_DATE,
  CUTOVER_ISO,
  DRY_RUN,
  dryRunBanner,
  newDryRunReport,
  recordDryRunDiff,
  writeDryRunReport,
} from "./_db";
import {
  orders,
  orderItems,
  payments,
  parents,
  schools,
  productVariants,
} from "../../db/schema";
import { eq } from "drizzle-orm";

// Inlined (avoids server-only import — it's a Next.js-stubbed module).
function financialYearOf(date: Date = new Date()): string {
  const m = date.getMonth() + 1;
  const y = date.getFullYear();
  return m >= 4
    ? `${String(y).slice(-2)}-${String(y + 1).slice(-2)}`
    : `${String(y - 1).slice(-2)}-${String(y).slice(-2)}`;
}

// Same synthetic-phone scheme as 08b — for phoneless ERP customers.
function syntheticPhone(erpName: string): string {
  const h = crypto.createHash("md5").update(erpName).digest("hex");
  const num = parseInt(h.slice(0, 12), 16) % 100_000_000;
  return `90${String(num).padStart(8, "0")}`;
}

const SCRIPT = "10-orders";

type SO = {
  name: string;
  creation?: string;
  customer: string;
  transaction_date: string;
  status: string;
  order_type: string;
  currency: string;
  net_total: number;
  total_taxes_and_charges: number;
  grand_total: number;
  delivery_status?: string;
  billing_status?: string;
  per_delivered?: number;
  per_billed?: number;
  custom_student_school?: string;
  custom_student_grade?: string;
  customer_address?: string;
  shipping_address_name?: string;
  custom_pin_code?: string;
  place_of_supply?: string;
  gst_category?: string;
  // payment custom fields
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
  items?: SOItem[];
};

type SOItem = {
  item_code: string;
  item_name: string;
  qty: number;
  rate: number;
  amount: number;
  gst_hsn_code?: string;
  gst_treatment?: string;
};

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

async function main() {
  const sample = Number(process.argv.find((a) => a.startsWith("--sample="))?.split("=")[1] ?? 0);
  await ensureCheckpointTable();
  dryRunBanner(SCRIPT);
  console.log(`\n[${SCRIPT}] migrating Sales Orders (Shopping Cart only)${sample ? ` (sample ${sample})` : ""}\n`);

  let processed = 0, inserted = 0, skipped = 0;
  const report = newDryRunReport(SCRIPT, "Sales Order");

  for await (const page of erpListPages<{ name: string }>("Sales Order", {
    fields: ["name"],
    filters: [
      ["order_type", "=", "Shopping Cart"],
      ["docstatus", "=", 1],
    ],
    pageSize: 50,
    sample: sample || undefined,
    // Orders are insert-only by `orderNumber` collision, but we still
    // bound the ERP scan by creation to avoid pulling post-cutover SOs
    // (which would either dup-insert or get blocked at the local guard).
    cutoffIso: CUTOVER_ISO,
    cutoffField: "creation",
  })) {
    for (const stub of page) {
      try {
        const so = await erpGetDoc<SO>("Sales Order", stub.name);

        // Defensive anomaly log: an ERP SO with creation >= cutover means
        // someone wrote to the retired ERPNext after we cut over. Don't
        // import it (would race with live website's own order numbers
        // and the orderNumber natural key) — log for review.
        if (so.creation && new Date(so.creation) >= CUTOVER_DATE) {
          report.counts.would_skip_post_cutover++;
          await logMigrationError(
            SCRIPT,
            "Sales Order",
            so.name,
            `post-cutover ERP write (creation=${so.creation}) — review`
          );
          skipped++;
          continue;
        }

        // Resolve parent: try real phone first, fall back to synthetic-phone hash
        // for phoneless customers (08b imported them with status='blocked').
        const cust = await erpGetDoc<{ mobile_no?: string; customer_name?: string }>("Customer", so.customer);
        const digits = (cust.mobile_no ?? "").replace(/\D/g, "").slice(-10);
        const lookupPhone = digits.length === 10 ? digits : syntheticPhone(so.customer);

        const parentRow = await db
          .select()
          .from(parents)
          .where(eq(parents.phone, lookupPhone))
          .limit(1);
        if (!parentRow[0]) {
          report.counts.unresolved_dependency++;
          await logMigrationError(SCRIPT, "Sales Order", so.name, `parent not found (lookup phone ${lookupPhone})`);
          skipped++;
          continue;
        }

        // Resolve school
        let schoolId: string | null = null;
        if (so.custom_student_school) {
          const sch = await db
            .select()
            .from(schools)
            .where(eq(schools.name, so.custom_student_school))
            .limit(1);
          schoolId = sch[0]?.id ?? null;
        }
        if (!schoolId) {
          // pick first school as fallback
          const [first] = await db.select().from(schools).limit(1);
          schoolId = first?.id;
          if (!schoolId) {
            skipped++;
            continue;
          }
        }

        // Skip if already imported (by orderNumber). orderNumber == ERP `name`
        // so this dedup also fences off the post-cutover live-website orders,
        // which use a different numbering scheme — they will never collide.
        const existing = await db
          .select()
          .from(orders)
          .where(eq(orders.orderNumber, so.name))
          .limit(1);
        if (existing[0]) {
          // Defensive: if somehow this row was created after cutover, flag it.
          if (existing[0].createdAt && existing[0].createdAt >= CUTOVER_DATE) {
            report.counts.would_skip_post_cutover++;
          } else {
            report.counts.would_skip_unchanged++;
          }
          processed++;
          continue;
        }

        const subtotalP = Math.round(so.net_total * 100);
        const taxP = Math.round((so.total_taxes_and_charges ?? 0) * 100);
        const totalP = Math.round(so.grand_total * 100);

        const status = STATUS_MAP[so.status] ?? "placed";
        const paymentStatus =
          so.custom_payment_status === "SUCCESS" ? "paid" : so.custom_payment_status === "FAILURE" ? "failed" : "pending";

        const shippingAddress = {
          line1: "Imported address",
          city: "—",
          state: "—",
          pincode: so.custom_pin_code ?? "000000",
          receiverName: cust.customer_name ?? "—",
          receiverPhone: digits,
        };

        const orderInsertPayload = {
          orderNumber: so.name,
          parentId: parentRow[0].id,
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
          gradeSnapshot: so.custom_student_grade ?? null,
          schoolNameSnapshot: so.custom_student_school ?? null,
          financialYear: financialYearOf(new Date(so.transaction_date)),
          placeOfSupply: so.place_of_supply ?? null,
          gstCategory: so.gst_category ?? "Unregistered",
          isReplacement: !!so.custom_is_replacement_so,
          deliveredPercent: Math.round(so.per_delivered ?? 0),
          billedPercent: Math.round(so.per_billed ?? 0),
          tags: so.custom_magic_box ? ["magic_box"] : null,
          createdAt: new Date(so.transaction_date),
        } as const;

        if (DRY_RUN) {
          report.counts.would_insert++;
          recordDryRunDiff(report, {
            key: so.name,
            before: null,
            after: orderInsertPayload as unknown as Record<string, unknown>,
            changedFields: Object.keys(orderInsertPayload),
          });
          inserted++;
          processed++;
          if (processed % 50 === 0) {
            console.log(`  progress: ${processed} orders (dry-run)`);
          }
          continue;
        }

        const [created] = await db
          .insert(orders)
          .values(orderInsertPayload)
          .returning();

        // Items
        if (so.items?.length) {
          const lines = await Promise.all(
            so.items.map(async (it) => {
              const v = await db
                .select()
                .from(productVariants)
                .where(eq(productVariants.sku, it.item_code))
                .limit(1);
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
                gstTreatmentSnapshot: (it.gst_treatment === "Nil-Rated"
                  ? "nil_rated"
                  : it.gst_treatment === "Taxable"
                    ? "taxable"
                    : null) as "nil_rated" | "taxable" | null,
              };
            })
          );
          // Filter out items where variant couldn't be resolved
          const validLines = lines.filter((l) => l.variantId !== null) as Array<{
            orderId: string;
            variantId: string;
            nameSnapshot: string;
            imageSnapshot: null;
            size: string;
            qty: number;
            unitPrice: number;
            total: number;
            hsnCodeSnapshot: string | null;
            gstTreatmentSnapshot: "nil_rated" | "taxable" | null;
          }>;
          if (validLines.length) {
            await db.insert(orderItems).values(validLines);
          }
        }

        // Payment record (audit §4.1 mapped 1:1)
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
        processed++;
        if (processed % 50 === 0) {
          console.log(`  progress: ${processed} orders (${inserted} new, ${skipped} skipped)`);
          await writeCheckpoint(SCRIPT, processed, so.name);
        }
      } catch (e) {
        report.counts.errored++;
        await logMigrationError(SCRIPT, "Sales Order", stub.name, e instanceof Error ? e.message : String(e));
      }
    }
  }

  if (!DRY_RUN) await writeCheckpoint(SCRIPT, processed, null, true);
  if (DRY_RUN) {
    const out = await writeDryRunReport(report);
    console.log(`\n[${SCRIPT}] dry-run ✓ counts=${JSON.stringify(report.counts)} → ${out}\n`);
  }
  console.log(`\n[${SCRIPT}] ${DRY_RUN ? "DRY-RUN" : "✓"} done — ${processed} processed, ${inserted} new, ${skipped} skipped\n`);
  await shutdown();
}

main().catch(async (e) => {
  console.error("Fatal:", e);
  await shutdown();
  process.exit(1);
});
