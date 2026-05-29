"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Save } from "lucide-react";
import { Button } from "@/components/admin/ui/primitives-client";

type DType = "percent" | "flat" | "bulk" | "bxgy" | "free_shipping";

export function NewDiscountForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [type, setType] = useState<DType>("percent");
  const [value, setValue] = useState("");
  const [appliesTo, setAppliesTo] = useState<
    "all" | "school" | "category" | "product" | "variant"
  >("all");
  const [minOrder, setMinOrder] = useState("");
  const [maxDiscount, setMaxDiscount] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [stackable, setStackable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    start(async () => {
      const r = await fetch("/api/admin/discount-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          code: code.trim() || null,
          type,
          value: Number(value),
          appliesTo,
          minOrderAmount: minOrder ? Number(minOrder) * 100 : null,
          maxDiscountAmount: maxDiscount ? Number(maxDiscount) * 100 : null,
          validUntil: validUntil ? new Date(validUntil).toISOString() : null,
          isActive: true,
          isStackable: stackable,
        }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setError(d.error ?? "Failed to create discount rule");
        return;
      }
      router.push("/admin/discounts");
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
          placeholder="e.g. KLS Term-1 10% off"
        />
      </Field>
      <Field label="Code" hint="Leave blank for auto-apply">
        <input
          type="text"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          className={inputClass + " font-mono"}
          placeholder="TERM10"
        />
      </Field>
      <Field label="Type" required>
        <select
          value={type}
          onChange={(e) => setType(e.target.value as DType)}
          className={inputClass}
        >
          <option value="percent">Percent off</option>
          <option value="flat">Flat amount off</option>
          <option value="bulk">Bulk (qty-based)</option>
          <option value="bxgy">Buy X Get Y</option>
          <option value="free_shipping">Free shipping</option>
        </select>
      </Field>
      <Field
        label={type === "percent" ? "Percent (e.g. 10)" : "Value (₹)"}
        required
      >
        <input
          type="number"
          step="0.01"
          min={0}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          required
          className={inputClass}
        />
      </Field>
      <Field label="Applies to">
        <select
          value={appliesTo}
          onChange={(e) =>
            setAppliesTo(e.target.value as typeof appliesTo)
          }
          className={inputClass}
        >
          <option value="all">All products</option>
          <option value="school">Specific school</option>
          <option value="category">Category</option>
          <option value="product">Product</option>
          <option value="variant">Variant</option>
        </select>
      </Field>
      <Field label="Stackable">
        <label className="flex items-center gap-2 h-9">
          <input
            type="checkbox"
            checked={stackable}
            onChange={(e) => setStackable(e.target.checked)}
            className="h-4 w-4"
          />
          <span className="text-[13px] text-ink-700">
            Combines with other discounts
          </span>
        </label>
      </Field>
      <Field label="Min order amount (₹)">
        <input
          type="number"
          min={0}
          value={minOrder}
          onChange={(e) => setMinOrder(e.target.value)}
          className={inputClass}
        />
      </Field>
      <Field label="Max discount cap (₹)">
        <input
          type="number"
          min={0}
          value={maxDiscount}
          onChange={(e) => setMaxDiscount(e.target.value)}
          className={inputClass}
        />
      </Field>
      <Field label="Valid until" className="lg:col-span-2">
        <input
          type="datetime-local"
          value={validUntil}
          onChange={(e) => setValidUntil(e.target.value)}
          className={inputClass}
        />
      </Field>

      <div className="lg:col-span-2 flex items-center justify-end gap-3 pt-2">
        {error ? <span className="text-[13px] text-red-700">{error}</span> : null}
        <Button busy={pending} icon={<Save className="h-3.5 w-3.5" />} type="submit">
          Create rule
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
