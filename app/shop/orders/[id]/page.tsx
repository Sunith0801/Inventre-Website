"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { useFocusRefetch } from "@/lib/use-focus-refetch";
import { derivePlacement, describePaymentStatus } from "@/lib/order-display";
import { ArrowLeft, CheckCircle2, Package } from "lucide-react";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { ExchangeStatusBanner } from "@/components/shop/orders/exchange/ExchangeStatusBanner";
import { MissingStatusBanner } from "@/components/shop/orders/missing/MissingStatusBanner";
import { RETURNS_WINDOW_DAYS, formatWindowDate, windowLastDay } from "@/lib/exchange-shared";
import { ShipmentHistory, type ShipmentHistoryItem } from "@/components/shop/orders/ShipmentHistory";
import { stages, type CategoryStatus, type OrderDetail } from "@/components/shop/orders/order-detail-types";
import { ItemStatusPill } from "@/components/shop/orders/ItemStatusPill";
import {
  CategoryTrackingCard,
  ItemsToggle,
  StageBar,
  findGroupForShipment,
  shipmentsForCategory,
} from "@/components/shop/orders/CategoryTrackingCard";

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
  // 7-day post-delivery request window (from the day the LAST item arrived).
  // `expiresAt` = exclusive cut-off; null while items are still on the way.
  const [returnsWindow, setReturnsWindow] = useState<{
    expiresAt: string | null;
    expired: boolean;
    allDelivered: boolean;
    extended?: boolean;
  } | null>(null);
  const [activeExchange, setActiveExchange] = useState<{
    id: string;
    returnNumber: string | null;
    status: string;
    pickupDate: string | null;
    createdAt: string;
    atStore?: boolean;
    rejectionReason?: string | null;
    duplicateOf?: unknown;
  } | null>(null);
  const [activeMissing, setActiveMissing] = useState<{
    id: string;
    claimNumber: string | null;
    status: string;
    pickupDate: string | null;
    createdAt: string;
    atStore?: boolean;
  } | null>(null);

  const refetchOrder = useCallback(
    () =>
      fetch(`/api/orders/${id}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          setOrder(d?.order ?? null);
          setCanExchange(Boolean(d?.canExchange));
          setCanMissing(Boolean(d?.canMissing));
          setReturnsWindow(d?.returnsWindow ?? null);
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

  // An order created but never paid for shows up as status='placed' — which
  // read as a real, progressing order and confused parents. Derive a clear
  // customer-facing state so an abandoned/failed checkout reads as
  // "Not placed" (no money charged) rather than "Placed".
  const placement = derivePlacement(order);
  const notPlaced = placement === "not_placed";
  const paymentProcessing = placement === "processing";
  // Actual CCAvenue status + its meaning (e.g. "Initiated" / "Aborted"), shown
  // on an abandoned checkout. Null when we can't identify the gateway word.
  const payInfo = describePaymentStatus(order.paymentStatusRaw);
  // Re-ordering is impossible when a one-per-student Magic Box is already
  // placed for this student — then we hide the "Place again" button.
  const canReorder = order.canReorder !== false;

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
          <span
            className={
              "rounded-full px-3 py-1 text-[11px] font-bold tracking-wider uppercase " +
              (notPlaced
                ? "bg-amber-100 text-amber-800"
                : paymentProcessing
                  ? "bg-blue-50 text-blue-700"
                  : "bg-cream-200 text-ink-800")
            }
          >
            {notPlaced ? "Not placed" : paymentProcessing ? "Processing" : order.status}
          </span>
        </div>

        {/* RTO (Return to Origin) — prominent badge + sub-timeline, shown
            whenever audit's carrier feed reports the parcel returning to
            origin. Sits above the normal tracking so it's the first thing the
            customer sees, instead of the truth being buried in the scan log. */}
        {order.rto && (order.rto.active || order.rto.delivered) && (
          <div className="mt-6 rounded-2xl border border-rose-200 bg-rose-50 p-4 sm:p-5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-rose-600 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-white">
                RTO
              </span>
              <span className="text-[13.5px] font-bold text-rose-900">
                {order.rto.delivered
                  ? "Returned to origin"
                  : "Return to origin in progress"}
              </span>
              {order.rto.stage && (
                <span className="ml-auto rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-rose-700 ring-1 ring-rose-200">
                  {order.rto.stage}
                </span>
              )}
            </div>
            <p className="mt-1.5 text-[12.5px] text-rose-700">
              {order.rto.delivered
                ? "This parcel could not be delivered and has been returned to the sender. Our team will reach out about a re-dispatch."
                : "The carrier is returning this parcel to the sender. We're tracking it and will update you on the next step."}
            </p>
            {order.rto.timeline.length > 0 && (
              <ol className="mt-3 space-y-2 border-t border-rose-200 pt-3">
                {[...order.rto.timeline].reverse().map((ev, i) => (
                  <li
                    key={i}
                    className="flex items-baseline gap-2.5 text-[12px]"
                  >
                    <span
                      className={
                        "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full " +
                        (i === 0 ? "bg-rose-600" : "bg-rose-300")
                      }
                    />
                    <span className="font-semibold text-rose-900">
                      {ev.label}
                    </span>
                    {ev.location && (
                      <span className="text-rose-600">· {ev.location}</span>
                    )}
                    <span className="ml-auto shrink-0 tabular-nums text-rose-500">
                      {new Date(ev.at).toLocaleString("en-IN", {
                        day: "2-digit",
                        month: "short",
                        hour: "numeric",
                        minute: "2-digit",
                        hour12: true,
                      })}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}

        {/* Per-category tracking. Each parcel-stream (Bookkit, Uniform, …)
            gets a self-contained card with: status badge, 5-step stepper,
            per-item progress, and the matching carrier shipment(s) with
            timeline. Audit drives the status text — "Out for Delivery" is
            preserved distinctly from generic "In Transit" so customers
            see the meaningful "your parcel is on the way today" beat.
            For orders with no category groups (audit hasn't classified
            yet) we fall back to a single order-level stepper. */}
        {(() => {
          // Abandoned / never-paid checkout: no fulfillment to track. Show a
          // plain reassurance + re-order CTA instead of a progress stepper
          // (which would imply the order is moving along).
          if (notPlaced) {
            return (
              <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-5">
                {/* Show the ACTUAL CCAvenue status word + its meaning when we
                    could identify it; otherwise fall back to a generic line. */}
                {payInfo ? (
                  <>
                    <p className="text-[11px] font-bold tracking-wider uppercase text-amber-700">
                      Payment status
                    </p>
                    <p className="mt-0.5 font-display text-[16px] font-bold text-amber-900">
                      {payInfo.statusWord}
                    </p>
                    <p className="mt-1.5 text-[13.5px] leading-relaxed text-amber-800">
                      {payInfo.description}
                    </p>
                  </>
                ) : (
                  <>
                    <p className="font-display text-[16px] font-bold text-amber-900">
                      This order hasn&apos;t been placed
                    </p>
                    <p className="mt-1.5 text-[13.5px] leading-relaxed text-amber-800">
                      You reached the payment page but the payment wasn&apos;t
                      completed — <b>no money was charged</b>.
                    </p>
                  </>
                )}
                {canReorder ? (
                  <a
                    href="/shop"
                    className="mt-3 inline-flex items-center justify-center rounded-full bg-ink-900 px-5 py-2.5 text-[13px] font-bold text-white transition-colors hover:bg-brand"
                  >
                    Place the order again
                  </a>
                ) : (
                  <p className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-semibold text-emerald-700">
                    <CheckCircle2 className="h-4 w-4" />
                    You&apos;ve already placed this order
                    {order.studentName ? ` for ${order.studentName}` : ""}.
                  </p>
                )}
              </div>
            );
          }
          const groups = order.categoryGroups ?? [];
          const allShipments = order.shipmentHistory ?? [];
          // Group Magic Box components by their shipment category so each
          // tracking card can list its own components with per-item status.
          const compByCat = new Map<
            string,
            {
              name: string;
              size: string;
              qty: number;
              attributes?: { name: string; value: string }[];
              status?: CategoryStatus | null;
            }[]
          >();
          for (const it of order.items) {
            for (const c of it.bundleSelections ?? []) {
              const key = (c.category ?? "").toLowerCase();
              if (!key) continue;
              const arr = compByCat.get(key) ?? [];
              arr.push({
                name: c.name,
                size: c.size,
                qty: c.qty,
                attributes: c.attributes,
                status: c.status ?? null,
              });
              compByCat.set(key, arr);
            }
          }
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
                    components={compByCat.get(g.rootCategoryName.toLowerCase())}
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
          {returnsWindow?.expiresAt && (
            <p className="mt-2 text-[12.5px] text-ink-500">
              {returnsWindow.expired
                ? `Exchange / missing-item requests closed on ${formatWindowDate(windowLastDay(returnsWindow.expiresAt))} (${RETURNS_WINDOW_DAYS} days from delivery).`
                : returnsWindow.extended
                  ? `Exchange / missing-item requests are open for this order (the usual ${RETURNS_WINDOW_DAYS}-day period ended on ${formatWindowDate(windowLastDay(returnsWindow.expiresAt))}).`
                  : `Exchange / missing-item requests can be raised until ${formatWindowDate(windowLastDay(returnsWindow.expiresAt))} (${RETURNS_WINDOW_DAYS} days from delivery).`}
            </p>
          )}
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
                      {(() => {
                        // Magic Box → item count. Plain line → prefer the
                        // resolved per-axis attributes (Colour · Size); fall
                        // back to the bare size when a variant has no attribute
                        // rows (legacy items).
                        const isBox =
                          it.bundleSelections && it.bundleSelections.length > 0;
                        const attrLabel =
                          it.attributes && it.attributes.length > 0
                            ? it.attributes.map((a) => a.value).join(" · ")
                            : it.size
                              ? `Size ${it.size}`
                              : "";
                        const lead = isBox
                          ? `Magic Box · ${it.bundleSelections!.length} items`
                          : attrLabel;
                        return (
                          <>
                            {lead}
                            {lead ? " · " : ""}×{it.qty}
                          </>
                        );
                      })()}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <ItemStatusPill status={it.status} />
                    <p className="font-semibold tabular-nums text-ink-900">
                      ₹{it.total.toLocaleString()}
                    </p>
                  </div>
                </div>
                {it.bundleSelections && it.bundleSelections.length > 0 && (
                  /* Collapsed by default — a 35-component Magic Box otherwise
                     buries the rest of the page. <details> keeps it keyboard-
                     and screen-reader-accessible with no client state. */
                  <details className="group mt-3">
                    <ItemsToggle
                      count={it.bundleSelections.length}
                      noun="box item"
                    />
                    <ul className="mt-2 grid sm:grid-cols-2 gap-x-5 gap-y-1 rounded-lg border border-ink-100 bg-cream-50/60 px-3 py-2">
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
                            <span className="flex items-center justify-end gap-1.5">
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
                              <ItemStatusPill status={s.status} />
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </details>
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
            </dl>
              {order.payment && (
                <div className="pt-2 mt-2 border-t border-ink-100 text-[11px]">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-ink-500">
                      Payment{" "}
                      <span
                        className={
                          order.payment.status === "paid"
                            ? "text-emerald-700 font-semibold"
                            : order.payment.status === "failed" || notPlaced
                              ? "text-amber-700 font-semibold"
                              : "text-ink-700 font-semibold"
                        }
                      >
                        {order.payment.status === "paid"
                          ? "Paid"
                          : notPlaced
                            ? (payInfo?.statusWord ?? "Not completed")
                            : order.payment.status === "failed"
                              ? (payInfo?.statusWord ?? "Not completed")
                              : paymentProcessing
                                ? "Processing"
                                : order.payment.status}
                      </span>
                    </span>
                    {/* Only show the live poll while a fresh payment might
                        still settle — never on an abandoned "Not placed"
                        order, where nothing is coming. */}
                    {polling && paymentProcessing && (
                      <span className="inline-flex items-center gap-1.5 text-ink-500">
                        <span className="inline-block h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
                        Checking for your payment…
                      </span>
                    )}
                  </div>
                </div>
              )}
          </div>
        </div>
      </div>
      <Footer />
    </main>
  );
}

// ───────────── Stage-bar helpers (top-of-page progress stepper) ─────────────

