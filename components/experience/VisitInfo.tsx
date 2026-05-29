"use client";

import { motion } from "framer-motion";
import {
  Clock,
  Car,
  Train,
  Accessibility,
  CalendarCheck,
  ShoppingBag,
} from "lucide-react";

const groups = [
  {
    icon: Clock,
    label: "Hours",
    primary: "Mon–Sat · 11–9",
    secondary: "Sundays by appointment",
  },
  {
    icon: Car,
    label: "Parking",
    primary: "2 hrs free",
    secondary: "Inside Ashoka One Mall · valet at main entrance",
  },
  {
    icon: Train,
    label: "Public transit",
    primary: "KPHB metro",
    secondary: "8 min by auto · MMTS at Hi-Tec City",
  },
  {
    icon: Accessibility,
    label: "Accessibility",
    primary: "Step-free",
    secondary: "Lifts to 3rd floor · wheelchair-friendly fitting rooms",
  },
  {
    icon: CalendarCheck,
    label: "Schools",
    primary: "Private tour",
    secondary: "Principals & purchase teams — book ahead, we prep your catalogue",
  },
  {
    icon: ShoppingBag,
    label: "What to bring",
    primary: "Just yourself",
    secondary: "Carry the kid's measurements if you have them",
  },
];

export function VisitInfo() {
  return (
    <section className="mx-auto max-w-7xl px-5 lg:px-8 py-16 lg:py-20">
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-80px" }}
        transition={{ duration: 0.7 }}
        className="relative rounded-[24px] border border-ink-100 bg-white shadow-[0_30px_60px_-30px_rgba(0,0,0,0.15)] overflow-hidden"
      >
        {/* concierge sheet header */}
        <div className="relative px-6 sm:px-8 lg:px-10 pt-7 pb-5 border-b border-dashed border-ink-200 bg-gradient-to-br from-cream-50 to-white">
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
            <div>
              <p className="font-display text-[10px] font-bold tracking-[0.22em] uppercase text-brand-700">
                Visitor information
              </p>
              <h2 className="mt-2 font-display text-[22px] sm:text-[28px] font-extrabold text-ink-900 leading-tight">
                Plan your visit.{" "}
                <span className="text-brand">It&apos;s a quick one.</span>
              </h2>
            </div>
            <p className="font-mono text-[10px] tracking-wider uppercase text-ink-400">
              SHEET / 01-A
            </p>
          </div>
        </div>

        {/* concierge grid — single panel divided into sections */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-ink-100">
          {groups.map((g, i) => (
            <motion.div
              key={g.label}
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ duration: 0.4, delay: i * 0.05 }}
              className={
                "p-6 lg:p-7 " +
                ((i + 1) % 2 === 0 ? "sm:border-t sm:border-t-ink-100 lg:border-t-0 " : "") +
                ((i + 1) > 3 ? "lg:border-t lg:border-t-ink-100 " : "")
              }
            >
              <div className="flex items-center gap-2.5">
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-50 border border-brand-100 text-brand">
                  <g.icon className="h-4 w-4" strokeWidth={2} />
                </span>
                <p className="font-display text-[10px] font-bold tracking-[0.20em] uppercase text-brand-700">
                  {g.label}
                </p>
              </div>
              <p className="mt-4 font-display text-[20px] font-extrabold text-ink-900 leading-tight">
                {g.primary}
              </p>
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-500">
                {g.secondary}
              </p>
            </motion.div>
          ))}
        </div>
      </motion.div>
    </section>
  );
}
