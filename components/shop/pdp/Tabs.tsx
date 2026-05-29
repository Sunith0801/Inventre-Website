"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Product } from "@/lib/products";

export function Tabs({ product }: { product: Product }) {
  const [tab, setTab] = useState<"desc" | "specs">("desc");

  const desc = product.description ?? [
    "A school-grade essential, expert-designed and rigorously tested for the Indian classroom.",
  ];
  const specs = product.specs ?? [
    { label: "Origin", value: "Made in India" },
    { label: "Approval", value: "School-approved · Inventre QC tested" },
  ];

  return (
    <section className="mt-16 lg:mt-24">
      <div className="border-b border-ink-100">
        <div className="flex gap-1">
          <TabButton active={tab === "desc"} onClick={() => setTab("desc")}>
            Description
          </TabButton>
          <TabButton active={tab === "specs"} onClick={() => setTab("specs")}>
            Specs & Care
          </TabButton>
        </div>
      </div>

      <div className="mt-8 max-w-3xl">
        <AnimatePresence mode="wait">
          {tab === "desc" ? (
            <motion.div
              key="desc"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.25 }}
              className="space-y-4 text-[15px] leading-relaxed text-ink-700"
            >
              {desc.map((p, i) => (
                <p key={i}>{p}</p>
              ))}
            </motion.div>
          ) : (
            <motion.dl
              key="specs"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.25 }}
              className="grid sm:grid-cols-2 gap-x-10 gap-y-4"
            >
              {specs.map((s) => (
                <div key={s.label} className="flex flex-col py-3 border-b border-ink-100">
                  <dt className="text-[11px] font-semibold tracking-[0.16em] uppercase text-ink-500">
                    {s.label}
                  </dt>
                  <dd className="mt-1 text-[14px] font-medium text-ink-900">
                    {s.value}
                  </dd>
                </div>
              ))}
            </motion.dl>
          )}
        </AnimatePresence>
      </div>
    </section>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "relative px-5 py-3 text-[14px] font-semibold transition-colors " +
        (active ? "text-ink-900" : "text-ink-500 hover:text-ink-800")
      }
    >
      {children}
      {active && (
        <motion.span
          layoutId="tab-underline"
          className="absolute left-0 right-0 -bottom-px h-0.5 bg-brand"
          transition={{ type: "spring", stiffness: 500, damping: 35 }}
        />
      )}
    </button>
  );
}
