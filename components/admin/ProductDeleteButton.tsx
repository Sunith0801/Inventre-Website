"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/admin/ui/primitives";

export function ProductDeleteButton({
  productId,
  productName,
}: {
  productId: string;
  productName: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function onDelete() {
    if (!window.confirm(`Delete "${productName}"? This cannot be undone.`)) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/admin/products/${productId}`, {
        method: "DELETE",
      });
      if (!r.ok) {
        const body = await r.text();
        setError(`Delete failed: ${body || r.status}`);
        setBusy(false);
        return;
      }
      startTransition(() => {
        router.push("/admin/products");
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
      setBusy(false);
    }
  }

  return (
    <div className="inline-flex flex-col items-end gap-1">
      <Button
        variant="secondary"
        size="sm"
        icon={<Trash2 className="h-3.5 w-3.5" />}
        onClick={onDelete}
        disabled={busy || pending}
      >
        {busy || pending ? "Deleting…" : "Delete"}
      </Button>
      {error && (
        <p className="text-[11px] text-red-600 max-w-xs text-right">{error}</p>
      )}
    </div>
  );
}
