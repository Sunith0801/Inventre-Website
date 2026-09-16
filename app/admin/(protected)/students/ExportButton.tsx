"use client";

import { Download } from "lucide-react";
import { Button } from "@/components/admin/ui/primitives";

/**
 * Export the CURRENT filter set. The browser keeps the URL in step with
 * the filters (history.replaceState in StudentsBrowser), so the query
 * string at click time is exactly what the table shows — the page itself
 * is server-rendered once and would otherwise hand out a stale link.
 */
export function StudentsExportButton() {
  return (
    <Button
      type="button"
      variant="secondary"
      icon={<Download className="h-3.5 w-3.5" />}
      title="Download the filtered students as Excel"
      onClick={() => {
        const params = new URLSearchParams(window.location.search);
        params.delete("page");
        const qs = params.toString();
        window.location.href = `/api/admin/students/export${qs ? `?${qs}` : ""}`;
      }}
    >
      Export
    </Button>
  );
}
