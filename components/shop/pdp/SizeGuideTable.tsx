"use client";

/**
 * Loose-props variant of the PDP size-guide content (the table + chart
 * image), so a Magic Box row can render a per-item size guide inside a
 * modal without dragging a full Product object around. The PDP's
 * SizeGuide accordion can be refactored to use this same body when it
 * needs to, but today it has its own scroll-anchored wrapper so we keep
 * them separate.
 */
export function SizeGuideTable({
  sizeTable,
  sizeChartUrl,
  productName,
}: {
  sizeTable:
    | { size: string; chest: string; length: string; sleeve: string }[]
    | null
    | undefined;
  sizeChartUrl: string | null | undefined;
  productName: string;
}) {
  const table = sizeTable ?? null;
  const chart = sizeChartUrl ?? null;
  if (!table?.length && !chart) {
    return (
      <p className="text-[13px] text-ink-500">
        Size details aren&apos;t available for this item yet.
      </p>
    );
  }
  return (
    <div>
      {chart ? (
        <div className="rounded-xl border border-ink-100 bg-cream-50 overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={chart}
            alt={`${productName} size chart`}
            className="w-full h-auto object-contain max-h-[400px] mx-auto"
          />
        </div>
      ) : null}
      {table?.length ? (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-[11px] font-semibold tracking-[0.14em] uppercase text-ink-500">
                <th className="py-2 pr-4">Size</th>
                <th className="py-2 pr-4">Chest</th>
                <th className="py-2 pr-4">Length</th>
                <th className="py-2 pr-4">Sleeve</th>
              </tr>
            </thead>
            <tbody className="font-mono tabular-nums">
              {table.map((r) => (
                <tr key={r.size} className="border-t border-ink-100">
                  <td className="py-2 pr-4 font-display font-bold text-ink-900">
                    {r.size}
                  </td>
                  <td className="py-2 pr-4 text-ink-700">{r.chest}</td>
                  <td className="py-2 pr-4 text-ink-700">{r.length}</td>
                  <td className="py-2 pr-4 text-ink-700">{r.sleeve}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
