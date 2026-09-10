"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronLeft, ChevronRight, Loader2, Plus, Search, Trash2, AlertCircle } from "lucide-react";
import { createBookkitAction } from "../actions";
import {
  AxesPicker,
  VariantsMatrix,
  axisDefToPayload,
  buildVariantBlueprint,
  resolveAxes,
  splitComboValue,
  useMemoSync,
  type AttributeOption,
  type SelectedAxis,
  type VariantRow,
} from "../_axes-matrix";

export type { AttributeOption };

// Mirror of the BookkitChildPayload union — kept structurally identical
// so the client can hand the same shape straight to the server action.
type LeafChild = {
  kind: "new_leaf";
  name: string;
  basePrice: number;
  productKind: "book" | "consumable" | "accessory";
  qty: number;
  isOptional?: boolean;
};
type ExistingChild = {
  kind: "existing";
  productId: string;
  productName: string;
  qty: number;
  isOptional?: boolean;
};
type SubBundleChild = {
  kind: "new_sub_bundle";
  name: string;
  basePrice: number;
  children: Child[];
  qty: number;
  isOptional?: boolean;
};
type Child = LeafChild | ExistingChild | SubBundleChild;

type LanguageCombo = { secondLang: string; thirdLang: string };

type Step = 1 | 2 | 3 | 4 | 5;

const COMMON_LANGS = [
  "Hindi",
  "Telugu",
  "Kannada",
  "Sanskrit",
  "Marathi",
  "Tamil",
  "Malayalam",
  "Urdu",
  "English",
  "Bengali",
  "Punjabi",
  "Gujarati",
  "French",
];

export function BookkitWizard({
  categories,
  schools,
  gradeOptions,
  attributes: initialAttributes,
}: {
  categories: { id: string; label: string; name: string }[];
  schools: { id: string; name: string }[];
  gradeOptions: string[];
  /** Attribute catalog for the multi-axis Variant style on Step 4.
   *  Empty array hides the multi-axis option. */
  attributes: AttributeOption[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [step, setStep] = useState<Step>(1);
  const [error, setError] = useState<string | null>(null);
  // Local mutable copy so the AxesPicker's inline create-attribute /
  // add-value controls can grow the catalog without a page reload.
  const [attributes, setAttributes] = useState<AttributeOption[]>(initialAttributes);

  // Step 1
  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState<string>("");
  const [basePrice, setBasePrice] = useState<number | "">("");
  const [baseMrp, setBaseMrp] = useState<number | "">("");
  const [status, setStatus] = useState<"active" | "draft" | "archived">("active");

  // Step 2
  const [schoolIds, setSchoolIds] = useState<string[]>([]);
  const [grades, setGrades] = useState<string[]>([]);

  // Step 3
  const [children, setChildren] = useState<Child[]>([]);
  const [skipChildren, setSkipChildren] = useState(false);

  // Step 4 — Variant style fork. Mutually exclusive so we never end up
  // writing two overlapping product_variants sets for the same kit.
  const [variantStyle, setVariantStyle] = useState<
    "none" | "language" | "multiAxis" | "guidedStreams"
  >("none");
  const [withLangs, setWithLangs] = useState(false);
  const [seconds, setSeconds] = useState<string[]>([]);
  const [thirds, setThirds] = useState<string[]>([]); // "" entry means "no 3rd language"
  // Per-language-combo BOM and price overrides. Combo key shape is
  // `${secondLang}||${thirdLang}` (thirdLang is "" when not picked). Each
  // language combo will be persisted as its own sibling-kit product with
  // variant_of_product_id pointing at the template parent — see
  // createBookkitWithBom's sibling-kit branch.
  const [bomByCombo, setBomByCombo] = useState<Record<string, Child[]>>({});
  const [pricesByLangCombo, setPricesByLangCombo] = useState<Record<string, string>>({});
  const langComboKey = (secondLang: string, thirdLang: string) =>
    `${secondLang}||${thirdLang}`;

  // Multi-axis sub-state — shape identical to the Uniform wizard so the
  // same _axes-matrix UI renders without per-flow tweaks.
  const [axes, setAxes] = useState<SelectedAxis[]>([]);
  const axesResolved = useMemo(() => resolveAxes(axes, attributes), [axes, attributes]);
  const matrixBlueprint = useMemo<VariantRow[]>(
    () => buildVariantBlueprint(axesResolved, name),
    [axesResolved, name],
  );
  const [axisVariants, setAxisVariants] = useState<VariantRow[]>([]);
  useMemoSync(matrixBlueprint, setAxisVariants);

  // Guided Streams + Languages + Electives sub-state. Domain-named to
  // match the admin's mental model — no "axes" or "values" leak through
  // the wizard UI. The builder maps these labels to product_attributes /
  // product_attribute_values transactionally at save time.
  const [hasStreams, setHasStreams] = useState(false);
  const [streams, setStreams] = useState<string[]>([]);
  const [hasLanguages, setHasLanguages] = useState(false);
  const [languages, setLanguages] = useState<string[]>([]);
  // Per-stream auto-included BOM children. Key: stream label.
  const [mandatesPerStream, setMandatesPerStream] = useState<Record<string, Child[]>>({});
  const [hasElective1, setHasElective1] = useState(false);
  const [hasElective2, setHasElective2] = useState(false);
  // Subjects per combo. Key: `${streamLabel}||${languageLabel}` — each
  // side is "" when the matching axis is disabled.
  const [elective1ByCombo, setElective1ByCombo] = useState<Record<string, string[]>>({});
  const [elective2ByCombo, setElective2ByCombo] = useState<Record<string, string[]>>({});
  // Per-combo price overrides in RUPEES (admin-facing). Combo key shape is
  // `${stream}||${language}||${elective1}||${elective2}` with empty string
  // for each disabled axis. Empty/missing entries fall back to basePrice.
  const [pricesByCombo, setPricesByCombo] = useState<Record<string, string>>({});

  // Reconcile per-combo electives when streams/languages change — drop
  // entries whose combo key no longer matches any active (stream, lang).
  useEffect(() => {
    if (variantStyle !== "guidedStreams") return;
    const sIter = hasStreams ? streams : [""];
    const lIter = hasLanguages ? languages : [""];
    const validKeys = new Set<string>();
    for (const s of sIter) for (const l of lIter) validKeys.add(`${s}||${l}`);
    const prune = (rec: Record<string, string[]>) => {
      const next: Record<string, string[]> = {};
      let changed = false;
      for (const [k, v] of Object.entries(rec)) {
        if (validKeys.has(k)) next[k] = v;
        else changed = true;
      }
      return changed ? next : rec;
    };
    setElective1ByCombo((cur) => prune(cur));
    setElective2ByCombo((cur) => prune(cur));
    // Drop mandates for streams no longer in the list.
    const activeStreams = new Set(streams);
    setMandatesPerStream((cur) => {
      let changed = false;
      const next: Record<string, Child[]> = {};
      for (const [k, v] of Object.entries(cur)) {
        if (activeStreams.has(k) || !hasStreams) next[k] = v;
        else changed = true;
      }
      return changed ? next : cur;
    });
  }, [variantStyle, hasStreams, hasLanguages, streams, languages]);

  // Live variant count = Σ over combos of (e1_count × e2_count).
  // Disabled axes contribute a factor of 1.
  const streamVariantCount = useMemo(() => {
    if (variantStyle !== "guidedStreams") return 0;
    const sIter = hasStreams ? streams : [""];
    const lIter = hasLanguages ? languages : [""];
    if (sIter.length === 0 || lIter.length === 0) return 0;
    let total = 0;
    for (const s of sIter) {
      for (const l of lIter) {
        const k = `${s}||${l}`;
        const e1n = hasElective1 ? (elective1ByCombo[k]?.length ?? 0) : 1;
        const e2n = hasElective2 ? (elective2ByCombo[k]?.length ?? 0) : 1;
        if (hasElective1 && e1n === 0) continue;
        if (hasElective2 && e2n === 0) continue;
        total += e1n * e2n;
      }
    }
    return total;
  }, [variantStyle, hasStreams, hasLanguages, streams, languages, hasElective1, hasElective2, elective1ByCombo, elective2ByCombo]);

  // computed: language combos to ship
  const languageCombos = useMemo<LanguageCombo[]>(() => {
    if (variantStyle !== "language" || !withLangs || seconds.length === 0) return [];
    if (thirds.length === 0) {
      return seconds.map((s) => ({ secondLang: s, thirdLang: "" }));
    }
    const out: LanguageCombo[] = [];
    // Skip self-pair combos (e.g. 2nd=Hindi + 3rd=Hindi) — UI also disables
    // matching chips, but we double-belt here in case state drifts.
    for (const s of seconds) for (const t of thirds) {
      if (s === t) continue;
      out.push({ secondLang: s, thirdLang: t });
    }
    return out;
  }, [variantStyle, withLangs, seconds, thirds]);

  // Prune bomByCombo / pricesByLangCombo entries when the combo set shrinks
  // so stale rows don't get written on save.
  useEffect(() => {
    if (variantStyle !== "language") return;
    const valid = new Set(languageCombos.map((c) => langComboKey(c.secondLang, c.thirdLang)));
    const prune = <V,>(rec: Record<string, V>): Record<string, V> => {
      let changed = false;
      const next: Record<string, V> = {};
      for (const [k, v] of Object.entries(rec)) {
        if (valid.has(k)) next[k] = v;
        else changed = true;
      }
      return changed ? next : rec;
    };
    setBomByCombo((cur) => prune(cur));
    setPricesByLangCombo((cur) => prune(cur));
  }, [variantStyle, languageCombos]);

  // Step validation gates the Next button.
  const stepValid = (s: Step): boolean => {
    switch (s) {
      case 1:
        return (
          name.trim().length > 0 &&
          (basePrice === "" || basePrice >= 0) &&
          (baseMrp === "" || baseMrp >= 0)
        );
      case 2:
        return true; // schools / grades optional but recommended
      case 3:
        return skipChildren || children.length > 0; // at least one child OR explicit opt-out
      case 4:
        if (variantStyle === "none") return true;
        if (variantStyle === "language") return seconds.length > 0;
        if (variantStyle === "multiAxis") {
          return (
            axesResolved.length >= 1 &&
            axesResolved.every((a) => a.values.length >= 1) &&
            axisVariants.length > 0 &&
            axisVariants.every((v) => v.sku.trim().length > 0)
          );
        }
        // guidedStreams: at least one axis enabled (Streams / Languages
        // / Elective 1 / Elective 2), and for every enabled axis its
        // input is non-empty. Every (Stream × Language) combo needs ≥1
        // subject for each enabled Elective.
        if (variantStyle === "guidedStreams") {
          if (!hasStreams && !hasLanguages && !hasElective1 && !hasElective2) return false;
          if (hasStreams && streams.length === 0) return false;
          if (hasLanguages && languages.length === 0) return false;
          const sIter = hasStreams ? streams : [""];
          const lIter = hasLanguages ? languages : [""];
          for (const s of sIter) {
            for (const l of lIter) {
              const k = `${s}||${l}`;
              if (hasElective1 && (elective1ByCombo[k]?.length ?? 0) === 0) return false;
              if (hasElective2 && (elective2ByCombo[k]?.length ?? 0) === 0) return false;
            }
          }
          return streamVariantCount > 0;
        }
        return false;
      case 5:
        return true;
    }
  };

  async function submit() {
    setError(null);
    start(async () => {
      const res = await createBookkitAction({
        name: name.trim(),
        categoryId: categoryId || null,
        basePrice: basePrice === "" ? 0 : basePrice,
        baseMrp: baseMrp === "" ? null : Number(baseMrp),
        status,
        schoolIds,
        grades,
        children: skipChildren ? [] : childrenForServer(children),
        languageVariants:
          variantStyle === "language" && languageCombos.length > 0
            ? languageCombos.map((c) => ({
                secondLang: c.secondLang,
                thirdLang: c.thirdLang || null,
              }))
            : undefined,
        languageCombos:
          variantStyle === "language" && languageCombos.length > 0
            ? (() => {
                const bomWire: Record<string, unknown[]> = {};
                for (const c of languageCombos) {
                  const k = `${c.secondLang}||${c.thirdLang}`;
                  const wire = childrenForServer(bomByCombo[k] ?? []);
                  if (wire.length > 0) bomWire[k] = wire;
                }
                const priceWire: Record<string, number> = {};
                for (const c of languageCombos) {
                  const k = `${c.secondLang}||${c.thirdLang}`;
                  const trimmed = (pricesByLangCombo[k] ?? "").trim();
                  if (!trimmed) continue;
                  const n = Number(trimmed);
                  if (!Number.isFinite(n) || n < 0) continue;
                  priceWire[k] = Math.round(n * 100);
                }
                return {
                  bomByCombo: Object.keys(bomWire).length > 0 ? bomWire : undefined,
                  pricesByCombo: Object.keys(priceWire).length > 0 ? priceWire : undefined,
                };
              })()
            : undefined,
        multiAxis: (() => {
          if (variantStyle === "multiAxis" && axesResolved.length > 0 && axisVariants.length > 0) {
            return {
              mode: "flat" as const,
              axes: axesResolved.map(axisDefToPayload),
              variants: axisVariants,
            };
          }
          if (variantStyle === "guidedStreams") {
            const mandates: Record<string, unknown[]> = {};
            for (const [stream, children] of Object.entries(mandatesPerStream)) {
              if (!hasStreams || !streams.includes(stream)) continue;
              const wireChildren = childrenForServer(children);
              if (wireChildren.length > 0) mandates[stream] = wireChildren;
            }
            // Convert rupee strings → paise integers, dropping blanks and
            // anything that doesn't parse. Server-side Zod requires ≥0
            // integers, so we filter here rather than letting the action
            // reject the whole payload.
            const paiseByCombo: Record<string, number> = {};
            for (const [k, v] of Object.entries(pricesByCombo)) {
              const trimmed = v.trim();
              if (!trimmed) continue;
              const n = Number(trimmed);
              if (!Number.isFinite(n) || n < 0) continue;
              paiseByCombo[k] = Math.round(n * 100);
            }
            return {
              mode: "guidedStreams" as const,
              streams: hasStreams ? streams : undefined,
              languages: hasLanguages ? languages : undefined,
              mandatesPerStream: Object.keys(mandates).length > 0 ? mandates : undefined,
              elective1: hasElective1 ? elective1ByCombo : undefined,
              elective2: hasElective2 ? elective2ByCombo : undefined,
              pricesByCombo: Object.keys(paiseByCombo).length > 0 ? paiseByCombo : undefined,
            };
          }
          return undefined;
        })(),
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.push(`/admin/products/${res.productId}`);
    });
  }

  return (
    <div className="max-w-4xl">
      <StepStrip current={step} />
      {error && (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 flex items-start gap-2 text-[13px] text-red-700">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {step === 1 && (
        <Step1
          {...{ name, setName, categoryId, setCategoryId, basePrice, setBasePrice, baseMrp, setBaseMrp, status, setStatus, categories }}
        />
      )}
      {step === 2 && (
        <Step2 {...{ schoolIds, setSchoolIds, grades, setGrades, schools, gradeOptions }} />
      )}
      {step === 3 && (
        <Step3 {...{ children, setChildren, skipChildren, setSkipChildren }} />
      )}
      {step === 4 && (
        <Step4
          variantStyle={variantStyle}
          setVariantStyle={(v) => {
            setVariantStyle(v);
            // Reset the "other style"'s sub-state when switching so we
            // never carry stale data into Step 5 or the submit payload.
            if (v !== "language") {
              setWithLangs(false);
              setSeconds([]);
              setThirds([]);
              setBomByCombo({});
              setPricesByLangCombo({});
            } else {
              // Language mode owns the BOM at the per-combo level (Step 5).
              // The parent kit has no shared children, so default-skip Step 3.
              setSkipChildren(true);
            }
            if (v !== "multiAxis") {
              setAxes([]);
            }
            if (v !== "guidedStreams") {
              setHasStreams(false);
              setStreams([]);
              setHasLanguages(false);
              setLanguages([]);
              setMandatesPerStream({});
              setHasElective1(false);
              setHasElective2(false);
              setElective1ByCombo({});
              setElective2ByCombo({});
              setPricesByCombo({});
            }
          }}
          withLangs={withLangs}
          setWithLangs={setWithLangs}
          seconds={seconds}
          setSeconds={setSeconds}
          thirds={thirds}
          setThirds={setThirds}
          parentName={name}
          combos={languageCombos}
          bomByCombo={bomByCombo}
          setBomByCombo={setBomByCombo}
          pricesByLangCombo={pricesByLangCombo}
          setPricesByLangCombo={setPricesByLangCombo}
          attributes={attributes}
          setAttributes={setAttributes}
          axes={axes}
          setAxes={setAxes}
          axesResolved={axesResolved}
          axisVariants={axisVariants}
          setAxisVariants={setAxisVariants}
          // guided streams sub-state
          hasStreams={hasStreams}
          setHasStreams={setHasStreams}
          streams={streams}
          setStreams={setStreams}
          hasLanguages={hasLanguages}
          setHasLanguages={setHasLanguages}
          languages={languages}
          setLanguages={setLanguages}
          mandatesPerStream={mandatesPerStream}
          setMandatesPerStream={setMandatesPerStream}
          hasElective1={hasElective1}
          setHasElective1={setHasElective1}
          hasElective2={hasElective2}
          setHasElective2={setHasElective2}
          elective1ByCombo={elective1ByCombo}
          setElective1ByCombo={setElective1ByCombo}
          elective2ByCombo={elective2ByCombo}
          setElective2ByCombo={setElective2ByCombo}
          streamVariantCount={streamVariantCount}
          basePrice={basePrice}
          pricesByCombo={pricesByCombo}
          setPricesByCombo={setPricesByCombo}
        />
      )}
      {step === 5 && (
        <Step5
          {...{
            name,
            categoryLabel: categories.find((c) => c.id === categoryId)?.label,
            basePrice,
            baseMrp,
            status,
            schoolNames: schools.filter((s) => schoolIds.includes(s.id)).map((s) => s.name),
            grades,
            children,
            languageCombos,
          }}
        />
      )}

      {/* Sticky footer — Next stays visible even after the StreamPanel
          has expanded with N per-stream cards. Without this the button
          was scrolled off-screen and admins thought the form was broken. */}
      <div className="sticky bottom-0 -mx-4 sm:-mx-6 mt-8 px-4 sm:px-6 py-3 bg-white/95 backdrop-blur border-t border-ink-100 flex items-center justify-between gap-3">
        {step > 1 ? (
          <button
            type="button"
            onClick={() => setStep((s) => (s - 1) as Step)}
            className="inline-flex items-center gap-1 rounded-full border border-ink-200 px-4 h-10 text-[13px] font-semibold text-ink-700 hover:border-ink-900"
          >
            <ChevronLeft className="h-3.5 w-3.5" /> Back
          </button>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-3">
          {step < 5 && !stepValid(step) && (
            <span className="text-[11.5px] text-ink-500 leading-snug max-w-xs text-right">
              {nextDisabledReason(step, {
                variantStyle,
                withLangs,
                seconds,
                axesResolved,
                axisVariants,
                hasStreams,
                streams,
                hasLanguages,
                languages,
                hasElective1,
                hasElective2,
                elective1ByCombo,
                elective2ByCombo,
                streamVariantCount,
                childrenLen: children.length,
                skipChildren,
              })}
            </span>
          )}
          {step < 5 ? (
            <button
              type="button"
              disabled={!stepValid(step)}
              onClick={() => setStep((s) => (s + 1) as Step)}
              className="inline-flex items-center gap-1 rounded-full bg-ink-900 text-white px-5 h-10 text-[13px] font-bold disabled:opacity-50"
            >
              Next <ChevronRight className="h-3.5 w-3.5" />
            </button>
          ) : (
            <button
              type="button"
              disabled={pending}
              onClick={submit}
              className="inline-flex items-center gap-2 rounded-full bg-brand text-white px-6 h-11 text-[14px] font-bold hover:bg-brand-600 disabled:opacity-60"
            >
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              {pending ? "Creating…" : "Create Bookkit"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Human-friendly explanation of why Next is greyed-out. Computed inline
 *  next to the Next button so admins know what the wizard is waiting on
 *  instead of staring at a disabled button. */
function nextDisabledReason(
  step: Step,
  ctx: {
    variantStyle: "none" | "language" | "multiAxis" | "guidedStreams";
    withLangs: boolean;
    seconds: string[];
    axesResolved: { values: { id: string; label: string }[] }[];
    axisVariants: VariantRow[];
    // guidedStreams
    hasStreams: boolean;
    streams: string[];
    hasLanguages: boolean;
    languages: string[];
    hasElective1: boolean;
    hasElective2: boolean;
    elective1ByCombo: Record<string, string[]>;
    elective2ByCombo: Record<string, string[]>;
    streamVariantCount: number;
    childrenLen: number;
    skipChildren: boolean;
  },
): string {
  if (step === 1) return "Fill in name + base price to continue.";
  if (step === 3) {
    if (ctx.childrenLen === 0 && !ctx.skipChildren) {
      return "Add at least one child item — or tick \"Skip\" if this kit has none.";
    }
  }
  if (step === 4) {
    if (ctx.variantStyle === "language") {
      if (ctx.withLangs && ctx.seconds.length === 0) return "Pick at least one 2nd Language.";
    }
    if (ctx.variantStyle === "multiAxis") {
      if (ctx.axesResolved.length === 0) return "Add at least one axis with tick'd values.";
      if (ctx.axesResolved.some((a) => a.values.length === 0))
        return "Every axis needs at least one value ticked.";
      if (ctx.axisVariants.length === 0) return "The variants matrix is empty — pick values on every axis.";
      if (ctx.axisVariants.some((v) => v.sku.trim().length === 0))
        return "Fill in the SKU for every row in the variants matrix.";
    }
    if (ctx.variantStyle === "guidedStreams") {
      if (!ctx.hasStreams && !ctx.hasLanguages && !ctx.hasElective1 && !ctx.hasElective2) {
        return "Tick at least one of Streams / Languages / Elective 1 / Elective 2.";
      }
      if (ctx.hasStreams && ctx.streams.length === 0) {
        return "Add at least one Stream (e.g. Science).";
      }
      if (ctx.hasLanguages && ctx.languages.length === 0) {
        return "Add at least one Language (e.g. English).";
      }
      const sIter = ctx.hasStreams ? ctx.streams : [""];
      const lIter = ctx.hasLanguages ? ctx.languages : [""];
      for (const s of sIter) {
        for (const l of lIter) {
          const k = `${s}||${l}`;
          if (ctx.hasElective1 && (ctx.elective1ByCombo[k]?.length ?? 0) === 0) {
            const where = (ctx.hasStreams && ctx.hasLanguages)
              ? `${s} · ${l}`
              : (ctx.hasStreams ? s : l);
            return `Add at least one Elective 1 subject for ${where}.`;
          }
          if (ctx.hasElective2 && (ctx.elective2ByCombo[k]?.length ?? 0) === 0) {
            const where = (ctx.hasStreams && ctx.hasLanguages)
              ? `${s} · ${l}`
              : (ctx.hasStreams ? s : l);
            return `Add at least one Elective 2 subject for ${where}.`;
          }
        }
      }
      if (ctx.streamVariantCount === 0) return "Add at least one subject so a variant can be generated.";
    }
  }
  return "";
}

// ───────────────────── step components ─────────────────────

function StepStrip({ current }: { current: Step }) {
  const steps: { n: Step; label: string }[] = [
    { n: 1, label: "Identify" },
    { n: 2, label: "Schools + grades" },
    { n: 3, label: "Bundle children" },
    { n: 4, label: "Languages" },
    { n: 5, label: "Review" },
  ];
  return (
    <ol className="mt-6 flex items-center gap-2 flex-wrap">
      {steps.map((s, i) => (
        <li key={s.n} className="flex items-center gap-2">
          <span
            className={
              "grid h-7 w-7 place-items-center rounded-full text-[12px] font-bold border " +
              (current === s.n
                ? "bg-ink-900 text-white border-ink-900"
                : current > s.n
                  ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                  : "bg-white text-ink-500 border-ink-200")
            }
          >
            {current > s.n ? <Check className="h-3.5 w-3.5" /> : s.n}
          </span>
          <span
            className={
              "text-[12.5px] " +
              (current === s.n ? "font-bold text-ink-900" : "text-ink-500")
            }
          >
            {s.label}
          </span>
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
  basePrice: number | "";
  setBasePrice: (v: number | "") => void;
  baseMrp: number | "";
  setBaseMrp: (v: number | "") => void;
  status: "active" | "draft" | "archived";
  setStatus: (v: "active" | "draft" | "archived") => void;
  categories: { id: string; label: string; name: string }[];
}) {
  return (
    <section className="mt-6 rounded-2xl border border-ink-100 bg-white p-6 space-y-4">
      <h2 className="font-display text-[16px] font-bold text-ink-900">Step 1 · Identify</h2>
      <Field label="Name" required>
        <input
          value={p.name}
          onChange={(e) => p.setName(e.target.value)}
          placeholder="CAS CBSE Grade 2 Bookkit"
          className={fieldCls}
        />
      </Field>
      <Field
        label="Category"
        hint="Drives shop nav grouping only. Pick the closest match — Books Bundle, Books, Books Template, etc."
      >
        <select value={p.categoryId} onChange={(e) => p.setCategoryId(e.target.value)} className={fieldCls}>
          <option value="">— none —</option>
          {p.categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </Field>
      <div className="grid sm:grid-cols-2 gap-4">
        <Field
          label="Base price (₹)"
          hint="Leave empty for language-only kits — per-combo prices in Step 4 override this."
        >
          <input
            type="number"
            value={p.basePrice}
            onChange={(e) => p.setBasePrice(e.target.value === "" ? "" : Number(e.target.value))}
            placeholder="—"
            className={fieldCls}
          />
        </Field>
        <Field label="MRP (₹)" hint="Optional">
          <input
            type="number"
            value={p.baseMrp}
            onChange={(e) => p.setBaseMrp(e.target.value === "" ? "" : Number(e.target.value))}
            className={fieldCls}
          />
        </Field>
      </div>
      <Field label="Status">
        <select
          value={p.status}
          onChange={(e) => p.setStatus(e.target.value as typeof p.status)}
          className={fieldCls}
        >
          <option value="active">Active</option>
          <option value="draft">Draft</option>
          <option value="archived">Archived</option>
        </select>
      </Field>
      <p className="text-[11px] text-ink-500 leading-snug">
        Behind the scenes: products.kind = &apos;kit&apos;  ·  products.is_magic_box = false
      </p>
    </section>
  );
}

function Step2(p: {
  schoolIds: string[];
  setSchoolIds: (v: string[]) => void;
  grades: string[];
  setGrades: (v: string[]) => void;
  schools: { id: string; name: string }[];
  gradeOptions: string[];
}) {
  const [schoolQuery, setSchoolQuery] = useState("");
  const filteredSchools = useMemo(() => {
    const q = schoolQuery.trim().toLowerCase();
    if (!q) return p.schools;
    return p.schools.filter((s) => s.name.toLowerCase().includes(q));
  }, [p.schools, schoolQuery]);
  return (
    <section className="mt-6 rounded-2xl border border-ink-100 bg-white p-6 space-y-5">
      <div>
        <h2 className="font-display text-[16px] font-bold text-ink-900">
          Step 2 · Where does it ship?
        </h2>
        <p className="mt-1 text-[12px] text-ink-500">
          Pick the school(s) and grade(s) where parents will see this kit.
        </p>
      </div>
      <div className="grid lg:grid-cols-2 gap-6">
        <div>
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-[12px] font-semibold text-ink-700">Schools</p>
            <p className="text-[11px] text-ink-500">
              {p.schoolIds.length} of {p.schools.length} selected
            </p>
          </div>
          <input
            type="search"
            value={schoolQuery}
            onChange={(e) => setSchoolQuery(e.target.value)}
            placeholder="Search schools…"
            className="mt-2 w-full rounded-lg border border-ink-200 bg-white px-3 py-1.5 text-[13px] outline-none focus:border-ink-900"
          />
          <div className="mt-2 max-h-64 overflow-y-auto flex flex-wrap gap-1.5 rounded-lg border border-ink-100 bg-cream-50/40 p-2">
            {filteredSchools.length === 0 ? (
              <p className="text-[12px] text-ink-400 italic px-1">No schools match.</p>
            ) : (
              filteredSchools.map((s) => (
                <ChipToggle
                  key={s.id}
                  label={s.name}
                  on={p.schoolIds.includes(s.id)}
                  onToggle={() =>
                    p.setSchoolIds(
                      p.schoolIds.includes(s.id)
                        ? p.schoolIds.filter((x) => x !== s.id)
                        : [...p.schoolIds, s.id],
                    )
                  }
                />
              ))
            )}
          </div>
        </div>
        <div>
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-[12px] font-semibold text-ink-700">Grades</p>
            <p className="text-[11px] text-ink-500">
              {p.grades.length} of {p.gradeOptions.length} selected
            </p>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5 rounded-lg border border-ink-100 bg-cream-50/40 p-2">
            {p.gradeOptions.map((g) => (
              <ChipToggle
                key={g}
                label={g}
                on={p.grades.includes(g)}
                onToggle={() =>
                  p.setGrades(
                    p.grades.includes(g)
                      ? p.grades.filter((x) => x !== g)
                      : [...p.grades, g],
                  )
                }
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function Step3({
  children,
  setChildren,
  skipChildren,
  setSkipChildren,
}: {
  children: Child[];
  setChildren: (v: Child[]) => void;
  skipChildren: boolean;
  setSkipChildren: (v: boolean) => void;
}) {
  return (
    <section className="mt-6 rounded-2xl border border-ink-100 bg-white p-6 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-[16px] font-bold text-ink-900">
            Step 3 · What&apos;s inside?
          </h2>
          <p className="mt-1 text-[12.5px] text-ink-500 leading-snug max-w-xl">
            Add components. Each component is either an existing product
            (search below), a brand-new leaf item (e.g. a Textbook), or a
            brand-new sub-bundle (e.g. a Notebook that itself contains crayons,
            fevicol… — recursive).
          </p>
        </div>
        <label className="flex items-center gap-2 text-[12px] text-ink-700 shrink-0">
          <input
            type="checkbox"
            checked={skipChildren}
            onChange={(e) => setSkipChildren(e.target.checked)}
          />
          <span>Skip — define BOM per language combo (Step 5) instead</span>
        </label>
      </div>
      {skipChildren ? (
        <div className="rounded-xl border border-dashed border-ink-200 bg-cream-50/60 px-4 py-5 text-[12.5px] text-ink-500 leading-snug">
          <b>No shared BOM children.</b> Every SKU lives in the variants axis
          (Step 4). Rare for a bookkit — most kits at least ship a workbook or
          textbook that&apos;s shared across all language combos. If that&apos;s
          truly the case, leave the checkbox on and continue.
        </div>
      ) : (
        <ChildList children={children} setChildren={setChildren} depth={0} />
      )}
    </section>
  );
}

function ChildList({
  children,
  setChildren,
  depth,
}: {
  children: Child[];
  setChildren: (v: Child[]) => void;
  depth: number;
}) {
  const [adderMode, setAdderMode] = useState<"none" | "existing" | "leaf" | "sub">("none");
  const updateAt = (i: number, c: Child) => setChildren(children.map((x, j) => (i === j ? c : x)));
  const removeAt = (i: number) => setChildren(children.filter((_, j) => j !== i));

  return (
    <div className="space-y-2">
      {children.length === 0 && (
        <p className="text-[12px] text-ink-400 italic">No components yet.</p>
      )}
      {children.map((c, i) => (
        <ChildRow
          key={i}
          child={c}
          onChange={(c2) => updateAt(i, c2)}
          onRemove={() => removeAt(i)}
          depth={depth}
        />
      ))}
      {adderMode === "none" && (
        <div className="flex flex-wrap gap-2 pt-1">
          <button type="button" onClick={() => setAdderMode("existing")} className={addBtn}>
            <Search className="h-3.5 w-3.5" /> Add existing product
          </button>
          <button type="button" onClick={() => setAdderMode("leaf")} className={addBtn}>
            <Plus className="h-3.5 w-3.5" /> New leaf item
          </button>
          {depth < 4 && (
            <button type="button" onClick={() => setAdderMode("sub")} className={addBtn}>
              <Plus className="h-3.5 w-3.5" /> New sub-bundle
            </button>
          )}
        </div>
      )}
      {adderMode === "existing" && (
        <ExistingPicker
          onCancel={() => setAdderMode("none")}
          onPick={(p) => {
            setChildren([
              ...children,
              { kind: "existing", productId: p.id, productName: p.name, qty: 1 },
            ]);
            setAdderMode("none");
          }}
        />
      )}
      {adderMode === "leaf" && (
        <LeafAdder
          onCancel={() => setAdderMode("none")}
          onAdd={(c) => {
            setChildren([...children, c]);
            setAdderMode("none");
          }}
        />
      )}
      {adderMode === "sub" && (
        <SubBundleAdder
          onCancel={() => setAdderMode("none")}
          onAdd={(c) => {
            setChildren([...children, c]);
            setAdderMode("none");
          }}
        />
      )}
    </div>
  );
}

function ChildRow({
  child,
  onChange,
  onRemove,
  depth,
}: {
  child: Child;
  onChange: (c: Child) => void;
  onRemove: () => void;
  depth: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const isBundle = child.kind === "new_sub_bundle";
  return (
    <div className="rounded-xl border border-ink-200 bg-white">
      <div className="flex items-center gap-3 px-3 py-2">
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-semibold text-ink-900 truncate">
            {child.kind === "existing"
              ? child.productName
              : child.name}
            <span className="ml-2 text-[10.5px] font-medium uppercase tracking-wider text-ink-400">
              {child.kind === "existing"
                ? "existing"
                : child.kind === "new_leaf"
                  ? `new ${child.productKind}`
                  : "new sub-bundle"}
            </span>
          </p>
          {child.kind !== "existing" && (
            <p className="text-[11px] text-ink-500">₹{child.basePrice}</p>
          )}
        </div>
        <label className="flex items-center gap-1 text-[11px] text-ink-600">
          Qty
          <input
            type="number"
            min={1}
            max={99}
            value={child.qty}
            onChange={(e) =>
              onChange({ ...child, qty: Math.max(1, Math.min(99, Number(e.target.value) || 1)) })
            }
            className="w-14 h-7 px-2 rounded border border-ink-200 text-[12px]"
          />
        </label>
        {isBundle && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="text-[12px] font-semibold text-brand-700 hover:text-brand-800"
          >
            {expanded ? "Hide contents" : "Edit contents"}
          </button>
        )}
        <button
          type="button"
          onClick={onRemove}
          className="text-ink-400 hover:text-red-500"
          aria-label="Remove"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
      {isBundle && expanded && (
        <div className="border-t border-ink-100 bg-cream-50/40 p-3">
          <ChildList
            children={(child as SubBundleChild).children}
            setChildren={(c) => onChange({ ...(child as SubBundleChild), children: c })}
            depth={depth + 1}
          />
        </div>
      )}
    </div>
  );
}

function LeafAdder({ onCancel, onAdd }: { onCancel: () => void; onAdd: (c: LeafChild) => void }) {
  const [name, setName] = useState("");
  const [basePrice, setBasePrice] = useState<number>(0);
  const [productKind, setProductKind] = useState<"book" | "consumable" | "accessory">("book");
  return (
    <div className="rounded-xl border border-brand-200 bg-brand-50/40 p-3 space-y-2">
      <p className="text-[12px] font-semibold text-ink-900">New leaf item</p>
      <input
        autoFocus
        placeholder="Name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className={fieldClsSm}
      />
      <div className="grid grid-cols-2 gap-2">
        <input
          type="number"
          placeholder="Base price (₹)"
          value={basePrice}
          onChange={(e) => setBasePrice(Number(e.target.value))}
          className={fieldClsSm}
        />
        <select
          value={productKind}
          onChange={(e) => setProductKind(e.target.value as "book" | "consumable" | "accessory")}
          className={fieldClsSm}
        >
          <option value="book">book</option>
          <option value="consumable">consumable</option>
          <option value="accessory">accessory</option>
        </select>
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onCancel} className={cancelBtn}>Cancel</button>
        <button
          type="button"
          disabled={!name.trim()}
          onClick={() => onAdd({ kind: "new_leaf", name: name.trim(), basePrice, productKind, qty: 1 })}
          className={primaryBtn}
        >
          Add
        </button>
      </div>
    </div>
  );
}

function SubBundleAdder({ onCancel, onAdd }: { onCancel: () => void; onAdd: (c: SubBundleChild) => void }) {
  const [name, setName] = useState("");
  const [basePrice, setBasePrice] = useState<number>(0);
  return (
    <div className="rounded-xl border border-brand-200 bg-brand-50/40 p-3 space-y-2">
      <p className="text-[12px] font-semibold text-ink-900">New sub-bundle</p>
      <input
        autoFocus
        placeholder="Name (e.g. CAS CBSE Grade 2 Notebook)"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className={fieldClsSm}
      />
      <input
        type="number"
        placeholder="Base price (₹) — usually 0 for an inner sub-bundle"
        value={basePrice}
        onChange={(e) => setBasePrice(Number(e.target.value))}
        className={fieldClsSm}
      />
      <p className="text-[11px] text-ink-500 leading-snug">
        Add its inner items by expanding the row after creation.
      </p>
      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onCancel} className={cancelBtn}>Cancel</button>
        <button
          type="button"
          disabled={!name.trim()}
          onClick={() => onAdd({ kind: "new_sub_bundle", name: name.trim(), basePrice, children: [], qty: 1 })}
          className={primaryBtn}
        >
          Add
        </button>
      </div>
    </div>
  );
}

function ExistingPicker({
  onCancel,
  onPick,
}: {
  onCancel: () => void;
  onPick: (p: { id: string; name: string }) => void;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<{ id: string; name: string }[]>([]);
  const [searching, setSearching] = useState(false);
  const fire = async () => {
    if (q.trim().length < 2) return;
    setSearching(true);
    try {
      const r = await fetch(`/api/admin/products?q=${encodeURIComponent(q.trim())}&limit=15`, {
        cache: "no-store",
      });
      const d = (await r.json()) as { products: { id: string; name: string }[] };
      setResults(d.products ?? []);
    } finally {
      setSearching(false);
    }
  };
  return (
    <div className="rounded-xl border border-brand-200 bg-brand-50/40 p-3 space-y-2">
      <p className="text-[12px] font-semibold text-ink-900">Add existing product</p>
      <div className="flex gap-2">
        <input
          autoFocus
          placeholder="Search by name / SKU…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              fire();
            }
          }}
          className={fieldClsSm + " flex-1"}
        />
        <button type="button" onClick={fire} disabled={searching || q.trim().length < 2} className={primaryBtn}>
          Search
        </button>
      </div>
      {results.length > 0 && (
        <ul className="max-h-48 overflow-y-auto space-y-1">
          {results.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => onPick(r)}
                className="w-full text-left px-2 py-1.5 rounded hover:bg-white border border-transparent hover:border-ink-200 text-[12px]"
              >
                {r.name}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onCancel} className={cancelBtn}>Close</button>
      </div>
    </div>
  );
}

function Step4(p: {
  variantStyle: "none" | "language" | "multiAxis" | "guidedStreams";
  setVariantStyle: (v: "none" | "language" | "multiAxis" | "guidedStreams") => void;
  withLangs: boolean;
  setWithLangs: (v: boolean) => void;
  seconds: string[];
  setSeconds: (v: string[]) => void;
  thirds: string[];
  setThirds: (v: string[]) => void;
  parentName: string;
  combos: LanguageCombo[];
  bomByCombo: Record<string, Child[]>;
  setBomByCombo: (
    next:
      | Record<string, Child[]>
      | ((prev: Record<string, Child[]>) => Record<string, Child[]>),
  ) => void;
  pricesByLangCombo: Record<string, string>;
  setPricesByLangCombo: (
    next:
      | Record<string, string>
      | ((prev: Record<string, string>) => Record<string, string>),
  ) => void;
  attributes: AttributeOption[];
  setAttributes: (next: AttributeOption[]) => void;
  axes: SelectedAxis[];
  setAxes: (v: SelectedAxis[]) => void;
  axesResolved: { attributeId: string; attributeName: string; values: { id: string; label: string }[] }[];
  axisVariants: VariantRow[];
  setAxisVariants: (v: VariantRow[]) => void;
  // guided streams sub-state
  hasStreams: boolean;
  setHasStreams: (v: boolean) => void;
  streams: string[];
  setStreams: (v: string[]) => void;
  hasLanguages: boolean;
  setHasLanguages: (v: boolean) => void;
  languages: string[];
  setLanguages: (v: string[]) => void;
  mandatesPerStream: Record<string, Child[]>;
  setMandatesPerStream: (
    next:
      | Record<string, Child[]>
      | ((prev: Record<string, Child[]>) => Record<string, Child[]>),
  ) => void;
  hasElective1: boolean;
  setHasElective1: (v: boolean) => void;
  hasElective2: boolean;
  setHasElective2: (v: boolean) => void;
  elective1ByCombo: Record<string, string[]>;
  setElective1ByCombo: (
    next:
      | Record<string, string[]>
      | ((prev: Record<string, string[]>) => Record<string, string[]>),
  ) => void;
  elective2ByCombo: Record<string, string[]>;
  setElective2ByCombo: (
    next:
      | Record<string, string[]>
      | ((prev: Record<string, string[]>) => Record<string, string[]>),
  ) => void;
  streamVariantCount: number;
  basePrice: number | "";
  pricesByCombo: Record<string, string>;
  setPricesByCombo: (
    next:
      | Record<string, string>
      | ((prev: Record<string, string>) => Record<string, string>),
  ) => void;
}) {
  const toggle = (arr: string[], v: string, set: (v: string[]) => void) =>
    set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  return (
    <section className="mt-6 rounded-2xl border border-ink-100 bg-white p-6 space-y-4">
      <h2 className="font-display text-[16px] font-bold text-ink-900">
        Step 4 · Variant style
      </h2>
      <p className="text-[12.5px] text-ink-500 leading-snug max-w-2xl">
        Bookkits come in four flavours. Pick one — they&apos;re mutually
        exclusive because each writes a different set of product_variants
        rows.
      </p>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
        <StyleTile
          on={p.variantStyle === "none"}
          onClick={() => p.setVariantStyle("none")}
          title="None — single SKU"
          blurb="One fixed kit shape. No per-parent picker on the PDP."
        />
        <StyleTile
          on={p.variantStyle === "language"}
          onClick={() => p.setVariantStyle("language")}
          title="Language only"
          blurb="2nd / 3rd Language picker. Each combo gets its own sibling-kit product with its own BOM and price."
        />
        <StyleTile
          on={p.variantStyle === "guidedStreams"}
          onClick={() => p.setVariantStyle("guidedStreams")}
          title="Streams + Electives (guided)"
          blurb="Type the Streams (Science / Commerce / Humanities), Languages, and per-combo Elective subjects directly. Class 11–12 Bookkit pattern."
        />
      </div>

      {p.variantStyle === "language" && (
        <div className="space-y-4 pt-2">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={p.withLangs}
              onChange={(e) => p.setWithLangs(e.target.checked)}
            />
            <span className="text-[13px]">Yes — this kit ships in multiple language combos</span>
          </label>
          {p.withLangs && (
            <>
              <div>
                <p className="text-[12px] font-semibold text-ink-700">2nd Language</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {COMMON_LANGS.map((l) => (
                    <ChipToggle
                      key={l}
                      label={l}
                      on={p.seconds.includes(l)}
                      onToggle={() => toggle(p.seconds, l, p.setSeconds)}
                    />
                  ))}
                </div>
              </div>
              <div>
                <p className="text-[12px] font-semibold text-ink-700">
                  3rd Language <span className="text-ink-400 font-normal">(optional — leave empty for trailing-pattern variants)</span>
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {COMMON_LANGS.map((l) => (
                    <ChipToggle
                      key={l}
                      label={l}
                      on={p.thirds.includes(l)}
                      onToggle={() => toggle(p.thirds, l, p.setThirds)}
                    />
                  ))}
                </div>
                <p className="mt-1 text-[11px] text-ink-500">
                  Pick any 2nd × 3rd combination — same-language pairs (e.g. 2nd=Hindi + 3rd=Hindi) are skipped automatically.
                </p>
              </div>
              {p.combos.length > 0 && (
                <div className="rounded-lg border border-ink-100 bg-cream-50/60 p-3">
                  <p className="text-[11px] font-semibold text-ink-700 mb-1">
                    Preview — {p.combos.length} sibling kit
                    {p.combos.length === 1 ? "" : "s"} will be created:
                  </p>
                  <ul className="text-[11.5px] font-mono text-ink-600 max-h-40 overflow-y-auto space-y-0.5">
                    {p.combos.map((c, i) => (
                      <li key={i}>
                        {p.parentName || "<name>"}
                        {/bookkit/i.test(p.parentName) ? "" : " Bookkit"}
                        {c.secondLang}
                        {c.thirdLang ? ` 2nd Lan ${c.thirdLang.slice(0, 3)} 3rd Lan` : ""}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-[10.5px] text-ink-500 leading-snug">
                    Each combo becomes its own sibling product
                    (variant_of_product_id = template) so the PDP&apos;s language
                    picker reads them directly — no name-matching needed.
                  </p>
                </div>
              )}
              {p.combos.length > 0 && (
                <LangComboBomEditor
                  combos={p.combos}
                  bomByCombo={p.bomByCombo}
                  setBomByCombo={p.setBomByCombo}
                />
              )}
              {p.combos.length > 0 && (
                <LangComboPricesPanel
                  combos={p.combos}
                  basePrice={0}
                  pricesByCombo={p.pricesByLangCombo}
                  setPricesByCombo={p.setPricesByLangCombo}
                />
              )}
            </>
          )}
        </div>
      )}

      {p.variantStyle === "multiAxis" && (
        <div className="space-y-5 pt-2">
          <div>
            <p className="text-[12.5px] font-semibold text-ink-700">Axes</p>
            <p className="text-[11.5px] text-ink-500 leading-snug">
              Pick the attributes the parent will choose from on the PDP.
              Examples: <code>Mandate</code> · <code>Core Subject</code> ·
              <code>Elective 1</code> · <code>Elective 2</code>. Order matters
              — the first picker shows first.
            </p>
            <div className="mt-2">
              <AxesPicker
                axes={p.axes}
                setAxes={p.setAxes}
                attributes={p.attributes}
                setAttributes={p.setAttributes}
                allowedTypes={["other", "design", "model"]}
              />
            </div>
          </div>
          {p.axesResolved.length > 0 && p.axesResolved.every((a) => a.values.length > 0) && (
            <div>
              <p className="text-[12.5px] font-semibold text-ink-700">Variants matrix</p>
              <div className="mt-2">
                <VariantsMatrix
                  axesResolved={p.axesResolved}
                  variants={p.axisVariants}
                  setVariants={p.setAxisVariants}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {p.variantStyle === "guidedStreams" && (
        <GuidedStreamsPanel
          hasStreams={p.hasStreams}
          setHasStreams={p.setHasStreams}
          streams={p.streams}
          setStreams={p.setStreams}
          hasLanguages={p.hasLanguages}
          setHasLanguages={p.setHasLanguages}
          languages={p.languages}
          setLanguages={p.setLanguages}
          mandatesPerStream={p.mandatesPerStream}
          setMandatesPerStream={p.setMandatesPerStream}
          hasElective1={p.hasElective1}
          setHasElective1={p.setHasElective1}
          hasElective2={p.hasElective2}
          setHasElective2={p.setHasElective2}
          elective1ByCombo={p.elective1ByCombo}
          setElective1ByCombo={p.setElective1ByCombo}
          elective2ByCombo={p.elective2ByCombo}
          setElective2ByCombo={p.setElective2ByCombo}
          streamVariantCount={p.streamVariantCount}
          basePrice={p.basePrice}
          pricesByCombo={p.pricesByCombo}
          setPricesByCombo={p.setPricesByCombo}
        />
      )}
    </section>
  );
}

function StyleTile({
  on,
  onClick,
  title,
  blurb,
  disabled,
  disabledReason,
}: {
  on: boolean;
  onClick: () => void;
  title: string;
  blurb: string;
  disabled?: boolean;
  disabledReason?: string;
}) {
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className={
        "text-left rounded-xl border p-3 transition-colors " +
        (disabled
          ? "border-ink-100 opacity-60 cursor-not-allowed"
          : on
            ? "border-ink-900 bg-ink-900/[0.03] ring-2 ring-ink-900"
            : "border-ink-200 bg-white hover:border-ink-400")
      }
      title={disabledReason}
    >
      <p className="text-[13px] font-bold text-ink-900">{title}</p>
      <p className="mt-0.5 text-[11.5px] text-ink-500 leading-snug">{blurb}</p>
    </button>
  );
}

/**
 * Stream-driven multi-axis sub-step for Bookkit Step 4. Reuses the
 * AxesPicker primitive for the Stream axis (limited to 1) and the
 * sibling child axes. Per-Stream cards render `ChildList` (auto-included
 * BOM children) plus value-subset chips for each child axis.
 */
/**
 * Single-line chip adder. Press Enter (or the Add button) to push the
 * current input into `values`. Slash/comma/pipe-separated input is split
 * via the existing `splitComboValue` helper from _axes-matrix so admins
 * can paste `Biology / Computer Science` and get two chips in one go.
 * Each chip carries an × button for removal. `max` caps the list.
 */
function ChipAdder({
  values,
  setValues,
  max,
  placeholder,
  emptyHint,
}: {
  values: string[];
  setValues: (v: string[]) => void;
  max?: number;
  placeholder: string;
  emptyHint?: string;
}) {
  const [text, setText] = useState("");
  const add = () => {
    const parts = splitComboValue(text);
    if (parts.length === 0) return;
    const seenLower = new Set(values.map((v) => v.toLowerCase()));
    const merged = [...values];
    for (const p of parts) {
      if (max != null && merged.length >= max) break;
      if (seenLower.has(p.toLowerCase())) continue;
      merged.push(p);
      seenLower.add(p.toLowerCase());
    }
    if (merged.length !== values.length) setValues(merged);
    setText("");
  };
  const atCap = max != null && values.length >= max;
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-1.5">
        {values.length === 0 && emptyHint && (
          <span className="text-[11.5px] text-ink-400 italic">{emptyHint}</span>
        )}
        {values.map((v) => (
          <span
            key={v}
            className="inline-flex items-center gap-1 rounded-full bg-ink-900 text-white px-2.5 py-0.5 text-[12px] font-medium"
          >
            {v}
            <button
              type="button"
              onClick={() => setValues(values.filter((x) => x !== v))}
              className="text-white/70 hover:text-white"
              aria-label={`Remove ${v}`}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder={atCap ? `Max ${max} reached` : placeholder}
          disabled={atCap}
          className="flex-1 max-w-xs rounded-lg border border-ink-200 bg-white px-2.5 py-1 text-[13px] outline-none focus:border-ink-900 disabled:opacity-50"
        />
        <button
          type="button"
          onClick={add}
          disabled={atCap || text.trim().length === 0}
          className="inline-flex items-center gap-1 rounded-lg bg-ink-900 text-white px-3 h-8 text-[12px] font-bold disabled:opacity-50"
        >
          <Plus className="h-3 w-3" /> Add
        </button>
      </div>
    </div>
  );
}

function GuidedStreamsPanel(p: {
  hasStreams: boolean;
  setHasStreams: (v: boolean) => void;
  streams: string[];
  setStreams: (v: string[]) => void;
  hasLanguages: boolean;
  setHasLanguages: (v: boolean) => void;
  languages: string[];
  setLanguages: (v: string[]) => void;
  mandatesPerStream: Record<string, Child[]>;
  setMandatesPerStream: (
    next:
      | Record<string, Child[]>
      | ((prev: Record<string, Child[]>) => Record<string, Child[]>),
  ) => void;
  hasElective1: boolean;
  setHasElective1: (v: boolean) => void;
  hasElective2: boolean;
  setHasElective2: (v: boolean) => void;
  elective1ByCombo: Record<string, string[]>;
  setElective1ByCombo: (
    next:
      | Record<string, string[]>
      | ((prev: Record<string, string[]>) => Record<string, string[]>),
  ) => void;
  elective2ByCombo: Record<string, string[]>;
  setElective2ByCombo: (
    next:
      | Record<string, string[]>
      | ((prev: Record<string, string[]>) => Record<string, string[]>),
  ) => void;
  streamVariantCount: number;
  basePrice: number | "";
  pricesByCombo: Record<string, string>;
  setPricesByCombo: (
    next:
      | Record<string, string>
      | ((prev: Record<string, string>) => Record<string, string>),
  ) => void;
}) {
  // Combo rows shown under each Elective section. When an axis is
  // disabled, its dimension collapses to a single "" entry so combo
  // labels still render gracefully.
  const sIter = p.hasStreams ? p.streams : [""];
  const lIter = p.hasLanguages ? p.languages : [""];
  const comboRows: { s: string; l: string; key: string; label: string }[] = [];
  for (const s of sIter) {
    for (const l of lIter) {
      const key = `${s}||${l}`;
      const labelParts: string[] = [];
      if (p.hasStreams) labelParts.push(`Stream: ${s}`);
      if (p.hasLanguages) labelParts.push(`Language: ${l}`);
      const label = labelParts.length > 0 ? labelParts.join(" · ") : "All combos";
      comboRows.push({ s, l, key, label });
    }
  }

  return (
    <div className="space-y-5 pt-2">
      {/* Short, calm "how this works" block — verbose example callout
          replaced because the labels themselves are now the guide. */}
      <div className="rounded-xl border border-brand-200 bg-brand-50/40 p-3 text-[12.5px] text-ink-800 leading-snug">
        <p className="font-semibold mb-1">How this works</p>
        Tick the axes that apply (Streams / Languages / Elective 1 / 2),
        type the values directly, and for each Elective subject add it to
        the (Stream × Language) row it belongs to. Per-stream Mandate items
        are auto-included books that ship without parent selection.
      </div>

      {/* 1 · Streams */}
      <div className="rounded-xl border border-ink-200 bg-white p-4 space-y-2">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={p.hasStreams}
            onChange={(e) => p.setHasStreams(e.target.checked)}
          />
          <span className="text-[13px] font-bold text-ink-900">
            1 · Streams
          </span>
          <span className="text-[11.5px] text-ink-500">
            (optional, max 7) — e.g. Science / Commerce / Humanities
          </span>
        </label>
        {p.hasStreams && (
          <ChipAdder
            values={p.streams}
            setValues={p.setStreams}
            max={7}
            placeholder="Type a stream name + Enter…"
            emptyHint="No streams yet."
          />
        )}
      </div>

      {/* 2 · Languages */}
      <div className="rounded-xl border border-ink-200 bg-white p-4 space-y-2">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={p.hasLanguages}
            onChange={(e) => p.setHasLanguages(e.target.checked)}
          />
          <span className="text-[13px] font-bold text-ink-900">
            2 · Languages
          </span>
          <span className="text-[11.5px] text-ink-500">
            (optional, max 7) — e.g. English / Hindi / Telugu
          </span>
        </label>
        {p.hasLanguages && (
          <ChipAdder
            values={p.languages}
            setValues={p.setLanguages}
            max={7}
            placeholder="Type a language + Enter…"
            emptyHint="No languages yet."
          />
        )}
      </div>

      {/* 3 · Mandate subjects per stream — always visible so numbering
          1..2..3..4..5 is unbroken. Body changes depending on whether
          Streams has been ticked + populated. */}
      <div className="rounded-xl border border-ink-200 bg-white p-4 space-y-3">
        <p className="text-[13px] font-bold text-ink-900">
          3 · Mandate subjects per stream
          <span className="ml-2 text-[10.5px] font-medium uppercase tracking-wider text-ink-400">
            optional, per stream
          </span>
        </p>
        {!p.hasStreams ? (
          <p className="text-[11.5px] text-ink-500 italic">
            Enable <b>Streams</b> above to define per-stream auto-included books.
          </p>
        ) : p.streams.length === 0 ? (
          <p className="text-[11.5px] text-ink-500 italic">
            Add at least one stream above to define its mandate books.
          </p>
        ) : (
          <>
            <p className="text-[11.5px] text-ink-500 leading-snug">
              For each stream, list the books that auto-ship when a parent
              picks that stream (e.g. Physics + Chemistry for Science). On
              save, the wizard creates a stub sub-bundle product per
              stream (named <code>&lt;Kit name&gt; &lt;Stream&gt;</code>,
              e.g. <code>YIPS Science</code>) with these books as its
              BOM children. The existing storefront
              PDP&apos;s <code>variant-contents</code> endpoint reads that
              sub-bundle automatically and renders it under the picked
              Stream chip — same path that powers SAS Suchitra Book Set.
            </p>
            {p.streams.map((s) => (
              <details
                key={s}
                open
                className="rounded-lg border border-ink-100 bg-cream-50/40 p-3"
              >
                <summary className="cursor-pointer text-[12.5px] font-semibold text-ink-900">
                  Stream = {s}{" "}
                  <span className="text-ink-500 font-normal">
                    ({p.mandatesPerStream[s]?.length ?? 0} item
                    {(p.mandatesPerStream[s]?.length ?? 0) === 1 ? "" : "s"})
                  </span>
                </summary>
                <div className="mt-2">
                  <ChildList
                    children={p.mandatesPerStream[s] ?? []}
                    setChildren={(next) =>
                      p.setMandatesPerStream((prev) => ({ ...prev, [s]: next }))
                    }
                    depth={0}
                  />
                </div>
              </details>
            ))}
          </>
        )}
      </div>

      {/* 4 · Elective 1 */}
      <div className="rounded-xl border border-ink-200 bg-white p-4 space-y-3">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={p.hasElective1}
            onChange={(e) => p.setHasElective1(e.target.checked)}
          />
          <span className="text-[13px] font-bold text-ink-900">
            4 · Elective 1
          </span>
          <span className="text-[11.5px] text-ink-500">
            (optional) — parent picks one per combo
          </span>
        </label>
        {p.hasElective1 && (
          <div className="space-y-2">
            {comboRows.length === 0 && (
              <p className="text-[11.5px] text-ink-400 italic">
                Add at least one Stream or Language first so combos exist.
              </p>
            )}
            {comboRows.map((row) => (
              <div
                key={`e1-${row.key}`}
                className="rounded-lg border border-ink-100 bg-cream-50/40 p-3 space-y-1"
              >
                <p className="text-[12px] font-semibold text-ink-700">
                  {row.label}
                </p>
                <ChipAdder
                  values={p.elective1ByCombo[row.key] ?? []}
                  setValues={(next) =>
                    p.setElective1ByCombo((prev) => ({ ...prev, [row.key]: next }))
                  }
                  placeholder="Add subject + Enter (paste 'Bio / CS' to add both)…"
                  emptyHint="No subjects yet."
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 5 · Elective 2 */}
      <div className="rounded-xl border border-ink-200 bg-white p-4 space-y-3">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={p.hasElective2}
            onChange={(e) => p.setHasElective2(e.target.checked)}
          />
          <span className="text-[13px] font-bold text-ink-900">
            5 · Elective 2
          </span>
          <span className="text-[11.5px] text-ink-500">
            (optional) — parent picks one per combo
          </span>
        </label>
        {p.hasElective2 && (
          <div className="space-y-2">
            {comboRows.length === 0 && (
              <p className="text-[11.5px] text-ink-400 italic">
                Add at least one Stream or Language first so combos exist.
              </p>
            )}
            {comboRows.map((row) => (
              <div
                key={`e2-${row.key}`}
                className="rounded-lg border border-ink-100 bg-cream-50/40 p-3 space-y-1"
              >
                <p className="text-[12px] font-semibold text-ink-700">
                  {row.label}
                </p>
                <ChipAdder
                  values={p.elective2ByCombo[row.key] ?? []}
                  setValues={(next) =>
                    p.setElective2ByCombo((prev) => ({ ...prev, [row.key]: next }))
                  }
                  placeholder="Add subject + Enter (paste 'Math / Psychology' to add both)…"
                  emptyHint="No subjects yet."
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 6 · Per-combo pricing (optional) */}
      <ComboPricesPanel
        hasStreams={p.hasStreams}
        streams={p.streams}
        hasLanguages={p.hasLanguages}
        languages={p.languages}
        hasElective1={p.hasElective1}
        elective1ByCombo={p.elective1ByCombo}
        hasElective2={p.hasElective2}
        elective2ByCombo={p.elective2ByCombo}
        basePrice={p.basePrice}
        pricesByCombo={p.pricesByCombo}
        setPricesByCombo={p.setPricesByCombo}
      />

      {/* 7 · Summary */}
      <div className="rounded-lg border border-ink-100 bg-cream-50/60 px-3 py-2 text-[12px] text-ink-700">
        <b>{p.streamVariantCount}</b> product_variants will be created — one
        per valid combo. Combos without a price override fall back to the
        base price.
      </div>
    </div>
  );
}

function ComboPricesPanel(p: {
  hasStreams: boolean;
  streams: string[];
  hasLanguages: boolean;
  languages: string[];
  hasElective1: boolean;
  elective1ByCombo: Record<string, string[]>;
  hasElective2: boolean;
  elective2ByCombo: Record<string, string[]>;
  basePrice: number | "";
  pricesByCombo: Record<string, string>;
  setPricesByCombo: (
    next:
      | Record<string, string>
      | ((prev: Record<string, string>) => Record<string, string>),
  ) => void;
}) {
  const combos: { key: string; label: string }[] = [];
  const sIter = p.hasStreams ? p.streams : [""];
  const lIter = p.hasLanguages ? p.languages : [""];
  for (const s of sIter) {
    for (const l of lIter) {
      const slKey = `${s}||${l}`;
      const e1List = p.hasElective1
        ? (p.elective1ByCombo[slKey] ?? [])
        : [""];
      const e2List = p.hasElective2
        ? (p.elective2ByCombo[slKey] ?? [])
        : [""];
      if (p.hasElective1 && e1List.length === 0) continue;
      if (p.hasElective2 && e2List.length === 0) continue;
      for (const e1 of e1List) {
        for (const e2 of e2List) {
          const parts: string[] = [];
          if (p.hasStreams) parts.push(s);
          if (p.hasLanguages) parts.push(l);
          if (p.hasElective1) parts.push(e1);
          if (p.hasElective2) parts.push(e2);
          combos.push({
            key: `${s}||${l}||${e1}||${e2}`,
            label: parts.join(" · ") || "(single)",
          });
        }
      }
    }
  }

  const [open, setOpen] = useState(false);
  if (combos.length === 0) return null;

  const overrideCount = combos.filter((c) =>
    (p.pricesByCombo[c.key] ?? "").trim().length > 0,
  ).length;

  return (
    <div className="rounded-xl border border-ink-100 bg-white">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-left"
      >
        <div>
          <p className="text-[13px] font-semibold text-ink-900">
            6 · Per-combo pricing <span className="text-ink-400 font-normal">(optional)</span>
          </p>
          <p className="text-[11.5px] text-ink-500 mt-0.5">
            Override the base price for individual combos. Blank rows use ₹
            {p.basePrice || 0}.
            {overrideCount > 0 && (
              <span className="ml-2 text-ink-700 font-semibold">
                {overrideCount} override{overrideCount === 1 ? "" : "s"} set
              </span>
            )}
          </p>
        </div>
        <span className="text-[12px] text-ink-500">
          {open ? "Hide" : "Show"} {combos.length} combo
          {combos.length === 1 ? "" : "s"}
        </span>
      </button>
      {open && (
        <div className="border-t border-ink-100 max-h-96 overflow-y-auto">
          <table className="w-full text-[13px]">
            <thead className="bg-cream-50/60 text-[11px] uppercase tracking-wider text-ink-500">
              <tr>
                <th className="text-left px-4 py-2 font-semibold">Combo</th>
                <th className="text-right px-4 py-2 font-semibold w-40">Price (₹)</th>
              </tr>
            </thead>
            <tbody>
              {combos.map((c) => (
                <tr key={c.key} className="border-t border-ink-50">
                  <td className="px-4 py-1.5 text-ink-800">{c.label}</td>
                  <td className="px-4 py-1.5 text-right">
                    <input
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="1"
                      value={p.pricesByCombo[c.key] ?? ""}
                      onChange={(e) =>
                        p.setPricesByCombo((prev) => ({
                          ...prev,
                          [c.key]: e.target.value,
                        }))
                      }
                      placeholder={p.basePrice ? String(p.basePrice) : "base"}
                      className="w-32 rounded-md border border-ink-200 px-2 py-1 text-right text-[13px] focus:outline-none focus:border-ink-900"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function comboLabel(c: LanguageCombo) {
  return c.thirdLang ? `${c.secondLang} · ${c.thirdLang}` : c.secondLang;
}

/**
 * Per-language-combo BOM editor. Each tab is one combo (e.g. Hindi · Telugu);
 * the body reuses the same `ChildList` picker as Step 3, so existing-product
 * search + new-leaf + new-sub-bundle adders all work without duplication.
 * The selected combo's BOM is persisted on save as bundle_components on a
 * sibling-kit product whose variant_of_product_id points at the template.
 */
function LangComboBomEditor(p: {
  combos: LanguageCombo[];
  bomByCombo: Record<string, Child[]>;
  setBomByCombo: (
    next:
      | Record<string, Child[]>
      | ((prev: Record<string, Child[]>) => Record<string, Child[]>),
  ) => void;
}) {
  const [active, setActive] = useState(0);
  const safeActive = Math.min(active, p.combos.length - 1);
  const current = p.combos[safeActive];
  const key = `${current.secondLang}||${current.thirdLang}`;
  const childrenForCurrent = p.bomByCombo[key] ?? [];
  return (
    <div className="rounded-xl border border-ink-100 bg-white">
      <div className="px-4 pt-3 pb-2 border-b border-ink-100">
        <p className="text-[13px] font-semibold text-ink-900">
          5 · BOM per language combo
        </p>
        <p className="mt-0.5 text-[11.5px] text-ink-500 leading-snug">
          Add the books / items shipped in each language combo. Each combo
          becomes its own sibling-kit product on save.
        </p>
      </div>
      <div className="flex flex-wrap gap-1.5 px-4 py-2 border-b border-ink-100 bg-cream-50/40">
        {p.combos.map((c, i) => {
          const k = `${c.secondLang}||${c.thirdLang}`;
          const count = (p.bomByCombo[k] ?? []).length;
          const on = i === safeActive;
          return (
            <button
              key={k}
              type="button"
              onClick={() => setActive(i)}
              className={
                "rounded-full border px-3 py-1 text-[12px] font-medium transition-colors " +
                (on
                  ? "border-ink-900 bg-ink-900 text-white"
                  : "border-ink-200 bg-white text-ink-700 hover:border-ink-400")
              }
            >
              {comboLabel(c)}
              {count > 0 && (
                <span className={"ml-1.5 text-[10.5px] " + (on ? "text-white/70" : "text-ink-400")}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div className="p-4">
        <ChildList
          children={childrenForCurrent}
          setChildren={(next) =>
            p.setBomByCombo((prev) => ({ ...prev, [key]: next }))
          }
          depth={0}
        />
      </div>
    </div>
  );
}

/**
 * Per-language-combo price override panel. Mirrors `ComboPricesPanel` but
 * keyed by `${secondLang}||${thirdLang}` so the wizard's language-mode and
 * guided-streams modes don't share a key namespace.
 */
function LangComboPricesPanel(p: {
  combos: LanguageCombo[];
  basePrice: number | "";
  pricesByCombo: Record<string, string>;
  setPricesByCombo: (
    next:
      | Record<string, string>
      | ((prev: Record<string, string>) => Record<string, string>),
  ) => void;
}) {
  const [open, setOpen] = useState(false);
  if (p.combos.length === 0) return null;
  const overrideCount = p.combos.filter((c) =>
    (p.pricesByCombo[`${c.secondLang}||${c.thirdLang}`] ?? "").trim().length > 0,
  ).length;
  return (
    <div className="rounded-xl border border-ink-100 bg-white">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-left"
      >
        <div>
          <p className="text-[13px] font-semibold text-ink-900">
            6 · Per-combo pricing
          </p>
          <p className="text-[11.5px] text-ink-500 mt-0.5">
            One price per language combo. Blank rows fall back to the parent
            base price.
            {overrideCount > 0 && (
              <span className="ml-2 text-ink-700 font-semibold">
                {overrideCount} override{overrideCount === 1 ? "" : "s"} set
              </span>
            )}
          </p>
        </div>
        <span className="text-[12px] text-ink-500">
          {open ? "Hide" : "Show"} {p.combos.length} combo
          {p.combos.length === 1 ? "" : "s"}
        </span>
      </button>
      {open && (
        <div className="border-t border-ink-100 max-h-96 overflow-y-auto">
          <table className="w-full text-[13px]">
            <thead className="bg-cream-50/60 text-[11px] uppercase tracking-wider text-ink-500">
              <tr>
                <th className="text-left px-4 py-2 font-semibold">Combo</th>
                <th className="text-right px-4 py-2 font-semibold w-40">Price (₹)</th>
              </tr>
            </thead>
            <tbody>
              {p.combos.map((c) => {
                const k = `${c.secondLang}||${c.thirdLang}`;
                return (
                  <tr key={k} className="border-t border-ink-50">
                    <td className="px-4 py-1.5 text-ink-800">{comboLabel(c)}</td>
                    <td className="px-4 py-1.5 text-right">
                      <input
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step="1"
                        value={p.pricesByCombo[k] ?? ""}
                        onChange={(e) =>
                          p.setPricesByCombo((prev) => ({
                            ...prev,
                            [k]: e.target.value,
                          }))
                        }
                        placeholder="base"
                        className="w-32 rounded-md border border-ink-200 px-2 py-1 text-right text-[13px] focus:outline-none focus:border-ink-900"
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// Legacy Phase 2c StreamPanel placeholder removed — see Phase 2d plan.
function Step5(p: {
  name: string;
  categoryLabel?: string;
  basePrice: number | "";
  baseMrp: number | "";
  status: string;
  schoolNames: string[];
  grades: string[];
  children: Child[];
  languageCombos: LanguageCombo[];
}) {
  const childRow = (c: Child, depth: number): React.ReactNode => (
    <li
      key={Math.random()}
      className="text-[12.5px]"
      style={{ paddingLeft: depth * 16 }}
    >
      {c.kind === "existing" ? (
        <>
          <span className="text-ink-800">{c.productName}</span>
          <span className="ml-2 text-[10.5px] uppercase tracking-wider text-ink-400">existing</span>
        </>
      ) : c.kind === "new_leaf" ? (
        <>
          <span className="text-ink-800">{c.name}</span>
          <span className="ml-2 text-[10.5px] uppercase tracking-wider text-ink-400">
            new {c.productKind} · ₹{c.basePrice}
          </span>
        </>
      ) : (
        <>
          <span className="text-ink-800">{c.name}</span>
          <span className="ml-2 text-[10.5px] uppercase tracking-wider text-ink-400">
            new sub-bundle · ₹{c.basePrice}
          </span>
          {(c as SubBundleChild).children.length > 0 && (
            <ul className="mt-0.5 space-y-0.5">
              {(c as SubBundleChild).children.map((gc) => childRow(gc, depth + 1))}
            </ul>
          )}
        </>
      )}
      <span className="ml-2 text-[11px] text-ink-500">× {c.qty}</span>
    </li>
  );
  return (
    <section className="mt-6 rounded-2xl border border-ink-100 bg-white p-6 space-y-3 text-[13px]">
      <h2 className="font-display text-[16px] font-bold text-ink-900">Step 5 · Review</h2>
      <div>
        <p className="font-semibold text-ink-900">{p.name}</p>
        <p className="text-[12px] text-ink-500">
          ₹{p.basePrice === "" ? 0 : p.basePrice}
          {p.baseMrp !== "" && p.baseMrp != null ? ` · MRP ₹${p.baseMrp}` : ""}
          {p.categoryLabel ? ` · ${p.categoryLabel}` : ""} · {p.status} · kind=kit
        </p>
      </div>
      <div className="grid sm:grid-cols-2 gap-x-6 gap-y-2 text-[12px]">
        <div>
          <p className="font-semibold text-ink-700">Schools</p>
          <p className="text-ink-600">{p.schoolNames.length > 0 ? p.schoolNames.join(", ") : "—"}</p>
        </div>
        <div>
          <p className="font-semibold text-ink-700">Grades</p>
          <p className="text-ink-600">{p.grades.length > 0 ? p.grades.join(", ") : "—"}</p>
        </div>
      </div>
      <div>
        <p className="text-[12px] font-semibold text-ink-700">
          Children ({p.children.length})
        </p>
        <ul className="mt-1 space-y-1">{p.children.map((c) => childRow(c, 0))}</ul>
      </div>
      {p.languageCombos.length > 0 && (
        <div>
          <p className="text-[12px] font-semibold text-ink-700">
            Language variants ({p.languageCombos.length})
          </p>
          <p className="text-[11.5px] text-ink-500">
            One product_variants row per combo. The Bookkit configurator will
            render these as 2nd / 3rd language pickers automatically.
          </p>
        </div>
      )}
      <p className="text-[11px] text-ink-500 italic">
        Existing rows touched: zero. Hit <b>Create Bookkit</b> below to commit.
      </p>
    </section>
  );
}

// ───────────────────── tiny shared bits ─────────────────────

function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-[12px] font-semibold text-ink-700">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </span>
      <div className="mt-1.5">{children}</div>
      {hint && <p className="mt-1 text-[11px] text-ink-500 leading-snug">{hint}</p>}
    </label>
  );
}

function ChipToggle({
  label,
  on,
  onToggle,
  disabled,
  title,
}: {
  label: string;
  on: boolean;
  onToggle: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onToggle}
      disabled={disabled}
      title={title}
      className={
        "rounded-full border px-3 py-1 text-[12px] font-medium transition-colors " +
        (disabled
          ? "border-ink-100 bg-ink-50 text-ink-400 cursor-not-allowed line-through"
          : on
            ? "border-ink-900 bg-ink-900 text-white"
            : "border-ink-200 bg-white text-ink-700 hover:border-ink-400")
      }
    >
      {label}
    </button>
  );
}

const fieldCls =
  "w-full rounded-xl border border-ink-200 bg-white px-3 py-2.5 text-[14px] outline-none focus:border-ink-900";
const fieldClsSm =
  "w-full rounded-lg border border-ink-200 bg-white px-2.5 py-1.5 text-[13px] outline-none focus:border-ink-900";
const addBtn =
  "inline-flex items-center gap-1 rounded-lg border border-ink-200 bg-white px-3 h-8 text-[12.5px] font-semibold text-ink-700 hover:border-ink-900";
const primaryBtn =
  "inline-flex items-center gap-1 rounded-lg bg-ink-900 text-white px-3 h-8 text-[12.5px] font-bold disabled:opacity-50";
const cancelBtn =
  "inline-flex items-center gap-1 rounded-lg border border-ink-200 bg-white px-3 h-8 text-[12.5px] font-semibold text-ink-700";

/**
 * Strip the client-only `productName` decoration off existing-children so
 * the server-action payload matches the Zod schema exactly.
 */
function childrenForServer(cs: Child[]): unknown[] {
  return cs.map((c) => {
    if (c.kind === "existing") {
      return { kind: "existing", productId: c.productId, qty: c.qty, isOptional: c.isOptional };
    }
    if (c.kind === "new_leaf") {
      return {
        kind: "new_leaf",
        name: c.name,
        basePrice: c.basePrice,
        productKind: c.productKind,
        qty: c.qty,
        isOptional: c.isOptional,
      };
    }
    return {
      kind: "new_sub_bundle",
      name: c.name,
      basePrice: c.basePrice,
      qty: c.qty,
      isOptional: c.isOptional,
      children: childrenForServer((c as SubBundleChild).children),
    };
  });
}
