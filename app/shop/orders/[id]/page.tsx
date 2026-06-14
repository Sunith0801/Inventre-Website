"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { useFocusRefetch } from "@/lib/use-focus-refetch";
import { ArrowLeft, CheckCircle2, Package } from "lucide-react";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { ExchangeStatusBanner } from "@/components/shop/orders/exchange/ExchangeStatusBanner";
import { MissingStatusBanner } from "@/components/shop/orders/missing/MissingStatusBanner";
import {
  ShipmentHistory,
  ShipmentCard,
  type ShipmentHistoryItem,
} from "@/components/shop/orders/ShipmentHistory";

/**
 * Some legacy addresses were stored with literal "<br>" / "<br/>" inside the
 * line/city fields (imported HTML). Convert any such markers to real newlines
 * and strip stray HTML tags so the address renders as plain text.
 */
function cleanAddrLine(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .trim();
}

type OrderDetail = {
  id: string;
  orderNumber: string;
  status: string;
  paymentStatus: string;
  subtotal: number;
  tax: number;
  shipping: number;
  total: number;
  createdAt: string;
  studentName?: string | null;
  enrollment?: string | null;
  shippingAddress: {
    receiverName: string;
    receiverPhone: string;
    line1: string;
    line2?: string;
    city: string;
    state: string;
    pincode: string;
  };
  items: {
    id: string;
    name: string;
    size: string;
    qty: number;
    unitPrice: number;
    total: number;
    imageUrl: string;
    bundleSelections:
      | {
          componentProductId: string;
          name: string;
          qty: number;
          variantId: string;
          size: string;
          attributes: { name: string; value: string }[];
        }[]
      | null;
  }[];
  payment: { provider: string; status: string; method: string | null } | null;
  tracking?: {
    partner: string;
    trackingNumber: string | null;
    status: string;
    dispatchedAt: string | null;
    deliveredAt: string | null;
  }[];
  shipmentHistory?: {
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
    events: {
      kind: "system" | "carrier";
      at: string;
      label: string;
      source: string | null;
      badge: string;
    }[];
  }[];
  categoryGroups?: {
    rootCategoryId: string | null;
    rootCategoryName: string;
    totalQty: number;
    deliveredQty: number;
    pickedQty: number;
    returnedQty: number;
    status: CategoryStatus;
    items: {
      id: string;
      name: string;
      qty: number;
      deliveredQty: number;
      pickedQty: number;
      returnedQty: number;
    }[];
  }[];
  pollPending?: boolean;
};

type CategoryStatus =
  | "delivered"
  | "out for delivery"
  | "in transit"
  | "returned"
  | "pending";

const CATEGORY_STATUS_CLASS: Record<CategoryStatus, string> = {
  delivered: "bg-emerald-100 text-emerald-800",
  "out for delivery": "bg-indigo-100 text-indigo-800",
  "in transit": "bg-amber-100 text-amber-800",
  returned: "bg-rose-100 text-rose-800",
  pending: "bg-ink-100 text-ink-600",
};

// 7-stage pipeline. "in transit" and "out for delivery" are intentionally
// distinct from "shipped" so the stage bar reflects audit's real progress
// (a parcel that's been picked up but not yet on the truck is "shipped";
// once the carrier scans a line-haul leg it's "in transit"; the final
// hop is "out for delivery"). Multi-word labels wrap to two lines on
// narrow viewports — full phrasing reads better than the OFD shorthand.
const stages = [
  "placed",
  "confirmed",
  "packed",
  "shipped",
  "in transit",
  "out for delivery",
  "delivered",
] as const;

export default function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const params = useSearchParams();
  const isPlacedJustNow = params.get("placed") === "1";
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [loaded, setLoaded] = useState(false);
  // Live status-poll state. `polling` drives the "Checking with CCAvenue…"
  // chip next to the Payment card; the back-off schedule is tracked
  // entirely inside the effect so we don't re-fetch the order DTO until
  // CCAvenue actually has news for us.
  const [polling, setPolling] = useState(false);
  // Exchange-flow surface — phone-gated server-side. Non-allowlisted
  // parents always see `canExchange=false` and `activeExchange=null`,
  // so the banner and button render nothing for them.
  const [canExchange, setCanExchange] = useState(false);
  const [canMissing, setCanMissing] = useState(false);
  const [activeExchange, setActiveExchange] = useState<{
    id: string;
    returnNumber: string | null;
    status: string;
    pickupDate: string | null;
    createdAt: string;
  } | null>(null);
  const [activeMissing, setActiveMissing] = useState<{
    id: string;
    claimNumber: string | null;
    status: string;
    pickupDate: string | null;
    createdAt: string;
  } | null>(null);

  const refetchOrder = useCallback(
    () =>
      fetch(`/api/orders/${id}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          setOrder(d?.order ?? null);
          setCanExchange(Boolean(d?.canExchange));
          setCanMissing(Boolean(d?.canMissing));
          setActiveExchange(d?.activeExchange ?? null);
          setActiveMissing(d?.activeMissing ?? null);
        }),
    [id]
  );

  useEffect(() => {
    refetchOrder().finally(() => setLoaded(true));
  }, [refetchOrder]);
  // Order status / tracking updates from admin should appear the moment
  // the parent returns to this tab.
  useFocusRefetch(refetchOrder);
  // While the parent is watching the order page, poll every 30 s so
  // freshly-mirrored carrier scans appear without a manual reload. The
  // server-side getParentOrderDetailFromErp fires a throttled background
  // refresh from audit on each request, so the polling cycle is:
  //   client poll → server kicks audit refresh → response uses prev DB
  //                                              state → next poll picks
  //                                              up the new rows.
  // 30 s is the cap audit's own carrier-poll cadence aims for, so any
  // shorter interval would just burn requests for no extra freshness.
  useEffect(() => {
    const t = window.setInterval(() => {
      refetchOrder();
    }, 30_000);
    return () => window.clearInterval(t);
  }, [refetchOrder]);

  // While the order's payment is pending, ask the server to consult
  // CCAvenue's Status API on a back-off schedule. Stop on any terminal
  // state, on `finalized=true`, or after the schedule is exhausted —
  // CCAvenue auto-cancels at 5 days, but we don't want to keep an open
  // browser polling for hours.
  useEffect(() => {
    if (!order || order.payment?.status !== "pending") return;
    const delays = [0, 4_000, 8_000, 16_000, 30_000, 60_000, 120_000];
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const runStep = async (i: number) => {
      if (cancelled || i >= delays.length) {
        setPolling(false);
        return;
      }
      setPolling(true);
      try {
        const r = await fetch(`/api/checkout/ccavenue/status/${id}`, {
          method: "POST",
          cache: "no-store",
        });
        if (cancelled) return;
        if (r.ok) {
          const data = (await r.json()) as {
            status: "paid" | "failed" | "pending" | "unknown";
            finalized: boolean;
          };
          if (data.finalized || data.status === "paid" || data.status === "failed") {
            await refetchOrder();
            setPolling(false);
            return;
          }
        }
      } catch {
        // network blip — let the back-off carry on
      }
      const next = delays[i + 1];
      if (next == null) {
        setPolling(false);
        return;
      }
      timer = setTimeout(() => runStep(i + 1), next);
    };

    timer = setTimeout(() => runStep(1), delays[1]);
    // Fire the first attempt immediately so a parent who lands on the
    // page right after the redirect sees results without a 4 s delay.
    runStep(0);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, order?.payment?.status]);

  if (!loaded)
    return (
      <main className="min-h-screen">
        <Nav />
        <div className="mx-auto max-w-3xl px-5 py-16">
          <div className="h-32 rounded-2xl bg-white border border-ink-100 animate-pulse" />
        </div>
      </main>
    );

  if (!order)
    return (
      <main className="min-h-screen">
        <Nav />
        <div className="mx-auto max-w-2xl px-5 py-24 text-center">
          <h1 className="font-display text-3xl font-extrabold text-ink-900">
            Order not found
          </h1>
          <a
            href="/shop/orders"
            className="mt-6 inline-block text-brand font-semibold underline"
          >
            ← Back to orders
          </a>
        </div>
      </main>
    );

  const stageIdx = stages.indexOf(order.status as (typeof stages)[number]);

  return (
    <main className="min-h-screen">
      <Nav />
      <div className="mx-auto max-w-3xl px-5 lg:px-8 pt-8 pb-16">
        <a
          href="/shop/orders"
          className="inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-500 hover:text-ink-900"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> All orders
        </a>

        {isPlacedJustNow && (
          <div className="mt-4 flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
            <CheckCircle2 className="h-5 w-5 text-emerald-500" />
            <div>
              <p className="font-display text-[14px] font-bold text-emerald-900">
                Order placed
              </p>
              <p className="text-[12px] text-emerald-700">
                We&apos;ve sent confirmation to your phone. You can track this
                order any time on this page.
              </p>
            </div>
          </div>
        )}

        {/* Exchange status banner — renders nothing when there is no
            active exchange (which is always the case for non-allowlisted
            phones, since the API never returns `activeExchange` for them). */}
        <ExchangeStatusBanner orderId={id} activeExchange={activeExchange} />

        {/* Missing-item claim status banner — mirrors the exchange banner.
            Renders nothing when there is no active claim (always the case
            for non-allowlisted phones, since the API never returns
            `activeMissing` for them). */}
        <MissingStatusBanner orderId={id} activeMissing={activeMissing} />

        <div className="mt-6 flex items-end justify-between flex-wrap gap-3">
          <div>
            <p className="text-[12px] font-semibold tracking-[0.18em] uppercase text-brand">
              Order
            </p>
            <h1 className="mt-1 font-display text-[28px] sm:text-[34px] font-extrabold tracking-tight text-ink-900">
              {order.orderNumber}
            </h1>
            {order.studentName && (
              <p className="mt-1 text-[13px] font-semibold text-ink-800">
                For {order.studentName}
                {order.enrollment ? (
                  <span className="font-normal text-ink-500"> · {order.enrollment}</span>
                ) : null}
              </p>
            )}
            <p className="mt-1 text-[12px] text-ink-500">
              Placed{" "}
              {new Date(order.createdAt).toLocaleDateString("en-IN", {
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
            </p>
          </div>
          <span className="rounded-full bg-cream-200 px-3 py-1 text-[11px] font-bold tracking-wider uppercase text-ink-800">
            {order.status}
          </span>
        </div>

        {/* Per-category tracking. Each parcel-stream (Bookkit, Uniform, …)
            gets a self-contained card with: status badge, 5-step stepper,
            per-item progress, and the matching carrier shipment(s) with
            timeline. Audit drives the status text — "Out for Delivery" is
            preserved distinctly from generic "In Transit" so customers
            see the meaningful "your parcel is on the way today" beat.
            For orders with no category groups (audit hasn't classified
            yet) we fall back to a single order-level stepper. */}
        {(() => {
          const groups = order.categoryGroups ?? [];
          const allShipments = order.shipmentHistory ?? [];
          if (groups.length > 0) {
            return (
              <div className="mt-6 space-y-4">
                {order.pollPending && (
                  <p className="rounded-lg bg-cream-100 px-3 py-2 text-[12px] text-ink-600">
                    Tracking will appear within a few minutes — we&apos;re
                    syncing with the warehouse.
                  </p>
                )}
                {groups.map((g) => (
                  <CategoryTrackingCard
                    key={g.rootCategoryId ?? g.rootCategoryName}
                    group={g}
                    shipments={shipmentsForCategory(allShipments, g.rootCategoryName)}
                  />
                ))}
              </div>
            );
          }
          if (stageIdx >= 0) {
            return (
              <div className="mt-6 rounded-2xl border border-ink-100 bg-white p-5">
                <StageBar reachedIdx={stageIdx} />
              </div>
            );
          }
          return null;
        })()}

        {/* Items */}
        <div className="mt-6 rounded-2xl border border-ink-100 bg-white p-5 lg:p-6">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h3 className="font-display text-[16px] font-bold text-ink-900">
              Items
            </h3>
            {/* Order-level entry points — one click opens a multi-item
                picker that covers standalone items AND every kit/Magic
                Box component, mirroring the Magic Box workflow across
                the whole order. */}
            {(canExchange || canMissing) && (
              <div className="flex flex-wrap gap-2">
                {canExchange && (
                  <a
                    href={`/shop/orders/${id}/exchange/new`}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-ink-200 px-3 py-1.5 text-[12.5px] font-medium text-ink-700 hover:border-brand hover:text-brand"
                  >
                    Request exchange
                  </a>
                )}
                {canMissing && (
                  <a
                    href={`/shop/orders/${id}/missing/new`}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-ink-200 px-3 py-1.5 text-[12.5px] font-medium text-ink-700 hover:border-brand hover:text-brand"
                  >
                    Report missing
                  </a>
                )}
              </div>
            )}
          </div>
          <ul className="mt-4 space-y-3">
            {order.items.map((it) => (
              <li
                key={it.id}
                className="pb-3 border-b border-ink-100 last:border-b-0 last:pb-0"
              >
                <div className="flex gap-3">
                  <div className="h-14 w-14 shrink-0 rounded-lg bg-cream-100 border border-ink-100 overflow-hidden">
                    {it.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={it.imageUrl}
                        alt=""
                        className="h-full w-full object-contain p-1.5"
                      />
                    ) : null}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-ink-900 text-[14px] truncate">
                      {it.name}
                    </p>
                    <p className="text-[12px] text-ink-500">
                      {it.bundleSelections && it.bundleSelections.length > 0
                        ? `Magic Box · ${it.bundleSelections.length} items`
                        : it.size
                          ? `Size ${it.size}`
                          : ""}
                      {(it.bundleSelections && it.bundleSelections.length > 0) ||
                      it.size
                        ? " · "
                        : ""}
                      ×{it.qty}
                    </p>
                  </div>
                  <p className="font-semibold tabular-nums text-ink-900">
                    ₹{it.total.toLocaleString()}
                  </p>
                </div>
                {it.bundleSelections && it.bundleSelections.length > 0 && (
                  <div className="mt-2 rounded-lg border border-ink-100 bg-cream-50/60 px-3 py-2">
                    <p className="text-[10.5px] font-semibold uppercase tracking-wide text-ink-500 mb-1.5">
                      Box contents
                    </p>
                    <ul className="grid sm:grid-cols-2 gap-x-5 gap-y-1">
                      {it.bundleSelections.map((s) => {
                        const isMultiAxis =
                          s.attributes && s.attributes.length > 0;
                        return (
                          <li
                            key={s.variantId}
                            className="text-[12px] text-ink-600 grid grid-cols-[1fr_auto] gap-x-3 items-baseline"
                          >
                            <span className="text-ink-700 leading-snug truncate">
                              {s.name}
                              {s.qty > 1 ? ` ×${s.qty}` : ""}
                            </span>
                            {isMultiAxis ? (
                              <span className="font-semibold text-ink-800 text-right text-[11px] leading-snug">
                                {s.attributes
                                  .map((a) => a.value)
                                  .join(" · ")}
                              </span>
                            ) : (
                              <span className="font-mono font-semibold text-ink-800 text-right text-[11px]">
                                {s.size}
                              </span>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>

        {/* Shipment history — only renders shipments that did NOT match
            any category card above (orphans: ERP `item_category` missing
            or unknown, or packing-unit fallback rows with null category).
            For multi-category orders all the action happens inline in the
            per-category cards; this is just a safety net. */}
        {(() => {
          const all = order.shipmentHistory ?? [];
          if (all.length === 0) return null;
          const groups = order.categoryGroups ?? [];
          if (groups.length === 0) {
            // No category breakdown at all — show the full history so the
            // customer still sees their tracking.
            return <ShipmentHistory items={all} />;
          }
          const orphans = all.filter(
            (s) => !findGroupForShipment(s, groups)
          );
          if (orphans.length === 0) return null;
          return <ShipmentHistory items={orphans} />;
        })()}

        {/* Address + Totals */}
        <div className="mt-6 grid sm:grid-cols-2 gap-4">
          <div className="rounded-2xl border border-ink-100 bg-white p-5">
            <h3 className="font-display text-[14px] font-bold text-ink-900">
              Shipping to
            </h3>
            <div className="mt-2 text-[13px] text-ink-700 leading-relaxed whitespace-pre-line">
              <p className="font-semibold text-ink-900">
                {cleanAddrLine(order.shippingAddress.receiverName)}
              </p>
              <p>+91 {order.shippingAddress.receiverPhone}</p>
              <p className="mt-2">{cleanAddrLine(order.shippingAddress.line1)}</p>
              {order.shippingAddress.line2 && (
                <p>{cleanAddrLine(order.shippingAddress.line2)}</p>
              )}
              <p>
                {cleanAddrLine(order.shippingAddress.city)},{" "}
                {cleanAddrLine(order.shippingAddress.state)}{" "}
                {cleanAddrLine(order.shippingAddress.pincode)}
              </p>
            </div>
          </div>

          <div className="rounded-2xl border border-ink-100 bg-white p-5">
            <h3 className="font-display text-[14px] font-bold text-ink-900">
              Payment
            </h3>
            <dl className="mt-2 space-y-1.5 text-[13px]">
              <div className="flex justify-between">
                <dt className="text-ink-600">Subtotal</dt>
                <dd>₹{order.subtotal.toLocaleString()}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-600">Shipping</dt>
                <dd>{order.shipping ? `₹${order.shipping}` : "FREE"}</dd>
              </div>
              <div className="flex justify-between pt-2 border-t border-ink-100">
                <dt className="font-bold text-ink-900">Total</dt>
                <dd className="font-display font-extrabold text-ink-900">
                  ₹{order.total.toLocaleString()}
                </dd>
              </div>
              {order.payment && (
                <div className="pt-2 mt-2 border-t border-ink-100 text-[11px]">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-ink-500">
                      {order.payment.provider} ·{" "}
                      <span
                        className={
                          order.payment.status === "paid"
                            ? "text-emerald-700 font-semibold"
                            : order.payment.status === "failed"
                              ? "text-red-600 font-semibold"
                              : "text-ink-700 font-semibold"
                        }
                      >
                        {order.payment.status}
                      </span>
                    </span>
                    {polling && order.payment.status === "pending" && (
                      <span className="inline-flex items-center gap-1.5 text-ink-500">
                        <span className="inline-block h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
                        Checking with CCAvenue…
                      </span>
                    )}
                  </div>
                </div>
              )}
            </dl>
          </div>
        </div>
      </div>
      <Footer />
    </main>
  );
}

// ───────────── Stage-bar helpers (top-of-page progress stepper) ─────────────

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
function findGroupForShipment(
  shipment: ShipmentHistoryItem,
  groups: CategoryGroupForCard[]
): CategoryGroupForCard | null {
  const cat = (shipment.itemCategory ?? "").toLowerCase().trim();
  if (!cat) return null;
  return groups.find((g) => g.rootCategoryName.toLowerCase() === cat) ?? null;
}

/** Return the shipments whose `itemCategory` matches this group name. */
function shipmentsForCategory(
  shipments: ShipmentHistoryItem[],
  rootCategoryName: string
): ShipmentHistoryItem[] {
  const key = rootCategoryName.toLowerCase();
  return shipments.filter(
    (s) => (s.itemCategory ?? "").toLowerCase().trim() === key
  );
}

function StageBar({
  reachedIdx,
  accent = "brand",
}: {
  reachedIdx: number;
  accent?: "brand" | "emerald" | "rose";
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
              {s}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function CategoryTrackingCard({
  group,
  shipments,
}: {
  group: CategoryGroupForCard;
  shipments: ShipmentHistoryItem[];
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
  const counterText =
    group.status === "pending"
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
            {group.status}
          </span>
          <span className="text-[11.5px] font-semibold tabular-nums text-ink-500">
            {counterText}
          </span>
        </div>
      </div>
      <StageBar reachedIdx={idx} accent={accent} />

      {group.items.length > 0 && (
        <ul className="mt-4 space-y-1.5 border-t border-ink-100 pt-3">
          {group.items.map((it) => {
            const itCounter =
              group.status === "delivered"
                ? it.deliveredQty
                : group.status === "returned"
                  ? it.returnedQty
                  : group.status === "in transit" ||
                      group.status === "out for delivery"
                    ? Math.max(it.pickedQty, it.deliveredQty)
                    : 0;
            return (
              <li
                key={it.id}
                className="flex items-center justify-between text-[12.5px] text-ink-700"
              >
                <span className="truncate pr-3">{it.name}</span>
                <span className="shrink-0 tabular-nums text-ink-500">
                  {group.status === "pending"
                    ? `× ${it.qty}`
                    : `${itCounter} / ${it.qty} ${lineLabel}`}
                </span>
              </li>
            );
          })}
        </ul>
      )}

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
