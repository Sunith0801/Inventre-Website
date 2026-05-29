import { notFound } from "next/navigation";
import { db } from "@/db/client";
import {
  productBundles,
  bundleComponents,
  bundleSelectors,
  products,
  productVariants,
} from "@/db/schema";
import { eq, asc } from "drizzle-orm";
import { PageHeader, Card, Badge, Money } from "@/components/admin/ui/primitives";
import { BundleEditor } from "@/components/admin/BundleEditor";

export const dynamic = "force-dynamic";

export default async function BundleDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [row] = await db
    .select({
      bundle: productBundles,
      product: products,
    })
    .from(productBundles)
    .innerJoin(products, eq(products.id, productBundles.productId))
    .where(eq(productBundles.id, id))
    .limit(1);
  if (!row) notFound();

  const [comps, sels, allProducts, allVariants] = await Promise.all([
    db
      .select()
      .from(bundleComponents)
      .where(eq(bundleComponents.bundleId, id)),
    db
      .select()
      .from(bundleSelectors)
      .where(eq(bundleSelectors.bundleId, id))
      .orderBy(asc(bundleSelectors.sortOrder)),
    db
      .select({ id: products.id, name: products.name, itemCode: products.itemCode })
      .from(products)
      .orderBy(asc(products.name)),
    db
      .select({
        id: productVariants.id,
        size: productVariants.size,
        sku: productVariants.sku,
        productId: productVariants.productId,
      })
      .from(productVariants)
      .orderBy(asc(productVariants.size)),
  ]);

  return (
    <div className="max-w-5xl">
      <PageHeader
        breadcrumb={[
          { label: "Catalog", href: "/admin/catalog/bundles" },
          { label: "Bundles", href: "/admin/catalog/bundles" },
          { label: row.product.name },
        ]}
        title={row.product.name}
        eyebrow="Bundle"
        description={
          <span className="flex items-center gap-2 flex-wrap">
            <Badge tone={row.bundle.bundleType === "configurable" ? "violet" : "info"} size="sm">
              {row.bundle.bundleType}
            </Badge>
            <Badge tone="subtle" size="sm">
              {row.bundle.pricingMode === "sum" ? "Sum of components" : "Fixed price"}
            </Badge>
            {row.bundle.fixedPrice != null ? (
              <span className="text-ink-700">
                <Money paise={row.bundle.fixedPrice} className="font-semibold" />
              </span>
            ) : null}
          </span>
        }
      />
      <Card>
        <BundleEditor
          bundleId={row.bundle.id}
          bundleType={row.bundle.bundleType}
          initialComponents={comps.map((c) => ({
            id: c.id,
            variantId: c.variantId,
            productId: c.productId,
            qty: c.qty,
            selectorGroupKey: c.selectorGroupKey,
            selectorOptionLabel: c.selectorOptionLabel,
            isOptional: c.isOptional,
            isVisible: c.isVisible,
          }))}
          initialSelectors={sels.map((s) => ({
            id: s.id,
            groupKey: s.groupKey,
            name: s.name,
            selectorType: s.selectorType,
            isRequired: s.isRequired,
            minSelections: s.minSelections,
            maxSelections: s.maxSelections,
            sortOrder: s.sortOrder,
          }))}
          products={allProducts}
          variants={allVariants}
        />
      </Card>
    </div>
  );
}
