"use client";

import { useState, useEffect } from "react";

type Variant = {
  id: string;
  productName: string;
  size: string;
  sku: string;
};

export default function StockAdjustPage() {
  const [variants, setVariants] = useState<Variant[]>([]);
  const [variantId, setVariantId] = useState("");
  const [delta, setDelta] = useState(0);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const r = await fetch("/api/admin/stock");
      const data = await r.json();
      const seen = new Set<string>();
      const list: Variant[] = [];
      for (const row of data.rows ?? []) {
        if (seen.has(row.variantId)) continue;
        seen.add(row.variantId);
        list.push({
          id: row.variantId,
          productName: row.productName,
          size: row.size,
          sku: row.sku,
        });
      }
      list.sort((a, b) => a.productName.localeCompare(b.productName));
      setVariants(list);
    })();
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!variantId || !notes.trim()) {
      setMsg("variant and notes required");
      return;
    }
    setBusy(true);
    setMsg(null);
    const r = await fetch("/api/admin/stock/adjust", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ variantId, delta: Number(delta), notes }),
    });
    const data = await r.json();
    setBusy(false);
    if (!r.ok) {
      setMsg(`Error: ${data.error}`);
    } else {
      setMsg(
        `✓ Adjusted. Bin: actual ${data.bin.actualQty}, reserved ${data.bin.reservedQty}, available ${data.bin.available}`
      );
      setDelta(0);
      setNotes("");
    }
  };

  return (
    <div className="max-w-2xl space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Adjust stock</h1>
        <p className="text-sm text-ink-600 mt-1">
          Increment or decrement actual stock for a variant. Writes to the
          stock ledger automatically.
        </p>
      </header>

      <form onSubmit={submit} className="space-y-4 border rounded-lg p-6 bg-cream-50">
        <label className="block">
          <span className="text-sm font-medium">Variant</span>
          <select
            value={variantId}
            onChange={(e) => setVariantId(e.target.value)}
            className="w-full mt-1 px-3 py-2 border rounded-lg"
            required
          >
            <option value="">— pick a variant —</option>
            {variants.map((v) => (
              <option key={v.id} value={v.id}>
                {v.productName} · size {v.size} · {v.sku}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-sm font-medium">Delta (+ to add, − to remove)</span>
          <input
            type="number"
            value={delta}
            onChange={(e) => setDelta(Number(e.target.value))}
            className="w-full mt-1 px-3 py-2 border rounded-lg"
            required
          />
        </label>

        <label className="block">
          <span className="text-sm font-medium">Reason / notes</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full mt-1 px-3 py-2 border rounded-lg"
            rows={3}
            placeholder="Cycle count adjustment, damaged units, found in storage…"
            required
          />
        </label>

        <button
          type="submit"
          disabled={busy}
          className="px-6 py-2 bg-ink-900 text-white rounded-lg disabled:opacity-50"
        >
          {busy ? "Adjusting…" : "Apply adjustment"}
        </button>

        {msg ? (
          <div className={msg.startsWith("✓") ? "text-emerald-700 text-sm" : "text-red-700 text-sm"}>
            {msg}
          </div>
        ) : null}
      </form>
    </div>
  );
}
