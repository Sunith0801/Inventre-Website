"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  Check,
  ChevronLeft,
  ChevronRight,
  Loader2,
} from "lucide-react";
import { createUniformAction } from "../actions";
import {
  AxesPicker,
  axisDefToPayload,
  buildVariantBlueprint,
  resolveAxes,
  useMemoSync,
  type AttributeOption,
  type AxisDef,
  type SelectedAxis,
  type VariantRow,
} from "../_axes-matrix";

export type { AttributeOption };

type Step = 1 | 2;

export function UniformWizard({
  categories,
  attributes: initialAttributes,
}: {
  categories: { id: string; label: string; name: string }[];
  attributes: AttributeOption[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [step, setStep] = useState<Step>(1);
  const [error, setError] = useState<string | null>(null);
  const [attributes, setAttributes] = useState<AttributeOption[]>(initialAttributes);

  // Step 1
  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [status, setStatus] = useState<"active" | "draft" | "archived">("active");

  // Step 2 — axes (Colour first, Size second is enforced on payload, not in
  // the UI so the AxesPicker keeps its add-in-any-order ergonomics).
  const [axes, setAxes] = useState<SelectedAxis[]>([]);
  const axesResolved = useMemo(() => resolveAxes(axes, attributes), [axes, attributes]);

  const typeOfAxis = (a: AxisDef): AttributeOption["type"] | undefined =>
    attributes.find((x) => x.id === a.attributeId)?.type;

  const colorAxes = useMemo(
    () => axesResolved.filter((a) => typeOfAxis(a) === "color"),
    [axesResolved, attributes],
  );
  const sizeAxes = useMemo(
    () => axesResolved.filter((a) => typeOfAxis(a) === "size"),
    [axesResolved, attributes],
  );

  // Normalised order so Colour is axis 0 in the matrix and payload — the PDP
  // renders pickers in axes order, and existing storefront code expects the
  // size axis name to match /size/i to enable per-colour price resolution.
  const orderedAxes = useMemo<AxisDef[]>(
    () => [...colorAxes, ...sizeAxes],
    [colorAxes, sizeAxes],
  );

  const matrixBlueprint = useMemo<VariantRow[]>(
    () => buildVariantBlueprint(orderedAxes, name),
    [orderedAxes, name],
  );

  const [variants, setVariants] = useState<VariantRow[]>([]);
  useMemoSync(matrixBlueprint, setVariants);

  const axesShapeOk =
    colorAxes.length === 1 &&
    sizeAxes.length === 1 &&
    axesResolved.length === 2 &&
    axesResolved.every((a) => a.values.length >= 1);

  const stepValid = (s: Step): boolean => {
    switch (s) {
      case 1:
        return name.trim().length > 0;
      case 2:
        return (
          axesShapeOk &&
          variants.length > 0 &&
          variants.every((v) => v.sku.trim().length > 0)
        );
    }
  };

  async function submit() {
    setError(null);
    start(async () => {
      const res = await createUniformAction({
        name: name.trim(),
        categoryId: categoryId || null,
        // No base price / MRP from this flow — per-variant prices on the
        // product detail page are the source of truth. Server stores 0 as
        // the column default; basics tab still lets admins set a fallback.
        basePrice: 0,
        baseMrp: null,
        status,
        schoolIds: [],
        grades: [],
        axes: orderedAxes.map(axisDefToPayload),
        variants,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.push(`/admin/products/${res.productId}`);
    });
  }

  return (
    <div className="max-w-5xl">
      <StepStrip current={step} />
      {error && (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 flex items-start gap-2 text-[13px] text-red-700">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {step === 1 && (
        <Step1 {...{ name, setName, categoryId, setCategoryId, status, setStatus, categories }} />
      )}
      {step === 2 && (
        <Step2
          axes={axes}
          setAxes={setAxes}
          attributes={attributes}
          setAttributes={setAttributes}
          variants={variants}
          setVariants={setVariants}
          colorCount={colorAxes.length}
          sizeCount={sizeAxes.length}
          axesShapeOk={axesShapeOk}
        />
      )}

      <div className="mt-8 flex items-center justify-between">
        {step > 1 ? (
          <button type="button" onClick={() => setStep(1)} className="inline-flex items-center gap-1 rounded-full border border-ink-200 px-4 h-10 text-[13px] font-semibold text-ink-700 hover:border-ink-900">
            <ChevronLeft className="h-3.5 w-3.5" /> Back
          </button>
        ) : (
          <span />
        )}
        {step < 2 ? (
          <button type="button" disabled={!stepValid(1)} onClick={() => setStep(2)} className="inline-flex items-center gap-1 rounded-full bg-ink-900 text-white px-5 h-10 text-[13px] font-bold disabled:opacity-50">
            Next <ChevronRight className="h-3.5 w-3.5" />
          </button>
        ) : (
          <button type="button" disabled={pending || !stepValid(2)} onClick={submit} className="inline-flex items-center gap-2 rounded-full bg-brand text-white px-6 h-11 text-[14px] font-bold hover:bg-brand-600 disabled:opacity-60">
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            {pending ? "Creating…" : "Create & open product"}
          </button>
        )}
      </div>
    </div>
  );
}

function StepStrip({ current }: { current: Step }) {
  const steps: { n: Step; label: string }[] = [
    { n: 1, label: "Identify" },
    { n: 2, label: "Variants (Colour × Size)" },
  ];
  return (
    <ol className="mt-6 flex items-center gap-2 flex-wrap">
      {steps.map((s, i) => (
        <li key={s.n} className="flex items-center gap-2">
          <span className={"grid h-7 w-7 place-items-center rounded-full text-[12px] font-bold border " + (current === s.n ? "bg-ink-900 text-white border-ink-900" : current > s.n ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-white text-ink-500 border-ink-200")}>
            {current > s.n ? <Check className="h-3.5 w-3.5" /> : s.n}
          </span>
          <span className={"text-[12.5px] " + (current === s.n ? "font-bold text-ink-900" : "text-ink-500")}>{s.label}</span>
          {i < steps.length - 1 && <span className="text-ink-300">·</span>}
        </li>
      ))}
    </ol>
  );
}

function Step1(p: {
  name: string;
  setName: (v: string) => void;
  categoryId: string;
  setCategoryId: (v: string) => void;
  status: "active" | "draft" | "archived";
  setStatus: (v: "active" | "draft" | "archived") => void;
  categories: { id: string; label: string; name: string }[];
}) {
  return (
    <section className="mt-6 rounded-2xl border border-ink-100 bg-white p-6 space-y-4">
      <h2 className="font-display text-[16px] font-bold text-ink-900">Step 1 · Identify</h2>
      <Field label="Name" required>
        <input value={p.name} onChange={(e) => p.setName(e.target.value)} placeholder="SAS BP Shirt" className={fieldCls} />
      </Field>
      <Field label="Category" hint="Drives shop nav grouping. Pick Shirt, Frock, Half Pants, etc.">
        <select value={p.categoryId} onChange={(e) => p.setCategoryId(e.target.value)} className={fieldCls}>
          <option value="">— none —</option>
          {p.categories.map((c) => (
            <option key={c.id} value={c.id}>{c.label}</option>
          ))}
        </select>
      </Field>
      <Field label="Status">
        <select value={p.status} onChange={(e) => p.setStatus(e.target.value as typeof p.status)} className={fieldCls}>
          <option value="active">Active</option>
          <option value="draft">Draft</option>
          <option value="archived">Archived</option>
        </select>
      </Field>
      <p className="text-[11px] text-ink-500 leading-snug">
        Behind the scenes: products.kind = &apos;uniform&apos; · products.attribute_groups is populated from your axes in Step 2.
        Per-variant prices are set in the Variants tab after creation — no base price needed here.
      </p>
    </section>
  );
}

function Step2(p: {
  axes: SelectedAxis[];
  setAxes: (v: SelectedAxis[]) => void;
  attributes: AttributeOption[];
  setAttributes: (v: AttributeOption[]) => void;
  variants: VariantRow[];
  setVariants: (v: VariantRow[]) => void;
  colorCount: number;
  sizeCount: number;
  axesShapeOk: boolean;
}) {
  const tooManyColor = p.colorCount > 1;
  const tooManySize = p.sizeCount > 1;
  const missingColor = p.colorCount === 0;
  const missingSize = p.sizeCount === 0;

  return (
    <section className="mt-6 rounded-2xl border border-ink-100 bg-white p-6 space-y-5">
      <h2 className="font-display text-[16px] font-bold text-ink-900">
        Step 2 · Variants (Colour × Size)
      </h2>
      <p className="text-[12.5px] text-ink-500 leading-snug max-w-2xl">
        Add one <b>Colour</b> attribute and one <b>Size</b> attribute, then tick
        the values you sell. The matrix below auto-generates one SKU per
        Colour × Size cell. You&apos;ll add per-variant prices and images after
        the product is created.
      </p>

      <AxesPicker
        axes={p.axes}
        setAxes={p.setAxes}
        attributes={p.attributes}
        setAttributes={p.setAttributes}
        allowedTypes={["color", "size"]}
      />

      {(tooManyColor || tooManySize || missingColor || missingSize) && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[12.5px] text-amber-800 space-y-1">
          {missingColor && <div>• Add one Colour axis to continue.</div>}
          {missingSize && <div>• Add one Size axis to continue.</div>}
          {tooManyColor && <div>• Only one Colour axis is allowed in this flow.</div>}
          {tooManySize && <div>• Only one Size axis is allowed in this flow.</div>}
        </div>
      )}

      {p.axesShapeOk && p.variants.length > 0 && (
        <div className="space-y-2">
          <p className="text-[12px] font-semibold text-ink-700">
            {p.variants.length} variant{p.variants.length === 1 ? "" : "s"} will be created
          </p>
          <VariantsPreview variants={p.variants} setVariants={p.setVariants} />
          <p className="text-[11px] text-ink-500 italic">
            Edit the SKU if you want to override the auto-derived value. Untick
            <b> Active</b> to skip a combination. Per-variant prices, stock, and
            images are added on the product page after save.
          </p>
        </div>
      )}
    </section>
  );
}

function VariantsPreview({
  variants,
  setVariants,
}: {
  variants: VariantRow[];
  setVariants: (v: VariantRow[]) => void;
}) {
  const update = (i: number, patch: Partial<VariantRow>) => {
    setVariants(variants.map((v, idx) => (idx === i ? { ...v, ...patch } : v)));
  };
  return (
    <div className="overflow-x-auto rounded-xl border border-ink-100">
      <table className="w-full text-[13px] min-w-[520px]">
        <thead className="bg-ink-50/60">
          <tr className="text-left text-[10px] font-semibold tracking-wider uppercase text-ink-500">
            <th className="py-2 px-3">Combo (Colour · Size)</th>
            <th className="py-2 px-3">SKU</th>
            <th className="py-2 px-3 text-center w-20">Active</th>
          </tr>
        </thead>
        <tbody>
          {variants.map((v, i) => (
            <tr key={i} className="border-t border-ink-100">
              <td className="py-1.5 px-3 text-ink-700">{v.sizeLabel}</td>
              <td className="py-1.5 px-3">
                <input
                  type="text"
                  value={v.sku}
                  onChange={(e) => update(i, { sku: e.target.value })}
                  className="w-full rounded-md border border-ink-200 px-2 py-1 text-[13px] font-mono outline-none focus:border-ink-900"
                />
              </td>
              <td className="py-1.5 px-3 text-center">
                <input
                  type="checkbox"
                  checked={v.isActive}
                  onChange={(e) => update(i, { isActive: e.target.checked })}
                  className="h-4 w-4"
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Field({ label, required, hint, children }: { label: string; required?: boolean; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[12px] font-semibold text-ink-700">{label}{required && <span className="text-red-500"> *</span>}</span>
      <div className="mt-1.5">{children}</div>
      {hint && <p className="mt-1 text-[11px] text-ink-500 leading-snug">{hint}</p>}
    </label>
  );
}

const fieldCls = "w-full rounded-xl border border-ink-200 bg-white px-3 py-2.5 text-[14px] outline-none focus:border-ink-900";
