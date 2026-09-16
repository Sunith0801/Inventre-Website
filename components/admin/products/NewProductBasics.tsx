"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Check } from "lucide-react";
import { Button } from "@/components/admin/ui/primitives-client";
import { Field, Input, Select, FormGrid, FormActions, FormError } from "@/components/admin/ui/form";
import { Badge } from "@/components/admin/ui/primitives";
import { cn } from "@/lib/cn";
import { KIND_META, type CreateKind } from "@/components/admin/products/product-kinds";
import { InventorySearch, type InventoryItem } from "@/components/admin/products/InventorySearch";

type UniformType = "boys" | "girls" | "sports" | "unisex";
const UNIFORM_TYPES: { key: UniformType; label: string; gender: "Boys" | "Girls" | null; pathPrefix: string }[] = [
  { key: "boys", label: "Boys", gender: "Boys", pathPrefix: "uniform.regular" },
  { key: "girls", label: "Girls", gender: "Girls", pathPrefix: "uniform.regular" },
  { key: "unisex", label: "Unisex", gender: null, pathPrefix: "uniform.regular" },
  { key: "sports", label: "Sports", gender: null, pathPrefix: "uniform.sports" },
];

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
const codify = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

/**
 * Step 1 of creating a product: who it's for (school, grade) and what it
 * is. Saves a DRAFT and moves on — price, photos, contents and publishing
 * each have their own step.
 *
 * A Book kit item is different: it is MAPPED from inventory, not typed.
 * Picking a search result adopts that existing product (assigns the
 * school and grade, files it under the sub-category) and opens its
 * Pricing step. No match means the item isn't in inventory yet.
 */
export function NewProductBasics({
  kind,
  schools,
  grades,
  categories,
  sections,
}: {
  kind: CreateKind;
  schools: { id: string; name: string }[];
  grades: string[];
  /** Categories relevant to this kind (uniform tree for uniforms, etc). */
  categories: { id: string; label: string; path: string }[];
  /** Book kit sub-categories (the sections master list). */
  sections: { id: string; name: string }[];
}) {
  const router = useRouter();
  const meta = KIND_META[kind];
  const isBookItem = kind === "book";
  const [schoolIds, setSchoolIds] = useState<Set<string>>(new Set());
  const [gradeSet, setGradeSet] = useState<Set<string>>(new Set());
  const [allGrades, setAllGrades] = useState(false);
  const [uniformType, setUniformType] = useState<UniformType>("boys");
  const [categoryId, setCategoryId] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [picked, setPicked] = useState<InventoryItem | null>(null);
  const [name, setName] = useState("");
  const [brand, setBrand] = useState("");
  const [code, setCode] = useState("");
  const [codeTouched, setCodeTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const effectiveCode = codeTouched ? code : picked?.itemCode ?? codify(name);
  const needsSchool = true;
  const gradesOk = allGrades || gradeSet.size > 0;
  const canSubmit = (isBookItem ? !!picked : name.trim().length > 1) && schoolIds.size > 0 && gradesOk;
  const ut = UNIFORM_TYPES.find((u) => u.key === uniformType)!;
  const categoryChoices = kind === "uniform" ? categories.filter((c) => c.path.startsWith(ut.pathPrefix) || c.path === "uniform" || c.path.startsWith("uniform.accessories") || c.path.startsWith("uniform.essentials") || c.path.startsWith("uniform.winter")) : categories;

  const toggle = (set: Set<string>, setter: (s: Set<string>) => void, v: string) => {
    const n = new Set(set);
    if (n.has(v)) n.delete(v);
    else n.add(v);
    setter(n);
  };

  const gradeList = allGrades ? [] : [...gradeSet];

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    start(async () => {
      if (isBookItem && picked) {
        // Adopt the inventory product: schools, grades, sub-category.
        const pid = picked.productId;
        const calls: Promise<Response>[] = [
          ...[...schoolIds].map((schoolId) =>
            fetch(`/api/admin/products/${pid}/schools/${schoolId}`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ assigned: true, isRequired: false, overridePrice: null, overrideMrp: null, customImageUrl: null }),
            }),
          ),
          fetch(`/api/admin/products/${pid}/grades`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ grades: gradeList }) }),
          fetch(`/api/admin/products/${pid}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ categoryId: sectionId || null, ...(brand.trim() ? { brand: brand.trim() } : {}) }) }),
        ];
        const rs = await Promise.all(calls);
        const bad = rs.find((r) => !r.ok);
        if (bad) {
          const d = await bad.json().catch(() => ({}));
          setError(d.error ?? "Could not map this item.");
          return;
        }
        router.push(`/admin/products/${pid}?step=pricing`);
        return;
      }
      const r = await fetch("/api/admin/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          slug: slugify(name),
          kind,
          schoolIds: [...schoolIds],
          grades: gradeList,
          categoryId: categoryId || null,
          brand: brand.trim() || undefined,
          itemCode: effectiveCode || undefined,
          basePrice: 0,
          status: "draft",
          isMagicBox: kind === "magic_box",
          bundleGender: kind === "uniform" ? ut.gender : null,
        }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setError(d.error ?? "Could not create the product.");
        return;
      }
      const d = await r.json();
      const id = d.product?.id ?? d.id;
      router.push(`/admin/products/${id}?step=${meta.nextStep}`);
    });
  }

  const Chips = ({ items, set, setter }: { items: { id: string; name: string }[]; set: Set<string>; setter: (s: Set<string>) => void }) => (
    <div className="flex flex-wrap gap-1.5">
      {items.map((s) => {
        const on = set.has(s.id);
        return (
          <button key={s.id} type="button" aria-pressed={on} onClick={() => toggle(set, setter, s.id)}
            className={cn("inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12.5px] font-medium transition-colors", on ? "border-ink-900 bg-ink-900 text-white" : "border-ink-100 bg-white text-ink-700 hover:border-ink-300")}>
            {on ? <Check className="h-3 w-3" /> : null}{s.name}
          </button>
        );
      })}
    </div>
  );

  return (
    <form onSubmit={submit} className="space-y-6">
      {error ? <FormError>{error}</FormError> : null}

      <div className="flex items-center gap-3 rounded-xl border border-ink-100/70 bg-cream-50/60 px-4 py-3 text-[13px]">
        <span className="text-ink-500">Creating a</span>
        <Badge tone="brand">{meta.label}</Badge>
        <span className="text-ink-500">— {meta.blurb}</span>
        <Link href="/admin/products/new" className="ml-auto text-[12px] font-semibold text-brand-700 hover:text-brand-800">Change type</Link>
      </div>

      <fieldset>
        <legend className="mb-1 text-[12px] font-semibold text-ink-700">School <span className="text-red-600">*</span></legend>
        <p className="mb-2 text-[12px] text-ink-500">Parents only ever see the products of their own school. Pick every school that sells this.</p>
        <Chips items={schools} set={schoolIds} setter={setSchoolIds} />
      </fieldset>

      <fieldset>
        <legend className="mb-1 text-[12px] font-semibold text-ink-700">Grade <span className="text-red-600">*</span></legend>
        <div className="mb-2 flex items-center gap-2 text-[12px]">
          <button type="button" aria-pressed={!allGrades} onClick={() => setAllGrades(false)} className={cn("rounded-lg px-2.5 py-1.5 font-medium", !allGrades ? "bg-ink-900 text-white" : "text-ink-600 hover:bg-cream-100")}>Specific grades</button>
          <button type="button" aria-pressed={allGrades} onClick={() => setAllGrades(true)} className={cn("rounded-lg px-2.5 py-1.5 font-medium", allGrades ? "bg-ink-900 text-white" : "text-ink-600 hover:bg-cream-100")}>Every grade</button>
        </div>
        {!allGrades ? <Chips items={grades.map((g) => ({ id: g, name: g }))} set={gradeSet} setter={setGradeSet} /> : null}
      </fieldset>

      {kind === "uniform" ? (
        <fieldset>
          <legend className="mb-2 text-[12px] font-semibold text-ink-700">Uniform type <span className="text-red-600">*</span></legend>
          <div role="radiogroup" className="flex flex-wrap gap-1.5">
            {UNIFORM_TYPES.map((u) => {
              const on = uniformType === u.key;
              return (
                <button key={u.key} type="button" role="radio" aria-checked={on} onClick={() => { setUniformType(u.key); setCategoryId(""); }}
                  className={cn("rounded-lg border px-3 py-1.5 text-[12.5px] font-medium transition-colors", on ? "border-ink-900 bg-ink-900 text-white" : "border-ink-100 bg-white text-ink-700 hover:border-ink-300")}>
                  {u.label}
                </button>
              );
            })}
          </div>
        </fieldset>
      ) : null}

      {isBookItem ? (
        <>
          <Field label="Sub-category" htmlFor="np-section" required hint="The section of a book kit this item belongs to.">
            <Select id="np-section" value={sectionId} onChange={(e) => { setSectionId(e.target.value); setPicked(null); }}>
              <option value="">Choose…</option>
              {sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </Field>
          <Field label="SKU or item name" required hint="Found in inventory: name, SKU and stock fill in. Not found: add it to inventory first.">
            <InventorySearch categoryId={sectionId || null} picked={picked} onPick={(it) => { setPicked(it); setName(it.name); }} onClear={() => { setPicked(null); setName(""); }} />
          </Field>
        </>
      ) : null}

      <FormGrid cols={2}>
        {!isBookItem ? (
          <Field label="Product name" htmlFor="np-name" required className="md:col-span-2">
            <Input id="np-name" value={name} autoFocus required onChange={(e) => setName(e.target.value)} placeholder={kind === "uniform" ? "e.g. Half-sleeve shirt" : "e.g. Grade 5 school pack"} />
          </Field>
        ) : null}
        {!isBookItem ? (
          <Field label="Category" htmlFor="np-cat" hint={kind === "uniform" ? "Shirt, trousers, tie… drives the shop's grouping." : "Optional."}>
            <Select id="np-cat" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">No category</option>
              {categoryChoices.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </Select>
          </Field>
        ) : null}
        <Field label="Brand" htmlFor="np-brand">
          <Input id="np-brand" value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="Optional" />
        </Field>
        {!isBookItem ? (
          <Field label="Product code" htmlFor="np-code" hint={codeTouched ? "Manual" : "Auto from the name — edit to override"}>
            <Input id="np-code" className="font-mono" value={effectiveCode} onChange={(e) => { setCodeTouched(true); setCode(e.target.value.toUpperCase()); }} />
          </Field>
        ) : null}
        <Field label="Website status">
          <div className="flex h-9 items-center gap-2 text-[13px] text-ink-600"><Badge tone="subtle" dot size="sm">Draft</Badge> until you publish on the last step.</div>
        </Field>
      </FormGrid>

      <FormActions>
        <Button variant="secondary" type="button" onClick={() => router.push("/admin/products/new")} disabled={pending}>Back</Button>
        <Button type="submit" busy={pending} disabled={!canSubmit} icon={<ArrowRight className="h-3.5 w-3.5" />}>
          Save and continue
        </Button>
      </FormActions>
    </form>
  );
}
