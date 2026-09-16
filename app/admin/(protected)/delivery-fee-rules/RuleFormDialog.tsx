"use client";

import { forwardRef, useImperativeHandle, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Input, Select, Checkbox, FormGrid, FormError } from "@/components/admin/ui/primitives";
import { Dialog } from "@/components/admin/ui/dialog";
import { createRule, updateRule } from "./actions";

/** The two categories the admin panel writes. Stored as exactly these
 *  strings in ERPNext's Applicable Item Group child table — they map to
 *  existing Item Group records ("Uniform", "Books"). */
const CATEGORIES = ["Uniform", "Books"] as const;
type Category = (typeof CATEGORIES)[number];

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
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [initial, setInitial] = useState<RuleFormInitial>(EMPTY_INITIAL);
  const [selectedCategories, setSelectedCategories] = useState<Category[]>([]);
  const isEdit = !!initial.name;
  const formId = "delivery-fee-rule-form";

  useImperativeHandle(ref, () => ({
    open(next) {
      setError(null);
      setInitial(next);
      setSelectedCategories(normalizeToCategories(next.applicable_item_groups));
      setOpen(true);
    },
  }));

  const close = () => {
    if (pending) return;
    setOpen(false);
  };

  const toggleCategory = (c: Category) =>
    setSelectedCategories((cur) => (cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c]));

  return (
    <Dialog
      open={open}
      onClose={close}
      title={isEdit ? `Edit rule ${initial.name}` : "New delivery fee rule"}
      description="Saved to ERPNext straight away; the storefront picks it up on the next cart calculation."
      busy={pending}
      width="lg"
      footer={
        <>
          <Button type="button" variant="secondary" onClick={close} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" form={formId} variant="primary" busy={pending}>
            {isEdit ? "Save changes" : "Create rule"}
          </Button>
        </>
      }
    >
      <form
        id={formId}
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
              setOpen(false);
              router.refresh();
            } else {
              setError(r.error);
            }
          });
        }}
        className="space-y-4"
      >
        <FormGrid cols={2}>
          <Field label="School" htmlFor="dfr-school" required>
            <Select id="dfr-school" name="school" defaultValue={initial.school} required>
              <option value="" disabled>Choose a school</option>
              {schools.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </Select>
          </Field>
          <Field label="Grade" htmlFor="dfr-grade">
            <Select id="dfr-grade" name="grade" defaultValue={initial.grade}>
              <option value="">All grades</option>
              {grades.map((g) => (
                <option key={g} value={g}>{g}</option>
              ))}
            </Select>
          </Field>
          <Field label="Delivery fee (₹)" htmlFor="dfr-fee" required>
            <Input id="dfr-fee" name="delivery_fee" type="number" min="0" step="0.01" defaultValue={initial.delivery_fee} className="text-right tabular-nums" />
          </Field>
          <Field label="Status" htmlFor="dfr-active">
            <div className="flex h-9 items-center">
              <Checkbox id="dfr-active" name="is_active" defaultChecked={initial.is_active} label="Active" />
            </div>
          </Field>
          <Field label="Minimum cart (₹)" htmlFor="dfr-min" hint="Rule applies from this cart value">
            <Input id="dfr-min" name="min_amount" type="number" min="0" step="0.01" defaultValue={initial.min_amount} className="text-right tabular-nums" />
          </Field>
          <Field label="Maximum cart (₹)" htmlFor="dfr-max" hint="0 = no upper limit">
            <Input id="dfr-max" name="max_amount" type="number" min="0" step="0.01" defaultValue={initial.max_amount} className="text-right tabular-nums" />
          </Field>
        </FormGrid>
        <div>
          <div className="mb-1.5 text-[12px] font-semibold text-ink-700">
            Applies to{" "}
            <span className="font-normal text-ink-500">
              {selectedCategories.length === 0 ? "· all products" : `· ${selectedCategories.length} categor${selectedCategories.length === 1 ? "y" : "ies"}`}
            </span>
          </div>
          <div className="flex gap-6 rounded-lg border border-ink-100 bg-cream-50 px-3 py-2.5">
            {CATEGORIES.map((c) => (
              <Checkbox key={c} label={c === "Uniform" ? "Uniforms" : "Books"} checked={selectedCategories.includes(c)} onChange={() => toggleCategory(c)} />
            ))}
          </div>
        </div>
        <FormError>{error}</FormError>
      </form>
    </Dialog>
  );
});
