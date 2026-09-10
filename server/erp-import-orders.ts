/**
 * One-shot importer for ERPNext Sales Orders into our local
 * `orders` + `order_items` + `payments` tables.
 *
 * Lifted from scripts/migrate-from-erp/10-orders.ts so the same logic is
 * callable from the admin endpoint (POST /api/admin/orders/import-from-erp),
 * a standalone CLI (scripts/import-erp-sales-orders.ts), and any future
 * cron job. Returns a tagged result so callers can present sensible
 * status to admins instead of dumping raw exceptions.
 *
 * Not `server-only` — the standalone CLI runs outside Next.js.
 */
import crypto from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  orders,
  orderItems,
  payments,
  parents,
  schools,
  productVariants,
  shipments,
  invoices,
  returns,
  erpOutboundQueue,
} from "@/db/schema";

// ────────────────────────────────────────────────────────────────────
// ERP client (minimal, self-contained)
// ────────────────────────────────────────────────────────────────────

const ERP_BASE = (process.env.ERP_BASE_URL || process.env.ERPNEXT_BASE || "").replace(/\/+$/, "");
const ERP_KEY = process.env.ERP_API_KEY;
const ERP_SECRET = process.env.ERP_API_SECRET;
const ERP_TOKEN = process.env.ERPNEXT_TOKEN; // alt form: "key:secret"

function erpAuthHeader(): string {
  if (ERP_KEY && ERP_SECRET) return `token ${ERP_KEY}:${ERP_SECRET}`;
  if (ERP_TOKEN) return `token ${ERP_TOKEN}`;
  throw new Error(
    "ERPNext credentials missing (need ERP_API_KEY+ERP_API_SECRET or ERPNEXT_TOKEN)"
  );
}

async function erpGetRaw(path: string): Promise<unknown> {
  if (!ERP_BASE) throw new Error("ERP_BASE_URL / ERPNEXT_BASE not configured");
  const r = await fetch(`${ERP_BASE}${path}`, {
    headers: {
      Authorization: erpAuthHeader(),
      Accept: "application/json",
    },
    // ERP can hang on a heavy server; bound the wait so the cron / admin
    // request doesn't sit forever.
    signal: AbortSignal.timeout(20_000),
    cache: "no-store",
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`ERPNext GET ${path} → ${r.status}: ${body.slice(0, 300)}`);
  }
  const data = (await r.json()) as { data?: unknown; message?: unknown };
  return data.data ?? data.message ?? data;
}

async function erpGetDoc<T>(doctype: string, name: string): Promise<T> {
  return erpGetRaw(
    `/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`
  ) as Promise<T>;
}

// ────────────────────────────────────────────────────────────────────
// Local helpers (lifted from migration 10-orders + 08b)
// ────────────────────────────────────────────────────────────────────

/** Indian FY label e.g. "26-27". */
function financialYearOf(date: Date = new Date()): string {
  const m = date.getMonth() + 1;
  const y = date.getFullYear();
  return m >= 4
    ? `${String(y).slice(-2)}-${String(y + 1).slice(-2)}`
    : `${String(y - 1).slice(-2)}-${String(y).slice(-2)}`;
}

/** Same synthetic-phone scheme as migration 08b — covers phoneless ERP
 *  customers so they still resolve to a (blocked-status) parent row. */
function syntheticPhone(erpCustomerName: string): string {
  const h = crypto.createHash("md5").update(erpCustomerName).digest("hex");
  const num = parseInt(h.slice(0, 12), 16) % 100_000_000;
  return `90${String(num).padStart(8, "0")}`;
}

const STATUS_MAP: Record<
  string,
  "placed" | "confirmed" | "shipped" | "delivered" | "cancelled" | "returned"
> = {
  Draft: "placed",
  "To Pay": "placed",
  "On Hold": "placed",
  "To Deliver and Bill": "confirmed",
  "To Bill": "shipped",
  "To Deliver": "confirmed",
  Completed: "delivered",
  Cancelled: "cancelled",
  Closed: "delivered",
  Returned: "returned",
};

// ────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────

type SOItem = {
  item_code: string;
  item_name: string;
  qty: number;
  rate: number;
  amount: number;
  gst_hsn_code?: string;
  gst_treatment?: string;
};

type SO = {
  name: string;
  customer: string;
  transaction_date: string;
  status: string;
  order_type: string;
  currency: string;
  net_total: number;
  total_taxes_and_charges: number;
  grand_total: number;
  per_delivered?: number;
  per_billed?: number;
  custom_student_school?: string;
  custom_student_grade?: string;
  customer_address?: string;
  shipping_address_name?: string;
  custom_pin_code?: string;
  place_of_supply?: string;
  gst_category?: string;
  contact_email?: string;
  contact_mobile?: string;
  contact_phone?: string;
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

type ErpCustomer = {
  name?: string;
  customer_name?: string;
  mobile_no?: string;
};

type ErpAddress = {
  name?: string;
  address_line1?: string;
  address_line2?: string;
  city?: string;
  state?: string;
  country?: string;
  pincode?: string;
  phone?: string;
  email_id?: string;
};

export type ImportResult =
  | {
      kind: "imported";
      orderId: string;
      orderNumber: string;
      itemsImported: number;
      itemsSkipped: number;
    }
  | {
      kind: "skipped";
      reason:
        | "already_local"
        | "no_parent_match"
        | "no_school_match"
        | "draft_or_cancelled"
        | "no_items_resolved";
      erpName: string;
      detail?: string;
    }
  | {
      kind: "failed";
      reason: string;
      erpName: string;
    };

// ────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────

export type ImportOptions = {
  /** When true, an existing local row is hard-deleted (with the same
   *  cascade as DELETE /api/admin/orders/[id]) and re-imported from
   *  ERPNext. Used for the refresh pass that backfills sub-items that
   *  previous import passes dropped because the SKU didn't match. */
  refresh?: boolean;
};

/**
 * Import a single ERPNext Sales Order into the local DB. Default
 * behaviour: idempotent — a second call for the same `erpName` returns
 * `kind: "skipped", reason: "already_local"`. Pass `{refresh: true}` to
 * delete-then-reimport instead.
 */
export async function importSalesOrder(
  erpName: string,
  opts: ImportOptions = {}
): Promise<ImportResult> {
  try {
    // 1. Skip-or-delete-existing.
    const existing = await db
      .select({ id: orders.id })
      .from(orders)
      .where(eq(orders.orderNumber, erpName))
      .limit(1);
    if (existing[0]) {
      if (!opts.refresh) {
        return { kind: "skipped", reason: "already_local", erpName };
      }
      // Refresh: drop the existing row + its dependents inside a tx,
      // then fall through to re-insert. Mirrors the DELETE route's
      // cascade order so no FK fires.
      const oldId = existing[0].id;
      await db.transaction(async (tx) => {
        await tx.delete(erpOutboundQueue).where(eq(erpOutboundQueue.orderId, oldId));
        await tx.delete(returns).where(eq(returns.orderId, oldId));
        await tx.delete(invoices).where(eq(invoices.orderId, oldId));
        await tx.delete(shipments).where(eq(shipments.orderId, oldId));
        await tx.delete(payments).where(eq(payments.orderId, oldId));
        await tx.delete(orders).where(eq(orders.id, oldId));
      });
    }

    // 2. Fetch ERP Sales Order + linked Customer + Address.
    const so = await erpGetDoc<SO>("Sales Order", erpName);

    // Skip drafts / cancelled / non-shopping-cart SOs that arrive via
    // bulk lookup — the admin can always force an import by hitting the
    // single-order endpoint, but the default backfill is conservative.
    if (so.status === "Draft" || so.status === "Cancelled") {
      return {
        kind: "skipped",
        reason: "draft_or_cancelled",
        erpName,
        detail: so.status,
      };
    }

    const cust = await erpGetDoc<ErpCustomer>("Customer", so.customer).catch(
      () => ({} as ErpCustomer)
    );
    const custDigits = (cust.mobile_no ?? "").replace(/\D/g, "").slice(-10);

    // 3. Resolve parent. Three-tier lookup:
    //   a. Real phone from ERP Customer.mobile_no (last-10-digit form).
    //   b. Synthetic phone hash for ERP customers without a mobile_no
    //      (mirrors migration 08b-customers-phoneless).
    //   c. Customer name → parents.name exact match. Catches cases where
    //      the customer was created locally with a real phone but
    //      ERPNext later cleared the mobile_no (or imported via a
    //      different channel). Fails the import if the name is
    //      ambiguous (multiple matches) — admin must dedupe first.
    const lookupPhone =
      custDigits.length === 10 ? custDigits : syntheticPhone(so.customer);
    let parentRow = await db
      .select({ id: parents.id })
      .from(parents)
      .where(eq(parents.phone, lookupPhone))
      .limit(1);
    if (!parentRow[0] && cust.customer_name) {
      // Case-insensitive + whitespace-tolerant. ERPNext customer names
      // often differ from local parents.name in casing ("Sanvika Vijesh"
      // vs "SANVIKA VIJESH") and extra spaces; lower(trim()) on both
      // sides catches the common-case drift without needing a fuzzy
      // matcher.
      const target = cust.customer_name.trim().toLowerCase();
      const byName = await db
        .select({ id: parents.id })
        .from(parents)
        .where(sql`lower(trim(${parents.name})) = ${target}`)
        .limit(2);
      if (byName.length === 1) {
        parentRow = [byName[0]];
      }
      // byName.length > 1 → multiple local parents share the same
      // case-insensitive name. We *don't* guess which one owns the ERP
      // order (could be wrong, and orders are a high-trust association);
      // instead we fall through to placeholder-parent creation so the
      // order still lands locally under a synthetic, unambiguous parent.
      // Ops can re-link it to the right parent later via the merge tool.
    }
    if (!parentRow[0]) {
      // Last resort: create a placeholder parent so the order still
      // lands locally. This is how we keep /admin/orders authoritative
      // even for ERP customers who never signed up via /shop. The
      // placeholder is `status='blocked'` (can't authenticate) with a
      // deterministic synth phone — when the real parent does register,
      // ops can merge the rows manually. Mirrors migration
      // 08b-customers-phoneless's pattern.
      const placeholderPhone =
        custDigits.length === 10 ? custDigits : syntheticPhone(so.customer);
      const placeholderName = cust.customer_name ?? so.customer;
      const [created] = await db
        .insert(parents)
        .values({
          phone: placeholderPhone,
          name: placeholderName,
          status: "blocked",
          firstTimeLogin: false,
        })
        .onConflictDoNothing()
        .returning({ id: parents.id });
      if (created) {
        parentRow = [created];
      } else {
        // Conflict: race condition or pre-existing row on the same phone
        // (e.g. another import pass created it microseconds earlier).
        // Re-read to grab the id.
        const [refetch] = await db
          .select({ id: parents.id })
          .from(parents)
          .where(eq(parents.phone, placeholderPhone))
          .limit(1);
        if (!refetch) {
          return {
            kind: "skipped",
            reason: "no_parent_match",
            erpName,
            detail: `placeholder-parent insert race + refetch miss for ${placeholderPhone}`,
          };
        }
        parentRow = [refetch];
      }
    }

    // 4. Resolve school. ERPNext stores the school link as the school's
    // docname, which we mirror in `schools.erp_name` (and sometimes
    // legacy `.name`). Try both.
    let schoolId: string | null = null;
    if (so.custom_student_school) {
      const erpName = so.custom_student_school;
      const sch = await db
        .select({ id: schools.id })
        .from(schools)
        .where(eq(schools.erpName, erpName))
        .limit(1);
      if (sch[0]) {
        schoolId = sch[0].id;
      } else {
        const fallback = await db
          .select({ id: schools.id })
          .from(schools)
          .where(eq(schools.name, erpName))
          .limit(1);
        schoolId = fallback[0]?.id ?? null;
      }
    }
    if (!schoolId) {
      // Last-resort fallback: pick the first school so the order isn't
      // outright skipped just because the ERP didn't tag it. Admin can
      // re-tag later. Mirrors migration 10-orders behaviour.
      const [first] = await db.select({ id: schools.id }).from(schools).limit(1);
      if (!first) {
        return { kind: "skipped", reason: "no_school_match", erpName };
      }
      schoolId = first.id;
    }

    // 5. Build the shipping address from the ERP Address doc (Sales Order
    // points at it via shipping_address_name / customer_address). Fall
    // back to a minimal stub if the doc isn't fetchable — better than
    // refusing to import.
    let shippingAddress: {
      line1: string;
      line2?: string;
      city: string;
      state: string;
      pincode: string;
      receiverName: string;
      receiverPhone: string;
    };
    const addrName = so.shipping_address_name ?? so.customer_address ?? null;
    let addrDoc: ErpAddress | null = null;
    if (addrName) {
      addrDoc = await erpGetDoc<ErpAddress>("Address", addrName).catch(() => null);
    }
    if (addrDoc) {
      shippingAddress = {
        line1: addrDoc.address_line1 ?? "—",
        line2: addrDoc.address_line2 || undefined,
        city: addrDoc.city ?? "—",
        state: addrDoc.state ?? "—",
        pincode: addrDoc.pincode ?? so.custom_pin_code ?? "000000",
        receiverName: cust.customer_name ?? "—",
        receiverPhone:
          custDigits ||
          (so.contact_mobile ?? "").replace(/\D/g, "").slice(-10) ||
          "",
      };
    } else {
      shippingAddress = {
        line1: "Imported from ERPNext (no address doc)",
        city: "—",
        state: "—",
        pincode: so.custom_pin_code ?? "000000",
        receiverName: cust.customer_name ?? "—",
        receiverPhone: custDigits,
      };
    }

    // 6. Compute totals + statuses.
    const subtotalP = Math.round(so.net_total * 100);
    const taxP = Math.round((so.total_taxes_and_charges ?? 0) * 100);
    const totalP = Math.round(so.grand_total * 100);
    const status = STATUS_MAP[so.status] ?? "placed";
    const paymentStatus =
      so.custom_payment_status === "SUCCESS"
        ? "paid"
        : so.custom_payment_status === "FAILURE"
          ? "failed"
          : "pending";

    // 7. Insert orders + items + payment in a transaction.
    const placedAt = new Date(so.transaction_date);

    let itemsImported = 0;
    let itemsSkipped = 0;
    let createdOrderId = "";

    // Full ERP payload to persist alongside the order — lets the admin
    // detail page render the exact ERP address + payment + sub-items
    // (including line items whose item_code doesn't map to a local SKU)
    // without re-fetching ERPNext.
    const erpRaw = {
      salesOrder: so as unknown,
      address: addrDoc as unknown,
      fetchedAt: new Date().toISOString(),
    };

    await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(orders)
        .values({
          orderNumber: so.name,
          parentId: parentRow[0].id,
          schoolId: schoolId!,
          status,
          paymentStatus,
          subtotal: subtotalP,
          tax: taxP,
          shipping: 0,
          discount: 0,
          total: totalP,
          shippingAddress,
          placedAt,
          confirmedAt: paymentStatus === "paid" ? placedAt : null,
          schoolNameSnapshot: so.custom_student_school ?? null,
          financialYear: financialYearOf(placedAt),
          placeOfSupply: so.place_of_supply ?? null,
          gstCategory: so.gst_category ?? "Unregistered",
          isReplacement: !!so.custom_is_replacement_so,
          deliveredPercent: Math.round(so.per_delivered ?? 0),
          billedPercent: Math.round(so.per_billed ?? 0),
          tags: so.custom_magic_box ? ["magic_box"] : null,
          erpSoName: so.name,
          erpLastPolledAt: new Date(),
          erpRaw,
          createdAt: placedAt,
        })
        .returning({ id: orders.id });
      createdOrderId = created.id;

      // Items — try item_code → variant.sku. Unmatched lines still
      // persist (variantId NULL) so the admin order detail page can
      // render every line ERPNext lists, matching the Sales Order's
      // Sub Items tab exactly.
      if (so.items?.length) {
        type Line = {
          orderId: string;
          variantId: string | null;
          nameSnapshot: string;
          imageSnapshot: null;
          size: string;
          qty: number;
          unitPrice: number;
          total: number;
          hsnCodeSnapshot: string | null;
          gstTreatmentSnapshot: "nil_rated" | "taxable" | null;
        };
        const lines: Line[] = [];
        for (const it of so.items) {
          const [v] = await tx
            .select({ id: productVariants.id })
            .from(productVariants)
            .where(eq(productVariants.sku, it.item_code))
            .limit(1);
          if (!v) itemsSkipped++;
          lines.push({
            orderId: created.id,
            variantId: v?.id ?? null,
            nameSnapshot: it.item_name,
            imageSnapshot: null,
            size: it.item_code, // keep the ERP item_code visible since
            // we don't always have a variant to derive a size from
            qty: it.qty,
            unitPrice: Math.round(it.rate * 100),
            total: Math.round(it.amount * 100),
            hsnCodeSnapshot: it.gst_hsn_code ?? null,
            gstTreatmentSnapshot:
              it.gst_treatment === "Nil-Rated"
                ? "nil_rated"
                : it.gst_treatment === "Taxable"
                  ? "taxable"
                  : null,
          });
        }
        if (lines.length) {
          await tx.insert(orderItems).values(lines);
          itemsImported = lines.length;
        }
      }

      // Payment audit row — copy CCAvenue custom fields 1:1.
      await tx.insert(payments).values({
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
    });

    return {
      kind: "imported",
      orderId: createdOrderId,
      orderNumber: so.name,
      itemsImported,
      itemsSkipped,
    };
  } catch (e) {
    return {
      kind: "failed",
      erpName,
      reason: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Bulk import: walk an iterable of erpNames, run `importSalesOrder` for
 * each, aggregate results. The CLI + the admin "import all" endpoint
 * both call this so the summary shape is consistent.
 */
export type ImportSummary = {
  checked: number;
  imported: number;
  skipped: number;
  failed: number;
  bySkipReason: Record<string, number>;
  failures: { erpName: string; reason: string }[];
  details: ImportResult[];
};

export function emptySummary(): ImportSummary {
  return {
    checked: 0,
    imported: 0,
    skipped: 0,
    failed: 0,
    bySkipReason: {},
    failures: [],
    details: [],
  };
}

export function accumulate(summary: ImportSummary, r: ImportResult): void {
  summary.checked++;
  summary.details.push(r);
  if (r.kind === "imported") summary.imported++;
  else if (r.kind === "failed") {
    summary.failed++;
    summary.failures.push({ erpName: r.erpName, reason: r.reason });
  } else {
    summary.skipped++;
    summary.bySkipReason[r.reason] = (summary.bySkipReason[r.reason] ?? 0) + 1;
  }
}
