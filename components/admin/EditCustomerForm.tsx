"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Save } from "lucide-react";
import { Button } from "@/components/admin/ui/primitives-client";

type CustomerFields = {
  id: string;
  name: string | null;
  email: string | null;
  status: "active" | "blocked" | "pending";
  customerGroup: string;
  notes: string | null;
};

export function EditCustomerForm({ customer }: { customer: CustomerFields }) {
  const router = useRouter();
  const [form, setForm] = useState<CustomerFields>(customer);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();

  const set = <K extends keyof CustomerFields>(k: K, v: CustomerFields[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setSaved(false);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    start(async () => {
      const r = await fetch(`/api/admin/customers/${form.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          email: form.email,
          status: form.status,
          customerGroup: form.customerGroup,
          notes: form.notes,
        }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setError(d.error ?? "Save failed");
        return;
      }
      setSaved(true);
      router.refresh();
    });
  };

  return (
    <form onSubmit={submit} className="grid gap-4">
      <Field label="Name">
        <input
          type="text"
          value={form.name ?? ""}
          onChange={(e) => set("name", e.target.value || null)}
          className={inputClass}
        />
      </Field>
      <Field label="Email">
        <input
          type="email"
          value={form.email ?? ""}
          onChange={(e) => set("email", e.target.value || null)}
          className={inputClass}
        />
      </Field>
      <Field label="Status">
        <select
          value={form.status}
          onChange={(e) =>
            set("status", e.target.value as CustomerFields["status"])
          }
          className={inputClass}
        >
          <option value="active">Active</option>
          <option value="pending">Pending</option>
          <option value="blocked">Blocked</option>
        </select>
      </Field>
      <Field label="Customer group">
        <input
          type="text"
          value={form.customerGroup}
          onChange={(e) => set("customerGroup", e.target.value)}
          className={inputClass}
        />
      </Field>
      <Field label="Notes">
        <textarea
          rows={3}
          value={form.notes ?? ""}
          onChange={(e) => set("notes", e.target.value || null)}
          className={inputClass + " py-2"}
        />
      </Field>
      <div className="flex items-center justify-end gap-3 pt-2">
        {error ? <span className="text-[13px] text-red-700">{error}</span> : null}
        {saved ? <span className="text-[13px] text-emerald-700">✓ Saved</span> : null}
        <Button busy={pending} icon={<Save className="h-3.5 w-3.5" />} type="submit">
          Save changes
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
