"use client";

import { motion } from "framer-motion";
import { Users, School, Building2, Phone, Mail } from "lucide-react";

const channels = [
  {
    kind: "parent",
    icon: Users,
    label: "Parents",
    image: "https://pub-d46aef8f98ef4da0a1834fb6f554ae2c.r2.dev/images/parent.png",
    helper: "For order, sizing, returns and delivery questions.",
    phone: "+91 90599 90804",
    email: "support@inventre.in",
  },
  {
    kind: "school",
    icon: School,
    label: "Schools",
    image: "https://pub-d46aef8f98ef4da0a1834fb6f554ae2c.r2.dev/images/school.png",
    helper: "Partnership, onboarding and brand consultations.",
    phone: "+91 81212 58383",
    email: "connect@inventre.in",
  },
  {
    kind: "business",
    icon: Building2,
    label: "Business",
    image: "https://pub-d46aef8f98ef4da0a1834fb6f554ae2c.r2.dev/images/business.png",
    helper: "Wholesale, distributor and B2B inquiries.",
    phone: "+91 81212 58383",
    email: "connect@inventre.in",
  },
];

export function ContactChannels() {
  return (
    <section className="mx-auto max-w-7xl px-5 lg:px-8 py-12 lg:py-16">
      <div className="grid md:grid-cols-3 gap-4 lg:gap-5">
        {channels.map((c, i) => (
          <motion.a
            key={c.kind}
            href={`#contact-form?kind=${c.kind}`}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.5, delay: i * 0.08 }}
            className="group relative rounded-2xl border border-ink-100 bg-white overflow-hidden hover:border-brand hover:shadow-[0_20px_40px_-22px_rgba(228,113,39,0.25)] transition-all"
          >
            <div className="relative aspect-[5/3] bg-cream-100 overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={c.image}
                alt={c.label}
                className="absolute inset-0 h-full w-full object-contain p-6 transition-transform duration-500 ease-out-expo group-hover:scale-105"
              />
              <span className="absolute top-4 left-4 grid h-10 w-10 place-items-center rounded-full bg-brand text-white">
                <c.icon className="h-4 w-4" />
              </span>
            </div>
            <div className="p-6">
              <p className="font-display text-[11px] font-semibold tracking-[0.18em] uppercase text-brand-700">
                For {c.label.toLowerCase()}
              </p>
              <h3 className="mt-1 font-display text-[24px] font-extrabold text-ink-900">
                {c.label}
              </h3>
              <p className="mt-2 text-[13px] leading-relaxed text-ink-600">
                {c.helper}
              </p>
              <div className="mt-5 pt-4 border-t border-ink-100 space-y-2 text-[13px]">
                <a
                  href={`tel:${c.phone.replace(/\s/g, "")}`}
                  onClick={(e) => e.stopPropagation()}
                  className="flex items-center gap-2 text-ink-800 hover:text-brand"
                >
                  <Phone className="h-3.5 w-3.5 text-ink-400" />
                  <span className="font-mono">{c.phone}</span>
                </a>
                <a
                  href={`mailto:${c.email}`}
                  onClick={(e) => e.stopPropagation()}
                  className="flex items-center gap-2 text-ink-800 hover:text-brand"
                >
                  <Mail className="h-3.5 w-3.5 text-ink-400" />
                  <span>{c.email}</span>
                </a>
              </div>
            </div>
          </motion.a>
        ))}
      </div>
    </section>
  );
}
