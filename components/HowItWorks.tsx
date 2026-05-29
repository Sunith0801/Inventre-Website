"use client";

import { motion } from "framer-motion";
import { Smartphone, Package, Truck, Search, type LucideIcon } from "lucide-react";

const ICON_MAP: Record<string, LucideIcon> = { Smartphone, Package, Truck, Search };

type Step = {
  n: string;
  icon: string;
  title: string;
  body: string;
};

const DEFAULT_STEPS: Step[] = [
  {
    n: "01",
    icon: "Smartphone",
    title: "Sign in with your mobile",
    body: "Use the mobile number your school has on file. We recognise you instantly and load the right student, school, grade, and curated kit — no forms.",
  },
  {
    n: "02",
    icon: "Package",
    title: "Build the kit",
    body: "Your child's curated bundle is ready: uniforms, books, accessories. Add what you need, skip what you don't. Try-before-you-buy on first orders.",
  },
  {
    n: "03",
    icon: "Truck",
    title: "Doorstep delivery",
    body: "One labeled box, on time, before term starts. Free returns and exchanges within 7 days.",
  },
];

export function HowItWorks({ steps = DEFAULT_STEPS }: { steps?: Step[] } = {}) {
  return (
    <section
      id="how"
      className="relative mx-auto max-w-7xl px-5 lg:px-8 py-20 lg:py-28"
    >
      <div className="max-w-2xl">
        <div className="inline-flex items-center gap-2 rounded-full bg-brand-50 border border-brand-100 px-3 py-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-brand" />
          <span className="font-display text-[12px] font-semibold tracking-[0.18em] uppercase text-brand-700">
            How it works
          </span>
        </div>
        <h2 className="mt-4 font-display font-extrabold text-display-md text-ink-900">
          Three steps. No phone calls. <span className="text-brand">No queues.</span>
        </h2>
      </div>

      <div className="mt-12 grid md:grid-cols-3 gap-5 lg:gap-6 relative">
        {/* connector line — dashed orange */}
        <div
          aria-hidden
          className="hidden md:block absolute left-[14%] right-[14%] top-14 h-px"
          style={{
            backgroundImage:
              "linear-gradient(to right, #E47127 50%, transparent 50%)",
            backgroundSize: "12px 1px",
            backgroundRepeat: "repeat-x",
            opacity: 0.4,
          }}
        />
        {steps.map((s, i) => {
          const Icon = ICON_MAP[s.icon] ?? Search;
          return (
          <motion.div
            key={s.n}
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.6, delay: i * 0.1, ease: [0.16, 1, 0.3, 1] }}
            className="group relative rounded-2xl border border-ink-100 bg-white p-7 hover:border-brand hover:shadow-[0_20px_40px_-20px_rgba(228,113,39,0.25)] transition-all"
          >
            <div className="flex items-center justify-between">
              {/* orange icon badge */}
              <span className="relative grid h-14 w-14 place-items-center rounded-2xl bg-brand-50 border border-brand-100 text-brand transition-all group-hover:bg-brand group-hover:text-white group-hover:rotate-3">
                <Icon className="h-6 w-6" strokeWidth={2} />
                {/* corner dot */}
                <span className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-brand ring-2 ring-cream" />
              </span>
              <span className="font-display text-[48px] font-extrabold text-brand-50 leading-none group-hover:text-brand-100 transition-colors">
                {s.n}
              </span>
            </div>
            <h3 className="mt-6 font-display text-[22px] font-bold text-ink-900">
              {s.title}
            </h3>
            <p className="mt-2 text-[14px] leading-relaxed text-ink-600">
              {s.body}
            </p>
          </motion.div>
        );
        })}
      </div>
    </section>
  );
}
