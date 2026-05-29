"use client";

import { Download } from "lucide-react";
import { Button } from "@/components/admin/ui/primitives-client";

export function ExportButton({
  type,
  label = "Export CSV",
}: {
  type: "orders" | "customers" | "invoices" | "products" | "stock" | "schools";
  label?: string;
}) {
  return (
    <a href={`/api/admin/export/${type}`} download>
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
