"use client";

import { Star, BadgeCheck, MessageSquare } from "lucide-react";
import { Product } from "@/lib/products";
import { ReviewForm } from "./ReviewForm";

export function Reviews({ product }: { product: Product }) {
  const hasRating = !!product.rating && product.rating.count > 0;
  const score = product.rating?.score ?? 0;
  const count = product.rating?.count ?? 0;
  const distribution = product.rating?.distribution ?? [0, 0, 0, 0, 0];
  const max = Math.max(...distribution, 1);

  return (
    <section id="reviews" className="mt-16 lg:mt-24 scroll-mt-28">
      <div className="flex items-end justify-between mb-6">
        <h2 className="font-display text-[20px] sm:text-[24px] font-extrabold tracking-tight text-ink-900">
          Reviews
        </h2>
        <ReviewForm productId={product.id} />
      </div>

      {!hasRating ? (
        <div className="rounded-2xl border border-dashed border-ink-200 bg-white py-10 text-center">
          <div className="mx-auto h-10 w-10 rounded-full bg-cream-100 grid place-items-center text-ink-500">
            <MessageSquare className="h-4 w-4" />
          </div>
          <p className="mt-3 font-display text-[15px] font-bold text-ink-900">
            No reviews yet
          </p>
          <p className="mt-1 text-[13px] text-ink-500">
            Be the first parent to share what you think.
          </p>
        </div>
      ) : (
        <div className="grid lg:grid-cols-[280px_1fr] gap-10">
          <div className="rounded-2xl border border-ink-100 bg-white p-6">
            <div className="flex items-baseline gap-2">
              <span className="font-display text-[44px] font-extrabold leading-none text-ink-900">
                {score.toFixed(1)}
              </span>
              <span className="text-[14px] text-ink-500">/ 5</span>
            </div>
            <div className="mt-1 flex items-center gap-1">
              {Array.from({ length: 5 }).map((_, i) => (
                <Star
                  key={i}
                  className={`h-4 w-4 ${i < Math.round(score) ? "fill-brand text-brand" : "text-ink-200"}`}
                />
              ))}
            </div>
            <p className="mt-1 text-[13px] text-ink-500">
              Based on {count} verified reviews
            </p>

            <ul className="mt-5 space-y-2">
              {distribution.map((n, i) => {
                const star = 5 - i;
                const pct = max > 0 ? (n / max) * 100 : 0;
                return (
                  <li key={star} className="flex items-center gap-2 text-[12px]">
                    <span className="w-3 text-ink-700 font-medium">{star}</span>
                    <Star className="h-3 w-3 fill-ink-300 text-ink-300" />
                    <div className="flex-1 h-1.5 rounded-full bg-ink-100 overflow-hidden">
                      <div
                        className="h-full bg-brand rounded-full"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="w-7 text-right tabular-nums text-ink-500">
                      {n}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>

          <div>
            <h3 className="font-display text-[18px] font-extrabold text-ink-900 mb-4">
              What parents say
            </h3>
            {product.reviews && product.reviews.length > 0 ? (
              <ul className="space-y-4">
                {product.reviews.map((r) => (
                  <li
                    key={r.name + r.date}
                    className="rounded-2xl border border-ink-100 bg-white p-5"
                  >
                    <div className="flex items-center justify-between gap-4 flex-wrap">
                      <div className="flex items-center gap-3">
                        <div className="grid h-10 w-10 place-items-center rounded-full bg-brand-50 text-brand font-display font-bold text-[13px]">
                          {r.name
                            .split(" ")
                            .map((p) => p[0])
                            .slice(0, 2)
                            .join("")}
                        </div>
                        <div>
                          <p className="text-[14px] font-semibold text-ink-900 inline-flex items-center gap-1.5">
                            {r.name}
                            {r.verified && (
                              <BadgeCheck className="h-3.5 w-3.5 text-brand fill-brand-50" />
                            )}
                          </p>
                          <p className="text-[12px] text-ink-500">
                            {r.school} · {r.date}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-0.5">
                        {Array.from({ length: 5 }).map((_, i) => (
                          <Star
                            key={i}
                            className={`h-3.5 w-3.5 ${i < r.rating ? "fill-brand text-brand" : "text-ink-200"}`}
                          />
                        ))}
                      </div>
                    </div>
                    <p className="mt-4 text-[14.5px] leading-relaxed text-ink-700">
                      &quot;{r.body}&quot;
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[13px] text-ink-500">
                Reviews loading or only summary available.
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
