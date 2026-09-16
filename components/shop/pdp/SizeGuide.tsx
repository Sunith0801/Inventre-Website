"use client";

import { sizeChartColumns, sizeChartColumnLabel } from "@/lib/size-chart";

import { forwardRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Ruler, Plus } from "lucide-react";
import { Product } from "@/lib/products";

/**
 * Render the size-chart image with a graceful fallback. Some schools (SAM,
 * mid-2026) have `size_chart_url` values that point at ERP files that no
 * longer exist; the ERP soft-404s by serving its dashboard HTML with a 200
 * status, so the browser draws a broken icon. We swap to a plain message on
 * onError + a "missing on the ERP side" hint so the parent isn't left
 * staring at a broken image.
 */
function ChartImage({ url, alt }: { url: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div className="my-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[12.5px] text-amber-800">
        Size chart image is currently unavailable. Please refer to the
        measurements table below, or contact your school admin.
      </div>
    );
  }
  return (
    <div className="my-4 rounded-xl border border-ink-100 bg-cream-50 overflow-hidden">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt={alt}
        className="w-full h-auto object-contain max-h-[400px] mx-auto"
        onError={() => setFailed(true)}
      />
    </div>
  );
}

export const SizeGuide = forwardRef<HTMLDivElement, { product: Product }>(
  function SizeGuide({ product }, ref) {
    const [open, setOpen] = useState(false);
    const table = product.sizeTable;
    const chartUrl = product.sizeChartUrl ?? null;
    if (!table?.length && !chartUrl) return null;

    return (
      <section ref={ref} id="size-guide" className="mt-12 scroll-mt-28">
        <div className="rounded-2xl border border-ink-100 bg-white overflow-hidden">
          <button
            type="button"
            onClick={() => setOpen(!open)}
            className="w-full flex items-center justify-between gap-4 p-5 lg:p-6 text-left"
          >
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-full bg-brand-50 border border-brand-100 text-brand">
                <Ruler className="h-4 w-4" />
              </span>
              <div>
                <p className="font-display text-[16px] font-bold text-ink-900">
                  Size guide
                </p>
                <p className="text-[12.5px] text-ink-500">
                  Measurements for {product.name.toLowerCase()} · in inches
                </p>
              </div>
            </div>
            <span
              className={`grid h-9 w-9 place-items-center rounded-full border border-ink-200 transition-all ${open ? "bg-ink-900 text-white rotate-45 border-ink-900" : "text-ink-700"}`}
            >
              <Plus className="h-4 w-4" />
            </span>
          </button>

          <AnimatePresence initial={false}>
            {open && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                className="overflow-hidden"
              >
                <div className="px-5 lg:px-6 pb-6 pt-2 border-t border-ink-100">
                  {chartUrl ? (
                    <ChartImage url={chartUrl} alt={`${product.name} size chart`} />
                  ) : null}
                  {table?.length ? (
                    <>
                      <div className="overflow-x-auto">
                        <table className="w-full text-[14px]">
                          <thead>
                            <tr className="text-left text-[11px] font-semibold tracking-[0.14em] uppercase text-ink-500">
                              <th className="py-3 pr-4">Size</th>
                              {sizeChartColumns(table).map((c) => (
                                <th key={c} className="py-3 pr-4">{sizeChartColumnLabel(c)}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="font-mono tabular-nums">
                            {table.map((r) => (
                              <tr key={r.size} className="border-t border-ink-100">
                                <td className="py-3 pr-4 font-display font-bold text-ink-900">
                                  {r.size}
                                </td>
                                {sizeChartColumns(table).map((c) => (
                                  <td key={c} className="py-3 pr-4 text-ink-700">{r[c] || "—"}</td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <p className="mt-4 text-[12.5px] text-ink-500">
                        Tip: order one size up if your child is between two sizes —
                        most children grow ~2 inches a year and the fabric is
                        pre-shrunk.
                      </p>
                    </>
                  ) : null}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </section>
    );
  }
);
