"use client";

import { motion } from "framer-motion";
import { Leaf, Recycle, TreePine, Package } from "lucide-react";

const points = [
  {
    icon: Recycle,
    title: "One delivery, one box",
    body: "Our Magic Box system reduces logistics emissions and packaging waste by consolidating all student essentials into a single delivery — small shift, big impact.",
  },
  {
    icon: TreePine,
    title: "Tech-driven supply chain",
    body: "Digital ordering and centralised inventory tracking cut overproduction, errors, and unnecessary shipments — fewer returns, less waste, smarter consumption.",
  },
  {
    icon: Leaf,
    title: "A world worth growing into",
    body: "Caring for students also means caring for the world they're growing up in. Sustainability isn't an add-on — it's embedded in how we operate.",
  },
];

export function Sustainability() {
  return (
    <section
      id="sustainability"
      className="bg-cream-200 border-y border-ink-100 relative overflow-hidden scroll-mt-24"
    >
      {/* quiet orange dot grid */}
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          backgroundImage:
            "radial-gradient(circle at 1px 1px, rgba(228,113,39,0.18) 1px, transparent 0)",
          backgroundSize: "22px 22px",
        }}
      />
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(60% 50% at 90% 100%, rgba(228,113,39,0.18) 0%, rgba(228,113,39,0) 60%)",
        }}
      />

      <div className="relative mx-auto max-w-7xl px-5 lg:px-8 py-20 lg:py-28">
        <div className="grid lg:grid-cols-[1.1fr_1.2fr] gap-10 lg:gap-16 items-center">
          {/* Left: comparison infographic instead of generic photo */}
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
            className="relative"
          >
            <div className="grid grid-cols-2 gap-4">
              {/* Old way */}
              <div className="rounded-2xl border border-ink-100 bg-white p-6 lg:p-7">
                <p className="font-display text-[11px] font-semibold tracking-[0.18em] uppercase text-ink-400">
                  The old way
                </p>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  {[1, 2, 3, 4].map((i) => (
                    <div
                      key={i}
                      className="aspect-square rounded-md bg-ink-50 border border-ink-100 grid place-items-center"
                    >
                      <Package className="h-4 w-4 text-ink-400" strokeWidth={2} />
                    </div>
                  ))}
                </div>
                <p className="mt-5 font-display text-[28px] font-extrabold text-ink-900 leading-none">
                  4+
                </p>
                <p className="mt-1.5 text-[12px] text-ink-500">
                  vendor deliveries · per child · per year
                </p>
              </div>

              {/* Inventre way */}
              <div className="relative rounded-2xl border border-brand-100 bg-white p-6 lg:p-7 shadow-[0_20px_40px_-22px_rgba(228,113,39,0.30)]">
                <span className="absolute -top-2 left-6 rounded-full bg-brand text-white px-2.5 py-0.5 text-[10px] font-bold tracking-wider uppercase">
                  Inventre
                </span>
                <p className="font-display text-[11px] font-semibold tracking-[0.18em] uppercase text-brand-700">
                  Our way
                </p>
                <div className="mt-4 aspect-[1/1] rounded-md bg-brand-50 border border-brand-100 grid place-items-center">
                  <Package
                    className="h-10 w-10 text-brand"
                    strokeWidth={2}
                  />
                </div>
                <p className="mt-5 font-display text-[28px] font-extrabold text-brand leading-none">
                  1
                </p>
                <p className="mt-1.5 text-[12px] text-ink-500">
                  Magic Box · everything inside
                </p>
              </div>
            </div>

            {/* impact stats panel */}
            <div className="mt-4 rounded-2xl border border-ink-100 bg-white px-4 py-5">
              <p className="font-display text-[11px] font-semibold tracking-[0.18em] uppercase text-brand-700 text-center">
                The Inventre impact
              </p>
              <div className="mt-4 flex items-stretch">
                <div className="flex-1 min-w-0 text-center px-1">
                  <p className="font-display text-[22px] sm:text-[26px] font-extrabold text-ink-900 leading-none">
                    ~75%
                  </p>
                  <p className="mt-1.5 text-[11px] text-ink-500 leading-tight whitespace-nowrap">
                    fewer trips
                  </p>
                </div>
                <span className="w-px bg-ink-100 self-stretch" />
                <div className="flex-1 min-w-0 text-center px-1">
                  <p className="font-display text-[22px] sm:text-[26px] font-extrabold text-ink-900 leading-none">
                    60%
                  </p>
                  <p className="mt-1.5 text-[11px] text-ink-500 leading-tight whitespace-nowrap">
                    less packaging
                  </p>
                </div>
                <span className="w-px bg-ink-100 self-stretch" />
                <div className="flex-1 min-w-0 text-center px-1">
                  <p className="font-display text-[22px] sm:text-[26px] font-extrabold text-brand leading-none">
                    Zero
                  </p>
                  <p className="mt-1.5 text-[11px] text-ink-500 leading-tight whitespace-nowrap">
                    vendor chase
                  </p>
                </div>
              </div>
            </div>
          </motion.div>

          {/* Right: copy */}
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-brand-50 border border-brand-100 px-3 py-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-brand" />
              <span className="font-display text-[12px] font-semibold tracking-[0.18em] uppercase text-brand-700">
                Care for the world
              </span>
            </div>
            <h2 className="mt-4 font-display font-extrabold text-display-md text-ink-900 leading-[1.05]">
              Caring for students means caring for{" "}
              <span className="text-brand">the world they grow into.</span>
            </h2>
            <p className="mt-5 text-[15px] leading-relaxed text-ink-600 max-w-xl">
              At Inventre, sustainability isn&apos;t an add-on — it&apos;s
              embedded into how we think, operate, and deliver.
            </p>

            <ul className="mt-8 space-y-5">
              {points.map((p, i) => (
                <motion.li
                  key={p.title}
                  initial={{ opacity: 0, x: -8 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true, margin: "-60px" }}
                  transition={{
                    duration: 0.5,
                    delay: i * 0.08,
                    ease: [0.16, 1, 0.3, 1],
                  }}
                  className="flex items-start gap-4"
                >
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-brand-50 border border-brand-100 text-brand">
                    <p.icon className="h-4 w-4" strokeWidth={2} />
                  </span>
                  <div>
                    <p className="font-display text-[16px] font-bold text-ink-900">
                      {p.title}
                    </p>
                    <p className="mt-1 text-[14px] leading-relaxed text-ink-600">
                      {p.body}
                    </p>
                  </div>
                </motion.li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
