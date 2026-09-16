"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, IndianRupee, Save } from "lucide-react";
import { Button } from "@/components/admin/ui/primitives-client";
import { FormError } from "@/components/admin/ui/form";
import { cn } from "@/lib/cn";

export type SchoolAssignment = {
  schoolId: string;
  /** Rupees, as the PUT route expects. Echoed back on save so a chip
   *  toggle never wipes a per-school price (the route nulls omitted ones). */
  overridePrice: number | null;
  overrideMrp: number | null;
  isRequired: boolean;
  customImageUrl: string | null;
};

/**
 * Which schools sell this product — chips, one save. Per-school prices
 * live on the School pricing page; this only decides membership.
 */
export function SchoolsPicker({
  productId,
  schools,
  initial,
}: {
  productId: string;
  schools: { id: string; name: string }[];
  initial: SchoolAssignment[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set(initial.map((a) => a.schoolId)));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const initialIds = new Set(initial.map((a) => a.schoolId));
  const dirty = selected.size !== initialIds.size || [...selected].some((id) => !initialIds.has(id));

  function toggle(id: string) {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  function save() {
    setError(null);
    start(async () => {
      const added = [...selected].filter((id) => !initialIds.has(id));
      const removed = [...initialIds].filter((id) => !selected.has(id));
      const calls = [
        ...added.map((schoolId) =>
          fetch(`/api/admin/products/${productId}/schools/${schoolId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ assigned: true, isRequired: false, overridePrice: null, overrideMrp: null, customImageUrl: null }),
          }),
        ),
        ...removed.map((schoolId) => {
          const a = initial.find((x) => x.schoolId === schoolId)!;
          return fetch(`/api/admin/products/${productId}/schools/${schoolId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ assigned: false, isRequired: a.isRequired }),
          });
        }),
      ];
      const results = await Promise.all(calls);
      const bad = results.find((r) => !r.ok);
      if (bad) {
        const d = await bad.json().catch(() => ({}));
        setError(d.error ?? "Some schools could not be saved.");
        router.refresh();
        return;
      }
      router.refresh();
    });
  }

  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {schools.map((s) => {
          const on = selected.has(s.id);
          return (
            <button
              key={s.id}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(s.id)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12.5px] font-medium transition-colors",
                on ? "border-ink-900 bg-ink-900 text-white" : "border-ink-100 bg-white text-ink-700 hover:border-ink-300",
              )}
            >
              {on ? <Check className="h-3 w-3" /> : null}
              {s.name}
            </button>
          );
        })}
      </div>
      {error ? <FormError className="mt-3">{error}</FormError> : null}
      <div className="mt-4 flex items-center justify-between gap-3 border-t border-ink-100/70 pt-4">
        <span className="text-[12px] text-ink-500">
          {selected.size === 0 ? "No school — parents cannot see this product." : `${selected.size} school${selected.size === 1 ? "" : "s"}.`}{" "}
          <Link href={`/admin/products/${productId}/schools`} className="inline-flex items-center gap-1 font-semibold text-brand-700 hover:text-brand-800">
            <IndianRupee className="h-3 w-3" /> School-specific prices
          </Link>
        </span>
        <Button size="sm" busy={pending} disabled={!dirty} icon={<Save className="h-3.5 w-3.5" />} onClick={save}>
          Save schools
        </Button>
      </div>
    </div>
  );
}
