"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Ruler, Palette, Shapes, Boxes, Tag, ArrowRight } from "lucide-react";
import { Button } from "@/components/admin/ui/primitives-client";
import { Field, Input, Select, Textarea, FormGrid, FormActions, FormError } from "@/components/admin/ui/form";
import { cn } from "@/lib/cn";

type AttrType = "size" | "color" | "design" | "model" | "other";

/**
 * The type is the one choice that cannot be changed later (it decides which
 * columns the value editor shows and how variants are coded), so it is a
 * row of cards with a sentence each rather than a <select> the eye skips.
 */
const TYPES: { key: AttrType; label: string; blurb: string; icon: typeof Ruler }[] = [
  { key: "size", label: "Size", blurb: "A run like 22–44 or S–XXL.", icon: Ruler },
  { key: "color", label: "Colour", blurb: "Each value carries a swatch.", icon: Palette },
  { key: "design", label: "Design", blurb: "Print, pattern or house.", icon: Shapes },
  { key: "model", label: "Model", blurb: "Edition, board or curriculum.", icon: Boxes },
  { key: "other", label: "Other", blurb: "Anything that doesn't fit above.", icon: Tag },
];

export function NewAttributeForm({ schools }: { schools: { id: string; name: string }[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [type, setType] = useState<AttrType>("size");
  const [schoolId, setSchoolId] = useState<string>("");
  const [description, setDescription] = useState("");
  const [sortOrder, setSortOrder] = useState("0");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    start(async () => {
      const r = await fetch("/api/admin/attributes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          type,
          schoolId: schoolId || null,
          description: description.trim() || undefined,
          sortOrder: Number(sortOrder) || 0,
        }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setError(d.error ?? "Failed to create attribute");
        return;
      }
      const data = await r.json();
      router.push(`/admin/catalog/attributes/${data.attribute.id}`);
    });
  };

  return (
    <form onSubmit={submit}>
      {error ? <FormError className="mb-4">{error}</FormError> : null}

      <fieldset className="mb-5">
        <legend className="mb-2 text-[12px] font-semibold text-ink-700">
          Type <span className="text-red-600">*</span>
        </legend>
        <div role="radiogroup" className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {TYPES.map((t) => {
            const on = type === t.key;
            return (
              <button
                key={t.key}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setType(t.key)}
                className={cn(
                  "flex flex-col items-start gap-1.5 rounded-xl border p-3 text-left transition-[border,box-shadow,background]",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300",
                  on ? "border-ink-900 bg-ink-900 text-white shadow-sm" : "border-ink-100 bg-white hover:border-ink-300",
                )}
              >
                <t.icon className={cn("h-4 w-4", on ? "text-brand-300" : "text-brand-700")} />
                <span className="text-[13px] font-semibold leading-none">{t.label}</span>
                <span className={cn("text-[11px] leading-snug", on ? "text-white/70" : "text-ink-500")}>{t.blurb}</span>
              </button>
            );
          })}
        </div>
      </fieldset>

      <FormGrid cols={2}>
        <Field label="Name" htmlFor="attr-name" required hint="Shown to staff in the product editor and on variant labels.">
          <Input
            id="attr-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoFocus
            placeholder={type === "size" ? "e.g. Shirt Size" : type === "color" ? "e.g. House Colour" : "e.g. Board"}
          />
        </Field>
        <Field label="Scope" htmlFor="attr-scope" hint="Global attributes are shared by every school's catalogue.">
          <Select id="attr-scope" value={schoolId} onChange={(e) => setSchoolId(e.target.value)}>
            <option value="">Global (all schools)</option>
            {schools.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Description" htmlFor="attr-desc" className="md:col-span-2">
          <Textarea id="attr-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional notes for staff — where it's used, how values are named." />
        </Field>
        <Field label="Sort order" htmlFor="attr-sort" hint="Lower numbers list first among attributes of the same type.">
          <Input id="attr-sort" type="number" className="max-w-[140px]" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
        </Field>
      </FormGrid>

      <FormActions>
        <Button variant="secondary" type="button" onClick={() => router.push("/admin/catalog/attributes")} disabled={pending}>
          Cancel
        </Button>
        <Button busy={pending} icon={<ArrowRight className="h-3.5 w-3.5" />} type="submit" disabled={!name.trim()}>
          Create and add values
        </Button>
      </FormActions>
    </form>
  );
}
