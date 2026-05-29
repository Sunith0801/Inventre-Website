"use client";

import { useEffect, useState } from "react";
import { ShoppingBag } from "lucide-react";
import { Product } from "@/lib/products";
import { useCart } from "@/lib/cart";

export function StickyMobileBar({ product }: { product: Product }) {
  const { add } = useCart();
  const [show, setShow] = useState(false);

  useEffect(() => {
    const onScroll = () => setShow(window.scrollY > 600);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  if (!show) return null;

  return (
    <div className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-white border-t border-ink-100 px-4 py-3 flex items-center gap-3 shadow-[0_-10px_30px_-15px_rgba(0,0,0,0.15)]">
      <div className="h-12 w-12 rounded-lg bg-cream-100 border border-ink-100 overflow-hidden shrink-0">
        {product.img ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={product.img}
            alt=""
            className="h-full w-full object-contain p-1"
          />
        ) : null}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold text-ink-900 truncate">
          {product.name}
        </p>
        <p className="font-display text-[14px] font-bold text-ink-900">
          ₹{product.price.toLocaleString()}
        </p>
      </div>
      <button
        type="button"
        onClick={() => add(product, product.sizes[0])}
        className="inline-flex items-center gap-1.5 rounded-full bg-brand text-white px-4 h-10 text-[13px] font-bold hover:bg-brand-600 transition-colors"
      >
        <ShoppingBag className="h-3.5 w-3.5" /> Add
      </button>
    </div>
  );
}
