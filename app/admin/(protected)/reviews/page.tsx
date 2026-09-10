import { desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { reviews, products, parents } from "@/db/schema";
import { ReviewModerationActions } from "@/components/admin/ReviewModerationActions";
import { redirect } from "next/navigation";
import { requireAnyPermission, isResponse } from "@/server/admin-guard";

export default async function AdminReviewsPage() {
  const guard = await requireAnyPermission("reviews.read", "reviews.write");
  if (isResponse(guard)) redirect("/admin/dashboard");

  const rows = await db
    .select({
      review: reviews,
      product: products,
      parent: parents,
    })
    .from(reviews)
    .leftJoin(products, eq(products.id, reviews.productId))
    .leftJoin(parents, eq(parents.id, reviews.parentId))
    .orderBy(desc(reviews.createdAt));

  return (
    <div>
      <h1 className="font-display text-[28px] font-extrabold tracking-tight text-ink-900">
        Reviews
      </h1>
      <p className="mt-1 text-[14px] text-ink-500">
        {rows.length} reviews · approve before they appear on the PDP.
      </p>

      <div className="mt-6 space-y-3">
        {rows.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-ink-200 bg-white py-10 text-center text-[13px] text-ink-500">
            No reviews submitted yet.
          </div>
        ) : (
          rows.map(({ review, product, parent }) => (
            <article
              key={review.id}
              className="rounded-2xl border border-ink-100 bg-white p-5"
            >
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-ink-900">
                      {parent?.name ?? parent?.phone ?? "—"}
                    </span>
                    <span className="text-[12px] text-ink-500">
                      → {product?.name ?? "—"}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-[11px] text-ink-500">
                    <span>{"★".repeat(review.rating)}</span>
                    <span>·</span>
                    <span>
                      {new Date(review.createdAt).toLocaleDateString("en-IN", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </span>
                    <span>·</span>
                    <span
                      className={
                        "rounded-full px-2 py-0.5 font-bold tracking-wider uppercase " +
                        (review.status === "approved"
                          ? "bg-emerald-50 text-emerald-700"
                          : review.status === "rejected"
                            ? "bg-red-50 text-red-700"
                            : "bg-amber-50 text-amber-700")
                      }
                    >
                      {review.status}
                    </span>
                  </div>
                </div>
                <ReviewModerationActions
                  reviewId={review.id}
                  status={review.status}
                />
              </div>
              <p className="mt-3 text-[14px] leading-relaxed text-ink-700">
                {review.body}
              </p>
            </article>
          ))
        )}
      </div>
    </div>
  );
}
