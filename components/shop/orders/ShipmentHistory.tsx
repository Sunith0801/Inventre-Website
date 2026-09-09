"use client";

import { Package, ExternalLink, MapPin, CheckCircle2 } from "lucide-react";
import { trackingUrlFor } from "@/lib/carriers";

export type ShipmentHistoryEvent = {
  kind: "system" | "carrier";
  at: string;
  label: string;
  source: string | null;
  badge: string;
};

export type ShipmentHistoryItem = {
  shipmentId: number | null;
  partner: string;
  mode: "auto" | "manual" | null;
  trackingNumber: string | null;
  status: string;
  itemCategory: string | null;
  description: string | null;
  dispatchedAt: string | null;
  deliveredAt: string | null;
  carrierEventCount: number;
  events: ShipmentHistoryEvent[];
};

export function ShipmentHistory({
  items,
}: {
  items: ShipmentHistoryItem[];
}) {
  if (items.length === 0) return null;
  return (
    <div className="mt-6 rounded-2xl border border-ink-100 bg-white p-5 lg:p-6">
      <h3 className="font-display text-[16px] font-bold text-ink-900">
        Shipment history{" "}
        <span className="text-ink-400 font-semibold">({items.length})</span>
      </h3>
      <div className="mt-4 space-y-5">
        {items.map((s, i) => (
          <ShipmentCard key={s.shipmentId ?? `idx-${i}`} shipment={s} />
        ))}
      </div>
    </div>
  );
}

export function ShipmentCard({
  shipment,
}: {
  shipment: ShipmentHistoryItem;
}) {
  const delivered = shipment.status === "delivered";
  const carrierUrl = shipment.trackingNumber
    ? trackingUrlFor(shipment.partner, shipment.trackingNumber)
    : null;
  // Total event count = carrier scans + system transitions. Earlier the
  // header read "scan history · N events" where N was only the carrier
  // scan count, so srocket shipments (which never get -scan rows) looked
  // empty even when the timeline below had system events.
  const totalEvents = shipment.events.length;

  return (
    <div className="rounded-xl border border-ink-100 bg-cream-50/40">
      {/* header */}
      <div className="p-4 sm:p-5 border-b border-ink-100">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px]">
          <span className="font-bold text-ink-900 uppercase">
            {shipment.partner}
          </span>
          {shipment.trackingNumber && !shipment.trackingNumber.startsWith("syn:") && (
            <span className="font-mono text-[12px] text-ink-700">
              {shipment.trackingNumber}
            </span>
          )}
          {carrierUrl && (
            <a
              href={carrierUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[11px] font-semibold text-brand hover:underline"
            >
              Track on carrier <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <StatusBadge status={shipment.status} delivered={delivered} />
          {shipment.itemCategory && (
            <span className="rounded-full bg-cream-200 px-2.5 py-0.5 text-[10.5px] font-bold uppercase tracking-wider text-ink-800">
              {shipment.itemCategory}
            </span>
          )}
        </div>
        <div className="mt-3 text-[12.5px] text-ink-600 leading-snug">
          {shipment.dispatchedAt && (
            <p>
              <span className="text-ink-500">Dispatched:</span>{" "}
              <span className="font-medium text-ink-800">
                {formatDateTime(shipment.dispatchedAt)}
              </span>
            </p>
          )}
          {shipment.description && (
            <p className="mt-1 text-ink-700">{shipment.description}</p>
          )}
        </div>
        <p className="mt-3 text-[11.5px] text-ink-500">
          {shipment.partner.toUpperCase()} tracking{" "}
          <span className="text-ink-400">·</span>{" "}
          {totalEvents} event{totalEvents === 1 ? "" : "s"}{" "}
          <span className="text-ink-400">·</span>{" "}
          <span className="inline-flex items-center gap-1 text-emerald-700">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Live
          </span>
        </p>
      </div>

      {/* timeline — horizontal stepper. The connecting rail runs full-
          width behind the nodes; each event animates in with a small
          fade+rise so freshly-poll'd scans feel "live". On narrow
          viewports the stepper overflows horizontally with native
          scroll-snap so parents can swipe through the history. */}
      {shipment.events.length > 0 && (
        <div className="relative overflow-x-auto px-4 sm:px-5 py-5">
          {/* Events are sorted newest-first now, so the rail's "live"
              colour starts on the LEFT (where the most recent scan
              lives) and fades toward the older entries on the right. */}
          <div
            className="absolute left-5 right-5 top-[34px] h-[2px] bg-gradient-to-l from-emerald-300 via-indigo-300 to-ink-200"
            aria-hidden
          />
          <ol className="relative flex gap-6 snap-x snap-mandatory">
            {shipment.events.map((ev, i) => (
              <li
                key={`${ev.at}-${i}`}
                className="snap-start shrink-0 w-[160px] sm:w-[180px] motion-safe:animate-shipment-event-in"
                style={{ animationDelay: `${Math.min(i, 12) * 35}ms` }}
              >
                <div
                  className={
                    "relative mx-auto grid h-7 w-7 place-items-center rounded-full border-2 shadow-sm " +
                    (ev.kind === "carrier"
                      ? "bg-white border-indigo-400 text-indigo-600"
                      : ev.badge === "Auto-poll"
                        ? "bg-white border-emerald-400 text-emerald-600"
                        : "bg-white border-ink-300 text-ink-500")
                  }
                >
                  {ev.kind === "carrier" ? (
                    <MapPin className="h-3.5 w-3.5" />
                  ) : (
                    <Package className="h-3.5 w-3.5" />
                  )}
                  {/* most-recent event pulses gently so the eye lands
                      there. Events are now newest-first, so the pulse
                      lives on index 0. */}
                  {i === 0 && (
                    <span className="absolute inset-0 rounded-full ring-2 ring-emerald-300/60 motion-safe:animate-ping" />
                  )}
                </div>
                <p className="mt-3 text-center text-[12.5px] font-semibold text-ink-900 leading-tight">
                  {ev.label}
                </p>
                {/* Only carrier scans carry a `source` now, and it's the scan
                    LOCATION. System events send null — staff/integration
                    handles are stripped server-side. */}
                {ev.source && (
                  <p className="mt-1 text-center text-[11px] text-ink-500 leading-snug truncate" title={ev.source}>
                    {ev.source}
                  </p>
                )}
                <p className="mt-1.5 text-center text-[10.5px] text-ink-500 tabular-nums">
                  {formatDateTime(ev.at)}
                </p>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status, delivered }: { status: string; delivered: boolean }) {
  const display = status.replace(/_/g, " ");
  if (delivered) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[10.5px] font-bold uppercase tracking-wider text-emerald-700">
        <CheckCircle2 className="h-3 w-3" />
        {display}
      </span>
    );
  }
  return (
    <span className="rounded-full bg-indigo-50 px-2.5 py-0.5 text-[10.5px] font-bold uppercase tracking-wider text-indigo-700">
      {display}
    </span>
  );
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "2-digit",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}
