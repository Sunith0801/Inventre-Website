/* eslint-disable no-console */
/**
 * Import paid ERP Sales Orders from the local `erp.*` mirror tables into
 * the storefront `orders` + `order_items` + `payments` tables.
 *
 * Why this exists: the canonical importer (`lib/erp-import-orders.ts`)
 * round-trips to ERPNext using token auth (`ERP_API_KEY` /
 * `ERP_API_SECRET`), which isn't configured in the prod deploy — the
 * deploy authenticates against the audit mirror via JWT (poll-user/pass)
 * instead. So orders that ERP captured but the storefront callback
 * missed never got back-filled. The mirror tables (`erp.sales_orders`,
 * `erp.sales_order_items`, `erp.sales_order_sub_items`) are populated
 * by the audit poller and contain everything we need for an import:
 * header, line items + category, and the user's component picks
 * (sub-items).
 *
 *   DATABASE_URL=… npx tsx scripts/reconcile-shipped-unpaid.ts
 *   DATABASE_URL=… npx tsx scripts/reconcile-shipped-unpaid.ts --limit=5
 *   DATABASE_URL=… npx tsx scripts/reconcile-shipped-unpaid.ts --order=SAL-ORD-2026-00122
 *   DATABASE_URL=… npx tsx scripts/reconcile-shipped-unpaid.ts --apply
 *
 * Dry-run by default. --apply runs the inserts serially.
 *
 * Scope:
 *  - Sources: erp.sales_orders WHERE custom_payment_status='SUCCESS'.
 *  - Skips orders that already exist locally (idempotent — re-run is safe).
 *  - Leaves payment.gateway_* fields NULL where the audit mirror doesn't
 *    carry them (the user's CSV from CCAvenue can be cross-referenced
 *    later by ops; we don't need them to render the order).
 *  - Shipping address falls back to a stub ("Imported from ERP mirror —
 *    address not in mirror") because the audit endpoint doesn't push
 *    the Address doc to us. Admin can resolve via ERP if needed.
 *  - Bundle selections (the user's per-component picks for Magic Box /
 *    Bookkit lines) are read from erp.sales_order_sub_items and stored
 *    in `order_items.bundle_selections` JSONB alongside the line's
 *    category, so the admin detail page renders the full picked tree.
 */
import { config } from "dotenv";
import crypto from "node:crypto";
import path from "node:path";
config({ path: path.resolve(process.cwd(), ".env.local") });
config({ path: path.resolve(process.cwd(), ".env") });

import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  orders,
  orderItems,
  payments,
  parents,
  schools,
  productVariants,
} from "@/db/schema";

type Flags = {
  apply: boolean;
  limit?: number;
  order?: string;
};

function parseFlags(): Flags {
  const flags: Flags = { apply: false };
  for (const arg of process.argv.slice(2)) {
    if (arg === "--apply") flags.apply = true;
    else if (arg.startsWith("--limit=")) flags.limit = Number(arg.slice("--limit=".length));
    else if (arg.startsWith("--order=")) flags.order = arg.slice("--order=".length);
    else throw new Error(`Unknown flag: ${arg}`);
  }
  return flags;
}

// ── ERP status → local status map (mirrors lib/erp-import-orders.ts:STATUS_MAP)
const STATUS_MAP: Record<string, "placed" | "confirmed" | "shipped" | "delivered" | "cancelled" | "returned"> = {
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

function syntheticPhone(customerKey: string): string {
  const h = crypto.createHash("md5").update(customerKey).digest("hex");
  const num = parseInt(h.slice(0, 12), 16) % 100_000_000;
  return `90${String(num).padStart(8, "0")}`;
}

function financialYearOf(d: Date): string {
  const m = d.getMonth() + 1;
  const y = d.getFullYear();
  return m >= 4
    ? `${String(y).slice(-2)}-${String(y + 1).slice(-2)}`
    : `${String(y - 1).slice(-2)}-${String(y).slice(-2)}`;
}

type MirrorHeader = {
  erp_name: string;
  customer: string | null;
  customer_name: string | null;
  contact_mobile: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  transaction_date: string;
  status: string;
  custom_student_school: string | null;
  custom_student_grade: string | null;
  custom_payment_status: string | null;
  custom_payment_mode: string | null;
  custom_payment_flow: string | null;
  custom_pin_code: string | null;
  custom_paid_amount: number | null;
  custom_magic_box: boolean;
  custom_is_replacement_so: boolean;
  net_total: number | null;
  grand_total: number | null;
  total_taxes_and_charges: number | null;
  per_delivered: number | null;
  per_billed: number | null;
  raw: Record<string, unknown> | null;
};

type MirrorLine = {
  erp_name: string;
  item_code: string;
  item_name: string;
  qty: number;
  rate: number;
  amount: number;
  uom: string | null;
  gst_hsn_code: string | null;
  category: string | null;
};

type MirrorSubItem = {
  parent_item_code: string;
  item_code: string;
  qty: number;
};

async function findCandidates(flags: Flags): Promise<MirrorHeader[]> {
  const orderFilter = flags.order ? sql`AND es.erp_name = ${flags.order}` : sql``;
  const limitClause = flags.limit ? sql`LIMIT ${flags.limit}` : sql``;
  const result: any = await db.execute(sql`
    SELECT es.erp_name, es.customer, es.customer_name,
           es.contact_mobile, es.contact_phone, es.contact_email,
           es.transaction_date::text AS transaction_date,
           es.status, es.custom_student_school, es.custom_student_grade,
           es.custom_payment_status, es.custom_payment_mode,
           es.custom_payment_flow, es.custom_pin_code,
           es.custom_paid_amount, es.custom_magic_box,
           es.custom_is_replacement_so,
           es.net_total, es.grand_total, es.total_taxes_and_charges,
           es.per_delivered, es.per_billed, es.raw
      FROM erp.sales_orders es
     WHERE es.custom_payment_status = 'SUCCESS'
       AND es.is_deleted = false
       AND es.erp_docstatus = 1
       AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.order_number = es.erp_name)
       ${orderFilter}
     ORDER BY es.erp_name
     ${limitClause};
  `);
  return ((result?.rows ?? result ?? []) as MirrorHeader[]);
}

async function loadLines(erpName: string): Promise<MirrorLine[]> {
  const result: any = await db.execute(sql`
    SELECT erp_name, item_code, item_name, qty, rate, amount, uom, gst_hsn_code, category
      FROM erp.sales_order_items
     WHERE order_erp_name = ${erpName}
     ORDER BY id;
  `);
  return ((result?.rows ?? result ?? []) as MirrorLine[]);
}

async function loadSubItems(erpName: string): Promise<MirrorSubItem[]> {
  const result: any = await db.execute(sql`
    SELECT parent_item_code, item_code, qty
      FROM erp.sales_order_sub_items
     WHERE order_erp_name = ${erpName}
     ORDER BY id;
  `);
  return ((result?.rows ?? result ?? []) as MirrorSubItem[]);
}

async function resolveParentId(h: MirrorHeader): Promise<string> {
  const mobileDigits = (h.contact_mobile ?? "").replace(/\D/g, "").slice(-10);
  const customerKey = h.customer ?? h.customer_name ?? h.erp_name;
  const lookupPhone = mobileDigits.length === 10 ? mobileDigits : syntheticPhone(customerKey);

  let row = await db
    .select({ id: parents.id })
    .from(parents)
    .where(eq(parents.phone, lookupPhone))
    .limit(1);

  if (!row[0] && h.customer_name) {
    const target = h.customer_name.trim().toLowerCase();
    const byName = await db
      .select({ id: parents.id })
      .from(parents)
      .where(sql`lower(trim(${parents.name})) = ${target}`)
      .limit(2);
    if (byName.length === 1) row = [byName[0]];
  }

  if (!row[0]) {
    const placeholderName = h.customer_name ?? h.customer ?? h.erp_name;
    const [created] = await db
      .insert(parents)
      .values({
        phone: lookupPhone,
        name: placeholderName,
        status: "blocked",
        firstTimeLogin: false,
      })
      .onConflictDoNothing()
      .returning({ id: parents.id });
    if (created) {
      row = [created];
    } else {
      const [refetch] = await db
        .select({ id: parents.id })
        .from(parents)
        .where(eq(parents.phone, lookupPhone))
        .limit(1);
      if (!refetch)
        throw new Error(`could not resolve or create parent for ${h.erp_name} (${lookupPhone})`);
      row = [refetch];
    }
  }
  return row[0].id;
}

async function resolveSchoolId(h: MirrorHeader): Promise<string> {
  if (h.custom_student_school) {
    const erp = h.custom_student_school;
    const byErp = await db
      .select({ id: schools.id })
      .from(schools)
      .where(eq(schools.erpName, erp))
      .limit(1);
    if (byErp[0]) return byErp[0].id;
    const byName = await db
      .select({ id: schools.id })
      .from(schools)
      .where(eq(schools.name, erp))
      .limit(1);
    if (byName[0]) return byName[0].id;
  }
  const [first] = await db.select({ id: schools.id }).from(schools).limit(1);
  if (!first) throw new Error("no schools in DB to use as last-resort fallback");
  return first.id;
}

type BuiltOrder = {
  header: MirrorHeader;
  lines: MirrorLine[];
  subItemsByParent: Map<string, MirrorSubItem[]>;
};

async function buildOrder(h: MirrorHeader): Promise<BuiltOrder> {
  const [lines, subItems] = await Promise.all([loadLines(h.erp_name), loadSubItems(h.erp_name)]);
  const subItemsByParent = new Map<string, MirrorSubItem[]>();
  for (const s of subItems) {
    const list = subItemsByParent.get(s.parent_item_code) ?? [];
    list.push(s);
    subItemsByParent.set(s.parent_item_code, list);
  }
  return { header: h, lines, subItemsByParent };
}

async function applyImport(b: BuiltOrder): Promise<{ orderId: string; itemsImported: number; itemsSkipped: number }> {
  const h = b.header;
  const parentId = await resolveParentId(h);
  const schoolId = await resolveSchoolId(h);

  const subtotalP = Math.round((h.net_total ?? 0) * 100);
  const taxP = Math.round((h.total_taxes_and_charges ?? 0) * 100);
  const totalP = Math.round((h.grand_total ?? 0) * 100);
  const status = STATUS_MAP[h.status] ?? "placed";
  const paymentStatus = h.custom_payment_status === "SUCCESS" ? "paid" : "pending";
  const placedAt = new Date(h.transaction_date);

  // Stub address — the audit mirror doesn't carry Address docs. Better
  // than refusing to import; admin can resolve via ERP if delivery action
  // is needed.
  const mobileDigits = (h.contact_mobile ?? "").replace(/\D/g, "").slice(-10);
  const shippingAddress = {
    line1: "Imported from ERP mirror — address not in mirror",
    city: "—",
    state: "—",
    pincode: h.custom_pin_code ?? "000000",
    receiverName: h.customer_name ?? "—",
    receiverPhone: mobileDigits,
  };

  const erpRaw = {
    salesOrder: {
      ...h.raw,
      // Inline items + sub-items for the admin detail page's renderer.
      items: b.lines.map((l) => ({
        item_code: l.item_code,
        item_name: l.item_name,
        qty: l.qty,
        rate: l.rate,
        amount: l.amount,
        uom: l.uom,
        gst_hsn_code: l.gst_hsn_code,
        category: l.category,
        sub_items: (b.subItemsByParent.get(l.item_code) ?? []).map((s) => ({
          item_code: s.item_code,
          qty: s.qty,
        })),
      })),
    },
    address: null,
    fetchedAt: new Date().toISOString(),
    source: "mirror-reconcile",
  };

  let itemsImported = 0;
  let itemsSkipped = 0;
  let createdOrderId = "";

  await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(orders)
      .values({
        orderNumber: h.erp_name,
        parentId,
        schoolId,
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
        gradeSnapshot: h.custom_student_grade ?? null,
        schoolNameSnapshot: h.custom_student_school ?? null,
        financialYear: financialYearOf(placedAt),
        gstCategory: "Unregistered",
        isReplacement: !!h.custom_is_replacement_so,
        deliveredPercent: Math.round(h.per_delivered ?? 0),
        billedPercent: Math.round(h.per_billed ?? 0),
        tags: h.custom_magic_box ? ["magic_box"] : null,
        erpSoName: h.erp_name,
        erpLastPolledAt: new Date(),
        erpRaw,
        createdAt: placedAt,
      })
      .returning({ id: orders.id });
    createdOrderId = created.id;

    if (b.lines.length) {
      const linesToInsert = await Promise.all(
        b.lines.map(async (l) => {
          const [v] = await tx
            .select({ id: productVariants.id })
            .from(productVariants)
            .where(eq(productVariants.sku, l.item_code))
            .limit(1);
          if (!v) itemsSkipped++;
          // Bundle selections: include both the user's picks for this
          // parent (sub_items) AND the parent's category so the admin
          // detail page can render the full tree the user chose.
          const subs = b.subItemsByParent.get(l.item_code) ?? [];
          const bundleSelections =
            subs.length > 0
              ? subs.map((s) => ({
                  item_code: s.item_code,
                  qty: s.qty,
                  category: l.category ?? null,
                }))
              : null;
          return {
            orderId: created.id,
            variantId: v?.id ?? null,
            nameSnapshot: l.item_name,
            imageSnapshot: null,
            size: l.item_code,
            qty: Math.round(l.qty),
            unitPrice: Math.round(l.rate * 100),
            total: Math.round(l.amount * 100),
            hsnCodeSnapshot: l.gst_hsn_code,
            gstTreatmentSnapshot: null,
            bundleSelections,
          };
        }),
      );
      await tx.insert(orderItems).values(linesToInsert);
      itemsImported = linesToInsert.length;
    }

    await tx.insert(payments).values({
      orderId: created.id,
      provider: "ccavenue",
      amount: totalP,
      status: paymentStatus,
      method: h.custom_payment_mode ?? null,
      paymentFlow: h.custom_payment_flow ?? "ONLINE",
      gatewayProvider: "CCAVENUE",
      paymentMode: h.custom_payment_mode ?? null,
      paidCurrency: "INR",
      paidAmount: h.custom_paid_amount != null ? h.custom_paid_amount.toFixed(2) : null,
      refundStatus: "NOT_REQUESTED",
      paymentAttemptCount: 0,
      paymentRetryCount: 0,
      paymentFinalized: paymentStatus === "paid",
    });
  });

  return { orderId: createdOrderId, itemsImported, itemsSkipped };
}

function pad(s: string, n: number): string {
  if (s.length >= n) return s.slice(0, n);
  return s + " ".repeat(n - s.length);
}

async function main() {
  const flags = parseFlags();
  const candidates = await findCandidates(flags);

  if (candidates.length === 0) {
    console.log("[reconcile] no candidates match the filter.");
    return;
  }
  console.log(
    `[reconcile] ${candidates.length} candidate(s)${flags.apply ? "" : "  (DRY-RUN — no writes)"}\n`,
  );
  console.log(
    [
      pad("erp_name", 22),
      pad("status", 22),
      pad("pay_status", 12),
      pad("lines", 6),
      pad("subs", 6),
      "applied",
    ].join(" | "),
  );
  console.log("-".repeat(110));

  let ok = 0;
  let failed = 0;
  for (const c of candidates) {
    const built = await buildOrder(c);
    let applied = "";
    if (flags.apply) {
      try {
        const r = await applyImport(built);
        applied = `imported(items=${r.itemsImported}/+${r.itemsSkipped}skp)`;
        ok++;
      } catch (e) {
        applied = `FAILED:${e instanceof Error ? e.message.slice(0, 50) : String(e)}`;
        failed++;
      }
    }
    const subCount = Array.from(built.subItemsByParent.values()).reduce((s, l) => s + l.length, 0);
    console.log(
      [
        pad(c.erp_name, 22),
        pad(c.status ?? "—", 22),
        pad(c.custom_payment_status ?? "—", 12),
        pad(String(built.lines.length), 6),
        pad(String(subCount), 6),
        applied,
      ].join(" | "),
    );
  }

  console.log("");
  if (flags.apply) {
    console.log(`[reconcile] applied: ${ok} imported, ${failed} failed (of ${candidates.length})`);
  } else {
    console.log("[reconcile] dry-run. Re-run with --apply to import these from the ERP mirror.");
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
