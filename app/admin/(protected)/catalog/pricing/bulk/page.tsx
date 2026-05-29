import { db } from "@/db/client";
import { products, priceLists, schools, categories } from "@/db/schema";
import { asc } from "drizzle-orm";
import { PageHeader, Card } from "@/components/admin/ui/primitives";
import { BulkMarkupForm } from "@/components/admin/BulkMarkupForm";

export const dynamic = "force-dynamic";

export default async function BulkMarkupPage() {
  const [productRows, listRows, schoolRows, categoryRows] = await Promise.all([
    db
      .select({
        id: products.id,
        name: products.name,
        itemCode: products.itemCode,
        categoryId: products.categoryId,
        basePrice: products.basePrice,
        costPrice: products.costPrice,
      })
      .from(products)
      .orderBy(asc(products.name)),
    db.select().from(priceLists).orderBy(asc(priceLists.name)),
    db.select({ id: schools.id, name: schools.name }).from(schools).orderBy(asc(schools.name)),
    db
      .select({ id: categories.id, name: categories.name })
      .from(categories)
      .orderBy(asc(categories.name)),
  ]);

  return (
    <div className="max-w-5xl">
      <PageHeader
        breadcrumb={[
          { label: "Catalog", href: "/admin/catalog/pricing" },
          { label: "Pricing", href: "/admin/catalog/pricing" },
          { label: "Bulk markup" },
        ]}
        title="Bulk markup"
        description="Apply a percentage markup over each product's cost price (or base price if cost is unset). Writes new Item Price rows on the chosen price list."
      />
      <Card>
        <BulkMarkupForm
          products={productRows}
          priceLists={listRows.map((l) => ({
            id: l.id,
            name: l.name,
            isDefault: l.isDefault,
          }))}
          schools={schoolRows}
          categories={categoryRows}
        />
      </Card>
    </div>
  );
}
