import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { getErpConfig, isErpPollConfigured } from "@/lib/erp-config";
import { erpAuthedGet } from "@/lib/erp-jwt";

/**
 * Delta-poll worker (Phase 1b).
 *
 * Replaces the per-order GET loop with one batched delta query per
 * resource (orders / shipments / packing_units). Watermarks live in
 * `erp.sync_state` and advance to MAX(modified) of consumed rows.
 *
 *   tick:
 *     1. read three watermarks
 *     2. GET /api/orders?modified_after=W&order_by=modified_asc&limit=N
 *        → for each row, fetch /api/orders/{name} for items + upsert
 *     3. GET /api/outward/shipments?modified_after=W&... → upsert
 *     4. GET /api/warehouse/packing-units?modified_after=W&... → upsert
 *     5. collect affected order_erp_names; for each linked local order,
 *        recompute orders.status from the freshly-mirrored rows
 *
 * Idempotent: upserts re-apply the same row, watermark advancement is
 * monotonic, and the "items detail" fetch is bounded by the page size.
 *
 * Bootstrap: a NULL watermark seeds from (now - ERP_SYNC_BOOTSTRAP_HOURS)
 * so the first tick doesn't try to mirror every historical row.
 *
 * Pages on hitting `limit`: when a batch returns exactly `limit` rows,
 * the worker loops up to MAX_PAGES times (default 4) to drain the
 * backlog. Beyond that it leaves the rest for the next tick.
 */

const DEFAULT_BATCH_LIMIT = 500;
const MAX_PAGES_PER_TICK = 4;
const BOOTSTRAP_HOURS_DEFAULT = 24;

export type SyncResource = "orders" | "shipments" | "packing_units" | "customers" | "items" | "students";

export interface ResourceResult {
  resource: SyncResource;
  rows: number;
  pages: number;
  advancedTo: string | null;
  errored: number;
  skipped: boolean;
  error?: string;
}

export interface PollResult {
  scanned: number;
  updated: number;
  errored: number;
  skipped: boolean;
  reason?: string;
  resources?: ResourceResult[];
  /** Local orders whose `status` was recomputed from mirror state. */
  derived?: number;
}

export type ErpOrderHeader = {
  name: string;
  customer?: string | null;
  customer_name?: string | null;
  customer_group?: string | null;
  transaction_date?: string | null;
  delivery_date?: string | null;
  status?: string | null;
  custom_display_status?: string | null;
  delivery_status?: string | null;
  grand_total?: number | null;
  net_total?: number | null;
  currency?: string | null;
  contact_person?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  contact_mobile?: string | null;
  custom_student_school?: string | null;
  custom_student_grade?: string | null;
  custom_payment_status?: string | null;
  custom_payment_mode?: string | null;
  custom_paid_amount?: number | null;
  custom_magic_box?: boolean | null;
  custom_is_replacement_so?: boolean | null;
  modified?: string | null;
  [k: string]: unknown;
};

type ErpOrderListRow = ErpOrderHeader & { modified?: string | null };

export type ErpOrderDetailResp = {
  header: ErpOrderHeader;
  items?: Array<Record<string, unknown>>;
  sub_items?: Array<Record<string, unknown>>;
  payment_schedule?: Array<Record<string, unknown>>;
  [k: string]: unknown;
};

export type ErpPackingUnitResp = {
  id: number;
  unit_number: string;
  order_erp_name: string;
  status?: string | null;
  packed_by?: string | null;
  packed_at?: string | null;
  sealed_by?: string | null;
  sealed_at?: string | null;
  dispatched_by?: string | null;
  dispatched_at?: string | null;
  partner?: string | null;
  tracking_number?: string | null;
  notes?: string | null;
  weight_kg?: number | null;
  length_cm?: number | null;
  width_cm?: number | null;
  height_cm?: number | null;
  updated_at?: string | null;
  [k: string]: unknown;
};

export type ErpShipmentResp = {
  id: number;
  order_erp_name: string;
  partner?: string | null;
  tracking_number?: string | null;
  status?: string | null;
  dispatched_at?: string | null;
  delivered_at?: string | null;
  updated_at?: string | null;
  events?: Array<{
    id?: number;
    status?: string | null;
    created_at?: string | null;
    [k: string]: unknown;
  }>;
  [k: string]: unknown;
};

// ─── sync_state helpers ───────────────────────────────────────────────

async function getWatermark(resource: SyncResource): Promise<string | null> {
  const r: any = await db.execute(sql`
    SELECT last_modified_seen
      FROM erp.sync_state
     WHERE resource = ${resource}
     LIMIT 1
  `);
  const rows = r.rows ?? r;
  if (!rows?.[0]) return null;
  const v = rows[0].last_modified_seen as Date | string | null;
  if (!v) return null;
  return v instanceof Date ? v.toISOString() : String(v);
}

async function bootstrapWatermark(): Promise<string> {
  const hours = Number(process.env.ERP_SYNC_BOOTSTRAP_HOURS) || BOOTSTRAP_HOURS_DEFAULT;
  const d = new Date(Date.now() - hours * 3600 * 1000);
  return d.toISOString();
}

async function recordRun(
  resource: SyncResource,
  status: "ok" | "error",
  rowsThisRun: number,
  advancedTo: string | null,
  error?: string
): Promise<void> {
  await db
    .execute(sql`
      INSERT INTO erp.sync_state (
        resource, last_modified_seen, last_run_at, last_run_status,
        last_error, rows_synced_total, rows_synced_last_run, updated_at
      )
      VALUES (
        ${resource},
        ${advancedTo}::timestamptz,
        now(),
        ${status},
        ${error ?? null},
        ${rowsThisRun},
        ${rowsThisRun},
        now()
      )
      ON CONFLICT (resource) DO UPDATE SET
        last_modified_seen   = COALESCE(EXCLUDED.last_modified_seen, erp.sync_state.last_modified_seen),
        last_run_at          = EXCLUDED.last_run_at,
        last_run_status      = EXCLUDED.last_run_status,
        last_error           = EXCLUDED.last_error,
        rows_synced_total    = erp.sync_state.rows_synced_total + ${rowsThisRun},
        rows_synced_last_run = ${rowsThisRun},
        updated_at           = now()
    `)
    .catch((e) => {
      console.warn(
        `[erp-poll] sync_state update failed for ${resource}:`,
        e instanceof Error ? e.message.slice(0, 200) : e
      );
    });
}

function maxIso(a: string | null, b: string | null | undefined): string | null {
  if (!a) return b ?? null;
  if (!b) return a;
  return a > b ? a : b;
}

// ─── orchestrator ─────────────────────────────────────────────────────

export async function pollOpenOrders(): Promise<PollResult> {
  const cfg = getErpConfig();
  if (!isErpPollConfigured(cfg)) {
    return {
      scanned: 0,
      updated: 0,
      errored: 0,
      skipped: true,
      reason: `poll not configured (target=${cfg.target})`,
    };
  }

  const limit =
    Number(process.env.ERP_POLL_BATCH_LIMIT) || DEFAULT_BATCH_LIMIT;
  const bootstrap = await bootstrapWatermark();

  const [ordersR, shipmentsR, packingR, customersR, itemsR, studentsR] = await Promise.all([
    pollOrdersDelta(limit, bootstrap),
    pollShipmentsDelta(limit, bootstrap),
    pollPackingUnitsDelta(limit, bootstrap),
    pollCustomersDelta(limit, bootstrap),
    pollItemsDelta(limit, bootstrap),
    pollStudentsDelta(limit, bootstrap),
  ]);

  const resources = [ordersR, shipmentsR, packingR, customersR, itemsR, studentsR];

  // Affected orders across all three order-touching resources → recompute
  // status. Customer-master changes don't affect local order status, so
  // they're not in this set.
  const affected = new Set<string>([
    ...ordersR_affectedNames,
    ...shipmentsR_affectedNames,
    ...packingR_affectedNames,
  ]);
  // Clear module-scope buckets so the next tick starts fresh.
  ordersR_affectedNames.length = 0;
  shipmentsR_affectedNames.length = 0;
  packingR_affectedNames.length = 0;

  // Status derivation is a best-effort step. If it throws, the resource
  // pollers still committed their watermark updates — so we report
  // success on the bridge even if no order rows were touched.
  let derived = 0;
  if (affected.size > 0) {
    try {
      derived = await deriveStatusesForOrders([...affected]);
    } catch (e) {
      console.warn(
        "[erp-poll] deriveStatusesForOrders failed:",
        e instanceof Error ? e.message.slice(0, 200) : e
      );
    }
  }

  const totalRows = resources.reduce((a, r) => a + r.rows, 0);
  const totalErrored = resources.reduce((a, r) => a + r.errored, 0);

  return {
    scanned: totalRows,
    updated: totalRows,
    errored: totalErrored,
    skipped: false,
    resources,
    derived,
  };
}

// Module-scope buckets keep the resource pollers loosely-coupled while
// still letting the orchestrator collect affected names without threading
// arrays through every helper. Cleared at the end of each tick.
const ordersR_affectedNames: string[] = [];
const shipmentsR_affectedNames: string[] = [];
const packingR_affectedNames: string[] = [];

// ─── /api/orders delta ────────────────────────────────────────────────

async function pollOrdersDelta(
  limit: number,
  bootstrap: string
): Promise<ResourceResult> {
  const resource: SyncResource = "orders";
  let watermark = (await getWatermark(resource)) ?? bootstrap;
  let advancedTo: string | null = null;
  let rows = 0;
  let pages = 0;
  let errored = 0;
  try {
    for (let page = 0; page < MAX_PAGES_PER_TICK; page++) {
      const qs = new URLSearchParams({
        modified_after: watermark,
        order_by: "modified_asc",
        limit: String(limit),
        include_aggregates: "false",
      });
      const res = await erpAuthedGet<{ rows?: ErpOrderListRow[]; total?: number }>(
        `/api/orders?${qs.toString()}`
      );
      const batch = res?.rows ?? [];
      pages++;
      if (batch.length === 0) break;

      for (const r of batch) {
        if (!r?.name || !r?.modified) continue;
        try {
          // List endpoint gives the header; fetch detail for items.
          const detail = await erpAuthedGet<ErpOrderDetailResp>(
            `/api/orders/${encodeURIComponent(r.name)}`
          );
          if (detail?.header?.name) {
            await upsertOrderMirror(detail.header);
            if (Array.isArray(detail.items)) {
              await upsertItemsMirror(detail.header.name, detail.items);
            }
            ordersR_affectedNames.push(detail.header.name);
            rows++;
            advancedTo = maxIso(advancedTo, r.modified);
          }
        } catch (e) {
          errored++;
          console.warn(
            `[erp-poll/orders] detail fetch failed for ${r.name}:`,
            e instanceof Error ? e.message : e
          );
        }
      }

      // Advance watermark within this tick so the next page query
      // requests rows strictly after the last consumed row.
      if (advancedTo) {
        // Watermark-equality safeguard: bulk SQL UPDATE can produce a
        // limit-sized batch all sharing the SAME updated_at as the
        // existing watermark. The next request with modified_after >
        // advancedTo would loop forever on those rows. Nudge +1ms to
        // escape.
        if (advancedTo === watermark && batch.length === limit) {
          advancedTo = new Date(new Date(advancedTo).getTime() + 1).toISOString();
        }
        watermark = advancedTo;
      }
      if (batch.length < limit) break;
    }
    await recordRun(resource, "ok", rows, advancedTo);
    return { resource, rows, pages, advancedTo, errored, skipped: false };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await recordRun(resource, "error", rows, advancedTo, msg);
    return {
      resource,
      rows,
      pages,
      advancedTo,
      errored: errored + 1,
      skipped: false,
      error: msg,
    };
  }
}

// ─── /api/outward/shipments delta ─────────────────────────────────────

async function pollShipmentsDelta(
  limit: number,
  bootstrap: string
): Promise<ResourceResult> {
  const resource: SyncResource = "shipments";
  let watermark = (await getWatermark(resource)) ?? bootstrap;
  let advancedTo: string | null = null;
  let rows = 0;
  let pages = 0;
  let errored = 0;
  try {
    for (let page = 0; page < MAX_PAGES_PER_TICK; page++) {
      const qs = new URLSearchParams({
        modified_after: watermark,
        order_by: "modified_asc",
        limit: String(limit),
        include_events: "true",
      });
      const res = await erpAuthedGet<{ rows?: ErpShipmentResp[]; total?: number }>(
        `/api/outward/shipments?${qs.toString()}`
      );
      const batch = res?.rows ?? [];
      pages++;
      if (batch.length === 0) break;

      for (const sh of batch) {
        if (typeof sh?.id !== "number") continue;
        try {
          await upsertShipmentMirror(sh);
          if (sh.order_erp_name) shipmentsR_affectedNames.push(sh.order_erp_name);
          rows++;
          if (sh.updated_at) advancedTo = maxIso(advancedTo, sh.updated_at);
        } catch (e) {
          errored++;
          console.warn(
            `[erp-poll/shipments] upsert failed for id=${sh.id}:`,
            e instanceof Error ? e.message : e
          );
        }
      }
      if (advancedTo) watermark = advancedTo;
      if (batch.length < limit) break;
    }
    await recordRun(resource, "ok", rows, advancedTo);
    return { resource, rows, pages, advancedTo, errored, skipped: false };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await recordRun(resource, "error", rows, advancedTo, msg);
    return {
      resource,
      rows,
      pages,
      advancedTo,
      errored: errored + 1,
      skipped: false,
      error: msg,
    };
  }
}

// ─── /api/warehouse/packing-units delta ───────────────────────────────

async function pollPackingUnitsDelta(
  limit: number,
  bootstrap: string
): Promise<ResourceResult> {
  const resource: SyncResource = "packing_units";
  let watermark = (await getWatermark(resource)) ?? bootstrap;
  let advancedTo: string | null = null;
  let rows = 0;
  let pages = 0;
  let errored = 0;
  try {
    for (let page = 0; page < MAX_PAGES_PER_TICK; page++) {
      const qs = new URLSearchParams({
        modified_after: watermark,
        order_by: "modified_asc",
        limit: String(limit),
      });
      const res = await erpAuthedGet<{ items?: ErpPackingUnitResp[]; total?: number }>(
        `/api/warehouse/packing-units?${qs.toString()}`
      );
      const batch = res?.items ?? [];
      pages++;
      if (batch.length === 0) break;

      for (const p of batch) {
        if (typeof p?.id !== "number") continue;
        try {
          await upsertPackingUnitsMirror([p]);
          if (p.order_erp_name) packingR_affectedNames.push(p.order_erp_name);
          rows++;
          if (p.updated_at) advancedTo = maxIso(advancedTo, p.updated_at);
        } catch (e) {
          errored++;
          console.warn(
            `[erp-poll/packing] upsert failed for id=${p.id}:`,
            e instanceof Error ? e.message : e
          );
        }
      }
      if (advancedTo) watermark = advancedTo;
      if (batch.length < limit) break;
    }
    await recordRun(resource, "ok", rows, advancedTo);
    return { resource, rows, pages, advancedTo, errored, skipped: false };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await recordRun(resource, "error", rows, advancedTo, msg);
    return {
      resource,
      rows,
      pages,
      advancedTo,
      errored: errored + 1,
      skipped: false,
      error: msg,
    };
  }
}

// ─── /api/customers delta ─────────────────────────────────────────────

type ErpCustomerResp = {
  name: string;
  customer_name?: string | null;
  customer_group?: string | null;
  territory?: string | null;
  mobile_no?: string | null;
  custom_school_code?: string | null;
  custom_branch_name?: string | null;
  custom_enrollment_number?: string | null;
  gstin?: string | null;
  pan?: string | null;
  gst_category?: string | null;
  modified?: string | null;
  [k: string]: unknown;
};

async function pollCustomersDelta(
  limit: number,
  bootstrap: string
): Promise<ResourceResult> {
  const resource: SyncResource = "customers";
  let watermark = (await getWatermark(resource)) ?? bootstrap;
  let advancedTo: string | null = null;
  let rows = 0;
  let pages = 0;
  let errored = 0;
  try {
    for (let page = 0; page < MAX_PAGES_PER_TICK; page++) {
      const qs = new URLSearchParams({
        modified_after: watermark,
        order_by: "modified_asc",
        limit: String(limit),
      });
      const res = await erpAuthedGet<{ rows?: ErpCustomerResp[]; total?: number }>(
        `/api/customers?${qs.toString()}`
      );
      const batch = res?.rows ?? [];
      pages++;
      if (batch.length === 0) break;

      for (const c of batch) {
        if (!c?.name) continue;
        try {
          await upsertCustomerMirror(c);
          rows++;
          if (c.modified) advancedTo = maxIso(advancedTo, c.modified);
        } catch (e) {
          errored++;
          console.warn(
            `[erp-poll/customers] upsert failed for ${c.name}:`,
            e instanceof Error ? e.message : e
          );
        }
      }
      if (advancedTo) watermark = advancedTo;
      if (batch.length < limit) break;
    }
    await recordRun(resource, "ok", rows, advancedTo);
    return { resource, rows, pages, advancedTo, errored, skipped: false };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await recordRun(resource, "error", rows, advancedTo, msg);
    return {
      resource,
      rows,
      pages,
      advancedTo,
      errored: errored + 1,
      skipped: false,
      error: msg,
    };
  }
}

export async function upsertCustomerMirror(c: ErpCustomerResp): Promise<void> {
  if (!c?.name) return;
  await db
    .execute(sql`
      INSERT INTO erp.customers (
        erp_name, customer_name, customer_group, territory, mobile_no,
        custom_school_code, custom_branch_name, custom_enrollment_number,
        gstin, pan, gst_category, raw, erp_docstatus, is_deleted, synced_at
      )
      VALUES (
        ${c.name},
        ${c.customer_name ?? null},
        ${c.customer_group ?? null},
        ${c.territory ?? null},
        ${c.mobile_no ?? null},
        ${c.custom_school_code ?? null},
        ${c.custom_branch_name ?? null},
        ${c.custom_enrollment_number ?? null},
        ${c.gstin ?? null},
        ${c.pan ?? null},
        ${c.gst_category ?? null},
        ${JSON.stringify(c)}::json,
        1,
        false,
        now()
      )
      ON CONFLICT (erp_name) DO UPDATE SET
        customer_name            = EXCLUDED.customer_name,
        customer_group           = EXCLUDED.customer_group,
        territory                = EXCLUDED.territory,
        mobile_no                = EXCLUDED.mobile_no,
        custom_school_code       = EXCLUDED.custom_school_code,
        custom_branch_name       = EXCLUDED.custom_branch_name,
        custom_enrollment_number = EXCLUDED.custom_enrollment_number,
        gstin                    = EXCLUDED.gstin,
        pan                      = EXCLUDED.pan,
        gst_category             = EXCLUDED.gst_category,
        raw                      = EXCLUDED.raw,
        synced_at                = now()
    `)
    .catch((e) => {
      console.warn(
        "[erp-poll] customers upsert skipped:",
        e instanceof Error ? e.message.slice(0, 200) : e
      );
    });
}


// ─── /api/students delta ────────────────────────────────────────────────────

export interface ErpStudentResp {
  name: string;
  first_name?: string | null;
  enrollment_number?: string | null;
  school_code?: string | null;
  grade?: string | null;
  section?: string | null;
  student_mobile_number?: string | null;
  student_email_id?: string | null;
  gender?: string | null;
  date_of_birth?: string | null;
  customer?: string | null;
  customer_group?: string | null;
  house_color?: string | null;
  medium?: string | null;
  curriculum?: string | null;
  mobile_effective?: string | null;
  mobile_source?: string | null;
  guardian_name?: string | null;
  modified?: string | null;
  [k: string]: unknown;
}

export async function upsertStudentMirror(s: ErpStudentResp): Promise<void> {
  if (!s?.name) return;
  await db
    .execute(sql`
      INSERT INTO erp.students (
        erp_name, first_name, enrollment_number, school_code, grade, section,
        student_mobile_number, student_email_id, gender, date_of_birth,
        customer, customer_group, house_color, medium, curriculum,
        mobile_effective, mobile_source, primary_guardian_name,
        erp_modified, raw, synced_at
      ) VALUES (
        ${s.name}, ${s.first_name ?? null}, ${s.enrollment_number ?? null},
        ${s.school_code ?? null}, ${s.grade ?? null}, ${s.section ?? null},
        ${s.student_mobile_number ?? null}, ${s.student_email_id ?? null},
        ${s.gender ?? null}, ${s.date_of_birth ?? null},
        ${s.customer ?? null}, ${s.customer_group ?? null},
        ${s.house_color ?? null}, ${s.medium ?? null}, ${s.curriculum ?? null},
        ${s.mobile_effective ?? null}, ${s.mobile_source ?? null},
        ${s.guardian_name ?? null},
        ${s.modified ?? null}::timestamptz, ${JSON.stringify(s)}::jsonb, now()
      )
      ON CONFLICT (erp_name) DO UPDATE SET
        first_name            = EXCLUDED.first_name,
        enrollment_number     = EXCLUDED.enrollment_number,
        school_code           = EXCLUDED.school_code,
        grade                 = EXCLUDED.grade,
        section               = EXCLUDED.section,
        student_mobile_number = EXCLUDED.student_mobile_number,
        student_email_id      = EXCLUDED.student_email_id,
        gender                = EXCLUDED.gender,
        date_of_birth         = EXCLUDED.date_of_birth,
        customer              = EXCLUDED.customer,
        customer_group        = EXCLUDED.customer_group,
        house_color           = EXCLUDED.house_color,
        medium                = EXCLUDED.medium,
        curriculum            = EXCLUDED.curriculum,
        mobile_effective      = EXCLUDED.mobile_effective,
        mobile_source         = EXCLUDED.mobile_source,
        primary_guardian_name = EXCLUDED.primary_guardian_name,
        erp_modified          = EXCLUDED.erp_modified,
        raw                   = EXCLUDED.raw,
        synced_at             = now()
    `)
    .catch((e) => {
      console.warn("[erp-poll] students upsert skipped:", e instanceof Error ? e.message.slice(0, 200) : e);
    });

  // Reflect safe fields back onto the storefront students row if linked.
  // Auth columns (status, enabled, parent_id, school_id) are never touched.
  await db
    .execute(sql`
      UPDATE students SET
        first_name            = ${s.first_name ?? null},
        school_code           = ${s.school_code ?? null},
        grade                 = ${s.grade ?? null},
        section               = ${s.section ?? null},
        enrollment_number     = ${s.enrollment_number ?? null},
        student_email_id      = ${s.student_email_id ?? null},
        student_mobile_number = ${s.student_mobile_number ?? null},
        gender                = ${s.gender ?? null},
        date_of_birth         = ${s.date_of_birth ?? null},
        house_color           = ${s.house_color ?? null},
        medium                = ${s.medium ?? null},
        curriculum            = ${s.curriculum ?? null},
        customer_link         = ${s.customer ?? null},
        customer_group        = ${s.customer_group ?? null},
        erp_raw               = ${JSON.stringify(s)}::jsonb
      WHERE erp_name = ${s.name}
    `)
    .catch((e) => {
      console.warn("[erp-poll] students storefront update skipped:", e instanceof Error ? e.message.slice(0, 200) : e);
    });
}

async function pollStudentsDelta(
  limit: number,
  bootstrap: string
): Promise<ResourceResult> {
  const resource: SyncResource = "students";
  let watermark = (await getWatermark(resource)) ?? bootstrap;
  let advancedTo: string | null = null;
  let rows = 0;
  let pages = 0;
  let errored = 0;
  try {
    for (let page = 0; page < MAX_PAGES_PER_TICK; page++) {
      const qs = new URLSearchParams({
        modified_after: watermark,
        order_by: "modified_asc",
        limit: String(limit),
      });
      const res = await erpAuthedGet<{ rows?: ErpStudentResp[]; total?: number }>(
        `/api/students?${qs.toString()}`
      );
      const batch = res?.rows ?? [];
      pages++;
      if (batch.length === 0) break;

      for (const st of batch) {
        if (!st?.name) continue;
        try {
          await upsertStudentMirror(st);
          rows++;
          if (st.modified) advancedTo = maxIso(advancedTo, st.modified);
        } catch (e) {
          errored++;
          console.warn(
            `[erp-poll/students] upsert failed for ${st.name}:`,
            e instanceof Error ? e.message : e
          );
        }
      }
      if (advancedTo) watermark = advancedTo;
      if (batch.length < limit) break;
    }
    await recordRun(resource, "ok", rows, advancedTo);
    return { resource, rows, pages, advancedTo, errored, skipped: false };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await recordRun(resource, "error", rows, advancedTo, msg);
    return {
      resource,
      rows,
      pages,
      advancedTo,
      errored: errored + 1,
      skipped: false,
      error: msg,
    };
  }
}

// ─── /api/items delta ─────────────────────────────────────────────────

type ErpItemResp = {
  name: string;
  item_name?: string | null;
  item_group?: string | null;
  stock_uom?: string | null;
  is_stock_item?: boolean | null;
  gst_hsn_code?: string | null;
  custom_school_name?: string | null;
  custom_grade?: string | null;
  custom_gender?: string | null;
  custom_sub_category?: string | null;
  image?: string | null;
  variant_of?: string | null;
  has_variants?: boolean | null;
  published_in_website?: boolean | null;
  modified?: string | null;
  [k: string]: unknown;
};

async function pollItemsDelta(
  limit: number,
  bootstrap: string
): Promise<ResourceResult> {
  const resource: SyncResource = "items";
  let watermark = (await getWatermark(resource)) ?? bootstrap;
  let advancedTo: string | null = null;
  let rows = 0;
  let pages = 0;
  let errored = 0;
  try {
    for (let page = 0; page < MAX_PAGES_PER_TICK; page++) {
      const qs = new URLSearchParams({
        modified_after: watermark,
        order_by: "modified_asc",
        limit: String(limit),
      });
      const res = await erpAuthedGet<{ rows?: ErpItemResp[]; total?: number }>(
        `/api/items?${qs.toString()}`
      );
      const batch = res?.rows ?? [];
      pages++;
      if (batch.length === 0) break;
      for (const it of batch) {
        if (!it?.name) continue;
        try {
          await upsertItemMirror(it);
          rows++;
          if (it.modified) advancedTo = maxIso(advancedTo, it.modified);
        } catch (e) {
          errored++;
          console.warn(
            `[erp-poll/items] upsert failed for ${it.name}:`,
            e instanceof Error ? e.message : e
          );
        }
      }
      if (advancedTo) watermark = advancedTo;
      if (batch.length < limit) break;
    }
    await recordRun(resource, "ok", rows, advancedTo);
    return { resource, rows, pages, advancedTo, errored, skipped: false };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await recordRun(resource, "error", rows, advancedTo, msg);
    return {
      resource,
      rows,
      pages,
      advancedTo,
      errored: errored + 1,
      skipped: false,
      error: msg,
    };
  }
}

async function upsertItemMirror(it: ErpItemResp): Promise<void> {
  if (!it?.name) return;
  await db
    .execute(sql`
      INSERT INTO erp.items (
        erp_name, item_name, item_group, stock_uom, is_stock_item,
        gst_hsn_code, custom_school_name, custom_grade, custom_gender,
        custom_sub_category, image, variant_of, has_variants,
        published_in_website, custom_school_code, raw,
        erp_docstatus, is_deleted, synced_at
      )
      VALUES (
        ${it.name},
        ${it.item_name ?? null},
        ${it.item_group ?? null},
        ${it.stock_uom ?? null},
        ${(it.is_stock_item ?? false) as boolean},
        ${it.gst_hsn_code ?? null},
        ${it.custom_school_name ?? null},
        ${it.custom_grade ?? null},
        ${it.custom_gender ?? null},
        ${it.custom_sub_category ?? null},
        ${it.image ?? null},
        ${it.variant_of ?? null},
        ${(it.has_variants ?? false) as boolean},
        ${(it.published_in_website ?? false) as boolean},
        ${(it as Record<string, unknown>).custom_school_code as string | null ?? null},
        ${JSON.stringify(it)}::json,
        1,
        false,
        now()
      )
      ON CONFLICT (erp_name) DO UPDATE SET
        item_name            = EXCLUDED.item_name,
        item_group           = EXCLUDED.item_group,
        stock_uom            = EXCLUDED.stock_uom,
        is_stock_item        = EXCLUDED.is_stock_item,
        gst_hsn_code         = EXCLUDED.gst_hsn_code,
        custom_school_name   = EXCLUDED.custom_school_name,
        custom_grade         = EXCLUDED.custom_grade,
        custom_gender        = EXCLUDED.custom_gender,
        custom_sub_category  = EXCLUDED.custom_sub_category,
        -- Preserve absolute https image URLs (R2-mirrored). The one-off
        -- migration rewrote erp.items.image from /files/... → R2 URLs;
        -- don't clobber that on the next delta-poll. ERP can still update
        -- by uploading a different file (different relative path).
        image                = CASE
          WHEN erp.items.image LIKE 'https://%' THEN erp.items.image
          ELSE EXCLUDED.image
        END,
        variant_of           = EXCLUDED.variant_of,
        has_variants         = EXCLUDED.has_variants,
        published_in_website = EXCLUDED.published_in_website,
        custom_school_code   = EXCLUDED.custom_school_code,
        raw                  = EXCLUDED.raw,
        synced_at            = now()
    `)
    .catch((e) => {
      console.warn(
        "[erp-poll] items upsert skipped:",
        e instanceof Error ? e.message.slice(0, 200) : e
      );
    });
}

// ─── status derivation (from mirror, not network) ─────────────────────

async function deriveStatusesForOrders(orderNames: string[]): Promise<number> {
  if (orderNames.length === 0) return 0;
  // Drizzle's raw sql`` template doesn't auto-bind a JS array as a
  // Postgres array param — expand into a comma-joined IN list instead.
  const nameFragments = sql.join(
    orderNames.map((n) => sql`${n}`),
    sql`, `
  );
  // Join local orders to the affected ERP names, then look up
  // ship + packing statuses from the mirror. One query per order
  // is acceptable at the affected-set scale (typically <50 per tick).
  const linked: any = await db.execute(sql`
    SELECT id, erp_so_name
      FROM orders
     WHERE erp_so_name IN (${nameFragments})
       AND status NOT IN ('delivered','cancelled','returned')
  `).catch((e) => {
    console.warn(
      `[erp-poll] linked-orders lookup failed (skipping derive):`,
      e instanceof Error ? e.message.slice(0, 200) : e
    );
    return null;
  });
  if (!linked) return 0;
  const rows = (linked.rows ?? linked) as Array<{ id: string; erp_so_name: string }>;
  let derived = 0;
  for (const o of rows) {
    try {
      if (await deriveLocalOrderStatusFromMirror(o.id, o.erp_so_name)) derived++;
      await db.execute(sql`
        UPDATE orders SET erp_last_polled_at = now() WHERE id = ${o.id}
      `).catch(() => {});
    } catch (e) {
      console.warn(
        `[erp-poll] derive failed for ${o.erp_so_name}:`,
        e instanceof Error ? e.message : e
      );
    }
  }
  return derived;
}

/**
 * Webhook-receiver convenience — look up the local order_id for an
 * ERP order name, then run the standard mirror-based derivation. Used
 * by /api/erp/webhooks when a packing_unit.* or shipment.* event
 * arrives so customer-visible status flips within seconds instead of
 * waiting on the next delta-poll tick.
 *
 * Returns true if the local order status changed; false if there's no
 * local row, no signal yet, or no change.
 */
export async function deriveStatusForErpOrderName(
  orderErpName: string
): Promise<boolean> {
  if (!orderErpName) return false;
  const r: any = await db
    .execute(sql`
      SELECT id
        FROM orders
       WHERE erp_so_name = ${orderErpName}
         AND status NOT IN ('delivered','cancelled','returned')
       LIMIT 1
    `)
    .catch(() => null);
  const rows = (r?.rows ?? r ?? []) as Array<{ id: string }>;
  const orderId = rows?.[0]?.id;
  if (!orderId) return false;
  const changed = await deriveLocalOrderStatusFromMirror(orderId, orderErpName);
  await db
    .execute(sql`UPDATE orders SET erp_last_polled_at = now() WHERE id = ${orderId}`)
    .catch(() => {});
  return changed;
}

async function deriveLocalOrderStatusFromMirror(
  orderId: string,
  orderErpName: string
): Promise<boolean> {
  const sh: any = await db.execute(sql`
    SELECT status FROM erp.outward_shipments
     WHERE order_erp_name = ${orderErpName}
       AND COALESCE(is_deleted, false) = false
  `);
  const pu: any = await db.execute(sql`
    SELECT status FROM erp.packing_units
     WHERE order_erp_name = ${orderErpName}
  `);
  const shipStatuses = ((sh.rows ?? sh) as Array<{ status: string | null }>)
    .map((r) => (r.status ?? "").toLowerCase())
    .filter(Boolean);
  const puStatuses = ((pu.rows ?? pu) as Array<{ status: string | null }>)
    .map((r) => (r.status ?? "").toLowerCase())
    .filter(Boolean);

  // ERP shipment status vocabulary (from outward.py / models):
  //   pending_dispatch | dispatched | in_transit | delivered |
  //   returned | lost | cancelled
  // Local order_status: placed | paid | packed | shipped | delivered | …
  const SHIPPED_LIKE = new Set([
    "dispatched",
    "in_transit",
    "shipped",
    "delivered",
  ]);
  let next: string | null = null;
  if (shipStatuses.length > 0) {
    if (shipStatuses.every((s) => s === "delivered")) next = "delivered";
    else if (shipStatuses.some((s) => SHIPPED_LIKE.has(s))) next = "shipped";
    else if (shipStatuses.some((s) => s === "packed")) next = "packed";
  }
  if (!next && puStatuses.length > 0) {
    if (puStatuses.some((s) => s === "dispatched")) next = "shipped";
    else if (puStatuses.some((s) => s === "sealed")) next = "packed";
  }
  if (!next) return false;

  const r: any = await db.execute(sql`
    UPDATE orders
       SET status = ${next}::order_status,
           delivered_at = CASE WHEN ${next} = 'delivered' AND delivered_at IS NULL
                               THEN now() ELSE delivered_at END,
           shipped_at   = CASE WHEN ${next} IN ('shipped','delivered') AND shipped_at IS NULL
                               THEN now() ELSE shipped_at END
     WHERE id = ${orderId}
       AND status != ${next}::order_status
    RETURNING id
  `).catch(() => null);
  const rows = r?.rows ?? r;
  return Array.isArray(rows) && rows.length > 0;
}

// ─── mirror upserters (preserved from prior implementation) ───────────

export async function upsertOrderMirror(h: ErpOrderHeader): Promise<void> {
  if (!h?.name) return;
  const get = <T = unknown>(k: string): T | null =>
    (h as Record<string, unknown>)[k] === undefined
      ? null
      : ((h as Record<string, unknown>)[k] as T);
  await db
    .execute(sql`
      INSERT INTO erp.sales_orders (
        erp_name, customer, customer_name, customer_group,
        transaction_date, delivery_date, status, custom_display_status,
        delivery_status, grand_total, net_total, total, currency,
        contact_person, contact_email, contact_phone, contact_mobile,
        custom_student_school, custom_student_grade,
        custom_payment_status, custom_payment_mode, custom_paid_amount,
        custom_magic_box, custom_is_replacement_so,
        erp_docstatus, is_deleted, raw, synced_at
      )
      VALUES (
        ${h.name},
        ${get<string>("customer")},
        ${get<string>("customer_name")},
        ${get<string>("customer_group")},
        ${get<string>("transaction_date")}::date,
        ${get<string>("delivery_date")}::date,
        ${get<string>("status")},
        ${get<string>("custom_display_status") ?? get<string>("status")},
        ${get<string>("delivery_status")},
        ${get<number>("grand_total")},
        ${get<number>("net_total")},
        ${get<number>("total")},
        ${get<string>("currency") ?? "INR"},
        ${get<string>("contact_person")},
        ${get<string>("contact_email")},
        ${get<string>("contact_phone")},
        ${get<string>("contact_mobile")},
        ${get<string>("custom_student_school")},
        ${get<string>("custom_student_grade")},
        ${get<string>("custom_payment_status")},
        ${get<string>("custom_payment_mode")},
        ${get<number>("custom_paid_amount")},
        ${(get<boolean>("custom_magic_box") ?? false) as boolean},
        ${(get<boolean>("custom_is_replacement_so") ?? false) as boolean},
        ${(get<number>("erp_docstatus") ?? 1) as number},
        false,
        ${JSON.stringify(h)}::json,
        now()
      )
      ON CONFLICT (erp_name) DO UPDATE SET
        customer              = EXCLUDED.customer,
        customer_name         = EXCLUDED.customer_name,
        customer_group        = EXCLUDED.customer_group,
        transaction_date      = EXCLUDED.transaction_date,
        delivery_date         = EXCLUDED.delivery_date,
        status                = EXCLUDED.status,
        custom_display_status = EXCLUDED.custom_display_status,
        delivery_status       = EXCLUDED.delivery_status,
        grand_total           = EXCLUDED.grand_total,
        net_total             = EXCLUDED.net_total,
        total                 = EXCLUDED.total,
        currency              = EXCLUDED.currency,
        contact_person        = EXCLUDED.contact_person,
        contact_email         = EXCLUDED.contact_email,
        contact_phone         = EXCLUDED.contact_phone,
        contact_mobile        = EXCLUDED.contact_mobile,
        custom_student_school = EXCLUDED.custom_student_school,
        custom_student_grade  = EXCLUDED.custom_student_grade,
        custom_payment_status = EXCLUDED.custom_payment_status,
        custom_payment_mode   = EXCLUDED.custom_payment_mode,
        custom_paid_amount    = EXCLUDED.custom_paid_amount,
        raw                   = EXCLUDED.raw,
        synced_at             = now()
    `)
    .catch((e) => {
      console.warn(
        "[erp-poll] sales_orders upsert skipped:",
        e instanceof Error ? e.message.slice(0, 200) : e
      );
    });
}

export async function upsertShipmentMirror(
  sh: ErpShipmentResp,
  opts: { isDeleted?: boolean } = {}
): Promise<void> {
  if (typeof sh?.id !== "number") return;
  const partner = (sh.partner as string | null) ?? "unknown";
  // ERP payload doesn't include is_deleted (internal flag). Callers infer it
  // from event_type — receiver passes {isDeleted:true} for shipment.cancelled.
  const isDeleted = opts.isDeleted ?? false;
  const qty = ((sh as Record<string, unknown>).qty as number | null) ?? 1;
  await db
    .execute(sql`
      INSERT INTO erp.outward_shipments (id, order_erp_name, partner,
                                         tracking_number, status, qty,
                                         dispatched_at, delivered_at,
                                         is_deleted, updated_at)
      VALUES (
        ${sh.id},
        ${sh.order_erp_name},
        ${partner},
        ${sh.tracking_number ?? null},
        ${sh.status ?? "dispatched"},
        ${qty},
        ${sh.dispatched_at ?? null}::timestamp,
        ${sh.delivered_at ?? null}::timestamp,
        ${isDeleted},
        now()
      )
      ON CONFLICT (id) DO UPDATE SET
        order_erp_name  = EXCLUDED.order_erp_name,
        partner         = EXCLUDED.partner,
        tracking_number = EXCLUDED.tracking_number,
        status          = EXCLUDED.status,
        qty             = EXCLUDED.qty,
        dispatched_at   = EXCLUDED.dispatched_at,
        delivered_at    = EXCLUDED.delivered_at,
        is_deleted      = EXCLUDED.is_deleted,
        updated_at      = now()
    `)
    .catch((e) => {
      console.warn(
        "[erp-poll] outward_shipments upsert skipped:",
        e instanceof Error ? e.message.slice(0, 200) : e
      );
    });

  for (const ev of sh.events ?? []) {
    if (!ev?.status) continue;
    await db
      .execute(sql`
        INSERT INTO erp.outward_status_events (shipment_id, status, created_at)
        SELECT ${sh.id}, ${ev.status}, ${ev.created_at ?? null}::timestamptz
        WHERE NOT EXISTS (
          SELECT 1 FROM erp.outward_status_events
           WHERE shipment_id = ${sh.id}
             AND status      = ${ev.status}
             AND created_at  = ${ev.created_at ?? null}::timestamptz
        )
      `)
      .catch(() => {});
  }
}

export async function upsertItemsMirror(
  orderErpName: string,
  items: Array<Record<string, unknown>>
): Promise<void> {
  if (!orderErpName) return;
  await db
    .execute(sql`DELETE FROM erp.sales_order_items WHERE order_erp_name = ${orderErpName}`)
    .catch(() => {});
  for (const r of items) {
    const get = <T>(k: string): T | null =>
      r[k] === undefined || r[k] === null ? null : (r[k] as T);
    const lineName =
      get<string>("erp_name") ??
      `${orderErpName}::${get<string>("item_code") ?? "x"}::${items.indexOf(r)}`;
    await db
      .execute(sql`
        INSERT INTO erp.sales_order_items (
          erp_name, order_erp_name, item_code, item_name,
          qty, rate, amount, uom, warehouse,
          delivered_qty, picked_qty, returned_qty, gst_hsn_code
        )
        VALUES (
          ${lineName},
          ${orderErpName},
          ${get<string>("item_code")},
          ${get<string>("item_name")},
          ${get<number>("qty")},
          ${get<number>("rate")},
          ${get<number>("amount")},
          ${get<string>("uom")},
          ${get<string>("warehouse")},
          ${get<number>("delivered_qty")},
          ${get<number>("picked_qty")},
          ${get<number>("returned_qty")},
          ${get<string>("gst_hsn_code")}
        )
        ON CONFLICT (erp_name) DO UPDATE SET
          order_erp_name = EXCLUDED.order_erp_name,
          item_code      = EXCLUDED.item_code,
          item_name      = EXCLUDED.item_name,
          qty            = EXCLUDED.qty,
          rate           = EXCLUDED.rate,
          amount         = EXCLUDED.amount,
          uom            = EXCLUDED.uom,
          warehouse      = EXCLUDED.warehouse,
          delivered_qty  = EXCLUDED.delivered_qty,
          picked_qty     = EXCLUDED.picked_qty,
          returned_qty   = EXCLUDED.returned_qty,
          gst_hsn_code   = EXCLUDED.gst_hsn_code
      `)
      .catch((e) => {
        console.warn(
          "[erp-poll] sales_order_items upsert skipped:",
          e instanceof Error ? e.message.slice(0, 200) : e
        );
      });
  }
}

export async function upsertPackingUnitsMirror(
  units: ErpPackingUnitResp[]
): Promise<void> {
  for (const p of units) {
    if (typeof p?.id !== "number") continue;
    await db
      .execute(sql`
        INSERT INTO erp.packing_units (
          id, unit_number, order_erp_name, status,
          packed_by, packed_at, sealed_by, sealed_at,
          dispatched_by, dispatched_at, partner, tracking_number,
          notes, weight_kg, length_cm, width_cm, height_cm,
          updated_at
        )
        VALUES (
          ${p.id},
          ${p.unit_number},
          ${p.order_erp_name},
          ${p.status ?? "open"},
          ${p.packed_by ?? null},
          ${p.packed_at ?? null}::timestamp,
          ${p.sealed_by ?? null},
          ${p.sealed_at ?? null}::timestamp,
          ${p.dispatched_by ?? null},
          ${p.dispatched_at ?? null}::timestamp,
          ${p.partner ?? null},
          ${p.tracking_number ?? null},
          ${p.notes ?? null},
          ${p.weight_kg ?? null},
          ${p.length_cm ?? null},
          ${p.width_cm ?? null},
          ${p.height_cm ?? null},
          now()
        )
        ON CONFLICT (id) DO UPDATE SET
          unit_number     = EXCLUDED.unit_number,
          order_erp_name  = EXCLUDED.order_erp_name,
          status          = EXCLUDED.status,
          packed_by       = EXCLUDED.packed_by,
          packed_at       = EXCLUDED.packed_at,
          sealed_by       = EXCLUDED.sealed_by,
          sealed_at       = EXCLUDED.sealed_at,
          dispatched_by   = EXCLUDED.dispatched_by,
          dispatched_at   = EXCLUDED.dispatched_at,
          partner         = EXCLUDED.partner,
          tracking_number = EXCLUDED.tracking_number,
          notes           = EXCLUDED.notes,
          weight_kg       = EXCLUDED.weight_kg,
          length_cm       = EXCLUDED.length_cm,
          width_cm        = EXCLUDED.width_cm,
          height_cm       = EXCLUDED.height_cm,
          updated_at      = now()
      `)
      .catch((e) => {
        console.warn(
          "[erp-poll] packing_units upsert skipped:",
          e instanceof Error ? e.message.slice(0, 200) : e
        );
      });
  }
}

// ─── sync_state read API (admin UI consumer) ──────────────────────────

export interface SyncStateRow {
  resource: string;
  last_modified_seen: string | null;
  last_run_at: string | null;
  last_run_status: string | null;
  last_error: string | null;
  rows_synced_total: number;
  rows_synced_last_run: number;
  lag_seconds: number | null;
}

export async function getSyncStateRows(): Promise<SyncStateRow[]> {
  const r: any = await db.execute(sql`
    SELECT resource,
           last_modified_seen,
           last_run_at,
           last_run_status,
           last_error,
           rows_synced_total,
           rows_synced_last_run,
           CASE WHEN last_modified_seen IS NULL THEN NULL
                ELSE EXTRACT(EPOCH FROM (now() - last_modified_seen))::int
           END AS lag_seconds
      FROM erp.sync_state
     ORDER BY resource
  `);
  const rows = (r.rows ?? r) as Array<Record<string, any>>;
  return rows.map((row) => ({
    resource: row.resource,
    last_modified_seen: row.last_modified_seen
      ? new Date(row.last_modified_seen).toISOString()
      : null,
    last_run_at: row.last_run_at
      ? new Date(row.last_run_at).toISOString()
      : null,
    last_run_status: row.last_run_status ?? null,
    last_error: row.last_error ?? null,
    rows_synced_total: Number(row.rows_synced_total ?? 0),
    rows_synced_last_run: Number(row.rows_synced_last_run ?? 0),
    lag_seconds: row.lag_seconds === null ? null : Number(row.lag_seconds),
  }));
}
