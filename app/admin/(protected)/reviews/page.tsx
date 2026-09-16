import Link from "next/link";
import { desc, eq, sql, and, ilike, or, type SQL } from "drizzle-orm";
import { Star, MessageSquare } from "lucide-react";
import { db } from "@/db/client";
import { reviews, products, parents } from "@/db/schema";
import { ReviewModerationActions } from "@/components/admin/ReviewModerationActions";
import { redirect } from "next/navigation";
import { requireAnyPermission, isResponse } from "@/server/admin-guard";
import {
  PageHeader, Card, Th, Td, Tr, Badge, EmptyState, Stat, Toolbar, SearchInput, FilterSelect,
} from "@/components/admin/ui/primitives";
import { Pagination, PerPagePicker } from "@/components/admin/ui/pagination";
import { AutoSubmitForm } from "@/components/admin/AutoSubmitForm";
import { DEFAULT_PER_PAGE, PER_PAGE_OPTIONS, pageMeta, readPaging, withPaging } from "@/lib/admin-paging";

export const dynamic = "force-dynamic";

const BASE = "/admin/reviews";
const STATUSES = ["pending", "approved", "rejected"] as const;
type Status = (typeof STATUSES)[number];
const STATUS_TONE: Record<Status, "warning" | "success" | "danger"> = { pending: "warning", approved: "success", rejected: "danger" };
const IST = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" });

function Stars({ n }: { n: number }) {
  return (
    <span className="inline-flex items-center gap-0.5 text-amber-500" aria-label={`${n} out of 5`}>
      {Array.from({ length: 5 }, (_, i) => (
        <Star key={i} className={`h-3.5 w-3.5 ${i < n ? "fill-current" : "text-ink-200"}`} />
      ))}
    </span>
  );
}

/**
 * Product reviews written by parents on the storefront. Pending ones are
 * hidden from the shop until approved here.
 */
export default async function AdminReviewsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; rating?: string; page?: string; perPage?: string }>;
}) {
  const guard = await requireAnyPermission("reviews.read", "reviews.write");
  if (isResponse(guard)) redirect("/admin/dashboard");

  const sp = await searchParams;
  const term = (sp.q ?? "").trim();
  const status = (STATUSES as readonly string[]).includes(sp.status ?? "") ? (sp.status as Status) : "";
  const rating = /^[1-5]$/.test(sp.rating ?? "") ? Number(sp.rating) : 0;
  const paging = readPaging(sp);

  const conds: SQL[] = [];
  if (term) conds.push(or(ilike(products.name, `%${term}%`), ilike(parents.name, `%${term}%`), ilike(parents.phone, `%${term}%`), ilike(reviews.body, `%${term}%`))!);
  if (status) conds.push(eq(reviews.status, status));
  if (rating) conds.push(eq(reviews.rating, rating));
  const where = conds.length ? and(...conds) : undefined;

  const base = db
    .select({ review: reviews, product: products, parent: parents })
    .from(reviews)
    .leftJoin(products, eq(products.id, reviews.productId))
    .leftJoin(parents, eq(parents.id, reviews.parentId));

  const [rows, totalRows, byStatus] = await Promise.all([
    base.where(where).orderBy(desc(reviews.createdAt)).limit(paging.perPage).offset(paging.offset),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(reviews)
      .leftJoin(products, eq(products.id, reviews.productId))
      .leftJoin(parents, eq(parents.id, reviews.parentId))
      .where(where),
    db.select({ status: reviews.status, n: sql<number>`count(*)::int` }).from(reviews).groupBy(reviews.status),
  ]);
  const total = Number(totalRows[0]?.n ?? 0);
  const counts = Object.fromEntries(byStatus.map((r) => [r.status, Number(r.n)])) as Record<string, number>;
  const allCount = byStatus.reduce((s, r) => s + Number(r.n), 0);

  const hrefWith = (over: Record<string, string> = {}) => {
    const u = new URLSearchParams();
    const b: Record<string, string> = { q: term, status, rating: rating ? String(rating) : "", ...over };
    for (const [k, v] of Object.entries(b)) if (v) u.set(k, v);
    const qs = u.toString();
    return qs ? `${BASE}?${qs}` : BASE;
  };
  const { pages, from, to } = pageMeta(total, paging);
  if (paging.page > pages) redirect(withPaging(hrefWith(), pages, paging.perPage));
  const hasFilter = !!(term || status || rating);

  return (
    <div>
      <PageHeader
        eyebrow="Engagement & Content"
        title="Product Reviews"
        description="Reviews parents leave on products. Only approved reviews show on the shop."
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Link href={hrefWith({ status: "" })} className={`block rounded-2xl ${!status ? "ring-2 ring-brand/40" : ""}`}>
          <Stat label="All reviews" value={allCount.toLocaleString("en-IN")} />
        </Link>
        {STATUSES.map((s) => (
          <Link key={s} href={hrefWith({ status: s })} className={`block rounded-2xl ${status === s ? "ring-2 ring-brand/40" : ""}`}>
            <Stat label={s === "pending" ? "Awaiting approval" : s === "approved" ? "Approved" : "Rejected"} value={(counts[s] ?? 0).toLocaleString("en-IN")} />
          </Link>
        ))}
      </div>

      <AutoSubmitForm action={BASE}>
        <Toolbar>
          <SearchInput defaultValue={term} placeholder="Search product, customer or review text…" />
          <FilterSelect label="Status" name="status" defaultValue={status}>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </FilterSelect>
          <FilterSelect label="Rating" name="rating" defaultValue={rating ? String(rating) : ""}>
            {[5, 4, 3, 2, 1].map((n) => (
              <option key={n} value={n}>{n} star{n === 1 ? "" : "s"}</option>
            ))}
          </FilterSelect>
          {paging.perPage !== DEFAULT_PER_PAGE ? <input type="hidden" name="perPage" value={paging.perPage} /> : null}
          {hasFilter ? <Link href={BASE} className="text-[12.5px] text-ink-500 hover:text-ink-900">Clear</Link> : null}
        </Toolbar>
      </AutoSubmitForm>

      <Card padded={false} className="overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState icon={MessageSquare} title={hasFilter ? "No reviews match" : "No reviews yet"} description={hasFilter ? "Try a different search or clear the filters." : "Reviews parents write on the shop appear here for approval."} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <Th>Customer</Th>
                  <Th>Product</Th>
                  <Th>Rating</Th>
                  <Th>Review</Th>
                  <Th>Date</Th>
                  <Th>Status</Th>
                  <Th right><span className="sr-only">Actions</span></Th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ review, product, parent }) => (
                  <Tr key={review.id}>
                    <Td>
                      {parent ? (
                        <Link href={`/admin/customers/${parent.id}`} className="group/name block">
                          <span className="block font-semibold text-ink-900 group-hover/name:text-brand-700">{parent.name?.trim() || parent.phone}</span>
                          {parent.name?.trim() ? <span className="block font-mono text-[12px] font-normal text-ink-500">{parent.phone}</span> : null}
                        </Link>
                      ) : (
                        <span className="text-ink-300">—</span>
                      )}
                    </Td>
                    <Td muted>
                      {product ? (
                        <Link href={`/admin/products/${product.id}`} className="text-ink-800 hover:text-brand-700">{product.name}</Link>
                      ) : "—"}
                    </Td>
                    <Td><Stars n={review.rating} /></Td>
                    <Td muted>
                      <p className="line-clamp-3 max-w-[420px] text-ink-700" title={review.body}>{review.body}</p>
                    </Td>
                    <Td muted className="whitespace-nowrap">{IST.format(new Date(review.createdAt))}</Td>
                    <Td><Badge tone={STATUS_TONE[review.status as Status] ?? "default"} dot size="sm" className="capitalize">{review.status}</Badge></Td>
                    <Td right>
                      <ReviewModerationActions reviewId={review.id} status={review.status} />
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {total > 0 ? (
          <Pagination page={paging.page} pages={pages} from={from} to={to} total={total} noun="review" hrefFor={(p) => withPaging(hrefWith(), p, paging.perPage)}>
            <PerPagePicker value={paging.perPage} options={PER_PAGE_OPTIONS} hrefFor={(pp) => withPaging(hrefWith(), 1, pp)} />
          </Pagination>
        ) : null}
      </Card>
    </div>
  );
}
