"use client";

import { useEffect, useRef, useState } from "react";
import { Search, Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";

export type PickedProduct = {
  id: string;
  name: string;
  itemCode: string | null;
  basePrice: number;
  kind?: string | null;
  variants: { id: string; size: string; sku: string }[];
};

/**
 * Type-ahead over /api/admin/products. The catalogue has 3,109 products and
 * 6,314 variants; a <select> that lists them all is what this replaces.
 * Results arrive with their variants, so the row that gets added already
 * knows which sizes it can bind to.
 */
export function ProductPicker({
  onPick,
  exclude = [],
  placeholder = "Search products by name or item code…",
  autoFocus,
  className,
}: {
  onPick: (p: PickedProduct) => void;
  /** Product ids to hide from results (the bundle's own product, for one). */
  exclude?: string[];
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<PickedProduct[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [cursor, setCursor] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const seq = useRef(0);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/admin/products?q=${encodeURIComponent(term)}&limit=15`);
        const d = (await r.json()) as { products?: PickedProduct[] };
        if (mine !== seq.current) return; // a newer keystroke won
        setResults((d.products ?? []).filter((p) => !exclude.includes(p.id)));
        setCursor(0);
        setOpen(true);
      } finally {
        if (mine === seq.current) setLoading(false);
      }
    }, 220);
    return () => clearTimeout(t);
    // `exclude` is a fresh array each render; comparing by contents is what we mean.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, exclude.join(",")]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  function pick(p: PickedProduct) {
    onPick(p);
    setQ("");
    setResults([]);
    setOpen(false);
  }

  return (
    <div ref={box} className={cn("relative", className)}>
      <div className="relative">
        {loading ? (
          <Loader2 className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-ink-400" />
        ) : (
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-400" />
        )}
        <input
          type="text"
          value={q}
          autoFocus={autoFocus}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => results.length && setOpen(true)}
          onKeyDown={(e) => {
            if (!open || !results.length) return;
            if (e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => Math.min(results.length - 1, c + 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => Math.max(0, c - 1)); }
            else if (e.key === "Enter") { e.preventDefault(); const p = results[cursor]; if (p) pick(p); }
            else if (e.key === "Escape") setOpen(false);
          }}
          placeholder={placeholder}
          role="combobox"
          aria-expanded={open}
          aria-controls="product-picker-results"
          aria-autocomplete="list"
          className="h-9 w-full rounded-lg border border-ink-100 bg-cream-50 pl-9 pr-3 text-[13px] placeholder:text-ink-400 transition-[background,border,box-shadow] focus:border-ink-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-300/40"
        />
      </div>
      {open && q.trim().length >= 2 ? (
        <ul
          id="product-picker-results"
          role="listbox"
          className="absolute left-0 right-0 z-30 mt-1 max-h-72 overflow-y-auto rounded-xl border border-ink-100 bg-white py-1 shadow-[0_10px_30px_rgba(10,10,10,0.10)]"
        >
          {results.length === 0 && !loading ? (
            <li className="px-3 py-2.5 text-[12.5px] text-ink-500">No products match “{q.trim()}”.</li>
          ) : null}
          {results.map((p, i) => (
            <li
              key={p.id}
              role="option"
              aria-selected={i === cursor}
              onMouseEnter={() => setCursor(i)}
              onMouseDown={(e) => { e.preventDefault(); pick(p); }}
              className={cn("flex cursor-pointer items-center gap-3 px-3 py-2", i === cursor ? "bg-cream-100" : "hover:bg-cream-50")}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-ink-900">{p.name}</span>
                <span className="block truncate text-[11.5px] text-ink-500">
                  {p.itemCode ? <span className="font-mono">{p.itemCode}</span> : null}
                  {p.itemCode && p.variants.length ? " · " : ""}
                  {p.variants.length ? `${p.variants.length} size${p.variants.length === 1 ? "" : "s"}` : ""}
                </span>
              </span>
              <span className="shrink-0 text-[12px] tabular-nums text-ink-600">₹{(p.basePrice / 100).toLocaleString("en-IN")}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
