"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/admin/ui/primitives";
import { deleteRule } from "./actions";

export default function DeleteRuleButton({ name }: { name: string }) {
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  return (
    <form
      action={(fd) => {
        if (!confirm(`Delete delivery fee rule ${name}? This removes it from ERPNext.`)) return;
        setErr(null);
        startTransition(async () => {
          const r = await deleteRule(fd);
          if (!r.ok) setErr(r.error);
          else if (typeof window !== "undefined") window.location.reload();
        });
      }}
    >
      <input type="hidden" name="name" value={name} />
      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? "…" : "Delete"}
      </Button>
      {err && <div className="text-[11px] text-rose-700 mt-1">{err}</div>}
    </form>
  );
}
