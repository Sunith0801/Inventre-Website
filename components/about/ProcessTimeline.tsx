"use client";

import { motion } from "framer-motion";
import {
  Pencil,
  CheckCircle2,
  Brain,
  Factory,
  Store,
  ShoppingCart,
  Truck,
  ArrowRight,
} from "lucide-react";

const steps = [
  {
    n: "01",
    icon: Pencil,
    title: "Design Consultation",
    body:
      "We collaborate with schools to understand requirements, preferences, and academic needs before design begins.",
    cta: { label: "Get a free design consultation", href: "/contact?topic=design" },
  },
  {
    n: "02",
    icon: CheckCircle2,
    title: "Custom Design Finalization",
    body:
      "School-approved designs are carefully curated and finalized to ensure consistency, quality, and identity.",
  },
  {
    n: "03",
    icon: Brain,
    title: "Intelligent Forecasting",
    body:
      "We plan quantities through data-driven forecasting to ensure availability and cost efficiency.",
  },
  {
    n: "04",
    icon: Factory,
    title: "Manufacturing",
    body:
      "Products are manufactured to approved specifications with strict quality and timeline controls.",
  },
  {
    n: "05",
    icon: Store,
    title: "Trial Store at School",
    body:
      "Our on-campus trial store allows parents and students to check fit, quality, and samples with ease.",
  },
  {
    n: "06",
    icon: ShoppingCart,
    title: "Place Orders via Website",
    body:
      "Parents conveniently place orders online through the Inventre platform with secure payments.",
  },
  {
    n: "07",
    icon: Truck,
    title: "Doorstep Delivery",
    body:
      "Orders are neatly packed and delivered home in our signature Inventre Magic Box.",
  },
];

export function ProcessTimeline() {
  return (
    <section
      id="process"
      className="mx-auto max-w-7xl px-5 lg:px-8 py-20 lg:py-28 scroll-mt-24"
    >
      <div className="max-w-2xl">
        <div className="inline-flex items-center gap-2 rounded-full bg-brand-50 border border-brand-100 px-3 py-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-brand" />
          <span className="font-display text-[12px] font-semibold tracking-[0.18em] uppercase text-brand-700">
            How we deliver
          </span>
        </div>
        <h2 className="mt-4 font-display font-extrabold text-display-md text-ink-900 leading-[1.05]">
          Seven steps from sketchpad to{" "}
          <span className="text-brand">doorstep.</span>
        </h2>
        <p className="mt-5 text-[15px] sm:text-[16px] leading-relaxed text-ink-600 max-w-xl">
          A single, accountable workflow — from your first design conversation
          to the box landing on a parent&apos;s doormat.
        </p>
      </div>

      {/* Timeline rail */}
      <div className="relative mt-14">
        {/* dashed orange rail */}
        <div
          aria-hidden
          className="absolute left-6 sm:left-8 top-2 bottom-2 w-px"
          style={{
            backgroundImage:
              "linear-gradient(to bottom, #E47127 50%, transparent 50%)",
            backgroundSize: "1px 12px",
            opacity: 0.4,
          }}
        />

        <ol className="space-y-5">
          {steps.map((s, i) => (
            <motion.li
              key={s.n}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{
                duration: 0.5,
                delay: i * 0.05,
                ease: [0.16, 1, 0.3, 1],
              }}
              className="relative pl-16 sm:pl-20 group"
            >
              {/* node — uniform across all steps */}
              <span className="absolute left-0 top-2 grid h-12 w-12 sm:h-14 sm:w-14 place-items-center rounded-2xl bg-brand-50 border border-brand-100 text-brand transition-all group-hover:bg-brand group-hover:text-white">
                <s.icon className="h-5 w-5 sm:h-6 sm:w-6" strokeWidth={2} />
              </span>

              <div className="rounded-2xl border border-ink-100 bg-white p-6 lg:p-7 transition-all hover:border-brand hover:shadow-[0_20px_40px_-22px_rgba(228,113,39,0.20)]">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="font-display text-[12px] font-semibold tracking-[0.18em] uppercase text-brand-700">
                      Step {s.n}
                    </p>
                    <h3 className="mt-2 font-display text-[20px] sm:text-[22px] font-bold text-ink-900">
                      {s.title}
                    </h3>
                  </div>
                  <span className="font-display text-[44px] sm:text-[56px] font-extrabold leading-none text-brand-50 shrink-0">
                    {s.n}
                  </span>
                </div>
                <p className="mt-3 text-[14px] sm:text-[14.5px] leading-relaxed text-ink-600 max-w-2xl">
                  {s.body}
                </p>
                {s.cta && (
                  <a
                    href={s.cta.href}
                    className="group/cta mt-4 inline-flex items-center gap-1.5 text-[13px] font-semibold text-brand hover:text-brand-700"
                  >
                    {s.cta.label}
                    <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover/cta:translate-x-0.5" />
                  </a>
                )}
              </div>
            </motion.li>
          ))}
        </ol>
      </div>
    </section>
  );
}
