import { eq, asc } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { db } from "@/db/client";
import { products, schools, productSchool } from "@/db/schema";
import { ProductSchoolEditor } from "@/components/admin/ProductSchoolEditor";
import { requireAnyPermission, isResponse } from "@/server/admin-guard";
import { PageHeader, Button, Money } from "@/components/admin/ui/primitives";

export const dynamic = "force-dynamic";

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
    db
      .select({
        id: schools.id,
        name: schools.name,
        slug: schools.slug,
        city: schools.city,
        status: schools.status,
        logoUrl: schools.logoUrl,
        schoolLogoUrl: schools.schoolLogoUrl,
      })
      .from(schools)
      .orderBy(asc(schools.name)),
    db.select().from(productSchool).where(eq(productSchool.productId, id)),
  ]);

  const byId = new Map(assignments.map((a) => [a.schoolId, a]));
  const assigned = assignments.length;

  return (
    <div className="max-w-5xl">
      <PageHeader
        eyebrow="Products"
        title="School pricing"
        breadcrumb={[
          { label: "Products", href: "/admin/products" },
          { label: product.name, href: `/admin/products/${id}` },
          { label: "Schools" },
        ]}
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-medium text-ink-800">{product.name}</span>
            <span>
              Base <Money paise={product.basePrice} className="font-semibold text-ink-900" />
              {product.baseMrp != null ? (
                <>
                  {" "}· MRP <Money paise={product.baseMrp} className="text-ink-700" />
                </>
              ) : null}
            </span>
            <span>
              Visible at{" "}
              <b className="font-semibold text-ink-900 tabular-nums">{assigned}</b> of{" "}
              {allSchools.length} school{allSchools.length === 1 ? "" : "s"}
            </span>
          </span>
        }
        actions={
          <Link href={`/admin/products/${id}`}>
            <Button variant="secondary" size="sm" icon={<ArrowLeft className="h-3.5 w-3.5" />}>
              Back to product
            </Button>
          </Link>
        }
      />
      <p className="mb-4 -mt-3 text-[12.5px] text-ink-500 max-w-2xl">
        Tick a school to list this product on its storefront. Leave price and MRP blank to sell at
        the base figures; enter a value to override them for that school only. Variant-level
        item prices, where set, still take precedence.
      </p>
      <ProductSchoolEditor
        productId={id}
        basePriceRupees={Math.round(product.basePrice / 100)}
        baseMrpRupees={product.baseMrp != null ? Math.round(product.baseMrp / 100) : null}
        schools={allSchools.map((s) => {
          const a = byId.get(s.id);
          return {
            id: s.id,
            name: s.name,
            slug: s.slug,
            city: s.city ?? null,
            status: s.status,
            logoUrl: s.schoolLogoUrl ?? s.logoUrl ?? null,
            assigned: !!a,
            overridePrice: a?.overridePrice != null ? Math.round(a.overridePrice / 100) : null,
            overrideMrp: a?.overrideMrp != null ? Math.round(a.overrideMrp / 100) : null,
            isRequired: a?.isRequired ?? false,
            customImageUrl: a?.customImageUrl ?? null,
          };
        })}
      />
    </div>
  );
}
