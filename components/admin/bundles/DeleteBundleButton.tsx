"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/admin/ui/primitives-client";
import { ConfirmDialog } from "@/components/admin/ui/dialog";

/**
 * Removes the bundle definition, not the product. Parent kits that include
 * this product keep their component row — it simply stops expanding into
 * its own contents — so the dialog says how many there are.
 */
export function DeleteBundleButton({
  bundleId,
  name,
  parentCount,
}: {
  bundleId: string;
  name: string;
  parentCount: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function confirm() {
    setError(null);
    start(async () => {
      const r = await fetch(`/api/admin/bundles/${bundleId}`, { method: "DELETE" });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setError(d.error ?? "Could not delete this bundle.");
        return;
      }
      router.push("/admin/catalog/bundles");
      router.refresh();
    });
  }

  return (
    <>
      <Button variant="danger" size="sm" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => setOpen(true)}>
        Delete bundle
      </Button>
      <ConfirmDialog
        open={open}
        onClose={() => (pending ? null : setOpen(false))}
        onConfirm={confirm}
        busy={pending}
        error={error}
        title={`Stop “${name}” being a bundle?`}
        confirmLabel="Delete bundle"
        description={
          parentCount > 0
            ? `The product stays. Its ${parentCount} parent kit${parentCount === 1 ? "" : "s"} will keep it as a plain item that no longer expands into components.`
            : "The product stays in the catalogue; only its component list is removed."
        }
      />
    </>
  );
}
