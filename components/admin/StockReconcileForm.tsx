"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Save, Plus, Trash2, Search } from "lucide-react";
import { Button } from "@/components/admin/ui/primitives-client";

type Warehouse = { id: string; name: string; isDefault: boolean };

type StockRow = {
  variantId: string;
  productName: string;
  size: string;
  sku: string;
  actualQty: number;
};

type Line = {
  variantId: string;
  productName: string;
  size: string;
  sku: string;
  current: number;
  countedQty: number;
};

export function StockReconcileForm({ warehouses }: { warehouses: Warehouse[] }) {
  const router = useRouter();
  const defaultWh = warehouses.find((w) => w.isDefault) ?? warehouses[0];
  const [warehouseId, setWarehouseId] = useState(defaultWh?.id ?? "");
  const [allRows, setAllRows] = useState<StockRow[]>([]);
  const [search, setSearch] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    void (async () => {
      const r = await fetch("/api/admin/stock");
      const data = await r.json();
      setAllRows(
        (data.rows ?? []).map(
          (r: { variantId: string; productName: string; size: string; sku: string; actualQty: number }) => ({
            variantId: r.variantId,
            productName: r.productName,
            size: r.size,
            sku: r.sku,
            actualQty: r.actualQty,
          })
        )
      );
    })();
  }, []);

  const filtered = allRows.filter((r) => {
    if (!search.trim()) return false;
    const q = search.toLowerCase();
    return (
      r.productName.toLowerCase().includes(q) ||
      r.sku.toLowerCase().includes(q) ||
      r.size.toLowerCase().includes(q)
    );
  });

  const addLine = (r: StockRow) => {
    if (lines.find((l) => l.variantId === r.variantId)) return;
    setLines([
      ...lines,
      {
        variantId: r.variantId,
        productName: r.productName,
        size: r.size,
        sku: r.sku,
        current: r.actualQty,
        countedQty: r.actualQty,
      },
    ]);
    setSearch("");
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setResult(null);
    if (lines.length === 0) {
      setError("Add at least one line");
      return;
    }
    if (!notes.trim()) {
      setError("Reason / notes required");
      return;
    }
    if (
      !confirm(
        `Apply reconciliation for ${lines.length} variant${
          lines.length === 1 ? "" : "s"
        }? Each non-zero delta writes a ledger row.`
      )
    )
      return;
    start(async () => {
      const r = await fetch("/api/admin/stock/reconcile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          warehouseId,
          notes,
          lines: lines.map((l) => ({
            variantId: l.variantId,
            countedQty: l.countedQty,
          })),
        }),
      });
      const data = await r.json();
      if (!r.ok) {
        setError(data.error ?? "Failed");
        return;
      }
      const moved = (data.results ?? []).filter(
        (x: { delta: number }) => x.delta !== 0
      ).length;
      setResult(`Reconciled ${data.reconciled} lines · ${moved} adjusted`);
      setLines([]);
      setNotes("");
      router.refresh();
    });
  };

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Field label="Warehouse" required>
          <select
            value={warehouseId}
            onChange={(e) => setWarehouseId(e.target.value)}
            className={inputClass}
          >
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
                {w.isDefault ? " (default)" : ""}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Reason / count batch reference" required>
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className={inputClass}
            placeholder="e.g. Q1 cycle count 2026"
            required
          />
        </Field>
      </div>

      <div>
        <h3 className="text-[14px] font-semibold text-ink-900 mb-2">Add variants</h3>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ink-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, SKU, or size…"
            className={inputClass + " pl-9"}
          />
        </div>
        {filtered.length > 0 ? (
          <ul className="mt-2 border border-ink-100/70 rounded-xl bg-white max-h-56 overflow-y-auto">
            {filtered.slice(0, 30).map((r) => (
              <li
                key={r.variantId}
                onClick={() => addLine(r)}
                className="px-3 py-2 hover:bg-cream-50 cursor-pointer flex items-center justify-between text-[13px] border-b border-ink-100/50 last:border-0"
              >
                <div>
                  <span className="font-medium">{r.productName}</span>
                  <span className="text-ink-500 ml-2">{r.size}</span>
                  <span className="font-mono text-[11px] text-ink-500 ml-2">{r.sku}</span>
                </div>
                <span className="tabular-nums text-ink-500">on hand: {r.actualQty}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {lines.length > 0 ? (
        <div>
          <h3 className="text-[14px] font-semibold text-ink-900 mb-2">
            Counted lines
          </h3>
          <table className="w-full text-[13px]">
            <thead className="bg-cream-50">
              <tr>
                <th className="px-3 py-2 text-left">Variant</th>
                <th className="px-3 py-2 text-right">On hand</th>
                <th className="px-3 py-2 text-right w-32">Counted</th>
                <th className="px-3 py-2 text-right">Δ</th>
                <th className="px-3 py-2 w-10"></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => {
                const delta = l.countedQty - l.current;
                return (
                  <tr key={l.variantId} className="border-t border-ink-100/70">
                    <td className="px-3 py-2">
                      <div className="font-medium">{l.productName}</div>
                      <div className="text-[11px] text-ink-500">
                        {l.size} · <span className="font-mono">{l.sku}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink-500">
                      {l.current}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <input
                        type="number"
                        min={0}
                        value={l.countedQty}
                        onChange={(e) =>
                          setLines(
                            lines.map((x) =>
                              x.variantId === l.variantId
                                ? { ...x, countedQty: Math.max(0, Number(e.target.value)) }
                                : x
                            )
                          )
                        }
                        className={inputClass + " text-right w-24"}
                      />
                    </td>
                    <td
                      className={
                        "px-3 py-2 text-right tabular-nums font-semibold " +
                        (delta > 0
                          ? "text-emerald-700"
                          : delta < 0
                          ? "text-red-700"
                          : "text-ink-400")
                      }
                    >
                      {delta > 0 ? "+" : ""}
                      {delta}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        onClick={() =>
                          setLines(lines.filter((x) => x.variantId !== l.variantId))
                        }
                        className="text-ink-400 hover:text-red-600"
                        aria-label="Remove"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      <div className="flex items-center justify-end gap-3 pt-2 border-t border-ink-100/70">
        {error ? <span className="text-[13px] text-red-700">{error}</span> : null}
        {result ? <span className="text-[13px] text-emerald-700">{result}</span> : null}
        <Button busy={pending} icon={<Save className="h-3.5 w-3.5" />} type="submit">
          Apply reconciliation
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
