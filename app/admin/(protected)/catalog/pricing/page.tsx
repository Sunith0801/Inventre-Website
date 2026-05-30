import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/db/client";
import {
  itemPrices,
  priceLists,
  productVariants,
  products,
  schools,
} from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { IndianRupee, Plus } from "lucide-react";
import {
  PageHeader,
  Card,
  CardHeader,
  Th,
  Td,
  Tr,
  Badge,
  Money,
  EmptyState,
  Button,
} from "@/components/admin/ui/primitives";
import { requireAnyPermission, isResponse } from "@/lib/admin-guard";

export const dynamic = "force-dynamic";

export default async function PricingPage() {
  const guard = await requireAnyPermission("catalog.read", "catalog.write");
  if (isResponse(guard)) redirect("/admin/dashboard");

  const lists = await db.select().from(priceLists).orderBy(priceLists.name);

  const rows = await db
    .select({
      productName: products.name,
      size: productVariants.size,
      sku: productVariants.sku,
      price: itemPrices.price,
      priceListName: priceLists.name,
      isDefault: priceLists.isDefault,
      schoolName: schools.name,
    })
    .from(itemPrices)
    .innerJoin(productVariants, eq(productVariants.id, itemPrices.variantId))
    .innerJoin(products, eq(products.id, productVariants.productId))
    .innerJoin(priceLists, eq(priceLists.id, itemPrices.priceListId))
    .leftJoin(schools, eq(schools.id, itemPrices.schoolId))
    .orderBy(sql`${products.name} ASC, ${productVariants.size} ASC`)
    .limit(500);

  return (
    <div>
      <PageHeader
        eyebrow="Catalog"
        title="Pricing"
        description={`${rows.length.toLocaleString("en-IN")} prices across ${lists.length} price lists. School-specific overrides take priority over global prices.`}
        actions={
          <Link href="/admin/catalog/pricing/bulk">
            <Button icon={<Plus className="h-3.5 w-3.5" />} variant="primary">
              Bulk markup
            </Button>
          </Link>
        }
      />

      <Card className="mb-5">
        <CardHeader title="Active price lists" />
        <div className="flex flex-wrap gap-2">
          {lists.map((l) => (
            <div
              key={l.id}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-cream-50 border border-ink-100/70"
            >
              <span className="text-[13px] font-semibold">{l.name}</span>
              <span className="text-[11px] text-ink-500">{l.currency}</span>
              {l.isDefault ? (
                <Badge tone="brand" size="sm">
                  Default
                </Badge>
              ) : null}
            </div>
          ))}
        </div>
      </Card>

      <Card padded={false}>
        {rows.length === 0 ? (
          <EmptyState
            icon={IndianRupee}
            title="No prices yet"
            description="Add an Item Price for any variant to get started."
          />
        ) : (
          <table className="w-full">
            <thead>
              <tr>
                <Th>Product</Th>
                <Th>Size</Th>
                <Th>SKU</Th>
                <Th>Price list</Th>
                <Th>School</Th>
                <Th right>Price</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <Tr key={i}>
                  <Td>
                    <span className="font-medium">{r.productName}</span>
                  </Td>
                  <Td muted>{r.size}</Td>
                  <Td>
                    <span className="font-mono text-[12px] text-ink-700">{r.sku}</span>
                  </Td>
                  <Td>
                    {r.isDefault ? (
                      <Badge tone="brand" size="sm">
                        {r.priceListName}
                      </Badge>
                    ) : (
                      <Badge tone="subtle" size="sm">
                        {r.priceListName}
                      </Badge>
                    )}
                  </Td>
                  <Td muted>
                    {r.schoolName ? (
                      r.schoolName
                    ) : (
                      <span className="text-ink-400 text-[12px]">Global</span>
                    )}
                  </Td>
                  <Td right>
                    <Money paise={r.price} className="font-semibold" />
                  </Td>
                </Tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
