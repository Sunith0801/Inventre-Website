"use client";

import { motion } from "framer-motion";
import {
  DoorOpen,
  Shirt,
  Package,
  ScanLine,
  Truck,
  ArrowRight,
} from "lucide-react";

const steps = [
  { n: "01", icon: DoorOpen, title: "Walk in", body: "No appointment." },
  { n: "02", icon: Shirt, title: "Try on", body: "Every size, every variant." },
  {
    n: "03",
    icon: Package,
    title: "See the Box",
    body: "Open one in person.",
    feature: true,
  },
  { n: "04", icon: ScanLine, title: "Scan + order", body: "QR on the rack." },
  { n: "05", icon: Truck, title: "Delivered", body: "Box at your door." },
];

export function WhatToExpect() {
  return (
    <section className="mx-auto max-w-7xl px-5 lg:px-8 py-20 lg:py-24">
      <div className="max-w-2xl">
        <div className="inline-flex items-center gap-2 rounded-full bg-brand-50 border border-brand-100 px-3 py-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-brand" />
          <span className="font-display text-[12px] font-semibold tracking-[0.18em] uppercase text-brand-700">
            What to expect
          </span>
        </div>
        <h2 className="mt-4 font-display font-extrabold text-display-md text-ink-900 leading-[1.05]">
          Five steps. Thirty minutes. <span className="text-brand">Done.</span>
        </h2>
      </div>

      {/* Horizontal numbered ribbon */}
      <div className="mt-12 relative">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 lg:gap-4 relative">
          {steps.map((s, i) => (
            <motion.div
              key={s.n}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{
                duration: 0.5,
                delay: i * 0.08,
                ease: [0.16, 1, 0.3, 1],
              }}
              className="relative"
            >
              {/* Connector arrow between cards (desktop only) */}
              {i < steps.length - 1 && (
                <div className="hidden lg:flex absolute -right-3 top-1/2 -translate-y-1/2 z-10 h-6 w-6 rounded-full bg-cream items-center justify-center">
                  <ArrowRight className="h-3.5 w-3.5 text-brand" />
                </div>
              )}

              <div
                className={
                  "h-full rounded-2xl border p-5 transition-all flex flex-col " +
                  (s.feature
                    ? "border-brand bg-brand text-white shadow-[0_20px_40px_-22px_rgba(228,113,39,0.5)]"
                    : "border-ink-100 bg-white hover:border-brand hover:shadow-[0_20px_40px_-22px_rgba(228,113,39,0.18)]")
                }
              >
                <div className="flex items-center justify-between">
                  <span
                    className={
                      "grid h-10 w-10 place-items-center rounded-xl " +
                      (s.feature
                        ? "bg-white/15 border border-white/25 text-white"
                        : "bg-brand-50 border border-brand-100 text-brand")
                    }
                  >
                    <s.icon className="h-4 w-4" strokeWidth={2} />
                  </span>
                  <span
                    className={
                      "font-mono text-[12px] font-bold tracking-wider " +
                      (s.feature ? "text-white/70" : "text-ink-400")
                    }
                  >
                    {s.n}
                  </span>
                </div>
                <h3
                  className={
                    "mt-4 font-display text-[15px] sm:text-[16px] font-bold leading-tight " +
                    (s.feature ? "text-white" : "text-ink-900")
                  }
                >
                  {s.title}
                </h3>
                <p
                  className={
                    "mt-1 text-[12px] leading-relaxed " +
                    (s.feature ? "text-white/85" : "text-ink-500")
                  }
                >
                  {s.body}
                </p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
