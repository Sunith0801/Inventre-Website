"use client";

import { useEffect, useState } from "react";
import { Product } from "@/lib/products";

const badgeStyles: Record<string, string> = {
  NEW: "bg-ink-900 text-white",
  BESTSELLER: "bg-brand text-white",
  "LOW STOCK": "bg-amber-500 text-white",
};

export function Gallery({ product }: { product: Product }) {
  const images =
    product.images && product.images.length > 0
      ? product.images.map((i) => i.url)
      : product.img
      ? [product.img]
      : [];
  const [active, setActive] = useState(0);

  // Reset to first image when product changes
  useEffect(() => setActive(0), [product.id]);

  return (
    <div className="flex items-start gap-3 lg:gap-5">
      {/* thumb column (only when multiple images) */}
      {images.length > 1 && (
        <div className="flex flex-col gap-3">
          {images.map((src, i) => (
            <button
              key={src + i}
              onClick={() => setActive(i)}
              aria-label={`Image ${i + 1}`}
              className={
                "relative w-16 h-16 lg:w-20 lg:h-20 rounded-lg overflow-hidden border transition-all " +
                (active === i
                  ? "border-ink-900 ring-2 ring-brand/30"
                  : "border-ink-200 hover:border-ink-400")
              }
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={src}
                alt=""
                className="absolute inset-0 h-full w-full object-contain p-1.5 bg-cream-100"
              />
            </button>
          ))}
        </div>
      )}

      {/* main image — frame shrinks to fit the image. No forced aspect:
          tall products (track pants) get a tall slim frame, wide products
          get a wide short frame. max-h caps the on-screen height so a
          full-bleed photo doesn't blow up the viewport. */}
      <div className="relative inline-block rounded-2xl bg-white border-2 border-ink-100 overflow-hidden group transition-colors duration-300 ease-out-expo hover:border-brand">
        {images[active] ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={images[active]}
            alt={product.name}
            className="block max-h-[360px] w-auto max-w-full object-contain transition-transform duration-700 ease-out-expo group-hover:scale-[1.03]"
          />
        ) : (
          <div className="grid h-[240px] w-[240px] place-items-center text-[12px] font-semibold uppercase tracking-wider text-ink-400">
            No image
          </div>
        )}

        {product.badge && (
          <span
            className={`absolute top-3 left-3 z-20 rounded-full px-3 py-1.5 text-[10px] font-bold tracking-[0.16em] uppercase ${badgeStyles[product.badge]}`}
          >
            {product.badge}
          </span>
        )}

        <span
          aria-hidden
          className="absolute top-3 right-3 z-20 inline-flex items-center gap-1.5 rounded-full bg-white/90 border border-ink-100 px-2.5 py-1 text-[10px] font-bold tracking-[0.14em] uppercase text-ink-700"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-brand" />
          Inventre Authentic
        </span>
      </div>
    </div>
  );
}
