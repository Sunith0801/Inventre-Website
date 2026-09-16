"use client";

import { useEffect, useRef, useState } from "react";
import { Search, Loader2, PackageSearch } from "lucide-react";
import { cn } from "@/lib/cn";

export type InventoryItem = {
  variantId: string;
  productId: string;
  name: string;
  itemCode: string | null;
  sku: string;
  size: string;
  kind: string;
  status: string;
  categoryId: string | null;
  basePrice: number;
  baseMrp: number | null;
  stock: number | null;
};

/**
 * "SKU or item name" over the inventory, filtered to one sub-category.
 * Picking a result is the whole point: the admin maps an item that
 * already exists rather than typing a duplicate. No result → the item
 * has to be added to inventory (the ERP sync) first.
 */
export function InventorySearch({
  categoryId,
  onPick,
  picked,
  onClear,
}: {
  categoryId: string | null;
  onPick: (item: InventoryItem) => void;
  picked: InventoryItem | null;
  onClear: () => void;
}) {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [scope, setScope] = useState<"category" | "all">("category");
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setItems([]); setSearched(false); return; }
    setLoading(true);
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      const p = new URLSearchParams({ q: term, limit: "12", kinds: "book,consumable,accessory" });
      if (categoryId) p.set("categoryId", categoryId);
      try {
        const r = await fetch(`/api/admin/inventory/search?${p}`);
        const d = (await r.json()) as { items?: InventoryItem[]; scope?: "category" | "all" };
        if (mine !== seq.current) return;
        setItems(d.items ?? []);
        setScope(d.scope ?? "category");
        setSearched(true);
      } finally {
        if (mine === seq.current) setLoading(false);
      }
    }, 220);
    return () => clearTimeout(t);
  }, [q, categoryId]);

  if (picked) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50/60 px-4 py-3">
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-semibold text-ink-900">{picked.name}</span>
          <span className="block text-[12px] text-ink-600">
            SKU <span className="font-mono">{picked.sku}</span>
            {picked.itemCode && picked.itemCode !== picked.sku ? <> · code <span className="font-mono">{picked.itemCode}</span></> : null}
            {" · "}stock {picked.stock == null ? "not counted" : picked.stock}
            {picked.status === "active" ? " · already published" : ""}
          </span>
        </span>
        <button type="button" onClick={onClear} className="text-[12px] font-semibold text-ink-500 hover:text-ink-900">Change</button>
      </div>
    );
  }

  return (
    <div>
      <div className="relative">
        {loading ? <Loader2 className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-ink-400" /> : <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-400" />}
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={categoryId ? "SKU or item name in this sub-category…" : "Pick a sub-category first, then search…"}
          disabled={!categoryId}
          className="h-9 w-full rounded-lg border border-ink-100 bg-cream-50 pl-9 pr-3 text-[13px] placeholder:text-ink-400 focus:border-ink-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-300/40 disabled:opacity-60"
        />
      </div>
      {q.trim().length >= 2 ? (
        <ul className="mt-1 max-h-72 overflow-y-auto rounded-xl border border-ink-100 bg-white py-1 shadow-[0_10px_30px_rgba(10,10,10,0.08)]">
          {scope === "all" && items.length > 0 && categoryId ? (
            <li className="px-3 py-1.5 text-[11.5px] text-amber-800">Nothing is filed under this sub-category yet — showing all inventory. Picking one files it here.</li>
          ) : null}
          {items.map((it) => (
            <li key={it.variantId}>
              <button type="button" onClick={() => onPick(it)} className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-cream-50">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-ink-900">{it.name}</span>
                  <span className="block truncate text-[11.5px] text-ink-500"><span className="font-mono">{it.sku}</span>{it.size && it.size !== "Free" ? ` · ${it.size}` : ""}</span>
                </span>
                <span className={cn("shrink-0 text-[12px] tabular-nums", it.stock == null ? "text-ink-400" : it.stock > 0 ? "text-ink-700" : "text-red-700")}>{it.stock == null ? "—" : `${it.stock} in stock`}</span>
              </button>
            </li>
          ))}
          {searched && !loading && items.length === 0 ? (
            <li className="flex items-start gap-3 px-3 py-3">
              <PackageSearch className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <span className="text-[12.5px] text-ink-700">
                <span className="font-semibold">No inventory item matches “{q.trim()}”.</span>{" "}
                Add it to inventory first — items arrive from the ERP item sync under System Configuration → ERP sync.
              </span>
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
