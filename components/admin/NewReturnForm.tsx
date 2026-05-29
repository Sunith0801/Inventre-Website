"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Save } from "lucide-react";
import { Button } from "@/components/admin/ui/primitives-client";

type LineDto = {
  id: string;
  variantId: string;
  name: string;
  size: string;
  qty: number;
  total: number; // paise
};

const REASONS = [
  "Wrong size",
  "Damaged in transit",
  "Defective product",
  "Wrong item shipped",
  "Quality not as expected",
  "Customer changed mind",
  "Other",
];

const CONDITIONS = [
  { value: "unopened", label: "Unopened" },
  { value: "opened", label: "Opened" },
  { value: "damaged", label: "Damaged / defective" },
] as const;

export function NewReturnForm({
  orderId,
  orderNumber,
  items,
}: {
  orderId: string;
  orderNumber: string;
  items: LineDto[];
}) {
  const router = useRouter();
  const [picks, setPicks] = useState<Record<string, number>>({});
  const [conds, setConds] = useState<Record<string, (typeof CONDITIONS)[number]["value"]>>({});
  const [reason, setReason] = useState(REASONS[0]);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const refund = items.reduce((sum, line) => {
    const q = picks[line.id] ?? 0;
    const unit = line.qty > 0 ? Math.round(line.total / line.qty) : 0;
    return sum + unit * q;
  }, 0);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const selected = Object.entries(picks).filter(([, q]) => q > 0);
    if (selected.length === 0) {
      setError("Pick at least one line and a quantity to return.");
      return;
    }
    start(async () => {
      const r = await fetch("/api/admin/returns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId,
          reason,
          notes: notes.trim() || null,
          items: selected.map(([id, qty]) => {
            const line = items.find((l) => l.id === id)!;
            return {
              orderItemId: id,
              variantId: line.variantId,
              qty,
              condition: conds[id],
            };
          }),
        }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setError(d.error ?? "Failed to create return");
        return;
      }
      const { returnNumber } = await r.json();
      // Show the new return in the list view.
      router.push(`/admin/returns?status=requested&new=${returnNumber}`);
    });
  };

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="rounded-xl border border-ink-100 overflow-hidden">
        <table className="w-full text-[13px]">
          <thead className="bg-cream-50">
            <tr className="text-left text-[11px] font-semibold tracking-[0.14em] uppercase text-ink-500">
              <th className="px-4 py-2.5">Item</th>
              <th className="px-4 py-2.5">Size</th>
              <th className="px-4 py-2.5 text-right">Bought</th>
              <th className="px-4 py-2.5 text-right">Returning</th>
              <th className="px-4 py-2.5">Condition</th>
            </tr>
          </thead>
          <tbody>
            {items.map((line) => {
              const picked = picks[line.id] ?? 0;
              return (
                <tr key={line.id} className="border-t border-ink-100">
                  <td className="px-4 py-2.5 font-medium">{line.name}</td>
                  <td className="px-4 py-2.5 text-ink-700 font-mono text-[12px]">
                    {line.size}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {line.qty}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <input
                      type="number"
                      min={0}
                      max={line.qty}
                      value={picked}
                      onChange={(e) => {
                        const next = Math.min(
                          Math.max(0, parseInt(e.target.value, 10) || 0),
                          line.qty
                        );
                        setPicks((cur) => ({ ...cur, [line.id]: next }));
                      }}
                      className="w-20 h-8 px-2 text-right rounded border border-ink-200 bg-white text-[13px]"
                    />
                  </td>
                  <td className="px-4 py-2.5">
                    <select
                      value={conds[line.id] ?? "unopened"}
                      onChange={(e) =>
                        setConds((cur) => ({
                          ...cur,
                          [line.id]: e.target
                            .value as (typeof CONDITIONS)[number]["value"],
                        }))
                      }
                      disabled={picked === 0}
                      className="h-8 px-2 rounded border border-ink-200 bg-white text-[13px] disabled:bg-cream-100"
                    >
                      {CONDITIONS.map((c) => (
                        <option key={c.value} value={c.value}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Field label="Reason" required>
          <select
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className={inputClass}
          >
            {REASONS.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </Field>
        <Field label="Notes (optional)">
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className={inputClass}
            placeholder="Anything the warehouse team should know"
          />
        </Field>
      </div>

      <div className="flex items-center justify-between border-t border-ink-100 pt-4">
        <div>
          <span className="text-[12px] text-ink-500">Refund amount (computed)</span>
          <div className="font-display text-[20px] font-extrabold text-ink-900">
            ₹{(refund / 100).toLocaleString("en-IN")}
          </div>
        </div>
        <div className="flex items-center gap-3">
          {error ? <span className="text-[13px] text-red-700">{error}</span> : null}
          <Button busy={pending} icon={<Save className="h-3.5 w-3.5" />} type="submit">
            Create return
          </Button>
        </div>
      </div>

      <p className="text-[11px] text-ink-400">
        Order: <code className="font-mono">{orderNumber}</code>
      </p>
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
