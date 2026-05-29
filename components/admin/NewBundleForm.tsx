"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Save } from "lucide-react";
import { Button } from "@/components/admin/ui/primitives-client";

type ProductOpt = {
  id: string;
  name: string;
  itemCode: string | null;
  basePrice: number | null;
};

export function NewBundleForm({ products }: { products: ProductOpt[] }) {
  const router = useRouter();
  const [productId, setProductId] = useState("");
  const [bundleType, setBundleType] = useState<"fixed" | "configurable">("fixed");
  const [pricingMode, setPricingMode] = useState<"sum" | "fixed">("sum");
  const [fixedPrice, setFixedPrice] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!productId) {
      setError("Pick a product");
      return;
    }
    start(async () => {
      const r = await fetch("/api/admin/bundles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId,
          bundleType,
          pricingMode,
          fixedPrice:
            pricingMode === "fixed" && fixedPrice
              ? Math.round(Number(fixedPrice) * 100)
              : null,
        }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setError(d.error ?? "Failed to create bundle");
        return;
      }
      const data = await r.json();
      router.push(`/admin/catalog/bundles/${data.bundle.id}`);
    });
  };

  return (
    <form onSubmit={submit} className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Field label="Product" required className="lg:col-span-2">
        <select
          value={productId}
          onChange={(e) => setProductId(e.target.value)}
          required
          className={inputClass}
        >
          <option value="">— Pick a product —</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.itemCode ? ` (${p.itemCode})` : ""}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Bundle type" required>
        <select
          value={bundleType}
          onChange={(e) => setBundleType(e.target.value as "fixed" | "configurable")}
          className={inputClass}
        >
          <option value="fixed">Fixed (same components every time)</option>
          <option value="configurable">Configurable (parent picks options)</option>
        </select>
      </Field>

      <Field label="Pricing mode" required>
        <select
          value={pricingMode}
          onChange={(e) => setPricingMode(e.target.value as "sum" | "fixed")}
          className={inputClass}
        >
          <option value="sum">Sum of components</option>
          <option value="fixed">Fixed bundle price</option>
        </select>
      </Field>

      {pricingMode === "fixed" ? (
        <Field label="Fixed price (₹)" className="lg:col-span-2" required>
          <input
            type="number"
            step="0.01"
            min={0}
            value={fixedPrice}
            onChange={(e) => setFixedPrice(e.target.value)}
            required
            className={inputClass}
            placeholder="e.g. 2499.00"
          />
        </Field>
      ) : null}

      <div className="lg:col-span-2 flex items-center justify-end gap-3 pt-2">
        {error ? <span className="text-[13px] text-red-700">{error}</span> : null}
        <Button busy={pending} icon={<Save className="h-3.5 w-3.5" />} type="submit">
          Create bundle
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
