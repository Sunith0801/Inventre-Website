"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Heart, Plus, Check } from "lucide-react";
import { Product } from "@/lib/products";
import { useCart } from "@/lib/cart";

const badgeStyles: Record<string, string> = {
  NEW: "bg-ink-900 text-white",
  BESTSELLER: "bg-brand text-white",
  "LOW STOCK": "bg-amber-500 text-white",
};

export function ProductCard({ p }: { p: Product }) {
  const { add } = useCart();
  const searchParams = useSearchParams();
  const studentId = searchParams?.get("studentId") ?? "";
  const studentQuery = studentId
    ? `?studentId=${encodeURIComponent(studentId)}`
    : "";
  const [size, setSize] = useState<string>((p.isKit && p.hasLangOptions) ? "" : (p.sizes[0] ?? ""));
  const [liked, setLiked] = useState(false);
  const [added, setAdded] = useState(false);

  const handleAdd = (e: React.MouseEvent) => {
    // Always stop the click from bubbling to the card's anchor — otherwise
    // adding from the shop grid silently navigates to the PDP and the
    // selected size never lands in the cart.
    e.preventDefault();
    e.stopPropagation();
    if (p.isMagicBox || (p.isKit && p.hasLangOptions)) {
      // Magic boxes and kits with language options require the PDP.
      window.location.href = `/shop/${p.slug ?? p.id}${studentQuery}`;
      return;
    }
    if (!p.inStock) return;
    add(p, size);
    setAdded(true);
    setTimeout(() => setAdded(false), 1400);
  };

  const stop = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <motion.a
      href={`/shop/${p.slug ?? p.id}${studentQuery}`}
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      className="group relative flex flex-col rounded-2xl border border-ink-100 bg-white overflow-hidden hover:border-ink-200 hover:shadow-[0_20px_40px_-22px_rgba(0,0,0,0.18)] transition-all"
    >
      {/* image */}
      <div className="relative aspect-square bg-cream-100 overflow-hidden">
        {p.img ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={p.img}
            alt={p.name}
            loading="lazy"
            className="absolute inset-0 h-full w-full object-contain p-6 transition-transform duration-500 ease-out-expo group-hover:scale-105"
          />
        ) : (
          <div className="absolute inset-0 grid place-items-center text-[11px] font-semibold uppercase tracking-wider text-ink-400">
            No image
          </div>
        )}

        {p.badge && (
          <span
            className={`absolute top-3 left-3 rounded-full px-2.5 py-1 text-[10px] font-bold tracking-wider uppercase ${badgeStyles[p.badge]}`}
          >
            {p.badge}
          </span>
        )}

        <button
          type="button"
          aria-label={liked ? "Remove from wishlist" : "Add to wishlist"}
          onClick={(e) => {
            e.preventDefault();
            stop(e);
            setLiked(!liked);
          }}
          className="absolute top-3 right-3 grid h-9 w-9 place-items-center rounded-full bg-white/85 backdrop-blur border border-ink-100 text-ink-700 hover:text-brand transition-colors"
        >
          <Heart
            className={`h-4 w-4 transition-all ${liked ? "fill-brand text-brand" : ""}`}
          />
        </button>

        {!p.inStock && (
          <div className="absolute inset-0 bg-cream-100/70 backdrop-blur-[2px] grid place-items-center">
            <span className="rounded-full border border-ink-300 bg-white px-3 py-1 text-[11px] font-semibold tracking-wider uppercase text-ink-700">
              Out of stock
            </span>
          </div>
        )}

        <div className="absolute bottom-0 inset-x-0 p-3 translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out-expo">
          <button
            type="button"
            onClick={handleAdd}
            disabled={!p.isMagicBox && !(p.isKit && p.hasLangOptions) && !p.inStock}
            className="w-full inline-flex items-center justify-center gap-1.5 rounded-full bg-ink-900 text-white px-4 py-2.5 text-[13px] font-semibold hover:bg-brand transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <AnimatePresence mode="wait">
              {p.isMagicBox ? (
                <motion.span
                  key="select"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  className="inline-flex items-center gap-1.5"
                >
                  <Plus className="h-3.5 w-3.5" /> Select Sizes
                </motion.span>
              ) : p.isKit && p.hasLangOptions ? (
                <motion.span
                  key="kit"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  className="inline-flex items-center gap-1.5"
                >
                  <Plus className="h-3.5 w-3.5" /> Choose options
                </motion.span>
              ) : added ? (
                <motion.span
                  key="added"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  className="inline-flex items-center gap-1.5"
                >
                  <Check className="h-3.5 w-3.5" /> Added
                </motion.span>
              ) : (
                <motion.span
                  key="add"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  className="inline-flex items-center gap-1.5"
                >
                  <Plus className="h-3.5 w-3.5" /> Add to cart
                </motion.span>
              )}
            </AnimatePresence>
          </button>
        </div>
      </div>

      {/* meta */}
      <div className="p-4 flex flex-col gap-2.5">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="font-display text-[15px] font-semibold text-ink-900 leading-tight">
            {p.name}
          </h3>
          {p.required && (
            <span className="shrink-0 text-[10px] font-bold tracking-wider uppercase text-brand">
              Required
            </span>
          )}
        </div>

        {/* size pills — hidden for kits that have language options */}
        {!(p.isKit && p.hasLangOptions) && (
          <SizePills
            sizes={p.sizes}
            selected={size}
            onSelect={setSize}
            stop={stop}
          />
        )}

        {/* price */}
        <div className="flex items-baseline gap-2 pt-1">
          <span className="font-display text-[18px] font-bold text-ink-900">
            ₹{p.price.toLocaleString()}
          </span>
          {p.mrp && (
            <>
              <span className="text-[13px] line-through text-ink-400">
                ₹{p.mrp.toLocaleString()}
              </span>
              <span className="text-[11px] font-bold text-brand">
                {Math.round((1 - p.price / p.mrp) * 100)}% OFF
              </span>
            </>
          )}
        </div>
      </div>
    </motion.a>
  );
}

function SizePills({
  sizes,
  selected,
  onSelect,
  stop,
}: {
  sizes: string[];
  selected: string;
  onSelect: (s: string) => void;
  stop: (e: React.MouseEvent) => void;
}) {
  // Dedupe size labels — multiple variants can share a label (e.g. different
  // language editions at size "24"), which would otherwise produce duplicate
  // React keys and visibly duplicated pills.
  const uniqueSizes = Array.from(new Set(sizes));
  // Cap the card to a few size pills so dense catalogs (40+ sizes per shoe,
  // 60+ sizes per polo) don't crush the layout. Always include the selected
  // size in the visible set, and surface the rest behind a "+N more" pill
  // that takes the parent to the PDP. The PDP itself shows every size.
  const CAP = 4;
  const head = uniqueSizes.slice(0, CAP);
  const visible = head.includes(selected) || !selected
    ? head
    : [...head.slice(0, CAP - 1), selected];
  const overflowCount = uniqueSizes.length - visible.length;

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {visible.map((s) => {
        const active = s === selected;
        return (
          <button
            key={s}
            type="button"
            onClick={(e) => {
              e.preventDefault();
              stop(e);
              onSelect(s);
            }}
            className={
              "h-7 min-w-7 px-2 rounded-md border text-[11px] font-semibold transition-all shrink-0 " +
              (active
                ? "border-ink-900 bg-ink-900 text-white"
                : "border-ink-200 text-ink-700 hover:border-ink-900")
            }
          >
            {s}
          </button>
        );
      })}
      {overflowCount > 0 && (
        <span
          aria-label={`${overflowCount} more sizes — open product for full list`}
          className="h-7 px-2 inline-flex items-center rounded-md border border-dashed border-ink-300 bg-cream-50 text-[11px] font-semibold text-ink-500"
        >
          +{overflowCount}
        </span>
      )}
    </div>
  );
}
