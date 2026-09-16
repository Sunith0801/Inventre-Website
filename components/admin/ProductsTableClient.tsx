"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Package,
  ExternalLink as ExternalLinkIcon,
  X,
  CheckCircle2,
  EyeOff,
  Archive,
  Loader2,
} from "lucide-react";
import {
  Th,
  Td,
  Tr,
  Badge,
  Money,
  statusTone,
} from "./ui/primitives";

type ProductStatus = "draft" | "active" | "archived";

export type AdminProductRow = {
  id: string;
  slug: string;
  name: string;
  itemCode: string | null;
  basePrice: number;
  status: ProductStatus;
  categoryId: string | null;
  erpIsDisabled: boolean;
  erpIsDeleted: boolean;
  kind: string;
  schools: string[];
  grades: string[];
};

const KIND: Record<string, { label: string; tone: "brand" | "info" | "violet" | "subtle" | "default" | "warning" }> = {
  magic_box: { label: "Magic Box", tone: "brand" },
  kit: { label: "Book Kit", tone: "info" },
  sub_bundle: { label: "Sub-bundle", tone: "violet" },
  uniform: { label: "Uniform", tone: "warning" },
  book: { label: "Book", tone: "subtle" },
  accessory: { label: "Item", tone: "default" },
  consumable: { label: "Consumable", tone: "default" },
  excluded: { label: "Excluded", tone: "default" },
};

const STATUS_LABEL: Record<ProductStatus, string> = { draft: "Draft", active: "Published", archived: "Hidden" };

/** "Grade 1, Grade 2, Grade 3" → "Grade 1–3" where the run is contiguous. */
function compactGrades(grades: string[]): string {
  if (grades.length === 0) return "All grades";
  const nums = grades.map((g) => ({ g, n: parseInt(g.match(/^Grade (\d+)$/)?.[1] ?? "") }));
  const numeric = nums.filter((x) => !isNaN(x.n)).sort((a, b) => a.n - b.n);
  const other = nums.filter((x) => isNaN(x.n)).map((x) => x.g);
  const runs: string[] = [];
  for (let i = 0; i < numeric.length; ) {
    let j = i;
    while (j + 1 < numeric.length && numeric[j + 1]!.n === numeric[j]!.n + 1) j++;
    runs.push(j > i ? `Grade ${numeric[i]!.n}–${numeric[j]!.n}` : numeric[i]!.g);
    i = j + 1;
  }
  return [...other, ...runs].join(", ");
}

type Props = {
  rows: AdminProductRow[];
  imageByProduct: Record<string, string | undefined>;
  catName: Record<string, string | undefined>;
  variantCount: Record<string, number>;
};

const STATUS_OPTIONS: ProductStatus[] = ["draft", "active", "archived"];

/**
 * Client-side products list with row-level inline status edit, bulk
 * selection and a floating action bar. Receives server-fetched data as
 * plain props so the heavy joins still run on the server.
 *
 * Optimistic updates: status changes flip in-memory immediately and revert
 * if the PATCH/bulk API fails, so the table never blocks on a network
 * round-trip for what is effectively a single dropdown change.
 */
export function ProductsTableClient({
  rows,
  imageByProduct,
  catName,
  variantCount,
}: Props) {
  const router = useRouter();
  const [items, setItems] = useState<AdminProductRow[]>(rows);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allSelected = items.length > 0 && selected.size === items.length;
  const partial = selected.size > 0 && !allSelected;

  const toggleOne = (id: string) => {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleAll = () => {
    setSelected((cur) =>
      cur.size === items.length ? new Set() : new Set(items.map((r) => r.id))
    );
  };
  const clearSelection = () => setSelected(new Set());

  const setBusy = (id: string, on: boolean) =>
    setBusyIds((cur) => {
      const next = new Set(cur);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const changeOneStatus = async (id: string, next: ProductStatus) => {
    const prev = items.find((r) => r.id === id)?.status;
    if (!prev || prev === next) return;
    setError(null);
    setBusy(id, true);
    setItems((cur) => cur.map((r) => (r.id === id ? { ...r, status: next } : r)));
    try {
      const res = await fetch(`/api/admin/products/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) throw new Error("PATCH failed");
    } catch {
      setItems((cur) => cur.map((r) => (r.id === id ? { ...r, status: prev } : r)));
      setError("Couldn't update status. Please try again.");
    } finally {
      setBusy(id, false);
    }
  };

  const bulkStatus = async (next: ProductStatus) => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    setError(null);
    setBulkBusy(true);
    const snapshot = new Map(items.map((r) => [r.id, r.status]));
    setItems((cur) =>
      cur.map((r) => (selected.has(r.id) ? { ...r, status: next } : r))
    );
    try {
      const res = await fetch("/api/admin/products/bulk", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, status: next }),
      });
      if (!res.ok) throw new Error("Bulk PATCH failed");
      const d = (await res.json().catch(() => ({}))) as { skipped?: { id: string; reasons: string[] }[] };
      if (d.skipped?.length) {
        // Roll back the optimistic flip on the rows the server refused.
        const refused = new Set(d.skipped.map((s) => s.id));
        setItems((cur) => cur.map((r) => (refused.has(r.id) ? { ...r, status: snapshot.get(r.id)! } : r)));
        setError(`${d.skipped.length} product${d.skipped.length === 1 ? " was" : "s were"} not ready to publish (${[...new Set(d.skipped.flatMap((s) => s.reasons))].join("; ").toLowerCase()}). Open each one's Review & publish step.`);
      }
      clearSelection();
      router.refresh();
    } catch {
      setItems((cur) =>
        cur.map((r) =>
          snapshot.has(r.id) ? { ...r, status: snapshot.get(r.id)! } : r
        )
      );
      setError("Bulk update failed. No changes were saved.");
    } finally {
      setBulkBusy(false);
    }
  };

  const selectedCount = selected.size;

  const byCount = useMemo(() => {
    const m: Record<ProductStatus, number> = { draft: 0, active: 0, archived: 0 };
    for (const id of selected) {
      const r = items.find((x) => x.id === id);
      if (r) m[r.status]++;
    }
    return m;
  }, [selected, items]);

  return (
    <>
      {error && (
        <div className="mb-3 rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-[13px] text-red-700">
          {error}
        </div>
      )}

      <table className="w-full">
        <thead>
          <tr>
            <Th>
              <input
                type="checkbox"
                checked={allSelected}
                ref={(el) => {
                  if (el) el.indeterminate = partial;
                }}
                onChange={toggleAll}
                aria-label="Select all"
                className="h-4 w-4 rounded border-ink-300 accent-brand cursor-pointer"
              />
            </Th>
            <Th>Product</Th>
            <Th>Type</Th>
            <Th>School</Th>
            <Th>Grade</Th>
            <Th right>Variants</Th>
            <Th>Status</Th>
            <Th right>Base price</Th>
            <Th right>Actions</Th>
          </tr>
        </thead>
        <tbody>
          {items.map((p) => {
            const img = imageByProduct[p.id];
            const isBusy = busyIds.has(p.id);
            const isSelected = selected.has(p.id);
            return (
              <Tr key={p.id}>
                <Td>
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleOne(p.id)}
                    aria-label={`Select ${p.name}`}
                    className="h-4 w-4 rounded border-ink-300 accent-brand cursor-pointer"
                  />
                </Td>
                <Td>
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-lg overflow-hidden border border-ink-100 bg-cream-50 flex-shrink-0 grid place-items-center">
                      {img ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={img} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <Package className="h-4 w-4 text-ink-300" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <Link
                        href={`/admin/products/${p.id}`}
                        className="font-semibold text-ink-900 hover:text-brand-700 transition-colors"
                      >
                        {p.name}
                      </Link>
                      <div className="mt-0.5 truncate text-[11px] text-ink-500">
                        {p.itemCode ? <span className="font-mono">{p.itemCode}</span> : null}
                        {p.itemCode && p.categoryId && catName[p.categoryId] ? " · " : ""}
                        {p.categoryId ? catName[p.categoryId] ?? "" : ""}
                      </div>
                    </div>
                  </div>
                </Td>
                <Td>
                  <Badge tone={KIND[p.kind]?.tone ?? "default"} size="sm">{KIND[p.kind]?.label ?? p.kind}</Badge>
                </Td>
                <Td muted>
                  {p.schools.length === 0 ? (
                    <span className="text-[12px] italic text-ink-400">None</span>
                  ) : p.schools.length <= 2 ? (
                    <span className="text-[12.5px]">{p.schools.join(", ")}</span>
                  ) : (
                    <span className="text-[12.5px]" title={p.schools.join("\n")}>{p.schools[0]} <span className="text-ink-400">+{p.schools.length - 1} more</span></span>
                  )}
                </Td>
                <Td muted>
                  <span className="text-[12.5px]" title={p.grades.join(", ")}>{compactGrades(p.grades)}</span>
                </Td>
                <Td right muted>{variantCount[p.id] ?? 0}</Td>
                <Td>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <div className="relative inline-flex items-center">
                      <Badge tone={statusTone(p.status)} dot size="sm">
                        {STATUS_LABEL[p.status]}
                      </Badge>
                      {/* Publishing from the list is deliberately not offered
                          for an unpublished row — it goes through the Review
                          step, which is where the checklist lives. Draft and
                          Hidden are always safe to set here. */}
                      <select
                        value={p.status}
                        disabled={isBusy}
                        onChange={(e) =>
                          changeOneStatus(p.id, e.target.value as ProductStatus)
                        }
                        aria-label={`Change status for ${p.name}`}
                        title="Click to change status"
                        className="absolute inset-0 opacity-0 cursor-pointer"
                      >
                        {STATUS_OPTIONS.filter((s) => s !== "active" || p.status === "active").map((s) => (
                          <option key={s} value={s}>
                            {STATUS_LABEL[s]}
                          </option>
                        ))}
                      </select>
                    </div>
                    {p.status !== "active" ? (
                      <Link href={`/admin/products/${p.id}?step=publish`} className="text-[11px] font-semibold text-brand-700 hover:text-brand-800">
                        Publish…
                      </Link>
                    ) : null}
                    {isBusy && (
                      <Loader2 className="h-3 w-3 animate-spin text-ink-400" />
                    )}
                    {p.erpIsDisabled ? (
                      <Badge tone="warning" size="sm" title="Marked disabled in ERP">
                        ERP-disabled
                      </Badge>
                    ) : null}
                    {p.erpIsDeleted ? (
                      <Badge tone="danger" size="sm" title="Marked deleted in ERP">
                        ERP-deleted
                      </Badge>
                    ) : null}
                  </div>
                </Td>
                <Td right>
                  <Money paise={p.basePrice} className="font-semibold" />
                </Td>
                <Td right>
                  <a
                    href={`/shop/${p.slug}`}
                    target="_blank"
                    rel="noreferrer"
                    title="Open in storefront"
                    className="inline-flex items-center gap-1 text-[12px] text-ink-500 hover:text-brand-700"
                  >
                    Shop
                    <ExternalLinkIcon className="h-3 w-3" />
                  </a>
                </Td>
              </Tr>
            );
          })}
        </tbody>
      </table>

      {selectedCount > 0 && (
        <div className="fixed inset-x-0 bottom-4 z-40 flex justify-center px-4 pointer-events-none">
          <div className="pointer-events-auto rounded-2xl border border-ink-200 bg-ink-900 text-white shadow-[0_20px_40px_-12px_rgba(0,0,0,0.5)] px-3 py-2.5 flex items-center gap-2 flex-wrap max-w-[min(960px,100%)]">
            <span className="px-2 text-[13px] font-semibold">
              {selectedCount} selected
            </span>
            <span className="text-[11px] text-white/60 hidden sm:inline">
              ({byCount.draft} draft · {byCount.active} active · {byCount.archived} archived)
            </span>
            <span className="mx-1 h-5 w-px bg-white/20" />
            <button
              type="button"
              disabled={bulkBusy}
              onClick={() => bulkStatus("active")}
              className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500 text-white px-3 h-8 text-[12px] font-bold hover:bg-emerald-600 disabled:opacity-50"
            >
              <CheckCircle2 className="h-3.5 w-3.5" /> Publish
            </button>
            <button
              type="button"
              disabled={bulkBusy}
              onClick={() => bulkStatus("draft")}
              className="inline-flex items-center gap-1.5 rounded-full bg-white/10 text-white px-3 h-8 text-[12px] font-bold hover:bg-white/20 disabled:opacity-50"
            >
              <EyeOff className="h-3.5 w-3.5" /> To draft
            </button>
            <button
              type="button"
              disabled={bulkBusy}
              onClick={() => bulkStatus("archived")}
              className="inline-flex items-center gap-1.5 rounded-full bg-white/10 text-white px-3 h-8 text-[12px] font-bold hover:bg-white/20 disabled:opacity-50"
            >
              <Archive className="h-3.5 w-3.5" /> Archive
            </button>
            {bulkBusy && <Loader2 className="h-4 w-4 animate-spin text-white/70" />}
            <button
              type="button"
              onClick={clearSelection}
              aria-label="Clear selection"
              className="ml-1 grid h-8 w-8 place-items-center rounded-full text-white/70 hover:bg-white/10 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
