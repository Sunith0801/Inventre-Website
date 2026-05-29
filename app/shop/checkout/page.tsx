"use client";

import { useCallback, useEffect, useState } from "react";
import { useFocusRefetch } from "@/lib/use-focus-refetch";
import { useRouter } from "next/navigation";
import { ArrowLeft, ShieldCheck, Lock, AlertTriangle, Info } from "lucide-react";
import { Nav } from "@/components/Nav";
import { useCart } from "@/lib/cart";
import { auth, type Me } from "@/lib/auth";

type Address = {
  receiverName: string;
  receiverPhone: string;
  line1: string;
  line2?: string;
  city: string;
  state: string;
  pincode: string;
};

type AppliedCoupon = {
  code: string;
  discountType: "Fixed" | "Percentage";
  discount: number;
  maximumDiscountAmount: number;
};

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

export default function CheckoutPage() {
  const { lines, total, count } = useCart();
  const router = useRouter();
  const [me, setMe] = useState<Me>(null);
  const [applied, setApplied] = useState<AppliedCoupon | null>(null);
  const [address, setAddress] = useState<Address>({
    receiverName: "",
    receiverPhone: "",
    line1: "",
    line2: "",
    city: "",
    state: "",
    pincode: "",
  });
  const [savedAddresses, setSavedAddresses] = useState<
    (Address & { id: string; label: string | null; isDefault: boolean })[]
  >([]);
  const [saveForNextTime, setSaveForNextTime] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shippingP, setShippingP] = useState<number | null>(null);
  // Required client-side acknowledgement of the payment-gateway fee +
  // GST schedule. The Pay button stays disabled until ticked, and we
  // re-check on submit before kicking off the CCAvenue redirect.
  const [feesAcknowledged, setFeesAcknowledged] = useState(false);

  const fetchShipping = useCallback(async () => {
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
  }, [lines.length]);
  useEffect(() => {
    void fetchShipping();
  }, [fetchShipping, total]);
  // Pick up admin Delivery Fee Rule edits the moment the tab regains focus.
  useFocusRefetch(fetchShipping);
  useEffect(() => {
    fetch("/api/cart/apply-coupon")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.applied)
          setApplied({
            code: d.applied.code,
            discountType: d.applied.discountType,
            discount: Number(d.applied.discount),
            maximumDiscountAmount: Number(d.applied.maximumDiscountAmount ?? 0),
          });
      })
      .catch(() => {});
    auth.me().then((u) => {
      if (u?.kind === "parent") {
        setAddress((a) => ({
          ...a,
          receiverName: u.name ?? "",
          receiverPhone: u.phone,
        }));
      }
    });
    fetch("/api/addresses", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d?.addresses) return;
        setSavedAddresses(d.addresses);
        const def = d.addresses.find(
          (a: { isDefault: boolean }) => a.isDefault
        );
        const pick = def ?? d.addresses[0];
        if (pick) {
          setAddress({
            receiverName: pick.receiverName,
            receiverPhone: pick.receiverPhone,
            line1: pick.line1,
            line2: pick.line2 ?? "",
            city: pick.city,
            state: pick.state,
            pincode: pick.pincode,
          });
          setSaveForNextTime(false); // already saved
        }
      });
  }, []);

  const place = async () => {
    setError(null);
    if (count === 0) {
      router.push("/shop/cart");
      return;
    }
    // basic client validation
    for (const k of [
      "receiverName",
      "receiverPhone",
      "line1",
      "city",
      "state",
      "pincode",
    ] as const) {
      if (!address[k]) {
        setError("Please complete the delivery address");
        return;
      }
    }
    if (!/^\d{10}$/.test(address.receiverPhone)) {
      setError("Phone number must be 10 digits");
      return;
    }
    if (!/^\d{6}$/.test(address.pincode)) {
      setError("Pincode must be 6 digits");
      return;
    }
    if (!feesAcknowledged) {
      setError("Please acknowledge the payment-gateway fee & GST schedule to continue.");
      return;
    }

    setSubmitting(true);
    try {
      // Save address for next time (best-effort, non-blocking)
      if (saveForNextTime) {
        void fetch("/api/addresses", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...address,
            isDefault: savedAddresses.length === 0,
          }),
        });
      }

      // CCAvenue's flow is a server-side encrypted form POST to their hosted
      // page. We get back the action URL + encrypted payload, build a hidden
      // form, and submit it — the browser is then carried to CCAvenue.
      const res = await fetch("/api/checkout/ccavenue/create-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? "Could not start CCAvenue checkout");
      }
      const d: {
        orderId: string;
        orderNumber: string;
        actionUrl?: string;
        encRequest?: string;
        accessCode?: string;
        complimentary?: boolean;
        redirectTo?: string;
      } = await res.json();
      // Zero-value baskets are confirmed server-side without touching
      // CCAvenue (the gateway can't process ₹0). The response carries
      // a `complimentary` flag and a direct redirect to the success
      // page — short-circuit the form-post entirely.
      if (d.complimentary && d.redirectTo) {
        window.location.href = d.redirectTo;
        return;
      }
      const form = document.createElement("form");
      form.method = "POST";
      form.action = d.actionUrl!;
      form.style.display = "none";
      const fields: Record<string, string> = {
        encRequest: d.encRequest!,
        access_code: d.accessCode!,
      };
      for (const [name, value] of Object.entries(fields)) {
        const input = document.createElement("input");
        input.type = "hidden";
        input.name = name;
        input.value = value;
        form.appendChild(input);
      }
      document.body.appendChild(form);
      form.submit();
      // Browser navigates to CCAvenue from here.
    } catch (e) {
      setError(e instanceof Error ? e.message : "Checkout failed");
      setSubmitting(false);
    }
  };

  return (
    <>
      <main className="min-h-screen">
        <Nav />
        <div className="mx-auto max-w-5xl px-5 lg:px-8 pt-8 pb-16">
          <a
            href="/shop/cart"
            className="inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-500 hover:text-ink-900 transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back to cart
          </a>
          <h1 className="mt-4 font-display text-[34px] sm:text-[42px] font-extrabold tracking-tight text-ink-900">
            Checkout
          </h1>

          <div className="mt-8 grid lg:grid-cols-[1fr_360px] gap-8">
            {/* Address form */}
            <div className="rounded-2xl border border-ink-100 bg-white p-6 lg:p-8">
              <h2 className="font-display text-[18px] font-bold text-ink-900">
                Delivery address
              </h2>
              <p className="mt-1 text-[13px] text-ink-500">
                We&apos;ll deliver to your home before term begins.
              </p>

              {savedAddresses.length > 0 && (
                <div className="mt-5 flex flex-wrap gap-2">
                  {savedAddresses.map((a) => {
                    const matches =
                      address.line1 === a.line1 && address.pincode === a.pincode;
                    return (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => {
                          setAddress({
                            receiverName: a.receiverName,
                            receiverPhone: a.receiverPhone,
                            line1: a.line1,
                            line2: a.line2 ?? "",
                            city: a.city,
                            state: a.state,
                            pincode: a.pincode,
                          });
                          setSaveForNextTime(false);
                        }}
                        className={
                          "rounded-2xl border px-4 py-3 text-left transition-colors " +
                          (matches
                            ? "border-brand bg-brand-50"
                            : "border-ink-200 bg-white hover:border-ink-400")
                        }
                      >
                        <p className="text-[12px] font-bold tracking-wider uppercase text-ink-500">
                          {a.label ?? (a.isDefault ? "Default" : "Saved")}
                        </p>
                        <p className="mt-1 text-[13px] font-semibold text-ink-900">
                          {a.receiverName}
                        </p>
                        <p className="text-[12px] text-ink-600 line-clamp-1">
                          {a.line1}, {a.city} {a.pincode}
                        </p>
                      </button>
                    );
                  })}
                </div>
              )}

              <div className="mt-6 grid sm:grid-cols-2 gap-4">
                <Field
                  label="Receiver name"
                  value={address.receiverName}
                  onChange={(v) => setAddress({ ...address, receiverName: v })}
                />
                <Field
                  label="Phone (10 digits)"
                  value={address.receiverPhone}
                  onChange={(v) =>
                    setAddress({
                      ...address,
                      receiverPhone: v.replace(/\D/g, "").slice(0, 10),
                    })
                  }
                  inputMode="numeric"
                />
                <Field
                  label="Address line 1"
                  value={address.line1}
                  onChange={(v) => setAddress({ ...address, line1: v })}
                  className="sm:col-span-2"
                />
                <Field
                  label="Address line 2 (optional)"
                  value={address.line2 ?? ""}
                  onChange={(v) => setAddress({ ...address, line2: v })}
                  className="sm:col-span-2"
                />
                <Field
                  label="City"
                  value={address.city}
                  onChange={(v) => setAddress({ ...address, city: v })}
                />
                <Field
                  label="State"
                  value={address.state}
                  onChange={(v) => setAddress({ ...address, state: v })}
                />
                <Field
                  label="Pincode (6 digits)"
                  value={address.pincode}
                  onChange={(v) =>
                    setAddress({
                      ...address,
                      pincode: v.replace(/\D/g, "").slice(0, 6),
                    })
                  }
                  inputMode="numeric"
                />
              </div>

              <label className="mt-4 flex items-center gap-2 text-[13px] text-ink-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={saveForNextTime}
                  onChange={(e) => setSaveForNextTime(e.target.checked)}
                  className="h-4 w-4 accent-brand"
                />
                Save this address for next time
              </label>

              {error && (
                <div className="mt-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}
            </div>

            {/* Order summary */}
            <aside className="lg:sticky lg:top-28 lg:self-start">
              <div className="rounded-2xl border border-ink-100 bg-white p-6">
                <h3 className="font-display text-[16px] font-bold text-ink-900">
                  Order ({count} {count === 1 ? "item" : "items"})
                </h3>
                <ul className="mt-4 space-y-3 max-h-72 overflow-auto pr-1">
                  {lines.map((l) => (
                    <li key={l.variantId} className="text-[13px]">
                      <div className="flex gap-3">
                        <div className="h-12 w-12 shrink-0 rounded-md bg-cream-100 border border-ink-100 overflow-hidden">
                          {l.imageUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={l.imageUrl}
                              alt=""
                              className="h-full w-full object-contain p-1"
                            />
                          ) : null}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-ink-900 truncate">
                            {l.productName}
                          </p>
                          <p className="text-[12px] text-ink-500">
                            {l.bundleSelections && l.bundleSelections.length > 0
                              ? `Magic Box · ${l.bundleSelections.length} items`
                              : l.attributes && l.attributes.length > 0
                                ? l.attributes.map((a) => a.value).join(" · ")
                                : l.size}
                            {" · "}×{l.qty}
                          </p>
                        </div>
                        <p className="font-semibold text-ink-900 tabular-nums">
                          ₹{(l.unitPrice * l.qty).toLocaleString()}
                        </p>
                      </div>
                      {l.bundleSelections && l.bundleSelections.length > 0 && (
                        <ul className="mt-2 ml-15 rounded-lg border border-ink-100 bg-cream-50/70 px-3 py-2 space-y-0.5 text-[11.5px] text-ink-600">
                          {l.bundleSelections.map((s) => {
                            const isMultiAxis =
                              s.attributes && s.attributes.length > 0;
                            return (
                              <li
                                key={s.variantId}
                                className="flex justify-between gap-3"
                              >
                                <span className="truncate">
                                  {s.name}
                                  {s.qty > 1 ? ` ×${s.qty}` : ""}
                                </span>
                                {isMultiAxis ? (
                                  <span className="font-semibold text-ink-800 shrink-0 text-right">
                                    {s.attributes!
                                      .map((a) => a.value)
                                      .join(" · ")}
                                  </span>
                                ) : (
                                  <span className="font-mono font-semibold text-ink-800 shrink-0">
                                    {s.size}
                                  </span>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </li>
                  ))}
                </ul>

                {(() => {
                  const discount = computeDiscount(total, applied);
                  const shippingR = Math.round((shippingP ?? 0) / 100);
                  const grandTotal = Math.max(0, total - discount) + shippingR;
                  return (
                    <dl className="mt-5 pt-5 border-t border-ink-100 space-y-2 text-[14px]">
                      <div className="flex justify-between">
                        <dt className="text-ink-600">Subtotal</dt>
                        <dd className="font-semibold text-ink-900">
                          ₹{total.toLocaleString()}
                        </dd>
                      </div>
                      {applied && discount > 0 ? (
                        <div className="flex justify-between">
                          <dt className="text-ink-600">
                            Discount{" "}
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
                      <div className="flex justify-between pt-2 border-t border-ink-100">
                        <dt className="font-display font-bold text-ink-900">
                          Total
                        </dt>
                        <dd className="font-display text-[20px] font-extrabold text-ink-900">
                          ₹{grandTotal.toLocaleString()}
                        </dd>
                      </div>
                    </dl>
                  );
                })()}

                {/* Payment gateway fee + GST disclosure. CCAvenue collects
                    these on top of the order amount; surfacing the schedule
                    here means the bill the user sees on the PSP page isn't
                    a surprise. The checkbox is required before Pay enables. */}
                <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50/60 p-3.5">
                  <div className="flex items-start gap-2">
                    <Info className="h-4 w-4 mt-0.5 text-amber-700 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-[12.5px] font-bold text-amber-900">
                        Payment-gateway charges apply
                      </p>
                      <p className="mt-0.5 text-[11.5px] text-amber-800">
                        The transaction fee depends on the payment method
                        you choose on the next page:
                      </p>
                      <ul className="mt-1.5 space-y-0.5 text-[11.5px] text-amber-900">
                        <li className="flex justify-between gap-2">
                          <span>Credit Card (Visa / Master / RuPay)</span>
                          <span className="font-mono font-semibold">1.95%</span>
                        </li>
                        <li className="flex justify-between gap-2">
                          <span>Debit Card</span>
                          <span className="font-mono font-semibold">1.25%</span>
                        </li>
                        <li className="flex justify-between gap-2">
                          <span>RuPay Debit Card</span>
                          <span className="font-mono font-semibold">1.00%</span>
                        </li>
                        <li className="flex justify-between gap-2">
                          <span>UPI (standard)</span>
                          <span className="font-mono font-semibold">1.00%</span>
                        </li>
                        <li className="flex justify-between gap-2">
                          <span>UPI via credit card / wallet</span>
                          <span className="font-mono font-semibold">2.00%</span>
                        </li>
                        <li className="flex justify-between gap-2">
                          <span>Net Banking</span>
                          <span className="font-mono font-semibold">1.80%</span>
                        </li>
                      </ul>
                      <p className="mt-2 text-[11px] text-amber-800 leading-snug">
                        18% GST is applied on the total amount (including the
                        transaction fee) as per government regulations. The
                        fee above includes a 1% platform charge irrespective
                        of the payment mode chosen.
                      </p>
                    </div>
                  </div>
                  <label className="mt-3 flex items-start gap-2 text-[12px] text-amber-900 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={feesAcknowledged}
                      onChange={(e) => setFeesAcknowledged(e.target.checked)}
                      className="mt-0.5 h-4 w-4 accent-brand flex-shrink-0"
                    />
                    <span className="font-medium">
                      I understand that a payment-gateway fee + 18% GST will
                      be added on the next page.
                    </span>
                  </label>
                </div>

                <button
                  onClick={place}
                  disabled={submitting || count === 0 || !feesAcknowledged}
                  className="mt-4 w-full inline-flex items-center justify-center gap-2 rounded-full bg-brand text-white h-12 text-[14px] font-bold hover:bg-brand-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {submitting
                    ? "Redirecting to secure payment…"
                    : `Pay ₹${(Math.max(0, total - computeDiscount(total, applied))).toLocaleString()}`}
                </button>

                <ul className="mt-4 space-y-2 text-[12px] text-ink-500">
                  <li className="flex items-start gap-2">
                    <Lock className="h-3.5 w-3.5 mt-0.5 text-ink-400" />
                    Secured by CCAvenue · UPI, Cards, Netbanking
                  </li>
                  <li className="flex items-start gap-2">
                    <ShieldCheck className="h-3.5 w-3.5 mt-0.5 text-ink-400" />
                    Free 7-day returns
                  </li>
                </ul>
              </div>
            </aside>
          </div>
        </div>
      </main>
    </>
  );
}

function Field({
  label,
  value,
  onChange,
  inputMode,
  className = "",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  inputMode?: "text" | "numeric";
  className?: string;
}) {
  return (
    <label className={"flex flex-col " + className}>
      <span className="text-[12px] font-semibold text-ink-700">{label}</span>
      <input
        type="text"
        inputMode={inputMode ?? "text"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 rounded-xl border border-ink-200 bg-white px-3 py-2.5 text-[14px] text-ink-900 outline-none focus:border-ink-900 transition-colors"
      />
    </label>
  );
}
