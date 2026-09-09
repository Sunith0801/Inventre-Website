"use client";

import { Download } from "lucide-react";
import { Button } from "@/components/admin/ui/primitives-client";

export function ExportButton({
  type,
  label = "Export CSV",
  href,
}: {
  type: "orders" | "customers" | "invoices" | "products" | "stock" | "schools";
  label?: string;
  /** Override the download URL (e.g. a filter-aware, per-area export route). */
  href?: string;
}) {
  return (
    <a href={href ?? `/api/admin/export/${type}`} download>
      <Button
        variant="secondary"
        size="sm"
        icon={<Download className="h-3.5 w-3.5" />}
      >
        {label}
      </Button>
    </a>
  );
}
