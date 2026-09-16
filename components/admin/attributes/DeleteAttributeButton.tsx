"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/admin/ui/primitives-client";
import { ConfirmDialog } from "@/components/admin/ui/dialog";

/**
 * Delete is only offered when nothing binds the attribute. The FK from
 * product_attribute_bindings is ON DELETE RESTRICT, so an in-use delete
 * would not fail gracefully — it would fail in Postgres.
 */
export function DeleteAttributeButton({
  attributeId,
  name,
  usedBy,
}: {
  attributeId: string;
  name: string;
  usedBy: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const blocked = usedBy > 0;

  function confirm() {
    setError(null);
    start(async () => {
      const r = await fetch(`/api/admin/attributes/${attributeId}`, { method: "DELETE" });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setError(d.error ?? "Could not delete this attribute.");
        return;
      }
      router.push("/admin/catalog/attributes");
      router.refresh();
    });
  }

  return (
    <>
      <span title={blocked ? `In use by ${usedBy} product${usedBy === 1 ? "" : "s"} — unbind them first.` : undefined}>
        <Button variant="danger" size="sm" icon={<Trash2 className="h-3.5 w-3.5" />} disabled={blocked} onClick={() => setOpen(true)}>
          Delete
        </Button>
      </span>
      <ConfirmDialog
        open={open}
        onClose={() => (pending ? null : setOpen(false))}
        onConfirm={confirm}
        busy={pending}
        error={error}
        title={`Delete “${name}”?`}
        confirmLabel="Delete attribute"
        description="Every value under it goes too. Nothing uses it today, so no product or variant is affected."
      />
    </>
  );
}
