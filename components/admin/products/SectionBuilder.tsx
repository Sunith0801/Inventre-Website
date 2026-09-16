"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, CheckCircle2, Circle, Minus, Plus, Trash2, Save, Search, Loader2, ChevronRight, AlertCircle } from "lucide-react";
import { Button, IconBtn } from "@/components/admin/ui/primitives-client";
import { FormError } from "@/components/admin/ui/form";
import { cn } from "@/lib/cn";

export type SectionDef = {
  groupKey: string;
  name: string;
  /** Category the item search is scoped to (Book kit sections). */
  categoryId?: string | null;
  /** Product kinds the item search is limited to (Magic box sub-bundles). */
  kinds?: string[];
  /** Only offer published products (a Magic box picks a published kit). */
  onlyPublished?: boolean;
  hint?: string;
};

export type SectionItem = { productId: string; name: string; itemCode: string | null; sku: string | null; basePrice: number; qty: number; stock: number | null };

type Found = { variantId: string; productId: string; name: string; itemCode: string | null; sku: string; size: string; basePrice: number; stock: number | null; status: string };

const rupees = (p: number) => `₹${(p / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

/**
 * The two-panel builder. Left: the sections this kit contains, each with a
 * saved/unsaved mark and an item count. Right: the open section — a search
 * box that finds inventory items in that section's scope, add one by one,
 * set quantity, "Save section". Saving jumps to the next unsaved section.
 * Nothing nests, nothing pops up.
 */
export function SectionBuilder({
  bundleId,
  master,
  initialSections,
  initialItems,
  chooseTitle,
  chooseHint,
}: {
  bundleId: string;
  /** The master list to tick from. */
  master: SectionDef[];
  /** Sections already chosen on the server, in order. */
  initialSections: { groupKey: string; name: string }[];
  /** Saved items per group key. */
  initialItems: Record<string, SectionItem[]>;
  chooseTitle: string;
  chooseHint: string;
}) {
  const router = useRouter();
  const [chosen, setChosen] = useState<string[]>(initialSections.map((s) => s.groupKey));
  const [chosenSaved, setChosenSaved] = useState<string[]>(initialSections.map((s) => s.groupKey));
  const [items, setItems] = useState<Record<string, SectionItem[]>>(initialItems);
  const [savedItems, setSavedItems] = useState<Record<string, SectionItem[]>>(initialItems);
  const [open, setOpen] = useState<string | null>(chosen.find((k) => !(initialItems[k]?.length)) ?? chosen[0] ?? null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const defOf = (k: string) => master.find((m) => m.groupKey === k);
  const sectionsDirty = chosen.join("|") !== chosenSaved.join("|");
  const isSaved = (k: string) => (savedItems[k]?.length ?? 0) > 0 && JSON.stringify(items[k] ?? []) === JSON.stringify(savedItems[k] ?? []);
  const isDirty = (k: string) => JSON.stringify(items[k] ?? []) !== JSON.stringify(savedItems[k] ?? []);
  const allSaved = chosen.length > 0 && !sectionsDirty && chosen.every(isSaved);

  function toggleSection(k: string) {
    setChosen((prev) => (prev.includes(k) ? prev.filter((x) => x !== k) : [...master.filter((m) => prev.includes(m.groupKey) || m.groupKey === k).map((m) => m.groupKey)]));
  }

  function saveSections() {
    setError(null);
    start(async () => {
      const r = await fetch(`/api/admin/bundles/${bundleId}/sections`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sections: chosen.map((k) => ({ groupKey: k, name: defOf(k)?.name ?? k })) }),
      });
      if (!r.ok) { const d = await r.json().catch(() => ({})); setError(d.error ?? "Could not save the sections."); return; }
      setChosenSaved(chosen);
      // Dropped sections lose their items server-side; mirror that.
      const keep = (o: Record<string, SectionItem[]>) => Object.fromEntries(Object.entries(o).filter(([k]) => chosen.includes(k)));
      setItems(keep); setSavedItems(keep);
      if (!open || !chosen.includes(open)) setOpen(chosen.find((k) => !isSaved(k)) ?? chosen[0] ?? null);
      router.refresh();
    });
  }

  function saveSection(k: string) {
    setError(null);
    const list = items[k] ?? [];
    if (list.length === 0) { setError("Add at least one item before saving this section."); return; }
    start(async () => {
      const r = await fetch(`/api/admin/bundles/${bundleId}/sections/${encodeURIComponent(k)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: defOf(k)?.name, components: list.map((it) => ({ productId: it.productId, qty: it.qty })) }),
      });
      if (!r.ok) { const d = await r.json().catch(() => ({})); setError(d.error ?? "Could not save this section."); return; }
      const nextSaved = { ...savedItems, [k]: list };
      setSavedItems(nextSaved);
      // Jump to the next section that still needs work.
      const next = chosen.find((x) => x !== k && !((nextSaved[x]?.length ?? 0) > 0));
      if (next) setOpen(next);
      router.refresh();
    });
  }

  const setList = (k: string, fn: (l: SectionItem[]) => SectionItem[]) => setItems((prev) => ({ ...prev, [k]: fn(prev[k] ?? []) }));
  const totalItems = chosen.reduce((a, k) => a + (items[k]?.length ?? 0), 0);
  const totalValue = chosen.reduce((a, k) => a + (items[k] ?? []).reduce((b, it) => b + it.basePrice * it.qty, 0), 0);

  return (
    <div className="space-y-5">
      {error ? <FormError>{error}</FormError> : null}

      {/* ── Stage 1: tick the sections ── */}
      <section className="rounded-2xl border border-ink-100/70 bg-white p-5">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <h3 className="text-[14px] font-semibold text-ink-900">{chooseTitle}</h3>
            <p className="text-[12px] text-ink-500">{chooseHint}</p>
          </div>
          <Button size="sm" busy={pending} disabled={!sectionsDirty || chosen.length === 0} icon={<Save className="h-3.5 w-3.5" />} onClick={saveSections}>
            Save sections
          </Button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {master.map((m) => {
            const on = chosen.includes(m.groupKey);
            const count = items[m.groupKey]?.length ?? 0;
            return (
              <button key={m.groupKey} type="button" aria-pressed={on} onClick={() => toggleSection(m.groupKey)}
                className={cn("inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12.5px] font-medium transition-colors", on ? "border-ink-900 bg-ink-900 text-white" : "border-ink-100 bg-white text-ink-700 hover:border-ink-300")}>
                {on ? <Check className="h-3 w-3" /> : null}{m.name}{on && count ? <span className="text-white/60">· {count}</span> : null}
              </button>
            );
          })}
        </div>
        {sectionsDirty ? <p className="mt-2 text-[12px] text-amber-800">Save the sections before adding items. Removing a section removes its items.</p> : null}
      </section>

      {/* ── Stage 2: the two panels ── */}
      {chosenSaved.length > 0 ? (
        <div className={cn("grid grid-cols-1 gap-5 lg:grid-cols-3", sectionsDirty && "pointer-events-none opacity-50")}>
          <aside className="rounded-2xl border border-ink-100/70 bg-white lg:sticky lg:top-4 lg:self-start">
            <div className="border-b border-ink-100/70 px-4 py-3">
              <h3 className="text-[13px] font-semibold text-ink-900">Kit structure</h3>
              <p className="text-[12px] text-ink-500">{totalItems} item{totalItems === 1 ? "" : "s"} · {rupees(totalValue)}</p>
            </div>
            <ul className="divide-y divide-ink-100/70">
              {chosenSaved.map((k) => {
                const saved = isSaved(k), dirty = isDirty(k), count = items[k]?.length ?? 0;
                return (
                  <li key={k}>
                    <button type="button" onClick={() => setOpen(k)} className={cn("flex w-full items-center gap-2.5 px-4 py-2.5 text-left transition-colors hover:bg-cream-50", open === k && "bg-cream-100/80")}>
                      {saved ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" /> : dirty ? <AlertCircle className="h-4 w-4 shrink-0 text-amber-500" /> : <Circle className="h-4 w-4 shrink-0 text-ink-300" />}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium text-ink-900">{defOf(k)?.name ?? k}</span>
                        <span className="block text-[11.5px] text-ink-500">{count ? `${count} item${count === 1 ? "" : "s"}` : "empty"}{dirty ? " · unsaved" : saved ? " · saved" : ""}</span>
                      </span>
                      <ChevronRight className={cn("h-3.5 w-3.5 text-ink-300", open === k && "text-ink-700")} />
                    </button>
                  </li>
                );
              })}
            </ul>
            <div className={cn("border-t border-ink-100/70 px-4 py-2.5 text-[12px]", allSaved ? "text-emerald-700" : "text-ink-500")}>
              {allSaved ? "Every section saved — price & publish is open." : `${chosenSaved.filter((k) => !isSaved(k)).length} section${chosenSaved.filter((k) => !isSaved(k)).length === 1 ? "" : "s"} still to save.`}
            </div>
          </aside>

          <div className="lg:col-span-2">
            {open && chosenSaved.includes(open) ? (
              <SectionPanel
                key={open}
                def={defOf(open) ?? { groupKey: open, name: open }}
                items={items[open] ?? []}
                dirty={isDirty(open)}
                pending={pending}
                excludeProductIds={[]}
                onAdd={(f) => setList(open, (l) => (l.some((x) => x.productId === f.productId) ? l : [...l, { productId: f.productId, name: f.name, itemCode: f.itemCode, sku: f.sku, basePrice: f.basePrice, qty: 1, stock: f.stock }]))}
                onQty={(pid, qty) => setList(open, (l) => l.map((x) => (x.productId === pid ? { ...x, qty: Math.max(1, qty) } : x)))}
                onRemove={(pid) => setList(open, (l) => l.filter((x) => x.productId !== pid))}
                onSave={() => saveSection(open)}
              />
            ) : (
              <div className="rounded-2xl border border-dashed border-ink-200 px-6 py-12 text-center text-[13px] text-ink-500">Pick a section on the left.</div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SectionPanel({ def, items, dirty, pending, onAdd, onQty, onRemove, onSave }: {
  def: SectionDef; items: SectionItem[]; dirty: boolean; pending: boolean; excludeProductIds: string[];
  onAdd: (f: Found) => void; onQty: (pid: string, qty: number) => void; onRemove: (pid: string) => void; onSave: () => void;
}) {
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Found[]>([]);
  const [scope, setScope] = useState<"category" | "all">("category");
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);
  const have = useMemo(() => new Set(items.map((i) => i.productId)), [items]);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setFound([]); return; }
    setLoading(true);
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      const p = new URLSearchParams({ q: term, limit: "12" });
      if (def.categoryId) p.set("categoryId", def.categoryId);
      if (def.kinds?.length) p.set("kinds", def.kinds.join(","));
      if (def.onlyPublished) p.set("status", "active");
      try {
        const r = await fetch(`/api/admin/inventory/search?${p}`);
        const d = (await r.json()) as { items?: Found[]; scope?: "category" | "all" };
        if (mine !== seq.current) return;
        // One row per product — the kit lists products, sizes are picked at checkout.
        const seen = new Set<string>();
        setFound((d.items ?? []).filter((f) => (seen.has(f.productId) ? false : (seen.add(f.productId), true))));
        setScope(d.scope ?? "category");
      } finally { if (mine === seq.current) setLoading(false); }
    }, 220);
    return () => clearTimeout(t);
  }, [q, def.categoryId, def.kinds, def.onlyPublished]);

  const value = items.reduce((a, i) => a + i.basePrice * i.qty, 0);

  return (
    <section className="rounded-2xl border border-ink-100/70 bg-white">
      <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-ink-100/70 px-5 py-3">
        <div>
          <h3 className="text-[14px] font-semibold text-ink-900">{def.name}</h3>
          <p className="text-[12px] text-ink-500">{def.hint ?? "Search an item, add it, set how many."}</p>
        </div>
        <Button size="sm" busy={pending} disabled={!dirty || items.length === 0} icon={<Save className="h-3.5 w-3.5" />} onClick={onSave}>Save section</Button>
      </div>
      <div className="p-5">
        <div className="relative">
          {loading ? <Loader2 className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-ink-400" /> : <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-400" />}
          <input type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Add to ${def.name} — SKU or item name…`} autoFocus
            className="h-9 w-full rounded-lg border border-ink-100 bg-cream-50 pl-9 pr-3 text-[13px] placeholder:text-ink-400 focus:border-ink-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-300/40" />
        </div>
        {q.trim().length >= 2 ? (
          <ul className="mt-1 max-h-64 overflow-y-auto rounded-xl border border-ink-100 bg-white py-1 shadow-[0_10px_30px_rgba(10,10,10,0.08)]">
            {scope === "all" && def.categoryId && found.length ? <li className="px-3 py-1.5 text-[11.5px] text-amber-800">Nothing filed under {def.name} yet — showing all inventory.</li> : null}
            {found.length === 0 && !loading ? <li className="px-3 py-2.5 text-[12.5px] text-ink-500">No match. Items come from inventory — add it there first.</li> : null}
            {found.map((f) => (
              <li key={f.productId}>
                <button type="button" disabled={have.has(f.productId)} onClick={() => { onAdd(f); setQ(""); }} className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-cream-50 disabled:opacity-40">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-ink-900">{f.name}</span>
                    <span className="block truncate text-[11.5px] text-ink-500"><span className="font-mono">{f.itemCode ?? f.sku}</span>{f.status !== "active" ? " · not published" : ""}</span>
                  </span>
                  <span className="shrink-0 text-[12px] tabular-nums text-ink-600">{rupees(f.basePrice)}</span>
                  {have.has(f.productId) ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Plus className="h-3.5 w-3.5 text-ink-400" />}
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        <div className="mt-4 overflow-x-auto rounded-xl border border-ink-100/70">
          <table className="w-full text-[13px]">
            <thead className="bg-cream-50/60 text-[11px] uppercase tracking-[0.08em] text-ink-500">
              <tr><th className="px-3 py-2 text-left font-semibold">Item</th><th className="w-28 px-2 py-2 text-center font-semibold">Qty</th><th className="w-24 px-2 py-2 text-right font-semibold">Line</th><th className="w-10 px-2 py-2" /></tr>
            </thead>
            <tbody>
              {items.length === 0 ? <tr><td colSpan={4} className="px-4 py-8 text-center text-[12.5px] text-ink-500">Nothing in {def.name} yet.</td></tr> : null}
              {items.map((it) => (
                <tr key={it.productId} className="border-t border-ink-100/70">
                  <td className="px-3 py-2">
                    <span className="block font-medium text-ink-900">{it.name}</span>
                    <span className="block text-[11.5px] text-ink-500"><span className="font-mono">{it.itemCode ?? it.sku ?? ""}</span> · {rupees(it.basePrice)}{it.stock != null ? ` · ${it.stock} in stock` : ""}</span>
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex items-center justify-center gap-1">
                      <IconBtn size="sm" label="Less" icon={<Minus className="h-3 w-3" />} disabled={it.qty <= 1} onClick={() => onQty(it.productId, it.qty - 1)} />
                      <span className="w-8 text-center tabular-nums">{it.qty}</span>
                      <IconBtn size="sm" label="More" icon={<Plus className="h-3 w-3" />} onClick={() => onQty(it.productId, it.qty + 1)} />
                    </div>
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums text-ink-700">{rupees(it.basePrice * it.qty)}</td>
                  <td className="px-2 py-2 text-right"><IconBtn size="sm" tone="danger" label="Remove" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => onRemove(it.productId)} /></td>
                </tr>
              ))}
            </tbody>
            {items.length ? <tfoot><tr className="border-t border-ink-100/70 bg-cream-50/40"><td className="px-3 py-2 text-[12px] font-semibold text-ink-700">{items.length} item{items.length === 1 ? "" : "s"}</td><td /><td className="px-2 py-2 text-right text-[12.5px] font-semibold tabular-nums text-ink-900">{rupees(value)}</td><td /></tr></tfoot> : null}
          </table>
        </div>
      </div>
    </section>
  );
}
