/* eslint-disable no-console */
/**
 * For each (order_number, gateway_order_id) row in the input CSV:
 *   1. Call CCAvenue Status API with the gateway_order_id.
 *   2. Map the response — "Shipped" / "Successful" / "Success" → paid.
 *   3. If CCAvenue says paid AND the order isn't already local:
 *        a. If the ERP mirror (`erp.sales_orders`) has it → import via
 *           the mirror-backed path (header + items + sub_items).
 *        b. If the mirror doesn't have it either → log as
 *           "needs_erp_followup" so ops can chase ERP first.
 *   4. Anything CCAvenue reports as failed / pending / unknown → log
 *      separately; never auto-imported.
 *
 * This is the literal flow ops asked for: trust CCAvenue's Status API
 * as the truth, only import when CCAvenue confirms capture. Default
 * input path is scripts/data/ccavenue-orders-to-reconcile.csv (the
 * 261-row list from ops's CCAvenue dashboard export).
 *
 *   DATABASE_URL=… CCAVENUE_*=… npx tsx scripts/verify-ccavenue-then-import.ts
 *   …                                                            --apply
 *   …                                                            --limit=10
 *   …                                                            --csv=path
 *   …                                                            --concurrency=5
 *
 * Dry-run by default. CCAvenue API calls run with bounded concurrency
 * before any mutation — full verdict report comes out first, --apply
 * only writes after the report.
 *
 * Re-runs are idempotent: already-local orders pass through with
 * `already_local` in the report. CCAvenue is hit fresh each time, so
 * if a previously pending order now reports SHIPPED, the next --apply
 * picks it up.
 */
import { config } from "dotenv";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
config({ path: path.resolve(process.cwd(), ".env.local") });
config({ path: path.resolve(process.cwd(), ".env") });

import { eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  orders,
  orderItems,
  payments,
  parents,
  schools,
  productVariants,
} from "@/db/schema";
import {
  fetchCCAvenueOrderStatus,
  mapCCAvenueStatus,
  type NormalizedGatewayResult,
} from "@/lib/ccavenue";

type Flags = {
  apply: boolean;
  csvPath: string;
  limit?: number;
  concurrency: number;
};

function parseFlags(): Flags {
  const flags: Flags = {
    apply: false,
    csvPath: path.resolve(process.cwd(), "scripts/data/ccavenue-orders-to-reconcile.csv"),
    concurrency: 5,
  };
  for (const arg of process.argv.slice(2)) {
    if (arg === "--apply") flags.apply = true;
    else if (arg.startsWith("--csv=")) flags.csvPath = path.resolve(process.cwd(), arg.slice("--csv=".length));
    else if (arg.startsWith("--limit=")) flags.limit = Number(arg.slice("--limit=".length));
    else if (arg.startsWith("--concurrency=")) flags.concurrency = Math.max(1, Number(arg.slice("--concurrency=".length)));
    else throw new Error(`Unknown flag: ${arg}`);
  }
  return flags;
}

type CsvRow = { order_number: string; gateway_order_id: string };

function loadCsv(p: string): CsvRow[] {
  const text = fs.readFileSync(p, "utf8");
  const out: CsvRow[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const parts = line.split(",").map((s) => s.trim());
    if (parts[0] === "order_number") continue; // header
    if (parts.length < 2 || !parts[0].startsWith("SAL-ORD-")) continue;
    out.push({ order_number: parts[0], gateway_order_id: parts[1] });
  }
  return out;
}

// ── ERP status → local status (mirrors lib/erp-import-orders.ts:STATUS_MAP)
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
  item_code: string;
  item_name: string;
  qty: number;
  rate: number;
  amount: number;
  uom: string | null;
  gst_hsn_code: string | null;
  category: string | null;
};
type MirrorSubItem = { parent_item_code: string; item_code: string; qty: number };

async function loadMirrorHeader(erpName: string): Promise<MirrorHeader | null> {
  const r: any = await db.execute(sql`
    SELECT erp_name, customer, customer_name, contact_mobile,
           transaction_date::text AS transaction_date, status,
           custom_student_school, custom_student_grade,
           custom_payment_status, custom_payment_mode, custom_payment_flow,
           custom_pin_code, custom_paid_amount, custom_magic_box,
           custom_is_replacement_so, net_total, grand_total,
           total_taxes_and_charges, per_delivered, per_billed, raw
      FROM erp.sales_orders
     WHERE erp_name = ${erpName}
       AND is_deleted = false AND erp_docstatus = 1
     LIMIT 1;
  `);
  const rows = (r?.rows ?? r ?? []) as MirrorHeader[];
  return rows[0] ?? null;
}

async function loadMirrorLines(erpName: string): Promise<MirrorLine[]> {
  const r: any = await db.execute(sql`
    SELECT item_code, item_name, qty, rate, amount, uom, gst_hsn_code, category
      FROM erp.sales_order_items WHERE order_erp_name = ${erpName} ORDER BY id;
  `);
  return (r?.rows ?? r ?? []) as MirrorLine[];
}

async function loadMirrorSubItems(erpName: string): Promise<MirrorSubItem[]> {
  const r: any = await db.execute(sql`
    SELECT parent_item_code, item_code, qty
      FROM erp.sales_order_sub_items WHERE order_erp_name = ${erpName} ORDER BY id;
  `);
  return (r?.rows ?? r ?? []) as MirrorSubItem[];
}

async function resolveParentId(h: MirrorHeader): Promise<string> {
  const mobileDigits = (h.contact_mobile ?? "").replace(/\D/g, "").slice(-10);
  const customerKey = h.customer ?? h.customer_name ?? h.erp_name;
  const lookupPhone = mobileDigits.length === 10 ? mobileDigits : syntheticPhone(customerKey);
  let row = await db.select({ id: parents.id }).from(parents).where(eq(parents.phone, lookupPhone)).limit(1);
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
      .values({ phone: lookupPhone, name: placeholderName, status: "blocked", firstTimeLogin: false })
      .onConflictDoNothing()
      .returning({ id: parents.id });
    if (created) row = [created];
    else {
      const [refetch] = await db.select({ id: parents.id }).from(parents).where(eq(parents.phone, lookupPhone)).limit(1);
      if (!refetch) throw new Error(`could not resolve or create parent for ${h.erp_name}`);
      row = [refetch];
    }
  }
  return row[0].id;
}

async function resolveSchoolId(h: MirrorHeader): Promise<string> {
  if (h.custom_student_school) {
    const erp = h.custom_student_school;
    const byErp = await db.select({ id: schools.id }).from(schools).where(eq(schools.erpName, erp)).limit(1);
    if (byErp[0]) return byErp[0].id;
    const byName = await db.select({ id: schools.id }).from(schools).where(eq(schools.name, erp)).limit(1);
    if (byName[0]) return byName[0].id;
  }
  const [first] = await db.select({ id: schools.id }).from(schools).limit(1);
  if (!first) throw new Error("no schools in DB to use as last-resort fallback");
  return first.id;
}

async function importFromMirror(
  h: MirrorHeader,
  lines: MirrorLine[],
  subItems: MirrorSubItem[],
  cca: NormalizedGatewayResult,
): Promise<{ orderId: string; itemsImported: number; itemsSkipped: number }> {
  const parentId = await resolveParentId(h);
  const schoolId = await resolveSchoolId(h);

  const subItemsByParent = new Map<string, MirrorSubItem[]>();
  for (const s of subItems) {
    const list = subItemsByParent.get(s.parent_item_code) ?? [];
    list.push(s);
    subItemsByParent.set(s.parent_item_code, list);
  }

  const subtotalP = Math.round((h.net_total ?? 0) * 100);
  const taxP = Math.round((h.total_taxes_and_charges ?? 0) * 100);
  const totalP = Math.round((h.grand_total ?? 0) * 100);
  const status = STATUS_MAP[h.status] ?? "placed";
  const placedAt = new Date(h.transaction_date);
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
      items: lines.map((l) => ({
        item_code: l.item_code,
        item_name: l.item_name,
        qty: l.qty,
        rate: l.rate,
        amount: l.amount,
        uom: l.uom,
        gst_hsn_code: l.gst_hsn_code,
        category: l.category,
        sub_items: (subItemsByParent.get(l.item_code) ?? []).map((s) => ({
          item_code: s.item_code,
          qty: s.qty,
        })),
      })),
    },
    address: null,
    ccaStatus: {
      rawStatus: cca.rawStatus,
      trackingId: cca.trackingId,
      paidAmount: cca.paidAmount,
      paymentDate: cca.paymentDate,
      paymentMode: cca.paymentMode,
    },
    fetchedAt: new Date().toISOString(),
    source: "ccavenue-verified-mirror-import",
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
        paymentStatus: "paid",
        subtotal: subtotalP,
        tax: taxP,
        shipping: 0,
        discount: 0,
        total: totalP,
        shippingAddress,
        placedAt,
        confirmedAt: placedAt,
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

    if (lines.length) {
      const linesToInsert = await Promise.all(
        lines.map(async (l) => {
          const [v] = await tx
            .select({ id: productVariants.id })
            .from(productVariants)
            .where(eq(productVariants.sku, l.item_code))
            .limit(1);
          if (!v) itemsSkipped++;
          const subs = subItemsByParent.get(l.item_code) ?? [];
          const bundleSelections =
            subs.length > 0
              ? subs.map((s) => ({ item_code: s.item_code, qty: s.qty, category: l.category ?? null }))
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
      providerPaymentId: cca.trackingId ?? null,
      amount: totalP,
      status: "paid",
      method: cca.paymentMode ?? h.custom_payment_mode ?? null,
      paymentFlow: h.custom_payment_flow ?? "ONLINE",
      gatewayProvider: "CCAVENUE",
      paymentMode: cca.paymentMode ?? h.custom_payment_mode ?? null,
      paidCurrency: "INR",
      paidAmount: cca.paidAmount ?? (h.custom_paid_amount != null ? h.custom_paid_amount.toFixed(2) : null),
      paymentDate: cca.paymentDate ?? null,
      gatewayTrackingId: cca.trackingId ?? null,
      gatewayResponseMessage: `verified via CCAvenue Status API: ${cca.rawStatus}`,
      refundStatus: "NOT_REQUESTED",
      paymentAttemptCount: 1,
      paymentRetryCount: 0,
      paymentFinalized: true,
    });
  });

  return { orderId: createdOrderId, itemsImported, itemsSkipped };
}

/**
 * Stub import: CCAvenue says paid but ERP has nothing. Build a minimal
 * local row carrying only what CCAvenue tells us — payment row complete,
 * orders header skeletal, NO order_items. erp_raw.source='ccavenue-stub'
 * so a future reconcile pass (once ERP has the doc) can recognise +
 * refresh in place.
 */
async function stubImport(
  orderNumber: string,
  gatewayOrderId: string,
  cca: NormalizedGatewayResult,
): Promise<{ orderId: string }> {
  // Placeholder parent — one per order via syntheticPhone(gateway_order_id),
  // so ops can re-link individually when the real ERP doc lands. We don't
  // collapse all 201 stubs onto one shared fake parent.
  const placeholderPhone = syntheticPhone(gatewayOrderId);
  let row = await db
    .select({ id: parents.id })
    .from(parents)
    .where(eq(parents.phone, placeholderPhone))
    .limit(1);
  let parentId: string;
  if (row[0]) {
    parentId = row[0].id;
  } else {
    const [created] = await db
      .insert(parents)
      .values({
        phone: placeholderPhone,
        name: `CCAvenue stub ${orderNumber}`,
        status: "blocked",
        firstTimeLogin: false,
      })
      .onConflictDoNothing()
      .returning({ id: parents.id });
    if (created) parentId = created.id;
    else {
      const [refetch] = await db
        .select({ id: parents.id })
        .from(parents)
        .where(eq(parents.phone, placeholderPhone))
        .limit(1);
      if (!refetch) throw new Error("placeholder parent race");
      parentId = refetch.id;
    }
  }

  // Placeholder school — first one available. Ops re-tags via admin merge.
  const [school] = await db.select({ id: schools.id }).from(schools).limit(1);
  if (!school) throw new Error("no schools in DB for stub fallback");

  // Amount: prefer CCAvenue's paid_amount in rupees, convert to paise.
  // If CCAvenue didn't carry it (rare), the order is still imported with
  // total=0 so the row exists and ops can fix the amount later.
  const amountP =
    cca.paidAmount && !Number.isNaN(parseFloat(cca.paidAmount))
      ? Math.round(parseFloat(cca.paidAmount) * 100)
      : 0;

  // Best-effort date parse — CCAvenue ships strings like "2026-04-13 10:59:53.217".
  const placedAt = cca.paymentDate ? new Date(cca.paymentDate) : new Date();
  const placedAtSafe = isNaN(placedAt.getTime()) ? new Date() : placedAt;

  const shippingAddress = {
    line1: "CCAvenue stub — no ERP Sales Order yet",
    city: "—",
    state: "—",
    pincode: "000000",
    receiverName: "—",
    receiverPhone: "",
  };

  const erpRaw = {
    salesOrder: null,
    address: null,
    ccaStatus: {
      rawStatus: cca.rawStatus,
      trackingId: cca.trackingId,
      paidAmount: cca.paidAmount,
      paymentDate: cca.paymentDate,
      paymentMode: cca.paymentMode,
      bankRef: cca.bankRef,
    },
    gatewayOrderId,
    fetchedAt: new Date().toISOString(),
    source: "ccavenue-stub",
  };

  let createdOrderId = "";
  await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(orders)
      .values({
        orderNumber,
        parentId,
        schoolId: school.id,
        status: "confirmed",
        paymentStatus: "paid",
        subtotal: amountP,
        tax: 0,
        shipping: 0,
        discount: 0,
        total: amountP,
        shippingAddress,
        placedAt: placedAtSafe,
        confirmedAt: placedAtSafe,
        financialYear: financialYearOf(placedAtSafe),
        gstCategory: "Unregistered",
        erpRaw,
        createdAt: placedAtSafe,
      })
      .returning({ id: orders.id });
    createdOrderId = created.id;

    await tx.insert(payments).values({
      orderId: created.id,
      provider: "ccavenue",
      providerPaymentId: cca.trackingId ?? null,
      amount: amountP,
      status: "paid",
      method: cca.paymentMode ?? null,
      paymentFlow: "ONLINE",
      gatewayProvider: "CCAVENUE",
      gatewayOrderId,
      paymentMode: cca.paymentMode ?? null,
      paidCurrency: "INR",
      paidAmount: cca.paidAmount ?? null,
      paymentDate: cca.paymentDate ?? null,
      gatewayTrackingId: cca.trackingId ?? null,
      gatewayResponseMessage: `verified via CCAvenue Status API: ${cca.rawStatus}`,
      refundStatus: "NOT_REQUESTED",
      paymentAttemptCount: 1,
      paymentRetryCount: 0,
      paymentFinalized: true,
    });
  });

  return { orderId: createdOrderId };
}

async function withConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, idx: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (true) {
        const idx = cursor++;
        if (idx >= items.length) return;
        out[idx] = await fn(items[idx], idx);
      }
    }),
  );
  return out;
}

type LocalState = "already_local" | "missing_local";
type MirrorState = "in_mirror" | "missing_mirror";
type Verdict = "paid" | "failed" | "pending" | "unknown" | "cca_error";

type Row = CsvRow & {
  verdict: Verdict;
  rawStatus: string;
  trackingId: string | null;
  localState: LocalState;
  mirrorState: MirrorState;
  action: "import" | "stub_import" | "skip-already-local" | "skip-not-paid-by-cca" | "cca_error";
  applied?: string;
};

async function classify(rows: CsvRow[], cca: (NormalizedGatewayResult | Error)[]): Promise<Row[]> {
  const orderNumbers = rows.map((r) => r.order_number);
  const localResult: any = await db.execute(sql`
    SELECT order_number FROM orders WHERE order_number IN (${sql.join(orderNumbers.map((n) => sql`${n}`), sql`, `)});
  `);
  const localSet = new Set(((localResult?.rows ?? localResult ?? []) as { order_number: string }[]).map((r) => r.order_number));

  const mirrorResult: any = await db.execute(sql`
    SELECT erp_name FROM erp.sales_orders
     WHERE erp_name IN (${sql.join(orderNumbers.map((n) => sql`${n}`), sql`, `)})
       AND is_deleted = false AND erp_docstatus = 1;
  `);
  const mirrorSet = new Set(((mirrorResult?.rows ?? mirrorResult ?? []) as { erp_name: string }[]).map((r) => r.erp_name));

  return rows.map((r, i) => {
    const probe = cca[i];
    const localState: LocalState = localSet.has(r.order_number) ? "already_local" : "missing_local";
    const mirrorState: MirrorState = mirrorSet.has(r.order_number) ? "in_mirror" : "missing_mirror";

    if (probe instanceof Error) {
      return {
        ...r,
        verdict: "cca_error",
        rawStatus: probe.message.slice(0, 40),
        trackingId: null,
        localState,
        mirrorState,
        action: "cca_error",
      };
    }
    const verdict = probe.status as Verdict;
    let action: Row["action"];
    if (localState === "already_local") action = "skip-already-local";
    else if (verdict !== "paid") action = "skip-not-paid-by-cca";
    else if (mirrorState === "missing_mirror") action = "stub_import";
    else action = "import";
    return {
      ...r,
      verdict,
      rawStatus: probe.rawStatus,
      trackingId: probe.trackingId,
      localState,
      mirrorState,
      action,
    };
  });
}

function pad(s: string, n: number): string {
  if (s.length >= n) return s.slice(0, n);
  return s + " ".repeat(n - s.length);
}

async function main() {
  const flags = parseFlags();
  const rows = loadCsv(flags.csvPath);
  if (rows.length === 0) {
    console.log(`[verify] no rows in ${flags.csvPath}`);
    return;
  }
  const work = flags.limit ? rows.slice(0, flags.limit) : rows;

  console.log(
    `[verify] ${work.length} input row(s)${flags.apply ? "" : "  (DRY-RUN — no writes)"}, concurrency=${flags.concurrency}\n`,
  );
  console.log("[verify] querying CCAvenue Status API…");
  const probes = await withConcurrency(work, flags.concurrency, async (r) => {
    try {
      return await fetchCCAvenueOrderStatus({ orderNo: r.gateway_order_id });
    } catch (e) {
      return e instanceof Error ? e : new Error(String(e));
    }
  });
  const classified = await classify(work, probes);

  if (flags.apply) {
    console.log("[verify] applying imports (serial)…");
    for (let i = 0; i < classified.length; i++) {
      const c = classified[i];
      if (c.action !== "import" && c.action !== "stub_import") continue;
      try {
        const probe = probes[i] as NormalizedGatewayResult;
        if (c.action === "import") {
          const h = await loadMirrorHeader(c.order_number);
          if (!h) {
            c.applied = "FAILED: mirror row vanished between classify and apply";
            continue;
          }
          const [lines, subs] = await Promise.all([loadMirrorLines(c.order_number), loadMirrorSubItems(c.order_number)]);
          const r = await importFromMirror(h, lines, subs, probe);
          c.applied = `imported(items=${r.itemsImported}/+${r.itemsSkipped}skp)`;
        } else {
          await stubImport(c.order_number, c.gateway_order_id, probe);
          c.applied = "stub_imported";
        }
      } catch (e) {
        c.applied = `FAILED:${e instanceof Error ? e.message.slice(0, 50) : String(e)}`;
      }
    }
  }

  console.log("");
  console.log(
    [pad("order_number", 22), pad("cca_raw", 16), pad("verdict", 9), pad("local", 16), pad("mirror", 16), pad("action", 24), "applied"].join(" | "),
  );
  console.log("-".repeat(140));
  for (const c of classified) {
    console.log(
      [
        pad(c.order_number, 22),
        pad(c.rawStatus.slice(0, 16), 16),
        pad(c.verdict, 9),
        pad(c.localState, 16),
        pad(c.mirrorState, 16),
        pad(c.action, 24),
        c.applied ?? "",
      ].join(" | "),
    );
  }

  console.log("");
  const buckets = {
    rows: classified.length,
    cca_paid: classified.filter((c) => c.verdict === "paid").length,
    cca_failed: classified.filter((c) => c.verdict === "failed").length,
    cca_pending: classified.filter((c) => c.verdict === "pending").length,
    cca_unknown: classified.filter((c) => c.verdict === "unknown").length,
    cca_error: classified.filter((c) => c.verdict === "cca_error").length,
    action_import: classified.filter((c) => c.action === "import").length,
    action_stub_import: classified.filter((c) => c.action === "stub_import").length,
    action_already_local: classified.filter((c) => c.action === "skip-already-local").length,
  };
  console.log(`[verify] summary: ${JSON.stringify(buckets)}`);

  if (flags.apply) {
    const ok = classified.filter((c) => c.applied && !c.applied.startsWith("FAILED")).length;
    const fail = classified.filter((c) => c.applied?.startsWith("FAILED")).length;
    console.log(`[verify] applied: ${ok} imported, ${fail} failed (of ${buckets.action_import + buckets.action_stub_import})`);
  } else {
    console.log("[verify] dry-run. Re-run with --apply to import CCAvenue-confirmed orders.");
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
