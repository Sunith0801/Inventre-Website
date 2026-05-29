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
