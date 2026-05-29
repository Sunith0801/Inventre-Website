// Skeleton shown while any /admin/(protected)/* segment is rendering on the
// server. Without this the click on a drawer link feels dead — Next.js holds
// the old page until the new one is fully ready, which for heavy lists
// (Products, Students) can take several seconds.

export default function Loading() {
  return (
    <div className="px-5 lg:px-8 py-6 animate-pulse">
      <div className="flex items-center justify-between mb-6">
        <div className="space-y-2">
          <div className="h-3 w-24 bg-ink-100 rounded" />
          <div className="h-6 w-48 bg-ink-200 rounded" />
        </div>
        <div className="h-9 w-28 bg-ink-100 rounded-lg" />
      </div>
      <div className="rounded-2xl border border-ink-100 bg-white p-4 shadow-sm">
        <div className="flex gap-3 mb-4">
          <div className="h-9 flex-1 bg-ink-100 rounded-lg" />
          <div className="h-9 w-24 bg-ink-100 rounded-lg" />
          <div className="h-9 w-24 bg-ink-100 rounded-lg" />
        </div>
        <div className="space-y-2">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="h-12 bg-ink-50 rounded-lg" />
          ))}
        </div>
      </div>
    </div>
  );
}
