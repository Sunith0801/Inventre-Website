"use client";

import { forwardRef, useImperativeHandle, useRef, useState, useTransition } from "react";
import { Button } from "@/components/admin/ui/primitives";
import { createRule, updateRule } from "./actions";

/** The two categories the admin panel writes. Stored as exactly these
 *  strings in ERPNext's Applicable Item Group child table — they map to
 *  existing Item Group records ("Uniform", "Books"). */
const CATEGORIES = ["Uniform", "Books"] as const;
type Category = (typeof CATEGORIES)[number];

const FIELD = "h-9 w-full px-2.5 rounded-lg border border-ink-200 text-[13px] bg-white";
const LABEL = "block text-[11px] font-medium text-ink-500 mb-1";

export type RuleFormInitial = {
  /** ERPNext rule name. Present in edit mode; absent in create mode. */
  name?: string;
  school: string;
  is_active: boolean;
  min_amount: number;
  max_amount: number;
  delivery_fee: number;
  /** Raw item_group strings from ERPNext — may include legacy values like
   *  "Books Bundle" / "BOOKKIT" / "Uniforms". Normalized to one of CATEGORIES
   *  when picking initial checkbox state. */
  applicable_item_groups: string[];
  /** Optional grade from `delivery_fee_rule_grades` (local side-table). */
  grade: string;
};

const EMPTY_INITIAL: RuleFormInitial = {
  school: "",
  is_active: true,
  min_amount: 0,
  max_amount: 0,
  delivery_fee: 0,
  applicable_item_groups: [],
  grade: "",
};

function normalizeToCategories(raw: string[]): Category[] {
  const out = new Set<Category>();
  for (const v of raw) {
    if (/book/i.test(v)) out.add("Books");
    else out.add("Uniform");
  }
  return Array.from(out);
}

export type RuleFormDialogHandle = {
  open: (initial: RuleFormInitial) => void;
};

/** Modal form used for both "New rule" and "Edit rule". The parent holds
 *  the ref and calls `open(initial)`; create vs. update is inferred from
 *  whether `initial.name` is set. */
export const RuleFormDialog = forwardRef<
  RuleFormDialogHandle,
  {
    schools: string[];
    grades: string[];
  }
>(function RuleFormDialog({ schools, grades }, ref) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [initial, setInitial] = useState<RuleFormInitial>(EMPTY_INITIAL);
  const [selectedCategories, setSelectedCategories] = useState<Category[]>([]);
  const isEdit = !!initial.name;

  useImperativeHandle(ref, () => ({
    open(next) {
      setError(null);
      setInitial(next);
      setSelectedCategories(normalizeToCategories(next.applicable_item_groups));
      // Defer until state-driven defaultValues are applied to the form.
      queueMicrotask(() => dialogRef.current?.showModal());
    },
  }));

  const toggleCategory = (c: Category) =>
    setSelectedCategories((cur) =>
      cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c]
    );

  return (
    <dialog
      ref={dialogRef}
      className="rounded-2xl shadow-xl border border-ink-100 p-0 backdrop:bg-black/40 w-[560px] max-w-[95vw]"
    >
      <form
        ref={formRef}
        // Re-mount the form whenever the initial changes so input
        // defaultValues re-apply (uncontrolled inputs ignore prop changes).
        key={initial.name ?? "new"}
        action={(fd) => {
          setError(null);
          for (const c of selectedCategories) fd.append("applicable_item_groups", c);
          if (initial.name) fd.append("name", initial.name);
          startTransition(async () => {
            const r = isEdit ? await updateRule(fd) : await createRule(fd);
            if (r.ok) {
              dialogRef.current?.close();
              formRef.current?.reset();
              if (typeof window !== "undefined") window.location.reload();
            } else {
              setError(r.error);
            }
          });
        }}
      >
        <div className="px-5 py-4 border-b border-ink-100">
          <div className="text-[11px] uppercase tracking-wide text-ink-500">ERPNext</div>
          <h2 className="text-base font-semibold text-ink-900">
            {isEdit ? "Edit Delivery Fee Rule" : "New Delivery Fee Rule"}
          </h2>
          <p className="text-[12px] text-ink-500 mt-1">
            {isEdit
              ? "Updates the rule in ERPNext; grade scope is stored locally."
              : "Creates the rule in ERPNext; optional grade scope is stored locally."}
          </p>
        </div>
        <div className="px-5 py-4 grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className={LABEL}>School</label>
            <select
              name="school"
              className={FIELD}
              defaultValue={initial.school}
              required
            >
              <option value="" disabled>
                — select a school —
              </option>
              {schools.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div className="col-span-2">
            <label className={LABEL}>
              Grade <span className="text-ink-400">— optional, leave blank for all grades</span>
            </label>
            <select name="grade" className={FIELD} defaultValue={initial.grade}>
              <option value="">All grades</option>
              {grades.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={LABEL}>Min amount (₹)</label>
            <input
              name="min_amount"
              type="number"
              min="0"
              step="0.01"
              className={FIELD}
              defaultValue={initial.min_amount}
            />
          </div>
          <div>
            <label className={LABEL}>
              Max amount (₹) <span className="text-ink-400">— 0 = no cap</span>
            </label>
            <input
              name="max_amount"
              type="number"
              min="0"
              step="0.01"
              className={FIELD}
              defaultValue={initial.max_amount}
            />
          </div>
          <div className="col-span-2">
            <label className={LABEL}>Delivery fee (₹)</label>
            <input
              name="delivery_fee"
              type="number"
              min="0"
              step="0.01"
              className={FIELD}
              defaultValue={initial.delivery_fee}
            />
          </div>
          <div className="col-span-2">
            <label className="inline-flex items-center gap-2 text-[13px] text-ink-700">
              <input
                name="is_active"
                type="checkbox"
                defaultChecked={initial.is_active}
              />
              Active
            </label>
          </div>
          <div className="col-span-2">
            <label className={LABEL}>
              Applicable categories{" "}
              <span className="text-ink-400">
                ({selectedCategories.length === 0
                  ? "all items"
                  : selectedCategories.length + " selected"})
              </span>
            </label>
            <div className="border border-ink-200 rounded-lg p-3 bg-white flex gap-6">
              {CATEGORIES.map((c) => (
                <label
                  key={c}
                  className="inline-flex items-center gap-2 text-[13px] text-ink-700"
                >
                  <input
                    type="checkbox"
                    checked={selectedCategories.includes(c)}
                    onChange={() => toggleCategory(c)}
                  />
                  {c === "Uniform" ? "Uniforms" : "Books"}
                </label>
              ))}
            </div>
            <p className="mt-1.5 text-[11px] text-ink-500 leading-snug">
              Bookkit / Bookset products fall under <b>Books</b>. Every other
              product is treated as <b>Uniforms</b>. Leave both unchecked to
              apply the rule to all items.
            </p>
          </div>
        </div>
        {error && (
          <div className="mx-5 mb-3 px-3 py-2 rounded-lg bg-rose-50 text-rose-700 text-[12px]">
            {error}
          </div>
        )}
        <div className="px-5 py-3 border-t border-ink-100 flex items-center justify-end gap-2 bg-cream-50/50">
          <Button
            type="button"
            variant="secondary"
            onClick={() => dialogRef.current?.close()}
          >
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? (isEdit ? "Saving…" : "Creating…") : isEdit ? "Save changes" : "Create rule"}
          </Button>
        </div>
      </form>
    </dialog>
  );
});
