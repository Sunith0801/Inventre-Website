import Link from "next/link";

/** Brand 404 (F-15). Server component; no data access. */
export default function NotFound() {
  return (
    <main className="min-h-[70vh] flex items-center justify-center px-4 bg-cream">
      <div className="max-w-md w-full text-center">
        <p className="text-6xl font-extrabold text-brand-200">404</p>
        <h1 className="mt-2 text-2xl font-bold text-ink-900">That page does not exist</h1>
        <p className="mt-2 text-ink-600">
          The link may be old, or the item may have been removed from the catalogue.
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <Link
            href="/shop"
            className="rounded-xl bg-brand hover:bg-brand-600 text-white font-semibold px-5 py-2.5"
          >
            Go to the store
          </Link>
          <Link
            href="/"
            className="rounded-xl border border-ink-200 bg-white text-ink-800 font-semibold px-5 py-2.5"
          >
            Home
          </Link>
        </div>
      </div>
    </main>
  );
}
