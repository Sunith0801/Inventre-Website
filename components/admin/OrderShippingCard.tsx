"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Save, X } from "lucide-react";
import { Card, CardHeader, Field, Input, Select, FormGrid, FormError } from "@/components/admin/ui/primitives";
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
        title="Delivery address"
        description={editing ? "Saving re-computes place of supply and pushes the change to the audit ERP." : undefined}
        actions={
          editing ? (
            <Button variant="ghost" size="sm" onClick={cancel} icon={<X className="h-3.5 w-3.5" />}>Cancel</Button>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => setEditing(true)} icon={<Pencil className="h-3.5 w-3.5" />}>Edit</Button>
          )
        }
      />

      {editing ? (
        <form onSubmit={submit} className="space-y-4">
          <FormGrid cols={2}>
            <Field label="Receiver name" htmlFor="sa-name" required>
              <Input id="sa-name" value={form.receiverName} onChange={(e) => set("receiverName", e.target.value)} />
            </Field>
            <Field label="Delivery mobile" htmlFor="sa-phone" required>
              <Input id="sa-phone" inputMode="numeric" placeholder="10 digits" value={form.receiverPhone} onChange={(e) => set("receiverPhone", e.target.value.replace(/\D/g, "").slice(0, 10))} className="font-mono" />
            </Field>
            <Field label="Address line 1" htmlFor="sa-l1" required className="md:col-span-2">
              <Input id="sa-l1" value={form.line1} onChange={(e) => set("line1", e.target.value)} />
            </Field>
            <Field label="Address line 2" htmlFor="sa-l2" className="md:col-span-2">
              <Input id="sa-l2" value={form.line2} onChange={(e) => set("line2", e.target.value)} />
            </Field>
            <Field label="City" htmlFor="sa-city" required>
              <Input id="sa-city" value={form.city} onChange={(e) => set("city", e.target.value)} />
            </Field>
            <Field label="Pincode" htmlFor="sa-pin" required>
              <Input id="sa-pin" inputMode="numeric" value={form.pincode} onChange={(e) => set("pincode", e.target.value.replace(/\D/g, "").slice(0, 6))} className="font-mono" />
            </Field>
            <Field label="State" htmlFor="sa-state" required className="md:col-span-2">
              <Select id="sa-state" value={form.state} onChange={(e) => set("state", e.target.value)}>
                {/* Keep any pre-existing free-text state that isn't in the
                    canonical list so we never blank it out on save. */}
                {form.state && !INDIAN_STATES.includes(form.state) ? <option value={form.state}>{form.state}</option> : null}
                <option value="">Select state</option>
                {INDIAN_STATES.map((st) => (
                  <option key={st} value={st}>{st}</option>
                ))}
              </Select>
            </Field>
          </FormGrid>

          <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-4">
            <Field label="Account mobile (OTP login)" htmlFor="sa-account" hint="Shared across all of this customer's orders — change it only if the customer changed their number.">
              <Input id="sa-account" inputMode="numeric" placeholder="10 digits" value={form.accountPhone} onChange={(e) => set("accountPhone", e.target.value.replace(/\D/g, "").slice(0, 10))} className="font-mono" />
            </Field>
          </div>

          <FormError>{error}</FormError>
          <div className="flex items-center justify-end gap-2 border-t border-ink-100/70 pt-4">
            <Button type="button" variant="secondary" onClick={cancel} disabled={pending}>Cancel</Button>
            <Button busy={pending} icon={<Save className="h-3.5 w-3.5" />} type="submit">Save address</Button>
          </div>
        </form>
      ) : (
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_200px]">
          <p className="text-[13.5px] leading-relaxed text-ink-800">
            {address.line1}
            {address.line2 ? `, ${address.line2}` : ""}
            <br />
            {address.city}, {address.state} <span className="font-mono">{address.pincode}</span>
          </p>
          <div className="text-[13px]">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-500">Receiver</div>
            <div className="mt-1 font-semibold text-ink-900">{address.receiverName}</div>
            {address.receiverPhone ? <div className="font-mono text-ink-600">+91 {address.receiverPhone}</div> : null}
          </div>
        </div>
      )}
    </Card>
  );
}
