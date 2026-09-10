import { eq, asc } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { db } from "@/db/client";
import { products, schools, productSchool } from "@/db/schema";
import { ProductSchoolEditor } from "@/components/admin/ProductSchoolEditor";
import { requireAnyPermission, isResponse } from "@/server/admin-guard";

export default async function ProductSchoolsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const guard = await requireAnyPermission("catalog.read", "catalog.write");
  if (isResponse(guard)) redirect("/admin/dashboard");
  const { id } = await params;
  const [product] = await db
    .select()
    .from(products)
    .where(eq(products.id, id))
    .limit(1);
  if (!product) notFound();

  const [allSchools, assignments] = await Promise.all([
    db.select().from(schools).orderBy(asc(schools.name)),
    db.select().from(productSchool).where(eq(productSchool.productId, id)),
  ]);

  const byId = new Map(assignments.map((a) => [a.schoolId, a]));

  return (
    <div className="max-w-3xl">
      <a
        href={`/admin/products/${id}`}
        className="text-[13px] font-medium text-ink-500 hover:text-ink-900"
      >
        ← Product details
      </a>
      <h1 className="mt-3 font-display text-[28px] font-extrabold tracking-tight text-ink-900">
        {product.name} — schools
      </h1>
      <p className="mt-1 text-[13px] text-ink-500">
        Pick which schools sell this product. Per-school price/MRP override
        and the &quot;required&quot; flag are optional.
      </p>
      <div className="mt-6">
        <ProductSchoolEditor
          productId={id}
          basePriceRupees={Math.round(product.basePrice / 100)}
          schools={allSchools.map((s) => {
            const a = byId.get(s.id);
            return {
              id: s.id,
              name: s.name,
              slug: s.slug,
              status: s.status,
              assigned: !!a,
              overridePrice: a?.overridePrice
                ? Math.round(a.overridePrice / 100)
                : null,
              overrideMrp: a?.overrideMrp
                ? Math.round(a.overrideMrp / 100)
                : null,
              isRequired: a?.isRequired ?? false,
              customImageUrl: a?.customImageUrl ?? null,
            };
          })}
        />
      </div>
    </div>
  );
}
