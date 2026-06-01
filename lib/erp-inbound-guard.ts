import "server-only";
import { NextResponse } from "next/server";

/**
 * "Has ERPNext inbound been turned off?"
 *
 * As of 2026-05-28 the admin panel is the single source of truth for
 * student / guardian / parent / order data. ERPNext inbound paths are
 * gated behind the `ERP_INBOUND_ENABLED` env var (default OFF) so they
 * can't silently re-introduce stale data on top of the manually-
 * stewarded DB.
 *
 * Outbound paths (cron/erp-drain) are not gated — pushing our orders
 * into ERPNext for downstream reporting can't corrupt our DB.
 *
 * Set `ERP_INBOUND_ENABLED=true` in .env.deploy to re-enable (e.g. for
 * a planned, one-shot reconciliation under supervision).
 */
export function isErpInboundEnabled(): boolean {
  return (process.env.ERP_INBOUND_ENABLED ?? "").toLowerCase() === "true";
}

/**
 * Narrow sibling of `isErpInboundEnabled()` covering only the
 * order-status pull (orders + shipments + packing units → status
 * derivation). When this is ON, the poll cron can still update local
 * order rows from audit even though `ERP_INBOUND_ENABLED` keeps the
 * customer/student/guardian/item resources locked.
 *
 * Default OFF. Set `ERP_INBOUND_ORDERS_POLL_ENABLED=true` in
 * .env.deploy to let storefront tracking advance from audit.
 */
export function isErpOrderPollEnabled(): boolean {
  if (isErpInboundEnabled()) return true;
  return (
    (process.env.ERP_INBOUND_ORDERS_POLL_ENABLED ?? "").toLowerCase() === "true"
  );
}

/**
 * True when only the orders-poll slice should run (master inbound is
 * OFF but the narrow flag is ON). The orchestrator branches on this to
 * skip customer/student/item polling.
 */
export function isOrderPollOnlyMode(): boolean {
  return !isErpInboundEnabled() && isErpOrderPollEnabled();
}

/**
 * Convenience: returns a 200 `{ disabled: true }` response if inbound
 * is OFF, else null. Use at the top of every inbound route:
 *
 *   const off = erpInboundDisabledResponse();
 *   if (off) return off;
 */
export function erpInboundDisabledResponse(): NextResponse | null {
  if (isErpInboundEnabled()) return null;
  return NextResponse.json({
    ok: true,
    disabled: true,
    reason:
      "ERP inbound is disabled. Set ERP_INBOUND_ENABLED=true in .env.deploy to re-enable.",
  });
}

/**
 * Narrower gate for the order-status pull endpoint. Stays open when
 * either the master switch or the orders-only switch is on.
 */
export function erpOrderPollDisabledResponse(): NextResponse | null {
  if (isErpOrderPollEnabled()) return null;
  return NextResponse.json({
    ok: true,
    disabled: true,
    reason:
      "ERP order-status poll is disabled. Set ERP_INBOUND_ORDERS_POLL_ENABLED=true (orders-only) or ERP_INBOUND_ENABLED=true (full) in .env.deploy to re-enable.",
  });
}
