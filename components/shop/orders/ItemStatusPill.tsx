"use client";

import type { CategoryStatus } from "@/components/shop/orders/order-detail-types";

export const CATEGORY_STATUS_CLASS: Record<CategoryStatus, string> = {
  delivered: "bg-emerald-100 text-emerald-800",
  "out for delivery": "bg-indigo-100 text-indigo-800",
  "in transit": "bg-amber-100 text-amber-800",
  returned: "bg-rose-100 text-rose-800",
  pending: "bg-ink-100 text-ink-600",
};

// Small per-item / per-component delivery-status pill. Shows the line's LIVE
// status in the same words and colours as the category card (delivered / out
// for delivery / in transit / returned / pending), rather than the old binary
// green-delivered-else-red-"pending" — a parcel already on the van read
// "pending" to the parent, which contradicted the tracking timeline right
// above it. "pending" is now only what the resolver genuinely can't report on
// (held back, out-of-stock, no shipment row). Renders nothing when status is
// unknown (order/box not line-level tracked).
export function ItemStatusPill({ status }: { status?: CategoryStatus | null }) {
  if (!status) return null;
  return (
    <span
      className={
        "shrink-0 rounded-full px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-wider " +
        (CATEGORY_STATUS_CLASS[status] ?? CATEGORY_STATUS_CLASS.pending)
      }
    >
      {status}
    </span>
  );
}
