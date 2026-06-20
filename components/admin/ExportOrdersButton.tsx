"use client";

import * as React from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/admin/ui/primitives";

/**
 * Export-Excel control for /admin/orders. Downloads one priced row per sold
 * line item (Magic Box / BookKit / uniform / standalone), each with its real
 * Rate & Amount. Unpriced loose kit components are intentionally excluded —
 * they have no individual price in the system — so there is no longer a
 * "sub-items" toggle. `baseHref` is the export URL already carrying the
 * active list filters (q / statusBucket / dateRange / from / to).
 */
export function ExportOrdersButton({ baseHref }: { baseHref: string }) {
  const download = () => {
    window.location.href = baseHref;
  };

  return (
    <Button
      variant="secondary"
      icon={<Download className="h-3.5 w-3.5" />}
      onClick={download}
    >
      Export Excel
    </Button>
  );
}
