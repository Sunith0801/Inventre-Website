"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Layers, Check, AlertTriangle } from "lucide-react";
import { bulkCreateRules } from "./actions";

/**
 * Sits at the top of /admin/delivery-fee-rules. Lets the admin apply a
 * single (category, fee, optional grade, optional amount range) tuple
 * to N schools in one click. Each click produces N rule rows — one per
 * selected school — and busts the delivery-fee Redis cache once at the
 * end so the storefront reflects the new fees immediately.
 *
 * The existing single-school modal (NewRuleButton + RulesTableClient)
 * stays as-is; this card is purely additive.
 */
export function BulkAssignCard({
  schools,
  grades,
}: {
  schools: string[];
  grades: string[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [selectedSchools, setSelectedSchools] = useState<Set<string>>(new Set());
  const [grade, setGrade] = useState<string>("");
  const [category, setCategory] = useState<"Books" | "Uniform">("Uniform");
  const [deliveryFee, setDeliveryFee] = useState<string>("");
  const [minAmount, setMinAmount] = useState<string>("0");
  const [maxAmount, setMaxAmount] = useState<string>("0");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);

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

  async function apply() {
    setFeedback(null);
    if (selectedSchools.size === 0) {
      setFeedback({ ok: false, msg: "Pick at least one school" });
      return;
    }
    const fee = Number(deliveryFee);
    if (!Number.isFinite(fee) || fee < 0) {
      setFeedback({ ok: false, msg: "Delivery fee must be a non-negative number" });
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
        setFeedback({ ok: false, msg: result.error });
      } else {
        setFeedback({
          ok: true,
          msg: `Created ${result.created} rule${result.created === 1 ? "" : "s"}`,
        });
        // Reset selection but keep category / fee so admin can chain
        // multiple bulk operations without retyping the amount.
        setSelectedSchools(new Set());
        startTransition(() => router.refresh());
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-5 rounded-xl border border-brand-200 bg-brand-50/40 p-4">
      <div className="flex items-center gap-2 mb-3">
        <Layers className="h-4 w-4 text-brand-700" />
        <h2 className="text-[14px] font-bold text-ink-900">Bulk-assign delivery fee</h2>
        <span className="text-[11.5px] text-ink-500">
          Apply the same fee to multiple schools in one click. Use the
          single-rule editor below to override per-school later.
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[2fr_3fr] gap-4">
        {/* Left: schools multi-select */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <label className="text-[12px] font-semibold text-ink-700">
              Schools
              <span className="ml-2 text-ink-500 font-normal">
                {selectedSchools.size === 0
                  ? "none"
                  : `${selectedSchools.size} selected`}
              </span>
            </label>
            <button
              type="button"
              onClick={toggleAll}
              className="text-[11.5px] font-semibold text-brand-700 hover:underline"
            >
              {allSelected ? "Clear all" : "Select all"}
            </button>
          </div>
          <div className="max-h-[200px] overflow-y-auto rounded-lg border border-ink-200 bg-white p-2 space-y-1">
            {schools.map((s) => (
              <label
                key={s}
                className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-cream-50 cursor-pointer text-[12.5px]"
              >
                <input
                  type="checkbox"
                  checked={selectedSchools.has(s)}
                  onChange={() => toggleOne(s)}
                  className="h-4 w-4 rounded border-ink-300 text-brand-600"
                />
                <span className="font-mono text-[12px] text-ink-700">{s}</span>
              </label>
            ))}
            {schools.length === 0 ? (
              <p className="px-2 py-3 text-[12px] text-ink-500">
                No active schools.
              </p>
            ) : null}
          </div>
        </div>

        {/* Right: rule details */}
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[12px] font-semibold text-ink-700 block mb-1">
                Category
              </label>
              <div className="flex gap-1.5">
                {(["Uniform", "Books"] as const).map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setCategory(c)}
                    className={
                      "flex-1 h-9 rounded-lg text-[13px] font-semibold border " +
                      (category === c
                        ? "border-brand-500 bg-brand-100 text-brand-800"
                        : "border-ink-200 bg-white text-ink-700 hover:bg-cream-50")
                    }
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-[12px] font-semibold text-ink-700 block mb-1">
                Grade <span className="font-normal text-ink-500">(optional)</span>
              </label>
              <select
                value={grade}
                onChange={(e) => setGrade(e.target.value)}
                className="w-full h-9 rounded-lg border border-ink-200 px-2 text-[13px] bg-white"
              >
                <option value="">All grades</option>
                {grades.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-[12px] font-semibold text-ink-700 block mb-1">
                Delivery fee (₹)
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={deliveryFee}
                onChange={(e) => setDeliveryFee(e.target.value)}
                placeholder="0"
                className="w-full h-9 rounded-lg border border-ink-200 px-2 text-[13px] bg-white font-mono"
              />
            </div>
            <div>
              <label className="text-[12px] font-semibold text-ink-700 block mb-1">
                Min cart amount (₹)
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={minAmount}
                onChange={(e) => setMinAmount(e.target.value)}
                className="w-full h-9 rounded-lg border border-ink-200 px-2 text-[13px] bg-white font-mono"
              />
            </div>
            <div>
              <label className="text-[12px] font-semibold text-ink-700 block mb-1">
                Max cart amount (₹) <span className="font-normal text-ink-400">(0 = no cap)</span>
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={maxAmount}
                onChange={(e) => setMaxAmount(e.target.value)}
                className="w-full h-9 rounded-lg border border-ink-200 px-2 text-[13px] bg-white font-mono"
              />
            </div>
          </div>

          <div className="flex items-center gap-3 pt-1">
            <button
              type="button"
              onClick={apply}
              disabled={busy || selectedSchools.size === 0}
              className={
                "inline-flex items-center gap-2 rounded-lg px-4 py-2 text-[13px] font-semibold " +
                (busy || selectedSchools.size === 0
                  ? "bg-ink-200 text-ink-500 cursor-not-allowed"
                  : "bg-brand-600 text-white hover:bg-brand-700")
              }
            >
              {busy ? "Applying…" : `Apply to ${selectedSchools.size} school${selectedSchools.size === 1 ? "" : "s"}`}
            </button>
            {feedback ? (
              <span
                className={
                  "inline-flex items-center gap-1 text-[12.5px] " +
                  (feedback.ok ? "text-emerald-700" : "text-red-700")
                }
              >
                {feedback.ok ? <Check className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
                {feedback.msg}
              </span>
            ) : null}
          </div>

          <p className="text-[11.5px] text-ink-500">
            Magic Box products are always exempt from delivery fees. Bookkits
            default to ₹0 — change with a Books rule above.
          </p>
        </div>
      </div>
    </div>
  );
}
