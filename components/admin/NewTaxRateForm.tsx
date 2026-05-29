"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Save } from "lucide-react";
import { Button } from "@/components/admin/ui/primitives-client";

export function NewTaxRateForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [combined, setCombined] = useState("12"); // total GST %
  const [cgst, setCgst] = useState("6");
  const [sgst, setSgst] = useState("6");
  const [igst, setIgst] = useState("12");
  const [cess, setCess] = useState("0");
  const [hsnPattern, setHsnPattern] = useState("");
  const [isDefault, setIsDefault] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // When the user types a combined GST %, auto-split into CGST/SGST and IGST.
  useEffect(() => {
    const c = Number(combined);
    if (!Number.isFinite(c)) return;
    setCgst((c / 2).toString());
    setSgst((c / 2).toString());
    setIgst(c.toString());
  }, [combined]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    start(async () => {
      const r = await fetch("/api/admin/tax/rates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          cgstRate: Number(cgst),
          sgstRate: Number(sgst),
          igstRate: Number(igst),
          cessRate: Number(cess),
          hsnPattern: hsnPattern.trim() || null,
          isDefault,
        }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setError(d.error ?? "Failed to create tax rate");
        return;
      }
      router.push("/admin/tax/rates");
    });
  };

  return (
    <form onSubmit={submit} className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Field label="Name" required className="lg:col-span-2">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          className={inputClass}
          placeholder="e.g. GST 12%"
        />
      </Field>
      <Field label="Combined GST %" hint="Auto-splits into CGST/SGST/IGST below">
        <input
          type="number"
          step="0.5"
          min={0}
          max={50}
          value={combined}
          onChange={(e) => setCombined(e.target.value)}
          className={inputClass}
        />
      </Field>
      <Field label="HSN pattern" hint="Optional — applies only to HSNs matching">
        <input
          type="text"
          value={hsnPattern}
          onChange={(e) => setHsnPattern(e.target.value)}
          className={inputClass + " font-mono"}
          placeholder="e.g. 6109% or 6203%"
        />
      </Field>
      <Field label="CGST %">
        <input
          type="number"
          step="0.5"
          min={0}
          max={50}
          value={cgst}
          onChange={(e) => setCgst(e.target.value)}
          className={inputClass}
        />
      </Field>
      <Field label="SGST %">
        <input
          type="number"
          step="0.5"
          min={0}
          max={50}
          value={sgst}
          onChange={(e) => setSgst(e.target.value)}
          className={inputClass}
        />
      </Field>
      <Field label="IGST %">
        <input
          type="number"
          step="0.5"
          min={0}
          max={50}
          value={igst}
          onChange={(e) => setIgst(e.target.value)}
          className={inputClass}
        />
      </Field>
      <Field label="Cess %">
        <input
          type="number"
          step="0.5"
          min={0}
          max={50}
          value={cess}
          onChange={(e) => setCess(e.target.value)}
          className={inputClass}
        />
      </Field>
      <Field label="Default" className="lg:col-span-2">
        <label className="flex items-center gap-2 h-9">
          <input
            type="checkbox"
            checked={isDefault}
            onChange={(e) => setIsDefault(e.target.checked)}
            className="h-4 w-4"
          />
          <span className="text-[13px] text-ink-700">
            Make this the default rate (used when no HSN match)
          </span>
        </label>
      </Field>

      <div className="lg:col-span-2 flex items-center justify-end gap-3 pt-2">
        {error ? <span className="text-[13px] text-red-700">{error}</span> : null}
        <Button busy={pending} icon={<Save className="h-3.5 w-3.5" />} type="submit">
          Create rate
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
