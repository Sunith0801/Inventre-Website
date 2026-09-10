import { and, eq, asc, desc, inArray } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { db } from "@/db/client";
import {
  products,
  productVariants,
  productVariantAttributes,
  productAttributes,
  productAttributeValues,
  itemPrices,
} from "@/db/schema";
import { PageHeader, Button } from "@/components/admin/ui/primitives";
import { ArrowLeft } from "lucide-react";
import { ProductVariantsEditor } from "@/components/admin/ProductVariantsEditor";
import { requireAnyPermission, isResponse } from "@/server/admin-guard";

export const dynamic = "force-dynamic";

export default async function ProductVariantsPage({
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

  // Load ALL variants (active + soft-off) so the On/Off toggle is
  // round-trippable — a hidden variant must still appear here to be
  // switched back on. Active rows sort first.
  const variants = await db
    .select()
    .from(productVariants)
    .where(eq(productVariants.productId, id))
    .orderBy(desc(productVariants.isActive), asc(productVariants.size));
  const activeCount = variants.filter((v) => v.isActive).length;

  // Decode each variant's colour from its variant attributes (type='color')
  // and gather the colour options for the editable dropdown.
  const vids = variants.map((v) => v.id);
  const colourRows = vids.length
    ? await db
        .select({
          variantId: productVariantAttributes.variantId,
          valueId: productVariantAttributes.valueId,
          attrId: productAttributes.id,
        })
        .from(productVariantAttributes)
        .innerJoin(
          productAttributes,
          eq(productAttributes.id, productVariantAttributes.attributeId)
        )
        .where(
          and(
            inArray(productVariantAttributes.variantId, vids),
            eq(productAttributes.type, "color")
          )
        )
    : [];
  const colourByVariant = new Map(
    colourRows.map((r) => [r.variantId, r.valueId])
  );
  const colourAttrIds = [...new Set(colourRows.map((r) => r.attrId))];
  const colourOptions = colourAttrIds.length
    ? await db
        .select({
          id: productAttributeValues.id,
          value: productAttributeValues.value,
          displayLabel: productAttributeValues.displayLabel,
        })
        .from(productAttributeValues)
        .where(inArray(productAttributeValues.attributeId, colourAttrIds))
        .orderBy(asc(productAttributeValues.value))
    : [];

  // Per-variant price (paise) from item_prices — sourced from ERP.
  const priceRows = vids.length
    ? await db
        .select({ variantId: itemPrices.variantId, price: itemPrices.price })
        .from(itemPrices)
        .where(inArray(itemPrices.variantId, vids))
    : [];
  const priceByVariant = new Map<string, number>();
  for (const r of priceRows) {
    const cur = priceByVariant.get(r.variantId);
    // keep the lowest listed price per variant
    if (cur === undefined || r.price < cur) priceByVariant.set(r.variantId, r.price);
  }

  return (
    <div>
      <PageHeader
        breadcrumb={[
          { label: "Catalog", href: "/admin/products" },
          { label: product.name, href: `/admin/products/${product.id}` },
          { label: "Variants" },
        ]}
        title={`${product.name} — variants`}
        description={`${activeCount} shown${
          variants.length > activeCount
            ? ` · ${variants.length - activeCount} hidden`
            : ""
        } · slug: ${product.slug}`}
        actions={
          <Link href={`/admin/products/${product.id}`}>
            <Button
              variant="secondary"
              size="sm"
              icon={<ArrowLeft className="h-3.5 w-3.5" />}
            >
              Back to product
            </Button>
          </Link>
        }
      />

      <ProductVariantsEditor
        productId={product.id}
        slug={product.slug}
        colourOptions={colourOptions.map((c) => ({
          id: c.id,
          label: c.displayLabel ? `${c.value} (${c.displayLabel})` : c.value,
        }))}
        initial={variants.map((v) => ({
          id: v.id,
          size: v.size,
          sku: v.sku,
          stockQty: v.stockQty,
          colorValueId: colourByVariant.get(v.id) ?? null,
          price: priceByVariant.get(v.id) ?? null,
          isActive: v.isActive,
        }))}
      />
    </div>
  );
}
