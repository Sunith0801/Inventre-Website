"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Save, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/admin/ui/primitives-client";

type SupplierOpt = { id: string; name: string; code: string };
type Line = { description: string; qty: number; unitPrice: string };

const blankLine: Line = { description: "", qty: 1, unitPrice: "" };

export function NewPurchaseOrderForm({
  suppliers,
}: {
  suppliers: SupplierOpt[];
}) {
  const router = useRouter();
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id ?? "");
  const [orderDate, setOrderDate] = useState(
    new Date().toISOString().slice(0, 10)
  );
  const [expectedDate, setExpectedDate] = useState("");
  const [lines, setLines] = useState<Line[]>([{ ...blankLine }]);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const setLine = (i: number, patch: Partial<Line>) =>
    setLines((arr) => arr.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const addLine = () => setLines((arr) => [...arr, { ...blankLine }]);
  const rmLine = (i: number) =>
    setLines((arr) => (arr.length > 1 ? arr.filter((_, idx) => idx !== i) : arr));

  const subtotalPaise = lines.reduce((sum, l) => {
    const up = Math.round(parseFloat(l.unitPrice || "0") * 100);
    return sum + l.qty * up;
  }, 0);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!supplierId) {
      setError("Select a supplier");
      return;
    }
    const items = lines
      .filter((l) => l.description.trim() && l.qty > 0)
      .map((l) => ({
        description: l.description.trim(),
        qty: l.qty,
        unitPrice: Math.round(parseFloat(l.unitPrice || "0") * 100),
      }));
    if (items.length === 0) {
      setError("Add at least one line item");
      return;
    }
    start(async () => {
      const r = await fetch("/api/admin/purchase-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplierId,
          orderDate,
          expectedDate: expectedDate || null,
          items,
          notes: notes.trim() || null,
        }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setError(d.error ?? "Failed to create PO");
        return;
      }
      const { id } = await r.json();
      router.push(`/admin/purchase-orders/${id}`);
    });
  };

  return (
    <form onSubmit={submit} className="grid gap-5">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Field label="Supplier" required>
          <select
            value={supplierId}
            onChange={(e) => setSupplierId(e.target.value)}
            required
            className={inputClass}
          >
            <option value="" disabled>
              Select…
            </option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} · {s.code}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Order date" required>
          <input
            type="date"
            value={orderDate}
            onChange={(e) => setOrderDate(e.target.value)}
            required
            className={inputClass}
          />
        </Field>
        <Field label="Expected date">
          <input
            type="date"
            value={expectedDate}
            onChange={(e) => setExpectedDate(e.target.value)}
            className={inputClass}
          />
        </Field>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-[12px] font-semibold text-ink-700">Line items</span>
          <button
            type="button"
            onClick={addLine}
            className="inline-flex items-center gap-1 text-[12px] font-semibold text-brand-700 hover:text-brand-900"
          >
            <Plus className="h-3.5 w-3.5" /> Add line
          </button>
        </div>
        <div className="space-y-2">
          {lines.map((l, i) => (
            <div
              key={i}
              className="grid grid-cols-12 gap-2 items-start border border-ink-100 rounded-lg p-2 bg-cream-50/40"
            >
              <input
                placeholder="Description"
                value={l.description}
                onChange={(e) => setLine(i, { description: e.target.value })}
                className={inputClass + " col-span-6"}
              />
              <input
                type="number"
                min={1}
                value={l.qty}
                onChange={(e) =>
                  setLine(i, { qty: parseInt(e.target.value, 10) || 1 })
                }
                className={inputClass + " col-span-2"}
                placeholder="Qty"
              />
              <input
                type="number"
                step="0.01"
                min={0}
                value={l.unitPrice}
                onChange={(e) => setLine(i, { unitPrice: e.target.value })}
                className={inputClass + " col-span-3"}
                placeholder="Unit ₹"
              />
              <button
                type="button"
                onClick={() => rmLine(i)}
                className="col-span-1 grid place-items-center h-9 rounded-lg text-ink-400 hover:text-red-600 hover:bg-red-50"
                aria-label="Remove line"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      </div>

      <Field label="Notes">
        <textarea
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className={inputClass + " py-2"}
        />
      </Field>

      <div className="flex items-center justify-between border-t border-ink-100 pt-4">
        <div>
          <span className="text-[12px] text-ink-500">Subtotal</span>
          <div className="font-display text-[20px] font-extrabold text-ink-900">
            ₹{(subtotalPaise / 100).toLocaleString("en-IN")}
          </div>
        </div>
        <div className="flex items-center gap-3">
          {error ? <span className="text-[13px] text-red-700">{error}</span> : null}
          <Button busy={pending} icon={<Save className="h-3.5 w-3.5" />} type="submit">
            Create PO
          </Button>
        </div>
      </div>
    </form>
  );
}

const inputClass =
  "h-9 px-3 text-[13px] rounded-lg bg-white border border-ink-200 placeholder:text-ink-400 " +
  "focus:outline-none focus:border-ink-400 focus:ring-2 focus:ring-brand-300/30 transition";

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-[12px] font-semibold text-ink-700">
        {label}
        {required ? <span className="text-red-600 ml-0.5">*</span> : null}
      </span>
      <div className="mt-1.5">{children}</div>
    </label>
  );
}
