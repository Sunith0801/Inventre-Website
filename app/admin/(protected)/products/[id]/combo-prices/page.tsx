import { notFound } from "next/navigation";
import Link from "next/link";
import { eq, sql } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";
import { requireAnyPermission, isResponse } from "@/server/admin-guard";
import { db } from "@/db/client";
import { products, priceLists } from "@/db/schema";
import { PageHeader, Button } from "@/components/admin/ui/primitives";
import { ComboPricesEditor } from "./_editor";

export const dynamic = "force-dynamic";

export default async function ComboPricesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const guard = await requireAnyPermission("catalog.read", "catalog.write");
  if (isResponse(guard)) return guard;
  const { id } = await params;

  const [product] = await db
    .select()
    .from(products)
    .where(eq(products.id, id))
    .limit(1);
  if (!product) notFound();

  const [defaultList] = await db
    .select({ id: priceLists.id, name: priceLists.name })
    .from(priceLists)
    .where(eq(priceLists.isDefault, true))
    .limit(1);

  // Variants with their (axisName, value, sortOrder) pairs + current override
  // on the default price list. One row per variant; we group by variant id.
  const rows = (await db.execute(sql`
    SELECT
      v.id AS variant_id,
      v.size AS variant_label,
      v.sku AS sku,
      a.name AS axis_name,
      a.sort_order AS axis_sort,
      av.value AS axis_value,
      ip.price AS override_paise,
      ip.id AS price_row_id
    FROM product_variants v
    LEFT JOIN product_variant_attributes va ON va.variant_id = v.id
    LEFT JOIN product_attributes a ON a.id = va.attribute_id
    LEFT JOIN product_attribute_values av ON av.id = va.value_id
    LEFT JOIN item_prices ip
      ON ip.variant_id = v.id
     AND ip.price_list_id = ${defaultList?.id ?? null}
     AND ip.school_id IS NULL
    WHERE v.product_id = ${id}
      AND v.is_active = true
    ORDER BY v.size, a.sort_order
  `)) as unknown as {
    variant_id: string;
    variant_label: string;
    sku: string;
    axis_name: string | null;
    axis_sort: number | null;
    axis_value: string | null;
    override_paise: number | null;
    price_row_id: string | null;
  }[];

  type VariantEntry = {
    variantId: string;
    label: string;
    sku: string;
    axes: { name: string; value: string }[];
    overridePaise: number | null;
  };
  const byVariant = new Map<string, VariantEntry>();
  for (const r of rows) {
    let entry = byVariant.get(r.variant_id);
    if (!entry) {
      entry = {
        variantId: r.variant_id,
        label: r.variant_label,
        sku: r.sku,
        axes: [],
        overridePaise: r.override_paise,
      };
      byVariant.set(r.variant_id, entry);
    }
    if (r.axis_name && r.axis_value) {
      entry.axes.push({ name: r.axis_name, value: r.axis_value });
    }
  }
  const variants = Array.from(byVariant.values()).sort((a, b) =>
    a.label.localeCompare(b.label),
  );

  return (
    <div>
      <PageHeader
        breadcrumb={[{ label: "Products", href: "/admin/products" }, { label: product.name, href: `/admin/products/${product.id}` }, { label: "Combo prices" }]}
        title={`Per-combo pricing — ${product.name}`}
        description={
          <span className="text-[12.5px] text-ink-500">
            One row per variant. Leave blank to use the product&apos;s base price
            (₹{(product.basePrice / 100).toFixed(2)}). Overrides write to the{" "}
            <b>{defaultList?.name ?? "default"}</b> price list with no
            school scope.
          </span>
        }
        actions={
          <Link href={`/admin/products/${product.id}`}>
            <Button
              variant="ghost"
              size="sm"
              icon={<ArrowLeft className="h-3.5 w-3.5" />}
            >
              Back to product
            </Button>
          </Link>
        }
      />

      {!defaultList ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-800">
          No default price list configured. Create one at{" "}
          <Link href="/admin/price-lists" className="underline">
            /admin/price-lists
          </Link>{" "}
          before setting combo overrides.
        </div>
      ) : variants.length === 0 ? (
        <div className="rounded-xl border border-ink-100 bg-cream-50 px-4 py-3 text-[13px] text-ink-500">
          No active variants on this product.
        </div>
      ) : (
        <ComboPricesEditor
          productId={product.id}
          basePricePaise={product.basePrice}
          priceListId={defaultList.id}
          variants={variants}
        />
      )}
    </div>
  );
}
