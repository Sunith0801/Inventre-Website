"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/admin/ui/primitives-client";
import { Field, Input, Textarea, FormError } from "@/components/admin/ui/form";

type Initial = { name: string; description: string; sortOrder: number };

/** Name / description / sort order — the small, always-safe edits. */
export function AttributeDetailsForm({
  attributeId,
  initial,
  readOnly,
}: {
  attributeId: string;
  initial: Initial;
  readOnly?: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [sortOrder, setSortOrder] = useState(String(initial.sortOrder));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const dirty =
    name.trim() !== initial.name ||
    description.trim() !== initial.description ||
    (Number(sortOrder) || 0) !== initial.sortOrder;

  function save() {
    setError(null);
    start(async () => {
      const r = await fetch(`/api/admin/attributes/${attributeId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
          sortOrder: Number(sortOrder) || 0,
        }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setError(d.error ?? "Failed to save");
        return;
      }
      router.refresh();
    });
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (dirty && !readOnly) save();
      }}
      className="space-y-4"
    >
      {error ? <FormError>{error}</FormError> : null}
      <Field label="Name" htmlFor="attr-name" required>
        <Input id="attr-name" value={name} onChange={(e) => setName(e.target.value)} required disabled={readOnly} />
      </Field>
      <Field label="Description" htmlFor="attr-desc">
        <Textarea id="attr-desc" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} disabled={readOnly} placeholder="Notes for staff" />
      </Field>
      <Field label="Sort order" htmlFor="attr-sort" hint="Among attributes of the same type.">
        <Input id="attr-sort" type="number" className="max-w-[120px]" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} disabled={readOnly} />
      </Field>
      {!readOnly ? (
        <div className="flex items-center justify-end gap-2 pt-1">
          {dirty ? (
            <Button
              variant="ghost"
              size="sm"
              type="button"
              onClick={() => {
                setName(initial.name);
                setDescription(initial.description);
                setSortOrder(String(initial.sortOrder));
              }}
              disabled={pending}
            >
              Discard
            </Button>
          ) : null}
          <Button size="sm" type="submit" busy={pending} disabled={!dirty}>
            Save details
          </Button>
        </div>
      ) : null}
    </form>
  );
}
