"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive, AlertTriangle } from "lucide-react";
import { Button } from "@/components/admin/ui/primitives-client";

type Counts = {
  erpDisabled: number;
  erpDisabledActive: number;
  erpDisabledArchived: number;
  erpDeleted: number;
};

/**
 * Admin-driven bulk action.
 *
 * Shows nothing if there are no items to act on. Otherwise renders a
 * button "Archive {N} ERP-disabled items" that POSTs to
 * /api/admin/products/archive-erp-disabled and then refreshes the page.
 *
 * Per session-decision (2026-05-17): the sync only mirrors the ERP
 * `disabled` flag; this admin click is the *only* path that flips
 * products.status='archived' based on it.
 */
export function ArchiveErpDisabledButton() {
  const router = useRouter();
  const [counts, setCounts] = useState<Counts | null>(null);
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/products/archive-erp-disabled", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((c) => {
        if (!cancelled && c) setCounts(c);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (!counts) return null;
  if (counts.erpDisabledActive === 0) {
    return counts.erpDisabled > 0 ? (
      <span className="text-[11px] text-ink-500 inline-flex items-center gap-1">
        <Archive className="h-3 w-3" />
        {counts.erpDisabled} ERP-disabled · all already archived
      </span>
    ) : null;
  }

  const run = () => {
    if (
      !confirm(
        `Archive ${counts.erpDisabledActive} product${counts.erpDisabledActive === 1 ? "" : "s"} currently marked disabled in ERP? They will disappear from the storefront. You can re-promote individually from the product detail page.`
      )
    )
      return;
    setError(null);
    start(async () => {
      const r = await fetch("/api/admin/products/archive-erp-disabled", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!r.ok) {
        setError("Archive failed");
        return;
      }
      router.refresh();
    });
  };

  return (
    <span className="inline-flex items-center gap-2">
      <Button
        busy={busy}
        onClick={run}
        type="button"
        variant="secondary"
        icon={<Archive className="h-3.5 w-3.5" />}
      >
        Archive {counts.erpDisabledActive} ERP-disabled
      </Button>
      {error ? (
        <span className="text-[12px] text-red-700 inline-flex items-center gap-1">
          <AlertTriangle className="h-3 w-3" />
          {error}
        </span>
      ) : null}
    </span>
  );
}
