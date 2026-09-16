"use client";

/**
 * Error boundary for every /admin/(protected)/* segment.
 *
 * Sits beside the existing `loading.tsx` so the two halves of the navigation
 * story are both covered: a pending segment shows a skeleton, a failed one
 * shows this instead of dumping staff onto Next's default error page with
 * the admin drawer gone and no route back.
 *
 * Staff are the audience here, so unlike the storefront boundary this one
 * surfaces the error message — it is the difference between "it broke" and a
 * screenshot that says which query failed.
 */

import { useEffect } from "react";
import { AlertTriangle, RotateCw, LayoutDashboard } from "lucide-react";
import { Button, Card, EmptyState } from "@/components/admin/ui/primitives";

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[admin] segment error", error.digest, error);
  }, [error]);

  return (
    <div className="px-5 lg:px-8 py-6">
      <Card padded={false}>
        <EmptyState
          icon={AlertTriangle}
          title="This page failed to load"
          description="The rest of the admin is still working — use Retry, or head back to the dashboard."
          action={
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button onClick={reset} icon={<RotateCw className="h-3.5 w-3.5" />}>
                Retry
              </Button>
              <a href="/admin/dashboard">
                <Button variant="secondary" icon={<LayoutDashboard className="h-3.5 w-3.5" />}>
                  Dashboard
                </Button>
              </a>
            </div>
          }
        />
        {/* Kept monospace and selectable: this block gets pasted into a bug
            report far more often than it gets read on screen. */}
        <div className="border-t border-ink-100/70 px-5 py-4 lg:px-6">
          <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-400">
            Details
          </div>
          <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-[11.5px] leading-relaxed text-ink-600">
            {error.message || "No message supplied."}
            {error.digest ? `\n\nDigest: ${error.digest}` : ""}
          </pre>
        </div>
      </Card>
    </div>
  );
}
