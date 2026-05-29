"use client";

import { useState, useTransition, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Save } from "lucide-react";
import { Button } from "@/components/admin/ui/primitives-client";

type Line = {
  description: string;
  qty: number;
  unitPriceRupees: string;
  taxRupees: string;
};

export function NewPurchaseInvoiceForm({
  suppliers,
  purchaseOrders,
}: {
  suppliers: { id: string; name: string }[];
  purchaseOrders: {
    id: string;
    poNumber: string;
    supplierId: string;
    grandTotal: number;
  }[];
}) {
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);
  const [supplierId, setSupplierId] = useState("");
  const [poId, setPoId] = useState("");
  const [supplierInvoiceNumber, setSupplierInvoiceNumber] = useState("");
  const [supplierInvoiceDate, setSupplierInvoiceDate] = useState(today);
  const [postingDate, setPostingDate] = useState(today);
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([
    { description: "", qty: 1, unitPriceRupees: "", taxRupees: "0" },
  ]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const filteredPOs = useMemo(
    () => (supplierId ? purchaseOrders.filter((p) => p.supplierId === supplierId) : []),
    [supplierId, purchaseOrders]
  );

  const totals = useMemo(() => {
    let sub = 0;
    let tax = 0;
    for (const l of lines) {
      const u = Math.round((Number(l.unitPriceRupees) || 0) * 100);
      const t = Math.round((Number(l.taxRupees) || 0) * 100);
      sub += u * l.qty;
      tax += t;
    }
    return { sub, tax, grand: sub + tax };
  }, [lines]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!supplierId) {
      setError("Pick a supplier");
      return;
    }
    if (lines.some((l) => !l.description.trim() || l.qty < 1 || !l.unitPriceRupees)) {
      setError("Each line needs description, qty, and unit price");
      return;
    }
    start(async () => {
      const r = await fetch("/api/admin/purchase-invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplierId,
          poId: poId || null,
          supplierInvoiceNumber: supplierInvoiceNumber || null,
          supplierInvoiceDate: supplierInvoiceDate || null,
          postingDate,
          dueDate: dueDate || null,
          notes: notes || null,
          items: lines.map((l) => ({
            description: l.description.trim(),
            qty: l.qty,
            unitPrice: Math.round((Number(l.unitPriceRupees) || 0) * 100),
            taxAmount: Math.round((Number(l.taxRupees) || 0) * 100),
          })),
        }),
      });
      const data = await r.json();
      if (!r.ok) {
        setError(data.error ?? "Failed");
        return;
      }
      router.push("/admin/purchase-invoices");
    });
  };

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Field label="Supplier" required>
          <select
            value={supplierId}
            onChange={(e) => {
              setSupplierId(e.target.value);
              setPoId("");
            }}
            required
            className={inputClass}
          >
            <option value="">— Pick supplier —</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Linked PO" hint="Optional">
          <select
            value={poId}
            onChange={(e) => setPoId(e.target.value)}
            className={inputClass}
            disabled={!supplierId}
          >
            <option value="">— None —</option>
            {filteredPOs.map((p) => (
              <option key={p.id} value={p.id}>
                {p.poNumber} · ₹{(p.grandTotal / 100).toLocaleString("en-IN")}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Supplier bill #">
          <input
            value={supplierInvoiceNumber}
            onChange={(e) => setSupplierInvoiceNumber(e.target.value)}
            className={inputClass}
            placeholder="As printed on bill"
          />
        </Field>
        <Field label="Supplier bill date">
          <input
            type="date"
            value={supplierInvoiceDate}
            onChange={(e) => setSupplierInvoiceDate(e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Posting date" required>
          <input
            type="date"
            value={postingDate}
            onChange={(e) => setPostingDate(e.target.value)}
            required
            className={inputClass}
          />
        </Field>
        <Field label="Due date">
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className={inputClass}
          />
        </Field>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-[14px] font-semibold text-ink-900">Line items</h3>
          <Button
            type="button"
            variant="secondary"
            icon={<Plus className="h-3.5 w-3.5" />}
            onClick={() =>
              setLines([
                ...lines,
                { description: "", qty: 1, unitPriceRupees: "", taxRupees: "0" },
              ])
            }
          >
            Add line
          </Button>
        </div>
        <table className="w-full text-[13px]">
          <thead className="bg-cream-50">
            <tr>
              <th className="px-3 py-2 text-left">Description</th>
              <th className="px-3 py-2 text-right w-24">Qty</th>
              <th className="px-3 py-2 text-right w-32">Unit (₹)</th>
              <th className="px-3 py-2 text-right w-28">Tax (₹)</th>
              <th className="px-3 py-2 text-right w-28">Line total</th>
              <th className="px-3 py-2 w-10"></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, idx) => {
              const lineTotal =
                Math.round((Number(l.unitPriceRupees) || 0) * 100) * l.qty +
                Math.round((Number(l.taxRupees) || 0) * 100);
              return (
                <tr key={idx} className="border-t border-ink-100/70">
                  <td className="px-3 py-1.5">
                    <input
                      type="text"
                      value={l.description}
                      onChange={(e) =>
                        setLines(
                          lines.map((x, i) =>
                            i === idx ? { ...x, description: e.target.value } : x
                          )
                        )
                      }
                      className={inputClass}
                    />
                  </td>
                  <td className="px-3 py-1.5">
                    <input
                      type="number"
                      min={1}
                      value={l.qty}
                      onChange={(e) =>
                        setLines(
                          lines.map((x, i) =>
                            i === idx
                              ? { ...x, qty: Math.max(1, Number(e.target.value)) }
                              : x
                          )
                        )
                      }
                      className={inputClass + " text-right"}
                    />
                  </td>
                  <td className="px-3 py-1.5">
                    <input
                      type="number"
                      step="0.01"
                      min={0}
                      value={l.unitPriceRupees}
                      onChange={(e) =>
                        setLines(
                          lines.map((x, i) =>
                            i === idx ? { ...x, unitPriceRupees: e.target.value } : x
                          )
                        )
                      }
                      className={inputClass + " text-right"}
                    />
                  </td>
                  <td className="px-3 py-1.5">
                    <input
                      type="number"
                      step="0.01"
                      min={0}
                      value={l.taxRupees}
                      onChange={(e) =>
                        setLines(
                          lines.map((x, i) =>
                            i === idx ? { ...x, taxRupees: e.target.value } : x
                          )
                        )
                      }
                      className={inputClass + " text-right"}
                    />
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums font-semibold">
                    ₹{(lineTotal / 100).toFixed(2)}
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    {lines.length > 1 ? (
                      <button
                        type="button"
                        onClick={() => setLines(lines.filter((_, i) => i !== idx))}
                        className="text-ink-400 hover:text-red-600"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="border-t-2 border-ink-200 bg-cream-50">
            <tr>
              <td colSpan={4} className="px-3 py-2 text-right font-semibold">
                Subtotal
              </td>
              <td className="px-3 py-2 text-right tabular-nums font-bold">
                ₹{(totals.sub / 100).toFixed(2)}
              </td>
              <td></td>
            </tr>
            <tr>
              <td colSpan={4} className="px-3 py-1 text-right">
                Tax
              </td>
              <td className="px-3 py-1 text-right tabular-nums">
                ₹{(totals.tax / 100).toFixed(2)}
              </td>
              <td></td>
            </tr>
            <tr className="border-t border-ink-200">
              <td colSpan={4} className="px-3 py-2 text-right font-bold">
                Grand total
              </td>
              <td className="px-3 py-2 text-right tabular-nums font-bold text-[15px]">
                ₹{(totals.grand / 100).toFixed(2)}
              </td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>

      <Field label="Notes">
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          className={inputClass + " py-2 h-auto"}
        />
      </Field>

      <div className="flex items-center justify-end gap-3 pt-2 border-t border-ink-100/70">
        {error ? <span className="text-[13px] text-red-700">{error}</span> : null}
        <Button busy={pending} icon={<Save className="h-3.5 w-3.5" />} type="submit">
          Save invoice
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
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-[12px] font-semibold text-ink-700">
        {label}
        {required ? <span className="text-red-600 ml-0.5">*</span> : null}
      </span>
      {hint ? <span className="text-[11px] text-ink-500 ml-2">{hint}</span> : null}
      <div className="mt-1.5">{children}</div>
    </label>
  );
}
