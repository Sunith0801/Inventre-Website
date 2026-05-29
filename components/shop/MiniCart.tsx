"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ShoppingBag, ArrowRight } from "lucide-react";
import { useCart } from "@/lib/cart";

export function MiniCart() {
  const { count, total } = useCart();
  return (
    <AnimatePresence>
      {count > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 30, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 30, scale: 0.95 }}
          transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
          className="fixed bottom-5 right-5 z-40"
        >
          <a
            href="/shop/cart"
            className="group flex items-center gap-3 rounded-full bg-ink-900 text-white pl-2 pr-5 py-2 shadow-[0_20px_40px_-12px_rgba(0,0,0,0.4)] hover:bg-brand transition-colors"
          >
            <span className="relative grid h-9 w-9 place-items-center rounded-full bg-white/10">
              <ShoppingBag className="h-4 w-4" />
              <span className="absolute -top-0.5 -right-0.5 grid h-4 min-w-4 px-1 place-items-center rounded-full bg-brand text-white text-[10px] font-bold">
                {count}
              </span>
            </span>
            <span className="flex flex-col items-start leading-tight">
              <span className="text-[10px] uppercase tracking-wider opacity-70">
                Cart
              </span>
              <span className="font-display text-[14px] font-bold">
                ₹{total.toLocaleString()}
              </span>
            </span>
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </a>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
