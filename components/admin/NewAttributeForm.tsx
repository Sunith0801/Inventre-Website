"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Save } from "lucide-react";
import { Button } from "@/components/admin/ui/primitives-client";

type AttrType = "size" | "color" | "design" | "model" | "other";

export function NewAttributeForm({
  schools,
}: {
  schools: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [type, setType] = useState<AttrType>("size");
  const [schoolId, setSchoolId] = useState<string>("");
  const [description, setDescription] = useState("");
  const [sortOrder, setSortOrder] = useState("0");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    start(async () => {
      const r = await fetch("/api/admin/attributes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          type,
          schoolId: schoolId || null,
          description: description.trim() || undefined,
          sortOrder: Number(sortOrder) || 0,
        }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setError(d.error ?? "Failed to create attribute");
        return;
      }
      const data = await r.json();
      router.push(`/admin/catalog/attributes/${data.attribute.id}`);
    });
  };

  return (
    <form onSubmit={submit} className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Field label="Name" required>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          className={inputClass}
          placeholder="e.g. Shirt Size"
        />
      </Field>
      <Field label="Type" required>
        <select
          value={type}
          onChange={(e) => setType(e.target.value as AttrType)}
          className={inputClass}
        >
          <option value="size">Size</option>
          <option value="color">Colour</option>
          <option value="design">Design</option>
          <option value="model">Model</option>
          <option value="other">Other</option>
        </select>
      </Field>
      <Field label="Scope" hint="Leave global to share across schools">
        <select
          value={schoolId}
          onChange={(e) => setSchoolId(e.target.value)}
          className={inputClass}
        >
          <option value="">Global (all schools)</option>
          {schools.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Sort order">
        <input
          type="number"
          value={sortOrder}
          onChange={(e) => setSortOrder(e.target.value)}
          className={inputClass}
        />
      </Field>
      <Field label="Description" className="lg:col-span-2">
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          className={inputClass + " py-2 h-auto"}
          placeholder="Optional notes for staff"
        />
      </Field>

      <div className="lg:col-span-2 flex items-center justify-end gap-3 pt-2">
        {error ? <span className="text-[13px] text-red-700">{error}</span> : null}
        <Button busy={pending} icon={<Save className="h-3.5 w-3.5" />} type="submit">
          Create attribute
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
  hint,
  required,
  children,
  className,
}: {
  label: string;
  hint?: string;
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
      {hint ? <span className="text-[11px] text-ink-500 ml-2">{hint}</span> : null}
      <div className="mt-1.5">{children}</div>
    </label>
  );
}
