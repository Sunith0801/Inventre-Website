"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown } from "lucide-react";
import { Product } from "@/lib/products";
import { sizeChartColumns, sizeChartColumnLabel } from "@/lib/size-chart";

/**
 * Description, specifications and (when the product has one) the size
 * chart as collapsible sections under the buy box. Description starts
 * open; the rest open on tap. On a phone this is what stops the page
 * being three screens of text before the size chart.
 */
export function Tabs({ product }: { product: Product }) {
  const desc = product.description ?? [
    "A school-grade essential, expert-designed and rigorously tested for the Indian classroom.",
  ];
  const specs = product.specs ?? [
    { label: "Origin", value: "Made in India" },
    { label: "Approval", value: "School-approved · Inventre QC tested" },
  ];
  const sizeTable = product.sizeTable ?? null;

  return (
    <section className="mt-12 lg:mt-16 max-w-3xl divide-y divide-ink-100 rounded-2xl border border-ink-100 bg-white">
      <Collapsible title="Description" defaultOpen>
        <div className="space-y-4 text-[15px] leading-relaxed text-ink-700">
          {desc.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
      </Collapsible>
      <Collapsible title="Specifications">
        <dl className="grid sm:grid-cols-2 gap-x-10 gap-y-3">
          {specs.map((s) => (
            <div key={s.label} className="flex flex-col py-2 border-b border-ink-100 last:border-0">
              <dt className="text-[11px] font-semibold tracking-[0.16em] uppercase text-ink-500">{s.label}</dt>
              <dd className="mt-1 text-[14px] font-medium text-ink-900">{s.value}</dd>
            </div>
          ))}
        </dl>
      </Collapsible>
      {sizeTable && sizeTable.length > 0 ? (
        <Collapsible title="Size chart">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-500">
                  <th className="py-2 pr-4">Size</th>
                  {sizeChartColumns(sizeTable).map((c) => <th key={c} className="py-2 pr-4">{sizeChartColumnLabel(c)}</th>)}
                </tr>
              </thead>
              <tbody>
                {sizeTable.map((r) => (
                  <tr key={r.size} className="border-t border-ink-100">
                    <td className="py-2 pr-4 font-semibold text-ink-900">{r.size}</td>
                    {sizeChartColumns(sizeTable).map((c) => <td key={c} className="py-2 pr-4 tabular-nums text-ink-700">{r[c] || "—"}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-[12px] text-ink-500">Measurements in inches.</p>
          </div>
        </Collapsible>
      ) : null}
    </section>
  );
}

function Collapsible({ title, defaultOpen = false, children }: { title: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left"
      >
        <span className="text-[15px] font-semibold text-ink-900">{title}</span>
        <motion.span animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.2 }} className="text-ink-400">
          <ChevronDown className="h-4 w-4" />
        </motion.span>
      </button>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div key="body" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
            <div className="px-5 pb-5">{children}</div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
