import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { requireParent, isResponse } from "@/lib/parent-guard";
import { erpAuthedGet } from "@/lib/erp-jwt";
import { upsertShipmentMirror, type ErpShipmentResp } from "@/lib/erp-poll";
import {
  getParentOrderDetailFromErp,
  getParentOrderDetailLocal,
} from "@/lib/erp-customer-orders";

/**
 * POST /api/orders/{id}/shipments/{shipmentId}/refresh
 *
 * Storefront "Refresh" button on the per-shipment card. Pulls the latest
 * shipment row from audit (carrier_events included) and writes through to
 * our local mirror so the next page render picks up the fresh scan
 * history. Auth-scoped to the order's parent so cross-parent refresh is
 * impossible.
 *
 * Audit doesn't currently expose a "force the carrier to re-poll" endpoint
 * — its own cron walks each AWB on a schedule — so this is effectively a
 * "re-sync to audit's latest known state" rather than a live carrier hit.
 * For the parent, that's still the right button: it surfaces any scans
 * audit has but our mirror hasn't yet picked up.
 */
export async function POST(
  _: Request,
  { params }: { params: Promise<{ id: string; shipmentId: string }> },
) {
  const { id, shipmentId } = await params;
  const me = await requireParent();
  if (isResponse(me)) return me;

  const numericShipmentId = Number(shipmentId);
  if (!Number.isFinite(numericShipmentId) || numericShipmentId <= 0) {
    return NextResponse.json({ error: "Bad shipment id" }, { status: 400 });
  }

  // Authorisation: the shipment must belong to an order this parent owns.
  // We resolve the order DTO first (which is already parent-scoped) and
  // confirm the shipment id is in the returned shipmentHistory list.
  const decoded = decodeURIComponent(id);
  const order =
    (await getParentOrderDetailFromErp(me.id, decoded)) ??
    (await getParentOrderDetailLocal(me.id, decoded));
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }
  const owns = order.shipmentHistory.some(
    (s) => s.shipmentId === numericShipmentId,
  );
  if (!owns) {
    return NextResponse.json({ error: "Shipment not in this order" }, { status: 403 });
  }

  // Pull fresh from audit. Audit's list endpoint silently ignores filter
  // params on the query string (every variant of `?ids=` / `?id=` returns
  // the default modified_desc page), so use the singular detail path
  // /api/outward/shipments/{id} which DOES respect the id and returns the
  // event timeline directly on the body. Defensive: cross-check the
  // returned id matches the one we asked for so a misrouted response
  // doesn't pollute our mirror with another order's shipment.
  try {
    const sh = await erpAuthedGet<ErpShipmentResp>(
      `/api/outward/shipments/${encodeURIComponent(String(numericShipmentId))}`,
    );
    if (!sh || (sh as Record<string, unknown>).id !== numericShipmentId) {
      return NextResponse.json(
        { error: "Audit returned no row for that shipment" },
        { status: 502 },
      );
    }
    await upsertShipmentMirror(sh);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: "Audit refresh failed", details: msg.slice(0, 200) },
      { status: 502 },
    );
  }

  // Return just enough to confirm the refresh; the client calls
  // router.refresh() to repaint the page, which re-fetches the full DTO.
  const updated = await db.execute(sql`
    SELECT id::int                              AS shipment_id,
           status,
           jsonb_array_length(carrier_events)   AS carrier_event_count,
           updated_at::text                     AS updated_at
      FROM erp.outward_shipments
     WHERE id = ${numericShipmentId}
     LIMIT 1
  `);
  return NextResponse.json({
    ok: true,
    shipment: (updated as unknown as { rows: unknown[] }).rows?.[0] ?? null,
  });
}
