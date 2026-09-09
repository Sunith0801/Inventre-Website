"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Save, X } from "lucide-react";
import { Card, CardHeader } from "@/components/admin/ui/primitives";
import { Button } from "@/components/admin/ui/primitives-client";
import { INDIAN_STATES } from "@/lib/tax";

export type ShippingAddress = {
  receiverName: string;
  receiverPhone: string;
  line1: string;
  line2?: string | null;
  city: string;
  state: string;
  pincode: string;
};

type FormState = {
  receiverName: string;
  receiverPhone: string;
  line1: string;
  line2: string;
  city: string;
  state: string;
  pincode: string;
  accountPhone: string;
};

/**
 * Shipping-address card with an inline "Edit" affordance. Read-only by
 * default; the pencil reveals a form to correct the delivery address, the
 * delivery mobile, and the customer's account (login) mobile. Saving PATCHes
 * /api/admin/orders/{id}, which recomputes place_of_supply and re-pushes the
 * order to audit so the change lands there too.
 */
export function OrderShippingCard({
  orderId,
  address,
  accountPhone,
}: {
  orderId: string;
  address: ShippingAddress;
  accountPhone: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const initial: FormState = {
    receiverName: address.receiverName ?? "",
    receiverPhone: address.receiverPhone ?? "",
    line1: address.line1 ?? "",
    line2: address.line2 ?? "",
    city: address.city ?? "",
    state: address.state ?? "",
    pincode: address.pincode ?? "",
    accountPhone: accountPhone ?? "",
  };
  const [form, setForm] = useState<FormState>(initial);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setError(null);
  };

  const cancel = () => {
    setForm(initial);
    setError(null);
    setEditing(false);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Client-side guards mirror the server's Zod shape so obvious mistakes
    // don't round-trip.
    for (const [k, label] of [
      ["receiverName", "Receiver name"],
      ["line1", "Address line 1"],
      ["city", "City"],
      ["state", "State"],
      ["pincode", "Pincode"],
    ] as const) {
      if (!form[k].trim()) {
        setError(`${label} is required`);
        return;
      }
    }
    if (!/^\d{10}$/.test(form.receiverPhone)) {
      setError("Delivery mobile must be a 10-digit number");
      return;
    }
    if (form.accountPhone && !/^\d{10}$/.test(form.accountPhone)) {
      setError("Account mobile must be a 10-digit number");
      return;
    }

    const body: Record<string, unknown> = {
      shippingAddress: {
        receiverName: form.receiverName.trim(),
        receiverPhone: form.receiverPhone.trim(),
        line1: form.line1.trim(),
        line2: form.line2.trim() || null,
        city: form.city.trim(),
        state: form.state.trim(),
        pincode: form.pincode.trim(),
      },
    };
    // Only send the account mobile when it actually changed — avoids a
    // pointless parent-row write / self-collision check.
    if (form.accountPhone && form.accountPhone !== initial.accountPhone) {
      body.accountPhone = form.accountPhone.trim();
    }

    start(async () => {
      const r = await fetch(`/api/admin/orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setError(d.error ?? "Save failed");
        return;
      }
      setEditing(false);
      router.refresh();
    });
  };

  return (
    <Card>
      <CardHeader
        title="Shipping address"
        actions={
          editing ? (
            <button
              type="button"
              onClick={cancel}
              className="inline-flex items-center gap-1 text-[12px] font-medium text-ink-500 hover:text-ink-800"
            >
              <X className="h-3.5 w-3.5" /> Cancel
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="inline-flex items-center gap-1 text-[12px] font-medium text-brand-700 hover:text-brand-800"
            >
              <Pencil className="h-3.5 w-3.5" /> Edit
            </button>
          )
        }
      />

      {editing ? (
        <form onSubmit={submit} className="grid gap-3">
          <Field label="Receiver name">
            <input
              className={inputClass}
              value={form.receiverName}
              onChange={(e) => set("receiverName", e.target.value)}
            />
          </Field>
          <Field label="Delivery mobile">
            <input
              className={inputClass}
              inputMode="numeric"
              placeholder="10-digit number"
              value={form.receiverPhone}
              onChange={(e) =>
                set("receiverPhone", e.target.value.replace(/\D/g, "").slice(0, 10))
              }
            />
          </Field>
          <Field label="Address line 1">
            <input
              className={inputClass}
              value={form.line1}
              onChange={(e) => set("line1", e.target.value)}
            />
          </Field>
          <Field label="Address line 2 (optional)">
            <input
              className={inputClass}
              value={form.line2}
              onChange={(e) => set("line2", e.target.value)}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="City">
              <input
                className={inputClass}
                value={form.city}
                onChange={(e) => set("city", e.target.value)}
              />
            </Field>
            <Field label="Pincode">
              <input
                className={inputClass}
                inputMode="numeric"
                value={form.pincode}
                onChange={(e) =>
                  set("pincode", e.target.value.replace(/\D/g, "").slice(0, 6))
                }
              />
            </Field>
          </div>
          <Field label="State">
            <select
              className={inputClass}
              value={form.state}
              onChange={(e) => set("state", e.target.value)}
            >
              {/* Keep any pre-existing free-text state that isn't in the
                  canonical list so we never blank it out on save. */}
              {form.state && !INDIAN_STATES.includes(form.state) ? (
                <option value={form.state}>{form.state}</option>
              ) : null}
              <option value="">Select state…</option>
              {INDIAN_STATES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </Field>

          <div className="mt-1 rounded-lg border border-amber-200 bg-amber-50/70 p-3">
            <Field label="Account mobile (login)">
              <input
                className={inputClass}
                inputMode="numeric"
                placeholder="10-digit number"
                value={form.accountPhone}
                onChange={(e) =>
                  set("accountPhone", e.target.value.replace(/\D/g, "").slice(0, 10))
                }
              />
            </Field>
            <p className="mt-1.5 text-[11px] leading-snug text-amber-800">
              This is the customer&apos;s OTP login number, shared across all
              their orders. Changing it updates the account everywhere — only
              edit if the customer changed their number.
            </p>
          </div>

          <div className="flex items-center justify-end gap-3 pt-1">
            {error ? (
              <span className="text-[12px] text-red-700">{error}</span>
            ) : null}
            <Button
              busy={pending}
              icon={<Save className="h-3.5 w-3.5" />}
              type="submit"
            >
              Save & push to audit
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex items-start gap-3">
          <div className="h-9 w-9 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center font-bold text-[14px] shrink-0">
            {(address.receiverName ?? "?").slice(0, 1).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-ink-900 leading-tight">
              {address.receiverName}
            </p>
            {address.receiverPhone ? (
              <p className="mt-0.5">
                <span className="inline-flex items-center gap-1 rounded-md bg-ink-50 px-2 py-0.5 text-[12px] font-mono text-ink-800">
                  +91 {address.receiverPhone}
                </span>
              </p>
            ) : null}
            <p className="mt-2 text-[13px] text-ink-700 leading-snug">
              {address.line1}
              {address.line2 ? `, ${address.line2}` : ""}
              <br />
              <span className="text-ink-600">
                {address.city}, {address.state}{" "}
                <span className="font-mono">{address.pincode}</span>
              </span>
            </p>
          </div>
        </div>
      )}
    </Card>
  );
}

const inputClass =
  "w-full h-9 px-3 text-[13px] rounded-lg bg-white border border-ink-200 placeholder:text-ink-400 " +
  "focus:outline-none focus:border-ink-400 focus:ring-2 focus:ring-brand-300/30 transition";

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-[12px] font-semibold text-ink-700">{label}</span>
      <div className="mt-1.5">{children}</div>
    </label>
  );
}
