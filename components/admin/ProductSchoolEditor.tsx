"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, Check, Loader2, Search, Upload, X } from "lucide-react";
import { Button, IconBtn } from "@/components/admin/ui/primitives-client";
import { Input, FormError } from "@/components/admin/ui/form";
import { Badge, DataTable, EmptyState, Th, Td, Tr, statusTone } from "@/components/admin/ui/primitives";
import { cn } from "@/lib/cn";

export type SchoolPricingRow = {
  id: string;
  name: string;
  slug: string;
  city: string | null;
  status: string;
  logoUrl: string | null;
  assigned: boolean;
  overridePrice: number | null; // rupees
  overrideMrp: number | null; // rupees
  isRequired: boolean;
  customImageUrl: string | null;
};

type Filter = "all" | "assigned" | "unassigned";

const rupees = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

const same = (a: SchoolPricingRow, b: SchoolPricingRow) =>
  a.assigned === b.assigned &&
  a.overridePrice === b.overridePrice &&
  a.overrideMrp === b.overrideMrp &&
  a.isRequired === b.isRequired &&
  a.customImageUrl === b.customImageUrl;

/** School crest, falling back to a glyph when there is none or it 404s. */
function SchoolLogo({ url }: { url: string | null }) {
  const [broken, setBroken] = useState(false);
  // An image that failed before hydration never fires onError for React, so
  // check the element's state once it mounts as well.
  const check = (el: HTMLImageElement | null) => {
    if (el && el.complete && el.naturalWidth === 0) setBroken(true);
  };
  return (
    <div className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-lg border border-ink-100 bg-cream-50 text-ink-400">
      {url && !broken ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img ref={check} src={url} alt="" onError={() => setBroken(true)} className="h-full w-full object-contain" />
      ) : (
        <Building2 className="h-4 w-4" />
      )}
    </div>
  );
}

/**
 * Per-school visibility and pricing for one product.
 *
 * A row is a school. Ticking it makes the product visible on that school's
 * storefront; the price and MRP boxes then override the product's base
 * figures for that school only. Rows track their own dirty state, so a
 * Save button only appears where something changed, and the bar at the
 * bottom saves every changed row at once.
 */
export function ProductSchoolEditor({
  productId,
  basePriceRupees,
  baseMrpRupees,
  schools,
}: {
  productId: string;
  basePriceRupees: number;
  baseMrpRupees: number | null;
  schools: SchoolPricingRow[];
}) {
  const router = useRouter();
  const [saved, setSaved] = useState(schools);
  const [rows, setRows] = useState(schools);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [saving, setSaving] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [flash, setFlash] = useState<Set<string>>(new Set());
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});

  const savedById = useMemo(() => new Map(saved.map((r) => [r.id, r])), [saved]);
  const isDirty = (r: SchoolPricingRow) => !same(r, savedById.get(r.id) ?? r);
  const dirtyRows = rows.filter(isDirty);

  const assignedCount = rows.filter((r) => r.assigned).length;
  const overrideCount = rows.filter((r) => r.assigned && r.overridePrice != null).length;
  const requiredCount = rows.filter((r) => r.assigned && r.isRequired).length;

  const visible = rows.filter((r) => {
    if (filter === "assigned" && !r.assigned) return false;
    if (filter === "unassigned" && r.assigned) return false;
    if (!q.trim()) return true;
    const needle = q.trim().toLowerCase();
    return (
      r.name.toLowerCase().includes(needle) ||
      r.slug.toLowerCase().includes(needle) ||
      (r.city ?? "").toLowerCase().includes(needle)
    );
  });

  const upsert = (id: string, patch: Partial<SchoolPricingRow>) =>
    setRows((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r;
        const next = { ...r, ...patch };
        // Un-assigning clears the per-school overrides so a future re-assign
        // doesn't silently resurrect a stale image / price the admin forgot.
        if (patch.assigned === false) {
          next.customImageUrl = null;
          next.overridePrice = null;
          next.overrideMrp = null;
          next.isRequired = false;
        }
        return next;
      })
    );

  const setIn = (setter: React.Dispatch<React.SetStateAction<Set<string>>>, id: string, on: boolean) =>
    setter((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const saveOne = async (r: SchoolPricingRow): Promise<boolean> => {
    setIn(setSaving, r.id, true);
    setErrors((e) => {
      const { [r.id]: _drop, ...rest } = e;
      return rest;
    });
    try {
      const res = await fetch(`/api/admin/products/${productId}/schools/${r.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assigned: r.assigned,
          overridePrice: r.overridePrice,
          overrideMrp: r.overrideMrp,
          isRequired: r.isRequired,
          customImageUrl: r.customImageUrl,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? `Save failed (${res.status})`);
      }
      setSaved((prev) => prev.map((s) => (s.id === r.id ? r : s)));
      setIn(setFlash, r.id, true);
      setTimeout(() => setIn(setFlash, r.id, false), 1800);
      return true;
    } catch (err) {
      setErrors((e) => ({ ...e, [r.id]: err instanceof Error ? err.message : "Save failed" }));
      return false;
    } finally {
      setIn(setSaving, r.id, false);
    }
  };

  const saveAll = async () => {
    for (const r of dirtyRows) await saveOne(r);
    router.refresh();
  };

  const discardAll = () => {
    setRows(saved);
    setErrors({});
  };

  const uploadImage = async (rowId: string, file: File) => {
    setUploadingId(rowId);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("folder", `products/${productId}/schools/${rowId}`);
      const up = await fetch("/api/admin/upload", { method: "POST", body: fd });
      if (!up.ok) throw new Error("Image upload failed");
      const { url } = await up.json();
      upsert(rowId, { customImageUrl: url });
    } catch (err) {
      setErrors((e) => ({ ...e, [rowId]: err instanceof Error ? err.message : "Upload failed" }));
    } finally {
      setUploadingId(null);
    }
  };

  const filters: { key: Filter; label: string; count: number }[] = [
    { key: "all", label: "All", count: rows.length },
    { key: "assigned", label: "Assigned", count: assignedCount },
    { key: "unassigned", label: "Not assigned", count: rows.length - assignedCount },
  ];

  return (
    <div className="pb-24">
      {/* Summary + toolbar */}
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-ink-100/70 bg-white p-2">
        <div className="flex items-center gap-1 text-[12px]">
          {filters.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 font-medium transition-colors",
                filter === f.key ? "bg-ink-900 text-white" : "text-ink-600 hover:bg-cream-100 hover:text-ink-900"
              )}
            >
              {f.label}
              <span
                className={cn(
                  "rounded-full px-1.5 py-0.5 text-[10.5px] font-bold tabular-nums",
                  filter === f.key ? "bg-white/15 text-white" : "bg-ink-100 text-ink-500"
                )}
              >
                {f.count}
              </span>
            </button>
          ))}
        </div>
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-400" />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search schools…"
            className="h-9 w-full rounded-lg border border-ink-100 bg-cream-50 pl-9 pr-3 text-[13px] placeholder:text-ink-400 transition-[background,border,box-shadow] focus:border-ink-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-300/40"
          />
        </div>
        <div className="hidden items-center gap-3 pr-2 text-[12px] text-ink-500 sm:flex">
          <span>
            <b className="font-semibold text-ink-900 tabular-nums">{overrideCount}</b> price override
            {overrideCount === 1 ? "" : "s"}
          </span>
          <span className="h-3 w-px bg-ink-100" />
          <span>
            <b className="font-semibold text-ink-900 tabular-nums">{requiredCount}</b> required
          </span>
        </div>
      </div>

      <DataTable
        empty={
          visible.length === 0 ? (
            <EmptyState
              icon={Building2}
              title={rows.length === 0 ? "No schools yet" : "No schools match"}
              description={
                rows.length === 0
                  ? "Add a school before assigning products to it."
                  : "Try a different search or filter."
              }
            />
          ) : undefined
        }
      >
        <table className="w-full min-w-[880px]">
          <thead>
            <tr>
              <Th className="w-10">
                <span className="sr-only">Assigned</span>
              </Th>
              <Th className="min-w-[260px]">School</Th>
              <Th>
                Price
                <span className="ml-1 font-normal normal-case tracking-normal text-ink-400">
                  base {rupees(basePriceRupees)}
                </span>
              </Th>
              <Th>
                MRP
                {baseMrpRupees != null ? (
                  <span className="ml-1 font-normal normal-case tracking-normal text-ink-400">
                    base {rupees(baseMrpRupees)}
                  </span>
                ) : null}
              </Th>
              <Th className="text-center">Required</Th>
              <Th>School image</Th>
              <Th right>
                <span className="sr-only">Save</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => {
              const dirty = isDirty(r);
              const busy = saving.has(r.id);
              const err = errors[r.id];
              const effective = r.overridePrice ?? basePriceRupees;
              const delta = r.overridePrice != null ? r.overridePrice - basePriceRupees : 0;
              return (
                <Tr
                  key={r.id}
                  className={cn(
                    !r.assigned && "opacity-70",
                    dirty && "bg-amber-50/40",
                    flash.has(r.id) && "bg-emerald-50/60"
                  )}
                >
                  <Td className="align-top">
                    <input
                      type="checkbox"
                      aria-label={`Assign to ${r.name}`}
                      checked={r.assigned}
                      disabled={busy}
                      onChange={(e) => upsert(r.id, { assigned: e.target.checked })}
                      className="mt-1 h-4 w-4 cursor-pointer rounded border-ink-200 accent-brand focus-visible:ring-2 focus-visible:ring-brand-300/40"
                    />
                  </Td>
                  <Td className="align-top">
                    <div className="flex items-start gap-3">
                      <SchoolLogo url={r.logoUrl} />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-semibold text-ink-900">{r.name}</span>
                          {r.status !== "active" ? (
                            <Badge tone={statusTone(r.status)} size="sm" dot>
                              {r.status}
                            </Badge>
                          ) : null}
                          {dirty ? (
                            <Badge tone="warning" size="sm">
                              Unsaved
                            </Badge>
                          ) : null}
                        </div>
                        <p className="mt-0.5 text-[11.5px] font-normal text-ink-500">
                          {r.city ? `${r.city} · ` : ""}
                          <span className="font-mono">{r.slug}</span>
                        </p>
                        {err ? (
                          <FormError className="mt-2 px-3 py-2 text-[12px]">{err}</FormError>
                        ) : null}
                      </div>
                    </div>
                  </Td>
                  <Td className="align-top">
                    <Input
                      type="number"
                      inputSize="sm"
                      min={0}
                      step="1"
                      aria-label={`Price for ${r.name}`}
                      placeholder={String(basePriceRupees)}
                      value={r.overridePrice ?? ""}
                      disabled={!r.assigned || busy}
                      onChange={(e) =>
                        upsert(r.id, {
                          overridePrice: e.target.value === "" ? null : Number(e.target.value),
                        })
                      }
                      className="w-28 tabular-nums"
                    />
                    {r.assigned ? (
                      <p
                        className={cn(
                          "mt-1 text-[11px] tabular-nums",
                          r.overridePrice == null
                            ? "text-ink-400"
                            : delta > 0
                              ? "text-amber-700"
                              : delta < 0
                                ? "text-emerald-700"
                                : "text-ink-500"
                        )}
                      >
                        {r.overridePrice == null
                          ? `Uses base ${rupees(basePriceRupees)}`
                          : delta === 0
                            ? "Same as base"
                            : `${delta > 0 ? "+" : "−"}${rupees(Math.abs(delta))} vs base · sells at ${rupees(effective)}`}
                      </p>
                    ) : null}
                  </Td>
                  <Td className="align-top">
                    <Input
                      type="number"
                      inputSize="sm"
                      min={0}
                      step="1"
                      aria-label={`MRP for ${r.name}`}
                      placeholder={baseMrpRupees != null ? String(baseMrpRupees) : "—"}
                      value={r.overrideMrp ?? ""}
                      disabled={!r.assigned || busy}
                      onChange={(e) =>
                        upsert(r.id, {
                          overrideMrp: e.target.value === "" ? null : Number(e.target.value),
                        })
                      }
                      className="w-28 tabular-nums"
                    />
                    {r.assigned && r.overrideMrp != null && r.overrideMrp < effective ? (
                      <p className="mt-1 text-[11px] text-red-600">MRP is below the selling price</p>
                    ) : null}
                  </Td>
                  <Td className="text-center align-top">
                    <input
                      type="checkbox"
                      aria-label={`Required at ${r.name}`}
                      checked={r.isRequired}
                      disabled={!r.assigned || busy}
                      onChange={(e) => upsert(r.id, { isRequired: e.target.checked })}
                      className="mt-1 h-4 w-4 cursor-pointer rounded border-ink-200 accent-brand disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-brand-300/40"
                    />
                  </Td>
                  <Td className="align-top">
                    <div className="flex items-center gap-2">
                      {r.customImageUrl ? (
                        <div className="relative h-9 w-9 overflow-hidden rounded-lg border border-ink-200 bg-cream-50">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={r.customImageUrl} alt="" className="h-full w-full object-cover" />
                          <IconBtn
                            size="sm"
                            tone="danger"
                            label="Remove school image"
                            icon={<X className="h-3 w-3" />}
                            disabled={!r.assigned || busy}
                            onClick={() => upsert(r.id, { customImageUrl: null })}
                            className="absolute -right-1 -top-1 h-5 w-5 rounded-full bg-white shadow-sm ring-1 ring-ink-100 hover:bg-red-50"
                          />
                        </div>
                      ) : null}
                      <input
                        ref={(el) => {
                          fileInputs.current[r.id] = el;
                        }}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) void uploadImage(r.id, f);
                          e.target.value = "";
                        }}
                      />
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        busy={uploadingId === r.id}
                        disabled={!r.assigned || busy}
                        icon={<Upload className="h-3.5 w-3.5" />}
                        onClick={() => fileInputs.current[r.id]?.click()}
                      >
                        {r.customImageUrl ? "Replace" : "Upload"}
                      </Button>
                    </div>
                  </Td>
                  <Td right className="align-top">
                    {dirty ? (
                      <Button
                        type="button"
                        size="sm"
                        busy={busy}
                        onClick={() => void saveOne(r).then((ok) => ok && router.refresh())}
                      >
                        Save
                      </Button>
                    ) : flash.has(r.id) ? (
                      <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-emerald-700">
                        <Check className="h-3.5 w-3.5" /> Saved
                      </span>
                    ) : busy ? (
                      <Loader2 className="ml-auto h-4 w-4 animate-spin text-ink-400" />
                    ) : null}
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </table>
      </DataTable>

      {/* Sticky save bar — appears only when something changed. */}
      {dirtyRows.length > 0 ? (
      <div
        aria-live="polite"
        className="fixed inset-x-0 bottom-0 z-30 lg:left-[220px] 2xl:left-[256px]"
      >
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 border-t border-ink-100 bg-white/95 px-4 py-3 shadow-[0_-4px_16px_rgba(10,10,10,0.06)] backdrop-blur sm:mx-4 sm:mb-4 sm:rounded-2xl sm:border lg:mx-auto">
          <p className="text-[13px] text-ink-700">
            <b className="font-semibold text-ink-900 tabular-nums">{dirtyRows.length}</b> school
            {dirtyRows.length === 1 ? "" : "s"} with unsaved changes
          </p>
          <div className="flex items-center gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={discardAll} disabled={saving.size > 0}>
              Discard
            </Button>
            <Button type="button" size="sm" busy={saving.size > 0} onClick={() => void saveAll()}>
              Save all
            </Button>
          </div>
        </div>
      </div>
      ) : null}
    </div>
  );
}
