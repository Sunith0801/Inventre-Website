import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { getErpConfig, isErpPollConfigured } from "@/server/erp-config";
import { erpAuthedGet } from "@/server/erp-jwt";
import {
  upsertCustomerMirror,
  upsertOrderMirror,
  upsertItemsMirror,
  type ErpOrderHeader,
  type ErpOrderDetailResp,
} from "@/server/erp-poll";

/**
 * One-shot per-parent backfill of historical ERP orders.
 *
 * The regular delta-poll only mirrors orders that have been *modified*
 * since the watermark. A parent's pre-existing orders (placed at the
 * counter, by school admin, etc.) don't necessarily trigger ERP-side
 * modifications, so they'd never appear in `/shop/orders` unless we
 * fetch them explicitly when the parent logs in.
 *
 * Triggered (fire-and-forget) from the OTP-verify route after a session
 * is issued. Idempotent — re-running is cheap once the mirror is warm.
 *
 * Throttled per-phone via the `parents.erp_backfilled_at` watermark in
 * Postgres so a parent who logs in repeatedly inside the cooldown
 * window doesn't hammer ERP.
 */

const BACKFILL_COOLDOWN_HOURS = 24;
const MAX_ORDERS_PER_BACKFILL = 200;

export interface BackfillResult {
  phone: string;
  skipped: boolean;
  reason?: string;
  customers: number;
  orders: number;
  errored: number;
  durationMs: number;
}

/** Public, fire-and-forget entry point. */
export function scheduleParentBackfill(phone: string): void {
  // void on purpose — never block the caller (login UX).
  backfillParentOrders(phone).catch((e) => {
    console.warn(
      `[erp-backfill] background run failed for ${phone}:`,
      e instanceof Error ? e.message : e
    );
  });
}

/** Awaitable variant — useful for tests / admin reruns. */
export async function backfillParentOrders(phone: string): Promise<BackfillResult> {
  const t0 = Date.now();
  const skel: BackfillResult = {
    phone,
    skipped: false,
    customers: 0,
    orders: 0,
    errored: 0,
    durationMs: 0,
  };

  const cfg = getErpConfig();
  if (!isErpPollConfigured(cfg)) {
    return {
      ...skel,
      skipped: true,
      reason: `poll not configured (target=${cfg.target})`,
      durationMs: Date.now() - t0,
    };
  }

  // Cooldown check — only one backfill per phone per cooldown window.
  const cooldownOk = await checkAndStampCooldown(phone);
  if (!cooldownOk) {
    return {
      ...skel,
      skipped: true,
      reason: `cooldown active (last < ${BACKFILL_COOLDOWN_HOURS}h ago)`,
      durationMs: Date.now() - t0,
    };
  }

  // 1. Find matching customer(s) in ERP by mobile.
  // A parent's number may be on multiple customer rows (siblings under
  // different student-customers). We backfill orders from all matches.
  const m10 = phone.replace(/\D/g, "").slice(-10);
  let customerCodes: string[] = [];
  try {
    const res = await erpAuthedGet<{ rows?: Array<{ name: string }> }>(
      `/api/customers?mobile_no=${encodeURIComponent(m10)}&limit=50`
    );
    const rows = res?.rows ?? [];
    for (const c of rows) {
      try {
        await upsertCustomerMirror(c as any);
        skel.customers++;
      } catch (e) {
        skel.errored++;
        console.warn(
          `[erp-backfill] customer upsert failed for ${c.name}:`,
          e instanceof Error ? e.message : e
        );
      }
      if (c?.name) customerCodes.push(c.name);
    }
  } catch (e) {
    return {
      ...skel,
      reason: `customer lookup failed: ${e instanceof Error ? e.message.slice(0, 200) : e}`,
      durationMs: Date.now() - t0,
    };
  }

  if (customerCodes.length === 0) {
    return {
      ...skel,
      reason: "no ERP customer matched this phone",
      durationMs: Date.now() - t0,
    };
  }

  // 2. For each customer code, fetch their orders + detail.
  for (const code of customerCodes) {
    if (skel.orders >= MAX_ORDERS_PER_BACKFILL) break;
    try {
      const ordersRes = await erpAuthedGet<{ rows?: ErpOrderHeader[] }>(
        `/api/orders?customer=${encodeURIComponent(code)}&limit=${MAX_ORDERS_PER_BACKFILL}&include_aggregates=false`
      );
      const orderRows = ordersRes?.rows ?? [];
      for (const o of orderRows) {
        if (skel.orders >= MAX_ORDERS_PER_BACKFILL) break;
        if (!o?.name) continue;
        try {
          const detail = await erpAuthedGet<ErpOrderDetailResp>(
            `/api/orders/${encodeURIComponent(o.name)}`
          );
          if (detail?.header?.name) {
            await upsertOrderMirror(detail.header);
            if (Array.isArray(detail.items)) {
              await upsertItemsMirror(detail.header.name, detail.items);
            }
            skel.orders++;
          }
        } catch (e) {
          skel.errored++;
          console.warn(
            `[erp-backfill] order ${o.name} detail/upsert failed:`,
            e instanceof Error ? e.message.slice(0, 200) : e
          );
        }
      }
    } catch (e) {
      skel.errored++;
      console.warn(
        `[erp-backfill] orders fetch failed for customer ${code}:`,
        e instanceof Error ? e.message.slice(0, 200) : e
      );
    }
  }

  return { ...skel, durationMs: Date.now() - t0 };
}

/**
 * Per-phone throttle in `parents` table. Adds the column on first use
 * (idempotent DDL) so we don't need a separate migration to enable
 * Phase 2 — the column appears the first time a parent logs in after
 * this code is deployed.
 *
 * Returns true if the cooldown is clear (and stamps "now") or false
 * if a recent backfill already happened.
 */
async function checkAndStampCooldown(phone: string): Promise<boolean> {
  await db
    .execute(sql`
      ALTER TABLE parents
        ADD COLUMN IF NOT EXISTS erp_backfilled_at TIMESTAMPTZ
    `)
    .catch(() => {});
  const r: any = await db.execute(sql`
    UPDATE parents
       SET erp_backfilled_at = now()
     WHERE phone = ${phone}
       AND (erp_backfilled_at IS NULL
            OR erp_backfilled_at < now() - interval '${sql.raw(String(BACKFILL_COOLDOWN_HOURS))} hours')
    RETURNING id
  `);
  const rows = r?.rows ?? r;
  return Array.isArray(rows) && rows.length > 0;
}
