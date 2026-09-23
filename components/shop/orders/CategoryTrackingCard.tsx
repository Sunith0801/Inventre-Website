"use client";

/**
 * Per-category tracking card on the storefront order page (stage bar, status
 * counter, per-item pills, shipments). Extracted from
 * app/shop/orders/[id]/page.tsx on 2026-09-23 (F-08); behaviour unchanged.
 */
import { CheckCircle2, Package } from "lucide-react";
import { ShipmentCard, type ShipmentHistoryItem } from "@/components/shop/orders/ShipmentHistory";
import { stages, type CategoryStatus, type OrderDetail } from "@/components/shop/orders/order-detail-types";
import { ItemStatusPill, CATEGORY_STATUS_CLASS } from "@/components/shop/orders/ItemStatusPill";

type CategoryGroupForCard = NonNullable<OrderDetail["categoryGroups"]>[number];

/** Map a per-category status to a stage index on the shared 7-step bar.
 *  Stages: placed(0) confirmed(1) packed(2) shipped(3) in transit(4)
 *          out for delivery(5) delivered(6)
 *  - "pending"           → confirmed   (1)
 *  - "in transit"        → in transit  (4)
 *  - "out for delivery"  → OFD         (5)
 *  - "delivered"         → delivered   (6)
 *  - "returned"          → delivered   (6) but rendered with a returned tint
 */
function categoryStageIdx(status: CategoryGroupForCard["status"]): number {
  switch (status) {
    case "delivered":
    case "returned":
      return 6;
    case "out for delivery":
      return 5;
    case "in transit":
      return 4;
    default:
      return 1;
  }
}

/** Find which group, if any, owns a shipment. Matched by lowercased
 *  comparison between the shipment's `itemCategory` (the ERP raw category:
 *  "bookkit", "uniform", …) and each group's `rootCategoryName`. */
export function findGroupForShipment(
  shipment: ShipmentHistoryItem,
  groups: CategoryGroupForCard[]
): CategoryGroupForCard | null {
  const cat = (shipment.itemCategory ?? "").toLowerCase().trim();
  if (!cat) return null;
  return groups.find((g) => g.rootCategoryName.toLowerCase() === cat) ?? null;
}

/** Return the shipments whose `itemCategory` matches this group name. */
export function shipmentsForCategory(
  shipments: ShipmentHistoryItem[],
  rootCategoryName: string
): ShipmentHistoryItem[] {
  const key = rootCategoryName.toLowerCase();
  return shipments.filter(
    (s) => (s.itemCategory ?? "").toLowerCase().trim() === key
  );
}

export function StageBar({
  reachedIdx,
  accent = "brand",
  lastLabel,
}: {
  reachedIdx: number;
  accent?: "brand" | "emerald" | "rose";
  /** Override the final node's label. Used to show "RTO" instead of
   *  "delivered" for a returned (Return-to-Origin) category. */
  lastLabel?: string;
}) {
  const fill =
    accent === "emerald"
      ? "bg-emerald-500 border-emerald-500"
      : accent === "rose"
        ? "bg-rose-500 border-rose-500"
        : "bg-brand border-brand";
  const segFill =
    accent === "emerald" ? "bg-emerald-400" : accent === "rose" ? "bg-rose-400" : "bg-brand";
  return (
    // 7 columns: tighter than 5 but still scannable on a phone. Labels
    // wrap to two lines at <= text-[9.5px] where needed; OFD is the
    // shortened display for "out for delivery" to keep its column from
    // overflowing.
    //
    // The column count is set with an inline grid-template rather than the
    // `grid-cols-7` utility on purpose: in dev/JIT builds a freshly-added
    // arbitrary column count can be missing from the emitted stylesheet,
    // which silently collapses the bar to a single vertical column. An
    // inline style is always present, so the horizontal layout can never
    // depend on Tailwind having generated that exact utility.
    <ol
      className="grid gap-x-0.5"
      style={{ gridTemplateColumns: `repeat(${stages.length}, minmax(0, 1fr))` }}
    >
      {stages.map((s, i) => {
        const reached = i <= reachedIdx;
        const last = i === stages.length - 1;
        const segFilled = i < reachedIdx;
        const label = last && lastLabel ? lastLabel : s;
        return (
          <li key={s} className="relative flex flex-col items-center text-center">
            {!last && (
              <span
                className={
                  "absolute top-4 left-1/2 h-[3px] w-full -translate-y-1/2 " +
                  (segFilled ? segFill : "bg-ink-200")
                }
              />
            )}
            <span
              className={
                "relative z-10 grid h-8 w-8 place-items-center rounded-full border-2 text-white " +
                (reached ? fill : "bg-white border-ink-200 text-ink-400")
              }
            >
              {reached ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : (
                <Package className="h-3.5 w-3.5" />
              )}
            </span>
            <span
              className={
                // Each label gets its own grid cell, so wrapping
                // "out for delivery" / "in transit" onto two lines
                // stays contained without pushing siblings around.
                "relative z-10 mt-2 text-[8.5px] sm:text-[9.5px] font-semibold tracking-wider uppercase leading-[1.1] break-words px-0.5 " +
                (reached ? "text-ink-900" : "text-ink-400")
              }
            >
              {label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** Clickable header for the collapsible item lists. Deliberately styled as an
 *  obvious control — brand-tinted pill, hover state, circled chevron and an
 *  explicit verb — because the first cut used a plain grey caption and
 *  customers didn't notice it opened at all. */
export function ItemsToggle({ count, noun = "item" }: { count: number; noun?: string }) {
  const label = `${count} ${noun}${count === 1 ? "" : "s"}`;
  return (
    <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-[12.5px] font-semibold text-brand-700 transition-colors hover:border-brand-300 hover:bg-brand-100 [&::-webkit-details-marker]:hidden">
      <span>
        <span className="group-open:hidden">View {label}</span>
        <span className="hidden group-open:inline">Hide {label}</span>
      </span>
      <span
        aria-hidden
        className="grid h-5 w-5 shrink-0 place-items-center rounded-full border border-brand-300 bg-white text-[9px] leading-none text-brand-700 transition-transform group-open:rotate-180"
      >
        ▾
      </span>
    </summary>
  );
}

export function CategoryTrackingCard({
  group,
  shipments,
  components,
}: {
  group: CategoryGroupForCard;
  shipments: ShipmentHistoryItem[];
  /** Magic Box components that belong to THIS category (uniform / bookkit).
   *  When there's more than one we list each with its own delivered/pending
   *  badge instead of the opaque box line; a single-component category
   *  (e.g. bookkit) needs no per-item breakdown — the header says it all. */
  components?: {
    name: string;
    size: string;
    qty: number;
    attributes?: { name: string; value: string }[];
    status?: CategoryStatus | null;
  }[];
}) {
  const idx = categoryStageIdx(group.status);
  const accent =
    group.status === "delivered"
      ? "emerald"
      : group.status === "returned"
        ? "rose"
        : "brand";
  // Counter that matches the group's effective status — keeps the headline
  // honest ("4 / 4 out for delivery") instead of falling back to "0/4
  // delivered" before any line-level delivery is recorded.
  const counter =
    group.status === "delivered"
      ? group.deliveredQty
      : group.status === "returned"
        ? group.returnedQty
        : group.status === "in transit" || group.status === "out for delivery"
          ? Math.max(group.pickedQty, group.deliveredQty)
          : 0;
  const lineLabel =
    group.status === "delivered"
      ? "delivered"
      : group.status === "out for delivery"
        ? "out for delivery"
        : group.status === "in transit"
          ? "in transit"
          : group.status === "returned"
            ? "returned"
            : "awaiting dispatch";
  // When we list per-component rows (multi-component Magic Box category), the
  // header counter must reflect the components ("6 / 7 delivered"), not the
  // parcel-level "1 / 1" — otherwise it contradicts a pending component below.
  const showComponents = !!components && components.length > 1;
  const counterText = showComponents
    ? (() => {
        const total = components!.reduce((n, c) => n + (c.qty || 1), 0);
        const delivered = components!.reduce(
          (n, c) => n + (c.status === "delivered" ? c.qty || 1 : 0),
          0,
        );
        return `${delivered} / ${total} delivered`;
      })()
    : group.status === "pending"
      ? `${group.totalQty} ${lineLabel}`
      : `${counter} / ${group.totalQty} ${lineLabel}`;

  return (
    <div className="rounded-2xl border border-ink-100 bg-white p-5 lg:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h4 className="font-display text-[16px] font-bold text-ink-900">
          {group.rootCategoryName}
        </h4>
        <div className="flex items-center gap-2">
          <span
            className={
              "rounded-full px-2.5 py-0.5 text-[10.5px] font-bold uppercase tracking-wider " +
              CATEGORY_STATUS_CLASS[group.status]
            }
          >
            {group.status === "returned" ? "RTO" : group.status}
          </span>
          <span className="text-[11.5px] font-semibold tabular-nums text-ink-500">
            {counterText}
          </span>
        </div>
      </div>
      <StageBar
        reachedIdx={idx}
        accent={accent}
        lastLabel={group.status === "returned" ? "RTO" : undefined}
      />

      {/* Per-item breakdown. For a Magic Box category with more than one
          component (e.g. uniform) we list every component with its own
          delivered/pending badge; a single-component category (bookkit) is
          left to the header. Non-box categories keep listing their own lines,
          now with the same delivered/pending badge. */}
      {components && components.length > 1 ? (
        <details className="group mt-4 border-t border-ink-100 pt-3">
          <ItemsToggle count={components.length} />
          <ul className="mt-3 space-y-1.5">
            {components.map((c, i) => {
              const detail =
                c.attributes && c.attributes.length > 0
                  ? c.attributes.map((a) => a.value).join(" · ")
                  : c.size;
              return (
                <li
                  key={`${c.name}-${i}`}
                  className="flex items-center justify-between gap-3 text-[12.5px] text-ink-700"
                >
                  <span className="truncate pr-1">
                    {c.name}
                    {c.qty > 1 ? ` ×${c.qty}` : ""}
                    {detail ? (
                      <span className="text-ink-400"> · {detail}</span>
                    ) : null}
                  </span>
                  <ItemStatusPill status={c.status ?? "pending"} />
                </li>
              );
            })}
          </ul>
        </details>
      ) : !components && group.items.length > 0 ? (
        <details className="group mt-4 border-t border-ink-100 pt-3">
          <ItemsToggle count={group.items.length} />
          <ul className="mt-3 space-y-1.5">
            {group.items.map((it) => (
              <li
                key={it.id}
                className="flex items-center justify-between gap-3 text-[12.5px] text-ink-700"
              >
                <span className="truncate pr-1">{it.name}</span>
                <ItemStatusPill status={it.status ?? group.status} />
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {shipments.length > 0 && (
        <div className="mt-5 space-y-4 border-t border-ink-100 pt-4">
          {shipments.map((s, i) => (
            <ShipmentCard key={s.shipmentId ?? `idx-${i}`} shipment={s} />
          ))}
        </div>
      )}
    </div>
  );
}
