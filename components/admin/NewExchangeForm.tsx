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
};

const REASONS = [
  "Wrong size",
  "Damaged in transit",
  "Defective product",
  "Wrong item shipped",
  "Quality not as expected",
  "Other",
];

const CONDITIONS = [
  { value: "unopened", label: "Unopened" },
  { value: "opened", label: "Opened" },
  { value: "damaged", label: "Damaged / defective" },
] as const;

/**
 * Staff/SPOC form to raise an exchange on behalf of a parent. POSTs to
 * /api/admin/exchanges, which is gated by spoc-exchange.write and confined to
 * the actor's school (assertSchoolAccess). Photos are optional here (unlike the
 * parent flow) so a SPOC can log a phoned-in request.
 */
export function NewExchangeForm({
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

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const selected = Object.entries(picks).filter(([, q]) => q > 0);
    if (selected.length === 0) {
      setError("Pick at least one line and a quantity to exchange.");
      return;
    }
    start(async () => {
      const r = await fetch("/api/admin/exchanges", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId,
          notes: notes.trim() || null,
          perItem: selected.map(([id, qty]) => ({
            orderItemId: id,
            qty,
            reason,
            condition: conds[id],
            replacementMode: "same_fresh",
          })),
        }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setError(d.error ?? "Failed to raise exchange");
        return;
      }
      const { returnNumber } = await r.json();
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
              <th className="px-4 py-2.5 text-right">Exchanging</th>
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
                  <td className="px-4 py-2.5 text-right tabular-nums">{line.qty}</td>
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
            placeholder="Anything the warehouse / pickup team should know"
          />
        </Field>
      </div>

      <div className="flex items-center justify-end gap-3 border-t border-ink-100 pt-4">
        {error ? <span className="text-[13px] text-red-700">{error}</span> : null}
        <Button busy={pending} icon={<Save className="h-3.5 w-3.5" />} type="submit">
          Raise exchange
        </Button>
      </div>

      <p className="text-[11px] text-ink-400">
        Order: <code className="font-mono">{orderNumber}</code> · the parent is
        notified by SMS and a pickup is scheduled automatically.
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
