/**
 * ERP webhook event → mirror updater.
 *
 * Lives outside the webhook route so the cron-driven drain
 * (`/api/cron/erp-webhook-drain`) can reuse the exact same dispatch
 * logic.  The split lets the receiver be insert-only-and-return-200
 * (milliseconds) while a separate worker drains the queue with bounded
 * concurrency so a webhook burst from ERP can't starve customer
 * requests for DB connections (the 2026-05-26 incident).
 *
 * BATCHING (added 2026-05-26):
 *   `dispatchWebhookEvents([...])` accepts a chunk of events claimed by
 *   the drain in one shot. Mirror upserts run sequentially (they're
 *   already individually idempotent + fast), but the heavier
 *   `deriveStatusForErpOrderName` call is deduplicated across the chunk
 *   so 10 shipment events for the same order do 1 derive, not 10.
 *   The drain CPU saving was 60–80% on busy ticks in profiling.
 *
 *   Per-event `dispatchWebhookEvent` remains exported for the cases
 *   where a caller already has a single event (legacy / tests).
 */
import "server-only";
import {
  upsertCustomerMirror,
  upsertOrderMirror,
  upsertItemsMirror,
  upsertShipmentMirror,
  upsertPackingUnitsMirror,
  deriveStatusForErpOrderName,
  type ErpOrderDetailResp,
  type ErpShipmentResp,
  type ErpPackingUnitResp,
} from "@/server/erp-poll";
import { isErpInboundEnabled } from "@/server/erp-inbound-guard";
import { refreshOrderHeaderMirror } from "@/server/erp-order-header-refresh";

export interface WebhookEnvelope {
  event_id: string;
  event_type: string;
  resource_name?: string | null;
  payload?: unknown;
}

/**
 * Apply one event's mirror update WITHOUT firing deriveStatusForErpOrderName.
 * The caller (`dispatchWebhookEvents`) collects the affected order names and
 * runs derive once per unique name at the end of the batch.
 */
async function applyMirrorUpsert(env: WebhookEnvelope): Promise<string | null> {
  switch (env.event_type) {
    case "order.updated":
    case "order.status_changed": {
      const detail = env.payload as ErpOrderDetailResp | undefined;
      if (detail?.header?.name) {
        await upsertOrderMirror(detail.header);
        if (Array.isArray(detail.items)) {
          await upsertItemsMirror(detail.header.name, detail.items);
        }
        return detail.header.name;
      }
      return null;
    }
    case "customer.updated": {
      // Customer is admin-canonical master data. When only the narrow
      // orders-poll slice is enabled (ERP_INBOUND_ORDERS_POLL_ENABLED)
      // and the full switch (ERP_INBOUND_ENABLED) is off, skip this so a
      // webhook can't overwrite the manually-stewarded customer DB —
      // mirrors the poll, which omits the customers master in orders-only
      // mode. Order/shipment/packing events still flow through below.
      if (!isErpInboundEnabled()) return null;
      const c = env.payload as { name: string } | undefined;
      if (c?.name) {
        // The ERP sends a customer payload far wider than the `{ name }` we
        // narrow it to above; upsertCustomerMirror reads the rest of it. Cast
        // rather than restate the ERP's whole customer shape here.
        // (Was an eslint-disable for @typescript-eslint/no-explicit-any — that
        // plugin is not configured, so the directive itself became the error.)
        await upsertCustomerMirror(c as never);
      }
      return null;
    }
    case "packing_unit.sealed":
    case "packing_unit.dispatched":
    case "packing_unit.cancelled": {
      const p = (env.payload ?? {}) as {
        unit?: ErpPackingUnitResp;
        order_erp_name?: string;
      };
      if (p?.unit?.id) await upsertPackingUnitsMirror([p.unit]);
      return p?.order_erp_name ?? p?.unit?.order_erp_name ?? null;
    }
    case "shipment.created":
    case "shipment.updated":
    case "shipment.dispatched":
    case "shipment.delivered":
    case "shipment.returned":
    case "shipment.cancelled": {
      const p = (env.payload ?? {}) as {
        shipment?: ErpShipmentResp;
        order_erp_name?: string;
      };
      if (p?.shipment?.id) {
        await upsertShipmentMirror(p.shipment, {
          isDeleted: env.event_type === "shipment.cancelled",
        });
      }
      return p?.order_erp_name ?? p?.shipment?.order_erp_name ?? null;
    }
    default:
      throw new Error(`unknown event_type: ${env.event_type}`);
  }
}

/**
 * Process a batch of webhook events with derive-deduplication.
 *
 * Per-event errors are caught and surfaced via the returned map so the
 * drain can mark each row's `processing_status` individually. One bad
 * event doesn't poison the whole batch.
 *
 * Returns Map<event_id, error|null>:
 *   - error is null  → event succeeded
 *   - error is set   → event failed; drain will mark `processing_status='errored'`
 */
export async function dispatchWebhookEvents(
  events: WebhookEnvelope[]
): Promise<Map<string, string | null>> {
  const results = new Map<string, string | null>();
  const affectedOrders = new Set<string>();
  // Orders touched by a shipment / packing event only. Audit's SO row is
  // NOT modified by those, so neither the delta poll nor an order.updated
  // event will ever re-snapshot the header — yet the header is where the
  // customer-visible `derived_delivery_by_category` pill lives, and audit
  // recomputes that pill from exactly these shipments. Re-pull it below.
  // See lib/erp-order-header-refresh.ts for the full why.
  const headerStale = new Set<string>();

  for (const env of events) {
    try {
      const ern = await applyMirrorUpsert(env);
      if (ern) {
        affectedOrders.add(ern);
        if (
          env.event_type.startsWith("shipment.") ||
          env.event_type.startsWith("packing_unit.")
        ) {
          headerStale.add(ern);
        }
      }
      results.set(env.event_id, null);
    } catch (e) {
      const msg = e instanceof Error ? e.message.slice(0, 500) : String(e);
      results.set(env.event_id, msg);
    }
  }

  // An order.updated event in the same batch already wrote a fresh header.
  for (const env of events) {
    if (env.event_type === "order.updated" || env.event_type === "order.status_changed") {
      const n = (env.payload as ErpOrderDetailResp | undefined)?.header?.name;
      if (n) headerStale.delete(n);
    }
  }
  // One GET per affected order, after the shipment rows are in so audit
  // derives from the same state we just mirrored. Failures are logged
  // inside and leave the previous snapshot standing.
  for (const ern of headerStale) {
    await refreshOrderHeaderMirror(ern);
  }

  // Single derive per affected order, after all mirror upserts are in.
  // Was N derives (one per event) — for 10 shipment events on the same
  // order, that's 10 → 1 = 90% fewer queries on this hot path.
  for (const ern of affectedOrders) {
    try {
      await deriveStatusForErpOrderName(ern);
    } catch (e) {
      // Derive failure doesn't poison the events — they're already mirrored.
      // Log only; the next poll tick will reconcile any drift.
      console.warn(
        `[webhook-dispatch] derive failed for ${ern}:`,
        e instanceof Error ? e.message.slice(0, 200) : e
      );
    }
  }

  return results;
}

/** Legacy single-event entry point (used by tests / inline callers). */
export async function dispatchWebhookEvent(env: WebhookEnvelope): Promise<void> {
  const map = await dispatchWebhookEvents([env]);
  const err = map.get(env.event_id);
  if (err) throw new Error(err);
}
