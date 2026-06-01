"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { useFocusRefetch } from "@/lib/use-focus-refetch";
import { ArrowLeft, CheckCircle2, Package } from "lucide-react";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";

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
  categoryGroups?: {
    rootCategoryId: string | null;
    rootCategoryName: string;
    totalQty: number;
    deliveredQty: number;
    pickedQty: number;
    returnedQty: number;
    status: "delivered" | "in transit" | "returned" | "pending";
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

const CATEGORY_STATUS_CLASS: Record<
  "delivered" | "in transit" | "returned" | "pending",
  string
> = {
  delivered: "bg-emerald-100 text-emerald-800",
  "in transit": "bg-amber-100 text-amber-800",
  returned: "bg-rose-100 text-rose-800",
  pending: "bg-ink-100 text-ink-600",
};

const stages = ["placed", "confirmed", "packed", "shipped", "delivered"] as const;

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

  const refetchOrder = useCallback(
    () =>
      fetch(`/api/orders/${id}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => setOrder(d?.order ?? null)),
    [id]
  );

  useEffect(() => {
    refetchOrder().finally(() => setLoaded(true));
  }, [refetchOrder]);
  // Order status / tracking updates from admin should appear the moment
  // the parent returns to this tab.
  useFocusRefetch(refetchOrder);

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

        {/* Status timeline */}
        {stageIdx >= 0 && (
          <div className="mt-6 rounded-2xl border border-ink-100 bg-white p-5">
            <ol className="grid grid-cols-5">
              {stages.map((s, i) => {
                const reached = i <= stageIdx;
                const last = i === stages.length - 1;
                // segment to the next node is "filled" only if the next
                // node is also reached
                const segFilled = i < stageIdx;
                return (
                  <li
                    key={s}
                    className="relative flex flex-col items-center text-center"
                  >
                    {/* connector to the next stage */}
                    {!last && (
                      <span
                        className={
                          "absolute top-4 left-1/2 h-[3px] w-full -translate-y-1/2 " +
                          (segFilled ? "bg-brand" : "bg-ink-200")
                        }
                      />
                    )}
                    <span
                      className={
                        "relative z-10 grid h-8 w-8 place-items-center rounded-full border-2 " +
                        (reached
                          ? "bg-brand border-brand text-white"
                          : "bg-white border-ink-200 text-ink-400")
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
                        "relative z-10 mt-2 text-[10px] font-semibold tracking-wider uppercase " +
                        (reached ? "text-ink-900" : "text-ink-400")
                      }
                    >
                      {s}
                    </span>
                  </li>
                );
              })}
            </ol>
          </div>
        )}

        {/* Tracking by category */}
        {order.categoryGroups && order.categoryGroups.length > 0 && (
          <div className="mt-6 rounded-2xl border border-ink-100 bg-white p-5 lg:p-6">
            <h3 className="font-display text-[16px] font-bold text-ink-900">
              Tracking by category
            </h3>
            {order.pollPending && (
              <p className="mt-2 rounded-lg bg-cream-100 px-3 py-2 text-[12px] text-ink-600">
                Tracking will appear within a few minutes — we&apos;re syncing
                with the warehouse.
              </p>
            )}
            <ul className="mt-4 space-y-3">
              {order.categoryGroups.map((g) => {
                const pct =
                  g.totalQty > 0
                    ? Math.min(
                        100,
                        Math.round((g.deliveredQty / g.totalQty) * 100)
                      )
                    : 0;
                return (
                  <li
                    key={g.rootCategoryId ?? g.rootCategoryName}
                    className="rounded-xl border border-ink-100 bg-cream-50/40 p-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-semibold text-[14px] text-ink-900">
                        {g.rootCategoryName}
                      </p>
                      <span
                        className={
                          "rounded-full px-2.5 py-0.5 text-[10.5px] font-bold uppercase tracking-wider " +
                          CATEGORY_STATUS_CLASS[g.status]
                        }
                      >
                        {g.status}
                      </span>
                    </div>
                    <div className="mt-2 flex items-center gap-3">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink-100">
                        <div
                          className="h-full bg-brand"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <p className="shrink-0 text-[12px] tabular-nums text-ink-600">
                        {g.deliveredQty} / {g.totalQty} delivered
                      </p>
                    </div>
                    {(g.pickedQty > 0 || g.returnedQty > 0) && (
                      <p className="mt-1.5 text-[11.5px] text-ink-500">
                        {g.pickedQty > 0 ? `Picked ${g.pickedQty}` : ""}
                        {g.pickedQty > 0 && g.returnedQty > 0 ? " · " : ""}
                        {g.returnedQty > 0 ? `Returned ${g.returnedQty}` : ""}
                      </p>
                    )}
                    {g.items.length > 0 && (
                      <details className="mt-2">
                        <summary className="cursor-pointer text-[12px] font-medium text-brand hover:underline">
                          {g.items.length} item{g.items.length === 1 ? "" : "s"}
                        </summary>
                        <ul className="mt-2 space-y-1 pl-3">
                          {g.items.map((it) => (
                            <li
                              key={it.id}
                              className="flex items-center justify-between text-[12px] text-ink-700"
                            >
                              <span className="truncate pr-3">{it.name}</span>
                              <span className="shrink-0 tabular-nums text-ink-500">
                                {it.deliveredQty} / {it.qty}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {/* Items */}
        <div className="mt-6 rounded-2xl border border-ink-100 bg-white p-5 lg:p-6">
          <h3 className="font-display text-[16px] font-bold text-ink-900">
            Items
          </h3>
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

        {/* Tracking / shipments */}
        {order.tracking && order.tracking.length > 0 && (
          <div className="mt-6 rounded-2xl border border-ink-100 bg-white p-5 lg:p-6">
            <h3 className="font-display text-[16px] font-bold text-ink-900">
              Tracking
            </h3>
            <ol className="mt-5 relative">
              {order.tracking.map((t, i) => {
                const done = t.status === "delivered";
                const last = i === order.tracking!.length - 1;
                return (
                  <li key={i} className="relative pl-8 pb-7 last:pb-0">
                    {/* connecting line to the next node (both ends covered) */}
                    {!last && (
                      <span
                        className={
                          "absolute left-[10px] top-1 h-full w-[2px] " +
                          (done ? "bg-emerald-400" : "bg-ink-200")
                        }
                      />
                    )}
                    {/* node */}
                    <span
                      className={
                        "absolute left-0 top-0 grid h-[22px] w-[22px] place-items-center rounded-full border-2 " +
                        (done
                          ? "bg-emerald-500 border-emerald-500 text-white"
                          : "bg-white border-indigo-400 text-indigo-500")
                      }
                    >
                      {done ? (
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      ) : (
                        <Package className="h-3 w-3" />
                      )}
                    </span>

                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
                      <span className="font-semibold text-ink-900 uppercase">
                        {t.partner}
                      </span>
                      {t.trackingNumber && !t.trackingNumber.startsWith("syn:") && (
                        <span className="font-mono text-[12px] text-ink-700">
                          {t.trackingNumber}
                        </span>
                      )}
                      <span
                        className={
                          "text-[10px] font-bold tracking-wider uppercase rounded-full px-2 py-0.5 " +
                          (done
                            ? "bg-emerald-50 text-emerald-700"
                            : "bg-indigo-50 text-indigo-700")
                        }
                      >
                        {t.status}
                      </span>
                    </div>
                    <p className="mt-1 text-[12px] text-ink-500">
                      {[
                        t.dispatchedAt
                          ? `Dispatched ${new Date(t.dispatchedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}`
                          : null,
                        t.deliveredAt
                          ? `Delivered ${new Date(t.deliveredAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(" · ") || "—"}
                    </p>
                  </li>
                );
              })}
            </ol>
          </div>
        )}

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
