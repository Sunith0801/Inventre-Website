"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Minus, Plus, Trash2, ShoppingBag, ArrowRight, ArrowLeft, Tag, Clock } from "lucide-react";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { useCart } from "@/lib/cart";
import { useFocusRefetch } from "@/lib/use-focus-refetch";

type AppliedCoupon = {
  code: string;
  name: string;
  discountType: "Fixed" | "Percentage";
  discount: number;
  maximumDiscountAmount: number;
};

/** Mirror the server's discount math so the summary panel and the apply
 *  response agree. Fixed = flat rupees off; Percentage = % of subtotal
 *  capped at maximumDiscountAmount (0 = uncapped). Never exceeds subtotal. */
function computeDiscount(subtotal: number, c: AppliedCoupon | null): number {
  if (!c) return 0;
  let d = 0;
  if (c.discountType === "Fixed") d = c.discount;
  else {
    d = Math.round((subtotal * c.discount) / 100);
    if (c.maximumDiscountAmount > 0) d = Math.min(d, c.maximumDiscountAmount);
  }
  return Math.max(0, Math.min(d, subtotal));
}

function CouponInput({
  applied,
  setApplied,
}: {
  applied: AppliedCoupon | null;
  setApplied: (c: AppliedCoupon | null) => void;
}) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const apply = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/cart/apply-coupon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await r.json();
      if (!r.ok) setError(data.error ?? "Invalid code");
      else
        setApplied({
          code: data.code,
          name: data.name,
          discountType: data.discountType,
          discount: Number(data.discount),
          maximumDiscountAmount: Number(data.maximumDiscountAmount ?? 0),
        });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    await fetch("/api/cart/apply-coupon", { method: "DELETE" });
    setApplied(null);
    setCode("");
  };

  return (
    <div className="mt-4 pt-4 border-t border-ink-100">
      {applied ? (
        <div className="flex items-center justify-between text-[13px]">
          <span className="flex items-center gap-2 text-emerald-700">
            <Tag className="h-4 w-4" />
            <span className="font-semibold">{applied.code}</span> applied
          </span>
          <button onClick={remove} className="text-ink-500 hover:text-ink-900 underline text-xs">
            Remove
          </button>
        </div>
      ) : (
        <>
          <div className="flex gap-2">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="Coupon code"
              className="flex-1 px-3 py-2 border rounded-lg text-[13px]"
            />
            <button
              onClick={apply}
              disabled={busy || !code}
              className="px-4 py-2 bg-ink-900 text-white text-[13px] rounded-lg disabled:opacity-50"
            >
              {busy ? "Applying…" : "Apply"}
            </button>
          </div>
          {error ? <div className="text-red-600 text-xs mt-1">{error}</div> : null}
        </>
      )}
    </div>
  );
}

export default function CartPage() {
  const { lines, byStudent, count, total, loading, revision, setQty, refresh } = useCart();
  const router = useRouter();
  const [lineErrors, setLineErrors] = useState<Map<string, string>>(new Map());
  const [applied, setApplied] = useState<AppliedCoupon | null>(null);
  const [shippingP, setShippingP] = useState<number | null>(null);

  // Restore the applied-coupon badge on page load — the code lives in Redis
  // under the parent's session; this is the only way the UI knows about it.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch("/api/cart/apply-coupon");
        if (!r.ok) return;
        const d = await r.json();
        if (alive && d.applied)
          setApplied({
            code: d.applied.code,
            name: d.applied.name,
            discountType: d.applied.discountType,
            discount: Number(d.applied.discount),
            maximumDiscountAmount: Number(d.applied.maximumDiscountAmount ?? 0),
          });
      } catch {}
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Pull the school-scoped shipping fee from ERPNext Delivery Fee Rules so
  // the cart preview agrees with the checkout calculation. While the cart
  // is still loading we hold shippingP at null so the UI shows "—" instead
  // of briefly flashing FREE before the fetched fee replaces it.
  const fetchShipping = useCallback(async () => {
    if (loading) return;
    if (lines.length === 0) {
      setShippingP(0);
      return;
    }
    try {
      const r = await fetch("/api/cart/shipping", { cache: "no-store" });
      if (!r.ok) return;
      const d = await r.json();
      setShippingP(Number(d.shippingPaise) || 0);
    } catch {}
  }, [loading, lines.length]);

  useEffect(() => {
    void fetchShipping();
    // Re-run on every confirmed server sync (revision bump) so removing
    // an item refetches the fee *after* the PATCH lands — not from the
    // optimistic snapshot, which still matches the pre-PATCH server state.
  }, [fetchShipping, revision]);

  // Live shipping + cart contents on tab focus — admin edits (rule changes,
  // price updates, BOM tweaks) appear the moment the parent returns.
  const refetchOnFocus = useCallback(async () => {
    await refresh();
    await fetchShipping();
  }, [refresh, fetchShipping]);
  useFocusRefetch(refetchOnFocus, !loading);

  const discount = computeDiscount(total, applied);
  const shippingR = Math.round((shippingP ?? 0) / 100);
  const grandTotal = Math.max(0, total - discount) + shippingR;

  function setLineError(variantId: string, error: string | null) {
    setLineErrors((prev) => {
      const next = new Map(prev);
      if (error) next.set(variantId, error);
      else next.delete(variantId);
      return next;
    });
  }

  return (
    <main className="min-h-screen">
      <Nav />
      <div className="mx-auto max-w-7xl px-5 lg:px-8 pt-8 pb-16">
        <a
          href="/shop"
          className="inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-500 hover:text-ink-900 transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Continue shopping
        </a>
        <h1 className="mt-4 font-display text-[34px] sm:text-[42px] font-extrabold tracking-tight text-ink-900">
          Your cart
        </h1>
        <p className="mt-1 text-[14px] text-ink-500">
          {loading ? "Loading…" : `${count} ${count === 1 ? "item" : "items"}`}
        </p>

        {!loading && lines.length === 0 ? (
          <div className="mt-10 rounded-2xl border border-dashed border-ink-200 bg-white p-16 text-center">
            <div className="mx-auto h-12 w-12 rounded-full bg-cream-100 grid place-items-center text-ink-500">
              <ShoppingBag className="h-5 w-5" />
            </div>
            <h2 className="mt-4 font-display text-[20px] font-bold text-ink-900">
              Your cart is empty
            </h2>
            <p className="mt-1 text-[14px] text-ink-500">
              Browse the kit and add what your child needs.
            </p>
            <a
              href="/shop"
              className="mt-5 inline-flex items-center justify-center rounded-full bg-ink-900 text-white px-5 h-11 text-[13px] font-semibold hover:bg-brand transition-colors"
            >
              Go to shop
            </a>
          </div>
        ) : (
          <div className="mt-8 grid lg:grid-cols-[1fr_360px] gap-6 lg:gap-10">
            {/* lines — grouped by sibling when the cart spans more than one
                 student. Single-student carts render flat (no header). */}
            <div className="space-y-6">
              {(byStudent.length > 1 ? byStudent : [{
                studentId: null,
                studentName: null,
                schoolName: null,
                gradeLabel: null,
                lines,
                subtotal: total,
                count,
              }]).map((group) => (
                <section key={group.studentId ?? "_all"} className="space-y-3">
                  {byStudent.length > 1 && (
                    <header className="flex items-end justify-between gap-3 px-1">
                      <div>
                        <p className="font-display text-[16px] font-extrabold text-ink-900">
                          {group.studentName ?? "Unassigned items"}
                        </p>
                        <p className="text-[12px] text-ink-500">
                          {group.schoolName ?? ""}
                          {group.schoolName && group.gradeLabel ? " · " : ""}
                          {group.gradeLabel ?? ""}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-[11px] uppercase tracking-wider text-ink-400 font-semibold">
                          Subtotal
                        </p>
                        <p className="font-display text-[15px] font-bold text-ink-900">
                          ₹{group.subtotal.toLocaleString()}
                        </p>
                      </div>
                    </header>
                  )}
                  <ul className="space-y-3">
                    {group.lines.map((l) => (
                <li
                  key={l.variantId}
                  className="rounded-2xl border border-ink-100 bg-white p-4 flex gap-4"
                >
                  <div className="h-24 w-24 sm:h-28 sm:w-28 shrink-0 rounded-xl bg-cream-100 border border-ink-100 overflow-hidden">
                    {l.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={l.imageUrl}
                        alt={l.productName}
                        className="h-full w-full object-contain p-2"
                      />
                    ) : null}
                  </div>
                  <div className="flex-1 min-w-0 flex flex-col">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <a
                          href={`/shop/${l.productSlug}`}
                          className="font-display text-[15px] font-semibold text-ink-900 hover:text-brand transition-colors block truncate"
                        >
                          {l.productName}
                        </a>
                        {l.bundleSelections && l.bundleSelections.length > 0 ? (
                          <p className="mt-0.5 text-[12px] text-ink-500">
                            Magic Box ·{" "}
                            <span className="font-semibold text-ink-800">
                              {l.bundleSelections.length} items configured
                            </span>
                          </p>
                        ) : l.attributes && l.attributes.length > 0 ? (
                          // Multi-axis Item-Variant SKU — render each picked
                          // attribute (e.g. "Core Subject · Commerce") instead
                          // of the unreadable concatenated SKU `size` string.
                          <div className="mt-0.5 space-y-0.5 text-[12px] text-ink-500">
                            {l.attributes.map((a) => (
                              <p key={a.name}>
                                {a.name.replace(/^SMS Grade \d+ /, "")} ·{" "}
                                <span className="font-semibold text-ink-800">
                                  {a.value}
                                </span>
                              </p>
                            ))}
                          </div>
                        ) : (
                          <p className="mt-0.5 text-[12px] text-ink-500">
                            Size ·{" "}
                            <span className="font-mono font-semibold text-ink-800">
                              {l.size}
                            </span>
                          </p>
                        )}
                      </div>
                      <button
                        onClick={() => setQty(l.variantId, 0)}
                        aria-label="Remove"
                        className="grid h-8 w-8 place-items-center rounded-full text-ink-500 hover:text-red-500 hover:bg-red-50 transition-colors"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                    <div className="mt-auto pt-3 flex flex-col gap-1.5">
                      <div className="flex items-center justify-between">
                        <div className="inline-flex items-center rounded-full border border-ink-200 bg-white">
                          <button
                            onClick={async () => {
                              const r = await setQty(l.variantId, Math.max(0, l.qty - 1));
                              if (r.ok) setLineError(l.variantId, null);
                            }}
                            aria-label="Decrease"
                            className="grid h-8 w-8 place-items-center text-ink-700 hover:text-brand"
                          >
                            <Minus className="h-3.5 w-3.5" />
                          </button>
                          <span className="w-7 text-center font-semibold tabular-nums text-[13px]">
                            {l.qty}
                          </span>
                          <button
                            onClick={async () => {
                              const r = await setQty(l.variantId, l.qty + 1);
                              if (!r.ok && r.error) setLineError(l.variantId, r.error);
                              else setLineError(l.variantId, null);
                            }}
                            aria-label="Increase"
                            disabled={l.qty >= Math.min(20, l.stockLeft)}
                            className="grid h-8 w-8 place-items-center text-ink-700 hover:text-brand disabled:text-ink-300"
                          >
                            <Plus className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        <p className="font-display text-[16px] font-bold text-ink-900">
                          ₹{(l.unitPrice * l.qty).toLocaleString()}
                        </p>
                      </div>
                      {lineErrors.get(l.variantId) && (
                        <p className="text-[14px] font-semibold text-red-600 leading-snug">
                          {lineErrors.get(l.variantId)}
                        </p>
                      )}
                    </div>

                    {l.bundleSelections && l.bundleSelections.length > 0 && (
                      <div className="mt-3 rounded-xl border border-ink-100 bg-cream-50/60 px-3 py-2.5">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-500 mb-2">
                          Box contents
                        </p>
                        <ul className="grid sm:grid-cols-2 gap-x-5 gap-y-2">
                          {l.bundleSelections.map((s) => {
                            // Multi-axis items (Uniform Colour × Size,
                            // Item-Variant bookkits with 2nd Language, etc.)
                            // have attribute rows. Their `size` is the
                            // unreadable concatenated SKU, so we render the
                            // attribute values joined with " · " instead.
                            const isMultiAxis =
                              s.attributes && s.attributes.length > 0;
                            return (
                              <li
                                key={s.variantId}
                                className="text-[12px] text-ink-600 grid grid-cols-[1fr_auto] gap-x-3 items-baseline"
                              >
                                <span className="text-ink-700 leading-snug">
                                  {s.name}
                                  {s.qty > 1 ? ` ×${s.qty}` : ""}
                                </span>
                                {isMultiAxis ? (
                                  <span className="font-semibold text-ink-800 text-right text-[11px] leading-snug">
                                    {s.attributes!
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
                  </div>
                </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>

            {/* summary */}
            <aside className="lg:sticky lg:top-28 lg:self-start">
              <div className="rounded-2xl border border-ink-100 bg-white p-6">
                <h3 className="font-display text-[16px] font-bold text-ink-900">
                  Order summary
                </h3>
                <dl className="mt-4 space-y-2 text-[14px]">
                  <div className="flex justify-between">
                    <dt className="text-ink-600">Subtotal</dt>
                    <dd className="font-semibold text-ink-900">
                      ₹{total.toLocaleString()}
                    </dd>
                  </div>
                  {applied && discount > 0 ? (
                    <div className="flex justify-between">
                      <dt className="text-ink-600 inline-flex items-center gap-1.5">
                        <Tag className="h-3.5 w-3.5 text-emerald-600" />
                        Discount
                        <span className="text-[11px] text-ink-400 font-mono">
                          {applied.code}
                        </span>
                      </dt>
                      <dd className="font-semibold text-emerald-700">
                        − ₹{discount.toLocaleString()}
                      </dd>
                    </div>
                  ) : null}
                  <div className="flex justify-between">
                    <dt className="text-ink-600">Shipping</dt>
                    <dd
                      className={
                        shippingR > 0
                          ? "font-semibold text-ink-900"
                          : "font-semibold text-emerald-600"
                      }
                    >
                      {shippingP == null
                        ? "—"
                        : shippingR > 0
                          ? `₹${shippingR.toLocaleString()}`
                          : "FREE"}
                    </dd>
                  </div>
                  <div className="flex justify-between pt-3 border-t border-ink-100">
                    <dt className="font-display text-[15px] font-bold text-ink-900">
                      Total
                    </dt>
                    <dd className="font-display text-[20px] font-extrabold text-ink-900">
                      ₹{grandTotal.toLocaleString()}
                    </dd>
                  </div>
                </dl>

                <CouponInput applied={applied} setApplied={setApplied} />

                <button
                  onClick={() => router.push("/shop/checkout")}
                  disabled={lines.length === 0}
                  className="mt-5 w-full inline-flex items-center justify-center gap-2 rounded-full bg-brand text-white h-12 text-[14px] font-bold hover:bg-brand-600 transition-colors disabled:opacity-50"
                >
                  Proceed to checkout
                  <ArrowRight className="h-4 w-4" />
                </button>
                <div className="mt-3 flex items-start gap-2 rounded-lg bg-cream-100 px-3 py-2.5 text-[11px] text-ink-600 leading-snug">
                  <Clock className="h-3.5 w-3.5 mt-0.5 text-ink-400 shrink-0" />
                  <span>
                    Your cart is saved on your account for <strong className="font-semibold text-ink-800">7 days</strong>. Sign in on any device to pick up where you left off.
                  </span>
                </div>
                <p className="mt-3 text-[11px] text-ink-500 text-center">
                  Free 7-day returns. Branded by your school.
                </p>
              </div>
            </aside>
          </div>
        )}
      </div>
      <Footer />
    </main>
  );
}
