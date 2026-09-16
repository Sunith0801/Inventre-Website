"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MapPin, Plus, Trash2, Star } from "lucide-react";
import { Button } from "@/components/admin/ui/primitives-client";
import { Badge, Th, Td, Tr, Field, Input, Select, Checkbox, FormGrid, FormError } from "@/components/admin/ui/primitives";
import { ConfirmDialog } from "@/components/admin/ui/dialog";

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

/**
 * The customer's saved addresses — the same rows the storefront shows under
 * "Saved addresses", one per line so the operator can compare them at a
 * glance. Adding one opens an inline form built on the shared form fields.
 */
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
  const [toDelete, setToDelete] = useState<AddressDto | null>(null);

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
    start(async () => {
      await fetch(`/api/admin/customers/${parentId}/addresses/${id}`, {
        method: "DELETE",
      });
      setList((cur) => cur.filter((a) => a.id !== id));
      setToDelete(null);
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

  const cancel = () => {
    setAdding(false);
    setDraft(blank);
    setError(null);
  };

  return (
    <div>
      {list.length === 0 ? (
        <div className="px-5 py-8 text-center text-[13px] text-ink-500">
          <MapPin className="mx-auto mb-2 h-5 w-5 text-ink-300" />
          No saved addresses on the storefront yet.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <Th>Address</Th>
                <Th>Receiver</Th>
                <Th>City · Pincode</Th>
                <Th>Type</Th>
                <Th right>Default</Th>
                <Th right><span className="sr-only">Actions</span></Th>
              </tr>
            </thead>
            <tbody>
              {list.map((a) => (
                <Tr key={a.id}>
                  <Td>
                    <div className="max-w-[360px]">
                      {a.label ? <div className="font-semibold text-ink-900">{a.label}</div> : null}
                      <div className={a.label ? "text-[12.5px] font-normal text-ink-600" : "font-normal text-ink-800"}>
                        {a.line1}
                        {a.line2 ? `, ${a.line2}` : ""}
                      </div>
                      {a.gstin ? <div className="mt-0.5 font-mono text-[11px] text-ink-500">GSTIN {a.gstin}</div> : null}
                    </div>
                  </Td>
                  <Td>
                    <div className="text-ink-800">{a.receiverName}</div>
                    <div className="font-mono text-[12px] text-ink-500">{a.receiverPhone}</div>
                  </Td>
                  <Td muted>
                    {a.city}, {a.state}
                    <span className="block font-mono text-[12px]">{a.pincode}</span>
                  </Td>
                  <Td>
                    <Badge tone={a.addressType === "billing" ? "info" : "default"} size="sm">
                      {a.addressType === "billing" ? "Billing" : "Shipping"}
                    </Badge>
                  </Td>
                  <Td right>
                    {a.isDefault ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-bold text-brand-700">
                        <Star className="h-3 w-3" /> Default
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setDefault(a.id)}
                        disabled={pending}
                        className="text-[12px] font-semibold text-ink-400 hover:text-brand-700 disabled:opacity-50"
                      >
                        Set default
                      </button>
                    )}
                  </Td>
                  <Td right>
                    <button
                      type="button"
                      onClick={() => setToDelete(a)}
                      className="grid h-7 w-7 place-items-center rounded-md text-ink-300 hover:bg-red-50 hover:text-red-600"
                      aria-label="Delete address"
                      title="Delete address"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="border-t border-ink-100/70 px-5 py-4">
        {adding ? (
          <div className="space-y-4">
            <FormGrid cols={2}>
              <Field label="Label" htmlFor="addr-label" hint="Home, Office…">
                <Input id="addr-label" value={draft.label} onChange={(e) => set("label", e.target.value)} placeholder="Home" />
              </Field>
              <Field label="Type" htmlFor="addr-type">
                <Select id="addr-type" value={draft.addressType} onChange={(e) => set("addressType", e.target.value as "shipping" | "billing")}>
                  <option value="shipping">Shipping</option>
                  <option value="billing">Billing</option>
                </Select>
              </Field>
              <Field label="Receiver name" htmlFor="addr-receiver" required>
                <Input id="addr-receiver" value={draft.receiverName} onChange={(e) => set("receiverName", e.target.value)} />
              </Field>
              <Field label="Receiver mobile" htmlFor="addr-phone" required>
                <Input
                  id="addr-phone"
                  inputMode="numeric"
                  value={draft.receiverPhone}
                  onChange={(e) => set("receiverPhone", e.target.value.replace(/\D/g, "").slice(0, 10))}
                  placeholder="10 digits"
                  className="font-mono"
                />
              </Field>
              <Field label="Address line 1" htmlFor="addr-line1" required className="md:col-span-2">
                <Input id="addr-line1" value={draft.line1} onChange={(e) => set("line1", e.target.value)} />
              </Field>
              <Field label="Address line 2" htmlFor="addr-line2" className="md:col-span-2">
                <Input id="addr-line2" value={draft.line2} onChange={(e) => set("line2", e.target.value)} />
              </Field>
              <Field label="City" htmlFor="addr-city" required>
                <Input id="addr-city" value={draft.city} onChange={(e) => set("city", e.target.value)} />
              </Field>
              <Field label="State" htmlFor="addr-state" required>
                <Input id="addr-state" value={draft.state} onChange={(e) => set("state", e.target.value)} />
              </Field>
              <Field label="Pincode" htmlFor="addr-pin" required>
                <Input
                  id="addr-pin"
                  inputMode="numeric"
                  value={draft.pincode}
                  onChange={(e) => set("pincode", e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="6 digits"
                  className="font-mono"
                />
              </Field>
              <Field label="GSTIN" htmlFor="addr-gstin" hint="Only for business billing">
                <Input id="addr-gstin" value={draft.gstin} onChange={(e) => set("gstin", e.target.value.toUpperCase())} maxLength={15} className="font-mono" />
              </Field>
              <Checkbox label="Make this the default address" checked={draft.isDefault} onChange={(e) => set("isDefault", e.target.checked)} className="md:col-span-2" />
            </FormGrid>
            <FormError>{error}</FormError>
            <div className="flex items-center justify-end gap-2">
              <Button variant="secondary" onClick={cancel} disabled={pending}>Cancel</Button>
              <Button busy={pending} onClick={add}>Save address</Button>
            </div>
          </div>
        ) : (
          <Button variant="secondary" size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setAdding(true)}>
            Add address
          </Button>
        )}
      </div>

      <ConfirmDialog
        open={toDelete !== null}
        onClose={() => (pending ? undefined : setToDelete(null))}
        onConfirm={() => toDelete && remove(toDelete.id)}
        title="Delete this address?"
        description={
          toDelete
            ? `${toDelete.line1}, ${toDelete.city} ${toDelete.pincode} is removed from the customer's saved addresses on the storefront. Orders already placed keep their own copy.`
            : undefined
        }
        confirmLabel="Delete address"
        busy={pending}
      />
    </div>
  );
}
