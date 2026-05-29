"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PackageCheck, X } from "lucide-react";
import { Button } from "@/components/admin/ui/primitives-client";

type Item = {
  poItemId: string;
  description: string;
  qty: number;
  receivedQty: number;
};

export function ReceivePoButton({
  poId,
  warehouses,
  items,
}: {
  poId: string;
  warehouses: { id: string; name: string; isDefault: boolean }[];
  items: Item[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const defaultWh = warehouses.find((w) => w.isDefault) ?? warehouses[0];
  const [warehouseId, setWarehouseId] = useState(defaultWh?.id ?? "");
  const initial: Record<string, number> = {};
  for (const it of items) initial[it.poItemId] = it.qty - it.receivedQty;
  const [picks, setPicks] = useState<Record<string, number>>(initial);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const submit = () => {
    const linesToReceive = items
      .filter((it) => (picks[it.poItemId] ?? 0) > 0)
      .map((it) => ({ poItemId: it.poItemId, qty: picks[it.poItemId] }));
    if (linesToReceive.length === 0) {
      setError("Pick at least one line");
      return;
    }
    setError(null);
    start(async () => {
      const r = await fetch("/api/admin/purchase-receipts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          poId,
          warehouseId,
          items: linesToReceive,
          notes: notes || null,
        }),
      });
      const data = await r.json();
      if (!r.ok) {
        setError(data.error ?? "Failed");
        return;
      }
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <>
      <Button
        icon={<PackageCheck className="h-3.5 w-3.5" />}
        variant="primary"
        onClick={() => setOpen(true)}
        type="button"
      >
        Receive
      </Button>

      {open ? (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-2xl rounded-2xl bg-white shadow-xl border border-ink-100 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-5 border-b border-ink-100/70">
              <div>
                <h3 className="text-[16px] font-bold text-ink-900">Receive into stock</h3>
                <p className="text-[12px] text-ink-500 mt-0.5">
                  Posts to bins + ledger; PO line received_qty advances.
                </p>
              </div>
              <button
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="p-2 rounded-lg text-ink-500 hover:bg-cream-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <label className="block">
                <span className="text-[12px] font-semibold text-ink-700">
                  Receive into warehouse
                </span>
                <select
                  value={warehouseId}
                  onChange={(e) => setWarehouseId(e.target.value)}
                  className="block w-full mt-1.5 h-9 px-3 text-[13px] rounded-lg bg-white border border-ink-200"
                >
                  {warehouses.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                      {w.isDefault ? " (default)" : ""}
                    </option>
                  ))}
                </select>
              </label>

              <div>
                <h4 className="text-[12px] font-semibold text-ink-700 uppercase tracking-wider mb-2">
                  Lines
                </h4>
                <table className="w-full text-[13px]">
                  <thead className="bg-cream-50">
                    <tr>
                      <th className="px-3 py-2 text-left">Description</th>
                      <th className="px-3 py-2 text-right">Ordered</th>
                      <th className="px-3 py-2 text-right">Already received</th>
                      <th className="px-3 py-2 text-right w-24">Receive now</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((it) => {
                      const remaining = it.qty - it.receivedQty;
                      return (
                        <tr key={it.poItemId} className="border-t border-ink-100/70">
                          <td className="px-3 py-2">{it.description}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{it.qty}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-ink-500">
                            {it.receivedQty}
                          </td>
                          <td className="px-3 py-2 text-right">
                            <input
                              type="number"
                              min={0}
                              max={remaining}
                              value={picks[it.poItemId] ?? 0}
                              onChange={(e) =>
                                setPicks({
                                  ...picks,
                                  [it.poItemId]: Math.max(
                                    0,
                                    Math.min(remaining, Number(e.target.value))
                                  ),
                                })
                              }
                              className="w-20 h-9 px-2 text-right text-[13px] rounded-lg bg-white border border-ink-200"
                              disabled={remaining <= 0}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <label className="block">
                <span className="text-[12px] font-semibold text-ink-700">
                  Notes (optional)
                </span>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  className="block w-full mt-1.5 px-3 py-2 text-[13px] rounded-lg bg-white border border-ink-200"
                />
              </label>
            </div>

            <div className="flex items-center justify-end gap-2 p-5 border-t border-ink-100/70 bg-cream-50/40">
              {error ? (
                <span className="text-[13px] text-red-700 mr-auto">{error}</span>
              ) : null}
              <Button variant="secondary" type="button" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button busy={pending} onClick={submit} type="button">
                Receive
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
