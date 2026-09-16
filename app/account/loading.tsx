/** Skeleton for the account pages while the segment renders server-side. */
export default function AccountLoading() {
  return (
    <div className="mx-auto max-w-3xl px-5 lg:px-8 py-10 animate-pulse" aria-busy="true">
      <span className="sr-only">Loading your account…</span>
      <div className="h-9 w-48 rounded-lg bg-ink-200" />
      <div className="mt-8 rounded-2xl border border-ink-100 bg-white p-6 space-y-5">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i}>
            <div className="h-3 w-24 rounded bg-ink-100" />
            <div className="mt-2 h-12 rounded-xl bg-cream-100" />
          </div>
        ))}
      </div>
    </div>
  );
}
