"use client";

import { motion } from "framer-motion";
import { Sparkles } from "lucide-react";
import { Product } from "@/lib/products";

export function CompleteTheKit({ items }: { items: Product[] }) {
  if (items.length === 0) return null;
  return (
    <section className="border-t border-ink-100 bg-cream-200">
      <div className="mx-auto max-w-7xl px-5 lg:px-8 py-14 lg:py-20">
        <div className="flex items-end justify-between gap-4 mb-8">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-brand-50 border border-brand-100 px-3 py-1.5">
              <Sparkles className="h-3.5 w-3.5 text-brand" />
              <span className="font-display text-[12px] font-semibold tracking-[0.18em] uppercase text-brand-700">
                Complete the kit
              </span>
            </div>
            <h2 className="mt-3 font-display text-[24px] sm:text-[30px] font-extrabold tracking-tight text-ink-900 leading-tight">
              Required by your school but not in your cart yet.
            </h2>
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-5">
          {items.slice(0, 4).map((p, i) => (
            <motion.a
              key={p.id}
              href="#"
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-40px" }}
              transition={{ duration: 0.4, delay: i * 0.06 }}
              className="group flex flex-col rounded-2xl border border-ink-100 bg-white overflow-hidden hover:border-brand transition-colors"
            >
              <div className="relative aspect-square bg-cream-100">
                {p.img ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={p.img}
                    alt={p.name}
                    loading="lazy"
                    className="absolute inset-0 h-full w-full object-contain p-5 transition-transform duration-500 ease-out-expo group-hover:scale-105"
                  />
                ) : null}
                <span className="absolute top-3 left-3 rounded-full bg-brand text-white px-2 py-0.5 text-[10px] font-bold tracking-wider uppercase">
                  Required
                </span>
              </div>
              <div className="p-3.5">
                <p className="text-[13px] font-semibold text-ink-900 truncate">
                  {p.name}
                </p>
                <p className="mt-0.5 font-display text-[15px] font-bold text-ink-900">
                  ₹{p.price.toLocaleString()}
                </p>
              </div>
            </motion.a>
          ))}
        </div>
      </div>
    </section>
  );
}
