"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Save } from "lucide-react";
import { Button } from "@/components/admin/ui/primitives-client";

export function NewSupplierForm() {
  const router = useRouter();
  const [form, setForm] = useState({
    name: "",
    contactName: "",
    phone: "",
    email: "",
    gstin: "",
    pan: "",
    paymentTerms: "",
    notes: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const set = (k: keyof typeof form, v: string) =>
    setForm((f) => ({ ...f, [k]: v }));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    start(async () => {
      const r = await fetch("/api/admin/suppliers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          contactName: form.contactName.trim() || null,
          phone: form.phone.trim() || null,
          email: form.email.trim() || null,
          gstin: form.gstin.trim() || null,
          pan: form.pan.trim() || null,
          paymentTerms: form.paymentTerms.trim() || null,
          notes: form.notes.trim() || null,
        }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setError(d.error ?? "Failed to create supplier");
        return;
      }
      const { id } = await r.json();
      router.push(`/admin/suppliers/${id}`);
    });
  };

  return (
    <form onSubmit={submit} className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Field label="Supplier name" required className="lg:col-span-2">
        <input
          value={form.name}
          onChange={(e) => set("name", e.target.value)}
          required
          className={inputClass}
          placeholder="e.g. SVK Garments"
        />
      </Field>
      <Field label="Contact person">
        <input
          value={form.contactName}
          onChange={(e) => set("contactName", e.target.value)}
          className={inputClass}
        />
      </Field>
      <Field label="Phone">
        <input
          value={form.phone}
          onChange={(e) => set("phone", e.target.value)}
          className={inputClass}
        />
      </Field>
      <Field label="Email">
        <input
          type="email"
          value={form.email}
          onChange={(e) => set("email", e.target.value)}
          className={inputClass}
        />
      </Field>
      <Field label="Payment terms">
        <input
          value={form.paymentTerms}
          onChange={(e) => set("paymentTerms", e.target.value)}
          placeholder="e.g. Net 30"
          className={inputClass}
        />
      </Field>
      <Field label="GSTIN">
        <input
          value={form.gstin}
          onChange={(e) => set("gstin", e.target.value.toUpperCase())}
          className={inputClass + " font-mono"}
          maxLength={15}
        />
      </Field>
      <Field label="PAN">
        <input
          value={form.pan}
          onChange={(e) => set("pan", e.target.value.toUpperCase())}
          className={inputClass + " font-mono"}
          maxLength={10}
        />
      </Field>
      <Field label="Notes" className="lg:col-span-2">
        <textarea
          rows={3}
          value={form.notes}
          onChange={(e) => set("notes", e.target.value)}
          className={inputClass + " py-2"}
        />
      </Field>

      <div className="lg:col-span-2 flex items-center justify-end gap-3 pt-2">
        {error ? <span className="text-[13px] text-red-700">{error}</span> : null}
        <Button busy={pending} icon={<Save className="h-3.5 w-3.5" />} type="submit">
          Create supplier
        </Button>
      </div>
    </form>
  );
}

const inputClass =
  "w-full h-9 px-3 text-[13px] rounded-lg bg-white border border-ink-200 placeholder:text-ink-400 " +
  "focus:outline-none focus:border-ink-400 focus:ring-2 focus:ring-brand-300/30 transition";

function Field({
  label,
  required,
  children,
  className,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={"block " + (className ?? "")}>
      <span className="text-[12px] font-semibold text-ink-700">
        {label}
        {required ? <span className="text-red-600 ml-0.5">*</span> : null}
      </span>
      <div className="mt-1.5">{children}</div>
    </label>
  );
}
