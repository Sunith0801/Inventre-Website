"use client";

import { motion } from "framer-motion";
import { Product } from "@/lib/products";

export function RelatedProducts({
  current,
  all,
}: {
  current: Product;
  all: Product[];
}) {
  const related = all.filter((p) => p.id !== current.id).slice(0, 3);
  return (
    <section className="mt-16 lg:mt-24">
      <div className="flex items-end justify-between mb-6">
        <h3 className="font-display text-[20px] sm:text-[24px] font-extrabold tracking-tight text-ink-900">
          Often added with{" "}
          <span className="text-brand">{current.name}</span>
        </h3>
        <a
          href="/shop"
          className="hidden sm:inline-block text-[13px] font-medium text-ink-700 hover:text-brand"
        >
          Browse all →
        </a>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 lg:gap-5">
        {related.map((p, i) => (
          <motion.a
            key={p.id}
            href={`/shop/${p.slug ?? p.id}`}
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
                  className="absolute inset-0 h-full w-full object-contain p-6 transition-transform duration-500 ease-out-expo group-hover:scale-105"
                />
              ) : null}
            </div>
            <div className="p-4">
              <p className="text-[14px] font-semibold text-ink-900 truncate">
                {p.name}
              </p>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="font-display text-[16px] font-bold text-ink-900">
                  ₹{p.price.toLocaleString()}
                </span>
                {p.mrp && (
                  <span className="text-[12px] line-through text-ink-400">
                    ₹{p.mrp.toLocaleString()}
                  </span>
                )}
              </div>
            </div>
          </motion.a>
        ))}
      </div>
    </section>
  );
}
