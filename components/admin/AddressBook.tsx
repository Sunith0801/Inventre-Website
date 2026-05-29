"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MapPin, Plus, Trash2, Star } from "lucide-react";
import { Button } from "@/components/admin/ui/primitives-client";

export type AddressDto = {
  id: string;
  label: string | null;
  receiverName: string;
  receiverPhone: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  pincode: string;
  addressType: "shipping" | "billing";
  gstin: string | null;
  isDefault: boolean;
};

export function AddressBook({
  parentId,
  initial,
}: {
  parentId: string;
  initial: AddressDto[];
}) {
  const router = useRouter();
  const [list, setList] = useState<AddressDto[]>(initial);
  const [adding, setAdding] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  type Draft = {
    label: string;
    receiverName: string;
    receiverPhone: string;
    line1: string;
    line2: string;
    city: string;
    state: string;
    pincode: string;
    addressType: "shipping" | "billing";
    gstin: string;
    isDefault: boolean;
  };
  const blank: Draft = {
    label: "",
    receiverName: "",
    receiverPhone: "",
    line1: "",
    line2: "",
    city: "",
    state: "",
    pincode: "",
    addressType: "shipping",
    gstin: "",
    isDefault: false,
  };
  const [draft, setDraft] = useState<Draft>(blank);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));

  const add = () => {
    setError(null);
    start(async () => {
      const r = await fetch(`/api/admin/customers/${parentId}/addresses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: draft.label || null,
          receiverName: draft.receiverName,
          receiverPhone: draft.receiverPhone,
          line1: draft.line1,
          line2: draft.line2 || null,
          city: draft.city,
          state: draft.state,
          pincode: draft.pincode,
          addressType: draft.addressType,
          gstin: draft.gstin || null,
          isDefault: draft.isDefault,
        }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setError(d.error ?? "Failed to add address");
        return;
      }
      const { address } = await r.json();
      setList((cur) => [address, ...cur]);
      setDraft(blank);
      setAdding(false);
      router.refresh();
    });
  };

  const remove = (id: string) => {
    if (!confirm("Delete this address?")) return;
    start(async () => {
      await fetch(`/api/admin/customers/${parentId}/addresses/${id}`, {
        method: "DELETE",
      });
      setList((cur) => cur.filter((a) => a.id !== id));
      router.refresh();
    });
  };

  const setDefault = (id: string) => {
    start(async () => {
      await fetch(`/api/admin/customers/${parentId}/addresses/${id}`, {
        method: "POST",
      });
      setList((cur) =>
        cur.map((a) => ({ ...a, isDefault: a.id === id }))
      );
      router.refresh();
    });
  };

  return (
    <div className="space-y-3">
      {list.length === 0 && !adding ? (
        <p className="text-[13px] text-ink-500">No saved addresses.</p>
      ) : null}

      <ul className="space-y-3">
        {list.map((a) => (
          <li
            key={a.id}
            className="rounded-xl bg-cream-50/70 border border-ink-100/60 p-3"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5 text-ink-400" />
                <span className="font-semibold text-[12px] text-ink-900">
                  {a.label ?? a.addressType}
                </span>
                <span className="ml-2 text-[10px] uppercase tracking-wider text-ink-400 font-bold">
                  {a.addressType}
                </span>
              </div>
              <div className="flex items-center gap-1">
                {a.isDefault ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 text-brand-700 px-2 py-0.5 text-[10px] font-bold">
                    <Star className="h-2.5 w-2.5" /> Default
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setDefault(a.id)}
                    className="text-[10px] uppercase tracking-wider text-ink-400 hover:text-brand-700 font-bold"
                  >
                    Set default
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => remove(a.id)}
                  className="grid place-items-center h-6 w-6 rounded text-ink-300 hover:text-red-600 hover:bg-red-50"
                  aria-label="Delete address"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            </div>
            <div className="mt-1 text-[12px] text-ink-700 leading-snug">
              {a.receiverName} · {a.receiverPhone}
            </div>
            <div className="text-[12px] text-ink-500 leading-snug">
              {a.line1}
              {a.line2 ? `, ${a.line2}` : ""}, {a.city}, {a.state} {a.pincode}
            </div>
            {a.gstin ? (
              <div className="text-[10px] mt-1 font-mono text-ink-500">
                GSTIN: {a.gstin}
              </div>
            ) : null}
          </li>
        ))}
      </ul>

      {adding ? (
        <div className="rounded-xl border border-ink-200 bg-white p-3 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <input
              placeholder="Label e.g. Home"
              value={draft.label}
              onChange={(e) => set("label", e.target.value)}
              className={inputClass}
            />
            <select
              value={draft.addressType}
              onChange={(e) =>
                set("addressType", e.target.value as "shipping" | "billing")
              }
              className={inputClass}
            >
              <option value="shipping">Shipping</option>
              <option value="billing">Billing</option>
            </select>
            <input
              placeholder="Receiver name *"
              value={draft.receiverName}
              onChange={(e) => set("receiverName", e.target.value)}
              className={inputClass}
            />
            <input
              placeholder="Phone (10 digits) *"
              value={draft.receiverPhone}
              onChange={(e) =>
                set("receiverPhone", e.target.value.replace(/\D/g, "").slice(0, 10))
              }
              className={inputClass + " font-mono"}
            />
            <input
              placeholder="Line 1 *"
              value={draft.line1}
              onChange={(e) => set("line1", e.target.value)}
              className={inputClass + " col-span-2"}
            />
            <input
              placeholder="Line 2"
              value={draft.line2}
              onChange={(e) => set("line2", e.target.value)}
              className={inputClass + " col-span-2"}
            />
            <input
              placeholder="City *"
              value={draft.city}
              onChange={(e) => set("city", e.target.value)}
              className={inputClass}
            />
            <input
              placeholder="State *"
              value={draft.state}
              onChange={(e) => set("state", e.target.value)}
              className={inputClass}
            />
            <input
              placeholder="Pincode (6 digits) *"
              value={draft.pincode}
              onChange={(e) =>
                set("pincode", e.target.value.replace(/\D/g, "").slice(0, 6))
              }
              className={inputClass + " font-mono"}
            />
            <input
              placeholder="GSTIN (if business)"
              value={draft.gstin}
              onChange={(e) => set("gstin", e.target.value.toUpperCase())}
              className={inputClass + " font-mono"}
              maxLength={15}
            />
            <label className="col-span-2 flex items-center gap-2 text-[12px] text-ink-700">
              <input
                type="checkbox"
                checked={draft.isDefault}
                onChange={(e) => set("isDefault", e.target.checked)}
              />
              Set as default
            </label>
          </div>
          {error ? (
            <p className="text-[12px] text-red-700">{error}</p>
          ) : null}
          <div className="flex items-center justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setAdding(false);
                setDraft(blank);
                setError(null);
              }}
            >
              Cancel
            </Button>
            <Button busy={pending} size="sm" onClick={add}>
              Save address
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="inline-flex items-center gap-1 text-[12px] font-semibold text-brand-700 hover:text-brand-900"
        >
          <Plus className="h-3.5 w-3.5" /> Add address
        </button>
      )}
    </div>
  );
}

const inputClass =
  "h-9 px-3 text-[13px] rounded-lg bg-white border border-ink-200 placeholder:text-ink-400 " +
  "focus:outline-none focus:border-ink-400 focus:ring-2 focus:ring-brand-300/30 transition w-full";
