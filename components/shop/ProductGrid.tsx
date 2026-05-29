"use client";

import { Product } from "@/lib/products";
import { ProductCard } from "./ProductCard";
import { PackageX } from "lucide-react";

export function ProductGrid({
  products,
  onClear,
}: {
  products: Product[];
  onClear: () => void;
}) {
  if (products.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-ink-200 bg-white p-12 text-center">
        <div className="mx-auto h-12 w-12 rounded-full bg-cream-100 grid place-items-center text-ink-500">
          <PackageX className="h-5 w-5" />
        </div>
        <h3 className="mt-4 font-display text-[18px] font-bold text-ink-900">
          Nothing matches those filters.
        </h3>
        <p className="mt-1 text-[14px] text-ink-500">
          Try widening the size, price or category.
        </p>
        <button
          onClick={onClear}
          className="mt-5 inline-flex items-center justify-center rounded-full bg-ink-900 text-white px-5 py-2.5 text-[13px] font-semibold hover:bg-brand transition-colors"
        >
          Reset filters
        </button>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 lg:gap-5">
      {products.map((p) => (
        <ProductCard key={p.id} p={p} />
      ))}
    </div>
  );
}
