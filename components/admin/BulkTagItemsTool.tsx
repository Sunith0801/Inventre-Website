"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Search, Check, AlertCircle, Package, X } from "lucide-react";
import { cn } from "@/lib/cn";

export type TaggableProduct = {
  id: string;
  name: string;
  slug: string;
  kind: string;
  basePricePaise: number;
  baseMrpPaise: number | null;
  img: string | null;
  /** Currently bound to product_school for this school (any grade). */
  boundToSchool: boolean;
  /** product_grades row exists for this exact grade. */
  taggedAtThisGrade: boolean;
  currentIsRequired: boolean;
  currentOverridePricePaise: number | null;
  currentOverrideMrpPaise: number | null;
};

type FilterMode = "untagged" | "tagged" | "all";

type RowEdit = {
  selected: boolean;
  isRequired: boolean;
  /** Rupees as typed by admin; converted to paise on submit. Empty string =
   *  inherit base price (overridePrice will be sent as null). */
  overrideRupees: string;
  /** Per-school MRP override in rupees — drives strike-through on storefront.
   *  Empty string = inherit product base MRP. */
  overrideMrpRupees: string;
};

export function BulkTagItemsTool({
  schoolId,
  schoolName,
  grade,
  items,
}: {
  schoolId: string;
  schoolName: string;
  grade: string;
  items: TaggableProduct[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterMode>("untagged");
  const [kindFilter, setKindFilter] = useState<string>("all");

  // Per-row edit state, seeded from the current binding.
  const [edits, setEdits] = useState<Record<string, RowEdit>>(() => {
    const out: Record<string, RowEdit> = {};
    for (const it of items) {
      out[it.id] = {
        selected: false,
        isRequired: it.currentIsRequired,
        overrideRupees:
          it.currentOverridePricePaise != null
            ? String(Math.round(it.currentOverridePricePaise / 100))
            : "",
        overrideMrpRupees:
          it.currentOverrideMrpPaise != null
            ? String(Math.round(it.currentOverrideMrpPaise / 100))
            : "",
      };
    }
    return out;
  });

  const kinds = useMemo(() => {
    const set = new Set<string>();
    for (const it of items) if (it.kind) set.add(it.kind);
    return ["all", ...Array.from(set).sort()];
  }, [items]);

  // Visible rows after filters.
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((it) => {
      // Tagged/untagged filter — "untagged" hides rows already at this exact grade.
      if (filter === "untagged" && it.taggedAtThisGrade) return false;
      if (filter === "tagged" && !it.taggedAtThisGrade) return false;
      if (kindFilter !== "all" && it.kind !== kindFilter) return false;
      if (q && !it.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [items, query, filter, kindFilter]);

  const selectedIds = useMemo(
    () => visible.filter((v) => edits[v.id]?.selected).map((v) => v.id),
    [visible, edits]
  );

  // ── Select-all toggle for the currently visible rows.
  const allVisibleSelected = visible.length > 0 && selectedIds.length === visible.length;
  const toggleAllVisible = () => {
    setEdits((prev) => {
      const next = { ...prev };
      for (const v of visible) {
        next[v.id] = { ...next[v.id], selected: !allVisibleSelected };
      }
      return next;
    });
  };

  const patchRow = (id: string, patch: Partial<RowEdit>) =>
    setEdits((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));

  const submit = () => {
    setError(null);
    setSuccess(null);
    if (selectedIds.length === 0) {
      setError("Tick at least one product first.");
      return;
    }
    // Build payload. Reject any selected row whose override is non-empty
    // but not a valid non-negative integer (rupees).
    const rows: {
      productId: string;
      isRequired: boolean;
      overridePricePaise: number | null;
      overrideMrpPaise: number | null;
    }[] = [];
    const parseRupees = (raw: string, label: string, name: string) => {
      const v = raw.trim();
      if (v === "") return { ok: true as const, paise: null as number | null };
      const r = Number(v);
      if (!Number.isFinite(r) || r < 0 || !Number.isInteger(r)) {
        setError(`${label} for ${name} must be a whole number of rupees.`);
        return { ok: false as const, paise: null };
      }
      return { ok: true as const, paise: r * 100 };
    };
    for (const id of selectedIds) {
      const e = edits[id];
      const name = items.find((i) => i.id === id)?.name ?? "this product";
      const price = parseRupees(e.overrideRupees, "Override price", name);
      if (!price.ok) return;
      const mrp = parseRupees(e.overrideMrpRupees, "Override MRP", name);
      if (!mrp.ok) return;
      rows.push({
        productId: id,
        isRequired: e.isRequired,
        overridePricePaise: price.paise,
        overrideMrpPaise: mrp.paise,
      });
    }
    start(async () => {
      try {
        const r = await fetch("/api/admin/products/bulk-tag", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ schoolId, grade, rows }),
        });
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          throw new Error(j.error ?? `HTTP ${r.status}`);
        }
        const j = (await r.json()) as {
          tagged: number;
          updated: number;
          gradeRowsAdded: number;
        };
        setSuccess(
          `${j.tagged + j.updated} product${j.tagged + j.updated === 1 ? "" : "s"} processed — ${j.tagged} newly tagged, ${j.updated} updated, ${j.gradeRowsAdded} grade rows added.`
        );
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to tag items.");
      }
    });
  };

  const untag = () => {
    setError(null);
    setSuccess(null);
    if (selectedIds.length === 0) {
      setError("Tick at least one product to untag.");
      return;
    }
    const names = selectedIds
      .map((id) => items.find((i) => i.id === id)?.name ?? id)
      .slice(0, 3)
      .join(", ");
    const more = selectedIds.length > 3 ? ` + ${selectedIds.length - 3} more` : "";
    if (
      !confirm(
        `Untag ${selectedIds.length} product${selectedIds.length === 1 ? "" : "s"} (${names}${more}) from ${schoolName} · ${grade}?\n\nThis removes the per-school binding. Override price/MRP/required settings will be lost.`
      )
    ) {
      return;
    }
    start(async () => {
      try {
        const r = await fetch("/api/admin/products/bulk-tag", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ schoolId, grade, productIds: selectedIds }),
        });
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          throw new Error(j.error ?? `HTTP ${r.status}`);
        }
        const j = (await r.json()) as { untagged: number; gradeRowsRemoved: number };
        setSuccess(
          `${j.untagged} product${j.untagged === 1 ? "" : "s"} untagged (${j.gradeRowsRemoved} grade row${j.gradeRowsRemoved === 1 ? "" : "s"} also removed because no other school still uses them at this grade).`
        );
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to untag items.");
      }
    });
  };

  return (
    <div className="space-y-3">
      {error && (
        <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-red-50 border border-red-200 text-[13px] text-red-800">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {success && (
        <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-[13px] text-emerald-800">
          <Check className="h-4 w-4 flex-shrink-0" />
          <span>{success}</span>
        </div>
      )}

      {/* ── Filter bar ─────────────────────────────────────────────── */}
      <div className="rounded-xl border border-ink-100 bg-white p-3 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="h-3.5 w-3.5 text-ink-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search products by name…"
            className="w-full h-9 pl-9 pr-3 rounded-lg border border-ink-200 bg-white text-[13px] focus:outline-none focus:ring-2 focus:ring-brand-300"
          />
        </div>
        <Select label="Show" value={filter} onChange={(v) => setFilter(v as FilterMode)} options={[
          { value: "untagged", label: "Untagged for this grade" },
          { value: "tagged", label: "Already tagged here" },
          { value: "all", label: "All products" },
        ]} />
        <Select
          label="Kind"
          value={kindFilter}
          onChange={setKindFilter}
          options={kinds.map((k) => ({ value: k, label: k === "all" ? "All kinds" : k }))}
        />
        <div className="ml-auto text-[12px] text-ink-500">
          {visible.length} shown · {selectedIds.length} selected
        </div>
      </div>

      {/* ── Table ──────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-ink-100 bg-white overflow-hidden">
        <div className="grid grid-cols-[28px_minmax(240px,_1fr)_110px_100px_100px_120px_90px] gap-3 px-3 py-2.5 bg-cream-50 border-b border-ink-100 text-[11px] font-semibold tracking-[0.12em] uppercase text-ink-500">
          <input
            type="checkbox"
            checked={allVisibleSelected}
            onChange={toggleAllVisible}
            disabled={visible.length === 0}
            className="h-4 w-4 rounded border-ink-300 text-brand-600 focus:ring-brand-300"
            title="Select all visible"
          />
          <div>Product</div>
          <div className="text-right">Base price</div>
          <div className="text-right">Price (₹)</div>
          <div className="text-right">MRP (₹)</div>
          <div className="text-center">Required?</div>
          <div className="text-right">State</div>
        </div>

        {visible.length === 0 ? (
          <div className="p-10 grid place-items-center text-ink-500">
            <Package className="h-8 w-8 mb-2 text-ink-300" />
            <div className="text-[13px]">
              No products match the current filters.
            </div>
            <div className="text-[12px] mt-1">
              Try changing &quot;Show&quot; to <em>All products</em> or clearing the search.
            </div>
          </div>
        ) : (
          <div className="divide-y divide-ink-100/80 max-h-[60vh] overflow-y-auto">
            {visible.map((it) => {
              const e = edits[it.id];
              return (
                <div
                  key={it.id}
                  className={cn(
                    "grid grid-cols-[28px_minmax(240px,_1fr)_110px_100px_100px_120px_90px] gap-3 px-3 py-2 items-center transition-colors",
                    e.selected && "bg-brand-50/50"
                  )}
                >
                  <input
                    type="checkbox"
                    checked={e.selected}
                    onChange={(ev) => patchRow(it.id, { selected: ev.target.checked })}
                    className="h-4 w-4 rounded border-ink-300 text-brand-600 focus:ring-brand-300"
                  />
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-9 h-9 rounded-md bg-cream-100 overflow-hidden flex-shrink-0">
                      {it.img ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={it.img} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full grid place-items-center text-ink-300">
                          <Package className="h-4 w-4" />
                        </div>
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="text-[13px] font-medium text-ink-900 truncate">{it.name}</div>
                      <div className="text-[11px] text-ink-500 flex items-center gap-1.5">
                        <span className="font-mono">{it.kind || "—"}</span>
                      </div>
                    </div>
                  </div>
                  <div className="text-right text-[12.5px] text-ink-700">
                    ₹{Math.round(it.basePricePaise / 100).toLocaleString("en-IN")}
                  </div>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={e.overrideRupees}
                    onChange={(ev) => patchRow(it.id, { overrideRupees: ev.target.value.replace(/[^0-9]/g, "") })}
                    placeholder="—"
                    disabled={!e.selected}
                    className="h-8 rounded-md border border-ink-200 bg-white px-2 text-[12.5px] text-right disabled:bg-cream-50 disabled:text-ink-400 focus:outline-none focus:ring-2 focus:ring-brand-300"
                  />
                  <input
                    type="text"
                    inputMode="numeric"
                    value={e.overrideMrpRupees}
                    onChange={(ev) => patchRow(it.id, { overrideMrpRupees: ev.target.value.replace(/[^0-9]/g, "") })}
                    placeholder="—"
                    disabled={!e.selected}
                    title="Per-school MRP override — drives strike-through. Leave blank to inherit."
                    className="h-8 rounded-md border border-ink-200 bg-white px-2 text-[12.5px] text-right disabled:bg-cream-50 disabled:text-ink-400 focus:outline-none focus:ring-2 focus:ring-brand-300"
                  />
                  <div className="grid place-items-center">
                    <input
                      type="checkbox"
                      checked={e.isRequired}
                      onChange={(ev) => patchRow(it.id, { isRequired: ev.target.checked })}
                      disabled={!e.selected}
                      className="h-4 w-4 rounded border-ink-300 text-amber-600 focus:ring-amber-300 disabled:opacity-50"
                    />
                  </div>
                  <div className="text-right text-[11px]">
                    {it.taggedAtThisGrade ? (
                      <span className="inline-flex items-center gap-1 px-1.5 h-5 rounded-full bg-emerald-50 text-emerald-700 font-semibold">
                        <Check className="h-2.5 w-2.5" /> tagged
                      </span>
                    ) : it.boundToSchool ? (
                      <span className="inline-flex items-center gap-1 px-1.5 h-5 rounded-full bg-amber-50 text-amber-800 font-semibold">
                        school only
                      </span>
                    ) : (
                      <span className="text-ink-400">new</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="border-t border-ink-100 bg-cream-50/60 px-3 py-3 flex items-center justify-between gap-3">
          <div className="text-[12px] text-ink-500">
            Working on <span className="font-semibold text-ink-900">{schoolName}</span> ·{" "}
            <span className="font-semibold text-ink-900">{grade}</span>
          </div>
          <div className="flex items-center gap-2">
            {/* Untag is only meaningful when the selection contains rows that
                are currently bound to this school. Hidden otherwise to keep
                the new-tagging flow uncluttered. */}
            {selectedIds.some((id) => items.find((i) => i.id === id)?.boundToSchool) && (
              <button
                type="button"
                onClick={untag}
                disabled={pending}
                className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-red-200 bg-white text-red-700 text-[13px] font-semibold hover:bg-red-50 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <X className="h-3.5 w-3.5" />
                Untag {selectedIds.length}
              </button>
            )}
            <button
              type="button"
              onClick={submit}
              disabled={pending || selectedIds.length === 0}
              className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-ink-900 text-white text-[13px] font-semibold hover:bg-ink-800 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {pending
                ? "Saving…"
                : selectedIds.length === 0
                  ? "Pick items above"
                  : `Tag ${selectedIds.length} item${selectedIds.length === 1 ? "" : "s"} to grade`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="flex items-center gap-2">
      <span className="text-[11px] font-semibold tracking-[0.12em] uppercase text-ink-500">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 rounded-lg border border-ink-200 bg-white px-2 text-[12.5px] focus:outline-none focus:ring-2 focus:ring-brand-300"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
