// Skeleton shown while any /admin/(protected)/* segment is rendering on the
// server. Without this the click on a sidebar link feels dead — Next.js holds
// the old page until the new one is fully ready, which for heavy lists
// (Products, Students) can take several seconds. `error.tsx` beside it covers
// the other half: a segment that fails instead of one that is still pending.
//
// Shaped like the common admin page (PageHeader, toolbar, table card) and
// built from the same primitives, so the layout does not jump when the real
// page lands.

import { Card, Skeleton } from "@/components/admin/ui/primitives";

export default function AdminLoading() {
  return (
    <div className="px-5 lg:px-8 py-6" aria-busy="true">
      <span className="sr-only">Loading…</span>

      {/* PageHeader: eyebrow, title, description + an action button */}
      <div className="mb-6 lg:mb-8 flex items-end justify-between gap-4">
        <div className="min-w-0 flex-1 space-y-2.5">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-7 w-64 max-w-full" />
          <Skeleton className="h-3.5 w-96 max-w-full" />
        </div>
        <Skeleton className="h-9 w-28 rounded-lg flex-shrink-0" />
      </div>

      {/* Toolbar: search + filters */}
      <div className="flex flex-wrap items-center gap-2 mb-4 p-2 rounded-xl bg-white border border-ink-100/70">
        <Skeleton className="h-9 flex-1 min-w-[200px] rounded-lg" />
        <Skeleton className="h-9 w-24 rounded-lg" />
        <Skeleton className="h-9 w-24 rounded-lg" />
      </div>

      {/* Table card */}
      <Card padded={false}>
        <div className="px-4 py-3 border-b border-ink-100/70">
          <Skeleton className="h-3 w-40" />
        </div>
        <div className="divide-y divide-ink-100/70">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-3.5">
              <Skeleton className="h-4 w-1/4" />
              <Skeleton className="h-4 w-1/5" />
              <Skeleton className="h-4 w-1/6 hidden sm:block" />
              <Skeleton className="h-5 w-16 rounded-full ml-auto" />
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
