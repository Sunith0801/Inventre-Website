"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Layers } from "lucide-react";
import { Button, Field, Input, Select, Checkbox, FormGrid, FormError } from "@/components/admin/ui/primitives";
import { Dialog } from "@/components/admin/ui/dialog";
import { bulkCreateRules } from "./actions";

/**
 * "Bulk assign" — one (category, fee, optional grade, cart range) applied to
 * N schools in one go. Each apply creates N rule rows, one per school, and
 * busts the delivery-fee cache once at the end so the storefront reflects
 * the new fees immediately. Lives in a dialog so the rules table is the
 * first thing on the page; the single-rule editor stays for per-school
 * overrides.
 */
export function BulkAssignButton({
  schools,
  grades,
}: {
  schools: string[];
  grades: string[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [selectedSchools, setSelectedSchools] = useState<Set<string>>(new Set());
  const [grade, setGrade] = useState<string>("");
  const [category, setCategory] = useState<"Books" | "Uniform">("Uniform");
  const [deliveryFee, setDeliveryFee] = useState<string>("");
  const [minAmount, setMinAmount] = useState<string>("0");
  const [maxAmount, setMaxAmount] = useState<string>("0");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allSelected = schools.length > 0 && schools.every((s) => selectedSchools.has(s));

  function toggleAll() {
    if (allSelected) setSelectedSchools(new Set());
    else setSelectedSchools(new Set(schools));
  }
  function toggleOne(name: string) {
    setSelectedSchools((cur) => {
      const next = new Set(cur);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  const close = () => {
    if (busy) return;
    setOpen(false);
    setError(null);
  };

  async function apply() {
    setError(null);
    if (selectedSchools.size === 0) {
      setError("Pick at least one school.");
      return;
    }
    const fee = Number(deliveryFee);
    if (!Number.isFinite(fee) || fee < 0) {
      setError("Enter the delivery fee.");
      return;
    }
    setBusy(true);
    try {
      const result = await bulkCreateRules({
        schoolNames: Array.from(selectedSchools),
        grade: grade || null,
        category,
        deliveryFee: fee,
        minAmount: Number(minAmount) || 0,
        maxAmount: Number(maxAmount) || 0,
        isActive: true,
      });
      if (!result.ok) {
        setError(result.error);
      } else {
        setSelectedSchools(new Set());
        setOpen(false);
        startTransition(() => router.refresh());
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="secondary" icon={<Layers className="h-3.5 w-3.5" />} onClick={() => setOpen(true)}>
        Bulk assign
      </Button>
      <Dialog
        open={open}
        onClose={close}
        title="Assign one fee to many schools"
        description="Creates one rule per selected school. Override a single school later with Edit."
        busy={busy}
        width="lg"
        footer={
          <>
            <Button type="button" variant="secondary" onClick={close} disabled={busy}>Cancel</Button>
            <Button type="button" variant="primary" busy={busy} disabled={selectedSchools.size === 0} onClick={apply}>
              {selectedSchools.size ? `Apply to ${selectedSchools.size} school${selectedSchools.size === 1 ? "" : "s"}` : "Apply"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[12px] font-semibold text-ink-700">
                Schools
                <span className="ml-1.5 font-normal text-ink-500">{selectedSchools.size ? `· ${selectedSchools.size} selected` : ""}</span>
              </span>
              <button type="button" onClick={toggleAll} className="text-[12px] font-semibold text-brand-700 hover:text-brand-900">
                {allSelected ? "Clear all" : "Select all"}
              </button>
            </div>
            <div className="max-h-[180px] space-y-0.5 overflow-y-auto rounded-lg border border-ink-100 bg-cream-50 p-1.5">
              {schools.map((s) => (
                <label key={s} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[12.5px] hover:bg-white">
                  <input type="checkbox" checked={selectedSchools.has(s)} onChange={() => toggleOne(s)} className="h-4 w-4 accent-brand" />
                  <span className="font-mono text-ink-700">{s}</span>
                </label>
              ))}
              {schools.length === 0 ? <p className="px-2 py-3 text-[12px] text-ink-500">No active schools.</p> : null}
            </div>
          </div>

          <FormGrid cols={2}>
            <Field label="Applies to" htmlFor="bulk-cat">
              <Select id="bulk-cat" value={category} onChange={(e) => setCategory(e.target.value as "Books" | "Uniform")}>
                <option value="Uniform">Uniforms</option>
                <option value="Books">Books</option>
              </Select>
            </Field>
            <Field label="Grade" htmlFor="bulk-grade">
              <Select id="bulk-grade" value={grade} onChange={(e) => setGrade(e.target.value)}>
                <option value="">All grades</option>
                {grades.map((g) => (
                  <option key={g} value={g}>{g}</option>
                ))}
              </Select>
            </Field>
          </FormGrid>
          <FormGrid cols={3}>
            <Field label="Delivery fee (₹)" htmlFor="bulk-fee" required>
              <Input id="bulk-fee" type="number" step="0.01" min="0" value={deliveryFee} onChange={(e) => setDeliveryFee(e.target.value)} placeholder="0" className="text-right tabular-nums" />
            </Field>
            <Field label="Minimum cart (₹)" htmlFor="bulk-min">
              <Input id="bulk-min" type="number" step="0.01" min="0" value={minAmount} onChange={(e) => setMinAmount(e.target.value)} className="text-right tabular-nums" />
            </Field>
            <Field label="Maximum cart (₹)" htmlFor="bulk-max" hint="0 = no upper limit">
              <Input id="bulk-max" type="number" step="0.01" min="0" value={maxAmount} onChange={(e) => setMaxAmount(e.target.value)} className="text-right tabular-nums" />
            </Field>
          </FormGrid>
          <Checkbox label="Active immediately" checked readOnly disabled />
          <FormError>{error}</FormError>
        </div>
      </Dialog>
    </>
  );
}
