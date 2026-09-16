/**
 * Shown while any /shop/* segment renders on the server. The shop's data path
 * (school + grade resolution, then the eligibility and bundle engines) is not
 * fast, and without this the browser held the previous page with no feedback
 * after a tap — the click simply looked ignored.
 *
 * Deliberately shaped like the product grid it precedes, so the layout does
 * not jump when the real content lands.
 */

export default function ShopLoading() {
  return (
    <div className="mx-auto max-w-7xl px-5 lg:px-8 py-10 animate-pulse" aria-busy="true">
      <span className="sr-only">Loading the shop…</span>

      {/* Heading block */}
      <div className="h-6 w-32 rounded-full bg-ink-100" />
      <div className="mt-4 h-10 w-72 max-w-full rounded-lg bg-ink-200" />
      <div className="mt-3 h-4 w-96 max-w-full rounded bg-ink-100" />

      {/* Filter rail */}
      <div className="mt-8 flex flex-wrap gap-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-10 w-28 rounded-full bg-ink-100" />
        ))}
      </div>

      {/* Product grid — matches the real 2/3/4-up rhythm */}
      <div className="mt-8 grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 lg:gap-5">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="rounded-2xl border border-ink-100 bg-white overflow-hidden">
            <div className="aspect-[4/5] bg-cream-100" />
            <div className="p-4">
              <div className="h-4 w-3/4 rounded bg-ink-100" />
              <div className="mt-2 h-3 w-1/2 rounded bg-ink-100" />
              <div className="mt-4 h-5 w-20 rounded bg-ink-200" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
